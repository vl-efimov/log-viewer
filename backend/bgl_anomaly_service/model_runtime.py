from __future__ import annotations

import os
import threading
from pathlib import Path

os.environ.setdefault("TF_USE_LEGACY_KERAS", "0")

import numpy as np
from transformers import BertTokenizer, TFBertModel

from .local_model import build_neurallog_classifier
from .settings import (
    DEFAULT_MODEL_ID,
    DROPOUT,
    EMBED_DIM,
    FF_DIM,
    MODEL_CATALOG,
    MAX_LEN,
    NUM_HEADS,
)


class ModelRuntime:
    def __init__(self, *, model_id: str, model_path: Path, model_label: str) -> None:
        self.model_id = model_id
        self.model_path = model_path
        self.model_label = model_label
        self._lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._loaded = False
        self._preparing = False
        self._prepare_stage = "idle"
        self._prepare_progress = 0
        self._prepare_message = "Not prepared"
        self._prepare_error: str | None = None
        self._tokenizer: BertTokenizer | None = None
        self._bert_model: TFBertModel | None = None
        self._classifier = None

    def _clear_loaded_components(self) -> None:
        self._loaded = False
        self._tokenizer = None
        self._bert_model = None
        self._classifier = None

    def recover(self, reason: str) -> None:
        with self._lock:
            self._set_prepare_state(
                stage="recovering",
                progress=0,
                message=f"Recovering runtime after error: {reason[:120]}",
                preparing=True,
                error=None,
            )
            self._clear_loaded_components()

    def _set_prepare_state(
        self,
        *,
        stage: str,
        progress: int,
        message: str,
        preparing: bool,
        error: str | None,
    ) -> None:
        with self._state_lock:
            self._prepare_stage = stage
            self._prepare_progress = max(0, min(100, progress))
            self._prepare_message = message
            self._preparing = preparing
            self._prepare_error = error

    def get_prepare_status(self) -> dict[str, object]:
        with self._state_lock:
            return {
                "preparing": self._preparing,
                "stage": self._prepare_stage,
                "progress": self._prepare_progress,
                "message": self._prepare_message,
                "error": self._prepare_error,
                "loaded": self._loaded,
            }

    def load(self) -> None:
        with self._lock:
            if self._loaded:
                self._set_prepare_state(
                    stage="ready",
                    progress=100,
                    message="Model is ready",
                    preparing=False,
                    error=None,
                )
                return

            self._set_prepare_state(
                stage="checking",
                progress=5,
                message="Checking local model files",
                preparing=True,
                error=None,
            )

            try:
                if not self.model_path.exists():
                    raise FileNotFoundError(f"{self.model_label} model file not found: {self.model_path}")

                self._set_prepare_state(
                    stage="tokenizer",
                    progress=15,
                    message="Loading BERT tokenizer",
                    preparing=True,
                    error=None,
                )
                self._tokenizer = BertTokenizer.from_pretrained("bert-base-uncased")

                self._set_prepare_state(
                    stage="bert",
                    progress=40,
                    message="Downloading/loading BERT model",
                    preparing=True,
                    error=None,
                )
                # Avoid safetensors/PT conversion path that can fail in some TF/transformers
                # combinations on Windows with `'safe_open' object is not iterable`.
                self._bert_model = TFBertModel.from_pretrained(
                    "bert-base-uncased",
                    use_safetensors=False,
                )

                self._set_prepare_state(
                    stage="classifier",
                    progress=70,
                    message="Building NeuralLog classifier",
                    preparing=True,
                    error=None,
                )
                self._classifier = build_neurallog_classifier(
                    EMBED_DIM,
                    ff_dim=FF_DIM,
                    max_len=MAX_LEN,
                    num_heads=NUM_HEADS,
                    dropout=DROPOUT,
                )

                self._set_prepare_state(
                    stage="weights",
                    progress=90,
                    message=f"Loading pretrained {self.model_label} weights",
                    preparing=True,
                    error=None,
                )
                self._classifier.load_weights(str(self.model_path))
                self._loaded = True

                self._set_prepare_state(
                    stage="ready",
                    progress=100,
                    message="Model is ready",
                    preparing=False,
                    error=None,
                )
            except Exception as exc:
                self._set_prepare_state(
                    stage="error",
                    progress=0,
                    message="Model preparation failed",
                    preparing=False,
                    error=str(exc),
                )
                raise

    def encode_text(self, text: str) -> np.ndarray:
        self.load()
        assert self._tokenizer is not None
        assert self._bert_model is not None

        inputs = self._tokenizer(text, return_tensors="tf", max_length=512, truncation=True)
        outputs = self._bert_model(**inputs)
        vector = outputs.last_hidden_state.numpy().mean(axis=1)[0]
        return vector.astype(np.float32)

    def predict_window_batch(self, batch: np.ndarray) -> np.ndarray:
        self.load()
        assert self._classifier is not None

        if batch.shape[0] == 0:
            return np.zeros((0,), dtype=float)

        safe_chunk = 256
        if batch.shape[0] > safe_chunk:
            probs_list: list[np.ndarray] = []
            for start in range(0, batch.shape[0], safe_chunk):
                end = min(start + safe_chunk, batch.shape[0])
                probs_list.append(self.predict_window_batch(batch[start:end]))
            return np.concatenate(probs_list, axis=0)

        try:
            with self._lock:
                probs = self._classifier(batch, training=False).numpy()
        except Exception as exc:
            message = str(exc)
            # Some TF/Keras sessions can end up in a bad state for attention
            # einsum/query ops. Retry once after a clean runtime reload.
            if "EinsumDense" in message or "layer 'query'" in message:
                self.recover(reason=message)
                self.load()
                assert self._classifier is not None
                with self._lock:
                    probs = self._classifier(batch, training=False).numpy()
            else:
                raise
        if probs.ndim != 2 or probs.shape[1] < 2:
            raise RuntimeError("Unexpected classifier output shape")
        return probs[:, 1].astype(float)

    @property
    def is_loaded(self) -> bool:
        return self._loaded


_runtimes: dict[str, ModelRuntime] = {
    model_id: ModelRuntime(
        model_id=model_id,
        model_path=model_info["model_path"],
        model_label=model_info["dataset"],
    )
    for model_id, model_info in MODEL_CATALOG.items()
}


def get_runtime(model_id: str) -> ModelRuntime:
    model_key = (model_id or DEFAULT_MODEL_ID).lower()
    runtime = _runtimes.get(model_key)
    if runtime is None:
        supported = ", ".join(sorted(_runtimes.keys()))
        raise ValueError(f"Unsupported model_id '{model_id}'. Supported: {supported}")
    return runtime


def get_all_runtimes() -> dict[str, ModelRuntime]:
    return dict(_runtimes)


runtime = get_runtime(DEFAULT_MODEL_ID)

from __future__ import annotations

import os
import threading
import time
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
        self._prediction_running = False
        self._prediction_stage = "idle"
        self._prediction_processed_windows = 0
        self._prediction_total_windows = 0
        self._prediction_processed_rows = 0
        self._prediction_total_rows = 0
        self._prediction_started_at_ms: int | None = None
        self._prediction_updated_at_ms: int | None = None
        self._cancel_event = threading.Event()
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

    def begin_prediction(
        self,
        *,
        total_windows: int,
        stage: str = "embedding",
        total_rows: int = 0,
    ) -> None:
        now_ms = int(time.time() * 1000)
        with self._state_lock:
            self._prediction_running = True
            self._prediction_stage = stage
            self._prediction_processed_windows = 0
            self._prediction_total_windows = max(0, int(total_windows))
            self._prediction_processed_rows = 0
            self._prediction_total_rows = max(0, int(total_rows))
            self._prediction_started_at_ms = now_ms
            self._prediction_updated_at_ms = now_ms

    def reset_prediction_status(self) -> None:
        with self._state_lock:
            self._prediction_running = False
            self._prediction_stage = "idle"
            self._prediction_processed_windows = 0
            self._prediction_total_windows = 0
            self._prediction_processed_rows = 0
            self._prediction_total_rows = 0
            self._prediction_started_at_ms = None
            self._prediction_updated_at_ms = None

    def update_prediction_progress(
        self,
        *,
        processed_windows: int,
        total_windows: int | None = None,
        processed_rows: int | None = None,
        total_rows: int | None = None,
        stage: str | None = None,
    ) -> None:
        now_ms = int(time.time() * 1000)
        with self._state_lock:
            if total_windows is not None:
                self._prediction_total_windows = max(0, int(total_windows))
            if total_rows is not None:
                self._prediction_total_rows = max(0, int(total_rows))

            total = self._prediction_total_windows
            processed = max(0, int(processed_windows))
            if total > 0:
                processed = min(processed, total)
            self._prediction_processed_windows = processed

            if processed_rows is not None:
                total_row_count = self._prediction_total_rows
                row_processed = max(0, int(processed_rows))
                if total_row_count > 0:
                    row_processed = min(row_processed, total_row_count)
                self._prediction_processed_rows = row_processed

            if stage is not None:
                self._prediction_stage = stage

            if not self._prediction_running:
                self._prediction_running = True
                if self._prediction_started_at_ms is None:
                    self._prediction_started_at_ms = now_ms

            self._prediction_updated_at_ms = now_ms

    def finish_prediction(self, *, stage: str = "done") -> None:
        now_ms = int(time.time() * 1000)
        with self._state_lock:
            if stage == "done" and self._prediction_total_windows > 0:
                self._prediction_processed_windows = self._prediction_total_windows
            if stage == "done" and self._prediction_total_rows > 0:
                self._prediction_processed_rows = self._prediction_total_rows
            self._prediction_running = False
            self._prediction_stage = stage
            self._prediction_updated_at_ms = now_ms

    def get_prediction_status(self) -> dict[str, object]:
        with self._state_lock:
            total = self._prediction_total_windows
            processed = self._prediction_processed_windows
            total_rows = self._prediction_total_rows
            processed_rows = self._prediction_processed_rows

            if total > 0:
                progress_percent = int(round((processed / total) * 100))
            elif total_rows > 0:
                progress_percent = int(round((processed_rows / total_rows) * 100))
            else:
                progress_percent = 0

            return {
                "running": self._prediction_running,
                "stage": self._prediction_stage,
                "processed_windows": processed,
                "total_windows": total,
                "processed_rows": processed_rows,
                "total_rows": total_rows,
                "progress_percent": max(0, min(100, progress_percent)),
                "started_at_ms": self._prediction_started_at_ms,
                "updated_at_ms": self._prediction_updated_at_ms,
            }

    def request_cancel(self) -> None:
        self._cancel_event.set()

    def reset_cancel(self) -> None:
        self._cancel_event.clear()

    def is_cancel_requested(self) -> bool:
        return self._cancel_event.is_set()

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

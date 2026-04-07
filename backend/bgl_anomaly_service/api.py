from __future__ import annotations

import threading
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .inference import NeuralLogAnomalyService, PredictionCancelledError
from .io_utils import parse_rows_from_bytes
from .model_runtime import get_all_runtimes, get_runtime
from .schemas import PredictJsonRequest
from .settings import DEFAULT_MODEL_ID, MODEL_CATALOG

app = FastAPI(title="BGL NeuralLog Anomaly API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
services: dict[str, NeuralLogAnomalyService] = {
    model_id: NeuralLogAnomalyService(model_id=model_id)
    for model_id in MODEL_CATALOG.keys()
}
prepare_thread_lock = threading.Lock()
prepare_threads: dict[str, threading.Thread] = {}


def _normalize_model_id(model_id: str | None) -> str:
    normalized = (model_id or DEFAULT_MODEL_ID).strip().lower()
    if normalized not in MODEL_CATALOG:
        supported = ", ".join(sorted(MODEL_CATALOG.keys()))
        raise HTTPException(status_code=400, detail=f"Unsupported model_id '{model_id}'. Supported: {supported}")
    return normalized


def _model_status(model_id: str) -> dict[str, Any]:
    config = MODEL_CATALOG[model_id]
    runtime = get_runtime(model_id)
    model_exists = config["model_path"].exists()
    model_loaded = runtime.is_loaded
    prep = runtime.get_prepare_status()
    return {
        "model_id": model_id,
        "name": config["name"],
        "dataset": config["dataset"],
        "model_path": str(config["model_path"]),
        "model_exists": model_exists,
        "model_loaded": model_loaded,
        "model_ready": bool(model_exists),
        "prepare": prep,
    }


@app.get("/health")
def health(model_id: str = DEFAULT_MODEL_ID) -> dict[str, Any]:
    selected = _normalize_model_id(model_id)
    selected_status = _model_status(selected)
    return {
        "ok": True,
        "selected_model_id": selected,
        **selected_status,
    }


@app.post("/warmup")
def warmup(model_id: str = DEFAULT_MODEL_ID) -> dict[str, Any]:
    selected = _normalize_model_id(model_id)
    services[selected].warmup()
    return {"ok": True, **_model_status(selected)}


@app.get("/models/status")
def models_status() -> dict[str, Any]:
    items = [_model_status(model_id) for model_id in MODEL_CATALOG.keys()]
    return {
        "ok": True,
        "models": items,
    }


@app.get("/prepare/status")
def prepare_status(model_id: str = DEFAULT_MODEL_ID) -> dict[str, Any]:
    selected = _normalize_model_id(model_id)
    return {"ok": True, **_model_status(selected)}


@app.post("/prepare/start")
def prepare_start(model_id: str = DEFAULT_MODEL_ID) -> dict[str, Any]:
    selected = _normalize_model_id(model_id)
    runtime = get_runtime(selected)
    service = services[selected]

    with prepare_thread_lock:
        current = prepare_threads.get(selected)
        if current is not None and current.is_alive():
            return {
                "ok": True,
                "started": False,
                "message": "Preparation already in progress",
                **_model_status(selected),
            }

        if runtime.is_loaded:
            return {
                "ok": True,
                "started": False,
                "message": "Model already prepared",
                **_model_status(selected),
            }

        def _run_prepare() -> None:
            try:
                service.warmup()
            except Exception:
                # Detailed error is stored in runtime preparation state.
                return

        thread = threading.Thread(target=_run_prepare, daemon=True)
        prepare_threads[selected] = thread
        thread.start()

    return {
        "ok": True,
        "started": True,
        "message": "Preparation started",
        **_model_status(selected),
    }


@app.post("/bgl/cancel")
def cancel_prediction(model_id: str = DEFAULT_MODEL_ID) -> dict[str, Any]:
    selected = _normalize_model_id(model_id)
    runtime = get_runtime(selected)
    runtime.request_cancel()
    return {
        "ok": True,
        "model_id": selected,
        "message": "Cancellation requested",
    }


@app.post("/bgl/predict-json")
def predict_json(request: PredictJsonRequest) -> dict[str, Any]:
    try:
        service = services[request.model_id]
        service.runtime.reset_cancel()
        return service.predict_rows(
            rows=request.rows,
            text_column=request.text_column,
            timestamp_column=request.timestamp_column,
            threshold=request.threshold,
            step_size=request.step_size,
            min_region_lines=request.min_region_lines,
            include_rows=request.include_rows,
            include_windows=request.include_windows,
        )
    except PredictionCancelledError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/bgl/predict-file")
async def predict_file(
    file: UploadFile = File(...),
    model_id: str = Form(default=DEFAULT_MODEL_ID),
    text_column: str | None = Form(default=None),
    timestamp_column: str | None = Form(default=None),
    threshold: float = Form(default=0.5),
    step_size: int = Form(default=20),
    min_region_lines: int = Form(default=1),
    include_rows: bool = Form(default=True),
    include_windows: bool = Form(default=True),
) -> dict[str, Any]:
    try:
        selected = _normalize_model_id(model_id)
        service = services[selected]
        service.runtime.reset_cancel()
        raw = await file.read()
        rows = parse_rows_from_bytes(raw, source_name=file.filename or "")
        return service.predict_rows(
            rows=rows,
            text_column=text_column,
            timestamp_column=timestamp_column,
            threshold=threshold,
            step_size=step_size,
            min_region_lines=min_region_lines,
            include_rows=include_rows,
            include_windows=include_windows,
        )
    except PredictionCancelledError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=400, detail=str(exc)) from exc

from __future__ import annotations

import threading
from typing import Any

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .inference import NeuralLogAnomalyService, PredictionCancelledError
from .io_utils import parse_rows_from_bytes
from .log_db import (
    append_chunk,
    build_dashboard_snapshot,
    create_ingest,
    delete_ingest,
    finish_ingest,
    get_ingest,
    get_line_count,
    get_lines_range,
    get_rows_for_anomaly,
    init_db,
    query_filtered_lines,
)
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

init_db()


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


@app.post("/ingest/start")
def ingest_start(
    file_name: str = Form(...),
    file_size: int = Form(...),
    format_id: str | None = Form(default=None),
    parser_pattern: str | None = Form(default=None),
) -> dict[str, Any]:
    ingest_id = create_ingest(
        file_name=file_name,
        file_size=file_size,
        format_id=format_id,
        parser_pattern=parser_pattern,
    )
    return {
        "ok": True,
        "ingest_id": ingest_id,
        "recommended_chunk_bytes": 4 * 1024 * 1024,
    }


@app.put("/ingest/{ingest_id}/chunk")
async def ingest_chunk(ingest_id: str, chunk: bytes = Body(...)) -> dict[str, Any]:
    try:
        result = append_chunk(ingest_id, chunk)
        return {"ok": True, **result}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/ingest/{ingest_id}/finish")
def ingest_finish(ingest_id: str) -> dict[str, Any]:
    try:
        status = finish_ingest(ingest_id)
        return {"ok": True, **status}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/ingest/{ingest_id}/status")
def ingest_status(ingest_id: str) -> dict[str, Any]:
    status = get_ingest(ingest_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Unknown ingest_id")
    return {"ok": True, **status}


@app.delete("/ingest/{ingest_id}")
def ingest_delete(ingest_id: str) -> dict[str, Any]:
    try:
        delete_ingest(ingest_id)
        return {
            "ok": True,
            "ingest_id": ingest_id,
            "deleted": True,
        }
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/logs/{ingest_id}/line-count")
def log_line_count(ingest_id: str) -> dict[str, Any]:
    return {
        "ok": True,
        "ingest_id": ingest_id,
        "line_count": get_line_count(ingest_id),
    }


@app.get("/logs/{ingest_id}/lines")
def log_lines(ingest_id: str, start_line: int, end_line: int) -> dict[str, Any]:
    if start_line <= 0 or end_line < start_line:
        raise HTTPException(status_code=400, detail="Invalid line range")
    return {
        "ok": True,
        "lines": get_lines_range(ingest_id, start_line=start_line, end_line=end_line),
    }


@app.post("/logs/{ingest_id}/filter")
def log_filter(ingest_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    filters = payload.get("filters") if isinstance(payload, dict) else {}
    limit = int(payload.get("limit", 50000)) if isinstance(payload, dict) else 50000
    return {
        "ok": True,
        **query_filtered_lines(ingest_id, filters=filters or {}, limit=max(1, min(limit, 100000))),
    }


@app.get("/logs/{ingest_id}/dashboard")
def log_dashboard(ingest_id: str) -> dict[str, Any]:
    return {
        "ok": True,
        "snapshot": build_dashboard_snapshot(ingest_id),
    }


@app.post("/bgl/predict-ingest")
def predict_ingest(
    ingest_id: str = Form(...),
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
        rows = get_rows_for_anomaly(ingest_id)
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

from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import requests


REPO_ROOT = Path(__file__).resolve().parents[1]
TESTING_ROOT = Path(__file__).resolve().parent
DEFAULT_BACKEND_CONFIG_PATH = TESTING_ROOT / "config" / "backend-large-datasets.json"
DEFAULT_ANOMALY_CONFIG_PATH = TESTING_ROOT / "config" / "anomaly-datasets.json"
DEFAULT_CONFIG_PATH = DEFAULT_BACKEND_CONFIG_PATH
DEFAULT_REPORTS_DIR = TESTING_ROOT / "reports"

FORMAT_ID_ALIASES: dict[str, list[str]] = {
    "apache": ["apache-error", "apache-access"],
    "hdfs": ["hdfs-v2", "hdfs-v1"],
    "bgl": ["bgl-new", "bgl-old"],
}


# Exception used for failures of test-specific assertions.
class TestFailure(RuntimeError):
    pass


# Description of one dataset entry loaded from configuration.
@dataclass
class DatasetSpec:
    name: str
    file_path: Path
    format_id: str | None = None
    parser_pattern: str | None = None
    model_id: str | None = None


# Thin wrapper around the backend API used by all testing scripts.
class ApiClient:
    def __init__(self, base_url: str, timeout_s: float = 120.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self.session = requests.Session()

    def _request(self, method: str, path: str, **kwargs: Any) -> requests.Response:
        timeout = kwargs.pop("timeout", self.timeout_s)
        response = self.session.request(method, f"{self.base_url}{path}", timeout=timeout, **kwargs)
        response.raise_for_status()
        return response

    def _json(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        return self._request(method, path, **kwargs).json()

    def _require_ok(self, payload: dict[str, Any], operation: str) -> dict[str, Any]:
        if payload.get("ok") is not True:
            raise TestFailure(f"Backend returned a non-ok payload for {operation}: {payload}")
        return payload

    def health(self, model_id: str | None = None) -> dict[str, Any]:
        params = {"model_id": model_id} if model_id else None
        return self._json("GET", "/health", params=params)

    def models_status(self) -> dict[str, Any]:
        return self._json("GET", "/models/status")

    def warmup(self, model_id: str) -> dict[str, Any]:
        return self._json("POST", "/warmup", params={"model_id": model_id}, timeout=max(self.timeout_s, 600.0))

    def start_ingest(
        self,
        *,
        file_name: str,
        file_size: int,
        format_id: str | None = None,
        parser_pattern: str | None = None,
    ) -> dict[str, Any]:
        form_data: dict[str, Any] = {
            "file_name": file_name,
            "file_size": str(file_size),
        }
        if format_id:
            form_data["format_id"] = format_id
        if parser_pattern:
            form_data["parser_pattern"] = parser_pattern
        return self._json("POST", "/ingest/start", data=form_data)

    def upload_chunk(self, ingest_id: str, chunk: bytes) -> dict[str, Any]:
        return self._json(
            "PUT",
            f"/ingest/{ingest_id}/chunk",
            data=chunk,
            headers={"Content-Type": "application/octet-stream"},
        )

    def finish_ingest(self, ingest_id: str) -> dict[str, Any]:
        return self._json("POST", f"/ingest/{ingest_id}/finish")

    def delete_ingest(self, ingest_id: str) -> dict[str, Any]:
        return self._json("DELETE", f"/ingest/{ingest_id}")

    def get_ingest_status(self, ingest_id: str) -> dict[str, Any]:
        return self._json("GET", f"/ingest/{ingest_id}/status")

    def get_line_count(self, ingest_id: str) -> int:
        payload = self._json("GET", f"/logs/{ingest_id}/line-count")
        return int(payload["line_count"])

    def get_lines(self, ingest_id: str, start_line: int, end_line: int) -> list[dict[str, Any]]:
        payload = self._json(
            "GET",
            f"/logs/{ingest_id}/lines",
            params={"start_line": start_line, "end_line": end_line},
        )
        return list(payload.get("lines", []))

    def filter_lines(self, ingest_id: str, filters: dict[str, Any], limit: int = 50) -> dict[str, Any]:
        return self._json(
            "POST",
            f"/logs/{ingest_id}/filter",
            json={"filters": filters, "limit": limit},
        )

    def dashboard(self, ingest_id: str) -> dict[str, Any]:
        return self._json("GET", f"/logs/{ingest_id}/dashboard")

    def dashboard_exact(self, ingest_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._json("POST", f"/logs/{ingest_id}/dashboard/exact", json=payload or {})

    def predict_ingest(
        self,
        ingest_id: str,
        *,
        model_id: str,
        threshold: float,
        step_size: int,
        min_region_lines: int,
        include_rows: bool,
        include_windows: bool,
    ) -> dict[str, Any]:
        form_data = {
            "ingest_id": ingest_id,
            "model_id": model_id,
            "threshold": str(threshold),
            "step_size": str(step_size),
            "min_region_lines": str(min_region_lines),
            "include_rows": str(include_rows).lower(),
            "include_windows": str(include_windows).lower(),
        }
        return self._json("POST", "/anomaly/predict-ingest", data=form_data, timeout=None)

    def upload_file(self, dataset: DatasetSpec, chunk_bytes: int = 4 * 1024 * 1024) -> tuple[str, dict[str, Any]]:
        format_candidates = resolve_format_candidates(dataset.format_id)
        if len(format_candidates) <= 1:
            selected_format = format_candidates[0] if format_candidates else dataset.format_id
            return self._upload_file_once(dataset, chunk_bytes=chunk_bytes, format_id_override=selected_format)

        expected_line_count = count_non_empty_lines(dataset.file_path)
        errors: list[str] = []
        for candidate in format_candidates:
            ingest_id: str | None = None
            try:
                ingest_id, finish_payload = self._upload_file_once(
                    dataset,
                    chunk_bytes=chunk_bytes,
                    format_id_override=candidate,
                )
                parsed_line_count = self.get_line_count(ingest_id)
                if parsed_line_count == expected_line_count:
                    dataset.format_id = candidate
                    preserved_ingest_id = ingest_id
                    ingest_id = None
                    return preserved_ingest_id, finish_payload
                errors.append(f"{candidate}: parsed {parsed_line_count} lines instead of {expected_line_count}")
            finally:
                if ingest_id:
                    try:
                        self.delete_ingest(ingest_id)
                    except Exception:
                        pass

        raise TestFailure(
            f"No parser candidate matched dataset {dataset.name}. Tried: {', '.join(errors) or ', '.join(format_candidates)}"
        )

    def _upload_file_once(
        self,
        dataset: DatasetSpec,
        *,
        chunk_bytes: int,
        format_id_override: str | None,
    ) -> tuple[str, dict[str, Any]]:
        start_payload = self._require_ok(
            self.start_ingest(
            file_name=dataset.file_path.name,
            file_size=dataset.file_path.stat().st_size,
            format_id=format_id_override,
            parser_pattern=dataset.parser_pattern,
            ),
            "ingest start",
        )
        ingest_id = str(start_payload["ingest_id"])
        if not ingest_id:
            raise TestFailure(f"Backend did not return a usable ingest_id for dataset {dataset.name}")

        # The backend ingest API is stateful, so the test client mirrors the same
        # start -> chunk upload -> finish flow used by the application itself.
        with dataset.file_path.open("rb") as handle:
            uploaded_chunks = 0
            while True:
                chunk = handle.read(chunk_bytes)
                if not chunk:
                    break
                self._require_ok(self.upload_chunk(ingest_id, chunk), f"ingest chunk upload #{uploaded_chunks + 1}")
                uploaded_chunks += 1
        if uploaded_chunks <= 0:
            raise TestFailure(f"Dataset {dataset.name} produced no upload chunks")

        finish_payload = self._require_ok(self.finish_ingest(ingest_id), "ingest finish")
        if finish_payload.get("status") != "ready":
            raise TestFailure(
                f"Expected ingest status 'ready' after finish for {dataset.name}, got {finish_payload.get('status')!r}"
            )
        return ingest_id, finish_payload


# Load dataset definitions from JSON and resolve file paths.
def load_datasets(config_path: Path, selected_names: set[str] | None = None) -> list[DatasetSpec]:

    raw = json.loads(config_path.read_text(encoding="utf-8"))
    items: list[DatasetSpec] = []
    for entry in raw.get("datasets", []):
        name = str(entry["name"])
        if selected_names and name not in selected_names:
            continue
        items.append(
            DatasetSpec(
                name=name,
                file_path=(REPO_ROOT / str(entry["file"])).resolve(),
                format_id=entry.get("format_id"),
                parser_pattern=entry.get("parser_pattern"),
                model_id=entry.get("model_id"),
            )
        )
    return items


# Expand a short family alias into concrete parser ids accepted by the backend.
def resolve_format_candidates(format_id: str | None) -> list[str]:
    if not format_id:
        return []
    return FORMAT_ID_ALIASES.get(format_id, [format_id])


# Ensure the output directory for reports exists.
def ensure_reports_dir() -> Path:

    DEFAULT_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    return DEFAULT_REPORTS_DIR


# Write a JSON report in a readable pretty-printed form.
def write_json_report(output_path: Path, payload: dict[str, Any]) -> None:

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


# Count non-empty lines in the source log file.
def count_non_empty_lines(file_path: Path) -> int:

    with file_path.open("r", encoding="utf-8", errors="replace") as handle:
        return sum(1 for line in handle if line.strip())


# Pick a short token from preview lines for filter checks.
def pick_probe_token(lines: list[str]) -> str | None:

    for line in lines:
        tokens = [
            token.strip("[](){}<>\"'`,.:;!?/")
            for token in line.split()
        ]
        for token in reversed(tokens):
            if len(token) >= 4 and any(ch.isalpha() for ch in token):
                return token
    return None


# Measure call duration and return both the result and elapsed milliseconds.
def timed_call(func: Callable[[], Any]) -> tuple[Any, float]:

    started = time.perf_counter()
    result = func()
    duration_ms = (time.perf_counter() - started) * 1000.0
    return result, duration_ms


# Extract anomaly line numbers from the backend response.
def extract_predicted_lines(prediction: dict[str, Any]) -> set[int]:

    anomaly_lines = prediction.get("anomaly_lines")
    if isinstance(anomaly_lines, list):
        return {int(line) for line in anomaly_lines}

    predicted: set[int] = set()
    # Some backend responses expose a compact anomaly_lines list, others only flag
    # per-row entries. The integration test accepts both shapes.
    for row in prediction.get("rows") or []:
        if row.get("is_anomaly"):
            predicted.add(int(row["line"]))
    return predicted


# Summarize latency samples into min, max, and average values.
def summarize_latencies(samples_ms: list[float]) -> dict[str, float]:

    if not samples_ms:
        return {"count": 0, "min_ms": 0.0, "max_ms": 0.0, "avg_ms": 0.0}
    return {
        "count": len(samples_ms),
        "min_ms": round(min(samples_ms), 3),
        "max_ms": round(max(samples_ms), 3),
        "avg_ms": round(sum(samples_ms) / len(samples_ms), 3),
    }


# Normalize repeated dataset names passed through CLI arguments.
def normalize_selected_names(raw: list[str]) -> set[str] | None:

    normalized = {item.strip() for item in raw if item.strip()}
    return normalized or None


# Perform a simple backend availability check.
def is_backend_reachable(base_url: str, timeout_s: float = 5.0) -> tuple[bool, str]:

    try:
        response = requests.get(f"{base_url.rstrip('/')}/health", timeout=timeout_s)
        response.raise_for_status()
        return True, "Backend is reachable"
    except Exception as exc:
        return False, str(exc)


# Round a numeric value and guard against invalid numbers.
def safe_round(value: float) -> float:

    if math.isnan(value) or math.isinf(value):
        return 0.0
    return round(value, 6)
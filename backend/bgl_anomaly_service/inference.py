from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from .model_runtime import get_runtime
from .preprocessing import extract_message, extract_timestamp_iso, prepare_log_message
from .settings import (
    ANOMALY_SHADE_COLOR,
    DEFAULT_MODEL_ID,
    DEFAULT_MIN_REGION_LINES,
    DEFAULT_STEP_SIZE,
    DEFAULT_THRESHOLD,
    EMBED_DIM,
    MAX_LEN,
    WINDOW_SIZE,
)


@dataclass
class Region:
    start_index: int
    end_index: int

    @property
    def count(self) -> int:
        return self.end_index - self.start_index + 1


def _build_windows(
    total_rows: int,
    window_size: int,
    step_size: int,
) -> list[tuple[int, int, int]]:
    n = total_rows
    if n == 0:
        return []

    if n <= window_size:
        starts = [0]
    else:
        starts = list(range(0, n - window_size + 1, step_size))
        last_start = n - window_size
        if starts[-1] != last_start:
            starts.append(last_start)

    return [(start, min(start + window_size, n), min(start + window_size, n) - start) for start in starts]


def _build_window_batch(
    embeddings: list[np.ndarray],
    spans: list[tuple[int, int, int]],
) -> np.ndarray:
    if not spans:
        return np.zeros((0, MAX_LEN, EMBED_DIM), dtype=np.float32)

    batch = np.zeros((len(spans), MAX_LEN, EMBED_DIM), dtype=np.float32)

    for i, (start, end, length) in enumerate(spans):
        seq = np.array(embeddings[start:end], dtype=np.float32)
        batch[i, MAX_LEN - length : MAX_LEN, :] = seq

    return batch


def _build_regions(flags: np.ndarray, min_region_lines: int) -> list[Region]:
    regions: list[Region] = []
    start: int | None = None

    for idx, value in enumerate(flags):
        if value and start is None:
            start = idx
        elif not value and start is not None:
            region = Region(start, idx - 1)
            if region.count >= min_region_lines:
                regions.append(region)
            start = None

    if start is not None:
        region = Region(start, len(flags) - 1)
        if region.count >= min_region_lines:
            regions.append(region)

    return regions


def _build_overlay_payload(regions: list[dict[str, Any]]) -> dict[str, Any]:
    mark_area: list[list[dict[str, Any]]] = []
    simple_regions: list[dict[str, Any]] = []

    for region in regions:
        x_start = region.get("start_timestamp") or region["start_line"]
        x_end = region.get("end_timestamp") or region["end_line"]

        simple_regions.append(
            {
                "xStart": x_start,
                "xEnd": x_end,
                "lineStart": region["start_line"],
                "lineEnd": region["end_line"],
                "color": ANOMALY_SHADE_COLOR,
            }
        )

        mark_area.append(
            [
                {
                    "name": "Anomaly",
                    "xAxis": x_start,
                    "itemStyle": {"color": ANOMALY_SHADE_COLOR},
                },
                {
                    "xAxis": x_end,
                },
            ]
        )

    return {
        "color": ANOMALY_SHADE_COLOR,
        "regions": simple_regions,
        "echartsMarkArea": mark_area,
    }


class NeuralLogAnomalyService:
    def __init__(self, model_id: str = DEFAULT_MODEL_ID) -> None:
        self.model_id = model_id
        self.runtime = get_runtime(model_id)
        self._embedding_cache: dict[str, np.ndarray] = {}

    def warmup(self) -> None:
        self.runtime.load()

    def _embed(self, text: str) -> np.ndarray:
        if text in self._embedding_cache:
            return self._embedding_cache[text]
        vector = self.runtime.encode_text(text)
        self._embedding_cache[text] = vector
        return vector

    def predict_rows(
        self,
        rows: list[dict[str, Any]],
        text_column: str | None = None,
        timestamp_column: str | None = None,
        threshold: float = DEFAULT_THRESHOLD,
        step_size: int = DEFAULT_STEP_SIZE,
        min_region_lines: int = DEFAULT_MIN_REGION_LINES,
        include_rows: bool = True,
        include_windows: bool = True,
    ) -> dict[str, Any]:
        if threshold < 0 or threshold > 1:
            raise ValueError("threshold must be in [0, 1]")
        if step_size <= 0:
            raise ValueError("step_size must be positive")
        if min_region_lines <= 0:
            raise ValueError("min_region_lines must be positive")

        if not rows:
            return {
                "meta": {
                    "total_rows": 0,
                    "anomaly_rows": 0,
                    "threshold": threshold,
                    "window_size": WINDOW_SIZE,
                    "step_size": step_size,
                },
                "rows": [] if include_rows else None,
                "windows": [] if include_windows else None,
                "anomaly_lines": [],
                "anomaly_regions": [],
                "chart_overlays": _build_overlay_payload([]),
            }

        messages: list[str] = []
        processed: list[str] = []
        timestamps: list[str | None] = []

        for row in rows:
            message = extract_message(row, forced_column=text_column)
            messages.append(message)
            processed.append(prepare_log_message(message))
            timestamps.append(extract_timestamp_iso(row, forced_column=timestamp_column))

        embeddings: list[np.ndarray] = []
        for item in processed:
            if not item:
                embeddings.append(np.zeros((EMBED_DIM,), dtype=np.float32))
                continue
            embeddings.append(self._embed(item))

        window_spans = _build_windows(len(embeddings), WINDOW_SIZE, step_size)

        line_scores = np.zeros((len(rows),), dtype=np.float32)
        line_hits = np.zeros((len(rows),), dtype=np.int32)

        windows_out: list[dict[str, Any]] = []
        window_batch_size = 256
        for chunk_start in range(0, len(window_spans), window_batch_size):
            chunk_spans = window_spans[chunk_start : chunk_start + window_batch_size]
            chunk_batch = _build_window_batch(embeddings, chunk_spans)
            chunk_scores = self.runtime.predict_window_batch(chunk_batch) if len(chunk_spans) > 0 else np.array([])

            for i, (start, end, _length) in enumerate(chunk_spans):
                score = float(chunk_scores[i])

                line_scores[start:end] = np.maximum(line_scores[start:end], score)
                line_hits[start:end] += 1

                if include_windows:
                    windows_out.append(
                        {
                            "window_index": chunk_start + i,
                            "start_index": start,
                            "end_index": end - 1,
                            "start_line": start + 1,
                            "end_line": end,
                            "score": score,
                            "is_anomaly": score >= threshold,
                        }
                    )

        line_flags = line_scores >= threshold
        regions_raw = _build_regions(line_flags, min_region_lines=min_region_lines)

        region_items: list[dict[str, Any]] = []
        for region in regions_raw:
            item = {
                "start_index": region.start_index,
                "end_index": region.end_index,
                "start_line": region.start_index + 1,
                "end_line": region.end_index + 1,
                "count": region.count,
                "start_timestamp": timestamps[region.start_index],
                "end_timestamp": timestamps[region.end_index],
            }
            region_items.append(item)

        rows_out: list[dict[str, Any]] = []
        if include_rows:
            for idx in range(len(rows)):
                rows_out.append(
                    {
                        "index": idx,
                        "line": idx + 1,
                        "message": messages[idx],
                        "timestamp": timestamps[idx],
                        "score": float(line_scores[idx]),
                        "votes": int(line_hits[idx]),
                        "is_anomaly": bool(line_flags[idx]),
                    }
                )

        anomaly_lines = [idx + 1 for idx, is_anomaly in enumerate(line_flags.tolist()) if is_anomaly]

        anomaly_count = int(np.sum(line_flags))
        return {
            "meta": {
                "total_rows": len(rows),
                "anomaly_rows": anomaly_count,
                "anomaly_ratio": (anomaly_count / len(rows)) if rows else 0.0,
                "threshold": threshold,
                "window_size": WINDOW_SIZE,
                "step_size": step_size,
                "min_region_lines": min_region_lines,
                "model_id": self.model_id,
            },
            "rows": rows_out if include_rows else None,
            "windows": windows_out if include_windows else None,
            "anomaly_lines": anomaly_lines,
            "anomaly_regions": region_items,
            "chart_overlays": _build_overlay_payload(region_items),
        }


class BGLAnomalyService(NeuralLogAnomalyService):
    def __init__(self) -> None:
        super().__init__(model_id="bgl")

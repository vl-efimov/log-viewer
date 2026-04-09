from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, validator

from .settings import DEFAULT_MODEL_ID, MODEL_CATALOG
from .settings import DEFAULT_MIN_REGION_LINES, DEFAULT_STEP_SIZE, DEFAULT_THRESHOLD


class PredictJsonRequest(BaseModel):
    model_id: str = DEFAULT_MODEL_ID
    rows: list[dict[str, Any]] = Field(default_factory=list)
    text_column: str | None = None
    timestamp_column: str | None = None
    threshold: float = DEFAULT_THRESHOLD
    step_size: int = DEFAULT_STEP_SIZE
    min_region_lines: int = DEFAULT_MIN_REGION_LINES
    include_rows: bool = True
    include_windows: bool = True

    @validator("threshold")
    def validate_threshold(cls, value: float) -> float:
        if value < 0.0 or value > 1.0:
            raise ValueError("threshold must be in [0, 1]")
        return value

    @validator("step_size")
    def validate_step_size(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("step_size must be positive")
        return value

    @validator("min_region_lines")
    def validate_min_region_lines(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("min_region_lines must be positive")
        return value

    @validator("model_id")
    def validate_model_id(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in MODEL_CATALOG:
            supported = ", ".join(sorted(MODEL_CATALOG.keys()))
            raise ValueError(f"model_id must be one of: {supported}")
        return normalized

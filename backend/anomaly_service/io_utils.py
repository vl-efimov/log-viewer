from __future__ import annotations

import csv
import io
import json
from pathlib import Path
from typing import Any


def _parse_json_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [dict(row) for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict) and isinstance(payload.get("rows"), list):
        return [dict(row) for row in payload["rows"] if isinstance(row, dict)]
    raise ValueError("JSON must be an array of objects or an object with a 'rows' array")


def parse_rows_from_text(text: str, source_name: str = "") -> list[dict[str, Any]]:
    suffix = Path(source_name).suffix.lower()

    if suffix == ".json":
        return _parse_json_rows(json.loads(text))

    if suffix in {".log", ".txt"}:
        return [{"message": line} for line in text.splitlines() if line.strip()]

    sample = text[:4096]
    delimiter_candidates = ",;\t|"
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=delimiter_candidates)
    except csv.Error:
        dialect = csv.excel

    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    rows = [dict(row) for row in reader]
    return rows


def parse_rows_from_bytes(data: bytes, source_name: str = "") -> list[dict[str, Any]]:
    text = data.decode("utf-8-sig", errors="replace")
    return parse_rows_from_text(text, source_name=source_name)


def load_rows_from_file(path: str) -> list[dict[str, Any]]:
    file_path = Path(path)
    raw = file_path.read_bytes()
    return parse_rows_from_bytes(raw, source_name=file_path.name)

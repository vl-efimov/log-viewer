from __future__ import annotations

import csv
import io
from pathlib import Path
from typing import Any


def parse_rows_from_text(text: str, source_name: str = "") -> list[dict[str, Any]]:
    """Parse delimited or line-based log text into row dictionaries."""
    suffix = Path(source_name).suffix.lower()

    if suffix == ".json":
        raise ValueError("JSON log files are not supported")

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
    """Decode bytes and parse the content into row dictionaries."""
    text = data.decode("utf-8-sig", errors="replace")
    return parse_rows_from_text(text, source_name=source_name)


def load_rows_from_file(path: str) -> list[dict[str, Any]]:
    """Load a file from disk and parse it into row dictionaries."""
    file_path = Path(path)
    raw = file_path.read_bytes()
    return parse_rows_from_bytes(raw, source_name=file_path.name)

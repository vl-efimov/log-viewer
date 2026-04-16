import re
import string
from datetime import datetime
from typing import Any

MESSAGE_COLUMN_CANDIDATES = (
    "message",
    "log",
    "line",
    "raw",
    "content",
    "text",
    "msg",
)

TIMESTAMP_COLUMN_CANDIDATES = (
    "timestamp",
    "datetime",
    "time",
    "date",
    "event_time",
    "created_at",
)


def clean_text(text: str) -> str:
    """Mimics NeuralLog preprocessing in data_loader.clean."""
    s = re.sub(r"\]|\[|\)|\(|\=|\,|\;", " ", text)
    s = " ".join([word.lower() if word.isupper() else word for word in s.strip().split()])
    s = re.sub(r"([A-Z][a-z]+)", r" \1", re.sub(r"([A-Z]+)", r" \1", s))
    s = " ".join([word for word in s.split() if not bool(re.search(r"\d", word))])
    trantab = str.maketrans(dict.fromkeys(list(string.punctuation)))
    content = s.translate(trantab)
    s = " ".join([word.lower().strip() for word in content.strip().split()])
    return s


def maybe_strip_bgl_label_prefix(text: str) -> str:
    """Remove the leading BGL label token when present (e.g. '-', '1', 'Anomaly')."""
    value = text.strip()
    if " " not in value:
        return value

    first, rest = value.split(" ", 1)
    token = first.strip().lower()
    if token in {"-", "+", "0", "1", "normal", "anomaly", "anomalous"}:
        return rest.strip()
    return value


def prepare_log_message(text: str) -> str:
    return clean_text(maybe_strip_bgl_label_prefix(text).lower())


def normalize_key(value: str) -> str:
    return value.strip().lower().replace(" ", "_")


def extract_message(row: dict[str, Any], forced_column: str | None = None) -> str:
    if forced_column:
        return str(row.get(forced_column, "") or "")

    normalized = {normalize_key(key): key for key in row.keys()}
    for candidate in MESSAGE_COLUMN_CANDIDATES:
        key = normalized.get(candidate)
        if key is None:
            continue
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value)

    for key in row.keys():
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            return value

    return ""


def _try_parse_datetime(value: str) -> datetime | None:
    raw = value.strip()
    if not raw:
        return None

    for candidate in (raw, raw.replace("Z", "+00:00"), raw.replace("T", " ")):
        try:
            return datetime.fromisoformat(candidate)
        except ValueError:
            pass

    patterns = (
        "%y%m%d %H%M%S,%f",
        "%y%m%d %H%M%S.%f",
        "%y%m%d %H%M%S",
        "%y%m%d",
        "%Y-%m-%d %H:%M:%S,%f",
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d-%H.%M.%S.%f",
        "%d/%b/%Y:%H:%M:%S",
        "%a %b %d %H:%M:%S %Y",
    )
    for fmt in patterns:
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def extract_timestamp_iso(row: dict[str, Any], forced_column: str | None = None) -> str | None:
    if forced_column:
        candidate = row.get(forced_column)
        if candidate is None:
            return None
        parsed = _try_parse_datetime(str(candidate))
        return parsed.isoformat() if parsed else str(candidate)

    normalized = {normalize_key(key): key for key in row.keys()}

    for candidate in TIMESTAMP_COLUMN_CANDIDATES:
        key = normalized.get(candidate)
        if key is None:
            continue
        value = row.get(key)
        if value is None:
            continue
        parsed = _try_parse_datetime(str(value))
        if parsed:
            return parsed.isoformat()

    date_key = normalized.get("date")
    time_key = normalized.get("time")
    if date_key and time_key:
        merged = f"{row.get(date_key, '')} {row.get(time_key, '')}".strip()
        ms_key = (
            normalized.get("milliseconds")
            or normalized.get("millisecond")
            or normalized.get("msec")
            or normalized.get("ms")
        )
        if ms_key:
            ms_raw = str(row.get(ms_key, "") or "").strip()
            if ms_raw:
                merged = f"{merged},{ms_raw}"
        parsed = _try_parse_datetime(merged)
        if parsed:
            return parsed.isoformat()

    return None

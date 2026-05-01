from __future__ import annotations

import codecs
import json
import os
import re
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import clickhouse_connect
from clickhouse_connect.driver.client import Client

from .preprocessing import extract_timestamp_iso, _try_parse_datetime

CLICKHOUSE_HOST = os.getenv("CLICKHOUSE_HOST", "127.0.0.1")
CLICKHOUSE_PORT = int(os.getenv("CLICKHOUSE_PORT", "8123"))
CLICKHOUSE_USER = os.getenv("CLICKHOUSE_USER", "default")
CLICKHOUSE_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "")
CLICKHOUSE_SECURE = os.getenv("CLICKHOUSE_SECURE", "false").strip().lower() in {"1", "true", "yes"}
CLICKHOUSE_DB = os.getenv("CLICKHOUSE_DB", "log_viewer")
PARSER_VERSION = "v1"

CANONICAL_FIELD_ALIASES: dict[str, str] = {
    "hostname": "host",
    "node": "host",
    "node2": "host",
    "logger": "class",
    "source": "class",
    "client": "ip",
}


@dataclass
class IngestState:
    decoder: codecs.IncrementalDecoder
    carry: str
    line_number: int
    processed_bytes: int
    file_name: str
    file_size: int
    created_at: datetime
    format_id: str | None
    parser_pattern: str | None
    parser_regex: re.Pattern[str] | None


_ingest_states: dict[str, IngestState] = {}
_ingest_lock = threading.Lock()
_client_lock = threading.Lock()
_client: Client | None = None


def _utc_now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _default_client(database: str) -> Client:
    return clickhouse_connect.get_client(
        host=CLICKHOUSE_HOST,
        port=CLICKHOUSE_PORT,
        username=CLICKHOUSE_USER,
        password=CLICKHOUSE_PASSWORD,
        secure=CLICKHOUSE_SECURE,
        database=database,
    )


def _get_client() -> Client:
    global _client
    with _client_lock:
        if _client is None:
            _client = _default_client(CLICKHOUSE_DB)
        return _client


def _insert_ingest_snapshot(
    ingest_id: str,
    state: IngestState,
    status: str,
) -> None:
    client = _get_client()
    version_ts = _utc_now()
    client.insert(
        "ingest_batches",
        [[
            ingest_id,
            state.file_name,
            int(state.file_size),
            state.created_at,
            status,
            int(state.line_number),
            int(state.processed_bytes),
            PARSER_VERSION,
            version_ts,
        ]],
        column_names=[
            "ingest_id",
            "file_name",
            "file_size",
            "created_at",
            "status",
            "total_lines",
            "processed_bytes",
            "parser_version",
            "version_ts",
        ],
    )


def init_db() -> None:
    max_wait_s = float(os.getenv("CLICKHOUSE_INIT_MAX_WAIT_S", "30") or "30")
    started_at = time.time()

    while True:
        try:
            admin = _default_client("default")
            admin.command(f"CREATE DATABASE IF NOT EXISTS {CLICKHOUSE_DB}")

            client = _get_client()
            client.command(
                """
                CREATE TABLE IF NOT EXISTS ingest_batches (
                    ingest_id String,
                    file_name String,
                    file_size UInt64,
                    created_at DateTime64(3, 'UTC'),
                    status LowCardinality(String),
                    total_lines UInt64,
                    processed_bytes UInt64,
                    parser_version String,
                    version_ts DateTime64(3, 'UTC')
                )
                ENGINE = MergeTree
                ORDER BY (ingest_id, version_ts)
                """
            )
            client.command(
                """
                CREATE TABLE IF NOT EXISTS log_events (
                    ingest_id String,
                    line_number UInt64,
                    raw String,
                    message String,
                    timestamp_iso Nullable(String),
                    timestamp_ms Nullable(Int64),
                    level Nullable(String),
                    status Nullable(String),
                    method Nullable(String),
                    fields_json String
                )
                ENGINE = MergeTree
                ORDER BY (ingest_id, line_number)
                """
            )
            return
        except Exception as exc:  # pragma: no cover
            elapsed = time.time() - started_at
            if elapsed >= max_wait_s:
                raise
            time.sleep(min(1.0, max_wait_s - elapsed))


def _extract_fields(raw: str) -> tuple[str | None, str | None, str | None, dict[str, str]]:
    fields: dict[str, str] = {}

    for key, value in re.findall(r"([A-Za-z_][A-Za-z0-9_.-]{1,40})=([^\s]+)", raw):
        fields[key.lower()] = value.strip().strip('"')

    upper = raw.upper()
    level: str | None = fields.get("level")
    if not level:
        for candidate in ("TRACE", "DEBUG", "INFO", "WARN", "WARNING", "ERROR", "FATAL", "CRITICAL"):
            if f" {candidate} " in f" {upper} ":
                level = candidate
                break

    status: str | None = fields.get("status")
    if not status:
        match = re.search(r"\b([1-5]\d\d)\b", raw)
        if match:
            status = match.group(1)

    method: str | None = fields.get("method")
    if not method:
        match = re.search(r"\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b", upper)
        if match:
            method = match.group(1)

    if level:
        fields.setdefault("level", level)
    if status:
        fields.setdefault("status", status)
    if method:
        fields.setdefault("method", method)

    _apply_canonical_field_aliases(fields)

    return level, status, method, fields


def _apply_canonical_field_aliases(fields: dict[str, str]) -> dict[str, str]:
    for alias, canonical in CANONICAL_FIELD_ALIASES.items():
        existing = fields.get(canonical)
        if existing is not None and str(existing).strip():
            continue

        alias_value = fields.get(alias)
        if alias_value is None:
            continue

        alias_text = str(alias_value).strip()
        if not alias_text:
            continue

        fields[canonical] = alias_text

    return fields


def _compile_parser_regex(parser_pattern: str | None) -> re.Pattern[str] | None:
    if not parser_pattern:
        return None
    # Frontend stores named groups in JS syntax (?<name>...), convert to Python syntax.
    pattern_source = re.sub(r"\(\?<([A-Za-z_][A-Za-z0-9_]*)>", r"(?P<\1>", parser_pattern)
    try:
        return re.compile(pattern_source)
    except re.error as exc:
        raise ValueError(f"Invalid parser_pattern: {exc}") from exc


def _to_timestamp_ms(timestamp_iso: str | None) -> int | None:
    if not timestamp_iso:
        return None

    parsed = _try_parse_datetime(timestamp_iso)
    if parsed is not None:
        try:
            return int(parsed.timestamp() * 1000)
        except Exception:
            return None

    try:
        timestamp = datetime.fromisoformat(timestamp_iso.replace("Z", "+00:00"))
        return int(timestamp.timestamp() * 1000)
    except Exception:
        return None


def _line_to_event_from_regex(
    ingest_id: str,
    line_number: int,
    raw: str,
    parser_regex: re.Pattern[str],
) -> tuple[Any, ...]:
    match = parser_regex.match(raw)
    extracted: dict[str, str] = {}
    if match and match.groupdict():
        extracted = {
            str(key).strip().lower(): str(value).strip()
            for key, value in match.groupdict().items()
            if value is not None and str(value).strip()
        }
        _apply_canonical_field_aliases(extracted)

    message = extracted.get("message") or raw
    timestamp_iso = extract_timestamp_iso(extracted)
    timestamp_ms = _to_timestamp_ms(timestamp_iso)
    level = extracted.get("level")
    status = extracted.get("status")
    method = extracted.get("method")

    return (
        ingest_id,
        line_number,
        raw,
        message,
        timestamp_iso,
        timestamp_ms,
        level,
        status,
        method,
        json.dumps(extracted, ensure_ascii=True),
    )


def _line_to_event_from_heuristic(ingest_id: str, line_number: int, raw: str) -> tuple[Any, ...]:
    level, status, method, fields = _extract_fields(raw)
    message = raw
    row = {"message": message, **fields}
    timestamp_iso = extract_timestamp_iso(row)
    timestamp_ms = _to_timestamp_ms(timestamp_iso)

    return (
        ingest_id,
        line_number,
        raw,
        message,
        timestamp_iso,
        timestamp_ms,
        level,
        status,
        method,
        json.dumps(fields, ensure_ascii=True),
    )


def _line_to_event(
    ingest_id: str,
    line_number: int,
    raw: str,
    parser_regex: re.Pattern[str] | None,
) -> tuple[Any, ...]:
    if parser_regex is not None:
        return _line_to_event_from_regex(ingest_id, line_number, raw, parser_regex)
    return _line_to_event_from_heuristic(ingest_id, line_number, raw)


def create_ingest(
    file_name: str,
    file_size: int,
    format_id: str | None = None,
    parser_pattern: str | None = None,
) -> str:
    ingest_id = str(uuid.uuid4())
    created_at = _utc_now()
    normalized_format_id = format_id.strip() if format_id and format_id.strip() else None
    normalized_parser_pattern = parser_pattern.strip() if parser_pattern and parser_pattern.strip() else None
    compiled_regex = _compile_parser_regex(normalized_parser_pattern)

    state = IngestState(
        decoder=codecs.getincrementaldecoder("utf-8")("replace"),
        carry="",
        line_number=0,
        processed_bytes=0,
        file_name=file_name,
        file_size=int(file_size),
        created_at=created_at,
        format_id=normalized_format_id,
        parser_pattern=normalized_parser_pattern,
        parser_regex=compiled_regex,
    )
    _insert_ingest_snapshot(ingest_id=ingest_id, state=state, status="uploading")

    with _ingest_lock:
        _ingest_states[ingest_id] = state

    return ingest_id


def _insert_lines(
    ingest_id: str,
    lines: list[str],
    start_line_number: int,
    parser_regex: re.Pattern[str] | None,
) -> int:
    if not lines:
        return 0

    payload = [
        _line_to_event(ingest_id, start_line_number + idx + 1, raw=line, parser_regex=parser_regex)
        for idx, line in enumerate(lines)
    ]
    _get_client().insert(
        "log_events",
        payload,
        column_names=[
            "ingest_id",
            "line_number",
            "raw",
            "message",
            "timestamp_iso",
            "timestamp_ms",
            "level",
            "status",
            "method",
            "fields_json",
        ],
    )
    return len(lines)


def append_chunk(ingest_id: str, chunk: bytes) -> dict[str, Any]:
    with _ingest_lock:
        state = _ingest_states.get(ingest_id)
    if state is None:
        raise ValueError("Unknown ingest_id or ingest already finished")

    text = state.decoder.decode(chunk, final=False)
    combined = state.carry + text
    parts = combined.split("\n")
    state.carry = parts.pop() if parts else ""
    lines = [line.rstrip("\r") for line in parts if line]

    inserted = _insert_lines(ingest_id, lines, state.line_number, state.parser_regex)
    state.line_number += inserted
    state.processed_bytes += len(chunk)
    _insert_ingest_snapshot(ingest_id=ingest_id, state=state, status="uploading")

    return {
        "ingest_id": ingest_id,
        "total_lines": state.line_number,
        "processed_bytes": state.processed_bytes,
    }


def finish_ingest(ingest_id: str) -> dict[str, Any]:
    with _ingest_lock:
        state = _ingest_states.get(ingest_id)
    if state is None:
        row = get_ingest(ingest_id)
        if row is None:
            raise ValueError("Unknown ingest_id")
        return row

    trailing = state.decoder.decode(b"", final=True)
    final_line = (state.carry + trailing).rstrip("\r")
    lines = [final_line] if final_line else []

    inserted = _insert_lines(ingest_id, lines, state.line_number, state.parser_regex)
    state.line_number += inserted
    _insert_ingest_snapshot(ingest_id=ingest_id, state=state, status="ready")

    with _ingest_lock:
        _ingest_states.pop(ingest_id, None)

    return get_ingest(ingest_id) or {
        "ingest_id": ingest_id,
        "status": "ready",
        "total_lines": state.line_number,
    }


def get_ingest(ingest_id: str) -> dict[str, Any] | None:
    row = _get_client().query(
        """
        SELECT
            ingest_id,
            argMax(file_name, version_ts) AS file_name,
            argMax(file_size, version_ts) AS file_size,
            min(created_at) AS created_at,
            argMax(status, version_ts) AS status,
            argMax(total_lines, version_ts) AS total_lines,
            argMax(processed_bytes, version_ts) AS processed_bytes,
            argMax(parser_version, version_ts) AS parser_version
        FROM ingest_batches
        WHERE ingest_id = {ingest_id:String}
        GROUP BY ingest_id
        """,
        parameters={"ingest_id": ingest_id},
    ).first_row

    if row is None:
        return None

    created_at = row[3]
    created_ts = created_at.timestamp() if isinstance(created_at, datetime) else float(time.time())

    return {
        "ingest_id": str(row[0]),
        "file_name": str(row[1]),
        "file_size": int(row[2]),
        "created_at": created_ts,
        "status": str(row[4]),
        "total_lines": int(row[5]),
        "processed_bytes": int(row[6]),
        "parser_version": str(row[7]),
    }


def get_line_count(ingest_id: str) -> int:
    row = _get_client().query(
        """
        SELECT uniqExact(line_number)
        FROM log_events
        WHERE ingest_id = {ingest_id:String}
        """,
        parameters={"ingest_id": ingest_id},
    ).first_row
    return int(row[0]) if row else 0


def get_lines_range(ingest_id: str, start_line: int, end_line: int) -> list[dict[str, Any]]:
    rows = _get_client().query(
        """
                SELECT line_number, any(raw) AS raw
        FROM log_events
        WHERE ingest_id = {ingest_id:String}
          AND line_number BETWEEN {start_line:UInt64} AND {end_line:UInt64}
                GROUP BY line_number
        ORDER BY line_number ASC
        """,
        parameters={
            "ingest_id": ingest_id,
            "start_line": int(start_line),
            "end_line": int(end_line),
        },
    ).result_rows

    return [{"lineNumber": int(row[0]), "raw": str(row[1])} for row in rows]


def _parse_filter_payload(filters: dict[str, Any]) -> tuple[str | None, list[str] | None, list[str] | None, int | None, int | None]:
    message_q: str | None = None
    levels: list[str] | None = None
    methods: list[str] | None = None
    start_ms: int | None = None
    end_ms: int | None = None

    for key, value in filters.items():
        if not value:
            continue
        if isinstance(value, list) and value:
            if key == "level":
                normalized = [str(item).strip().upper() for item in value if str(item).strip()]
                levels = list(dict.fromkeys(normalized)) or None
            elif key == "method":
                normalized = [str(item).strip().upper() for item in value if str(item).strip()]
                methods = list(dict.fromkeys(normalized)) or None
        elif isinstance(value, dict):
            if "value" in value and value.get("value"):
                if key in {"message", "raw", "content", "text"}:
                    message_q = str(value["value"])
            if "start" in value or "end" in value:
                from datetime import datetime

                if value.get("start"):
                    try:
                        start_ms = int(datetime.fromisoformat(str(value["start"])).timestamp() * 1000)
                    except Exception:
                        start_ms = None
                if value.get("end"):
                    try:
                        end_ms = int(datetime.fromisoformat(str(value["end"])).timestamp() * 1000)
                    except Exception:
                        end_ms = None

    return message_q, levels, methods, start_ms, end_ms


def _hdfs_time_key_from_ms(value_ms: int) -> str:
    dt = datetime.fromtimestamp(value_ms / 1000)
    return dt.strftime("%y%m%d%H%M%S")


def _append_time_filters(
    where: list[str],
    params: dict[str, Any],
    start_ms: int | None,
    end_ms: int | None,
) -> None:
    hdfs_date_expr = "ifNull(JSONExtractString(fields_json, 'date'), '')"
    hdfs_time_expr = "ifNull(JSONExtractString(fields_json, 'time'), '')"
    hdfs_key_expr = f"concat({hdfs_date_expr}, substring({hdfs_time_expr}, 1, 6))"

    if start_ms is not None:
        params["start_ms"] = int(start_ms)
        params["start_hdfs_key"] = _hdfs_time_key_from_ms(int(start_ms))
        where.append(
            "(" 
            "ifNull(timestamp_ms, -9223372036854775808) >= {start_ms:Int64} "
            "OR (timestamp_ms IS NULL "
            f"AND length({hdfs_date_expr}) = 6 "
            f"AND length({hdfs_time_expr}) >= 6 "
            f"AND {hdfs_key_expr} >= {{start_hdfs_key:String}})"
            ")"
        )

    if end_ms is not None:
        params["end_ms"] = int(end_ms)
        params["end_hdfs_key"] = _hdfs_time_key_from_ms(int(end_ms))
        where.append(
            "(" 
            "ifNull(timestamp_ms, 9223372036854775807) <= {end_ms:Int64} "
            "OR (timestamp_ms IS NULL "
            f"AND length({hdfs_date_expr}) = 6 "
            f"AND length({hdfs_time_expr}) >= 6 "
            f"AND {hdfs_key_expr} <= {{end_hdfs_key:String}})"
            ")"
        )


def query_filtered_lines(
    ingest_id: str,
    filters: dict[str, Any],
    limit: int,
    after_line: int | None = None,
    before_line: int | None = None,
    order: str = "asc",
) -> dict[str, Any]:
    message_q, levels, methods, start_ms, end_ms = _parse_filter_payload(filters)
    direction = "desc" if str(order).strip().lower() == "desc" else "asc"

    where = ["ingest_id = {ingest_id:String}"]
    params: dict[str, Any] = {"ingest_id": ingest_id}

    if message_q:
        where.append("positionCaseInsensitiveUTF8(raw, {message_q:String}) > 0")
        params["message_q"] = message_q
    if levels:
        where.append("upper(ifNull(level, '')) IN {levels:Array(String)}")
        params["levels"] = levels
    if methods:
        where.append("upper(ifNull(method, '')) IN {methods:Array(String)}")
        params["methods"] = methods
    _append_time_filters(where, params, start_ms, end_ms)
    if direction == "asc" and after_line is not None and int(after_line) > 0:
        where.append("line_number > {after_line:UInt64}")
        params["after_line"] = int(after_line)
    if direction == "desc" and before_line is not None and int(before_line) > 0:
        where.append("line_number < {before_line:UInt64}")
        params["before_line"] = int(before_line)

    where_sql = " AND ".join(where)
    safe_limit = max(1, int(limit))
    query_limit = safe_limit + 1
    params_with_limit = {**params, "limit": query_limit}

    rows = _get_client().query(
        f"""
        SELECT line_number, raw
        FROM log_events
        WHERE {where_sql}
        ORDER BY line_number {"DESC" if direction == "desc" else "ASC"}
        LIMIT {{limit:UInt64}}
        """,
        parameters=params_with_limit,
    ).result_rows

    has_more = len(rows) > safe_limit
    page_rows = rows[:safe_limit]
    lines = [{"lineNumber": int(row[0]), "raw": str(row[1])} for row in page_rows]

    return {
        # Exact total per-page is expensive on huge datasets; keep this as page size hint.
        "totalMatches": len(lines),
        "lines": lines,
        "nextAfterLine": lines[-1]["lineNumber"] if lines and direction == "asc" else None,
        "nextBeforeLine": lines[-1]["lineNumber"] if lines and direction == "desc" else None,
        "hasMore": has_more,
    }


def _dashboard_field_value_expr(field: str) -> str:
    if field in {"level", "status", "method"}:
        return (
            f"trim(BOTH ' ' FROM if(ifNull({field}, '') != '', "
            f"ifNull({field}, ''), ifNull(JSONExtractString(fields_json, '{field}'), '')))"
        )
    return "trim(BOTH ' ' FROM ifNull(JSONExtractString(fields_json, {field:String}), ''))"


def _build_dashboard_where_clause(
    ingest_id: str,
    start_ms: int | None = None,
    end_ms: int | None = None,
    category_field: str | None = None,
    category_values: list[str] | None = None,
) -> tuple[str, dict[str, Any]]:
    where = ["ingest_id = {ingest_id:String}"]
    params: dict[str, Any] = {"ingest_id": ingest_id}
    _append_time_filters(where, params, start_ms, end_ms)

    normalized_field = (category_field or "").strip()
    normalized_values = list(
        dict.fromkeys(
            str(value).strip().upper()
            for value in (category_values or [])
            if str(value).strip()
        )
    )

    if normalized_field and normalized_values:
        if normalized_field in {"level", "status", "method"}:
            category_expr = _dashboard_field_value_expr(normalized_field)
        else:
            category_expr = "trim(BOTH ' ' FROM ifNull(JSONExtractString(fields_json, {category_field:String}), ''))"
            params["category_field"] = normalized_field

        where.append(
            f"upper(if({category_expr} = '', 'UNKNOWN', {category_expr})) "
            "IN {category_values:Array(String)}"
        )
        params["category_values"] = normalized_values

    return " AND ".join(where), params


def build_dashboard_exact_snapshot(
    ingest_id: str,
    start_ms: int | None = None,
    end_ms: int | None = None,
    category_field: str | None = None,
    category_values: list[str] | None = None,
) -> dict[str, Any]:
    client = _default_client(CLICKHOUSE_DB)
    where_sql, params = _build_dashboard_where_clause(
        ingest_id=ingest_id,
        start_ms=start_ms,
        end_ms=end_ms,
        category_field=category_field,
        category_values=category_values,
    )

    totals_row = client.query(
        f"""
        SELECT
            COUNT(*) AS total_lines,
            COUNTIf(length(trim(raw)) > 0) AS non_empty_lines,
            COUNTIf(lengthUTF8(fields_json) > 2) AS parsed_lines
        FROM log_events
        WHERE {where_sql}
        """,
        parameters=params,
    ).first_row

    total_lines = int(totals_row[0]) if totals_row else 0
    non_empty_lines = int(totals_row[1]) if totals_row else 0
    parsed_lines = int(totals_row[2]) if totals_row else 0

    priority_fields = [
        "level",
        "status",
        "method",
        "queue",
        "type",
        "component",
        "host",
        "user",
        "class",
        "ip",
        "date",
        "time",
    ]
    field_value_counts: dict[str, dict[str, int]] = {}

    for field in priority_fields:
        value_expr = _dashboard_field_value_expr(field)
        query_params = dict(params)
        if "{field:String}" in value_expr:
            query_params["field"] = field

        rows = client.query(
            f"""
            SELECT value, COUNT(*) AS cnt
            FROM (
                SELECT {value_expr} AS value
                FROM log_events
                WHERE {where_sql}
            )
            WHERE value != ''
              AND lowerUTF8(value) NOT IN ('null', 'undefined')
              AND value != '-'
            GROUP BY value
            ORDER BY cnt DESC
            LIMIT 500
            """,
            parameters=query_params,
        ).result_rows

        if not rows:
            continue

        field_value_counts[field] = {
            str(row[0]): int(row[1])
            for row in rows
            if row[0] is not None and str(row[0]).strip() != ""
        }

    return {
        "sessionId": f"remote:{ingest_id}",
        "kind": "dashboard-filtered",
        "updatedAt": int(time.time() * 1000),
        "stats": {
            "totalLines": total_lines,
            "nonEmptyLines": non_empty_lines,
            "parsedLines": parsed_lines,
            "fieldValueCounts": field_value_counts,
        },
    }


def build_dashboard_snapshot(ingest_id: str, sample_limit: int = 2000) -> dict[str, Any]:
    client = _default_client(CLICKHOUSE_DB)

    total_row = client.query(
        "SELECT COUNT(*) FROM log_events WHERE ingest_id = {ingest_id:String}",
        parameters={"ingest_id": ingest_id},
    ).first_row
    total_lines = int(total_row[0]) if total_row else 0

    non_empty_row = client.query(
        """
        SELECT COUNT(*)
        FROM log_events
        WHERE ingest_id = {ingest_id:String}
          AND length(trim(raw)) > 0
        """,
        parameters={"ingest_id": ingest_id},
    ).first_row
    non_empty_lines = int(non_empty_row[0]) if non_empty_row else 0

    parsed_row = client.query(
        """
        SELECT COUNT(*)
        FROM log_events
        WHERE ingest_id = {ingest_id:String}
          AND lengthUTF8(fields_json) > 2
        """,
        parameters={"ingest_id": ingest_id},
    ).first_row
    parsed_lines = int(parsed_row[0]) if parsed_row else 0

    priority_fields = [
        "level",
        "status",
        "method",
        "queue",
        "type",
        "component",
        "host",
        "user",
        "class",
        "ip",
        "date",
        "time",
    ]
    field_value_counts: dict[str, dict[str, int]] = {}

    for field in priority_fields:
        rows = client.query(
            """
            SELECT value, COUNT(*) AS cnt
            FROM (
                SELECT trim(BOTH ' ' FROM ifNull(JSONExtractString(fields_json, {field:String}), '')) AS value
                FROM log_events
                WHERE ingest_id = {ingest_id:String}
            )
            WHERE value != ''
              AND lowerUTF8(value) NOT IN ('null', 'undefined')
              AND value != '-'
            GROUP BY value
            ORDER BY cnt DESC
            LIMIT 500
            """,
            parameters={
                "ingest_id": ingest_id,
                "field": field,
            },
        ).result_rows

        if not rows:
            continue

        field_value_counts[field] = {
            str(row[0]): int(row[1])
            for row in rows
            if row[0] is not None and str(row[0]).strip() != ""
        }

    stride = max(1, total_lines // max(1, sample_limit))
    sampled = client.query(
        """
                SELECT line_number, raw, timestamp_iso, fields_json, level, status, method
        FROM log_events
        WHERE ingest_id = {ingest_id:String}
          AND modulo(line_number - 1, {stride:UInt64}) = 0
        ORDER BY line_number ASC
        LIMIT {sample_limit:UInt64}
        """,
        parameters={
            "ingest_id": ingest_id,
            "stride": int(stride),
            "sample_limit": int(sample_limit),
        },
    ).result_rows

    sampled_lines: list[dict[str, Any]] = []
    for row in sampled:
        raw = str(row[1])
        fields: dict[str, str] = {}

        raw_fields = row[3]
        if isinstance(raw_fields, str) and raw_fields:
            try:
                parsed_fields = json.loads(raw_fields)
                if isinstance(parsed_fields, dict):
                    for key, value in parsed_fields.items():
                        if value is None:
                            continue
                        text = str(value).strip()
                        if text:
                            fields[str(key)] = text
            except Exception:
                pass

        for value, name in ((row[4], "level"), (row[5], "status"), (row[6], "method")):
            if value is None:
                continue
            text = str(value).strip()
            if text and name not in fields:
                fields[name] = text

        if row[2] is not None:
            timestamp_text = str(row[2]).strip()
            if timestamp_text and "timestamp" not in fields and "datetime" not in fields:
                fields["timestamp"] = timestamp_text

        sampled_lines.append(
            {
                "lineNumber": int(row[0]),
                "raw": raw,
                "parsed": {
                    "formatId": "remote-dashboard",
                    "fields": fields,
                    "raw": raw,
                },
            }
        )

    return {
        "sessionId": f"remote:{ingest_id}",
        "kind": "dashboard",
        "updatedAt": int(time.time() * 1000),
        "sampledLines": sampled_lines,
        "stats": {
            "totalLines": total_lines,
            "nonEmptyLines": non_empty_lines,
            "parsedLines": parsed_lines,
            "fieldValueCounts": field_value_counts,
        },
    }


def get_rows_for_anomaly(ingest_id: str) -> list[dict[str, Any]]:
    rows = _get_client().query(
        """
        SELECT
            any(message) AS message,
            any(timestamp_iso) AS timestamp_iso
        FROM log_events
        WHERE ingest_id = {ingest_id:String}
        GROUP BY line_number
        ORDER BY line_number ASC
        """,
        parameters={"ingest_id": ingest_id},
    ).result_rows

    return [
        {
            "message": str(row[0]),
            "timestamp": row[1],
        }
        for row in rows
    ]


def delete_ingest(ingest_id: str) -> None:
    client = _get_client()
    # ClickHouse performs table deletes asynchronously; this is expected for MergeTree tables.
    client.command(
        "ALTER TABLE log_events DELETE WHERE ingest_id = {ingest_id:String}",
        parameters={"ingest_id": ingest_id},
    )
    client.command(
        "ALTER TABLE ingest_batches DELETE WHERE ingest_id = {ingest_id:String}",
        parameters={"ingest_id": ingest_id},
    )

    with _ingest_lock:
        _ingest_states.pop(ingest_id, None)

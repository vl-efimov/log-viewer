from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from common import (
    ApiClient,
    DEFAULT_BACKEND_CONFIG_PATH,
    TestFailure,
    count_non_empty_lines,
    ensure_reports_dir,
    load_datasets,
    normalize_selected_names,
    pick_probe_token,
    timed_call,
    write_json_report,
)


# Configure command-line arguments for functional tests.
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run backend functional tests for large-file workflows.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8001", help="Backend base URL")
    parser.add_argument("--config", type=Path, default=DEFAULT_BACKEND_CONFIG_PATH, help="Path to backend dataset config JSON")
    parser.add_argument("--dataset", action="append", default=[], help="Run only selected dataset names")
    parser.add_argument(
        "--output",
        type=Path,
        default=ensure_reports_dir() / "functional-report.json",
        help="Where to store the JSON report",
    )
    return parser


# Run functional checks for one dataset.
def run_dataset(client: ApiClient, dataset_name: str, dataset: Any, index: int, total: int) -> dict[str, Any]:

    print(f"[DATASET {index}/{total}] functional -> {dataset_name}")
    result: dict[str, Any] = {
        "dataset": dataset_name,
        "file": str(dataset.file_path),
        "format_id": dataset.format_id,
        "parser_pattern": dataset.parser_pattern,
    }
    ingest_id: str | None = None

    try:
        print(f"  [functional] counting source lines: {dataset.file_path.name}")
        expected_line_count = count_non_empty_lines(dataset.file_path)
        print("  [functional] upload and ingest")
        (upload_result, upload_ms) = timed_call(lambda: client.upload_file(dataset))
        ingest_id, finish_payload = upload_result
        result["upload_ms"] = round(upload_ms, 3)
        result["finish_status"] = finish_payload.get("status")
        result["ingest_id"] = ingest_id

        print("  [functional] backend line count")
        line_count = client.get_line_count(ingest_id)
        # Comparing the backend count with the local file count catches parsing or
        # ingest truncation issues before the later dashboard checks would mask them.
        if line_count != expected_line_count:
            raise TestFailure(
                f"Expected {expected_line_count} non-empty lines for {dataset.name}, got {line_count}"
            )
        result["line_count"] = line_count

        print("  [functional] preview lines")
        lines = client.get_lines(ingest_id, 1, min(5, line_count))
        if not lines:
            raise TestFailure(f"No lines returned for dataset {dataset.name}")
        result["preview_lines"] = len(lines)

        token = pick_probe_token([str(item.get("raw", "")) for item in lines])
        if not token:
            raise TestFailure(f"Unable to extract a probe token from dataset {dataset.name}")

        # The filter assertion probes one token from real returned lines instead of
        # relying on hard-coded fixture text, so the same test works for custom data.
        print("  [functional] filter check")
        filtered = client.filter_lines(ingest_id, {"message": {"value": token}}, limit=10)
        total_matches = int(filtered.get("totalMatches", 0))
        if total_matches <= 0:
            raise TestFailure(f"Message filter returned no results for probe token '{token}'")
        result["filter_probe_token"] = token
        result["filter_total_matches"] = total_matches

        print("  [functional] dashboard snapshot")
        dashboard = client.dashboard(ingest_id)
        snapshot = dashboard.get("snapshot")
        if not isinstance(snapshot, dict) or not snapshot:
            raise TestFailure(f"Dashboard snapshot is empty for dataset {dataset.name}")
        result["dashboard_keys"] = sorted(snapshot.keys())

        print("  [functional] exact dashboard snapshot")
        exact_dashboard = client.dashboard_exact(ingest_id)
        exact_snapshot = exact_dashboard.get("snapshot")
        if not isinstance(exact_snapshot, dict) or not exact_snapshot:
            raise TestFailure(f"Exact dashboard snapshot is empty for dataset {dataset.name}")
        result["exact_dashboard_keys"] = sorted(exact_snapshot.keys())
        result["status"] = "passed"
        print(f"  [functional] completed: {dataset_name}")
        return result
    except Exception as exc:
        result["status"] = "failed"
        result["error"] = str(exc)
        print(f"  [functional] failed: {dataset_name} -> {exc}")
        return result
    finally:
        if ingest_id:
            try:
                client.delete_ingest(ingest_id)
            except Exception:
                pass


# Run functional tests for selected datasets and save the JSON report.
def main() -> int:

    args = build_parser().parse_args()
    selected_names = normalize_selected_names(args.dataset)
    datasets = load_datasets(args.config, selected_names)
    client = ApiClient(args.base_url)

    print("[INFO] functional tests started")
    print(f"[INFO] datasets selected: {len(datasets)}")

    suite_report: dict[str, Any] = {
        "suite": "backend-functional",
        "base_url": args.base_url,
        "health": client.health(),
        "models": client.models_status(),
        "datasets": [],
    }

    failed = 0
    for index, dataset in enumerate(datasets, start=1):
        dataset_report = run_dataset(client, dataset.name, dataset, index, len(datasets))
        suite_report["datasets"].append(dataset_report)
        if dataset_report.get("status") != "passed":
            failed += 1

    suite_report["summary"] = {
        "total": len(datasets),
        "passed": len(datasets) - failed,
        "failed": failed,
    }
    print(f"[INFO] writing functional report -> {args.output}")
    write_json_report(args.output, suite_report)
    print(f"[INFO] functional tests finished: passed={len(datasets) - failed}, failed={failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from common import (
    ApiClient,
    DEFAULT_BACKEND_CONFIG_PATH,
    ensure_reports_dir,
    load_datasets,
    normalize_selected_names,
    pick_probe_token,
    summarize_latencies,
    timed_call,
    write_json_report,
)


# Configure command-line arguments for performance tests.
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Measure backend performance for large-file workflows.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8001", help="Backend base URL")
    parser.add_argument("--config", type=Path, default=DEFAULT_BACKEND_CONFIG_PATH, help="Path to backend dataset config JSON")
    parser.add_argument("--dataset", action="append", default=[], help="Run only selected dataset names")
    parser.add_argument(
        "--output",
        type=Path,
        default=ensure_reports_dir() / "performance-report.json",
        help="Where to store the JSON report",
    )
    return parser


# Measure core backend operations and save them into a JSON report.
def main() -> int:

    args = build_parser().parse_args()
    selected_names = normalize_selected_names(args.dataset)
    datasets = load_datasets(args.config, selected_names)
    client = ApiClient(args.base_url)

    print("[INFO] performance tests started")
    print(f"[INFO] datasets selected: {len(datasets)}")

    report: dict[str, Any] = {
        "suite": "backend-performance",
        "base_url": args.base_url,
        "datasets": [],
    }

    ingest_samples: list[float] = []
    dashboard_samples: list[float] = []
    exact_dashboard_samples: list[float] = []
    filter_samples: list[float] = []

    for index, dataset in enumerate(datasets, start=1):
        print(f"[DATASET {index}/{len(datasets)}] performance -> {dataset.name}")
        dataset_report: dict[str, Any] = {
            "dataset": dataset.name,
            "file": str(dataset.file_path),
        }
        ingest_id: str | None = None
        try:
            print("  [performance] upload and ingest timing")
            (upload_result, ingest_ms) = timed_call(lambda: client.upload_file(dataset))
            ingest_id, _finish = upload_result
            print("  [performance] line count timing")
            line_count, line_count_ms = timed_call(lambda: client.get_line_count(ingest_id))
            preview_lines = client.get_lines(ingest_id, 1, min(5, line_count))
            probe_token = pick_probe_token([str(item.get("raw", "")) for item in preview_lines])
            if not probe_token:
                raise RuntimeError(f"Unable to pick probe token for {dataset.name}")
            print("  [performance] dashboard timing")
            (_dashboard, dashboard_ms) = timed_call(lambda: client.dashboard(ingest_id))
            print("  [performance] exact dashboard timing")
            (_exact_dashboard, exact_dashboard_ms) = timed_call(lambda: client.dashboard_exact(ingest_id))
            print("  [performance] filter timing")
            (_filtered, filter_ms) = timed_call(
                lambda: client.filter_lines(ingest_id, {"message": {"value": probe_token}}, limit=50)
            )

            ingest_samples.append(ingest_ms)
            dashboard_samples.append(dashboard_ms)
            exact_dashboard_samples.append(exact_dashboard_ms)
            filter_samples.append(filter_ms)

            dataset_report.update(
                {
                    "status": "completed",
                    "line_count": line_count,
                    "timings_ms": {
                        "ingest": round(ingest_ms, 3),
                        "line_count": round(line_count_ms, 3),
                        "dashboard": round(dashboard_ms, 3),
                        "dashboard_exact": round(exact_dashboard_ms, 3),
                        "filter_message": round(filter_ms, 3),
                    },
                    # Normalized timings make the large datasets comparable despite
                    # different file sizes and line counts.
                    "normalized_ms_per_1000_lines": {
                        "ingest": round((ingest_ms / max(line_count, 1)) * 1000.0, 3),
                        "dashboard": round((dashboard_ms / max(line_count, 1)) * 1000.0, 3),
                        "dashboard_exact": round((exact_dashboard_ms / max(line_count, 1)) * 1000.0, 3),
                        "filter_message": round((filter_ms / max(line_count, 1)) * 1000.0, 3),
                    },
                }
            )
            print(f"  [performance] completed: {dataset.name}")
        except Exception as exc:
            dataset_report.update({
                "status": "failed",
                "error": str(exc),
            })
            print(f"  [performance] failed: {dataset.name} -> {exc}")
        finally:
            if ingest_id:
                try:
                    client.delete_ingest(ingest_id)
                except Exception:
                    pass

        report["datasets"].append(dataset_report)

    report["summary"] = {
        "ingest": summarize_latencies(ingest_samples),
        "dashboard": summarize_latencies(dashboard_samples),
        "dashboard_exact": summarize_latencies(exact_dashboard_samples),
        "filter_message": summarize_latencies(filter_samples),
    }
    print(f"[INFO] writing performance report -> {args.output}")
    write_json_report(args.output, report)
    print("[INFO] performance tests finished")
    return 0


if __name__ == "__main__":
    sys.exit(main())
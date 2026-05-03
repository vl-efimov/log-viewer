from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from common import (
    ApiClient,
    DEFAULT_ANOMALY_CONFIG_PATH,
    ensure_reports_dir,
    extract_predicted_lines,
    load_datasets,
    normalize_selected_names,
    timed_call,
    write_json_report,
)


# Configure command-line arguments for the anomaly integration test.
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate backend anomaly detection integration.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8001", help="Backend base URL")
    parser.add_argument("--config", type=Path, default=DEFAULT_ANOMALY_CONFIG_PATH, help="Path to anomaly dataset config JSON")
    parser.add_argument("--dataset", action="append", default=[], help="Run only selected dataset names")
    parser.add_argument("--threshold", type=float, default=0.6, help="Prediction threshold")
    parser.add_argument("--step-size", type=int, default=20, help="Sliding window step size")
    parser.add_argument("--min-region-lines", type=int, default=1, help="Minimum anomaly region size")
    parser.add_argument("--warmup", action="store_true", help="Warm up the model before running the first prediction")
    parser.add_argument(
        "--output",
        type=Path,
        default=ensure_reports_dir() / "anomaly-report.json",
        help="Where to store the JSON report",
    )
    return parser


# Run anomaly integration checks and save the JSON report.
def main() -> int:

    args = build_parser().parse_args()
    selected_names = normalize_selected_names(args.dataset)
    datasets = [item for item in load_datasets(args.config, selected_names) if item.model_id]
    client = ApiClient(args.base_url, timeout_s=300.0)

    print("[INFO] anomaly integration started")
    print(f"[INFO] datasets selected: {len(datasets)}")

    warmed_up_models: set[str] = set()
    report: dict[str, Any] = {
        "suite": "backend-anomaly",
        "base_url": args.base_url,
        "threshold": args.threshold,
        "step_size": args.step_size,
        "min_region_lines": args.min_region_lines,
        "datasets": [],
    }

    for index, dataset in enumerate(datasets, start=1):
        print(f"[DATASET {index}/{len(datasets)}] anomaly -> {dataset.name} (model={dataset.model_id})")
        dataset_report: dict[str, Any] = {
            "dataset": dataset.name,
            "file": str(dataset.file_path),
            "model_id": dataset.model_id,
        }
        ingest_id: str | None = None

        try:
            if args.warmup and dataset.model_id not in warmed_up_models:
                # Warm-up is cached per model so the first dataset pays the startup cost,
                # but repeated datasets with the same model stay comparable.
                print(f"  [anomaly] warmup model {dataset.model_id}")
                client.warmup(dataset.model_id)
                warmed_up_models.add(dataset.model_id)

            print("  [anomaly] upload and ingest")
            (upload_result, upload_ms) = timed_call(lambda: client.upload_file(dataset))
            ingest_id, _finish_payload = upload_result
            print("  [anomaly] backend line count")
            total_lines = client.get_line_count(ingest_id)

            print("  [anomaly] prediction request")
            (prediction, predict_ms) = timed_call(
                lambda: client.predict_ingest(
                    ingest_id,
                    model_id=str(dataset.model_id),
                    threshold=args.threshold,
                    step_size=args.step_size,
                    min_region_lines=args.min_region_lines,
                    include_rows=True,
                    include_windows=False,
                )
            )
            predicted_lines = extract_predicted_lines(prediction)
            prediction_meta = prediction.get("meta") or {}
            prediction_rows = prediction.get("rows") or []
            anomaly_regions = prediction.get("anomaly_regions") or []

            dataset_report.update(
                {
                    "status": "completed",
                    "upload_ms": round(upload_ms, 3),
                    "predict_ms": round(predict_ms, 3),
                    "total_lines": total_lines,
                    # The integration report records whether the backend returned the
                    # response shape required by the UI and follow-up reporting layers.
                    "integration_check": {
                        "prediction_completed": True,
                        "response_has_meta": isinstance(prediction_meta, dict) and bool(prediction_meta),
                        "response_has_rows": isinstance(prediction_rows, list),
                        "response_has_anomaly_regions": isinstance(anomaly_regions, list),
                        "response_has_predicted_lines": bool(predicted_lines),
                    },
                    "predicted_anomaly_lines": len(predicted_lines),
                    "anomaly_regions": len(anomaly_regions),
                    "prediction_meta": prediction_meta,
                    "sample_predicted_lines": sorted(predicted_lines)[:25],
                    "integration_note": "This run validates the backend anomaly workflow and the response shape consumed by the application.",
                }
            )
            print(f"  [anomaly] completed: {dataset.name}")
        except Exception as exc:
            dataset_report.update(
                {
                    "status": "failed",
                    "error": str(exc),
                    "integration_check": {
                        "prediction_completed": False,
                    },
                }
            )
            print(f"  [anomaly] failed: {dataset.name} -> {exc}")
        finally:
            if ingest_id:
                try:
                    client.delete_ingest(ingest_id)
                except Exception:
                    pass

        report["datasets"].append(dataset_report)

    print(f"[INFO] writing anomaly report -> {args.output}")
    write_json_report(args.output, report)
    print("[INFO] anomaly integration finished")
    return 0


if __name__ == "__main__":
    sys.exit(main())
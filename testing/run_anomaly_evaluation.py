from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

from common import (
    ApiClient,
    DEFAULT_REPORTS_DIR,
    REPO_ROOT,
    count_non_empty_lines,
    extract_predicted_lines,
    normalize_selected_names,
    timed_call,
    write_json_report,
)


DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent / "config" / "anomaly-evaluation-datasets.json"
BLOCK_ID_RE = re.compile(r"blk_[\-\d]+")
ASE2021_THRESHOLD = 0.5
ASE2021_STEP_SIZE = 1
ASE2021_MIN_REGION_LINES = 1


# Apply the ASE 2021-aligned parameter profile when requested.
def apply_parameter_profile(args: argparse.Namespace) -> None:
    if getattr(args, "paper_ase2021", False):
        args.threshold = ASE2021_THRESHOLD
        args.step_size = ASE2021_STEP_SIZE
        args.min_region_lines = ASE2021_MIN_REGION_LINES


# Configure command-line arguments for anomaly model evaluation.
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Evaluate anomaly models against available BGL/HDFS ground truth.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8001", help="Backend base URL")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH, help="Path to anomaly evaluation config JSON")
    parser.add_argument("--dataset", action="append", default=[], help="Run only selected dataset names")
    parser.add_argument("--threshold", type=float, default=0.6, help="Prediction threshold")
    parser.add_argument("--step-size", type=int, default=20, help="Sliding window step size")
    parser.add_argument("--min-region-lines", type=int, default=1, help="Minimum anomaly region size")
    parser.add_argument(
        "--paper-ase2021",
        action="store_true",
        help="Use ASE 2021-aligned NeuralLog evaluation settings: threshold=0.5, step-size=1, min-region-lines=1",
    )
    parser.add_argument("--warmup", action="store_true", help="Warm up the model before running the first prediction")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_REPORTS_DIR / "anomaly-eval-report.json",
        help="Where to store the JSON evaluation report",
    )
    return parser


# Load anomaly evaluation datasets and resolve file paths.
def load_eval_datasets(config_path: Path, selected_names: set[str] | None = None) -> list[dict[str, Any]]:
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    items: list[dict[str, Any]] = []
    for entry in raw.get("datasets", []):
        name = str(entry["name"])
        if selected_names and name not in selected_names:
            continue
        item = dict(entry)
        item["name"] = name
        item["file_path"] = (REPO_ROOT / str(entry["file"])).resolve()
        label_file = entry.get("label_file")
        item["label_file_path"] = ((REPO_ROOT / str(label_file)).resolve() if label_file else None)
        items.append(item)
    return items


# Guard metric calculations against division by zero.
def safe_div(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator else 0.0


# Round floating-point metrics to a stable report precision.
def safe_round(value: float) -> float:
    return round(float(value), 6)


# Build a standard confusion-matrix metric bundle.
def build_metrics(tp: int, fp: int, fn: int, tn: int) -> dict[str, Any]:
    precision = safe_div(tp, tp + fp)
    recall = safe_div(tp, tp + fn)
    f1 = safe_div(2 * precision * recall, precision + recall)
    accuracy = safe_div(tp + tn, tp + fp + fn + tn)
    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "precision": safe_round(precision),
        "recall": safe_round(recall),
        "f1": safe_round(f1),
        "accuracy": safe_round(accuracy),
    }


# Evaluate BGL predictions using the anomaly flag encoded in each log line prefix.
def evaluate_bgl_prefix(dataset_path: Path, predicted_lines: set[int]) -> dict[str, Any]:
    tp = fp = fn = tn = 0
    total_lines = 0
    positive_lines = 0

    with dataset_path.open("r", encoding="utf-8", errors="replace") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            if not raw_line.strip():
                continue
            total_lines += 1
            first_token = raw_line.split(maxsplit=1)[0].strip()
            truth = first_token != "-"
            predicted = line_number in predicted_lines
            positive_lines += 1 if truth else 0

            if truth and predicted:
                tp += 1
            elif not truth and predicted:
                fp += 1
            elif truth and not predicted:
                fn += 1
            else:
                tn += 1

    return {
        "evaluation_unit": "line",
        "total_units": total_lines,
        "ground_truth_positive_units": positive_lines,
        "predicted_positive_units": len(predicted_lines),
        "metrics": build_metrics(tp, fp, fn, tn),
        "ground_truth_source": "BGL prefix token: '-' means normal, any other prefix means anomaly class",
    }


# Load the HDFS block-level labels from the CSV ground-truth file.
def load_hdfs_labels(label_file_path: Path) -> dict[str, bool]:
    labels: dict[str, bool] = {}
    with label_file_path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            block_id = str(row.get("BlockId", "")).strip()
            label = str(row.get("Label", "")).strip().lower()
            if not block_id:
                continue
            labels[block_id] = label == "anomaly"
    return labels


# Evaluate HDFS predictions by mapping predicted lines back to labeled block ids.
def evaluate_hdfs_block_csv(dataset_path: Path, label_file_path: Path, predicted_lines: set[int]) -> dict[str, Any]:
    block_labels = load_hdfs_labels(label_file_path)
    predicted_blocks: set[str] = set()
    observed_blocks: set[str] = set()
    missing_block_lines = 0

    with dataset_path.open("r", encoding="utf-8", errors="replace") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            if not raw_line.strip():
                continue
            match = BLOCK_ID_RE.search(raw_line)
            if not match:
                missing_block_lines += 1
                continue
            block_id = match.group(0)
            # The HDFS labels are defined per block id, so line-level predictions must
            # first be collapsed onto the set of blocks observed as anomalous.
            if block_id in block_labels:
                observed_blocks.add(block_id)
                if line_number in predicted_lines:
                    predicted_blocks.add(block_id)

    tp = fp = fn = tn = 0
    positive_blocks = 0
    for block_id in sorted(observed_blocks):
        truth = block_labels[block_id]
        predicted = block_id in predicted_blocks
        positive_blocks += 1 if truth else 0
        if truth and predicted:
            tp += 1
        elif not truth and predicted:
            fp += 1
        elif truth and not predicted:
            fn += 1
        else:
            tn += 1

    return {
        "evaluation_unit": "block",
        "total_units": len(observed_blocks),
        "ground_truth_positive_units": positive_blocks,
        "predicted_positive_units": len(predicted_blocks),
        "metrics": build_metrics(tp, fp, fn, tn),
        "ground_truth_source": str(label_file_path),
        "notes": {
            "missing_block_lines": missing_block_lines,
            "labels_total": len(block_labels),
            "labels_observed_in_log": len(observed_blocks),
        },
    }


# Refresh the aggregate summary after each dataset run.
def update_report_summary(report: dict[str, Any]) -> None:
    datasets = list(report.get("datasets") or [])
    completed = sum(1 for item in datasets if item.get("status") == "completed")
    failed = sum(1 for item in datasets if item.get("status") == "failed")
    report["summary"] = {
        "total": len(datasets),
        "completed": completed,
        "failed": failed,
    }


# Persist the current report state so long runs keep partial results.
def persist_report(output_path: Path, report: dict[str, Any]) -> None:
    update_report_summary(report)
    write_json_report(output_path, report)


# Run anomaly model evaluation for selected datasets and save the JSON report.
def main() -> int:
    args = build_parser().parse_args()
    apply_parameter_profile(args)
    selected_names = normalize_selected_names(args.dataset)
    datasets = load_eval_datasets(args.config, selected_names)
    client = ApiClient(args.base_url, timeout_s=300.0)

    print("[INFO] anomaly evaluation started")
    print(f"[INFO] datasets selected: {len(datasets)}")

    warmed_up_models: set[str] = set()
    report: dict[str, Any] = {
        "suite": "backend-anomaly-evaluation",
        "base_url": args.base_url,
        "parameter_profile": "ase2021" if args.paper_ase2021 else "custom",
        "threshold": args.threshold,
        "step_size": args.step_size,
        "min_region_lines": args.min_region_lines,
        "paper_alignment_note": (
            "ASE 2021 alignment uses the paper sliding-window setup (length=20, step=1) and a 0.5 anomaly probability threshold to mimic classifier argmax on softmax outputs."
            if args.paper_ase2021
            else None
        ),
        "datasets": [],
    }

    exit_code = 0

    for index, dataset in enumerate(datasets, start=1):
        name = str(dataset["name"])
        file_path = Path(dataset["file_path"])
        model_id = str(dataset.get("model_id") or "")
        format_id = dataset.get("format_id")
        label_strategy = str(dataset.get("label_strategy") or "")
        label_file_path = dataset.get("label_file_path")

        print(f"[DATASET {index}/{len(datasets)}] anomaly-eval -> {name} (model={model_id}, strategy={label_strategy})")
        dataset_report: dict[str, Any] = {
            "dataset": name,
            "file": str(file_path),
            "model_id": model_id,
            "format_id": format_id,
            "label_strategy": label_strategy,
            "parameter_profile": report["parameter_profile"],
            "phase": "initializing",
        }
        ingest_id: str | None = None

        try:
            if args.warmup and model_id and model_id not in warmed_up_models:
                dataset_report["phase"] = "warmup"
                print(f"  [eval] warmup model {model_id}")
                client.warmup(model_id)
                warmed_up_models.add(model_id)

            # Reuse the upload helper from common.ApiClient without changing the
            # existing dataset-loading format for the evaluation configuration.
            dataset_spec = type("DatasetSpecShim", (), {
                "name": name,
                "file_path": file_path,
                "format_id": format_id,
                "parser_pattern": dataset.get("parser_pattern"),
                "model_id": model_id,
            })()

            dataset_report["phase"] = "upload"
            print("  [eval] upload and ingest")
            (upload_result, upload_ms) = timed_call(lambda: client.upload_file(dataset_spec))
            ingest_id, _finish_payload = upload_result

            dataset_report["phase"] = "predict"
            print("  [eval] prediction request")
            (prediction, predict_ms) = timed_call(
                lambda: client.predict_ingest(
                    ingest_id,
                    model_id=model_id,
                    threshold=args.threshold,
                    step_size=args.step_size,
                    min_region_lines=args.min_region_lines,
                    include_rows=False,
                    include_windows=False,
                )
            )
            predicted_lines = extract_predicted_lines(prediction)

            evaluation: dict[str, Any]
            if label_strategy == "bgl_prefix":
                evaluation = evaluate_bgl_prefix(file_path, predicted_lines)
            elif label_strategy == "hdfs_block_csv":
                if not isinstance(label_file_path, Path):
                    raise ValueError(f"Dataset {name} requires label_file for hdfs_block_csv strategy")
                evaluation = evaluate_hdfs_block_csv(file_path, label_file_path, predicted_lines)
            else:
                raise ValueError(f"Unsupported label strategy: {label_strategy}")

            total_lines = count_non_empty_lines(file_path)
            dataset_report.update(
                {
                    "status": "completed",
                    "phase": "completed",
                    "upload_ms": round(upload_ms, 3),
                    "predict_ms": round(predict_ms, 3),
                    "prediction_meta": prediction.get("meta") or {},
                    "predicted_anomaly_lines": len(predicted_lines),
                    "total_lines": total_lines,
                    "evaluation": evaluation,
                    "evaluation_note": "Ground-truth comparison is computed from dataset-specific labels aligned to the model output unit.",
                }
            )
            print(f"  [eval] completed: {name}")
        except Exception as exc:
            dataset_report.update(
                {
                    "status": "failed",
                    "phase": str(dataset_report.get("phase") or "failed"),
                    "error": str(exc),
                }
            )
            exit_code = 1
            print(f"  [eval] failed: {name} -> {exc}")
        finally:
            if ingest_id:
                try:
                    client.delete_ingest(ingest_id)
                except Exception:
                    pass

        report["datasets"].append(dataset_report)
        persist_report(args.output, report)

    print(f"[INFO] writing anomaly evaluation report -> {args.output}")
    persist_report(args.output, report)
    print("[INFO] anomaly evaluation finished")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
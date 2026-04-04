from __future__ import annotations

import argparse
import json
from pathlib import Path

from .inference import BGLAnomalyService
from .io_utils import load_rows_from_file


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run BGL NeuralLog anomaly detection on a table/log file")
    parser.add_argument("--input", required=True, help="Input table file (.csv/.tsv/.json)")
    parser.add_argument("--output", required=True, help="Output JSON path")
    parser.add_argument("--text-column", default=None, help="Column containing log message text")
    parser.add_argument("--timestamp-column", default=None, help="Column containing timestamp values")
    parser.add_argument("--threshold", type=float, default=0.5, help="Anomaly threshold [0,1]")
    parser.add_argument("--step-size", type=int, default=20, help="Sliding window step size")
    parser.add_argument("--min-region-lines", type=int, default=1, help="Minimum lines per anomaly region")
    return parser


def main() -> None:
    args = build_parser().parse_args()

    rows = load_rows_from_file(args.input)
    service = BGLAnomalyService()
    result = service.predict_rows(
        rows=rows,
        text_column=args.text_column,
        timestamp_column=args.timestamp_column,
        threshold=args.threshold,
        step_size=args.step_size,
        min_region_lines=args.min_region_lines,
    )

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Rows: {result['meta']['total_rows']}")
    print(f"Anomaly rows: {result['meta']['anomaly_rows']}")
    print(f"Regions: {len(result['anomaly_regions'])}")
    print(f"Saved: {output_path}")


if __name__ == "__main__":
    main()

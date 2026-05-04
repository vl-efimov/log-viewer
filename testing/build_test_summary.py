from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from common import DEFAULT_REPORTS_DIR


# Configure command-line arguments for the summary report generator.
def build_parser() -> argparse.ArgumentParser:

    parser = argparse.ArgumentParser(description="Build a consolidated Markdown testing report from JSON reports.")
    parser.add_argument(
        "--reports-dir",
        type=Path,
        default=DEFAULT_REPORTS_DIR,
        help="Directory containing JSON reports",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_REPORTS_DIR / "testing-summary-report.md",
        help="Output Markdown file",
    )
    return parser


# Load one JSON report if it exists.
def load_json(path: Path) -> dict[str, Any] | None:

    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


# Convert headers and rows into a simple Markdown table.
def md_table(headers: list[str], rows: list[list[Any]]) -> str:

    header_line = "| " + " | ".join(headers) + " |"
    separator = "| " + " | ".join(["---"] * len(headers)) + " |"
    body = ["| " + " | ".join(str(cell) for cell in row) + " |" for row in rows]
    return "\n".join([header_line, separator, *body]) if body else "_No data available._"


# Format file size into a readable unit for summary tables.
def format_file_size(size_bytes: int | None) -> str:

    if size_bytes is None:
        return "-"
    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(size_bytes)
    unit_index = 0
    while size >= 1024.0 and unit_index < len(units) - 1:
        size /= 1024.0
        unit_index += 1
    if unit_index == 0:
        return f"{int(size)} {units[unit_index]}"
    return f"{size:.2f} {units[unit_index]}"


# Extract file path and displayable file size from one dataset item.
def resolve_file_metadata(*items: dict[str, Any]) -> tuple[str, str]:

    for item in items:
        file_path = item.get("file")
        if not file_path:
            continue
        path = Path(file_path)
        if path.exists():
            return path.name, format_file_size(path.stat().st_size)
        return path.name, "-"
    return "-", "-"


# Build the functional testing section of the summary.
def functional_section(report: dict[str, Any] | None) -> str:

    if not report:
        return "## Backendové automatické testy\n\n### Funkční testy velkých souborů\n\n_No backend functional report available._"

    summary = report.get("summary") or {}
    dataset_rows = []
    for item in report.get("datasets") or []:
        dataset_rows.append([
            item.get("dataset", "-"),
            item.get("status", "-"),
            item.get("line_count", "-"),
            item.get("filter_total_matches", "-"),
            ", ".join(item.get("dashboard_keys") or []),
        ])

    lines = [
        "## Testování aplikace",
        "",
        "### Funkční testy velkých souborů",
        "",
        f"- Spuštěno datasetů: {summary.get('total', 0)}",
        f"- Úspěšných běhů: {summary.get('passed', 0)}",
        f"- Neúspěšných běhů: {summary.get('failed', 0)}",
        "",
        md_table(
            ["Dataset", "Status", "Line count", "Filter matches", "Dashboard keys"],
            dataset_rows,
        ),
    ]
    return "\n".join(lines)


# Build the performance section of the summary.
def performance_section(report: dict[str, Any] | None) -> str:

    if not report:
        return "### Výkon backendu pro velké soubory\n\n_No backend performance report available._"

    rows = []
    for item in report.get("datasets") or []:
        timings = item.get("timings_ms") or {}
        rows.append([
            item.get("dataset", "-"),
            item.get("line_count", "-"),
            timings.get("ingest", "-"),
            timings.get("dashboard", "-"),
            timings.get("dashboard_exact", "-"),
            timings.get("filter_message", "-"),
        ])

    lines = [
        "",
        "### Výkon backendu pro velké soubory",
        "",
        md_table(
            ["Dataset", "Line count", "Ingest ms", "Dashboard ms", "Exact dashboard ms", "Filter ms"],
            rows,
        ),
        "",
        "Souhrn latencí:",
        "",
        md_table(
            ["Operation", "Count", "Min ms", "Max ms", "Avg ms"],
            [
                [
                    key,
                    value.get("count", 0),
                    value.get("min_ms", 0),
                    value.get("max_ms", 0),
                    value.get("avg_ms", 0),
                ]
                for key, value in (report.get("summary") or {}).items()
            ],
        ),
    ]
    return "\n".join(lines)


# Merge functional and performance data into one dataset table.
def dataset_section(functional_report: dict[str, Any] | None, performance_report: dict[str, Any] | None) -> str:

    rows = []
    # Functional and performance reports are generated independently, so the summary
    # joins them by dataset name before building one comparison table.
    functional_items = {
        item.get("dataset", ""): item for item in (functional_report or {}).get("datasets") or []
    }
    performance_items = {
        item.get("dataset", ""): item for item in (performance_report or {}).get("datasets") or []
    }

    for dataset_name in sorted(set(functional_items) | set(performance_items)):
        functional_item = functional_items.get(dataset_name, {})
        performance_item = performance_items.get(dataset_name, {})
        file_name, file_size = resolve_file_metadata(functional_item, performance_item)
        rows.append([
            dataset_name,
            file_name,
            file_size,
            functional_item.get("line_count", performance_item.get("line_count", "-")),
            functional_item.get("status", performance_item.get("status", "-")),
            performance_item.get("timings_ms", {}).get("dashboard", "-"),
            performance_item.get("timings_ms", {}).get("filter_message", "-"),
        ])

    lines = [
        "",
        "## Datasety pro backendové testy",
        "",
        "### Použitá sada",
        "",
        "- Backend functional a performance běhy používají pouze velké datasety definované v testing/config/backend-large-datasets.json.",
        "- Tyto scénáře reprezentují serverovou část workflow pro rozsáhlé logové soubory.",
        "",
        "### Přehled datasetů a výsledků",
        "",
        md_table(["Dataset", "File", "File size", "Line count", "Status", "Dashboard ms", "Filter ms"], rows),
    ]
    return "\n".join(lines)

# Build the anomaly integration section of the summary.
def anomaly_section(report: dict[str, Any] | None) -> str:

    if not report:
        return "## Backendová detekce anomálií\n\n_No anomaly report available._"

    rows = []
    for item in report.get("datasets") or []:
        integration_check = item.get("integration_check") or {}
        rows.append([
            item.get("dataset", "-"),
            item.get("status", "-"),
            integration_check.get("prediction_completed", False),
            integration_check.get("response_has_meta", False),
            integration_check.get("response_has_rows", False),
            integration_check.get("response_has_anomaly_regions", False),
            item.get("predicted_anomaly_lines", 0),
            item.get("anomaly_regions", 0),
        ])

    lines = [
        "",
        "## Backendová detekce anomálií",
        "",
        "### Ověření integrační funkčnosti",
        "",
        md_table(
            ["Dataset", "Status", "Prediction", "Meta", "Rows", "Regions", "Predicted lines", "Region count"],
            rows,
        ),
        "",
        "### Poznámky k výsledku",
        "",
    ]

    for item in report.get("datasets") or []:
        # Keep the anomaly section descriptive: it preserves a small sample of returned
        # anomaly lines without turning the summary into a model-quality evaluation.
        lines.append(
            f"- {item.get('dataset', '-')}: predicted lines sample = {item.get('sample_predicted_lines', [])[:10]}; {item.get('integration_note', 'Integration note is unavailable.')}"
        )
    return "\n".join(lines)


# Load individual JSON reports and generate one combined Markdown file.
def main() -> int:

    args = build_parser().parse_args()
    reports_dir = args.reports_dir

    print("[INFO] summary generation started")
    print(f"[INFO] reports directory: {reports_dir}")

    functional_report = load_json(reports_dir / "functional-report.json")
    performance_report = load_json(reports_dir / "performance-report.json")
    anomaly_report = load_json(reports_dir / "anomaly-report.json")

    print("[stage] merging manual, backend, and anomaly reports")

    content = "\n".join(
        [
            "# Souhrnný report testování",
            "",
            "Tento souhrnný report kombinuje manuální frontendové plány a automatické backendové reporty uložené ve složce testing/reports.",
            "",
            functional_section(functional_report),
            performance_section(performance_report),
            dataset_section(functional_report, performance_report),
            anomaly_section(anomaly_report),
            "",
        ]
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    print(f"[INFO] writing summary report -> {args.output}")
    args.output.write_text(content, encoding="utf-8")
    print("[INFO] summary generation finished")
    return 0


if __name__ == "__main__":
    sys.exit(main())
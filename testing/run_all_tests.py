from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from common import DEFAULT_REPORTS_DIR, TESTING_ROOT


# Configure command-line arguments for the aggregate test runner.
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run backend automated tests and optionally build a summary report.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8001", help="Backend base URL")
    parser.add_argument("--backend-config", type=Path, help="Path to backend large-file dataset config JSON")
    parser.add_argument("--anomaly-config", type=Path, help="Path to anomaly dataset config JSON")
    parser.add_argument("--skip-functional", action="store_true", help="Skip functional tests")
    parser.add_argument("--skip-performance", action="store_true", help="Skip performance tests")
    parser.add_argument("--skip-anomaly", action="store_true", help="Skip anomaly integration validation")
    parser.add_argument("--skip-summary", action="store_true", help="Skip summary report generation")
    parser.add_argument("--warmup", action="store_true", help="Warm up anomaly models before integration validation")
    return parser


# Run one child script and return its exit code.
def run_step(label: str, command: list[str]) -> int:

    print(f"[RUN] {label}: {' '.join(command)}")
    completed = subprocess.run(command, cwd=str(TESTING_ROOT.parent))
    print(f"[DONE] {label}: exit code {completed.returncode}")
    return int(completed.returncode)


# Run the selected parts of the test suite in sequence.
def main() -> int:

    args = build_parser().parse_args()
    python = sys.executable
    failures = 0

    steps: list[tuple[str, list[str]]] = []
    if not args.skip_functional:
        functional_command = [python, str(TESTING_ROOT / "run_functional_tests.py"), "--base-url", args.base_url]
        if args.backend_config:
            functional_command.extend(["--config", str(args.backend_config)])
        steps.append(("backend-functional", functional_command))
    if not args.skip_performance:
        performance_command = [python, str(TESTING_ROOT / "run_performance_tests.py"), "--base-url", args.base_url]
        if args.backend_config:
            performance_command.extend(["--config", str(args.backend_config)])
        steps.append(("backend-performance", performance_command))
    if not args.skip_anomaly:
        anomaly_command = [python, str(TESTING_ROOT / "run_anomaly_integration.py"), "--base-url", args.base_url]
        if args.anomaly_config:
            anomaly_command.extend(["--config", str(args.anomaly_config)])
        if args.warmup:
            anomaly_command.append("--warmup")
        steps.append(("backend-anomaly", anomaly_command))

    print("[INFO] aggregate test run started")
    print(f"[INFO] base URL: {args.base_url}")
    print(f"[INFO] backend config: {args.backend_config if args.backend_config else 'default testing/config/backend-large-datasets.json'}")
    print(f"[INFO] anomaly config: {args.anomaly_config if args.anomaly_config else 'default testing/config/anomaly-datasets.json'}")
    print(f"[INFO] selected steps: {', '.join(label for label, _command in steps)}")

    for index, (label, command) in enumerate(steps, start=1):
        print(f"[STEP {index}/{len(steps)}] starting {label}")
        failures += 1 if run_step(label, command) != 0 else 0

    if not args.skip_summary:
        summary_step = len(steps) + 1
        print(f"[STEP {summary_step}/{len(steps) + 1}] starting summary")
        failures += 1 if run_step(
            "summary",
            [python, str(TESTING_ROOT / "build_test_summary.py"), "--reports-dir", str(DEFAULT_REPORTS_DIR)],
        ) != 0 else 0

    print(f"[INFO] aggregate test run finished with failures={failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
# LuVo - log viewer (backend)

This project was created as part of a 2026 diploma thesis at FIT CTU, Department of Software Engineering, by student Vladimir Efimov.

This is the backend service for LuVo. It provides the API, runs anomaly detection, and stores ingested logs in ClickHouse.

## Quick start

The backend requires ClickHouse. From the repository root, you can run it with Docker:

```bash
docker compose up -d clickhouse
```

Then start the API service locally.

### Windows (PowerShell)

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\run_server.ps1
```

### macOS/Linux

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn anomaly_service.api:app --host 127.0.0.1 --port 8001
```

## Health and URLs

- API base: http://127.0.0.1:8001
- Health check: http://127.0.0.1:8001/health
- ClickHouse: http://127.0.0.1:8123

## Environment variables

- `CLICKHOUSE_HOST` (default: `127.0.0.1`)
- `CLICKHOUSE_PORT` (default: `8123`)
- `CLICKHOUSE_USER` (default: `logviewer`)
- `CLICKHOUSE_PASSWORD` (default: `logviewer`)
- `CLICKHOUSE_DB` (default: `log_viewer`)
- `CLICKHOUSE_INIT_MAX_WAIT_S` (default: `30`)
- `PORT` (default: `8001`)
- `TF_USE_LEGACY_KERAS` (default: `1`)

## Notes

- On first warmup/prediction the backend downloads `bert-base-uncased` from Hugging Face.
- The API waits for ClickHouse startup before initializing tables.

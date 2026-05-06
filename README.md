# LuVo - log viewer

This project was created as part of a 2026 diploma thesis at FIT CTU, Department of Software Engineering, by student Vladimir Efimov.

## Quick start

Prerequisites:
- Docker Desktop (this is the only thing to install)

From the repository root:

```bash
docker compose up --build
```

Or on Windows you can just run:
- `start.cmd`

Stop:
- `stop.cmd`

Troubleshooting (Windows):
- Use the `.cmd` launchers. Running `.ps1` directly in Windows PowerShell 5.1 can be sensitive to file encoding.

Troubleshooting (Docker build / network):
- The first start downloads large Python wheels (e.g. TensorFlow). If you see `ReadTimeoutError` from pip, just run `start.cmd` again.
- If you are behind a corporate proxy, configure Docker Desktop proxy or set `HTTP_PROXY`/`HTTPS_PROXY` for the Docker daemon.

Services:
- App (frontend + API): http://127.0.0.1:8001 (health: `/health`)
- ClickHouse: http://127.0.0.1:8123

Notes:
- The API waits for ClickHouse startup (configurable via `CLICKHOUSE_INIT_MAX_WAIT_S`).
- On first warmup/prediction the backend downloads `bert-base-uncased` from Hugging Face.

## Run frontend only

From the repository root:

```bash
cd log-viewer-front
npm install
npm run dev
```

## Run backend only

The backend still requires ClickHouse. You can run it via Docker:

```bash
docker compose up -d clickhouse
```

Then run the API service:

```bash
cd backend
python -m venv .venv
\.venv\Scripts\pip install -r requirements.txt
\.\run_server.ps1
```

If you are not on Windows, use:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn anomaly_service.api:app --host 127.0.0.1 --port 8001
```

Environment overrides (optional): `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DB`.

### Backend (FastAPI) + ClickHouse (Docker)

The backend uses FastAPI + TensorFlow/Transformers and stores ingested logs in ClickHouse.

### Frontend config

The frontend reads the backend URL from `VITE_ANOMALY_API_URL` (or `VITE_BGL_API_URL` as a fallback) and defaults to `http://127.0.0.1:8001`.

## User guide

See [user-guide/User_guide.md](user-guide/User_guide.md).

## Testing

See [testing/README.md](testing/README.md).

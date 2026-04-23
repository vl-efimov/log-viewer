# log-viewer

## Backend (FastAPI) + ClickHouse (Docker)

The backend uses FastAPI + TensorFlow/Transformers and stores ingested logs in ClickHouse.

### Run locally (minimum setup)

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

### Frontend config

The frontend reads backend URL from `VITE_BGL_API_URL` (defaults to `http://127.0.0.1:8001`).

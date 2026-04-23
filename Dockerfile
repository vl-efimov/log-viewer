# syntax=docker/dockerfile:1

FROM node:20-alpine AS frontend
WORKDIR /frontend

COPY log-viewer-front/package.json log-viewer-front/package-lock.json ./
RUN npm ci

COPY log-viewer-front/ ./
# Build static assets
RUN npm run build


FROM python:3.10-slim AS backend

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=600 \
    PIP_RETRIES=10 \
    PIP_PROGRESS_BAR=off

WORKDIR /app

# TensorFlow on slim typically needs libgomp1
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install -r requirements.txt

COPY backend/ ./

# Copy frontend dist into backend image
COPY --from=frontend /frontend/dist /app/frontend_dist

ENV TF_USE_LEGACY_KERAS=1 \
    PORT=8001 \
    SERVE_FRONTEND=1 \
    FRONTEND_DIST_DIR=/app/frontend_dist

EXPOSE 8001

CMD ["sh", "-c", "uvicorn bgl_anomaly_service.api:app --host 0.0.0.0 --port ${PORT}"]

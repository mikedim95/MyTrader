# Horizon Trade

This repository contains:

- `FrontEnd/` (Vite + React dashboard UI)
- `BackEnd/` (Express + TypeScript API with Binance integration)

## Run locally

1. Start backend:

```bash
cd BackEnd
npm install
npm run dev
```

2. Start frontend (in a second terminal):

```bash
cd FrontEnd
npm install
npm run dev
```

3. Open the frontend URL (default: `http://localhost:8080`).

4. In **Settings**, connect Binance with API key/secret or configure backend `.env`.

## Docker image build/push on commit

This repo now includes a GitHub Actions workflow at `.github/workflows/docker-publish.yml` that builds and pushes ARM64 images on each commit push.

Images pushed to Docker Hub:

- `docker.io/<DOCKERHUB_USERNAME>/mytrader-backend`
- `docker.io/<DOCKERHUB_USERNAME>/mytrader-frontend`

### Required GitHub repository secrets

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN` (Docker Hub access token with write permissions)

### Tags

- `<full-git-sha>` for every push
- `latest` for the default branch

### Notes

- Docker builds use the repository root as context so shared ignore rules in `.dockerignore` are applied consistently.
- Images are pushed to **two separate Docker Hub repositories** (not a single `mytrader` repo): `mytrader-backend` and `mytrader-frontend`.
- The workflow now publishes **ARM64-only** images (`linux/arm64`), which matches Raspberry Pi 3B deployment targets.
- The frontend container ships an Nginx SPA fallback (`try_files ... /index.html`) so direct deep-link routes work after deployment.

## Raspberry Pi 3B+ deployment (Docker Compose)

A ready-to-run Compose stack is provided at `deploy/pi/docker-compose.yml` for ARM64 deployments with:

- `docker.io/<DOCKERHUB_NAMESPACE>/mytrader-backend:${BACKEND_TAG}`
- `docker.io/<DOCKERHUB_NAMESPACE>/mytrader-frontend:${FRONTEND_TAG}`
- `mysql:8.0` (persistent volume)
- optional `n8nio/n8n:latest` profile for workflow automation

The compose stack is now designed for controlled deployments. Automatic background image updates are intentionally not part of the default stack.

### Quick start on Pi

```bash
mkdir -p ~/mytrader && cd ~/mytrader
curl -fsSL https://raw.githubusercontent.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPO>/main/deploy/pi/docker-compose.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPO>/main/deploy/pi/.env.example -o .env
# edit .env values (especially passwords and PI_HOST_OR_IP)
nano .env
docker compose pull
docker compose up -d
```

To enable `n8n` as well:

```bash
docker compose --profile automation up -d
```

Endpoints after startup:

- Frontend: `http://<PI_HOST_OR_IP>:8080`
- Frontend version: `http://<PI_HOST_OR_IP>:8080/version.json`
- Backend health: `http://<PI_HOST_OR_IP>:3001/api/health`
- Backend readiness: `http://<PI_HOST_OR_IP>:3001/ready`
- n8n: `http://<PI_HOST_OR_IP>:5678` when the `automation` profile is enabled

### Pi-safe strategy defaults

The backend now persists historical candles in MySQL and runs backtests/evaluations through a MySQL-backed job table claimed by the existing in-process scheduler. The Pi compose env exposes the main tunables:

- `HISTORICAL_CANDLE_RETENTION_DAYS`
- `HISTORICAL_CANDLE_REQUEST_DELAY_MS`
- `HISTORICAL_CANDLE_MAX_RETRIES`
- `HISTORICAL_CANDLE_FETCH_LIMIT`
- `HISTORICAL_CANDLE_RETRY_BASE_DELAY_MS`
- `STRATEGY_JOB_RETRY_BASE_DELAY_MS`
- `STRATEGY_JOB_MAX_ATTEMPTS`

The defaults are intentionally conservative for Raspberry Pi 3B+: one scheduler path, low request pacing, bounded retention, and small retry counts.

## Controlled Autonomous Workflow

`agent-control/` now contains a local orchestration layer that plans one task at a time, hands it to a local builder agent, waits for the pushed commit to produce exact SHA-tagged images, deploys those tags over SSH, polls readiness, runs verification, and prepares rollback metadata before any rollback action.

Start here:

```bash
cp agent-control/config.example.json agent-control/config.json
python agent-control/run.py --config agent-control/config.json
```

See `agent-control/README.md` for the full operator flow.


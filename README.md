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

- `sha-<commit>` for every push
- `latest` for the default branch

### Notes

- Docker builds use the repository root as context so shared ignore rules in `.dockerignore` are applied consistently.
- Images are pushed to **two separate Docker Hub repositories** (not a single `mytrader` repo): `mytrader-backend` and `mytrader-frontend`.
- The workflow now publishes **ARM64-only** images (`linux/arm64`), which matches Raspberry Pi 3B deployment targets.
- The frontend container ships an Nginx SPA fallback (`try_files ... /index.html`) so direct deep-link routes work after deployment.

## Raspberry Pi 3B+ deployment (Docker Compose)

A ready-to-run Compose stack is provided at `deploy/pi/docker-compose.yml` for ARM64 deployments with:

- `mikedim95/mytrader-backend:latest`
- `mikedim95/mytrader-frontend:latest`
- `mysql:8.0` (persistent volume)
- `n8nio/n8n:latest` (persistent volume, configured to use MySQL)
- `nickfedor/watchtower:latest` for automatic image update checks

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

Endpoints after startup:

- Frontend: `http://<PI_HOST_OR_IP>:8080`
- Backend health: `http://<PI_HOST_OR_IP>:3001/api/health`
- n8n: `http://<PI_HOST_OR_IP>:5678`


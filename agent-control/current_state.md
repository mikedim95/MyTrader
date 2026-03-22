# Current State

- Repo layout: `FrontEnd/` (Vite + React) and `BackEnd/` (Express + TypeScript).
- CI: `.github/workflows/docker-publish.yml` builds ARM64 backend/frontend images and now tags them with the full git SHA.
- Deploy target: `deploy/pi/docker-compose.yml` pulls Docker Hub images on a Raspberry Pi-style host.
- Runtime health: backend exposes `/health`, `/api/health`, `/ready`, `/api/ready`; frontend exposes `/health` and `/version.json`.
- Remaining operator setup: fill `agent-control/config.json` with the real SSH target, URLs, and any optional verification credentials.

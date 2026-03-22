# Agent Control

This folder is the local system of record for the controlled autonomous delivery workflow.

## What It Does

The orchestrator runs a disciplined single-task state machine:

`IDLE -> PLANNING -> CODING -> WAITING_FOR_PUSH -> WAITING_FOR_CI -> WAITING_FOR_IMAGE -> DEPLOYING -> WAITING_FOR_APP -> VERIFYING -> DONE|FAILED`

Safety rules enforced by code:
- one task per cycle
- one local builder invocation at a time
- no deploy before the exact SHA images exist
- no next feature after failed readiness or failed verification
- rollback state is preserved before rollback is attempted

## Files

- `product_goal.md`: canonical product goal the planner should optimize for
- `acceptance_criteria.md`: finish line for the planner and verifier
- `current_state.md`: current repo and deployment state
- `backlog.json`: optional explicit tasks for the fallback planner
- `planner_state.json`: orchestrator state, sequence counter, completed tasks, last error
- `next_task.json`: planner output for the current cycle
- `builder_result.json`: builder result for the current cycle
- `verification_report.json`: latest deployed verification result
- `deploy_state.json`: last known-good tags, candidate tag, rollback metadata

## Config

1. Copy `config.example.json` to `config.json`.
2. Fill in:
   - `deploy.ssh_target`
   - `deploy.remote_compose_dir`
   - `deploy.remote_env_file`
   - `deploy.frontend_url`
   - `deploy.backend_url`
3. Optionally set:
   - `github.repo` if auto-detection from `origin` is not correct
   - `verification.session_username` / `verification.session_password`
   - `verification.run_browser_smoke`
   - `control.safety_mode` as `prepare_rollback` or `rollback_on_failure`

The default planner and builder commands assume the local Codex CLI is available.

## Run

One controlled cycle:

```bash
python agent-control/run.py --config agent-control/config.json
```

Bounded multi-cycle run:

```bash
python agent-control/run.py --config agent-control/config.json --cycles 3
```

## Builder Contract

The builder prompt requires the local coding agent to:
- read `next_task.json`
- make only the planned change
- run repo-appropriate validation
- commit and push when ready
- write `builder_result.json`

## Deploy Contract

The deployer assumes the remote host already has:
- the compose file from `deploy/pi/docker-compose.yml`
- an `.env` file derived from `deploy/pi/.env.example`
- Docker Compose and `python3`

The deployer updates `BACKEND_TAG` and `FRONTEND_TAG` in the remote `.env`, then runs:
- `docker compose pull backend frontend`
- `docker compose up -d backend frontend`

## Verification Contract

Readiness gates:
- frontend `/health`
- frontend `/version.json`
- backend `/ready`

Post-deploy verification:
- frontend root loads
- backend readiness is healthy
- deployed version matches the pushed SHA
- session status works
- login and one authenticated demo dashboard path work when credentials are available
- optional browser smoke via `scripts/browser_smoke.mjs`

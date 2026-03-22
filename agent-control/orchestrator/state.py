from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@dataclass(frozen=True)
class StatePaths:
    control_dir: Path
    logs_dir: Path
    lock_file: Path
    product_goal: Path
    acceptance_criteria: Path
    current_state: Path
    backlog: Path
    planner_state: Path
    next_task: Path
    builder_result: Path
    verification_report: Path
    deploy_state: Path
    planner_prompt: Path
    builder_prompt: Path
    verifier_prompt: Path
    browser_smoke_script: Path


def build_state_paths(control_dir: Path) -> StatePaths:
    return StatePaths(
        control_dir=control_dir,
        logs_dir=control_dir / "logs",
        lock_file=control_dir / "orchestrator.lock",
        product_goal=control_dir / "product_goal.md",
        acceptance_criteria=control_dir / "acceptance_criteria.md",
        current_state=control_dir / "current_state.md",
        backlog=control_dir / "backlog.json",
        planner_state=control_dir / "planner_state.json",
        next_task=control_dir / "next_task.json",
        builder_result=control_dir / "builder_result.json",
        verification_report=control_dir / "verification_report.json",
        deploy_state=control_dir / "deploy_state.json",
        planner_prompt=control_dir / "prompts" / "planner_prompt.md",
        builder_prompt=control_dir / "prompts" / "builder_prompt.md",
        verifier_prompt=control_dir / "prompts" / "verifier_prompt.md",
        browser_smoke_script=control_dir / "scripts" / "browser_smoke.mjs",
    )


def _write_json_if_missing(path: Path, payload: Any) -> None:
    if path.exists():
        return
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _write_text_if_missing(path: Path, content: str) -> None:
    if path.exists():
        return
    path.write_text(content, encoding="utf-8")


def ensure_control_files(paths: StatePaths) -> None:
    paths.control_dir.mkdir(parents=True, exist_ok=True)
    paths.logs_dir.mkdir(parents=True, exist_ok=True)

    _write_text_if_missing(
        paths.product_goal,
        "# Product Goal\n\n"
        "Replace this file with the single product goal the planner should optimize for.\n\n"
        "Current inferred goal:\n"
        "- Deliver MyTrader as a self-hosted trading and mining operations SaaS.\n"
        "- Keep portfolio, automation, mining, and decision-support workflows usable after each deploy.\n"
        "- Favor reliable Raspberry Pi deployments over speculative feature churn.\n",
    )
    _write_text_if_missing(
        paths.acceptance_criteria,
        "# Acceptance Criteria\n\n"
        "Replace or refine these criteria so the planner has an explicit finish line.\n\n"
        "- [ ] Frontend loads from the deployed host and serves the SPA without 5xx errors.\n"
        "- [ ] Backend `/ready` reports `status: ok`, `db: ok`, and the deployed git SHA.\n"
        "- [ ] Session status, login flow, and at least one authenticated demo workflow work after deploy.\n"
        "- [ ] A core portfolio or automation data path returns valid data without fatal regressions.\n"
        "- [ ] Deployments use immutable image tags and can be rolled back to the last known-good version.\n",
    )
    _write_text_if_missing(
        paths.current_state,
        "# Current State\n\n"
        "- Repo layout: `FrontEnd/` (Vite + React) and `BackEnd/` (Express + TypeScript).\n"
        "- CI: `.github/workflows/docker-publish.yml` builds ARM64 backend/frontend images and now tags them with the full git SHA.\n"
        "- Deploy target: `deploy/pi/docker-compose.yml` pulls Docker Hub images on a Raspberry Pi-style host.\n"
        "- Runtime health: backend exposes `/health`, `/api/health`, `/ready`, `/api/ready`; frontend exposes `/health` and `/version.json`.\n"
        "- Remaining operator setup: fill `agent-control/config.json` with the real SSH target, URLs, and any optional verification credentials.\n",
    )

    _write_json_if_missing(paths.backlog, {"tasks": [], "updated_at": iso_now()})
    _write_json_if_missing(
        paths.planner_state,
        {
            "orchestrator_state": "IDLE",
            "next_sequence": 1,
            "last_planned_task_id": "",
            "last_completed_task_id": "",
            "last_completed_at": "",
            "last_cycle_status": "idle",
            "completed_tasks": [],
            "last_error": "",
            "updated_at": iso_now(),
        },
    )
    _write_json_if_missing(
        paths.next_task,
        {
            "task_id": "",
            "title": "",
            "reason": "",
            "goal_gap": "",
            "acceptance_criteria": [],
            "affected_areas": [],
            "risk_level": "low",
            "needs_deploy": False,
            "stop_if": [],
        },
    )
    _write_json_if_missing(
        paths.builder_result,
        {
            "task_id": "",
            "changed_files": [],
            "summary": "",
            "local_checks": {
                "install": "not_run",
                "lint": "not_run",
                "tests": "not_run",
                "typecheck": "not_run",
                "build": "not_run",
            },
            "ready_for_deploy": False,
            "known_issues": [],
            "commit_sha": "",
            "branch": "",
            "pushed": False,
        },
    )
    _write_json_if_missing(
        paths.verification_report,
        {
            "status": "partial_pass",
            "version": "",
            "passed": [],
            "failed": [],
            "regressions": [],
            "notes": ["No deployed verification report has been recorded yet."],
            "recommended_action": "continue",
        },
    )
    _write_json_if_missing(
        paths.deploy_state,
        {
            "last_good_backend_tag": "",
            "last_good_frontend_tag": "",
            "current_backend_tag": "",
            "current_frontend_tag": "",
            "current_candidate_tag": "",
            "last_deploy_status": "idle",
            "last_deployed_at": "",
            "last_failure_reason": "",
            "prepared_rollback": {
                "backend_tag": "",
                "frontend_tag": "",
                "prepared_at": "",
            },
            "updated_at": iso_now(),
        },
    )


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def update_planner_state(paths: StatePaths, **values: Any) -> dict[str, Any]:
    payload = load_json(paths.planner_state)
    payload.update(values)
    payload["updated_at"] = iso_now()
    save_json(paths.planner_state, payload)
    return payload


def update_deploy_state(paths: StatePaths, **values: Any) -> dict[str, Any]:
    payload = load_json(paths.deploy_state)
    payload.update(values)
    payload["updated_at"] = iso_now()
    save_json(paths.deploy_state, payload)
    return payload


def refresh_current_state_markdown(
    paths: StatePaths,
    head_sha: str,
    task_title: str,
    verification_status: str,
    deployed_version: str,
    backlog_count: int,
) -> None:
    content = (
        "# Current State\n\n"
        f"- Last repo head observed by the orchestrator: `{head_sha}`.\n"
        f"- Last completed task: {task_title or 'none'}.\n"
        f"- Latest verification status: `{verification_status}` for version `{deployed_version or 'unknown'}`.\n"
        f"- Pending backlog items: `{backlog_count}`.\n"
        "- Deployment mode: immutable Docker Hub tags selected through `BACKEND_TAG` and `FRONTEND_TAG`.\n"
        "- Safety gates: one task per cycle, no deploy before image availability, no new feature work after failed verification.\n"
    )
    paths.current_state.write_text(content, encoding="utf-8")

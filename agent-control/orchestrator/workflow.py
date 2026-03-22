from __future__ import annotations

import json
import os
import shlex
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import AppConfig
from .shell import render_template, render_tokens, run_command, run_git
from .state import (
    StatePaths,
    iso_now,
    load_json,
    refresh_current_state_markdown,
    save_json,
    update_deploy_state,
    update_planner_state,
)
from .verify import run_verification


VALID_RISK_LEVELS = {"low", "medium", "high"}
VALID_AFFECTED_AREAS = {"backend", "frontend", "database", "deploy", "infra"}
VALID_CHECK_VALUES = {"pass", "fail", "not_run"}


def _write_stage_log(paths: StatePaths, stage: str, content: str) -> Path:
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    path = paths.logs_dir / f"{timestamp}-{stage}.log"
    path.write_text(content, encoding="utf-8")
    return path


def _transition(paths: StatePaths, state: str, logger, **extra: Any) -> None:
    update_planner_state(paths, orchestrator_state=state, **extra)
    logger.info("State -> %s", state)


def _load_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _next_sequence(paths: StatePaths) -> str:
    planner_state = load_json(paths.planner_state)
    sequence = int(planner_state.get("next_sequence", 1))
    update_planner_state(paths, next_sequence=sequence + 1)
    return f"T-{sequence:03d}"


def _goal_reached_task() -> dict[str, Any]:
    return {
        "task_id": "GOAL-REACHED",
        "title": "Goal reached",
        "reason": "All tracked acceptance criteria are satisfied and the latest verification passed.",
        "goal_gap": "none",
        "acceptance_criteria": [],
        "affected_areas": [],
        "risk_level": "low",
        "needs_deploy": False,
        "stop_if": [
            "All acceptance criteria are satisfied.",
            "Latest verification passed.",
            "No critical regressions remain.",
            "No high-priority backlog items remain.",
        ],
    }


def _validate_task(task: dict[str, Any]) -> dict[str, Any]:
    required = {
        "task_id": str,
        "title": str,
        "reason": str,
        "goal_gap": str,
        "acceptance_criteria": list,
        "affected_areas": list,
        "risk_level": str,
        "needs_deploy": bool,
        "stop_if": list,
    }
    for key, expected_type in required.items():
        value = task.get(key)
        if not isinstance(value, expected_type):
            raise RuntimeError(f"Planner output missing `{key}` or type was invalid.")

    if task["risk_level"] not in VALID_RISK_LEVELS:
        raise RuntimeError(f"Planner output risk level `{task['risk_level']}` is invalid.")

    invalid_areas = [area for area in task["affected_areas"] if area not in VALID_AFFECTED_AREAS]
    if invalid_areas:
        raise RuntimeError(f"Planner output contained invalid affected areas: {invalid_areas}")

    return task


def _category_rank(task: dict[str, Any]) -> tuple[int, str]:
    order = {
        "regression": 0,
        "deploy": 1,
        "acceptance": 2,
        "reliability": 3,
        "ux": 4,
        "optimization": 5,
        "nice_to_have": 6,
    }
    category = str(task.get("category", "nice_to_have"))
    return order.get(category, 6), str(task.get("task_id", ""))


def _first_unchecked_acceptance_item(paths: StatePaths) -> str:
    for line in _load_text(paths.acceptance_criteria).splitlines():
        stripped = line.strip()
        if stripped.startswith("- [ ]"):
            return stripped[5:].strip()
    return ""


def _fallback_plan(paths: StatePaths, logger) -> dict[str, Any]:
    verification = load_json(paths.verification_report)
    deploy_state = load_json(paths.deploy_state)
    backlog = load_json(paths.backlog)

    failed_items = [str(item) for item in verification.get("failed", [])]
    regressions = [str(item) for item in verification.get("regressions", [])]
    if verification.get("version") and (failed_items or regressions):
        summary = regressions[0] if regressions else failed_items[0]
        task = {
            "task_id": _next_sequence(paths),
            "title": "Fix deployed verification failure",
            "reason": "The last deployed verification did not pass, so new feature work must stop until the regression is fixed.",
            "goal_gap": summary,
            "acceptance_criteria": [
                "The previously failed verification checks pass on the deployed app.",
                "No new regressions are introduced while fixing the issue.",
            ],
            "affected_areas": ["backend", "frontend", "deploy"],
            "risk_level": "high",
            "needs_deploy": True,
            "stop_if": ["Any critical regression remains unresolved after the fix."],
        }
        logger.info("Fallback planner selected verification-fix task.")
        return task

    if deploy_state.get("last_deploy_status") in {"failed", "rollback_failed"}:
        reason = str(deploy_state.get("last_failure_reason", "The last deploy did not complete cleanly."))
        task = {
            "task_id": _next_sequence(paths),
            "title": "Stabilize deployment flow",
            "reason": "Deployment health issues outrank new work.",
            "goal_gap": reason,
            "acceptance_criteria": [
                "The candidate SHA can be deployed and passes readiness checks.",
                "Rollback metadata remains intact if the next deploy fails.",
            ],
            "affected_areas": ["deploy", "infra"],
            "risk_level": "high",
            "needs_deploy": True,
            "stop_if": ["The deployment path still cannot prove the exact SHA is running."],
        }
        logger.info("Fallback planner selected deploy-fix task.")
        return task

    tasks = backlog.get("tasks", [])
    pending = [task for task in tasks if str(task.get("status", "pending")) == "pending"]
    if pending:
        selected = sorted(pending, key=_category_rank)[0]
        selected.setdefault("task_id", _next_sequence(paths))
        logger.info("Fallback planner selected backlog task %s.", selected["task_id"])
        return _validate_task(selected)

    unchecked = _first_unchecked_acceptance_item(paths)
    if unchecked:
        task = {
            "task_id": _next_sequence(paths),
            "title": "Close the next acceptance gap",
            "reason": "A core acceptance criterion is still unchecked.",
            "goal_gap": unchecked,
            "acceptance_criteria": [unchecked],
            "affected_areas": ["backend", "frontend"],
            "risk_level": "medium",
            "needs_deploy": True,
            "stop_if": ["The acceptance criterion remains unchecked after the deploy verification run."],
        }
        logger.info("Fallback planner selected acceptance-gap task.")
        return task

    logger.info("Fallback planner reached the goal state.")
    return _goal_reached_task()


def plan_next_task(config: AppConfig, paths: StatePaths, logger) -> dict[str, Any]:
    prompt_values = {
        "repo_root": str(config.repo_root),
        "product_goal_path": str(paths.product_goal),
        "acceptance_criteria_path": str(paths.acceptance_criteria),
        "current_state_path": str(paths.current_state),
        "verification_report_path": str(paths.verification_report),
        "planner_state_path": str(paths.planner_state),
        "backlog_path": str(paths.backlog),
        "deploy_state_path": str(paths.deploy_state),
        "next_task_output_path": str(paths.next_task),
    }

    if config.planner.mode == "command" and config.planner.command:
        prompt = render_template(_load_text(paths.planner_prompt), prompt_values)
        command = render_tokens(config.planner.command.command, prompt_values)
        result = run_command(command, cwd=config.repo_root, timeout_seconds=config.planner.command.timeout_seconds, stdin_text=prompt)
        _write_stage_log(
            paths,
            "planner",
            f"$ {' '.join(command)}\n\nPROMPT:\n{prompt}\n\nSTDOUT:\n{result.stdout}\n\nSTDERR:\n{result.stderr}",
        )
        if result.returncode == 0:
            planned_task = _validate_task(load_json(paths.next_task))
            logger.info("Planner produced task %s.", planned_task["task_id"])
            return planned_task
        if not config.planner.fallback_to_backlog:
            raise RuntimeError(f"Planner command failed with exit code {result.returncode}.")
        logger.warning("Planner command failed, falling back to backlog rules.")

    task = _fallback_plan(paths, logger)
    save_json(paths.next_task, task)
    return task


def _validate_builder_result(result: dict[str, Any]) -> dict[str, Any]:
    required = {
        "task_id": str,
        "changed_files": list,
        "summary": str,
        "local_checks": dict,
        "ready_for_deploy": bool,
        "known_issues": list,
    }
    for key, expected_type in required.items():
        value = result.get(key)
        if not isinstance(value, expected_type):
            raise RuntimeError(f"Builder result missing `{key}` or type was invalid.")

    for name, status in result["local_checks"].items():
        if status not in VALID_CHECK_VALUES:
            raise RuntimeError(f"Builder local check `{name}` has invalid value `{status}`.")

    return result


def run_builder(config: AppConfig, paths: StatePaths, task: dict[str, Any], logger) -> dict[str, Any]:
    prompt_values = {
        "repo_root": str(config.repo_root),
        "task_json_path": str(paths.next_task),
        "builder_result_output_path": str(paths.builder_result),
        "verification_report_path": str(paths.verification_report),
        "current_state_path": str(paths.current_state),
        "deploy_state_path": str(paths.deploy_state),
    }
    prompt = render_template(_load_text(paths.builder_prompt), prompt_values)
    command = render_tokens(config.builder.command.command, prompt_values)
    result = run_command(command, cwd=config.repo_root, timeout_seconds=config.builder.command.timeout_seconds, stdin_text=prompt)
    _write_stage_log(
        paths,
        "builder",
        f"$ {' '.join(command)}\n\nPROMPT:\n{prompt}\n\nSTDOUT:\n{result.stdout}\n\nSTDERR:\n{result.stderr}",
    )
    if result.returncode != 0:
        raise RuntimeError(f"Builder command failed with exit code {result.returncode}.")

    builder_result = _validate_builder_result(load_json(paths.builder_result))
    if not builder_result.get("commit_sha"):
        builder_result["commit_sha"] = run_git(config.repo_root, "rev-parse", "HEAD")
    if not builder_result.get("branch"):
        builder_result["branch"] = run_git(config.repo_root, "rev-parse", "--abbrev-ref", "HEAD")
    save_json(paths.builder_result, builder_result)
    logger.info("Builder completed task %s.", task["task_id"])
    return builder_result


def _has_failed_local_checks(builder_result: dict[str, Any]) -> bool:
    return any(status == "fail" for status in builder_result.get("local_checks", {}).values())


def _wait_for_remote_push(config: AppConfig, branch: str, sha: str, logger) -> None:
    deadline = time.time() + config.control.remote_push_timeout_seconds
    while time.time() < deadline:
        remote_ref = run_git(config.repo_root, "ls-remote", config.git.remote, f"refs/heads/{branch}")
        if remote_ref:
            remote_sha = remote_ref.split()[0].strip()
            if remote_sha == sha:
                logger.info("Remote branch %s now points to %s.", branch, sha)
                return
        time.sleep(5)
    raise RuntimeError(f"Timed out waiting for `{config.git.remote}/{branch}` to reach commit {sha}.")


def _http_json(url: str, headers: dict[str, str] | None = None, timeout_seconds: int = 15) -> dict[str, Any]:
    request = Request(url, headers={"Accept": "application/json", **(headers or {})})
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            payload = json.loads(response.read().decode("utf-8"))
            if not isinstance(payload, dict):
                raise RuntimeError(f"{url} returned JSON that was not an object.")
            return payload
    except HTTPError as error:
        raise RuntimeError(f"{url} returned HTTP {error.code}: {error.read().decode('utf-8')[:300]}") from error
    except URLError as error:
        raise RuntimeError(f"{url} request failed: {error.reason}") from error


def _wait_for_ci(config: AppConfig, sha: str, logger) -> None:
    if not config.github.repo:
        logger.info("GitHub repository slug not configured; skipping CI status polling.")
        return

    token = os.getenv(config.github.token_env, "").strip()
    if not token:
        logger.info("GitHub token env `%s` is not set; skipping CI status polling.", config.github.token_env)
        return

    deadline = time.time() + config.github.timeout_seconds
    runs_url = f"https://api.github.com/repos/{config.github.repo}/actions/runs?head_sha={sha}&per_page=20"
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "mytrader-agent-control",
    }

    while time.time() < deadline:
        payload = _http_json(runs_url, headers=headers, timeout_seconds=20)
        runs = payload.get("workflow_runs", [])
        matching_runs = [
            run
            for run in runs
            if str(run.get("path", "")).endswith(config.github.workflow_file)
            or str(run.get("name", "")) == "Build and Push Docker Images"
        ]
        if matching_runs:
            run = matching_runs[0]
            status = str(run.get("status", ""))
            conclusion = str(run.get("conclusion", ""))
            logger.info("GitHub Actions status for %s: %s / %s", sha, status, conclusion or "pending")
            if status == "completed":
                if conclusion == "success":
                    return
                raise RuntimeError(f"GitHub Actions workflow failed for {sha} with conclusion `{conclusion}`.")
        time.sleep(config.github.poll_interval_seconds)

    raise RuntimeError(f"Timed out waiting for GitHub Actions workflow `{config.github.workflow_file}` for {sha}.")


def _docker_hub_token(namespace: str, repo: str) -> str:
    scope = f"repository:{namespace}/{repo}:pull"
    url = f"https://auth.docker.io/token?service=registry.docker.io&scope={scope}"
    payload = _http_json(url, timeout_seconds=20)
    token = str(payload.get("token", ""))
    if not token:
        raise RuntimeError(f"Unable to obtain Docker Hub token for {namespace}/{repo}.")
    return token


def _docker_tag_exists(namespace: str, repo: str, tag: str) -> bool:
    token = _docker_hub_token(namespace, repo)
    url = f"https://registry-1.docker.io/v2/{namespace}/{repo}/manifests/{tag}"
    request = Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.docker.distribution.manifest.v2+json",
            "User-Agent": "mytrader-agent-control",
        },
        method="GET",
    )
    try:
        with urlopen(request, timeout=20) as response:
            return response.status == 200
    except HTTPError as error:
        if error.code == 404:
            return False
        raise RuntimeError(f"Docker Hub lookup failed for {namespace}/{repo}:{tag} with HTTP {error.code}.") from error
    except URLError as error:
        raise RuntimeError(f"Docker Hub lookup failed for {namespace}/{repo}:{tag}: {error.reason}") from error


def _wait_for_images(config: AppConfig, sha: str, logger) -> None:
    deadline = time.time() + config.docker_hub.timeout_seconds
    while time.time() < deadline:
        backend_ready = _docker_tag_exists(config.docker_hub.namespace, config.docker_hub.backend_repo, sha)
        frontend_ready = _docker_tag_exists(config.docker_hub.namespace, config.docker_hub.frontend_repo, sha)
        logger.info("Image availability for %s -> backend=%s frontend=%s", sha, backend_ready, frontend_ready)
        if backend_ready and frontend_ready:
            return
        time.sleep(config.docker_hub.poll_interval_seconds)

    raise RuntimeError(f"Timed out waiting for Docker Hub images tagged `{sha}`.")


def _require_deploy_config(config: AppConfig) -> None:
    missing = []
    if not config.deploy.ssh_target:
        missing.append("deploy.ssh_target")
    if not config.deploy.remote_compose_dir:
        missing.append("deploy.remote_compose_dir")
    if not config.deploy.frontend_url:
        missing.append("deploy.frontend_url")
    if not config.deploy.backend_url:
        missing.append("deploy.backend_url")
    if missing:
        raise RuntimeError(f"Missing deploy configuration values: {', '.join(missing)}")


def _remote_update_script(config: AppConfig, backend_tag: str, frontend_tag: str) -> str:
    env_path = json.dumps(config.deploy.remote_env_file)
    compose_dir = shlex.quote(config.deploy.remote_compose_dir)
    compose_file = shlex.quote(config.deploy.remote_compose_file)
    prune_block = "docker image prune -f\n" if config.deploy.prune_images else ""
    return f"""set -euo pipefail
python3 - <<'PY'
from pathlib import Path

env_path = Path({env_path})
updates = {{
    "BACKEND_TAG": {json.dumps(backend_tag)},
    "FRONTEND_TAG": {json.dumps(frontend_tag)},
}}

lines = []
if env_path.exists():
    lines = env_path.read_text(encoding="utf-8").splitlines()

kept = []
seen = set()
for line in lines:
    if "=" in line and not line.lstrip().startswith("#"):
        key = line.split("=", 1)[0].strip()
        if key in updates:
            kept.append(f"{{key}}={{updates[key]}}")
            seen.add(key)
            continue
    kept.append(line)

for key, value in updates.items():
    if key not in seen:
        kept.append(f"{{key}}={{value}}")

env_path.write_text("\\n".join(kept).rstrip() + "\\n", encoding="utf-8")
PY
cd {compose_dir}
docker compose --env-file {shlex.quote(config.deploy.remote_env_file)} -f {compose_file} pull backend frontend
docker compose --env-file {shlex.quote(config.deploy.remote_env_file)} -f {compose_file} up -d backend frontend
{prune_block}"""


def _deploy_tags(config: AppConfig, paths: StatePaths, backend_tag: str, frontend_tag: str, logger) -> None:
    _require_deploy_config(config)
    script = _remote_update_script(config, backend_tag, frontend_tag)
    command = ["ssh", "-p", str(config.deploy.ssh_port), config.deploy.ssh_target, "bash", "-s"]
    result = run_command(command, cwd=config.repo_root, timeout_seconds=900, stdin_text=script)
    _write_stage_log(
        paths,
        "deploy",
        f"$ {' '.join(command)}\n\nSCRIPT:\n{script}\n\nSTDOUT:\n{result.stdout}\n\nSTDERR:\n{result.stderr}",
    )
    if result.returncode != 0:
        raise RuntimeError(f"Remote deploy command failed with exit code {result.returncode}.")
    logger.info("Remote deploy completed for backend=%s frontend=%s.", backend_tag, frontend_tag)


def _check_readiness_once(config: AppConfig, expected_sha: str) -> tuple[bool, str]:
    frontend_health_request = Request(f"{config.deploy.frontend_url}/health")
    with urlopen(frontend_health_request, timeout=10) as response:
        frontend_health = response.read().decode("utf-8")
        if response.status != 200 or "ok" not in frontend_health.lower():
            return False, "Frontend health endpoint did not report ok."

    frontend_version = _http_json(f"{config.deploy.frontend_url}/version.json", timeout_seconds=10)
    if frontend_version.get("version") != expected_sha:
        return False, f"Frontend version mismatch: expected {expected_sha}, got {frontend_version.get('version')}"

    backend_ready = _http_json(f"{config.deploy.backend_url}/ready", timeout_seconds=10)
    if backend_ready.get("status") != "ok" or backend_ready.get("db") != "ok":
        return False, f"Backend readiness not healthy yet: {json.dumps(backend_ready)}"
    if backend_ready.get("version") != expected_sha:
        return False, f"Backend version mismatch: expected {expected_sha}, got {backend_ready.get('version')}"

    return True, "Ready"


def _wait_for_app(config: AppConfig, expected_sha: str, logger) -> None:
    time.sleep(config.deploy.initial_wait_seconds)
    deadline = time.time() + config.deploy.readiness_timeout_seconds
    last_message = "No readiness checks executed."
    while time.time() < deadline:
        try:
            ready, last_message = _check_readiness_once(config, expected_sha)
            if ready:
                logger.info("Readiness checks passed for %s.", expected_sha)
                return
        except Exception as error:  # noqa: BLE001
            last_message = str(error)
        logger.info("App not ready yet: %s", last_message)
        time.sleep(config.deploy.poll_interval_seconds)
    raise RuntimeError(f"Timed out waiting for deployed app readiness: {last_message}")


def _prepare_rollback(paths: StatePaths, reason: str) -> dict[str, Any]:
    deploy_state = load_json(paths.deploy_state)
    prepared = {
        "backend_tag": deploy_state.get("last_good_backend_tag", ""),
        "frontend_tag": deploy_state.get("last_good_frontend_tag", ""),
        "prepared_at": iso_now(),
    }
    update_deploy_state(
        paths,
        last_failure_reason=reason,
        prepared_rollback=prepared,
    )
    return prepared


def _handle_failure(config: AppConfig, paths: StatePaths, logger, reason: str) -> str:
    prepared = _prepare_rollback(paths, reason)
    backend_tag = str(prepared.get("backend_tag", ""))
    frontend_tag = str(prepared.get("frontend_tag", ""))
    if not backend_tag or not frontend_tag:
        logger.warning("Rollback requested but no last-known-good tags are recorded.")
        return "continue"

    safety_mode = config.control.safety_mode
    if safety_mode == "rollback_on_failure":
        logger.warning("Executing rollback to backend=%s frontend=%s.", backend_tag, frontend_tag)
        _deploy_tags(config, paths, backend_tag, frontend_tag, logger)
        _wait_for_app(config, backend_tag, logger)
        update_deploy_state(
            paths,
            current_backend_tag=backend_tag,
            current_frontend_tag=frontend_tag,
            current_candidate_tag=backend_tag,
            last_deploy_status="rolled_back",
            last_deployed_at=iso_now(),
        )
        return "rollback"
    logger.warning("Rollback prepared but not executed because safety_mode=%s.", safety_mode)
    return "prepare_rollback"


def _mark_task_done(paths: StatePaths, task: dict[str, Any], status: str) -> None:
    planner_state = load_json(paths.planner_state)
    completed = [entry for entry in planner_state.get("completed_tasks", []) if isinstance(entry, dict)]
    completed.append(
        {
            "task_id": task.get("task_id", ""),
            "title": task.get("title", ""),
            "completed_at": iso_now(),
            "status": status,
        }
    )
    update_planner_state(
        paths,
        last_planned_task_id=task.get("task_id", ""),
        last_completed_task_id=task.get("task_id", ""),
        last_completed_at=iso_now(),
        last_cycle_status=status,
        completed_tasks=completed,
        last_error="",
    )


def run_cycle(config: AppConfig, paths: StatePaths, logger) -> None:
    for cycle_number in range(1, config.control.cycle_limit + 1):
        logger.info("Starting cycle %s of %s.", cycle_number, config.control.cycle_limit)

        _transition(paths, "PLANNING", logger, last_cycle_status="planning")
        task = plan_next_task(config, paths, logger)
        save_json(paths.next_task, task)
        update_planner_state(paths, last_planned_task_id=task.get("task_id", ""))

        if task["task_id"] == "GOAL-REACHED":
            _transition(paths, "DONE", logger, last_cycle_status="goal_reached")
            return

        _transition(paths, "CODING", logger, last_cycle_status="coding")
        builder_result = run_builder(config, paths, task, logger)
        if builder_result["task_id"] and builder_result["task_id"] != task["task_id"]:
            raise RuntimeError("Builder result task_id does not match the planned task.")

        if _has_failed_local_checks(builder_result) or not builder_result.get("ready_for_deploy", False):
            update_planner_state(
                paths,
                last_cycle_status="failed_local_checks",
                last_error="Builder validation failed or task was not ready for deploy.",
            )
            raise RuntimeError("Builder reported failed local checks or the task is not ready for deploy.")

        commit_sha = str(builder_result.get("commit_sha", "")).strip() or run_git(config.repo_root, "rev-parse", "HEAD")
        branch = str(builder_result.get("branch", "")).strip() or run_git(config.repo_root, "rev-parse", "--abbrev-ref", "HEAD")

        if not task.get("needs_deploy", True):
            verification = load_json(paths.verification_report)
            _mark_task_done(paths, task, "completed")
            refresh_current_state_markdown(
                paths,
                head_sha=commit_sha,
                task_title=str(task.get("title", "")),
                verification_status=str(verification.get("status", "unknown")),
                deployed_version=str(verification.get("version", "")),
                backlog_count=len(load_json(paths.backlog).get("tasks", [])),
            )
            _transition(paths, "DONE", logger, last_cycle_status="completed_without_deploy")
            continue

        _transition(paths, "WAITING_FOR_PUSH", logger, last_cycle_status="waiting_for_push")
        _wait_for_remote_push(config, branch, commit_sha, logger)

        _transition(paths, "WAITING_FOR_CI", logger, last_cycle_status="waiting_for_ci")
        _wait_for_ci(config, commit_sha, logger)

        _transition(paths, "WAITING_FOR_IMAGE", logger, last_cycle_status="waiting_for_image")
        _wait_for_images(config, commit_sha, logger)

        update_deploy_state(
            paths,
            current_backend_tag=commit_sha,
            current_frontend_tag=commit_sha,
            current_candidate_tag=commit_sha,
            last_deploy_status="deploying",
            last_deployed_at="",
            last_failure_reason="",
        )

        _transition(paths, "DEPLOYING", logger, last_cycle_status="deploying")
        _deploy_tags(config, paths, commit_sha, commit_sha, logger)

        try:
            _transition(paths, "WAITING_FOR_APP", logger, last_cycle_status="waiting_for_app")
            _wait_for_app(config, commit_sha, logger)
        except Exception as error:  # noqa: BLE001
            update_deploy_state(paths, last_deploy_status="failed", last_failure_reason=str(error))
            action = _handle_failure(config, paths, logger, str(error))
            update_planner_state(paths, last_cycle_status="failed", last_error=str(error))
            raise RuntimeError(f"Deploy readiness failed. Action taken: {action}.") from error

        _transition(paths, "VERIFYING", logger, last_cycle_status="verifying")
        verification = run_verification(config, paths, commit_sha, logger)
        if verification["status"] == "fail":
            update_deploy_state(paths, last_deploy_status="failed", last_failure_reason="Verification failed.")
            action = _handle_failure(config, paths, logger, "Verification failed.")
            update_planner_state(paths, last_cycle_status="failed", last_error="Verification failed.")
            raise RuntimeError(f"Post-deploy verification failed. Action taken: {action}.")

        update_deploy_state(
            paths,
            last_good_backend_tag=commit_sha,
            last_good_frontend_tag=commit_sha,
            current_backend_tag=commit_sha,
            current_frontend_tag=commit_sha,
            current_candidate_tag=commit_sha,
            last_deploy_status="verified",
            last_deployed_at=iso_now(),
            prepared_rollback={"backend_tag": "", "frontend_tag": "", "prepared_at": ""},
        )
        _mark_task_done(paths, task, "completed")
        refresh_current_state_markdown(
            paths,
            head_sha=commit_sha,
            task_title=str(task.get("title", "")),
            verification_status=str(verification.get("status", "unknown")),
            deployed_version=str(verification.get("version", "")),
            backlog_count=len(load_json(paths.backlog).get("tasks", [])),
        )
        _transition(paths, "DONE", logger, last_cycle_status="completed")

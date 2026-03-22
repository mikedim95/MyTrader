from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import AppConfig
from .shell import run_command
from .state import StatePaths, save_json


def _http_request(
    method: str,
    url: str,
    *,
    body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout_seconds: int = 15,
) -> tuple[int, str]:
    payload = None
    request_headers = {"Accept": "application/json", **(headers or {})}
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        request_headers["Content-Type"] = "application/json"

    request = Request(url, method=method, data=payload, headers=request_headers)
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            return response.getcode(), response.read().decode("utf-8")
    except HTTPError as error:
        return error.code, error.read().decode("utf-8")
    except URLError as error:
        raise RuntimeError(f"{method} {url} failed: {error.reason}") from error


def _load_json_response(status_code: int, body: str, url: str) -> dict[str, Any]:
    if status_code >= 400:
        raise RuntimeError(f"{url} returned HTTP {status_code}: {body[:300]}")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"{url} did not return valid JSON.") from error
    if not isinstance(payload, dict):
        raise RuntimeError(f"{url} returned JSON that was not an object.")
    return payload


def _build_session_headers(session: dict[str, Any]) -> dict[str, str]:
    if isinstance(session.get("userId"), int):
        return {"x-user-id": str(session["userId"])}
    if isinstance(session.get("username"), str) and session["username"].strip():
        return {"x-user": session["username"].strip()}
    return {}


def _run_browser_smoke(
    config: AppConfig,
    paths: StatePaths,
    expected_sha: str,
    username: str,
    password: str,
) -> tuple[str, list[str]]:
    command = [
        "node",
        str(paths.browser_smoke_script),
        config.deploy.frontend_url,
        expected_sha,
        username,
        password,
        str(config.verification.browser_timeout_seconds),
    ]
    result = run_command(command, cwd=config.repo_root, timeout_seconds=config.verification.browser_timeout_seconds + 30)
    stdout = result.stdout.strip()
    if result.returncode == 0:
        payload = json.loads(stdout or "{}")
        return "pass", [str(note) for note in payload.get("notes", [])]
    if result.returncode == 40:
        payload = json.loads(stdout or "{}")
        return "skipped", [str(note) for note in payload.get("notes", [])]

    details = stdout or result.stderr.strip() or "Browser smoke failed."
    return "fail", [details]


def run_verification(config: AppConfig, paths: StatePaths, expected_sha: str, logger) -> dict[str, Any]:
    passed: list[str] = []
    failed: list[str] = []
    regressions: list[str] = []
    notes: list[str] = []
    session_username = config.verification.session_username.strip()
    session_password = config.verification.session_password.strip()

    try:
        status_code, body = _http_request("GET", f"{config.deploy.frontend_url}/", timeout_seconds=15)
        if status_code == 200 and '<div id="root">' in body:
            passed.append("Frontend root page loaded.")
        else:
            failed.append(f"Frontend root page check failed with HTTP {status_code}.")
    except Exception as error:  # noqa: BLE001
        failed.append(str(error))

    try:
        status_code, body = _http_request("GET", f"{config.deploy.frontend_url}/health", timeout_seconds=10)
        if status_code == 200 and "ok" in body.lower():
            passed.append("Frontend health endpoint responded.")
        else:
            failed.append(f"Frontend health endpoint check failed with HTTP {status_code}.")
    except Exception as error:  # noqa: BLE001
        failed.append(str(error))

    try:
        status_code, body = _http_request("GET", f"{config.deploy.frontend_url}/version.json", timeout_seconds=10)
        payload = _load_json_response(status_code, body, f"{config.deploy.frontend_url}/version.json")
        if payload.get("version") == expected_sha:
            passed.append("Frontend deployed version matches the expected git SHA.")
        else:
            failed.append(
                f"Frontend deployed version mismatch: expected `{expected_sha}`, got `{payload.get('version', 'unknown')}`."
            )
    except Exception as error:  # noqa: BLE001
        failed.append(str(error))

    try:
        status_code, body = _http_request("GET", f"{config.deploy.backend_url}/ready", timeout_seconds=10)
        ready = _load_json_response(status_code, body, f"{config.deploy.backend_url}/ready")
        if ready.get("status") == "ok" and ready.get("db") == "ok" and ready.get("version") == expected_sha:
            passed.append("Backend readiness endpoint is healthy and reports the expected version.")
        else:
            failed.append(f"Backend readiness payload was unhealthy: {json.dumps(ready)}")
    except Exception as error:  # noqa: BLE001
        failed.append(str(error))

    session_status: dict[str, Any] | None = None
    try:
        status_code, body = _http_request("GET", f"{config.deploy.backend_url}/api/session/status", timeout_seconds=10)
        session_status = _load_json_response(status_code, body, f"{config.deploy.backend_url}/api/session/status")
        passed.append("Backend session status endpoint responded.")
    except Exception as error:  # noqa: BLE001
        failed.append(str(error))

    if session_status and (not session_username or not session_password):
        dummy_credentials = session_status.get("dummyCredentials") or []
        if isinstance(dummy_credentials, list) and dummy_credentials:
            first = dummy_credentials[0] or {}
            if isinstance(first, dict):
                session_username = str(first.get("username", "")).strip()
                session_password = str(first.get("password", "")).strip()

    if session_username and session_password:
        try:
            status_code, body = _http_request(
                "POST",
                f"{config.deploy.backend_url}/api/session/login",
                body={"username": session_username, "password": session_password},
                timeout_seconds=15,
            )
            login = _load_json_response(status_code, body, f"{config.deploy.backend_url}/api/session/login")
            session_headers = _build_session_headers(login.get("session", {}))
            if session_headers:
                passed.append("Auth login flow completed.")
            else:
                failed.append("Login response did not include a usable session identity.")
                session_headers = {}

            if session_headers:
                status_code, body = _http_request(
                    "GET",
                    f"{config.deploy.backend_url}/api/dashboard?accountType=demo",
                    headers=session_headers,
                    timeout_seconds=20,
                )
                dashboard = _load_json_response(
                    status_code,
                    body,
                    f"{config.deploy.backend_url}/api/dashboard?accountType=demo",
                )
                if "assets" in dashboard and "connection" in dashboard:
                    passed.append("Authenticated demo dashboard path returned data.")
                else:
                    failed.append("Authenticated dashboard response was missing expected fields.")
        except Exception as error:  # noqa: BLE001
            regressions.append(f"Auth or authenticated demo path failed: {error}")
    else:
        notes.append("Auth smoke was skipped because no verification credentials or dummy credentials were available.")

    if config.verification.run_browser_smoke:
        smoke_status, smoke_notes = _run_browser_smoke(config, paths, expected_sha, session_username, session_password)
        if smoke_status == "pass":
            passed.append("Browser smoke check passed.")
        elif smoke_status == "skipped":
            notes.extend(smoke_notes)
        else:
            regressions.extend(smoke_notes)
    else:
        notes.append("Browser smoke check is disabled in config.")

    if failed or regressions:
        status = "fail"
        recommended_action = "rollback"
    elif notes:
        status = "partial_pass"
        recommended_action = "continue"
    else:
        status = "pass"
        recommended_action = "continue"

    report = {
        "status": status,
        "version": expected_sha,
        "passed": passed,
        "failed": failed,
        "regressions": regressions,
        "notes": notes,
        "recommended_action": recommended_action,
    }
    save_json(paths.verification_report, report)
    logger.info("Verification completed with status=%s", status)
    return report

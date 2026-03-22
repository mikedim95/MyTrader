from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path


DEFAULT_CODEX_COMMAND = [
    "codex",
    "--dangerously-bypass-approvals-and-sandbox",
    "exec",
    "--cd",
    "{repo_root}",
    "-",
]


@dataclass(frozen=True)
class CommandConfig:
    command: list[str]
    timeout_seconds: int


@dataclass(frozen=True)
class PlannerConfig:
    mode: str
    command: CommandConfig | None
    fallback_to_backlog: bool


@dataclass(frozen=True)
class BuilderConfig:
    command: CommandConfig


@dataclass(frozen=True)
class GitConfig:
    remote: str
    default_branch: str


@dataclass(frozen=True)
class GitHubConfig:
    repo: str
    workflow_file: str
    token_env: str
    poll_interval_seconds: int
    timeout_seconds: int


@dataclass(frozen=True)
class DockerHubConfig:
    namespace: str
    backend_repo: str
    frontend_repo: str
    poll_interval_seconds: int
    timeout_seconds: int


@dataclass(frozen=True)
class DeployConfig:
    ssh_target: str
    ssh_port: int
    remote_compose_dir: str
    remote_compose_file: str
    remote_env_file: str
    prune_images: bool
    initial_wait_seconds: int
    readiness_timeout_seconds: int
    poll_interval_seconds: int
    frontend_url: str
    backend_url: str


@dataclass(frozen=True)
class VerificationConfig:
    session_username: str
    session_password: str
    run_browser_smoke: bool
    browser_timeout_seconds: int


@dataclass(frozen=True)
class ControlConfig:
    cycle_limit: int
    remote_push_timeout_seconds: int
    safety_mode: str


@dataclass(frozen=True)
class AppConfig:
    repo_root: Path
    control_dir: Path
    planner: PlannerConfig
    builder: BuilderConfig
    git: GitConfig
    github: GitHubConfig
    docker_hub: DockerHubConfig
    deploy: DeployConfig
    verification: VerificationConfig
    control: ControlConfig


def _read_json(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _parse_repo_from_remote(repo_root: Path, remote: str) -> str:
    try:
        result = subprocess.run(
            ["git", "remote", "get-url", remote],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return ""

    remote_url = result.stdout.strip()
    if remote_url.startswith("git@github.com:"):
        repo = remote_url.split("git@github.com:", 1)[1]
    elif "github.com/" in remote_url:
        repo = remote_url.split("github.com/", 1)[1]
    else:
        return ""

    if repo.endswith(".git"):
        repo = repo[:-4]
    return repo.strip("/")


def load_config(config_path: Path, repo_root: Path) -> AppConfig:
    raw = _read_json(config_path)

    planner_raw = raw.get("planner", {})
    builder_raw = raw.get("builder", {})
    git_raw = raw.get("git", {})
    github_raw = raw.get("github", {})
    docker_raw = raw.get("docker_hub", {})
    deploy_raw = raw.get("deploy", {})
    verification_raw = raw.get("verification", {})
    control_raw = raw.get("control", {})

    git_remote = str(git_raw.get("remote", "origin"))
    github_repo = str(github_raw.get("repo", "")).strip() or _parse_repo_from_remote(repo_root, git_remote)

    planner_command = planner_raw.get("command")
    builder_command = builder_raw.get("command")

    planner = PlannerConfig(
        mode=str(planner_raw.get("mode", "command")),
        command=CommandConfig(
            command=[str(token) for token in (planner_command or DEFAULT_CODEX_COMMAND)],
            timeout_seconds=int(planner_raw.get("timeout_seconds", 900)),
        )
        if str(planner_raw.get("mode", "command")) == "command"
        else None,
        fallback_to_backlog=bool(planner_raw.get("fallback_to_backlog", True)),
    )

    builder = BuilderConfig(
        command=CommandConfig(
            command=[str(token) for token in (builder_command or DEFAULT_CODEX_COMMAND)],
            timeout_seconds=int(builder_raw.get("timeout_seconds", 7200)),
        )
    )

    git = GitConfig(
        remote=git_remote,
        default_branch=str(git_raw.get("default_branch", "main")),
    )

    github = GitHubConfig(
        repo=github_repo,
        workflow_file=str(github_raw.get("workflow_file", "docker-publish.yml")),
        token_env=str(github_raw.get("token_env", "GITHUB_TOKEN")),
        poll_interval_seconds=int(github_raw.get("poll_interval_seconds", 20)),
        timeout_seconds=int(github_raw.get("timeout_seconds", 1800)),
    )

    docker_hub = DockerHubConfig(
        namespace=str(docker_raw.get("namespace", "mikedim95")),
        backend_repo=str(docker_raw.get("backend_repo", "mytrader-backend")),
        frontend_repo=str(docker_raw.get("frontend_repo", "mytrader-frontend")),
        poll_interval_seconds=int(docker_raw.get("poll_interval_seconds", 20)),
        timeout_seconds=int(docker_raw.get("timeout_seconds", 1800)),
    )

    deploy = DeployConfig(
        ssh_target=str(deploy_raw.get("ssh_target", "")),
        ssh_port=int(deploy_raw.get("ssh_port", 22)),
        remote_compose_dir=str(deploy_raw.get("remote_compose_dir", "")),
        remote_compose_file=str(deploy_raw.get("remote_compose_file", "docker-compose.yml")),
        remote_env_file=str(deploy_raw.get("remote_env_file", ".env")),
        prune_images=bool(deploy_raw.get("prune_images", False)),
        initial_wait_seconds=int(deploy_raw.get("initial_wait_seconds", 15)),
        readiness_timeout_seconds=int(deploy_raw.get("readiness_timeout_seconds", 240)),
        poll_interval_seconds=int(deploy_raw.get("poll_interval_seconds", 5)),
        frontend_url=str(deploy_raw.get("frontend_url", "")).rstrip("/"),
        backend_url=str(deploy_raw.get("backend_url", "")).rstrip("/"),
    )

    verification = VerificationConfig(
        session_username=str(verification_raw.get("session_username", "")),
        session_password=str(verification_raw.get("session_password", "")),
        run_browser_smoke=bool(verification_raw.get("run_browser_smoke", False)),
        browser_timeout_seconds=int(verification_raw.get("browser_timeout_seconds", 120)),
    )

    control = ControlConfig(
        cycle_limit=max(1, int(control_raw.get("cycle_limit", 1))),
        remote_push_timeout_seconds=int(control_raw.get("remote_push_timeout_seconds", 120)),
        safety_mode=str(control_raw.get("safety_mode", "prepare_rollback")),
    )

    return AppConfig(
        repo_root=repo_root,
        control_dir=config_path.parent,
        planner=planner,
        builder=builder,
        git=git,
        github=github,
        docker_hub=docker_hub,
        deploy=deploy,
        verification=verification,
        control=control,
    )

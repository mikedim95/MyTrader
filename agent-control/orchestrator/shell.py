from __future__ import annotations

import subprocess
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class CommandResult:
    command: list[str]
    returncode: int
    stdout: str
    stderr: str
    duration_seconds: float


class SafeFormatDict(dict):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def render_tokens(tokens: list[str], values: dict[str, str]) -> list[str]:
    safe_values = SafeFormatDict(values)
    return [token.format_map(safe_values) for token in tokens]


def render_template(text: str, values: dict[str, str]) -> str:
    return text.format_map(SafeFormatDict(values))


def run_command(
    command: list[str],
    cwd: Path,
    timeout_seconds: int,
    stdin_text: str | None = None,
) -> CommandResult:
    started = time.monotonic()
    completed = subprocess.run(
        command,
        cwd=cwd,
        input=stdin_text,
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        check=False,
    )
    duration = time.monotonic() - started
    return CommandResult(
        command=command,
        returncode=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
        duration_seconds=duration,
    )


def run_git(repo_root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()

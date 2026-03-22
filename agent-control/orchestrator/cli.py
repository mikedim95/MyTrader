from __future__ import annotations

import argparse
import logging
import os
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path

from .config import load_config
from .state import build_state_paths, ensure_control_files, update_planner_state
from .workflow import run_cycle


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _default_config_path(repo_root: Path) -> Path:
    config_path = repo_root / "agent-control" / "config.json"
    if config_path.exists():
        return config_path
    return repo_root / "agent-control" / "config.example.json"


def _build_logger(log_file: Path) -> logging.Logger:
    logger = logging.getLogger("agent-control")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setFormatter(formatter)
    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)

    logger.addHandler(file_handler)
    logger.addHandler(stream_handler)
    return logger


@contextmanager
def _acquire_lock(lock_file: Path):
    lock_file.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(lock_file, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as error:
        raise RuntimeError(f"Lock file already exists: {lock_file}") from error

    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(str(os.getpid()))
        yield
    finally:
        try:
            lock_file.unlink()
        except FileNotFoundError:
            pass


def main() -> int:
    repo_root = _repo_root()
    parser = argparse.ArgumentParser(description="Run the MyTrader controlled autonomous delivery workflow.")
    parser.add_argument("--config", default=str(_default_config_path(repo_root)), help="Path to the workflow config JSON file.")
    parser.add_argument("--cycles", type=int, default=0, help="Override the configured maximum number of cycles.")
    args = parser.parse_args()

    config = load_config(Path(args.config), repo_root)
    if args.cycles > 0:
        config = replace(config, control=replace(config.control, cycle_limit=args.cycles))

    paths = build_state_paths(config.control_dir)
    ensure_control_files(paths)
    logger = _build_logger(paths.logs_dir / "orchestrator.log")

    with _acquire_lock(paths.lock_file):
        try:
            run_cycle(config, paths, logger)
            return 0
        except Exception as error:  # noqa: BLE001
            update_planner_state(paths, orchestrator_state="FAILED", last_cycle_status="failed", last_error=str(error))
            logger.exception("Workflow failed: %s", error)
            return 1

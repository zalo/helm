"""Artifact loader for Nautilus backtest results and risk analyses.

Two folders are searched, in priority order:

1. ``backend/data/{backtests,risk}/*.json`` — live results written at runtime.
2. ``backend/helm/data_seed/{backtests,risk}/*.json`` — committed examples
   that ship with the repo so the UI is never empty out of the box.

Each file is one artifact. The filename stem becomes the id when the JSON
doesn't carry one. Both list and detail views are dirt-cheap (no DB) so the
agent CLI can poll freely.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_LIVE_DIRS = {
    "backtests": _BACKEND_ROOT / "data" / "backtests",
    "risk": _BACKEND_ROOT / "data" / "risk",
}
_SEED_DIRS = {
    "backtests": _BACKEND_ROOT / "helm" / "data_seed" / "backtests",
    "risk": _BACKEND_ROOT / "helm" / "data_seed" / "risk",
}


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text())
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    data.setdefault("id", path.stem)
    return data


def list_artifacts(kind: str) -> list[dict[str, Any]]:
    """Return every artifact of ``kind`` from both live + seed dirs.

    Live takes precedence — if an id appears in both folders, the live file
    wins. Sorted by ``ts`` desc when present, else filename.
    """
    seen: dict[str, dict[str, Any]] = {}
    for d in (_SEED_DIRS[kind], _LIVE_DIRS[kind]):
        if not d.exists():
            continue
        for path in sorted(d.glob("*.json")):
            data = _read_json(path)
            if data is None:
                continue
            seen[data["id"]] = data
    items = list(seen.values())

    def _sort_key(it: dict[str, Any]) -> str:
        return str(it.get("ts") or it.get("end") or it.get("id") or "")

    items.sort(key=_sort_key, reverse=True)
    return items


def get_artifact(kind: str, artifact_id: str) -> dict[str, Any] | None:
    """Return one artifact by id; live takes precedence over seed."""
    for d in (_LIVE_DIRS[kind], _SEED_DIRS[kind]):
        if not d.exists():
            continue
        path = d / f"{artifact_id}.json"
        if path.exists():
            return _read_json(path)
    return None

#!/usr/bin/env python3
"""Stop hook — make sure the agent always ends a turn re-armed on `helm-agent sleep`.

Claude Code invokes Stop hooks after a turn finishes. Read the transcript file
referenced by ``transcript_path`` in the hook payload (passed on stdin), find
the last assistant action, and:

- If it was a Bash tool call running ``helm-agent sleep ...``  → allow the stop
  (exit 0). The agent has parked itself in trigger mode for the next message.
- Otherwise → exit 2 with a stderr message that Claude Code re-injects as the
  continuation prompt. Claude reads that and runs ``helm-agent sleep --on-event
  wake`` before its turn is allowed to end.

Stop hook contract (per Claude Code docs):
  stdin   : JSON  { transcript_path, ... }
  exit 0  : turn ends normally
  exit 2  : turn is blocked; stderr is fed back as a system prompt
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ARMED = re.compile(r"\bhelm-agent\b.*\bsleep\b.*--on-event\b.*\bwake\b")


def _read_payload() -> dict:
    try:
        return json.loads(sys.stdin.read() or "{}")
    except Exception:
        return {}


def _last_bash_command(transcript_path: str) -> str | None:
    """Walk the JSONL transcript backwards; return the most recent Bash tool command."""
    p = Path(transcript_path)
    if not p.exists():
        return None
    lines = p.read_text(errors="ignore").splitlines()
    for raw in reversed(lines):
        try:
            entry = json.loads(raw)
        except Exception:
            continue
        # Claude Code transcripts store assistant tool calls under message.content[].
        msg = entry.get("message") or entry
        content = msg.get("content") if isinstance(msg, dict) else None
        if not isinstance(content, list):
            continue
        for block in reversed(content):
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use" and block.get("name") == "Bash":
                cmd = (block.get("input") or {}).get("command")
                if isinstance(cmd, str):
                    return cmd
    return None


def main() -> int:
    payload = _read_payload()
    transcript = payload.get("transcript_path") or ""
    last = _last_bash_command(transcript) or ""
    if ARMED.search(last):
        return 0
    sys.stderr.write(
        "TURN-END GUARD: end every turn by re-arming the helm-agent CLI so "
        "the next wake event can fire. Run this now and wait on it:\n\n"
        "    helm-agent sleep --on-event wake\n\n"
        "When it returns, that is the next user/webui message — handle it, "
        "post a reply with `helm-agent say \"<reply>\"`, then re-arm again.\n"
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())

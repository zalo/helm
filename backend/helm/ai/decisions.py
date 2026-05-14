"""`DecisionStore` — in-memory store of AI trade decisions.

Holds the rolling decision history, supports newest-first listing, id lookup,
and post-trade updates (``realized_pnl`` / ``status``). Tracks ``decisions_today``
and ``win_rate`` for the AI status endpoint.
"""

from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from typing import Literal

from helm.models import AIDecision

DecisionStatus = Literal["proposed", "executed", "skipped", "rejected"]


class DecisionStore:
    def __init__(self, maxlen: int = 500) -> None:
        self._decisions: deque[AIDecision] = deque(maxlen=maxlen)
        self._by_id: dict[str, AIDecision] = {}

    def append(self, decision: AIDecision) -> AIDecision:
        # deque eviction: drop the index entry for anything that fell off.
        if len(self._decisions) == self._decisions.maxlen and self._decisions:
            evicted = self._decisions[0]
            self._by_id.pop(evicted.id, None)
        self._decisions.append(decision)
        self._by_id[decision.id] = decision
        return decision

    def list(self, limit: int = 100) -> list[AIDecision]:
        """Newest-first, capped at ``limit``."""
        items = list(self._decisions)
        items.reverse()
        return items[: max(0, limit)]

    def get(self, decision_id: str) -> AIDecision | None:
        return self._by_id.get(decision_id)

    def update(
        self,
        decision_id: str,
        *,
        realized_pnl: float | None = None,
        status: DecisionStatus | None = None,
        order_id: str | None = None,
    ) -> AIDecision | None:
        decision = self._by_id.get(decision_id)
        if decision is None:
            return None
        if realized_pnl is not None:
            decision.realized_pnl = realized_pnl
        if status is not None:
            decision.status = status
        if order_id is not None:
            decision.order_id = order_id
        return decision

    # -- aggregates ---------------------------------------------------------
    @property
    def decisions_today(self) -> int:
        today = datetime.now(timezone.utc).date()
        return sum(1 for d in self._decisions if d.ts.date() == today)

    @property
    def win_rate(self) -> float:
        """Fraction of *closed* trades (realized_pnl set) that were profitable."""
        closed = [d for d in self._decisions if d.realized_pnl is not None]
        if not closed:
            return 0.0
        wins = sum(1 for d in closed if (d.realized_pnl or 0.0) > 0)
        return round(wins / len(closed), 4)

    def __len__(self) -> int:
        return len(self._decisions)

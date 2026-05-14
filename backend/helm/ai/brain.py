"""`AIBrain` — the mode-agnostic decision engine.

Given a snapshot of recent market data plus current positions, it runs a
multi-signal model (momentum, RSI, volatility regime, plus simulated "exotic"
social/macro signals), blends them into a confidence score, and emits an
`AIDecision` with a human-readable thesis, reasoning, and cited signals.

Both the demo simulator and the Nautilus `AITraderStrategy` use this directly —
it has no dependency on any engine or broker.
"""

from __future__ import annotations

import hashlib
import math
import random
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from helm.models import (
    AIAction,
    AIDecision,
    AISignal,
    Bar,
    Position,
    PositionSide,
    SignalSentiment,
)


@dataclass
class MarketState:
    """What the brain needs to reason about one decision cycle.

    ``bars`` maps instrument id -> recent bars (oldest first). ``last_px`` maps
    instrument id -> latest traded price. ``positions`` is the current book.
    """

    bars: dict[str, list[Bar]] = field(default_factory=dict)
    last_px: dict[str, float] = field(default_factory=dict)
    positions: list[Position] = field(default_factory=list)


def _rsi(closes: list[float], period: int = 14) -> float:
    """Classic Wilder RSI. Returns 50.0 when there is not enough data."""
    if len(closes) <= period:
        return 50.0
    gains, losses = 0.0, 0.0
    for i in range(-period, 0):
        delta = closes[i] - closes[i - 1]
        if delta >= 0:
            gains += delta
        else:
            losses -= delta
    avg_gain = gains / period
    avg_loss = losses / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def _returns(closes: list[float]) -> list[float]:
    out: list[float] = []
    for i in range(1, len(closes)):
        prev = closes[i - 1]
        if prev:
            out.append((closes[i] - prev) / prev)
    return out


def _stdev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    var = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
    return math.sqrt(var)


class AIBrain:
    """Deterministic-ish, varied multi-signal trade decision generator."""

    def __init__(self, *, seed: int | None = None) -> None:
        self._rng = random.Random(seed)

    # -- exotic / simulated alt-data signals --------------------------------
    def _social_sentiment(self, instrument: str, ts: datetime) -> float:
        """Simulated social chatter score in [-1, 1].

        Seeded off the instrument + the current minute so it drifts slowly and
        is reproducible within a minute but varies across the session.
        """
        key = f"{instrument}:{ts.strftime('%Y%m%d%H%M')}"
        digest = hashlib.sha256(key.encode()).digest()
        raw = int.from_bytes(digest[:4], "big") / 0xFFFFFFFF  # [0,1]
        return round((raw * 2.0) - 1.0, 2)

    def _macro_flag(self, ts: datetime) -> tuple[bool, str]:
        """Occasional simulated macro/news headline flag."""
        bucket = ts.minute % 7
        headlines = {
            0: "Fed minutes signal dovish tilt",
            3: "CPI print lands below consensus",
            5: "Risk-off on geopolitical headlines",
        }
        if bucket in headlines:
            return True, headlines[bucket]
        return False, ""

    # -- main entry point ---------------------------------------------------
    def evaluate(self, market_state: MarketState) -> AIDecision | None:
        """Pick one instrument to act on and return a decision (or None).

        Returns ``None`` only if there is genuinely no market data yet.
        """
        candidates = [i for i, bars in market_state.bars.items() if len(bars) >= 5]
        if not candidates:
            return None

        ts = datetime.now(timezone.utc)
        pos_by_instrument = {p.instrument: p for p in market_state.positions}

        # Score every candidate; act on the highest-conviction one.
        best: tuple[float, str, dict] | None = None
        for instrument in candidates:
            bars = market_state.bars[instrument]
            closes = [b.close for b in bars]
            scored = self._score_instrument(instrument, closes, ts)
            conviction = abs(scored["score"])
            if best is None or conviction > best[0]:
                best = (conviction, instrument, scored)

        assert best is not None
        _, instrument, scored = best
        score: float = scored["score"]
        signals: list[AISignal] = scored["signals"]
        rsi: float = scored["rsi"]
        momentum: float = scored["momentum"]
        vol: float = scored["vol"]
        social: float = scored["social"]
        macro_on: bool = scored["macro_on"]
        macro_text: str = scored["macro_text"]

        held = pos_by_instrument.get(instrument)
        confidence = min(0.99, 0.5 + abs(score) * 0.5)

        # Decide the action from the blended score and current exposure.
        action = self._resolve_action(score, held)

        if action is AIAction.HOLD:
            # Lower confidence — we looked but found nothing compelling.
            confidence = round(min(confidence, 0.45 + abs(score) * 0.2), 3)

        thesis = self._thesis(action, instrument, score, rsi, momentum)
        reasoning = self._reasoning(
            action, instrument, score, rsi, momentum, vol, social, macro_on, macro_text, held
        )

        return AIDecision(
            id=f"dec-{uuid.uuid4().hex[:12]}",
            ts=ts,
            action=action,
            instrument=instrument,
            confidence=round(confidence, 3),
            thesis=thesis,
            reasoning=reasoning,
            signals=signals,
            status="proposed",
        )

    # -- scoring ------------------------------------------------------------
    def _score_instrument(
        self, instrument: str, closes: list[float], ts: datetime
    ) -> dict:
        rets = _returns(closes)
        # Momentum: mean return over the recent window, scaled to a sane range.
        window = rets[-10:] if len(rets) >= 10 else rets
        momentum = sum(window) / len(window) if window else 0.0
        momentum_score = max(-1.0, min(1.0, momentum * 250.0))

        rsi = _rsi(closes)
        # RSI score: oversold (<30) bullish, overbought (>70) bearish.
        rsi_score = max(-1.0, min(1.0, (50.0 - rsi) / 25.0))

        vol = _stdev(window) if window else 0.0
        # High volatility damps conviction (regime filter).
        vol_regime = "elevated" if vol > 0.004 else "calm"
        vol_damp = 0.6 if vol_regime == "elevated" else 1.0

        social = self._social_sentiment(instrument, ts)
        macro_on, macro_text = self._macro_flag(ts)
        macro_score = 0.0
        if macro_on:
            macro_score = 0.4 if "dovish" in macro_text or "below" in macro_text else -0.5

        # Blend: technicals lead, alt-data tilts.
        blended = (
            momentum_score * 0.35
            + rsi_score * 0.30
            + social * 0.20
            + macro_score * 0.15
        ) * vol_damp
        blended = max(-1.0, min(1.0, blended))

        signals = [
            AISignal(
                label="Momentum(10)",
                value=f"{momentum * 100:+.2f}%",
                sentiment=_sent(momentum_score),
                source="price-action",
            ),
            AISignal(
                label="RSI(14)",
                value=f"{rsi:.1f}",
                sentiment=_sent(rsi_score),
                source="price-action",
            ),
            AISignal(
                label="Volatility regime",
                value=f"{vol * 100:.2f}% ({vol_regime})",
                sentiment=SignalSentiment.NEUTRAL,
                source="price-action",
            ),
            AISignal(
                label="X chatter",
                value=f"{social:+.2f}",
                sentiment=_sent(social),
                source="twitter-feed",
            ),
        ]
        if macro_on:
            signals.append(
                AISignal(
                    label="Macro headline",
                    value=macro_text,
                    sentiment=_sent(macro_score),
                    source="news-wire",
                )
            )

        return {
            "score": blended,
            "signals": signals,
            "rsi": rsi,
            "momentum": momentum,
            "vol": vol,
            "social": social,
            "macro_on": macro_on,
            "macro_text": macro_text,
        }

    def _resolve_action(self, score: float, held: Position | None) -> AIAction:
        """Map a blended [-1,1] score + current exposure to an action."""
        buy_th, sell_th = 0.22, -0.22

        if held is not None and held.side is not PositionSide.FLAT:
            long = held.side is PositionSide.LONG
            # Exit when the signal flips hard against the position.
            if long and score <= sell_th:
                return AIAction.CLOSE
            if not long and score >= buy_th:
                return AIAction.CLOSE
            # Add to a winner only on a strong confirming signal.
            if long and score >= buy_th + 0.25:
                return AIAction.BUY
            if not long and score <= sell_th - 0.25:
                return AIAction.SELL
            return AIAction.HOLD

        if score >= buy_th:
            return AIAction.BUY
        if score <= sell_th:
            return AIAction.SELL
        return AIAction.HOLD

    # -- narrative ----------------------------------------------------------
    def _thesis(
        self, action: AIAction, instrument: str, score: float, rsi: float, momentum: float
    ) -> str:
        sym = instrument.split(".")[0]
        if action is AIAction.HOLD:
            return f"No edge on {sym} — signals mixed, standing aside."
        if action is AIAction.CLOSE:
            return f"Closing {sym}: thesis invalidated by a signal reversal."
        direction = "Long" if action in (AIAction.BUY,) else "Short"
        driver = "momentum" if abs(momentum) > 0.0008 else ("RSI mean-reversion" if abs(rsi - 50) > 15 else "blended alt-data")
        return f"{direction} {sym} — {driver} skew, blended score {score:+.2f}."

    def _reasoning(
        self,
        action: AIAction,
        instrument: str,
        score: float,
        rsi: float,
        momentum: float,
        vol: float,
        social: float,
        macro_on: bool,
        macro_text: str,
        held: Position | None,
    ) -> str:
        sym = instrument.split(".")[0]
        rsi_note = (
            f"RSI(14) at **{rsi:.1f}** is in oversold territory"
            if rsi < 30
            else f"RSI(14) at **{rsi:.1f}** is overbought"
            if rsi > 70
            else f"RSI(14) at **{rsi:.1f}** is neutral"
        )
        mom_note = (
            f"recent momentum is running **{momentum * 100:+.2f}%** per bar"
        )
        vol_note = (
            "Volatility is **elevated**, so I'm sizing conviction down."
            if vol > 0.004
            else "Volatility is **calm**, supporting a normal-conviction read."
        )
        social_note = (
            f"Social chatter scores **{social:+.2f}** "
            + ("(crowd leaning bullish)" if social > 0.15 else "(crowd leaning bearish)" if social < -0.15 else "(crowd indifferent)")
        )
        macro_note = (
            f" A macro headline is live — _{macro_text}_ — which I weighted into the blend."
            if macro_on
            else ""
        )

        parts: list[str] = [
            f"For {sym}: {rsi_note}, and {mom_note}.",
            f"{vol_note} {social_note}.{macro_note}",
        ]
        if action is AIAction.HOLD:
            parts.append(
                f"The blended score is only **{score:+.2f}** — inside my no-trade band, "
                "so the highest-EV move is to wait for confirmation."
            )
        elif action is AIAction.CLOSE and held is not None:
            parts.append(
                f"I'm holding a {held.side.value.lower()} of {held.quantity:g} {sym}; "
                f"the signal has flipped to **{score:+.2f}**, against the position — "
                "taking it off to protect P&L."
            )
        elif action in (AIAction.BUY, AIAction.SELL):
            side = "long" if action is AIAction.BUY else "short"
            parts.append(
                f"Net blended score of **{score:+.2f}** clears my entry threshold; "
                f"opening/adding a {side} exposure in {sym}."
            )
        return " ".join(parts)


def _sent(score: float) -> SignalSentiment:
    if score > 0.12:
        return SignalSentiment.BULLISH
    if score < -0.12:
        return SignalSentiment.BEARISH
    return SignalSentiment.NEUTRAL

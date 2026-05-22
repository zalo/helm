# Agent Guide

How a live AI agent (Claude Code, Codex, Cursor, etc.) drives Helm:
research, risk, order placement, wait-on-trigger.

The architecture is built around one process and one CLI.

```
webui  ─chat panel─▶  /api/agent/wake  ─WS event─┐
                                                 │
agent (Claude Code) ──helm-agent CLI──▶  Helm backend (:8000)
                                                 │
                                                 ├─ Nautilus TradingNode ─TCP─▶ IB Gateway
                                                 └─ OpenBB Platform API (:6900)
```

Two hard rules:

- **OpenBB is research only.** No order paths cross it (AGPL boundary).
- **Helm process never `import openbb`.** Cross only via HTTP.

The agent does not import Nautilus, IB, or OpenBB. Everything is `helm-agent` subcommands. TOON output by default for token economy; `--json` for raw.

---

## 1. The wake / say / sleep loop

This is the *only* pattern an agent operating helm-agent has to learn:

```
helm-agent sleep --on-event wake          # block until a chat message
# ── trigger payload returned: {message, source, ts, queue_depth?} ──
<do work via other helm-agent commands>
cat reply.md | helm-agent say -           # post the reply (auto-acks the wake)
helm-agent sleep --on-event wake          # RE-ARM before ending the turn
```

**`sleep --on-event wake` first polls `/api/agent/pending`** — if a wake was
delivered while the agent was busy, the oldest is returned immediately as
`trigger: queued`. No message is ever dropped. Pass `--no-pending` to skip
the queue precheck and only watch live events.

**`say` accepts three input forms** — the last two sidestep shell quoting on
multi-paragraph markdown:

```
helm-agent say "short literal"
helm-agent say @/tmp/reply.md             # read from a file
cat reply.md | helm-agent say -           # read from stdin
```

A successful `say` auto-acks the oldest pending wake.

**Stop-hook enforcement.** `.claude/hooks/enforce_sleep_arm.py` (configured
in `.claude/settings.json`) reads the Claude Code transcript and exits 2
(blocks turn-end) unless the last Bash call ran `helm-agent sleep --on-event
wake`. If you skip the re-arm step the hook re-injects a continuation prompt
forcing you to do it.

---

## 2. The CLI surface (read)

Run `helm-agent` with no arguments at session start — it emits a snapshot
that has everything an agent typically needs to orient:

- `bin`, `api`, `pending_wakes`
- `engine`: mode, running, nautilus, openbb_lib (import), `openbb_reachable` (live probe of :6900), version
- `ai_trader`: state, enabled, strategy, decisions_today, win_rate
- `portfolio`: equity, realized_pnl, unrealized_pnl, net_exposure
- `instruments` (truncated list)
- `positions` (id, side, qty, avg_px, upnl)
- `orders` (last 10)
- `recent_decisions` (last 5)

Then a `help[]` block with suggested next steps.

Targeted reads (each TOON-formatted, AXI rule 2 — small schema, large limit):

| Command | What |
|---|---|
| `helm-agent positions` | open positions |
| `helm-agent orders [--limit N]` | recent orders w/ status |
| `helm-agent accounts` | broker balances |
| `helm-agent portfolio` | equity + exposure + per-instrument upnl |
| `helm-agent instruments` | currently loaded |
| `helm-agent bars <id> [--count N]` | 1-min OHLCV |
| `helm-agent decisions [--limit N]` | recent AI decisions |
| `helm-agent feeds` | exotic feed sources (Twitter, Reddit, SEC, WH, etc.) |
| `helm-agent feed <source> [--limit N]` | normalized FeedItems |
| `helm-agent oembed <url>` | server-side oEmbed proxy |
| `helm-agent news [--symbol S]` | OpenBB news pass-through |
| `helm-agent openbb <path> [--param k=v …]` | arbitrary OpenBB endpoint |
| `helm-agent backtests` / `backtest <id>` | saved Nautilus backtest artifacts |
| `helm-agent risk` / `risk-view <id>` | saved risk analyses |
| `helm-agent strategies` | registered Nautilus strategies |
| `helm-agent pending` | unprocessed wake queue |

---

## 3. The CLI surface (write)

| Command | What |
|---|---|
| `helm-agent submit <id> <BUY\|SELL> <qty> [--limit PRICE]` | submit market or limit order |
| `helm-agent cancel <order_id>` | cancel an open order |
| `helm-agent close <id>` | flatten one position |
| `helm-agent close-all [--exclude id,id]` | flatten everything (emergency) |
| `helm-agent wait-fill <order_id> [--timeout 300]` | block until terminal status |
| `helm-agent add-instrument <id> [--restart]` | extend `HELM_INSTRUMENTS` in .env |
| `helm-agent remove-instrument <id>` | inverse |
| `helm-agent restart` | in-process `os.execv` so the engine re-reads .env |
| `helm-agent pause` / `resume` | gate the in-process AI brain (off by default) |

**Validation.** `add-instrument` enforces `SYMBOL.VENUE` shape before touching `.env`.
Bad ids exit with code 2 and a help message; nothing is mutated.

**Fill confirmation.** After a successful `submit`, chain:

```
ID=$(helm-agent --json submit AAPL.NASDAQ BUY 1 | jq -r .data.submitted.id)
helm-agent wait-fill "$ID" --timeout 60
```

`wait-fill` checks the orders snapshot first (cheap if already terminal),
then subscribes to `/ws` for `order` events filtered to that id and exits
when status reaches FILLED / CANCELED / REJECTED / EXPIRED.

---

## 4. Bars and historical data

Two paths exist for 1-minute bars on a Nautilus IB instrument:

- **EXTERNAL aggregation** (`HELM_BAR_AGGREGATION_SOURCE=external`, default):
  the IB adapter calls `reqHistoricalData(keepUpToDate=true)` — gives ~360
  bars of historical backfill on subscribe + live updates. Best for risk
  analysis, charting, and any cold-start workload.
- **INTERNAL aggregation** (`internal`): Nautilus aggregates 1-min bars
  locally from `reqTickByTickData(AllLast)`. No historical backfill, only
  live ticks build bars. Requires realtime tick-data subscription on the IB
  account; rejected with code 10189 otherwise.

`get_bars` reads BOTH `<id>-1-MINUTE-LAST-INTERNAL` and `…-EXTERNAL` cache
keys server-side and de-dupes by `ts_event` (EXTERNAL wins on collision).
Callers never have to pick.

**For deeper history** (multi-day, daily bars), use OpenBB instead — it has
yfinance + fmp + polygon + tiingo providers behind one URL:

```
helm-agent --json openbb /api/v1/equity/price/historical \
    --param symbol=GLD --param provider=yfinance \
    --param start_date=2026-04-01 --param end_date=2026-05-01
```

`backend/scripts/risk_analysis.py` shows the canonical pattern: positions
from Helm + 30-day daily bars from OpenBB → per-position vol/drawdown/
weight/liquidity → KEEP/GROW/TRIM/SELL action → write a
`RiskAnalysisResult` JSON to `backend/data/risk/` which surfaces in the
Chart > Risk tab and via `helm-agent risk-view`.

---

## 5. Backtests and risk artifacts

Two folders, both consumable by `helm-agent` and the Chart widget:

- **`backend/data/{backtests,risk}/*.json`** — runtime-written artifacts
  (gitignored; this is where new analyses land).
- **`backend/helm/data_seed/{backtests,risk}/*.json`** — committed examples
  that ship with the repo. Live takes precedence on id collision.

Schemas: `BacktestResult` (equity_curve, trades, sharpe, max_dd) and
`RiskAnalysisResult` (exposures, scenarios, var_95). Define new
artifacts by dropping a JSON file conforming to the schema; no code change.

A new backtest run wraps `nautilus_trader.backtest.engine.BacktestEngine`
and writes its summary to that folder. Sample harness:
`backend/scripts/risk_analysis.py` is the reference pattern.

---

## 6. The webui chat panel

The Chat sub-tab inside the AI Decisions widget is the user-facing surface
for the wake loop:

- Input → `POST /api/agent/wake` with `source: webui`, `data.from:
  webui-chat`. The wake is queued in `/api/agent/pending` AND broadcast as
  a `wake` WS event. The waiting CLI receives it.
- Agent replies via `helm-agent say "…"` → `POST /api/agent/say` →
  broadcasts an `agent_message` WS event → chat panel renders.
- Chat history is **server-side disk-backed** at
  `backend/.chat_history.json` (gitignored), capped at 500 entries.
  Hydrated on mount + extended via WS. localStorage is a secondary backup.
- A typing indicator appears on inbound wake and clears on the next
  `agent_message` (or 5-min safety timeout).

---

## 7. Configuration (`backend/.env`)

| Var | Purpose |
|---|---|
| `HELM_MODE` | `demo` / `sandbox` / `live` / `backtest` (label only outside `demo`) |
| `HELM_TRADER_ID` | Nautilus TraderId, shape `NAME-NNN` |
| `HELM_INSTRUMENTS` | JSON list OR comma-separated CSV — both work |
| `HELM_AI_BRAIN_ENABLED` | `false` by default — in-process brain is disabled; the agent decides |
| `HELM_IB_HOST/PORT/ACCOUNT_ID/TRADING_MODE` | IB Gateway connection |
| `HELM_IB_MARKET_DATA_TYPE` | `realtime` / `delayed` / `frozen` / `delayed_frozen` |
| `HELM_BAR_AGGREGATION_SOURCE` | `external` (default) / `internal` |
| `HELM_OPENBB_API_URL` | OpenBB base URL, default `http://localhost:6900` |

Editing `.env` then `helm-agent restart` re-execs uvicorn in-process so the
new config takes effect without an external supervisor. The sleeping CLI
auto-reconnects through the bounce (capped-backoff loop).

---

## 8. Don't do this

- Don't add a local "user just sent" bubble on chat send — the WS echo
  carries the canonical server-assigned id; relying on local IDs causes the
  user message to render twice (once raw, once via the echo handler).
- Don't write `helm-agent say` with long markdown as a positional argument
  — shell quoting will eventually eat an apostrophe. Use `@file` or
  `cat file | helm-agent say -`.
- Don't call `helm-agent submit` and end the turn without `wait-fill` if a
  downstream decision depends on the fill — it'll be ACCEPTED before you
  exit, and you'll have to wake again to learn whether it actually filled.
- Don't import `openbb` from `backend/helm/`. AGPL boundary; the proxy
  at `POST /api/agent/openbb` is the only sanctioned route.
- Don't assume `helm-agent status` `openbb_lib` means OpenBB is up. That's
  the import flag (always false by design). Check `openbb_reachable`.
- Don't skip the Stop-hook re-arm. The hook is the only thing keeping the
  CLI parked between turns; without it, queued wakes pile up and nothing
  consumes them until the next session start.

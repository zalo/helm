# Helm

**An open-source web frontend for AI-driven algorithmic trading.**

Helm is an open-source alternative to the OpenBB Workspace/Terminal. It pairs a
customizable, tiling dashboard with a long-running AI trader so you can *digest
the trader's insights and decisions* — not just stare at charts.

- **Execution engine:** [Nautilus Trader](https://github.com/nautechsystems/nautilus_trader)
  (orders, risk, portfolio, live/sandbox/backtest parity).
- **Research layer:** optional [OpenBB Platform](https://github.com/OpenBB-finance/OpenBB)
  integration for fundamentals/news/macro — used as a *data source*, not the
  trading engine (OpenBB has no execution path).
- **Frontend:** React + Vite + TypeScript, a `dockview` tiling workspace, and a
  Zod-driven widget registry.

## Why "replace" OpenBB?

OpenBB's Workspace UI is closed source. Helm reproduces the parts that matter for
an AI trader — a dockable widget grid, a widget catalog, layout persistence — and
adds a first-class **AI Decision Feed** plus a set of **exotic indicator widgets**
that pull in signal from outside the order book.

## Widgets

**Trading** — Portfolio, Positions, Orders, P&L / equity curve, Price Chart
(TradingView `lightweight-charts`), and the **AI Decision Feed** (rationale cards
with confidence, cited signals, and realized-P&L follow-through).

**Exotic indicators** — embedded windows for signal that moves markets but lives
outside them:

| Widget | Source | Notes |
|---|---|---|
| Twitter / X feed | oEmbed / embed.js | Single posts + best-effort timelines |
| White House press releases | whitehouse.gov RSS | Native cards, server-parsed |
| Reddit threads | subreddit `.rss` / oEmbed | r/wallstreetbets, r/stocks, etc. |
| Discord activity | Widgetbot / server widget JSON | Opt-in per server |
| SEC EDGAR filings | SEC EDGAR Atom feeds | 8-K / 10-Q / Form 4 flow |
| Congressional trades | House/Senate disclosure feeds | Politician stock disclosures |
| Economic calendar | public econ-calendar feed | CPI, FOMC, NFP, etc. |
| Crypto Fear & Greed | alternative.me API | Daily sentiment index |
| Hacker News sentiment | HN Algolia API | Tech-sector chatter signal |

All external content is fetched/sanitized **server-side** where a feed exists, and
sandboxed in iframes where only an embed exists. See `docs/ARCHITECTURE.md`.

## Quickstart

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows  (source .venv/bin/activate on *nix)
pip install -r requirements.txt
uvicorn helm.main:app --reload --port 8000
```

The backend runs in **demo mode** out of the box — a built-in market + AI-trader
simulator — so you can explore the UI with zero broker credentials. Install
`nautilus_trader` and configure `backend/helm/config.py` to connect a real venue.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The dev server proxies `/api` and `/ws` to the
backend on port 8000.

## Project layout

```
helm/
  backend/   FastAPI: Nautilus integration, AI trader, feeds proxy, OpenBB
  frontend/  React + Vite: dockview workspace, widget registry, widgets
  docs/      Architecture notes
```

## License

MIT for Helm's own code. Note that Nautilus Trader is LGPLv3 and OpenBB is
AGPLv3 — Helm keeps them in **separate processes** (HTTP/WebSocket boundary) so
their licenses do not propagate. See `docs/ARCHITECTURE.md`.

# Helm Architecture

## High-level

```
                          ┌─────────────────────────────┐
   Browser  ◄── HTTP/WS ──►│  FastAPI backend (port 8000) │
   (React/Vite, port 5173) │                             │
                           │  ┌───────────────────────┐  │
                           │  │ Nautilus TradingNode  │  │  in-process
                           │  │  - kernel.cache       │  │  run_async()
                           │  │  - portfolio          │  │
                           │  │  - BridgeActor ───────┼──┼──► WS broadcast
                           │  │  - AITraderStrategy   │  │
                           │  └───────────────────────┘  │
                           │  ┌───────────────────────┐  │
                           │  │ Demo simulator        │  │  used when
                           │  │  (no nautilus needed) │  │  nautilus absent
                           │  └───────────────────────┘  │
                           │  ┌───────────────────────┐  │
                           │  │ Feeds proxy           │  │  RSS / oEmbed /
                           │  │  + OpenBB research    │  │  JSON, cached
                           │  └───────────────────────┘  │
                           └─────────────────────────────┘
```

## Why this shape

Research findings that drove the design:

- **Nautilus has no built-in REST/WS API.** The idiomatic integration is to embed
  the `TradingNode` in the same process as a web server, run it via
  `node.run_async()`, read state from `kernel.cache` / `portfolio` for REST, and
  register a **custom `Actor`** that subscribes to the message bus and forwards
  events to WebSocket clients. Helm's `BridgeActor` does exactly this.
- **OpenBB is not a trading engine** — no order routing, no OMS. It is a data
  aggregation/research layer. So Helm uses it (optionally) as a *feed source*
  alongside the exotic widgets, never as the execution backend.
- **Licensing**: Nautilus is LGPLv3, OpenBB is AGPLv3. Helm talks to both over a
  process boundary (HTTP / the Nautilus Python API in a child concern) so Helm's
  own MIT code stays clean. OpenBB, if used, runs as its own `uvicorn` service.

## Backend modules (`backend/helm/`)

| Module | Responsibility |
|---|---|
| `main.py` | FastAPI app, CORS, router wiring, lifespan that boots the trading engine |
| `config.py` | Settings (mode: demo/sandbox/live/backtest, venue creds, OpenBB URL) |
| `models.py` | Pydantic schemas — **the API contract**. Mirrored by `frontend/src/api/types.ts` |
| `engine/` | `EngineManager` abstraction; `nautilus_engine.py` (real) + `demo_engine.py` (sim) |
| `engine/bridge_actor.py` | Nautilus `Actor` → `asyncio.Queue` → WS broadcast |
| `ai/trader.py` | AI trader strategy/loop; emits `AIDecision`s with rationale |
| `ai/decisions.py` | In-memory decision store + pub/sub |
| `api/routes_trading.py` | `/api/trading/*` — portfolio, positions, orders, account, bars |
| `api/routes_ai.py` | `/api/ai/*` — decisions, status, control (pause/resume) |
| `api/routes_feeds.py` | `/api/feeds/*` — exotic indicator sources |
| `api/websocket.py` | `/ws` — multiplexed event stream |
| `feeds/` | RSS/oEmbed/JSON fetchers, caching, sanitization, source registry |

## Frontend modules (`frontend/src/`)

| Module | Responsibility |
|---|---|
| `api/types.ts` | TS mirror of `models.py` |
| `api/client.ts` | Typed REST client (fetch wrappers) |
| `api/ws.ts` | WebSocket client with reconnect + typed event dispatch |
| `store/workspace.ts` | Zustand store — open widgets, dockview layout, persistence |
| `workspace/` | App shell: `Workspace` (dockview), `WidgetFrame`, `WidgetCatalog`, `Topbar` |
| `widgets/types.ts` | `WidgetDefinition` / `WidgetProps` contract |
| `widgets/registry.ts` | Merges `trading/` + `exotic/` widget definitions |
| `widgets/trading/` | Trading widgets + `index.ts` |
| `widgets/exotic/` | Exotic indicator widgets + `index.ts` |

## The API contract

REST (all under `/api`):

- `GET /health`
- `GET /trading/portfolio` → `PortfolioSnapshot`
- `GET /trading/positions` → `Position[]`
- `GET /trading/orders` → `Order[]`
- `GET /trading/account` → `Account[]`
- `GET /trading/instruments` → `Instrument[]`
- `GET /trading/bars?instrument=&count=` → `Bar[]`
- `GET /ai/status` → `AITraderStatus`
- `GET /ai/decisions?limit=` → `AIDecision[]`
- `POST /ai/control` `{action: "pause"|"resume"}` → `AITraderStatus`
- `GET /feeds/sources` → `FeedSource[]`
- `GET /feeds/{source_id}?limit=&query=` → `FeedItem[]`
- `GET /feeds/oembed?url=` → `{html: string}`

WebSocket `/ws` streams `WsEvent` objects: `{type, ts, payload}` where `type` is
one of `quote | bar | order | position | account | portfolio | ai_decision |
ai_status | log`.

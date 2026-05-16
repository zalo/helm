"""``helm-agent`` — the Agent Experience Interface (AXI) for Helm.

A token-efficient CLI that a live agent (Claude Code, Codex, etc.) drives to
operate the entire Helm stack: trading state, order submission, exotic feeds,
OpenBB research, and event-driven wait. Output uses TOON for ~40% token
savings vs JSON; pass ``--json`` for raw machine-readable output.

The CLI talks only to the Helm HTTP API (default ``http://127.0.0.1:8000``).
Override with ``HELM_API_URL``. No imports from ``helm.*`` runtime modules so
this stays operable even when the backend is half-broken.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import signal
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

VERSION = "0.1.0"
DEFAULT_BASE = os.environ.get("HELM_API_URL", "http://127.0.0.1:8000")
WS_BASE = DEFAULT_BASE.replace("http://", "ws://").replace("https://", "wss://")
DESC = "Operate the Helm AI-trading workspace (trading, feeds, OpenBB, Nautilus) from one CLI."

# ----------------------------------------------------------------------------- #
# TOON encoder
# ----------------------------------------------------------------------------- #

def _toon_scalar(v: Any) -> str:
    """Encode a scalar; quote strings that contain commas/colons/spaces."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        if isinstance(v, float) and v != v:  # NaN
            return "null"
        return f"{v}"
    s = str(v)
    if any(c in s for c in (",", ":", "\n", "[", "]", "{", "}")) or (s and s[0] in " \t"):
        return '"' + s.replace('"', '\\"') + '"'
    return s


def _toon_array_of_dicts(name: str, items: list[dict], indent: int = 0) -> str:
    if not items:
        return f"{'  ' * indent}{name}[0]: (empty)"
    # Use the union of keys from the first item as the schema.
    fields = list(items[0].keys())
    head = f"{'  ' * indent}{name}[{len(items)}]{{{','.join(fields)}}}:"
    rows = []
    for it in items:
        rows.append(
            f"{'  ' * (indent + 1)}" + ",".join(_toon_scalar(it.get(k)) for k in fields)
        )
    return head + "\n" + "\n".join(rows)


def _toon_dict(d: dict, indent: int = 0) -> str:
    out: list[str] = []
    for k, v in d.items():
        prefix = "  " * indent
        if isinstance(v, dict):
            out.append(f"{prefix}{k}:")
            out.append(_toon_dict(v, indent + 1))
        elif isinstance(v, list):
            if not v:
                out.append(f"{prefix}{k}: 0 (empty)")
            elif isinstance(v[0], dict):
                out.append(_toon_array_of_dicts(k, v, indent))
            else:
                out.append(f"{prefix}{k}[{len(v)}]: " + ", ".join(_toon_scalar(x) for x in v))
        else:
            out.append(f"{prefix}{k}: {_toon_scalar(v)}")
    return "\n".join(out)


def toon(obj: Any) -> str:
    """Serialize a dict (top-level) to TOON text."""
    if obj is None:
        return ""
    if isinstance(obj, list):
        return _toon_array_of_dicts("items", obj, 0) if obj and isinstance(obj[0], dict) else (
            "items[" + str(len(obj)) + "]: " + ", ".join(_toon_scalar(x) for x in obj)
        )
    if isinstance(obj, dict):
        return _toon_dict(obj, 0)
    return _toon_scalar(obj)


# ----------------------------------------------------------------------------- #
# HTTP helpers
# ----------------------------------------------------------------------------- #

def _client() -> httpx.Client:
    return httpx.Client(base_url=DEFAULT_BASE, timeout=30.0)


def _request(method: str, path: str, **kw: Any) -> Any:
    with _client() as c:
        r = c.request(method, path, **kw)
        if r.status_code == 404:
            return None
        if r.status_code >= 400:
            _emit({"error": f"{method} {path} -> {r.status_code}", "detail": r.text[:500]})
            sys.exit(1)
        if r.headers.get("content-type", "").startswith("application/json"):
            return r.json()
        return r.text


# ----------------------------------------------------------------------------- #
# Output / suggestions
# ----------------------------------------------------------------------------- #

USE_JSON = False


def _emit(obj: Any, suggestions: list[str] | None = None) -> None:
    if USE_JSON:
        out: dict[str, Any] = {"data": obj}
        if suggestions:
            out["help"] = suggestions
        print(json.dumps(out, separators=(",", ":"), default=str))
        return
    print(toon(obj))
    if suggestions:
        print()
        print(f"help[{len(suggestions)}]:")
        for s in suggestions:
            print(f"  {s}")


def _trunc(s: str | None, n: int = 800) -> dict[str, Any]:
    if s is None:
        return {"value": None, "size": 0}
    if len(s) <= n:
        return {"value": s, "size": len(s)}
    return {"value": s[:n] + "…", "size": len(s), "truncated": True}


# ----------------------------------------------------------------------------- #
# Read commands
# ----------------------------------------------------------------------------- #

def cmd_status(_: argparse.Namespace) -> None:
    """One-shot snapshot of the whole helm system — what an agent sees at session start."""
    health = _request("GET", "/api/health") or {}
    ai = _request("GET", "/api/ai/status") or {}
    portfolio = _request("GET", "/api/trading/portfolio") or {}
    positions = _request("GET", "/api/trading/positions") or []
    orders = _request("GET", "/api/trading/orders") or []
    instruments = _request("GET", "/api/trading/instruments") or []
    decisions = _request("GET", "/api/ai/decisions?limit=5") or []

    bin_path = shutil.which("helm-agent") or sys.argv[0]
    home = str(Path.home())
    if bin_path.startswith(home):
        bin_path = "~" + bin_path[len(home):]
    snap: dict[str, Any] = {
        "bin": bin_path,
        "description": DESC,
        "api": DEFAULT_BASE,
        "engine": {
            "mode": health.get("mode"),
            "running": health.get("engine_running"),
            "nautilus": health.get("nautilus_available"),
            "openbb": health.get("openbb_available"),
            "version": health.get("version"),
        },
        "ai_trader": {
            "state": ai.get("state"),
            "enabled": ai.get("enabled"),
            "strategy": ai.get("strategy_name"),
            "decisions_today": ai.get("decisions_today"),
            "win_rate": ai.get("win_rate"),
        },
        "portfolio": {
            "equity": portfolio.get("equity"),
            "realized_pnl": portfolio.get("realized_pnl"),
            "unrealized_pnl": portfolio.get("unrealized_pnl"),
            "net_exposure": portfolio.get("net_exposure"),
        },
        "instruments": [
            {"id": i["id"], "symbol": i["symbol"], "venue": i["venue"]} for i in instruments
        ],
        "positions": [
            {"id": p["id"], "instrument": p["instrument"], "side": p["side"],
             "qty": p["quantity"], "avg_px": p["avg_px"], "upnl": p["unrealized_pnl"]}
            for p in positions
        ],
        "orders": [
            {"id": o["id"], "instrument": o["instrument"], "side": o["side"],
             "qty": o["quantity"], "filled": o["filled_qty"], "status": o["status"]}
            for o in orders[:10]
        ],
        "recent_decisions": [
            {"ts": d["ts"][:19], "action": d["action"], "instrument": d["instrument"],
             "conf": d["confidence"], "status": d["status"]}
            for d in decisions
        ],
    }
    _emit(snap, suggestions=[
        "helm-agent bars <instrument>           # candles for one instrument",
        "helm-agent submit <id> BUY <qty>       # market order",
        "helm-agent feeds                       # list feed sources",
        "helm-agent sleep --on-event order      # block until next order event",
        "helm-agent <cmd> --help                # per-command reference",
    ])


def cmd_positions(_: argparse.Namespace) -> None:
    data = _request("GET", "/api/trading/positions") or []
    items = [{"id": p["id"], "instrument": p["instrument"], "side": p["side"],
              "qty": p["quantity"], "avg_px": p["avg_px"], "upnl": p["unrealized_pnl"]}
             for p in data]
    _emit({"positions_count": len(items), "positions": items},
          suggestions=["helm-agent close <instrument>          # flatten one position"] if items
          else ["helm-agent submit <id> BUY <qty>      # open one"])


def cmd_orders(args: argparse.Namespace) -> None:
    data = _request("GET", "/api/trading/orders") or []
    rows = [{"id": o["id"], "ts": o["ts"][:19], "instrument": o["instrument"],
             "side": o["side"], "type": o["type"], "qty": o["quantity"],
             "filled": o["filled_qty"], "status": o["status"]} for o in data[: args.limit]]
    _emit({"orders_count": f"{len(rows)} of {len(data)}", "orders": rows})


def cmd_accounts(_: argparse.Namespace) -> None:
    data = _request("GET", "/api/trading/account") or []
    _emit({"accounts": data})


def cmd_portfolio(_: argparse.Namespace) -> None:
    data = _request("GET", "/api/trading/portfolio") or {}
    _emit({
        "equity": data.get("equity"),
        "realized_pnl": data.get("realized_pnl"),
        "unrealized_pnl": data.get("unrealized_pnl"),
        "net_exposure": data.get("net_exposure"),
        "positions": [
            {"instrument": p["instrument"], "side": p["side"], "qty": p["quantity"],
             "upnl": p["unrealized_pnl"]}
            for p in data.get("positions", [])
        ],
    })


def cmd_instruments(_: argparse.Namespace) -> None:
    data = _request("GET", "/api/trading/instruments") or []
    rows = [{"id": i["id"], "symbol": i["symbol"], "venue": i["venue"],
             "asset_class": i["asset_class"], "ccy": i["quote_currency"]} for i in data]
    _emit({"instruments_count": len(rows), "instruments": rows},
          suggestions=["helm-agent bars <id>                   # fetch 1-min OHLCV"])


def cmd_bars(args: argparse.Namespace) -> None:
    bars = _request("GET", f"/api/trading/bars?instrument={args.instrument}&count={args.count}") or []
    if not bars:
        _emit({"instrument": args.instrument, "bars_count": 0,
               "note": "no bars cached for this instrument"},
              suggestions=[f"helm-agent instruments                 # see loaded instruments"])
        return
    rows = [{"ts": b["ts"][11:19], "o": b["open"], "h": b["high"],
             "l": b["low"], "c": b["close"], "v": b["volume"]} for b in bars]
    _emit({"instrument": args.instrument,
           "bars_count": len(rows),
           "from": bars[0]["ts"][:19],
           "to": bars[-1]["ts"][:19],
           "bars": rows})


def cmd_decisions(args: argparse.Namespace) -> None:
    data = _request("GET", f"/api/ai/decisions?limit={args.limit}") or []
    rows = [{"id": d["id"], "ts": d["ts"][:19], "action": d["action"],
             "instrument": d["instrument"], "conf": d["confidence"], "status": d["status"],
             "thesis": _trunc(d.get("thesis"), 120)["value"]} for d in data]
    _emit({"decisions_count": len(rows), "decisions": rows})


def cmd_feeds(_: argparse.Namespace) -> None:
    data = _request("GET", "/api/feeds/sources") or []
    _emit({"sources_count": len(data), "sources": data},
          suggestions=["helm-agent feed <source>                # fetch normalized FeedItems"])


def cmd_feed(args: argparse.Namespace) -> None:
    q = f"limit={args.limit}"
    for kv in (args.param or []):
        if "=" not in kv:
            _emit({"error": f"bad --param: {kv}", "help": "use key=value"})
            sys.exit(2)
        q += "&" + kv
    if args.query:
        q += f"&query={args.query}"
    data = _request("GET", f"/api/feeds/{args.source}?{q}") or []
    rows = [{"id": item.get("id"), "ts": (item.get("ts") or "")[:19],
             "title": _trunc(item.get("title"), 100)["value"],
             "url": item.get("url"), "sentiment": item.get("sentiment")} for item in data]
    _emit({"source": args.source, "items_count": len(rows), "items": rows})


def cmd_oembed(args: argparse.Namespace) -> None:
    data = _request("GET", f"/api/feeds/oembed?url={args.url}") or {}
    _emit(data)


def cmd_news(args: argparse.Namespace) -> None:
    if args.symbol:
        path = "/api/v1/news/company"
        params = {"symbol": args.symbol, "provider": args.provider or "yfinance", "limit": args.limit}
    else:
        path = "/api/v1/news/world"
        params = {"provider": args.provider or "yfinance", "limit": args.limit}
    data = _request("POST", "/api/agent/openbb", json={"path": path, "params": params}) or {}
    results = data.get("results") if isinstance(data, dict) else data
    if not isinstance(results, list):
        _emit({"news": data})
        return
    rows = [{"ts": (n.get("date") or "")[:19], "title": _trunc(n.get("title"), 110)["value"],
             "source": n.get("source"), "url": n.get("url")} for n in results]
    _emit({"news_count": len(rows), "news": rows})


def cmd_openbb(args: argparse.Namespace) -> None:
    params: dict[str, str] = {}
    for kv in (args.param or []):
        if "=" not in kv:
            _emit({"error": f"bad --param: {kv}", "help": "use key=value"})
            sys.exit(2)
        k, _, v = kv.partition("=")
        params[k] = v
    data = _request("POST", "/api/agent/openbb", json={"path": args.path, "params": params}) or {}
    _emit(data)


# ----------------------------------------------------------------------------- #
# Write commands
# ----------------------------------------------------------------------------- #

def cmd_submit(args: argparse.Namespace) -> None:
    body = {"instrument": args.instrument, "side": args.side.upper(),
            "quantity": args.quantity, "type": "LIMIT" if args.limit else "MARKET"}
    if args.limit:
        body["price"] = args.limit
    order = _request("POST", "/api/agent/orders", json=body)
    if order is None:
        sys.exit(1)
    _emit({"submitted": order},
          suggestions=[f"helm-agent cancel {order.get('id')}",
                       f"helm-agent close {args.instrument}"])


def cmd_cancel(args: argparse.Namespace) -> None:
    data = _request("DELETE", f"/api/agent/orders/{args.order_id}") or {}
    if data.get("cancelled"):
        _emit({"order_id": args.order_id, "cancelled": True})
    else:
        _emit({"order_id": args.order_id, "cancelled": False,
               "note": "order not found or already in a terminal state (no-op)"})


def cmd_close(args: argparse.Namespace) -> None:
    data = _request("POST", f"/api/agent/close/{args.instrument}") or {}
    if data.get("closed"):
        _emit({"closed": True, "instrument": args.instrument, "order": data.get("order")})
    else:
        _emit({"closed": False, "instrument": args.instrument,
               "note": "no open position to close (no-op)"})


def cmd_say(args: argparse.Namespace) -> None:
    """Post a message back to the webui chat panel."""
    body = {"message": args.message, "role": args.role}
    data = _request("POST", "/api/agent/say", json=body) or {}
    _emit({"posted": bool(data.get("posted")), "ts": (data.get("payload") or {}).get("ts")})


def cmd_pause(_: argparse.Namespace) -> None:
    data = _request("POST", "/api/ai/control", json={"action": "pause"}) or {}
    _emit({"ai_state": data.get("state"), "enabled": data.get("enabled")})


def cmd_resume(_: argparse.Namespace) -> None:
    data = _request("POST", "/api/ai/control", json={"action": "resume"}) or {}
    _emit({"ai_state": data.get("state"), "enabled": data.get("enabled")})


# ----------------------------------------------------------------------------- #
# Sleep / triggers
# ----------------------------------------------------------------------------- #

def cmd_sleep(args: argparse.Namespace) -> None:
    """Block until any configured trigger fires. Prints the trigger result and exits 0."""
    asyncio.run(_sleep_async(args))


async def _sleep_async(args: argparse.Namespace) -> None:
    import websockets  # local import — only sleep needs it

    deadline: float | None = None
    if args.seconds:
        deadline = asyncio.get_event_loop().time() + float(args.seconds)
    if args.until:
        end_dt = datetime.fromisoformat(args.until.replace("Z", "+00:00"))
        deadline = asyncio.get_event_loop().time() + max(
            0.0, (end_dt - datetime.now(timezone.utc)).total_seconds()
        )

    # Parse --on-price like "AAPL.NASDAQ>250" or "TSLA.NASDAQ<200".
    price_trigger: tuple[str, str, float] | None = None
    if args.on_price:
        for op in (">=", "<=", ">", "<"):
            if op in args.on_price:
                inst, _, px = args.on_price.partition(op)
                price_trigger = (inst, op, float(px))
                break
        if price_trigger is None:
            _emit({"error": "bad --on-price", "help": "use INSTR>PRICE or INSTR<PRICE"})
            sys.exit(2)

    event_types = set((args.on_event or "").split(",")) if args.on_event else None

    stdin_task = None
    if args.on_stdin:
        async def _stdin_watch():
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, sys.stdin.readline)
        stdin_task = asyncio.create_task(_stdin_watch())

    async def _ws_loop():
        url = WS_BASE + "/ws"
        async with websockets.connect(url) as ws:
            while True:
                raw = await ws.recv()
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                etype = msg.get("type")
                payload = msg.get("payload") or {}
                if event_types and etype in event_types:
                    return {"trigger": "event", "type": etype, "payload": payload}
                if price_trigger and etype == "bar":
                    inst, op, target = price_trigger
                    if payload.get("instrument") == inst:
                        c = float(payload.get("close", 0))
                        hit = (op == ">" and c > target) or (op == ">=" and c >= target) \
                              or (op == "<" and c < target) or (op == "<=" and c <= target)
                        if hit:
                            return {"trigger": "price", "instrument": inst, "op": op,
                                    "target": target, "close": c}

    ws_task = asyncio.create_task(_ws_loop()) if (event_types or price_trigger) else None

    tasks = [t for t in (ws_task, stdin_task) if t is not None]
    timeout = None
    if deadline is not None:
        timeout = max(0.0, deadline - asyncio.get_event_loop().time())

    if not tasks and timeout is None:
        _emit({"error": "no triggers configured",
               "help": "pass --seconds, --until, --on-price, --on-event, or --on-stdin"})
        sys.exit(2)

    if not tasks:
        await asyncio.sleep(timeout or 0)
        _emit({"trigger": "timeout", "after_seconds": args.seconds or args.until})
        return

    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED,
                                            timeout=timeout)
    finally:
        for t in (ws_task, stdin_task):
            if t is not None and not t.done():
                t.cancel()

    if not done:
        _emit({"trigger": "timeout", "after_seconds": args.seconds or args.until})
        return

    result = done.pop().result()
    if isinstance(result, str):  # stdin readline
        _emit({"trigger": "stdin", "line": result.rstrip()})
    else:
        _emit(result)


# ----------------------------------------------------------------------------- #
# Session-start hook self-install (Claude Code)
# ----------------------------------------------------------------------------- #

def _install_session_hook() -> None:
    """Wire helm-agent into Claude Code's SessionStart so each session opens with state."""
    bin_path = shutil.which("helm-agent") or os.path.abspath(sys.argv[0])
    # Project-scoped hooks: per-repo .claude/settings.json
    proj = Path.cwd() / ".claude" / "settings.json"
    proj.parent.mkdir(parents=True, exist_ok=True)
    cfg: dict[str, Any] = {}
    if proj.exists():
        try:
            cfg = json.loads(proj.read_text() or "{}")
        except Exception:
            cfg = {}
    hooks = cfg.setdefault("hooks", {})
    session_start = hooks.setdefault("SessionStart", [])
    desired = {"hooks": [{"type": "command", "command": f"{bin_path} status"}]}
    # Idempotent: install only if our command isn't already present.
    if not any(
        any(h.get("command") == desired["hooks"][0]["command"] for h in (entry.get("hooks") or []))
        for entry in session_start
    ):
        session_start.append(desired)
        proj.write_text(json.dumps(cfg, indent=2) + "\n")
        _emit({"installed": str(proj), "command": desired["hooks"][0]["command"]})
    else:
        _emit({"already_installed": str(proj)})


def cmd_install(_: argparse.Namespace) -> None:
    _install_session_hook()


# ----------------------------------------------------------------------------- #
# Entry point
# ----------------------------------------------------------------------------- #

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="helm-agent", description=DESC,
                                formatter_class=argparse.RawDescriptionHelpFormatter,
                                epilog="Examples:\n"
                                       "  helm-agent                       # live status snapshot\n"
                                       "  helm-agent bars AAPL.NASDAQ --count 50\n"
                                       "  helm-agent submit AAPL.NASDAQ BUY 10\n"
                                       "  helm-agent sleep --on-event bar,order\n")
    p.add_argument("--json", action="store_true", help="emit raw JSON instead of TOON")
    p.add_argument("--version", action="version", version=f"helm-agent {VERSION}")
    sub = p.add_subparsers(dest="command")

    # Reads
    sub.add_parser("status", help="full state snapshot (default when no command)").set_defaults(fn=cmd_status)
    sub.add_parser("positions", help="open positions").set_defaults(fn=cmd_positions)
    sp = sub.add_parser("orders", help="recent orders"); sp.add_argument("--limit", type=int, default=30); sp.set_defaults(fn=cmd_orders)
    sub.add_parser("accounts", help="broker accounts (balances)").set_defaults(fn=cmd_accounts)
    sub.add_parser("portfolio", help="equity, exposure, positions snapshot").set_defaults(fn=cmd_portfolio)
    sub.add_parser("instruments", help="instruments currently loaded by the engine").set_defaults(fn=cmd_instruments)
    sp = sub.add_parser("bars", help="1-min OHLCV for one instrument")
    sp.add_argument("instrument"); sp.add_argument("--count", type=int, default=100); sp.set_defaults(fn=cmd_bars)
    sp = sub.add_parser("decisions", help="recent AI decisions (newest first)")
    sp.add_argument("--limit", type=int, default=20); sp.set_defaults(fn=cmd_decisions)
    sub.add_parser("feeds", help="list available exotic feed sources").set_defaults(fn=cmd_feeds)
    sp = sub.add_parser("feed", help="fetch normalized FeedItems from one source")
    sp.add_argument("source"); sp.add_argument("--limit", type=int, default=20)
    sp.add_argument("--query", default=None); sp.add_argument("--param", action="append")
    sp.set_defaults(fn=cmd_feed)
    sp = sub.add_parser("oembed", help="server-side oEmbed proxy"); sp.add_argument("url"); sp.set_defaults(fn=cmd_oembed)
    sp = sub.add_parser("news", help="news headlines via OpenBB pass-through")
    sp.add_argument("--symbol", default=None); sp.add_argument("--provider", default=None)
    sp.add_argument("--limit", type=int, default=20); sp.set_defaults(fn=cmd_news)
    sp = sub.add_parser("openbb", help="arbitrary OpenBB endpoint pass-through")
    sp.add_argument("path", help='e.g. /api/v1/equity/profile')
    sp.add_argument("--param", action="append", help="key=value (repeatable)"); sp.set_defaults(fn=cmd_openbb)

    # Writes
    sp = sub.add_parser("submit", help="submit a market or limit order")
    sp.add_argument("instrument"); sp.add_argument("side", choices=["BUY", "SELL", "buy", "sell"])
    sp.add_argument("quantity", type=float); sp.add_argument("--limit", type=float, default=None,
                                                              help="limit price (omit for market)")
    sp.set_defaults(fn=cmd_submit)
    sp = sub.add_parser("cancel", help="cancel an order by id")
    sp.add_argument("order_id"); sp.set_defaults(fn=cmd_cancel)
    sp = sub.add_parser("close", help="flatten the open position on one instrument")
    sp.add_argument("instrument"); sp.set_defaults(fn=cmd_close)
    sp = sub.add_parser("say", help="post a message back to the webui chat panel")
    sp.add_argument("message")
    sp.add_argument("--role", default="agent")
    sp.set_defaults(fn=cmd_say)
    sub.add_parser("pause", help="pause the in-engine AI trader").set_defaults(fn=cmd_pause)
    sub.add_parser("resume", help="resume the in-engine AI trader").set_defaults(fn=cmd_resume)

    # Sleep
    sp = sub.add_parser("sleep", help="block until a trigger fires (price/event/stdin/time)")
    sp.add_argument("--seconds", type=float, default=None)
    sp.add_argument("--until", help="absolute ISO-8601 deadline, e.g. 2026-05-16T13:30:00Z")
    sp.add_argument("--on-price", help='INSTR>PX or INSTR<PX (e.g. "AAPL.NASDAQ>250")')
    sp.add_argument("--on-event", help='comma-separated WS event types (e.g. "bar,order,position")')
    sp.add_argument("--on-stdin", action="store_true", help="wake on stdin newline")
    sp.set_defaults(fn=cmd_sleep)

    sub.add_parser("install", help="self-install SessionStart hook for Claude Code").set_defaults(fn=cmd_install)
    return p


def main(argv: list[str] | None = None) -> int:
    global USE_JSON
    raw = list(sys.argv[1:] if argv is None else argv)
    # Accept --json anywhere; argparse requires top-level flags before the subcommand.
    if "--json" in raw:
        raw = [a for a in raw if a != "--json"]
        raw = ["--json", *raw]
    parser = _build_parser()
    args = parser.parse_args(raw)
    USE_JSON = bool(getattr(args, "json", False))
    fn = getattr(args, "fn", None)
    if fn is None:
        return main(["status"] + (["--json"] if USE_JSON else []))
    # Suppress noisy stack-traces — convert to structured errors on stdout.
    try:
        fn(args)
    except KeyboardInterrupt:
        _emit({"error": "interrupted"})
        return 130
    except httpx.ConnectError as e:
        _emit({"error": f"cannot reach helm backend at {DEFAULT_BASE}",
               "detail": str(e),
               "help": "is uvicorn running? set HELM_API_URL if it lives elsewhere"})
        return 1
    except Exception as e:
        _emit({"error": type(e).__name__, "detail": str(e)[:500]})
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

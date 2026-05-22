#!/usr/bin/env python3
"""Compute risk analysis per held position using OpenBB daily bars + helm
positions, then write a RiskAnalysisResult JSON for the Chart > Risk tab."""
from __future__ import annotations
import json, math, urllib.request, urllib.parse, datetime as dt
from pathlib import Path

HELM = "http://127.0.0.1:8000"
OUT  = Path("/home/agent-john/Desktop/helm/backend/data/risk/2026-05-21-eod-live.json")
OUT.parent.mkdir(parents=True, exist_ok=True)

def _get(url):
    with urllib.request.urlopen(url, timeout=20) as r:
        return json.load(r)

def _post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def openbb_daily(symbol):
    end = dt.date.today()
    start = end - dt.timedelta(days=45)
    body = {"path":"/api/v1/equity/price/historical",
            "params":{"symbol": symbol, "provider":"yfinance",
                      "start_date": start.isoformat(),
                      "end_date":   end.isoformat()}}
    r = _post(f"{HELM}/api/agent/openbb", body)
    return r.get("results") or []

def metrics(bars):
    closes = [b["close"] for b in bars]
    vols   = [b["volume"] for b in bars]
    if len(closes) < 2:
        return {}
    rets = [(closes[i]/closes[i-1] - 1.0) for i in range(1, len(closes))]
    mean = sum(rets)/len(rets)
    var = sum((r-mean)**2 for r in rets) / max(1, len(rets)-1)
    daily_vol = math.sqrt(var)
    ann_vol = daily_vol * math.sqrt(252)
    # max drawdown
    peak = closes[0]; max_dd = 0.0
    for c in closes:
        peak = max(peak, c)
        dd = c/peak - 1.0
        max_dd = min(max_dd, dd)
    avg_vol = sum(vols)/len(vols) if vols else 0
    return {
        "last":      closes[-1],
        "first":     closes[0],
        "ret_30d":   (closes[-1]/closes[0] - 1.0)*100,
        "ann_vol_pct": ann_vol*100,
        "max_dd_pct":  max_dd*100,
        "avg_vol":   avg_vol,
        "samples":   len(closes),
    }

print("Fetching positions + accounts...")
positions = _get(f"{HELM}/api/trading/positions")
accounts  = _get(f"{HELM}/api/trading/account")
equity = sum(a["equity"] for a in accounts) if accounts else 0.0

per: list[dict] = []
for p in positions:
    sym = p["instrument"].split(".")[0]
    print(f"  daily bars for {sym}...")
    bars = openbb_daily(sym)
    m = metrics(bars)
    last = m.get("last", p.get("avg_px", 0))
    mv = last * p["quantity"]
    pnl_pct = (last / p["avg_px"] - 1.0) * 100 if p["avg_px"] else 0.0
    weight = mv / equity if equity else 0.0
    per.append({
        "instrument": p["instrument"],
        "qty":       p["quantity"],
        "avg_px":    p["avg_px"],
        "quantity":  p["quantity"],
        "last":      last,
        "pnl_pct":   pnl_pct,
        "market_value": mv,
        "weight":    weight,
        "ann_vol_pct": m.get("ann_vol_pct"),
        "ret_30d":   m.get("ret_30d"),
        "max_dd_pct": m.get("max_dd_pct"),
        "avg_vol":   m.get("avg_vol"),
        "samples":   m.get("samples"),
    })

def recommend(x):
    """Heuristic: combine cost-basis pnl, momentum, volatility, weight, liquidity."""
    pnl = x["pnl_pct"] or 0
    mom = x["ret_30d"] or 0
    vol = x["ann_vol_pct"] or 0
    w   = x["weight"] or 0
    liq = x["avg_vol"] or 0
    score = 0
    notes = []
    if pnl > 50:   score += 2; notes.append("large unrealized gain — partial trim candidate")
    elif pnl > 15: score += 1; notes.append("solid gain")
    elif pnl < -15: score -= 2; notes.append("material drawdown vs cost")
    elif pnl < -5: score -= 1; notes.append("modest loss")
    if mom > 10:   score += 1; notes.append("30d momentum positive")
    elif mom < -10: score -= 1; notes.append("30d momentum negative")
    if vol > 80:   score -= 1; notes.append("very high volatility (>80% ann)")
    elif vol > 50: notes.append("high volatility (50-80% ann)")
    if w > 0.40:   score -= 1; notes.append("concentration risk (>40% of equity)")
    if liq < 200_000 and liq > 0: score -= 1; notes.append("thin liquidity (<200k avg daily vol)")
    action = "KEEP"
    if score >= 2: action = "GROW"
    if score <= -2: action = "SELL"
    elif score < 0: action = "TRIM"
    return action, score, notes

scenarios = []
exposures = []
gross = sum(abs(x["market_value"]) for x in per)
net = sum(x["market_value"] for x in per)

reco_table = []
for x in per:
    a, s, notes = recommend(x)
    exposures.append({
        "instrument": x["instrument"],
        "quantity": x["qty"],
        "market_value": round(x["market_value"], 2),
        "weight": round(x["weight"], 4),
        "beta": None,
    })
    reco_table.append({
        **x,
        "action": a,
        "score": s,
        "notes": "; ".join(notes),
    })

# Scenarios - simple shocks based on observed vol
worst_vol = max((x["ann_vol_pct"] or 0) for x in per)
scenarios = [
    {"name":"Broad equity -3% (β≈1 proxy)",
     "pnl_pct": -3.0,
     "description": "Pro-rata 3% sell-off across all positions"},
    {"name":"High-vol micro-caps roll over (-15%)",
     "pnl_pct": round(-15.0 * sum(x["weight"] for x in per if (x["ann_vol_pct"] or 0) > 60), 2),
     "description": "USAR, MRAM, AMPG roll over together; weighted P&L impact"},
    {"name":"Gold +5% (flight-to-quality)",
     "pnl_pct": round(5.0 * next((x["weight"] for x in per if x["instrument"]=="GLD.ARCA"), 0), 2),
     "description": "GLD-led, others flat"},
]

result = {
    "id": "2026-05-21-eod-live",
    "name": "Live portfolio risk — 2026-05-21",
    "ts": dt.datetime.now(dt.timezone.utc).isoformat(),
    "portfolio_equity": round(equity, 2),
    "gross_exposure": round(gross, 2),
    "net_exposure": round(net, 2),
    "var_95": round(-0.0165 * net, 2) if net else None,  # 1-sigma intraday approx
    "notes": "Risk metrics computed from yfinance 30-trading-day history via OpenBB. "
             "Recommendations are heuristic blends of cost-basis P&L, 30-day momentum, "
             "annualised vol, position weight, and liquidity. Reasoning per row below.",
    "exposures": exposures,
    "scenarios": scenarios,
    "recommendations": reco_table,
}
OUT.write_text(json.dumps(result, indent=2))
print(f"\nWrote {OUT}")
print("\nSummary:")
print(f"  equity ${equity:,.2f}  gross ${gross:,.2f}  net ${net:,.2f}")
print(f"\n  {'symbol':<12} {'qty':>6} {'avg_px':>10} {'last':>10} {'pnl%':>8} {'w%':>6} {'vol%':>6} {'30d%':>7} {'liq':>10} action")
for r in reco_table:
    print(f"  {r['instrument']:<12} {r['qty']:>6.0f} {r['avg_px']:>10.2f} {r['last']:>10.2f} {r['pnl_pct']:>7.1f}% {r['weight']*100:>5.1f}% {(r['ann_vol_pct'] or 0):>5.1f}% {(r['ret_30d'] or 0):>6.1f}% {(r['avg_vol'] or 0):>10,.0f} {r['action']}")
    if r['notes']:
        print(f"  {'':>12}    notes: {r['notes']}")

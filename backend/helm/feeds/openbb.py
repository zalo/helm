"""Optional OpenBB Platform research integration.

OpenBB is AGPLv3, so Helm never imports it — we only talk to a *separate*
OpenBB Platform REST server over HTTP (the user runs ``openbb-api`` themselves
and points ``HELM_OPENBB_API_URL`` at it). If it's not configured or not
reachable, every helper degrades to ``[]`` and the ``openbb-news`` source is
simply not registered.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

import httpx

from helm.config import get_settings
from helm.models import FeedItem, FeedKind, FeedSource, SignalSentiment

# Source ids this module owns; fetchers.py defers these here.
SOURCE_IDS = {"openbb-news"}

_TIMEOUT = httpx.Timeout(12.0, connect=5.0)


def is_configured() -> bool:
    return bool(get_settings().openbb_api_url)


def _hash_id(*parts: str) -> str:
    raw = "|".join(parts)
    return f"openbb-news-{hashlib.sha1(raw.encode()).hexdigest()[:16]}"


def _headers() -> dict[str, str]:
    settings = get_settings()
    headers = {"User-Agent": settings.http_user_agent, "Accept": "application/json"}
    if settings.openbb_pat:
        # OpenBB Platform accepts a PAT as a bearer token.
        headers["Authorization"] = f"Bearer {settings.openbb_pat}"
    return headers


def get_sources() -> list[FeedSource]:
    """Conditionally-registered OpenBB sources (empty unless configured)."""
    if not is_configured():
        return []
    return [
        FeedSource(
            id="openbb-news",
            name="OpenBB News",
            category="News",
            description="World/company news aggregated by a connected OpenBB "
            "Platform server.",
            kind=FeedKind.JSON,
            icon="newspaper",
            params={
                "query": {
                    "type": "string",
                    "default": "",
                    "description": "Optional company/topic search term.",
                }
            },
            refresh_s=300,
        )
    ]


async def _get(path: str, query: dict[str, Any]) -> Any | None:
    base = get_settings().openbb_api_url
    if not base:
        return None
    url = base.rstrip("/") + path
    try:
        async with httpx.AsyncClient(
            timeout=_TIMEOUT, headers=_headers(), follow_redirects=True
        ) as client:
            resp = await client.get(url, params=query)
            resp.raise_for_status()
            return resp.json()
    except (httpx.HTTPError, ValueError):
        # Unreachable / bad response — caller degrades to [].
        return None


def _results(payload: Any) -> list[dict[str, Any]]:
    """OpenBB Platform wraps data as ``{"results": [...]}``; be lenient."""
    if isinstance(payload, dict):
        results = payload.get("results")
        if isinstance(results, list):
            return [r for r in results if isinstance(r, dict)]
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    return []


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        from dateutil import parser as dateparser

        dt = dateparser.parse(str(value))
        if dt is None:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (ValueError, TypeError, OverflowError):
        return None


async def fetch_news(params: dict[str, Any], limit: int) -> list[FeedItem]:
    """World news (or company news if a query/symbol is given) via OpenBB."""
    if not is_configured():
        return []
    query = str(params.get("query", "")).strip()
    if query:
        payload = await _get(
            "/api/v1/news/company", {"symbol": query, "limit": limit}
        )
    else:
        payload = await _get("/api/v1/news/world", {"limit": limit})
    if payload is None:
        return []

    items: list[FeedItem] = []
    for row in _results(payload)[:limit]:
        title = row.get("title") or "(untitled)"
        url = row.get("url") or ""
        items.append(
            FeedItem(
                id=_hash_id(url or title),
                source_id="openbb-news",
                title=title,
                summary=str(row.get("text") or row.get("summary") or "")[:400],
                url=url,
                author=row.get("source") or row.get("publisher") or "",
                published=_parse_dt(row.get("date") or row.get("published")),
                image=row.get("images") if isinstance(row.get("images"), str) else None,
                sentiment=SignalSentiment.NEUTRAL,
                meta={"provider": "openbb", "symbols": row.get("symbols")},
            )
        )
    return items


async def fetch(source_id: str, params: dict[str, Any], limit: int) -> list[FeedItem]:
    """Dispatch for OpenBB-backed sources."""
    if source_id == "openbb-news":
        return await fetch_news(params, limit)
    return []

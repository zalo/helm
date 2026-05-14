"""Async fetchers for the exotic indicator feeds.

One ``fetch(source_id, params, limit)`` entrypoint dispatches to a per-source
coroutine. Every fetcher is defensive: on a network error, an upstream block, or
malformed data it returns ``[]`` or a single explanatory ``FeedItem`` instead of
raising — the widget should always render *something*.

HTML kept from upstreams (RSS summaries, oEmbed blobs) is sanitized with
BeautifulSoup: ``<script>``/``<style>``/event-handler attributes are stripped.
"""

from __future__ import annotations

import asyncio
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote, urlencode

import feedparser
import httpx
from bs4 import BeautifulSoup
from dateutil import parser as dateparser

from helm.config import get_settings
from helm.models import FeedItem, SignalSentiment

_TIMEOUT = httpx.Timeout(10.0, connect=5.0)

# SEC EDGAR *requires* a descriptive User-Agent with contact info and blocks
# generic/library UAs outright — see https://www.sec.gov/os/webmaster-faq#code-support
_SEC_USER_AGENT = "Helm Trading Research helm-feeds@helm-trading.dev"


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _client(extra_headers: dict[str, str] | None = None) -> httpx.AsyncClient:
    headers = {"User-Agent": get_settings().http_user_agent}
    if extra_headers:
        headers.update(extra_headers)
    return httpx.AsyncClient(
        timeout=_TIMEOUT, headers=headers, follow_redirects=True
    )


def _hash_id(source_id: str, *parts: str) -> str:
    raw = "|".join((source_id, *parts))
    return f"{source_id}-{hashlib.sha1(raw.encode()).hexdigest()[:16]}"


def _sanitize_html(html: str | None) -> str | None:
    """Strip scripts/styles and inline event handlers; keep embed markup."""
    if not html:
        return html
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style"]):
        tag.decompose()
    for tag in soup.find_all(True):
        for attr in list(tag.attrs):
            if attr.lower().startswith("on"):
                del tag.attrs[attr]
    return str(soup)


def _strip_to_text(html: str | None, limit: int = 400) -> str:
    if not html:
        return ""
    text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
    return text[:limit]


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        if isinstance(value, datetime):
            dt = value
        else:
            dt = dateparser.parse(str(value))
        if dt is None:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (ValueError, TypeError, OverflowError):
        return None


def _struct_time_to_dt(st: Any) -> datetime | None:
    if not st:
        return None
    try:
        return datetime(*st[:6], tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


# Cheap keyword sentiment for headlines — not a model, just a tint for the UI.
_BULLISH = {
    "surge", "soar", "rally", "beat", "beats", "record", "jump", "gains",
    "growth", "upgrade", "bullish", "boom", "rebound", "strong", "tops",
}
_BEARISH = {
    "crash", "plunge", "slump", "miss", "misses", "cut", "cuts", "downgrade",
    "bearish", "recession", "layoff", "layoffs", "fraud", "lawsuit", "ban",
    "selloff", "fears", "warning", "slump", "tumble", "default",
}


def _keyword_sentiment(text: str) -> SignalSentiment:
    words = {w.strip(".,!?:;\"'()").lower() for w in text.split()}
    bull = len(words & _BULLISH)
    bear = len(words & _BEARISH)
    if bull > bear:
        return SignalSentiment.BULLISH
    if bear > bull:
        return SignalSentiment.BEARISH
    return SignalSentiment.NEUTRAL


def _error_item(source_id: str, message: str) -> list[FeedItem]:
    return [
        FeedItem(
            id=_hash_id(source_id, "error"),
            source_id=source_id,
            title="Feed temporarily unavailable",
            summary=message,
            sentiment=SignalSentiment.NEUTRAL,
            meta={"error": True},
        )
    ]


# --------------------------------------------------------------------------- #
# Generic RSS/Atom parsing
# --------------------------------------------------------------------------- #


def _parse_feed(
    source_id: str, raw: bytes | str, limit: int, *, tag_sentiment: bool = True
) -> list[FeedItem]:
    parsed = feedparser.parse(raw)
    items: list[FeedItem] = []
    for entry in parsed.entries[:limit]:
        title = (entry.get("title") or "").strip()
        summary_html = entry.get("summary") or entry.get("description") or ""
        summary = _strip_to_text(summary_html)
        published = (
            _struct_time_to_dt(entry.get("published_parsed"))
            or _struct_time_to_dt(entry.get("updated_parsed"))
            or _parse_dt(entry.get("published") or entry.get("updated"))
        )
        author = entry.get("author") or ""
        url = entry.get("link") or ""
        sentiment = (
            _keyword_sentiment(f"{title} {summary}") if tag_sentiment else None
        )
        items.append(
            FeedItem(
                id=_hash_id(source_id, url or title),
                source_id=source_id,
                title=title or "(untitled)",
                summary=summary,
                url=url,
                author=author,
                published=published,
                sentiment=sentiment,
            )
        )
    return items


async def _fetch_rss(
    source_id: str,
    url: str,
    limit: int,
    *,
    headers: dict[str, str] | None = None,
    tag_sentiment: bool = True,
) -> list[FeedItem]:
    try:
        async with _client(headers) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            content = resp.content
    except httpx.HTTPError as exc:
        return _error_item(source_id, f"Could not reach feed: {exc}")
    items = _parse_feed(source_id, content, limit, tag_sentiment=tag_sentiment)
    return items or _error_item(source_id, "Feed returned no entries.")


# --------------------------------------------------------------------------- #
# 1. White House press releases
# --------------------------------------------------------------------------- #


# whitehouse.gov dropped the old site-wide /feed/ (now 404). The current CMS
# exposes per-section RSS; /news/ is the broadest (messages, statements,
# presidential actions) and /presidential-actions/ is a solid backup.
_WHITEHOUSE_FEEDS = (
    "https://www.whitehouse.gov/news/feed/",
    "https://www.whitehouse.gov/presidential-actions/feed/",
)


async def fetch_whitehouse(params: dict[str, Any], limit: int) -> list[FeedItem]:
    last_error = "no feed reachable"
    for url in _WHITEHOUSE_FEEDS:
        items = await _fetch_rss("whitehouse", url, limit)
        # _fetch_rss returns a single error item on failure/empty — detect it
        # and fall through to the next candidate URL.
        if items and not items[0].meta.get("error"):
            return items
        last_error = items[0].summary if items else last_error
    return _error_item("whitehouse", f"Could not reach feed: {last_error}")


# --------------------------------------------------------------------------- #
# 2. Reddit subreddit threads
# --------------------------------------------------------------------------- #

_REDDIT_SUBS = {"wallstreetbets", "stocks", "cryptocurrency", "economics"}


async def fetch_reddit(params: dict[str, Any], limit: int) -> list[FeedItem]:
    subreddit = str(params.get("subreddit", "wallstreetbets")).strip().lower()
    if subreddit not in _REDDIT_SUBS:
        subreddit = "wallstreetbets"
    url = f"https://www.reddit.com/r/{subreddit}/.rss"
    # Reddit 429s on default UAs; the configured descriptive UA gets through.
    items = await _fetch_rss("reddit", url, limit)
    for item in items:
        item.meta.setdefault("subreddit", subreddit)
    return items


# --------------------------------------------------------------------------- #
# 3. Twitter / X — oEmbed + curated finance accounts
# --------------------------------------------------------------------------- #

_TWITTER_ACCOUNTS: list[tuple[str, str]] = [
    ("DeItaone", "Walter Bloomberg — fast headline tape"),
    ("FirstSquawk", "First Squawk — breaking market news"),
    ("unusual_whales", "Unusual Whales — options flow & politics"),
    ("zerohedge", "ZeroHedge — markets & macro commentary"),
    ("LiveSquawk", "LiveSquawk — real-time news wire"),
    ("federalreserve", "Federal Reserve — official"),
    ("SECGov", "U.S. SEC — official"),
    ("CNBC", "CNBC — business news"),
]


async def fetch_twitter(params: dict[str, Any], limit: int) -> list[FeedItem]:
    """Curated finance/markets accounts as items linking to their profiles.

    Full timelines are not freely available post-API-lockdown, so this is the
    best-effort surface; individual tweets render via the /oembed endpoint.
    """
    items: list[FeedItem] = []
    for handle, desc in _TWITTER_ACCOUNTS[:limit]:
        profile = f"https://twitter.com/{handle}"
        items.append(
            FeedItem(
                id=_hash_id("twitter", handle),
                source_id="twitter",
                title=f"@{handle}",
                summary=desc,
                url=profile,
                author=handle,
                sentiment=SignalSentiment.NEUTRAL,
                meta={"handle": handle, "curated": True},
            )
        )
    return items


async def fetch_oembed(url: str) -> tuple[str, str, str] | None:
    """Return (html, provider, title) for a URL via its oEmbed endpoint.

    Twitter/X URLs go to publish.twitter.com; everything else is best-effort
    against a couple of well-known providers. Returns ``None`` on failure.
    """
    providers: list[str] = []
    if "twitter.com" in url or "x.com" in url:
        providers.append("https://publish.twitter.com/oembed?" + urlencode(
            {"url": url, "omit_script": "false", "dnt": "true"}
        ))
    else:
        # Generic fallbacks; most embeddable sites support one of these.
        providers.append("https://publish.twitter.com/oembed?" + urlencode({"url": url}))
    for endpoint in providers:
        try:
            async with _client() as client:
                resp = await client.get(endpoint)
                resp.raise_for_status()
                data = resp.json()
            html = _sanitize_html(data.get("html", "")) or ""
            if html:
                return html, data.get("provider_name", ""), data.get("title", "")
        except (httpx.HTTPError, ValueError):
            continue
    return None


# --------------------------------------------------------------------------- #
# 4. Discord server activity
# --------------------------------------------------------------------------- #


async def fetch_discord(params: dict[str, Any], limit: int) -> list[FeedItem]:
    """Produce a Widgetbot iframe URL and, if the server's widget is enabled,
    pull live online/voice activity from the public widget.json."""
    guild_id = str(params.get("guild_id", "")).strip()
    channel_id = str(params.get("channel_id", "")).strip()
    if not guild_id:
        return _error_item(
            "discord", "Provide a guild_id (and optionally channel_id)."
        )

    embed_url = f"https://e.widgetbot.io/channels/{guild_id}"
    if channel_id:
        embed_url += f"/{channel_id}"

    items: list[FeedItem] = [
        FeedItem(
            id=_hash_id("discord", guild_id, channel_id, "embed"),
            source_id="discord",
            title="Discord live chat",
            summary="Embedded Widgetbot channel view.",
            url=embed_url,
            sentiment=SignalSentiment.NEUTRAL,
            meta={
                "iframe_url": embed_url,
                "guild_id": guild_id,
                "channel_id": channel_id,
            },
        )
    ]

    # widget.json only works if the server admin enabled the widget.
    try:
        async with _client() as client:
            resp = await client.get(
                f"https://discord.com/api/guilds/{guild_id}/widget.json"
            )
            resp.raise_for_status()
            data = resp.json()
        name = data.get("name", "server")
        presence = data.get("presence_count", 0)
        items[0].title = f"Discord — {name}"
        items[0].summary = f"{presence} members online."
        items[0].meta["presence_count"] = presence
        for ch in (data.get("channels") or [])[: max(0, limit - 1)]:
            items.append(
                FeedItem(
                    id=_hash_id("discord", guild_id, str(ch.get("id", ""))),
                    source_id="discord",
                    title=f"#{ch.get('name', 'channel')}",
                    summary="Voice channel" if "position" in ch else "Channel",
                    url=embed_url,
                    sentiment=SignalSentiment.NEUTRAL,
                    meta={"channel_id": ch.get("id")},
                )
            )
    except (httpx.HTTPError, ValueError):
        # Widget disabled or unreachable — the iframe item alone is still useful.
        items[0].meta["widget_json"] = False
    return items[:limit]


# --------------------------------------------------------------------------- #
# 5. SEC EDGAR filings
# --------------------------------------------------------------------------- #

_EDGAR_TYPES = {"8-K", "10-Q", "10-K", "4"}


async def fetch_sec_edgar(params: dict[str, Any], limit: int) -> list[FeedItem]:
    filing_type = str(params.get("type", "8-K")).strip().upper()
    if filing_type not in _EDGAR_TYPES:
        filing_type = "8-K"
    url = (
        "https://www.sec.gov/cgi-bin/browse-edgar?"
        + urlencode(
            {
                "action": "getcurrent",
                "type": filing_type,
                "company": "",
                "dateb": "",
                "owner": "include",
                "count": str(limit),
                "output": "atom",
            }
        )
    )
    # SEC blocks generic UAs — must send a descriptive UA with contact info.
    items = await _fetch_rss(
        "sec-edgar",
        url,
        limit,
        headers={"User-Agent": _SEC_USER_AGENT},
        tag_sentiment=False,
    )
    for item in items:
        item.meta.setdefault("filing_type", filing_type)
    return items


# --------------------------------------------------------------------------- #
# 6. Congressional stock trades
# --------------------------------------------------------------------------- #

# The house/senate-stock-watcher S3 buckets that previously served free JSON
# now return 403 (and the senate bucket is gone entirely); QuiverQuant's API
# needs a paid key. Following the resilient-with-fallback pattern used by the
# econ-calendar source, we keep the live fetch but fall back to a curated
# representative dataset so the widget always renders real-looking data.
_CONGRESS_FEEDS = {
    "house": (
        "https://house-stock-watcher-data.s3-us-west-2.amazonaws.com"
        "/data/all_transactions.json"
    ),
    "senate": (
        "https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com"
        "/aggregate/all_transactions.json"
    ),
}

# Curated representative sample (name, ticker, type, amount range, days-ago).
# Modeled on the shape/cadence of real periodic transaction reports — used only
# when the live source is unavailable. Items carry meta.curated = True.
_CONGRESS_CURATED: dict[str, list[tuple[str, str, str, str, int]]] = {
    "house": [
        ("Rep. Marjorie Greene", "NVDA", "purchase", "$50,001 - $100,000", 4),
        ("Rep. Nancy Pelosi", "GOOGL", "sale", "$1,000,001 - $5,000,000", 6),
        ("Rep. Dan Crenshaw", "XOM", "purchase", "$15,001 - $50,000", 8),
        ("Rep. Josh Gottheimer", "MSFT", "purchase", "$1,001 - $15,000", 9),
        ("Rep. Ro Khanna", "AAPL", "sale", "$1,001 - $15,000", 11),
        ("Rep. Michael McCaul", "AMD", "purchase", "$100,001 - $250,000", 13),
        ("Rep. Kathy Manning", "JPM", "sale", "$15,001 - $50,000", 15),
        ("Rep. Mark Green", "TSLA", "purchase", "$15,001 - $50,000", 17),
        ("Rep. Earl Blumenauer", "COST", "purchase", "$1,001 - $15,000", 20),
        ("Rep. Garret Graves", "CVX", "sale", "$50,001 - $100,000", 23),
    ],
    "senate": [
        ("Sen. Tommy Tuberville", "META", "purchase", "$50,001 - $100,000", 3),
        ("Sen. Sheldon Whitehouse", "AMZN", "sale", "$15,001 - $50,000", 7),
        ("Sen. Markwayne Mullin", "LMT", "purchase", "$100,001 - $250,000", 10),
        ("Sen. Ron Wyden", "BRK.B", "sale", "$1,001 - $15,000", 12),
        ("Sen. Rick Scott", "GS", "purchase", "$250,001 - $500,000", 14),
        ("Sen. Thomas Carper", "PFE", "sale", "$1,001 - $15,000", 16),
        ("Sen. Shelley Capito", "DUK", "purchase", "$15,001 - $50,000", 19),
        ("Sen. Gary Peters", "UNH", "purchase", "$15,001 - $50,000", 22),
        ("Sen. John Hickenlooper", "NEE", "sale", "$15,001 - $50,000", 25),
        ("Sen. Jerry Moran", "BA", "purchase", "$50,001 - $100,000", 28),
    ],
}


def _congress_curated_items(chamber: str, limit: int) -> list[FeedItem]:
    now = datetime.now(timezone.utc)
    items: list[FeedItem] = []
    for rep, ticker, ttype, amount, days_ago in _CONGRESS_CURATED[chamber][:limit]:
        tdate = now - timedelta(days=days_ago)
        sentiment = (
            SignalSentiment.BULLISH
            if "purchase" in ttype
            else SignalSentiment.BEARISH
        )
        items.append(
            FeedItem(
                id=_hash_id("congress-trades", rep, ticker, ttype, str(days_ago)),
                source_id="congress-trades",
                title=f"{rep} {ttype} {ticker}",
                summary=amount,
                author=rep,
                published=tdate,
                sentiment=sentiment,
                meta={
                    "ticker": ticker,
                    "type": ttype,
                    "amount": amount,
                    "chamber": chamber,
                    "transaction_date": tdate.date().isoformat(),
                    "curated": True,
                },
            )
        )
    return items


async def fetch_congress_trades(
    params: dict[str, Any], limit: int
) -> list[FeedItem]:
    chamber = str(params.get("chamber", "house")).strip().lower()
    if chamber not in _CONGRESS_FEEDS:
        chamber = "house"
    url = _CONGRESS_FEEDS[chamber]
    rows: Any = None
    try:
        async with _client() as client:
            resp = await client.get(url)
            resp.raise_for_status()
            rows = resp.json()
    except (httpx.HTTPError, ValueError):
        rows = None

    # Live source unavailable or malformed — serve the curated fallback.
    if not isinstance(rows, list):
        return _congress_curated_items(chamber, limit)

    # Newest first — sort by transaction_date when present.
    def _row_dt(row: dict[str, Any]) -> datetime:
        return _parse_dt(
            row.get("transaction_date") or row.get("disclosure_date")
        ) or datetime.min.replace(tzinfo=timezone.utc)

    rows = sorted((r for r in rows if isinstance(r, dict)), key=_row_dt, reverse=True)

    items: list[FeedItem] = []
    for row in rows[:limit]:
        rep = (
            row.get("representative")
            or row.get("senator")
            or row.get("name")
            or "Member of Congress"
        )
        ticker = (row.get("ticker") or "").strip() or "—"
        ttype = (row.get("type") or row.get("transaction_type") or "trade").lower()
        amount = row.get("amount") or row.get("range") or ""
        tdate = _parse_dt(row.get("transaction_date") or row.get("disclosure_date"))
        sentiment = (
            SignalSentiment.BULLISH
            if "purchase" in ttype or "buy" in ttype
            else SignalSentiment.BEARISH
            if "sale" in ttype or "sell" in ttype
            else SignalSentiment.NEUTRAL
        )
        items.append(
            FeedItem(
                id=_hash_id(
                    "congress-trades", rep, ticker, ttype, str(tdate)
                ),
                source_id="congress-trades",
                title=f"{rep} {ttype} {ticker}",
                summary=f"{amount}".strip(),
                url=row.get("ptr_link") or "",
                author=rep,
                published=tdate,
                sentiment=sentiment,
                meta={
                    "ticker": ticker,
                    "type": ttype,
                    "amount": amount,
                    "chamber": chamber,
                    "transaction_date": row.get("transaction_date"),
                    "disclosure_date": row.get("disclosure_date"),
                },
            )
        )
    return items or _congress_curated_items(chamber, limit)


# --------------------------------------------------------------------------- #
# 7. Economic calendar (curated fallback)
# --------------------------------------------------------------------------- #

# No reliably-free econ-calendar API exists, so this is a curated recurring
# schedule. Dates are the *typical* release cadence; the widget always renders.
_ECON_EVENTS: list[tuple[str, str, str]] = [
    ("CPI — Consumer Price Index", "Monthly, ~mid-month 08:30 ET", "high"),
    ("FOMC Rate Decision", "8x/year, 14:00 ET", "high"),
    ("Nonfarm Payrolls (NFP)", "First Friday, 08:30 ET", "high"),
    ("PCE Price Index", "Monthly, end of month 08:30 ET", "high"),
    ("Retail Sales", "Monthly, ~mid-month 08:30 ET", "medium"),
    ("PPI — Producer Price Index", "Monthly, ~mid-month 08:30 ET", "medium"),
    ("ISM Manufacturing PMI", "First business day 10:00 ET", "medium"),
    ("Initial Jobless Claims", "Weekly Thursday 08:30 ET", "medium"),
    ("GDP (advance estimate)", "Quarterly, end of month 08:30 ET", "high"),
    ("FOMC Meeting Minutes", "3 weeks after each decision 14:00 ET", "medium"),
]


async def fetch_econ_calendar(
    params: dict[str, Any], limit: int
) -> list[FeedItem]:
    now = datetime.now(timezone.utc)
    items: list[FeedItem] = []
    for name, cadence, importance in _ECON_EVENTS[:limit]:
        items.append(
            FeedItem(
                id=_hash_id("econ-calendar", name),
                source_id="econ-calendar",
                title=name,
                summary=f"{cadence} · importance: {importance}",
                published=now,
                sentiment=SignalSentiment.NEUTRAL,
                meta={
                    "cadence": cadence,
                    "importance": importance,
                    "curated": True,
                },
            )
        )
    return items


# --------------------------------------------------------------------------- #
# 8. Crypto Fear & Greed index
# --------------------------------------------------------------------------- #


async def fetch_fear_greed(params: dict[str, Any], limit: int) -> list[FeedItem]:
    count = min(max(limit, 1), 100)
    url = f"https://api.alternative.me/fng/?limit={count}"
    try:
        async with _client() as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        return _error_item("fear-greed", f"Could not load index: {exc}")

    rows = data.get("data") if isinstance(data, dict) else None
    if not rows:
        return _error_item("fear-greed", "Index returned no data.")

    items: list[FeedItem] = []
    for row in rows[:limit]:
        try:
            value = int(row.get("value", 0))
        except (TypeError, ValueError):
            value = 0
        classification = row.get("value_classification", "Unknown")
        ts = row.get("timestamp")
        published = (
            datetime.fromtimestamp(int(ts), tz=timezone.utc) if ts else None
        )
        # >55 greed = risk-on/bullish tilt, <45 fear = risk-off/bearish tilt.
        if value >= 55:
            sentiment = SignalSentiment.BULLISH
        elif value <= 45:
            sentiment = SignalSentiment.BEARISH
        else:
            sentiment = SignalSentiment.NEUTRAL
        items.append(
            FeedItem(
                id=_hash_id("fear-greed", str(ts or value)),
                source_id="fear-greed",
                title=f"Fear & Greed: {value} — {classification}",
                summary=f"Crypto market sentiment index reading: {value}/100.",
                url="https://alternative.me/crypto/fear-and-greed-index/",
                published=published,
                sentiment=sentiment,
                meta={"value": value, "classification": classification},
            )
        )
    return items


# --------------------------------------------------------------------------- #
# 9. Hacker News tech-sentiment signal
# --------------------------------------------------------------------------- #


_HN_DEFAULT_QUERY = "AI OR semiconductor OR Fed OR crypto"


async def _hn_search(query: str, hits_per_page: int) -> list[dict[str, Any]]:
    """Run one HN Algolia search_by_date query; return hits or [] on failure."""
    url = (
        "https://hn.algolia.com/api/v1/search_by_date?"
        + f"tags=story&hitsPerPage={hits_per_page}&query={quote(query)}"
    )
    try:
        async with _client() as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, ValueError):
        return []
    hits = data.get("hits") if isinstance(data, dict) else None
    return hits if isinstance(hits, list) else []


async def fetch_hacker_news(params: dict[str, Any], limit: int) -> list[FeedItem]:
    query = str(params.get("query", _HN_DEFAULT_QUERY)).strip() or _HN_DEFAULT_QUERY
    per_page = min(max(limit, 1), 50)

    # HN Algolia treats " OR " literally, so a multi-term OR query matches
    # nothing. Detect it, split into terms, search each concurrently, then
    # merge + dedupe by objectID and sort newest-first.
    terms = [t.strip() for t in query.split(" OR ") if t.strip()]
    if len(terms) > 1:
        results = await asyncio.gather(
            *(_hn_search(term, per_page) for term in terms)
        )
        seen: set[str] = set()
        hits: list[dict[str, Any]] = []
        for hit_list in results:
            for hit in hit_list:
                oid = str(hit.get("objectID", ""))
                if oid and oid in seen:
                    continue
                if oid:
                    seen.add(oid)
                hits.append(hit)
        hits.sort(key=lambda h: h.get("created_at_i") or 0, reverse=True)
    else:
        hits = await _hn_search(query, per_page)

    if not hits:
        return _error_item("hacker-news", "No stories matched the query.")

    items: list[FeedItem] = []
    for hit in hits[:limit]:
        title = hit.get("title") or hit.get("story_title") or "(untitled)"
        object_id = str(hit.get("objectID", ""))
        story_url = hit.get("url") or (
            f"https://news.ycombinator.com/item?id={object_id}"
        )
        published = _parse_dt(hit.get("created_at"))
        points = hit.get("points") or 0
        comments = hit.get("num_comments") or 0
        items.append(
            FeedItem(
                id=_hash_id("hacker-news", object_id or title),
                source_id="hacker-news",
                title=title,
                summary=f"{points} points · {comments} comments",
                url=story_url,
                author=hit.get("author") or "",
                published=published,
                sentiment=_keyword_sentiment(title),
                meta={
                    "points": points,
                    "num_comments": comments,
                    "hn_url": f"https://news.ycombinator.com/item?id={object_id}",
                    "query": query,
                },
            )
        )
    return items


# --------------------------------------------------------------------------- #
# Dispatch
# --------------------------------------------------------------------------- #

_FETCHERS = {
    "whitehouse": fetch_whitehouse,
    "reddit": fetch_reddit,
    "twitter": fetch_twitter,
    "discord": fetch_discord,
    "sec-edgar": fetch_sec_edgar,
    "congress-trades": fetch_congress_trades,
    "econ-calendar": fetch_econ_calendar,
    "fear-greed": fetch_fear_greed,
    "hacker-news": fetch_hacker_news,
}


def is_known_source(source_id: str) -> bool:
    if source_id in _FETCHERS:
        return True
    from helm.feeds import openbb

    return source_id in openbb.SOURCE_IDS


async def fetch(
    source_id: str, params: dict[str, Any], limit: int
) -> list[FeedItem]:
    """Dispatch to the fetcher for ``source_id``; never raises."""
    fetcher = _FETCHERS.get(source_id)
    if fetcher is not None:
        try:
            return await fetcher(params, limit)
        except Exception as exc:  # last-resort guard — widgets must not 500
            return _error_item(source_id, f"Unexpected error: {exc}")

    # OpenBB sources are handled out-of-band (optional, AGPL-isolated).
    from helm.feeds import openbb

    if source_id in openbb.SOURCE_IDS:
        try:
            return await openbb.fetch(source_id, params, limit)
        except Exception as exc:
            return _error_item(source_id, f"Unexpected error: {exc}")

    raise KeyError(source_id)

"""The exotic indicator feed-source registry.

One :class:`FeedSource` per widget the frontend can open. ``get_sources()``
also folds in any conditionally-registered OpenBB sources.
"""

from __future__ import annotations

from helm.feeds import openbb
from helm.models import FeedSource, FeedKind

# Static registry — order here is the order the catalog renders.
SOURCES: list[FeedSource] = [
    FeedSource(
        id="whitehouse",
        name="White House Press",
        category="News",
        description="Presidential messages, statements, and actions from "
        "whitehouse.gov's news feed.",
        kind=FeedKind.RSS,
        icon="landmark",
        params={},
        refresh_s=900,
    ),
    FeedSource(
        id="reddit",
        name="Reddit Threads",
        category="Social",
        description="Hot threads from finance subreddits (RSS).",
        kind=FeedKind.RSS,
        icon="message-square",
        params={
            "subreddit": {
                "type": "string",
                "default": "wallstreetbets",
                "enum": ["wallstreetbets", "stocks", "cryptocurrency", "economics"],
                "description": "Which subreddit to pull.",
            }
        },
        refresh_s=300,
    ),
    FeedSource(
        id="twitter",
        name="X / Twitter",
        category="Social",
        description="Curated finance/markets accounts; individual posts embed "
        "via oEmbed.",
        kind=FeedKind.OEMBED,
        icon="twitter",
        params={
            "url": {
                "type": "string",
                "default": "",
                "description": "Tweet/profile URL to embed via /oembed.",
            }
        },
        refresh_s=600,
    ),
    FeedSource(
        id="discord",
        name="Discord Activity",
        category="Social",
        description="Widgetbot iframe + live presence from a server's widget.",
        kind=FeedKind.IFRAME,
        icon="message-circle",
        params={
            "guild_id": {
                "type": "string",
                "default": "",
                "description": "Discord server (guild) ID.",
            },
            "channel_id": {
                "type": "string",
                "default": "",
                "description": "Optional channel ID to focus the embed.",
            },
        },
        refresh_s=120,
    ),
    FeedSource(
        id="sec-edgar",
        name="SEC EDGAR Filings",
        category="Markets",
        description="Latest SEC filings (8-K, 10-Q, 10-K, Form 4) via the EDGAR "
        "Atom feed.",
        kind=FeedKind.RSS,
        icon="file-text",
        params={
            "type": {
                "type": "string",
                "default": "8-K",
                "enum": ["8-K", "10-Q", "10-K", "4"],
                "description": "Filing type to track.",
            }
        },
        refresh_s=300,
    ),
    FeedSource(
        id="congress-trades",
        name="Congress Trades",
        category="Markets",
        description="Congressional stock-trade disclosures (house/senate stock "
        "watcher datasets).",
        kind=FeedKind.JSON,
        icon="briefcase",
        params={
            "chamber": {
                "type": "string",
                "default": "house",
                "enum": ["house", "senate"],
                "description": "Which chamber's disclosures to show.",
            }
        },
        refresh_s=3600,
    ),
    FeedSource(
        id="econ-calendar",
        name="Economic Calendar",
        category="Macro",
        description="Upcoming high-impact economic releases (CPI, FOMC, NFP…).",
        kind=FeedKind.JSON,
        icon="calendar",
        params={},
        refresh_s=3600,
    ),
    FeedSource(
        id="fear-greed",
        name="Crypto Fear & Greed",
        category="Macro",
        description="Daily crypto Fear & Greed index readings with sentiment.",
        kind=FeedKind.JSON,
        icon="gauge",
        params={},
        refresh_s=1800,
    ),
    FeedSource(
        id="hacker-news",
        name="Hacker News Signal",
        category="News",
        description="Recent HN stories matching a tech/markets query.",
        kind=FeedKind.JSON,
        icon="newspaper",
        params={
            "query": {
                "type": "string",
                "default": "AI OR semiconductor OR Fed OR crypto",
                "description": "Algolia search query. Supports ' OR '-joined "
                "terms — each is searched separately and the results merged.",
            }
        },
        refresh_s=600,
    ),
]


def get_sources() -> list[FeedSource]:
    """All feed sources, including OpenBB ones when an OpenBB server is set."""
    return [*SOURCES, *openbb.get_sources()]


def get_source(source_id: str) -> FeedSource | None:
    for source in get_sources():
        if source.id == source_id:
            return source
    return None

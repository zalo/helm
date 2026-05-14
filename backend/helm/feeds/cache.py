"""Async-safe TTL cache for feed fetches.

Keyed by (source_id, params, limit) so repeated widget refreshes within the TTL
window don't hammer upstream sites (several of which — notably SEC EDGAR —
rate-limit or block aggressive clients).
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from cachetools import TTLCache

from helm.config import get_settings
from helm.models import FeedItem

# maxsize is generous: ~9 sources * a handful of param combos each.
_cache: TTLCache[tuple[Any, ...], list[FeedItem]] = TTLCache(
    maxsize=256, ttl=get_settings().feed_cache_ttl_s
)
_lock = asyncio.Lock()


def _key(source_id: str, params: dict[str, Any], limit: int) -> tuple[Any, ...]:
    # params dict -> sorted tuple of items so the key is hashable + order-stable.
    return (source_id, tuple(sorted(params.items())), limit)


async def get_or_fetch(
    source_id: str,
    params: dict[str, Any],
    limit: int,
    fetcher: Callable[[str, dict[str, Any], int], Awaitable[list[FeedItem]]],
) -> list[FeedItem]:
    """Return cached items or invoke ``fetcher`` and cache the result.

    The lock is held across the upstream call so concurrent requests for the
    same key coalesce into a single fetch rather than a thundering herd.
    """
    key = _key(source_id, params, limit)
    async with _lock:
        cached = _cache.get(key)
        if cached is not None:
            return cached
        items = await fetcher(source_id, params, limit)
        _cache[key] = items
        return items


def clear() -> None:
    """Drop all cached entries (used by tests / manual refresh)."""
    _cache.clear()

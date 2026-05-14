"""``/api/feeds/*`` — exotic indicator feed sources.

main.py mounts this router at the ``/api/feeds`` prefix.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from helm.feeds import cache, fetchers
from helm.feeds.sources import get_source, get_sources
from helm.models import FeedItem, FeedSource, OEmbedResponse

router = APIRouter()

# Query params consumed directly by the endpoint — everything else is passed
# through to the fetcher as a source-specific ``param``.
_RESERVED_PARAMS = {"limit"}


@router.get("/sources", response_model=list[FeedSource])
async def list_sources() -> list[FeedSource]:
    """Every registered feed source (includes OpenBB sources when configured)."""
    return get_sources()


@router.get("/oembed", response_model=OEmbedResponse)
async def oembed(url: str = Query(..., description="URL to embed via oEmbed")) -> OEmbedResponse:
    """Proxy + sanitize an oEmbed response (Twitter/X and generic providers)."""
    result = await fetchers.fetch_oembed(url)
    if result is None:
        raise HTTPException(status_code=502, detail="oEmbed lookup failed for URL")
    html, provider, title = result
    return OEmbedResponse(html=html, provider=provider, title=title)


@router.get("/{source_id}", response_model=list[FeedItem])
async def get_feed(
    source_id: str,
    request: Request,
    limit: int = Query(20, ge=1, le=100),
) -> list[FeedItem]:
    """Fetch normalized items for ``source_id``.

    Arbitrary extra query params (``subreddit``, ``type``, ``query``, …) are
    forwarded to the fetcher. Results are served through the TTL cache.
    """
    if get_source(source_id) is None and not fetchers.is_known_source(source_id):
        raise HTTPException(status_code=404, detail=f"Unknown feed source: {source_id}")

    params: dict[str, Any] = {
        key: value
        for key, value in request.query_params.items()
        if key not in _RESERVED_PARAMS
    }

    return await cache.get_or_fetch(source_id, params, limit, fetchers.fetch)

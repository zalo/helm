/**
 * Static feed data for the demo build. Serves the frozen JSON snapshots that
 * were captured from the live backend's `/feeds/*` endpoints.
 */

import type { FeedItem, FeedSource, OEmbedResponse } from "../types";
import sourcesJson from "./snapshots/sources.json";
import whitehouse from "./snapshots/whitehouse.json";
import reddit from "./snapshots/reddit.json";
import twitter from "./snapshots/twitter.json";
import discord from "./snapshots/discord.json";
import secEdgar from "./snapshots/sec-edgar.json";
import congressTrades from "./snapshots/congress-trades.json";
import econCalendar from "./snapshots/econ-calendar.json";
import fearGreed from "./snapshots/fear-greed.json";
import hackerNews from "./snapshots/hacker-news.json";

const SNAPSHOTS: Record<string, FeedItem[]> = {
  whitehouse: whitehouse as FeedItem[],
  reddit: reddit as FeedItem[],
  twitter: twitter as FeedItem[],
  // discord's snapshot is the backend's single-item "unavailable" placeholder
  // (no guild_id configured) — normalise it to the FeedItem[] contract.
  discord: [discord as unknown as FeedItem],
  "sec-edgar": secEdgar as FeedItem[],
  "congress-trades": congressTrades as FeedItem[],
  "econ-calendar": econCalendar as FeedItem[],
  "fear-greed": fearGreed as FeedItem[],
  "hacker-news": hackerNews as FeedItem[],
};

/** Small synthetic delay so loading states are visible in the demo. */
function delay<T>(value: T, ms = 150): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export function getFeedSources(): Promise<FeedSource[]> {
  return delay(sourcesJson as FeedSource[]);
}

export function getFeed(
  sourceId: string,
  params: { limit?: number; query?: string } = {},
): Promise<FeedItem[]> {
  let items = SNAPSHOTS[sourceId] ?? [];

  // hacker-news is the one source where a light query filter is cheap & useful.
  if (sourceId === "hacker-news" && params.query) {
    const terms = params.query
      .split(/\s+OR\s+/i)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (terms.length) {
      const filtered = items.filter((it) => {
        const hay = `${it.title} ${it.summary}`.toLowerCase();
        return terms.some((t) => hay.includes(t));
      });
      // Fall back to the full snapshot if the filter wiped everything out.
      if (filtered.length) items = filtered;
    }
  }

  if (params.limit !== undefined) items = items.slice(0, params.limit);
  return delay(items);
}

export function getOembed(url: string): Promise<OEmbedResponse> {
  const html =
    `<blockquote class="helm-demo-embed">` +
    `<p>Live embeds are disabled in the static demo.</p>` +
    `<p><a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a></p>` +
    `</blockquote>`;
  return delay({ html, provider: "helm-demo", title: "Embed unavailable (static demo)" });
}

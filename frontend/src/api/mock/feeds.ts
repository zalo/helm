/**
 * Static feed data for the demo build. Serves frozen JSON snapshots captured
 * from the live backend, plus generators (`feedgen.ts`) that fill the gaps the
 * snapshots can't: per-subreddit Reddit, per-filing-type SEC, simulated
 * Discord chat, and a faux Twitter oEmbed card.
 */

import type { FeedItem, FeedSource, OEmbedResponse } from "../types";
import sourcesJson from "./snapshots/sources.json";
import whitehouse from "./snapshots/whitehouse.json";
import twitter from "./snapshots/twitter.json";
import congressTrades from "./snapshots/congress-trades.json";
import econCalendar from "./snapshots/econ-calendar.json";
import fearGreed from "./snapshots/fear-greed.json";
import hackerNews from "./snapshots/hacker-news.json";
import { redditThreads, secFilings, discordMessages, fauxTweetEmbed } from "./feedgen";

const SNAPSHOTS: Record<string, FeedItem[]> = {
  whitehouse:        whitehouse as FeedItem[],
  twitter:           twitter as FeedItem[],
  "congress-trades": congressTrades as FeedItem[],
  "econ-calendar":   econCalendar as FeedItem[],
  "fear-greed":      fearGreed as FeedItem[],
  "hacker-news":     hackerNews as FeedItem[],
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
  params: { limit?: number; query?: string; subreddit?: string; type?: string } = {},
): Promise<FeedItem[]> {
  let items: FeedItem[];

  switch (sourceId) {
    case "reddit":
      items = redditThreads(params.subreddit ?? "wallstreetbets");
      break;

    case "sec-edgar":
      items = secFilings(params.type ?? "8-K");
      break;

    case "discord":
      items = discordMessages();
      break;

    case "hacker-news": {
      // Light query filter — split on " OR " and match either term.
      items = SNAPSHOTS["hacker-news"];
      if (params.query) {
        const terms = params.query
          .split(/\s+OR\s+/i)
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
        if (terms.length) {
          const filtered = items.filter((it) => {
            const hay = `${it.title} ${it.summary}`.toLowerCase();
            return terms.some((t) => hay.includes(t));
          });
          if (filtered.length) items = filtered;
        }
      }
      break;
    }

    default:
      items = SNAPSHOTS[sourceId] ?? [];
  }

  if (params.limit !== undefined) items = items.slice(0, params.limit);
  return delay(items);
}

export function getOembed(url: string): Promise<OEmbedResponse> {
  return delay(fauxTweetEmbed(url));
}

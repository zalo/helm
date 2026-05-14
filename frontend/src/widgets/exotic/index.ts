/**
 * Exotic indicator widget bundle. Owned by the exotic-widgets build task.
 * These "embedded windows" pull market-moving signal from outside the order
 * book — social media, government, regulators, sentiment indices.
 */
import {
  Twitter,
  Landmark,
  MessageSquare,
  Hash,
  FileText,
  Gavel,
  CalendarClock,
  Gauge,
  Newspaper,
} from "lucide-react";

import { defineWidget, type WidgetDefinition } from "../types";
import { TwitterWidget } from "./TwitterWidget";
import { WhiteHouseWidget } from "./WhiteHouseWidget";
import { RedditWidget } from "./RedditWidget";
import { DiscordWidget } from "./DiscordWidget";
import { SECFilingsWidget } from "./SECFilingsWidget";
import { CongressTradesWidget } from "./CongressTradesWidget";
import { EconCalendarWidget } from "./EconCalendarWidget";
import { FearGreedWidget } from "./FearGreedWidget";
import { HackerNewsWidget } from "./HackerNewsWidget";

const twitter = defineWidget<{ accounts?: string[] }>({
  type: "twitter-feed",
  title: "Twitter / X",
  description: "Curated finance accounts plus paste-to-embed individual posts.",
  category: "Social",
  icon: Twitter,
  component: TwitterWidget,
  defaultConfig: {},
  minWidth: 300,
  minHeight: 240,
  defaultWidth: 380,
  defaultHeight: 460,
});

const whiteHouse = defineWidget({
  type: "white-house",
  title: "White House",
  description: "White House press releases as native feed cards.",
  category: "News",
  icon: Landmark,
  component: WhiteHouseWidget,
  defaultConfig: {},
  minWidth: 280,
  minHeight: 220,
  defaultWidth: 360,
  defaultHeight: 420,
});

const reddit = defineWidget<{ subreddit: string }>({
  type: "reddit",
  title: "Reddit",
  description: "Subreddit thread feed with quick-switch for markets communities.",
  category: "Social",
  icon: MessageSquare,
  component: RedditWidget,
  defaultConfig: { subreddit: "wallstreetbets" },
  minWidth: 280,
  minHeight: 220,
  defaultWidth: 360,
  defaultHeight: 440,
});

const discord = defineWidget<{ guild_id?: string; channel_id?: string }>({
  type: "discord",
  title: "Discord",
  description: "Embed a live Discord channel via Widgetbot.",
  category: "Social",
  icon: Hash,
  component: DiscordWidget,
  defaultConfig: {},
  minWidth: 320,
  minHeight: 280,
  defaultWidth: 420,
  defaultHeight: 520,
});

const secEdgar = defineWidget<{ filingType: string }>({
  type: "sec-edgar",
  title: "SEC Filings",
  description: "Live SEC EDGAR filing feed (8-K, 10-Q, 10-K, Form 4).",
  category: "News",
  icon: FileText,
  component: SECFilingsWidget,
  defaultConfig: { filingType: "8-K" },
  minWidth: 300,
  minHeight: 220,
  defaultWidth: 380,
  defaultHeight: 440,
});

const congressTrades = defineWidget({
  type: "congress-trades",
  title: "Congress Trades",
  description: "Congressional stock disclosures — representative, ticker, side, amount.",
  category: "Markets",
  icon: Gavel,
  component: CongressTradesWidget,
  defaultConfig: {},
  minWidth: 360,
  minHeight: 220,
  defaultWidth: 480,
  defaultHeight: 420,
});

const econCalendar = defineWidget({
  type: "econ-calendar",
  title: "Econ Calendar",
  description: "Upcoming economic events grouped by day with importance markers.",
  category: "Macro",
  icon: CalendarClock,
  component: EconCalendarWidget,
  defaultConfig: {},
  minWidth: 300,
  minHeight: 240,
  defaultWidth: 380,
  defaultHeight: 460,
});

const fearGreed = defineWidget({
  type: "fear-greed",
  title: "Crypto Fear & Greed",
  description: "Crypto Fear & Greed index — gauge dial plus 30-day history.",
  category: "Macro",
  icon: Gauge,
  component: FearGreedWidget,
  defaultConfig: {},
  minWidth: 260,
  minHeight: 300,
  defaultWidth: 320,
  defaultHeight: 380,
});

const hackerNews = defineWidget<{ query: string }>({
  type: "hacker-news",
  title: "Hacker News",
  description: "Hacker News stories filtered by an editable search query.",
  category: "News",
  icon: Newspaper,
  component: HackerNewsWidget,
  defaultConfig: { query: "AI OR semiconductor OR Fed OR crypto" },
  minWidth: 300,
  minHeight: 220,
  defaultWidth: 380,
  defaultHeight: 440,
});

export const exoticWidgets: WidgetDefinition[] = [
  twitter,
  whiteHouse,
  reddit,
  discord,
  secEdgar,
  congressTrades,
  econCalendar,
  fearGreed,
  hackerNews,
] as WidgetDefinition[];

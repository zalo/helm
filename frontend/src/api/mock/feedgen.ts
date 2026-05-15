/**
 * Feed generators for the demo build — fills the gaps the static JSON
 * snapshots can't cover: per-subreddit Reddit threads, per-filing-type SEC
 * filings, a simulated Discord chat, and a faux Twitter oEmbed card.
 *
 * Timestamps are computed from `Date.now()` so the data always reads as fresh.
 */

import type { FeedItem, OEmbedResponse, SignalSentiment } from "../types";

function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString();
}

function pad(n: number, w = 2): string {
  return n.toString().padStart(w, "0");
}

// =============================================================================
// Reddit — per-subreddit thread lists
// =============================================================================

interface RedditSeed {
  title: string;
  author: string;
  ageMin: number;
  sentiment?: SignalSentiment;
}

const REDDIT: Record<string, RedditSeed[]> = {
  wallstreetbets: [
    { title: "Daily Discussion Thread for May 14, 2026", author: "wsbTradeBot", ageMin: 90 },
    { title: "$NVDA earnings tomorrow — diamond hands or paper hands?", author: "yoloKing420", ageMin: 18, sentiment: "bullish" },
    { title: "Lost half my account on TSLA puts. AMA.", author: "sadtrader69", ageMin: 45, sentiment: "bearish" },
    { title: "GME squeeze v3 incoming — apes assemble 🦍", author: "DiamondHandsForever", ageMin: 75 },
    { title: "Weekly Earnings Thread 5/12 - 5/16", author: "OSRSkarma", ageMin: 240 },
    { title: "Made $40K on calls last week, then gave it all back. Pain.", author: "regretftw", ageMin: 12, sentiment: "bearish" },
    { title: "$SMCI setup is insane and nobody is watching", author: "actuallySensible", ageMin: 200, sentiment: "bullish" },
    { title: "Powell speaks tomorrow — what's the play?", author: "macroBro_wsb", ageMin: 30 },
    { title: "Cleared my retirement account on $ZIM. Proof inside.", author: "rip_my_401k", ageMin: 360, sentiment: "bearish" },
    { title: "Bought $50K of ARM at the dip 🚀🚀🚀", author: "techMomentumGuy", ageMin: 5, sentiment: "bullish" },
    { title: "200 IQ market commentary: it's all rigged but we still play", author: "schroPasta", ageMin: 720 },
    { title: "Stop loss at -50% — that's normal right?", author: "newToOptions", ageMin: 16, sentiment: "neutral" },
  ],
  stocks: [
    { title: "Apple Q2 recap: services growth offsets iPhone weakness", author: "valueDriven", ageMin: 60, sentiment: "bullish" },
    { title: "Why I'm long TSM — TSMC is the picks-and-shovels AI play", author: "longTermView", ageMin: 240, sentiment: "bullish" },
    { title: "DD: $UBER undervalued at these levels — full breakdown", author: "diligentInvestor", ageMin: 180, sentiment: "bullish" },
    { title: "Earnings season recap — winners, losers, and surprises", author: "marketAnalyst", ageMin: 300 },
    { title: "Berkshire 13F dropped — Buffett added to OXY", author: "mergersAndAcquisitions", ageMin: 720 },
    { title: "JPM/HSBC merger rumors — what's the read?", author: "macroFanatic", ageMin: 120 },
    { title: "Are we in a bubble or healthy expansion?", author: "marketHistorian", ageMin: 480 },
    { title: "Costco vs Walmart — which membership model wins long-term?", author: "retailWatcher", ageMin: 600, sentiment: "neutral" },
    { title: "Boeing back in trouble — quality issues continue", author: "industrialEye", ageMin: 1440, sentiment: "bearish" },
    { title: "Energy sector rotation: XLE outperformed by 6% YTD", author: "sectorWatcher", ageMin: 2880, sentiment: "bullish" },
  ],
  cryptocurrency: [
    { title: "BTC breaking out above $72K — ETF inflows accelerating", author: "btcMaximalist", ageMin: 22, sentiment: "bullish" },
    { title: "ETH staking yield drops below 3% — bearish for validators?", author: "ethDev", ageMin: 90, sentiment: "bearish" },
    { title: "Solana TPS hits new ATH — network upgrade live", author: "solChad", ageMin: 60, sentiment: "bullish" },
    { title: "DeFi summer 2.0? TVL up 40% MoM across major chains", author: "defiAlchemist", ageMin: 180, sentiment: "bullish" },
    { title: "Daily Discussion - May 14, 2026", author: "AutoModerator", ageMin: 360 },
    { title: "Fear & Greed back at 'extreme greed' — time to take profits?", author: "tacticalTrader", ageMin: 40 },
    { title: "SEC approves new spot ETH ETF applications", author: "regWatcher", ageMin: 720, sentiment: "bullish" },
    { title: "Whale wallets accumulating BTC for 3 weeks straight (on-chain data)", author: "glassnode_fan", ageMin: 240, sentiment: "bullish" },
    { title: "Bitcoin halving aftermath: miner capitulation incoming?", author: "minerWatcher", ageMin: 1440, sentiment: "bearish" },
    { title: "L2 wars: Base vs Arbitrum vs Optimism — TVL comparison", author: "l2researcher", ageMin: 600 },
  ],
  economics: [
    { title: "CPI prints 0.2% MoM — softer than expected, rate cut odds rising", author: "macroDad", ageMin: 28, sentiment: "bullish" },
    { title: "Yield curve un-inverts for the first time since 2022", author: "yieldCurveWatcher", ageMin: 180 },
    { title: "ECB cuts deposit rate 25bp, signals more dovish outlook", author: "euroEconomist", ageMin: 240 },
    { title: "Powell speech tomorrow — markets pricing in 2 cuts by year-end", author: "fedWatcher", ageMin: 45 },
    { title: "China Q1 GDP beats at 5.4% — stimulus working?", author: "asiaAnalyst", ageMin: 720 },
    { title: "US labor market: NFP at 175K, unemployment ticks up to 3.9%", author: "laborStats", ageMin: 480 },
    { title: "Why M2 money supply matters — long-form discussion", author: "monetaryTheorist", ageMin: 1440 },
    { title: "Recession indicators we should actually be watching", author: "dataDrivenEcon", ageMin: 600 },
    { title: "Japan ends YCC — implications for the JGB market", author: "fxRatesGuy", ageMin: 2880 },
  ],
};

export function redditThreads(subreddit: string): FeedItem[] {
  const list = REDDIT[subreddit] ?? REDDIT.wallstreetbets;
  return list.map((t, i) => ({
    id: `reddit-${subreddit}-${i}`,
    source_id: "reddit",
    title: t.title,
    summary: `submitted by /u/${t.author}`,
    url: `https://www.reddit.com/r/${subreddit}/`,
    author: `/u/${t.author}`,
    published: minutesAgo(t.ageMin),
    image: null,
    html: null,
    sentiment: t.sentiment ?? null,
    meta: { subreddit, demo: true },
  }));
}

// =============================================================================
// SEC EDGAR — per-filing-type lists
// =============================================================================

interface SECSeed {
  company: string;
  cik: string;
  ageMin: number;
  detail: string;
}

const SEC: Record<string, SECSeed[]> = {
  "8-K": [
    { company: "ALLIANCE ENTERTAINMENT HOLDING CORP", cik: "0001823584", ageMin: 30,   detail: "Item 2.02: Results of Operations · Item 9.01: Financial Statements" },
    { company: "NVIDIA CORP",                          cik: "0001045810", ageMin: 60,   detail: "Item 5.02: Departure of Directors or Certain Officers" },
    { company: "META PLATFORMS INC",                   cik: "0001326801", ageMin: 90,   detail: "Item 1.01: Entry into a Material Definitive Agreement" },
    { company: "TESLA INC",                            cik: "0001318605", ageMin: 120,  detail: "Item 8.01: Other Events" },
    { company: "APPLE INC",                            cik: "0000320193", ageMin: 180,  detail: "Item 7.01: Regulation FD Disclosure" },
    { company: "MICROSOFT CORP",                       cik: "0000789019", ageMin: 240,  detail: "Item 2.02: Results of Operations and Financial Condition" },
    { company: "AMAZON.COM INC",                       cik: "0001018724", ageMin: 360,  detail: "Item 9.01: Financial Statements and Exhibits" },
    { company: "JPMORGAN CHASE & CO",                  cik: "0000019617", ageMin: 480,  detail: "Item 5.07: Submission of Matters to a Vote of Security Holders" },
    { company: "BERKSHIRE HATHAWAY INC",               cik: "0001067983", ageMin: 720,  detail: "Item 8.01: Other Events" },
    { company: "WALMART INC",                          cik: "0000104169", ageMin: 1440, detail: "Item 7.01: Regulation FD Disclosure" },
  ],
  "10-Q": [
    { company: "ALPHABET INC",            cik: "0001652044", ageMin: 240,  detail: "Quarterly Report — Q1 2026 · Revenue $94.3B (+13% YoY)" },
    { company: "JOHNSON & JOHNSON",       cik: "0000200406", ageMin: 720,  detail: "Quarterly Report — Q1 2026 · Pharma segment +6% YoY" },
    { company: "PROCTER & GAMBLE CO",     cik: "0000080424", ageMin: 1440, detail: "Quarterly Report — Q1 2026 · Organic sales +4%" },
    { company: "VISA INC",                cik: "0001403161", ageMin: 360,  detail: "Quarterly Report — Q1 2026 · Payments volume +9% YoY" },
    { company: "MASTERCARD INC",          cik: "0001141391", ageMin: 480,  detail: "Quarterly Report — Q1 2026 · Cross-border volume +18%" },
    { company: "UNITEDHEALTH GROUP INC",  cik: "0000731766", ageMin: 600,  detail: "Quarterly Report — Q1 2026 · Optum Health revenue +12%" },
    { company: "COSTCO WHOLESALE CORP",   cik: "0000909832", ageMin: 1080, detail: "Quarterly Report — Q1 2026 · Comparable sales +5.4%" },
    { company: "ELI LILLY AND CO",        cik: "0000059478", ageMin: 1200, detail: "Quarterly Report — Q1 2026 · Mounjaro / Zepbound sales surge" },
  ],
  "10-K": [
    { company: "EXXON MOBIL CORP",         cik: "0000034088", ageMin: 1440,  detail: "Annual Report 2025 · Total revenue $336B" },
    { company: "CHEVRON CORP",             cik: "0000093410", ageMin: 2880,  detail: "Annual Report 2025 · Free cash flow $19.8B" },
    { company: "BANK OF AMERICA CORP",     cik: "0000070858", ageMin: 4320,  detail: "Annual Report 2025 · Net interest income $58B" },
    { company: "WELLS FARGO & CO",         cik: "0000072971", ageMin: 5760,  detail: "Annual Report 2025 · Provision for credit losses $4.1B" },
    { company: "CISCO SYSTEMS INC",        cik: "0000858877", ageMin: 7200,  detail: "Annual Report 2025 · Subscription revenue +21% YoY" },
    { company: "INTEL CORP",               cik: "0000050863", ageMin: 8640,  detail: "Annual Report 2025 · Foundry segment losses widen" },
    { company: "QUALCOMM INC",             cik: "0000804328", ageMin: 10080, detail: "Annual Report 2025 · Handset revenue stabilizing" },
  ],
  "4": [
    { company: "Cook, Tim — CEO of AAPL",       cik: "0001214156", ageMin: 60,   detail: "Sale of 50,000 shares @ $228.50 = $11.4M" },
    { company: "Huang, Jensen — CEO of NVDA",   cik: "0001045810", ageMin: 120,  detail: "Sale of 30,000 shares @ $135.20 = $4.05M" },
    { company: "Musk, Elon — CEO of TSLA",      cik: "0001318605", ageMin: 240,  detail: "Award of 1,000,000 RSUs (performance-based)" },
    { company: "Zuckerberg, Mark — CEO of META", cik: "0001326801", ageMin: 360,  detail: "Sale of 25,000 shares @ $620.00 = $15.5M" },
    { company: "Bezos, Jeff — Director of AMZN", cik: "0001018724", ageMin: 480,  detail: "Sale of 100,000 shares @ $185.00 = $18.5M" },
    { company: "Pichai, Sundar — CEO of GOOGL", cik: "0001652044", ageMin: 720,  detail: "Acquisition of 5,000 shares (open-market purchase)" },
    { company: "Nadella, Satya — CEO of MSFT",  cik: "0000789019", ageMin: 1440, detail: "Sale of 20,000 shares @ $415.00 = $8.3M" },
    { company: "Dimon, Jamie — CEO of JPM",     cik: "0000019617", ageMin: 2160, detail: "Sale of 100,000 shares @ $192.00 = $19.2M" },
  ],
};

export function secFilings(filingType: string): FeedItem[] {
  const list = SEC[filingType] ?? SEC["8-K"];
  const today = new Date();
  const dateStr = `${today.getUTCFullYear()}-${pad(today.getUTCMonth() + 1)}-${pad(today.getUTCDate())}`;
  return list.map((s, i) => ({
    id: `sec-${filingType}-${i}`,
    source_id: "sec-edgar",
    title: `${filingType} - ${s.company} (${s.cik}) (Filer)`,
    summary: `Filed: ${dateStr} · ${s.detail}`,
    url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${s.cik}&type=${encodeURIComponent(filingType)}`,
    author: s.company,
    published: minutesAgo(s.ageMin),
    image: null,
    html: null,
    sentiment: null,
    meta: { type: filingType, cik: s.cik, demo: true },
  }));
}

// =============================================================================
// Discord — simulated #market-talk channel
// =============================================================================

interface DiscordMsg {
  user: string;
  text: string;
  ageMin: number;
  /** Hex color used for the user avatar/role accent. */
  color: string;
  /** Optional bot/system flag — renders with a subdued style. */
  bot?: boolean;
}

const DISCORD_LOG: DiscordMsg[] = [
  { user: "TraderMike",     text: "Anyone else seeing $NVDA acting weird in pre-market?",        ageMin: 1,   color: "#ff8000" },
  { user: "QuantQueen",     text: "Vol just spiked. Watching.",                                  ageMin: 2,   color: "#22c5b3" },
  { user: "MacroMan",       text: "CPI in 30 min. Strap in.",                                    ageMin: 4,   color: "#5865f2" },
  { user: "TraderMike",     text: "Loaded SPY puts last night. Hoping for a hot print.",         ageMin: 5,   color: "#ff8000" },
  { user: "btcWhale",       text: "BTC just broke 72K. Liquidations cascading.",                 ageMin: 8,   color: "#f7931a" },
  { user: "Helm Bot",       text: "🔔 Auto-alert: AAPL crossed +5% on the day",                  ageMin: 11,  color: "#888888", bot: true },
  { user: "QuantQueen",     text: "RSI on QQQ at 78. Overbought territory.",                     ageMin: 13,  color: "#22c5b3" },
  { user: "BoringBondGuy",  text: "10Y at 4.12%, off the highs but still elevated.",             ageMin: 17,  color: "#7289da" },
  { user: "MacroMan",       text: "If CPI prints below 0.3% MoM I think we get a 50bp cut.",     ageMin: 19,  color: "#5865f2" },
  { user: "yoloKing",       text: "Bought 200 NVDA 140C expiring Friday 🚀🚀",                   ageMin: 22,  color: "#eb459e" },
  { user: "QuantQueen",     text: "@yoloKing godspeed",                                          ageMin: 23,  color: "#22c5b3" },
  { user: "TraderMike",     text: "lol",                                                          ageMin: 23,  color: "#ff8000" },
  { user: "btcWhale",       text: "Spot BTC ETF inflows yesterday: $1.2B. Insane.",              ageMin: 28,  color: "#f7931a" },
  { user: "DataNerd",       text: "On-chain whale activity at 90-day high. Bullish.",            ageMin: 31,  color: "#57f287" },
  { user: "Helm Bot",       text: "🔔 Helm AI Trader: BUY signal on BTCUSDT (confidence 71%)",   ageMin: 35,  color: "#888888", bot: true },
  { user: "TraderMike",     text: "Helm bot calling the top again 😅",                           ageMin: 36,  color: "#ff8000" },
  { user: "MacroMan",       text: "Powell speaks at 2pm. Watch the dot plot.",                   ageMin: 42,  color: "#5865f2" },
  { user: "BoringBondGuy",  text: "Curve flatter on the day. 2s10s back to -2bp.",               ageMin: 48,  color: "#7289da" },
  { user: "QuantQueen",     text: "Anyone running mean-reversion strats today? Conditions look ripe.", ageMin: 55, color: "#22c5b3" },
  { user: "yoloKing",       text: "i'm up 3K already this morning 🟢🟢🟢",                       ageMin: 60,  color: "#eb459e" },
  { user: "DataNerd",       text: "VIX at 14.2. Calm before the storm?",                         ageMin: 75,  color: "#57f287" },
  { user: "MacroMan",       text: "China stimulus headlines hitting the tape. Risk-on.",         ageMin: 90,  color: "#5865f2" },
  { user: "btcWhale",       text: "Solana ETF approval rumors. Could be huge for SOL.",          ageMin: 110, color: "#f7931a" },
  { user: "TraderMike",     text: "GM all 👋",                                                    ageMin: 240, color: "#ff8000" },
];

export function discordMessages(): FeedItem[] {
  return DISCORD_LOG.map((m, i) => ({
    id: `discord-${i}`,
    source_id: "discord",
    title: m.text,
    summary: "",
    url: "",
    author: m.user,
    published: minutesAgo(m.ageMin),
    image: null,
    html: null,
    sentiment: null,
    meta: { color: m.color, channel: "market-talk", bot: !!m.bot, demo: true },
  }));
}

// =============================================================================
// Twitter — faux oEmbed card for paste-to-embed
// =============================================================================

const FAUX_TWEETS: string[] = [
  "Markets are doing markets things again.",
  "Just looking at the chart. No edits.",
  "Anyone else watching this divergence? 👀",
  "Liquidity > narrative. Always has been.",
  "Fed put still very much alive imo.",
  "🚀",
  "Risk-on regime, until it isn't.",
  "Hot take: this rotation has more legs than people think.",
  "Bonds catching a bid. Watch the long end.",
  "If you're not paying attention to the curve, you're not paying attention.",
];

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function fauxTweetEmbed(url: string): OEmbedResponse {
  // Pull a username out of the URL when possible (twitter.com/<user>/status/...).
  const m = url.match(/(?:twitter|x)\.com\/([^/?#]+)/i);
  const handle = m?.[1] && m[1] !== "i" ? m[1] : "user";
  const seed = fnv1a(url);
  const text = FAUX_TWEETS[seed % FAUX_TWEETS.length];
  const likes = 200 + (seed % 9800);
  const reposts = 30 + ((seed >>> 8) % 1500);
  const replies = 5 + ((seed >>> 16) % 400);

  // Compose tiny HTML — styled inline so the widget's `dangerouslySetInnerHTML`
  // renders it consistently regardless of host CSS.
  const html =
    `<div style="font-family:'DM Sans',system-ui,sans-serif;background:#1b1b1f;` +
    `border:1px solid #323237;border-radius:12px;padding:14px 16px;color:#fff;">` +
    `<div style="display:flex;align-items:center;gap:10px;">` +
    `<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#ff8000,#5865f2);` +
    `display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;">` +
    `${handle.slice(0, 2).toUpperCase()}</div>` +
    `<div style="line-height:1.2;">` +
    `<div style="font-weight:600;">${handle}</div>` +
    `<div style="font-size:11px;color:#9a9aa2;">@${handle} · demo</div>` +
    `</div>` +
    `<div style="margin-left:auto;font-size:10px;padding:2px 8px;border:1px solid #444;` +
    `border-radius:999px;color:#9a9aa2;">DEMO</div>` +
    `</div>` +
    `<p style="margin:10px 0 6px;font-size:13px;line-height:1.45;">${text}</p>` +
    `<div style="display:flex;gap:14px;font-size:11px;color:#9a9aa2;border-top:1px solid #2b2b31;padding-top:8px;margin-top:6px;">` +
    `<span>💬 ${replies}</span>` +
    `<span>🔁 ${reposts}</span>` +
    `<span>♥ ${likes.toLocaleString()}</span>` +
    `<a href="${url}" target="_blank" rel="noreferrer" style="margin-left:auto;color:#ff8000;text-decoration:none;">open ↗</a>` +
    `</div>` +
    `</div>`;

  return {
    html,
    provider: "helm-demo",
    title: `Embed (demo) — @${handle}`,
  };
}

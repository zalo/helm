import { useQuery } from "@tanstack/react-query";
import { Hash, Settings2 } from "lucide-react";
import type { WidgetProps } from "../types";
import type { FeedItem } from "@/api/types";
import { relativeTime } from "@/lib/format";
import { feed, WidgetShell, Loading, ErrorState } from "./_shared";
import { cn } from "@/lib/cn";

const SOURCE = "discord";
const REFRESH_MS = 600_000;

interface DiscordConfig {
  guild_id?: string;
  channel_id?: string;
}

/** Pull a Widgetbot embed URL out of FeedItem.meta, if the backend provided one. */
function metaEmbedUrl(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;
  for (const k of ["embed_url", "embedUrl", "url", "iframe"]) {
    const v = meta[k];
    if (typeof v === "string" && v.startsWith("http")) return v;
  }
  return null;
}

/** Did the feed give us simulated chat messages (channel-tagged FeedItems)? */
function isChatFeed(items: FeedItem[] | undefined): boolean {
  return Boolean(items && items.length > 0 && typeof items[0].meta?.channel === "string");
}

// --- chat rendering ---------------------------------------------------------

function ChatMessage({ item }: { item: FeedItem }) {
  const color = (item.meta?.color as string) ?? "#5865f2";
  const isBot = item.meta?.bot === true;
  const initial = (item.author || "?").replace(/^[^A-Za-z0-9]+/, "").slice(0, 1).toUpperCase();

  return (
    <div className="flex gap-2.5 px-2.5 py-1 hover:bg-bg-2/40">
      <div
        className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-2xs font-bold text-white"
        style={{ backgroundColor: color }}
      >
        {initial || "?"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span
            className={cn(
              "truncate text-xs font-semibold",
              isBot ? "text-fg-muted" : "text-fg",
            )}
            style={!isBot ? { color } : undefined}
          >
            {item.author}
          </span>
          {isBot && (
            <span className="rounded bg-accent/20 px-1 py-0.5 text-[9px] font-bold uppercase text-accent">
              BOT
            </span>
          )}
          {item.published && (
            <span className="text-2xs text-fg-faint">{relativeTime(item.published)}</span>
          )}
        </div>
        <div className="text-xs leading-snug text-fg/90">{item.title}</div>
      </div>
    </div>
  );
}

function ChatChannel({ items, channel }: { items: FeedItem[]; channel: string }) {
  // Reverse so oldest at top, newest at bottom (Discord-style read order).
  const ordered = [...items].reverse();
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-border bg-bg-2 px-2.5 py-1.5">
        <Hash size={12} className="text-fg-faint" />
        <span className="text-2xs font-semibold text-fg-muted">{channel}</span>
        <span className="ml-auto text-2xs text-fg-faint">demo channel</span>
      </div>
      <div className="scroll-y min-h-0 flex-1 py-1.5">
        {ordered.map((it) => (
          <ChatMessage key={it.id} item={it} />
        ))}
      </div>
    </div>
  );
}

// --- widget -----------------------------------------------------------------

export function DiscordWidget({ config }: WidgetProps<DiscordConfig>) {
  const { guild_id, channel_id } = config;

  // Always query — the feed itself decides whether we get a chat (demo) or an
  // iframe-resolution placeholder (real backend).
  const q = useQuery({
    queryKey: ["feed", SOURCE, guild_id ?? "", channel_id ?? ""],
    queryFn: () => feed(SOURCE, { guild_id, channel_id }),
    refetchInterval: REFRESH_MS,
  });

  // 1) Demo / simulated chat feed — render chat messages.
  if (isChatFeed(q.data)) {
    const channel =
      (q.data?.[0]?.meta?.channel as string | undefined) ?? "market-talk";
    return (
      <WidgetShell
        header={
          <>
            <Hash size={14} className="text-accent" />
            <span className="text-xs font-semibold">Discord</span>
            <span className="ml-auto text-2xs text-fg-faint">simulated</span>
          </>
        }
      >
        <ChatChannel items={q.data!} channel={channel} />
      </WidgetShell>
    );
  }

  // 2) Real-backend path — Widgetbot iframe if guild configured.
  const fromMeta = q.data?.length ? metaEmbedUrl(q.data[0].meta) : null;
  const embedUrl =
    fromMeta ??
    (guild_id
      ? `https://e.widgetbot.io/channels/${encodeURIComponent(guild_id)}${
          channel_id ? `/${encodeURIComponent(channel_id)}` : ""
        }`
      : null);

  return (
    <WidgetShell
      header={
        <>
          <Hash size={14} className="text-accent" />
          <span className="text-xs font-semibold">Discord</span>
          {guild_id && (
            <span className="num text-2xs text-fg-faint">
              {guild_id}
              {channel_id ? ` / ${channel_id}` : ""}
            </span>
          )}
        </>
      }
    >
      {q.isLoading ? (
        <Loading label="Resolving channel…" />
      ) : !embedUrl ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center text-fg-faint">
          <Settings2 size={20} />
          <p className="text-xs text-fg-muted">No Discord server configured.</p>
          <p className="text-2xs">
            Set a <span className="num text-fg">guild_id</span> (and optional{" "}
            <span className="num text-fg">channel_id</span>) in this widget's settings to embed a
            live channel.
          </p>
        </div>
      ) : q.isError ? (
        <ErrorState source="Discord channel" onRetry={() => q.refetch()} />
      ) : (
        <iframe
          key={embedUrl}
          src={embedUrl}
          title="Discord channel"
          className="h-full w-full border-0 bg-bg-1"
          sandbox="allow-scripts allow-same-origin allow-popups"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      )}
    </WidgetShell>
  );
}

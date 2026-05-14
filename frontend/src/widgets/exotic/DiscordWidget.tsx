import { useQuery } from "@tanstack/react-query";
import { Hash, Settings2 } from "lucide-react";
import type { WidgetProps } from "../types";
import { feed, WidgetShell, Loading, ErrorState } from "./_shared";

const SOURCE = "discord";
const REFRESH_MS = 600_000;

interface DiscordConfig {
  guild_id?: string;
  channel_id?: string;
}

/** Pull a Widgetbot embed URL out of a FeedItem.meta, if the backend provided one. */
function metaEmbedUrl(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;
  for (const k of ["embed_url", "embedUrl", "url", "iframe"]) {
    const v = meta[k];
    if (typeof v === "string" && v.startsWith("http")) return v;
  }
  return null;
}

export function DiscordWidget({ config }: WidgetProps<DiscordConfig>) {
  const { guild_id, channel_id } = config;
  const configured = Boolean(guild_id);

  // Only hit the feed when we have a guild; it supplies the canonical embed URL.
  const q = useQuery({
    queryKey: ["feed", SOURCE, guild_id ?? "", channel_id ?? ""],
    queryFn: () => feed(SOURCE, { guild_id, channel_id }),
    refetchInterval: REFRESH_MS,
    enabled: configured,
  });

  // Prefer the backend-provided embed URL; fall back to building one.
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
      {!configured ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center text-fg-faint">
          <Settings2 size={20} />
          <p className="text-xs text-fg-muted">No Discord server configured.</p>
          <p className="text-2xs">
            Set a <span className="num text-fg">guild_id</span> (and optional{" "}
            <span className="num text-fg">channel_id</span>) in this widget's settings to embed a
            live channel.
          </p>
        </div>
      ) : configured && q.isLoading ? (
        <Loading label="Resolving channel…" />
      ) : q.isError && !embedUrl ? (
        <ErrorState source="Discord channel" onRetry={() => q.refetch()} />
      ) : embedUrl ? (
        <iframe
          key={embedUrl}
          src={embedUrl}
          title="Discord channel"
          className="h-full w-full border-0 bg-bg-1"
          sandbox="allow-scripts allow-same-origin allow-popups"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      ) : (
        <ErrorState source="Discord channel" onRetry={() => q.refetch()} />
      )}
    </WidgetShell>
  );
}

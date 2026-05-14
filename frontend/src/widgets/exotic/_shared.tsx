/**
 * Internal helpers shared across the exotic indicator widgets. Self-contained
 * (no dependency on src/components/ui.tsx or src/workspace/*) so this bundle
 * stays decoupled and buildable in isolation.
 */
import type { ReactNode } from "react";
import { Loader2, AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import { api } from "@/api/client";
import type { FeedItem, SignalSentiment } from "@/api/types";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * `api.feed`'s public type only declares `limit` / `query`, but the backend
 * feed sources also take per-source params (subreddit, type, guild_id, …).
 * This thin wrapper passes them through without fighting the narrow type.
 */
export function feed(sourceId: string, params: Record<string, string | number | undefined> = {}) {
  return api.feed(sourceId, params as { limit?: number; query?: string });
}

/* ------------------------------------------------------------------ */
/* Widget-level states — loading / empty / error.                      */
/* ------------------------------------------------------------------ */

function CenterState({ icon, label, tone }: { icon: ReactNode; label: string; tone?: string }) {
  return (
    <div className={cn("flex h-full w-full flex-col items-center justify-center gap-2", tone ?? "text-fg-faint")}>
      {icon}
      <span className="text-xs">{label}</span>
    </div>
  );
}

export const Loading = ({ label = "Loading…" }: { label?: string }) => (
  <CenterState icon={<Loader2 size={18} className="animate-spin" />} label={label} />
);

export const Empty = ({ label = "Nothing here yet" }: { label?: string }) => (
  <CenterState icon={<Inbox size={18} />} label={label} />
);

export function ErrorState({ source, onRetry }: { source: string; onRetry: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-loss">
      <AlertTriangle size={18} />
      <span className="text-xs">couldn't load {source}</span>
      <button className="btn text-xs" onClick={onRetry}>
        <RefreshCw size={12} /> Retry
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Skeleton rows — subtle loading placeholder for feed lists.          */
/* ------------------------------------------------------------------ */

export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-1.5 panel-pad">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded border border-border bg-bg-1 p-2">
          <div className="h-3 w-3/4 rounded bg-bg-3" />
          <div className="mt-2 h-2.5 w-1/3 rounded bg-bg-2" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sentiment chip — bullish=gain, bearish=loss, neutral=fg-muted.      */
/* ------------------------------------------------------------------ */

const SENTIMENT_STYLE: Record<SignalSentiment, string> = {
  bullish: "bg-gain/15 text-gain",
  bearish: "bg-loss/15 text-loss",
  neutral: "bg-bg-3 text-fg-muted",
};

export function SentimentChip({ sentiment }: { sentiment: SignalSentiment | null | undefined }) {
  if (!sentiment) return null;
  return <span className={cn("chip", SENTIMENT_STYLE[sentiment])}>{sentiment}</span>;
}

/* ------------------------------------------------------------------ */
/* Widget chrome — header bar + scrollable body.                       */
/* ------------------------------------------------------------------ */

export function WidgetShell({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col bg-bg-0">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2.5 py-1.5">
        {header}
      </div>
      <div className="scroll-y min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** Small segmented switcher used for config quick-toggles. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={cn("chip border", value === opt ? "btn-accent" : "border-border text-fg-muted hover:bg-bg-2")}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Feed card — the consistent look across RSS/JSON feed widgets.       */
/* ------------------------------------------------------------------ */

export function FeedCard({ item, children }: { item: FeedItem; children?: ReactNode }) {
  const hasLink = Boolean(item.url);
  const Tag = hasLink ? "a" : "div";
  return (
    <Tag
      {...(hasLink ? { href: item.url, target: "_blank", rel: "noreferrer" } : {})}
      className={cn(
        "block rounded border border-border bg-bg-1 p-2 transition-colors",
        hasLink && "hover:border-border-strong hover:bg-bg-2",
      )}
    >
      <div className="text-xs font-medium leading-snug text-fg">{item.title}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-fg-faint">
        {item.author && <span className="truncate text-fg-muted">{item.author}</span>}
        {item.author && item.published && <span>·</span>}
        {item.published && <span className="num">{relativeTime(item.published)}</span>}
        <SentimentChip sentiment={item.sentiment} />
      </div>
      {item.summary && (
        <p className="mt-1.5 line-clamp-3 text-2xs leading-relaxed text-fg-muted">{item.summary}</p>
      )}
      {children}
    </Tag>
  );
}

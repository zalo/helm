import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Twitter, Link2, X, Loader2, AlertTriangle } from "lucide-react";
import type { WidgetProps } from "../types";
import { api } from "@/api/client";
import { feed, WidgetShell, FeedCard, Loading, Empty, ErrorState, SkeletonList } from "./_shared";

const SOURCE = "twitter";
const REFRESH_MS = 120_000;

interface TwitterConfig {
  accounts?: string[];
}

/** Sandboxed oEmbed render. Backend sanitizes the HTML; we still isolate it. */
function EmbedPane({ url, onClear }: { url: string; onClear: () => void }) {
  const q = useQuery({
    queryKey: ["oembed", url],
    queryFn: () => api.oembed(url),
    retry: 1,
  });

  return (
    <div className="border-b border-border bg-bg-1">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Link2 size={12} className="text-accent" />
        <span className="min-w-0 flex-1 truncate text-2xs text-fg-muted">{url}</span>
        <button onClick={onClear} className="chip border border-border text-fg-faint hover:bg-bg-2">
          <X size={11} />
        </button>
      </div>
      <div className="panel-pad pt-0">
        {q.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-2xs text-fg-faint">
            <Loader2 size={14} className="animate-spin" /> Loading embed…
          </div>
        ) : q.isError || !q.data?.html ? (
          <div className="flex items-center gap-2 py-4 text-2xs text-loss">
            <AlertTriangle size={14} /> Couldn't embed that URL.
          </div>
        ) : (
          // Backend-sanitized oEmbed markup; isolated in its own container.
          <div
            className="overflow-hidden rounded border border-border bg-bg-0 [&_iframe]:max-w-full"
            dangerouslySetInnerHTML={{ __html: q.data.html }}
          />
        )}
      </div>
    </div>
  );
}

export function TwitterWidget({ config }: WidgetProps<TwitterConfig>) {
  const [draft, setDraft] = useState("");
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);

  const accounts = config.accounts;
  const q = useQuery({
    queryKey: ["feed", SOURCE, accounts ?? "curated"],
    queryFn: () => feed(SOURCE, { limit: 40, query: accounts?.join(",") }),
    refetchInterval: REFRESH_MS,
  });

  const submit = () => {
    const url = draft.trim();
    if (/^https?:\/\//i.test(url)) {
      setEmbedUrl(url);
      setDraft("");
    }
  };

  return (
    <WidgetShell
      header={
        <>
          <Twitter size={14} className="text-accent" />
          <span className="text-xs font-semibold">Twitter / X</span>
          <div className="ml-auto flex items-center gap-1 rounded border border-border bg-bg-1 px-1.5 py-0.5">
            <Link2 size={11} className="text-fg-faint" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="paste tweet URL to embed…"
              className="w-48 bg-transparent text-2xs text-fg outline-none placeholder:text-fg-faint"
            />
          </div>
        </>
      }
    >
      {embedUrl && <EmbedPane url={embedUrl} onClear={() => setEmbedUrl(null)} />}

      {q.isLoading ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState source="Twitter feed" onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <Empty label="No posts — best-effort timelines" />
      ) : q.isFetching && !q.data ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-1.5 panel-pad">
          {q.data.map((item) => (
            <FeedCard key={item.id} item={item}>
              {item.image && (
                <img
                  src={item.image}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="mt-1.5 max-h-48 w-full rounded border border-border object-cover"
                />
              )}
            </FeedCard>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}

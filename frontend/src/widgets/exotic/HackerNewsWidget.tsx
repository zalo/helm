import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Newspaper, ExternalLink, ArrowUp, MessageCircle, Search } from "lucide-react";
import type { WidgetProps } from "../types";
import { relativeTime, compactNum } from "@/lib/format";
import { feed, WidgetShell, Loading, Empty, ErrorState, SkeletonList } from "./_shared";

const SOURCE = "hacker-news";
const REFRESH_MS = 120_000;
const DEFAULT_QUERY = "AI OR semiconductor OR Fed OR crypto";

interface HNConfig {
  query: string;
}

/** meta may carry points / comments as numbers; coerce defensively. */
function numMeta(meta: Record<string, unknown>, key: string): number | null {
  const v = meta?.[key];
  return typeof v === "number" ? v : null;
}

export function HackerNewsWidget({ config, setConfig }: WidgetProps<HNConfig>) {
  const query = config.query || DEFAULT_QUERY;
  const [draft, setDraft] = useState(query);

  const q = useQuery({
    queryKey: ["feed", SOURCE, query],
    queryFn: () => feed(SOURCE, { query, limit: 40 }),
    refetchInterval: REFRESH_MS,
  });

  const commit = () => {
    const next = draft.trim();
    if (next && next !== query) setConfig({ query: next });
  };

  return (
    <WidgetShell
      header={
        <>
          <Newspaper size={14} className="text-accent" />
          <span className="text-xs font-semibold">Hacker News</span>
          <div className="ml-auto flex items-center gap-1 rounded border border-border bg-bg-1 px-1.5 py-0.5">
            <Search size={11} className="text-fg-faint" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === "Enter" && commit()}
              placeholder="search query…"
              className="w-44 bg-transparent text-2xs text-fg outline-none placeholder:text-fg-faint"
            />
          </div>
        </>
      }
    >
      {q.isLoading ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState source="Hacker News" onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <Empty label="No matching stories" />
      ) : q.isFetching && !q.data ? (
        <Loading />
      ) : (
        <ul className="flex flex-col gap-1 panel-pad">
          {q.data.map((item) => {
            const points = numMeta(item.meta, "points");
            const comments = numMeta(item.meta, "comments");
            return (
              <li key={item.id}>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-start gap-2 rounded border border-border bg-bg-1 p-2 transition-colors hover:border-border-strong hover:bg-bg-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs leading-snug text-fg">{item.title}</div>
                    <div className="mt-1 flex items-center gap-2.5 text-2xs text-fg-faint">
                      {points != null && (
                        <span className="flex items-center gap-0.5 text-warn">
                          <ArrowUp size={10} />
                          <span className="num">{compactNum(points)}</span>
                        </span>
                      )}
                      {comments != null && (
                        <span className="flex items-center gap-0.5">
                          <MessageCircle size={10} />
                          <span className="num">{compactNum(comments)}</span>
                        </span>
                      )}
                      {item.author && <span className="text-fg-muted">{item.author}</span>}
                      <span className="num">{relativeTime(item.published)}</span>
                    </div>
                  </div>
                  <ExternalLink
                    size={12}
                    className="mt-0.5 shrink-0 text-fg-faint opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetShell>
  );
}

import { useQuery } from "@tanstack/react-query";
import { MessageSquare, ExternalLink } from "lucide-react";
import type { WidgetProps } from "../types";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { feed, WidgetShell, Loading, Empty, ErrorState, SkeletonList } from "./_shared";

const SOURCE = "reddit";
const REFRESH_MS = 90_000;
const QUICK = ["wallstreetbets", "stocks", "cryptocurrency", "economics"] as const;

interface RedditConfig {
  subreddit: string;
}

export function RedditWidget({ config, setConfig }: WidgetProps<RedditConfig>) {
  const subreddit = config.subreddit || "wallstreetbets";
  const q = useQuery({
    queryKey: ["feed", SOURCE, subreddit],
    queryFn: () => feed(SOURCE, { subreddit, limit: 40 }),
    refetchInterval: REFRESH_MS,
  });

  return (
    <WidgetShell
      header={
        <>
          <MessageSquare size={14} className="text-accent" />
          <span className="text-xs font-semibold">r/{subreddit}</span>
          <div className="ml-auto flex items-center gap-1">
            {QUICK.map((sub) => (
              <button
                key={sub}
                onClick={() => setConfig({ subreddit: sub })}
                className={cn(
                  "chip border",
                  sub === subreddit ? "btn-accent" : "border-border text-fg-muted hover:bg-bg-2",
                )}
                title={`r/${sub}`}
              >
                {sub === "wallstreetbets" ? "wsb" : sub.slice(0, 6)}
              </button>
            ))}
          </div>
        </>
      }
    >
      {q.isLoading ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState source={`r/${subreddit}`} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <Empty label={`No threads in r/${subreddit}`} />
      ) : q.isFetching && !q.data ? (
        <Loading />
      ) : (
        <ul className="flex flex-col panel-pad">
          {q.data.map((item) => (
            <li key={item.id}>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="group flex gap-2 rounded border border-transparent px-1.5 py-1.5 transition-colors hover:border-border hover:bg-bg-1"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs leading-snug text-fg">{item.title}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-fg-faint">
                    <span className="text-fg-muted">u/{item.author || "unknown"}</span>
                    <span>·</span>
                    <span className="num">{relativeTime(item.published)}</span>
                  </div>
                </div>
                <ExternalLink
                  size={12}
                  className="mt-0.5 shrink-0 text-fg-faint opacity-0 transition-opacity group-hover:opacity-100"
                />
              </a>
            </li>
          ))}
        </ul>
      )}
    </WidgetShell>
  );
}

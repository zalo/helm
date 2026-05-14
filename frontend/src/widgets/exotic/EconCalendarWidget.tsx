import { useQuery } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { format, isValid, parseISO } from "date-fns";
import type { WidgetProps } from "../types";
import type { FeedItem } from "@/api/types";
import { timeOfDay } from "@/lib/format";
import { cn } from "@/lib/cn";
import { feed, WidgetShell, Loading, Empty, ErrorState, SkeletonList } from "./_shared";

const SOURCE = "econ-calendar";
const REFRESH_MS = 300_000;

/** Importance string from meta → dot color. */
function importance(meta: Record<string, unknown>): { label: string; tone: string } {
  const raw = String(meta?.importance ?? meta?.impact ?? "").toLowerCase();
  if (raw.includes("high") || raw === "3") return { label: "high", tone: "bg-loss" };
  if (raw.includes("med") || raw === "2") return { label: "medium", tone: "bg-warn" };
  if (raw.includes("low") || raw === "1") return { label: "low", tone: "bg-fg-faint" };
  return { label: "", tone: "bg-bg-3" };
}

/** Group items by calendar day (yyyy-MM-dd), preserving input order. */
function groupByDay(items: FeedItem[]): [string, FeedItem[]][] {
  const groups = new Map<string, FeedItem[]>();
  for (const item of items) {
    const d = item.published ? parseISO(item.published) : null;
    const key = d && isValid(d) ? format(d, "yyyy-MM-dd") : "Undated";
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()];
}

function dayLabel(key: string): string {
  if (key === "Undated") return "Undated";
  const d = parseISO(key);
  return isValid(d) ? format(d, "EEE, MMM d") : key;
}

export function EconCalendarWidget(_: WidgetProps) {
  const q = useQuery({
    queryKey: ["feed", SOURCE],
    queryFn: () => feed(SOURCE, { limit: 80 }),
    refetchInterval: REFRESH_MS,
  });

  const groups = q.data ? groupByDay(q.data) : [];

  return (
    <WidgetShell
      header={
        <>
          <CalendarClock size={14} className="text-accent" />
          <span className="text-xs font-semibold">Econ Calendar</span>
          <span className="text-2xs text-fg-faint">upcoming events</span>
        </>
      }
    >
      {q.isLoading ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState source="economic calendar" onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <Empty label="No upcoming events" />
      ) : q.isFetching && !q.data ? (
        <Loading />
      ) : (
        <div className="panel-pad">
          {groups.map(([day, items]) => (
            <section key={day} className="mb-3 last:mb-0">
              <h3 className="sticky top-0 mb-1 bg-bg-0 py-0.5 text-2xs font-semibold uppercase tracking-wide text-fg-faint">
                {dayLabel(day)}
              </h3>
              <ul className="flex flex-col gap-1">
                {items.map((item) => {
                  const imp = importance(item.meta);
                  return (
                    <li
                      key={item.id}
                      className="flex items-center gap-2 rounded border border-border bg-bg-1 px-2 py-1.5"
                    >
                      <span
                        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", imp.tone)}
                        title={imp.label || "unknown importance"}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs text-fg">{item.title}</div>
                        {item.summary && (
                          <div className="truncate text-2xs text-fg-faint">{item.summary}</div>
                        )}
                      </div>
                      <span className="shrink-0 num text-2xs text-fg-muted">
                        {timeOfDay(item.published)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}

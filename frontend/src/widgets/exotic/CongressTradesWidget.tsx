import { useQuery } from "@tanstack/react-query";
import { Gavel, ExternalLink } from "lucide-react";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { feed, WidgetShell, Loading, Empty, ErrorState, SkeletonList } from "./_shared";

const SOURCE = "congress-trades";
const REFRESH_MS = 300_000;

function metaStr(meta: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = meta?.[k];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

/** Normalize a transaction direction from meta into buy/sell/other. */
function direction(meta: Record<string, unknown>): "buy" | "sell" | "other" {
  const raw = (metaStr(meta, "transaction", "type", "side", "action") ?? "").toLowerCase();
  if (raw.includes("buy") || raw.includes("purchase")) return "buy";
  if (raw.includes("sell") || raw.includes("sale")) return "sell";
  return "other";
}

export function CongressTradesWidget() {
  const q = useQuery({
    queryKey: ["feed", SOURCE],
    queryFn: () => feed(SOURCE, { limit: 60 }),
    refetchInterval: REFRESH_MS,
  });

  return (
    <WidgetShell
      header={
        <>
          <Gavel size={14} className="text-accent" />
          <span className="text-xs font-semibold">Congress Trades</span>
          <span className="text-2xs text-fg-faint">disclosures</span>
        </>
      }
    >
      {q.isLoading ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState source="congressional trades" onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <Empty label="No disclosures" />
      ) : q.isFetching && !q.data ? (
        <Loading />
      ) : (
        <table className="w-full border-collapse text-2xs">
          <thead className="sticky top-0 bg-bg-0 text-fg-faint">
            <tr className="border-b border-border">
              <th className="px-2 py-1 text-left font-medium">Representative</th>
              <th className="px-2 py-1 text-left font-medium">Ticker</th>
              <th className="px-2 py-1 text-left font-medium">Side</th>
              <th className="px-2 py-1 text-right font-medium">Amount</th>
              <th className="px-2 py-1 text-right font-medium">Disclosed</th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((item) => {
              const dir = direction(item.meta);
              const ticker = metaStr(item.meta, "ticker", "symbol");
              const amount = metaStr(item.meta, "amount", "amount_range", "range", "value");
              return (
                <tr
                  key={item.id}
                  className="border-b border-border/60 transition-colors hover:bg-bg-1"
                >
                  <td className="px-2 py-1 text-fg">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group inline-flex items-center gap-1 hover:text-accent"
                    >
                      <span className="truncate">{item.author || item.title}</span>
                      <ExternalLink
                        size={9}
                        className="opacity-0 transition-opacity group-hover:opacity-100"
                      />
                    </a>
                  </td>
                  <td className="px-2 py-1 num font-medium text-fg">{ticker ?? "—"}</td>
                  <td className="px-2 py-1">
                    <span
                      className={cn(
                        "chip uppercase",
                        dir === "buy" && "bg-gain/15 text-gain",
                        dir === "sell" && "bg-loss/15 text-loss",
                        dir === "other" && "bg-bg-3 text-fg-muted",
                      )}
                    >
                      {dir === "other" ? "—" : dir}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right num text-fg-muted">{amount ?? "—"}</td>
                  <td className="px-2 py-1 text-right num text-fg-faint">
                    {relativeTime(item.published)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </WidgetShell>
  );
}

import { useQuery } from "@tanstack/react-query";
import { FileText, ExternalLink } from "lucide-react";
import type { WidgetProps } from "../types";
import { relativeTime } from "@/lib/format";
import { Segmented, feed, WidgetShell, Loading, Empty, ErrorState, SkeletonList } from "./_shared";

const SOURCE = "sec-edgar";
const REFRESH_MS = 120_000;
const FILING_TYPES = ["8-K", "10-Q", "10-K", "4"] as const;
type FilingType = (typeof FILING_TYPES)[number];

interface SECConfig {
  filingType: string;
}

export function SECFilingsWidget({ config, setConfig }: WidgetProps<SECConfig>) {
  const filingType = (config.filingType || "8-K") as FilingType;
  const q = useQuery({
    queryKey: ["feed", SOURCE, filingType],
    queryFn: () => feed(SOURCE, { type: filingType, limit: 40 }),
    refetchInterval: REFRESH_MS,
  });

  return (
    <WidgetShell
      header={
        <>
          <FileText size={14} className="text-accent" />
          <span className="text-xs font-semibold">SEC EDGAR</span>
          <div className="ml-auto">
            <Segmented
              options={FILING_TYPES}
              value={filingType}
              onChange={(t) => setConfig({ filingType: t })}
            />
          </div>
        </>
      }
    >
      {q.isLoading ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState source="SEC filings" onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <Empty label={`No ${filingType} filings`} />
      ) : q.isFetching && !q.data ? (
        <Loading />
      ) : (
        <ul className="flex flex-col gap-1 panel-pad">
          {q.data.map((item) => (
            <li key={item.id}>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="group flex items-start gap-2 rounded border border-border bg-bg-1 p-2 transition-colors hover:border-border-strong hover:bg-bg-2"
              >
                <span className="chip mt-0.5 shrink-0 border border-border bg-bg-3 num text-accent">
                  {String(item.meta?.type ?? filingType)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs leading-snug text-fg">{item.title}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-fg-faint">
                    {item.author && <span className="text-fg-muted">{item.author}</span>}
                    {item.author && item.published && <span>·</span>}
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

import { useQuery } from "@tanstack/react-query";
import { Landmark } from "lucide-react";
import type { WidgetProps } from "../types";
import { feed, WidgetShell, FeedCard, Loading, Empty, ErrorState, SkeletonList } from "./_shared";

const SOURCE = "whitehouse";
const REFRESH_MS = 120_000;

export function WhiteHouseWidget(_: WidgetProps) {
  const q = useQuery({
    queryKey: ["feed", SOURCE],
    queryFn: () => feed(SOURCE, { limit: 40 }),
    refetchInterval: REFRESH_MS,
  });

  return (
    <WidgetShell
      header={
        <>
          <Landmark size={14} className="text-accent" />
          <span className="text-xs font-semibold">White House</span>
          <span className="text-2xs text-fg-faint">press releases</span>
        </>
      }
    >
      {q.isLoading ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState source="White House feed" onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <Empty label="No press releases" />
      ) : q.isFetching && !q.data ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-1.5 panel-pad">
          {q.data.map((item) => (
            <FeedCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </WidgetShell>
  );
}

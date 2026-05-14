import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { api } from "@/api/client";
import { helmSocket } from "@/api/ws";
import type { Position, WsEvent } from "@/api/types";
import type { WidgetProps } from "@/widgets/types";
import { money, signedMoney, num, pnlColor, arrow } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Loading, ErrorState, Empty } from "./_shared";

const col = createColumnHelper<Position>();

function SideChip({ side }: { side: Position["side"] }) {
  return (
    <span
      className={cn(
        "chip",
        side === "LONG" && "bg-gain-dim text-gain",
        side === "SHORT" && "bg-loss-dim text-loss",
        side === "FLAT" && "bg-bg-2 text-fg-muted",
      )}
    >
      {side}
    </span>
  );
}

export default function PositionsWidget(_props: WidgetProps) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["positions"],
    queryFn: api.positions,
    refetchInterval: 30_000,
  });

  // Track recently-updated rows for the flash animation.
  const [flash, setFlash] = useState<Record<string, "gain" | "loss">>({});
  const flashTimers = useRef<Record<string, number>>({});

  useEffect(() => {
    const unsub = helmSocket.on("position", (e: WsEvent) => {
      const pos = e.payload as Position;
      qc.setQueryData<Position[]>(["positions"], (prev) => {
        const list = prev ?? [];
        const idx = list.findIndex((p) => p.id === pos.id);
        // A FLAT position has been closed — drop it from the table.
        if (pos.side === "FLAT") return list.filter((p) => p.id !== pos.id);
        if (idx === -1) return [...list, pos];
        const next = list.slice();
        next[idx] = pos;
        return next;
      });
      setFlash((f) => ({ ...f, [pos.id]: pos.unrealized_pnl >= 0 ? "gain" : "loss" }));
      window.clearTimeout(flashTimers.current[pos.id]);
      flashTimers.current[pos.id] = window.setTimeout(() => {
        setFlash((f) => {
          const { [pos.id]: _drop, ...rest } = f;
          return rest;
        });
      }, 600);
    });
    return () => {
      unsub();
      Object.values(flashTimers.current).forEach((t) => window.clearTimeout(t));
    };
  }, [qc]);

  const columns = useMemo(
    () => [
      col.accessor("instrument", {
        header: "Instrument",
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      col.accessor("side", {
        header: "Side",
        cell: (c) => <SideChip side={c.getValue()} />,
      }),
      col.accessor("quantity", {
        header: "Qty",
        cell: (c) => <span className="num">{num(c.getValue(), 4)}</span>,
        meta: { right: true },
      }),
      col.accessor("avg_px", {
        header: "Avg Px",
        cell: (c) => <span className="num">{num(c.getValue())}</span>,
        meta: { right: true },
      }),
      col.accessor("last_px", {
        header: "Last Px",
        cell: (c) => <span className="num">{num(c.getValue())}</span>,
        meta: { right: true },
      }),
      col.accessor("market_value", {
        header: "Mkt Value",
        cell: (c) => <span className="num">{money(c.getValue())}</span>,
        meta: { right: true },
      }),
      col.accessor("unrealized_pnl", {
        header: "Unrealized",
        cell: (c) => {
          const v = c.getValue();
          return (
            <span className={cn("num", pnlColor(v))}>
              {arrow(v)} {signedMoney(v)}
            </span>
          );
        },
        meta: { right: true },
      }),
      col.accessor("realized_pnl", {
        header: "Realized",
        cell: (c) => {
          const v = c.getValue();
          return <span className={cn("num", pnlColor(v))}>{signedMoney(v)}</span>;
        },
        meta: { right: true },
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => r.id,
  });

  if (isLoading) return <Loading />;
  if (isError) return <ErrorState label="Positions unavailable" />;
  if (!data || data.length === 0) return <Empty label="No open positions" />;

  return (
    <div className="scroll-y h-full w-full">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-bg-2">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-border">
              {hg.headers.map((h) => {
                const right = (h.column.columnDef.meta as { right?: boolean })?.right;
                return (
                  <th
                    key={h.id}
                    className={cn(
                      "px-2 py-1 text-2xs font-medium uppercase tracking-wide text-fg-faint",
                      right ? "text-right" : "text-left",
                    )}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className={cn(
                "border-b border-border/60 hover:bg-bg-1",
                flash[row.id] === "gain" && "flash-gain",
                flash[row.id] === "loss" && "flash-loss",
              )}
            >
              {row.getVisibleCells().map((cell) => {
                const right = (cell.column.columnDef.meta as { right?: boolean })?.right;
                return (
                  <td
                    key={cell.id}
                    className={cn("px-2 py-1", right ? "text-right" : "text-left")}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

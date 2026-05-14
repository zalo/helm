import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { api } from "@/api/client";
import { helmSocket } from "@/api/ws";
import type { Order, OrderStatus, WsEvent } from "@/api/types";
import type { WidgetProps } from "@/widgets/types";
import { num, timeOfDay } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Loading, ErrorState, Empty } from "./_shared";

const col = createColumnHelper<Order>();

const STATUS_STYLE: Record<OrderStatus, string> = {
  INITIALIZED: "bg-bg-2 text-fg-muted",
  SUBMITTED: "bg-accent-dim text-accent",
  ACCEPTED: "bg-accent-dim text-accent",
  PARTIALLY_FILLED: "bg-warn-dim text-warn",
  FILLED: "bg-gain-dim text-gain",
  CANCELED: "bg-bg-2 text-fg-faint",
  REJECTED: "bg-loss-dim text-loss",
  EXPIRED: "bg-bg-2 text-fg-faint",
};

function StatusChip({ status }: { status: OrderStatus }) {
  return <span className={cn("chip", STATUS_STYLE[status])}>{status.replace("_", " ")}</span>;
}

export default function OrdersWidget(_props: WidgetProps) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["orders"],
    queryFn: api.orders,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    return helmSocket.on("order", (e: WsEvent) => {
      const order = e.payload as Order;
      qc.setQueryData<Order[]>(["orders"], (prev) => {
        const list = prev ?? [];
        const idx = list.findIndex((o) => o.id === order.id);
        if (idx === -1) return [order, ...list];
        const next = list.slice();
        next[idx] = order;
        return next;
      });
    });
  }, [qc]);

  // Newest first.
  const rows = useMemo(
    () => (data ? [...data].sort((a, b) => b.ts.localeCompare(a.ts)) : []),
    [data],
  );

  const columns = useMemo(
    () => [
      col.accessor("ts", {
        header: "Time",
        cell: (c) => <span className="num text-fg-muted">{timeOfDay(c.getValue())}</span>,
      }),
      col.accessor("instrument", {
        header: "Instrument",
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      col.accessor("side", {
        header: "Side",
        cell: (c) => (
          <span className={c.getValue() === "BUY" ? "text-gain" : "text-loss"}>
            {c.getValue()}
          </span>
        ),
      }),
      col.accessor("type", {
        header: "Type",
        cell: (c) => <span className="text-fg-muted">{c.getValue().replace("_", " ")}</span>,
      }),
      col.accessor("status", {
        header: "Status",
        cell: (c) => <StatusChip status={c.getValue()} />,
      }),
      col.accessor("quantity", {
        header: "Qty",
        cell: (c) => <span className="num">{num(c.getValue(), 4)}</span>,
        meta: { right: true },
      }),
      col.accessor("filled_qty", {
        header: "Filled",
        cell: (c) => <span className="num">{num(c.getValue(), 4)}</span>,
        meta: { right: true },
      }),
      col.accessor("price", {
        header: "Price",
        cell: (c) => {
          const v = c.getValue();
          return <span className="num">{v == null ? "MKT" : num(v)}</span>;
        },
        meta: { right: true },
      }),
      col.accessor("avg_px", {
        header: "Avg Px",
        cell: (c) => {
          const v = c.getValue();
          return <span className="num">{v == null ? "—" : num(v)}</span>;
        },
        meta: { right: true },
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => r.id,
  });

  if (isLoading) return <Loading />;
  if (isError) return <ErrorState label="Orders unavailable" />;
  if (rows.length === 0) return <Empty label="No orders yet" />;

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
            <tr key={row.id} className="border-b border-border/60 hover:bg-bg-1">
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

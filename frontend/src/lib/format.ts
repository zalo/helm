/**
 * Shared formatting helpers. Numbers in a trading UI must be scannable: fixed
 * precision, thousands separators, explicit signs, and tabular figures (apply
 * the `.num` class at the render site).
 */

const CCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const CCY_COMPACT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function money(n: number | null | undefined, compact = false): string {
  if (n == null || Number.isNaN(n)) return "—";
  return compact ? CCY_COMPACT.format(n) : CCY.format(n);
}

/** Signed currency — always shows + / − for P&L. */
export function signedMoney(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const s = money(Math.abs(n));
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}

export function pct(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(digits)}%`;
}

export function num(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function compactNum(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** Tailwind text color class for a P&L value. */
export function pnlColor(n: number | null | undefined): string {
  if (n == null || n === 0) return "text-fg-muted";
  return n > 0 ? "text-gain" : "text-loss";
}

/** ▲ / ▼ / · directional glyph for a value. */
export function arrow(n: number | null | undefined): string {
  if (n == null || n === 0) return "·";
  return n > 0 ? "▲" : "▼";
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function timeOfDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", { hour12: false });
}

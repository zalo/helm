/**
 * Trading widget bundle. Owned by the trading-widgets build task.
 */
import {
  Wallet,
  TrendingUp,
  Layers,
  ScrollText,
  CandlestickChart,
  BrainCircuit,
} from "lucide-react";
import { defineWidget, type WidgetDefinition } from "../types";
import PortfolioWidget from "./PortfolioWidget";
import PnLWidget from "./PnLWidget";
import PositionsWidget from "./PositionsWidget";
import OrdersWidget from "./OrdersWidget";
import ChartWidget, { type ChartConfig } from "./ChartWidget";
import AIDecisionFeed from "./AIDecisionFeed";

export const tradingWidgets: WidgetDefinition[] = [
  defineWidget({
    type: "portfolio",
    title: "Portfolio",
    description: "Headline equity, P&L split, exposure, and risk metrics.",
    category: "Trading",
    icon: Wallet,
    component: PortfolioWidget,
    defaultConfig: {},
    minWidth: 240,
    minHeight: 200,
    defaultWidth: 320,
    defaultHeight: 340,
  }),
  defineWidget({
    type: "pnl",
    title: "P&L / Equity Curve",
    description: "Equity curve chart with live day-P&L summary.",
    category: "Trading",
    icon: TrendingUp,
    component: PnLWidget,
    defaultConfig: {},
    minWidth: 320,
    minHeight: 220,
    defaultWidth: 480,
    defaultHeight: 300,
  }),
  defineWidget({
    type: "positions",
    title: "Positions",
    description: "Open positions with live unrealized P&L.",
    category: "Trading",
    icon: Layers,
    component: PositionsWidget,
    defaultConfig: {},
    minWidth: 420,
    minHeight: 160,
    defaultWidth: 640,
    defaultHeight: 260,
  }),
  defineWidget({
    type: "orders",
    title: "Orders",
    description: "Order log — submissions, fills, cancels, rejects.",
    category: "Trading",
    icon: ScrollText,
    component: OrdersWidget,
    defaultConfig: {},
    minWidth: 420,
    minHeight: 160,
    defaultWidth: 640,
    defaultHeight: 260,
  }),
  // WidgetProps is invariant in its config type, so a typed widget def is not
  // structurally assignable to the loosely-typed registry array — cast here.
  defineWidget<ChartConfig>({
    type: "chart",
    title: "Chart",
    description: "Candlestick chart with volume for a single instrument.",
    category: "Markets",
    icon: CandlestickChart,
    component: ChartWidget,
    defaultConfig: { instrument: "" },
    minWidth: 360,
    minHeight: 260,
    defaultWidth: 560,
    defaultHeight: 380,
  }) as WidgetDefinition,
  defineWidget({
    type: "ai-decision-feed",
    title: "AI Decision Feed",
    description: "Reverse-chronological AI rationale cards with signals and outcomes.",
    category: "AI",
    icon: BrainCircuit,
    component: AIDecisionFeed,
    defaultConfig: {},
    minWidth: 320,
    minHeight: 280,
    defaultWidth: 400,
    defaultHeight: 560,
  }),
];

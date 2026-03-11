import { BacktestMetrics, BacktestRun, BacktestStep } from "./types.js";

export interface BacktestTimelinePoint {
  timestamp: string;
  portfolioValue: number;
  drawdownPct: number;
  rebalanceRequired: boolean;
  turnoverPct: number;
}

export interface BacktestReport {
  run: BacktestRun;
  metrics: BacktestMetrics;
  timeline: BacktestTimelinePoint[];
  steps: BacktestStep[];
}

export function buildBacktestReport(run: BacktestRun, steps: BacktestStep[], metrics: BacktestMetrics): BacktestReport {
  return {
    run,
    metrics,
    timeline: steps.map((step) => ({
      timestamp: step.timestamp,
      portfolioValue: step.portfolioValue,
      drawdownPct: step.drawdownPct,
      rebalanceRequired: step.rebalanceRequired,
      turnoverPct: step.turnoverPct,
    })),
    steps,
  };
}

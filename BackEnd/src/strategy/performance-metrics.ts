import { BacktestMetrics, BacktestStep } from "./types.js";
import { round } from "./allocation-utils.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function calculateAnnualizedReturn(initial: number, finalValue: number, startIso: string, endIso: string): number {
  const durationDays = Math.max(1, (new Date(endIso).getTime() - new Date(startIso).getTime()) / DAY_MS);
  if (initial <= 0 || finalValue <= 0) return 0;

  const years = durationDays / 365;
  if (years <= 0) return 0;

  return Math.pow(finalValue / initial, 1 / years) - 1;
}

function stablecoinAllocationPct(snapshot: Record<string, number>): number {
  return Object.entries(snapshot)
    .filter(([symbol]) => ["USDT", "USDC", "BUSD", "FDUSD", "DAI", "TUSD"].includes(symbol))
    .reduce((sum, [, value]) => sum + value, 0);
}

export function computeBacktestMetrics(input: {
  initialCapital: number;
  startDate: string;
  endDate: string;
  steps: BacktestStep[];
}): BacktestMetrics {
  const steps = input.steps;
  const finalStep = steps.at(-1);
  const finalPortfolioValue = finalStep?.portfolioValue ?? input.initialCapital;
  const totalReturnPct = input.initialCapital === 0 ? 0 : (finalPortfolioValue / input.initialCapital - 1) * 100;

  const annualizedReturnPct =
    calculateAnnualizedReturn(input.initialCapital, finalPortfolioValue, input.startDate, input.endDate) * 100;

  const maxDrawdownPct =
    steps.length === 0 ? 0 : Math.max(...steps.map((step) => step.drawdownPct));

  const turnoverPct = steps.reduce((sum, step) => sum + step.turnoverPct, 0);
  const rebalanceCount = steps.filter((step) => step.rebalanceRequired).length;
  const averageStablecoinAllocationPct =
    steps.length === 0
      ? 0
      : steps.reduce((sum, step) => sum + stablecoinAllocationPct(step.allocationSnapshot), 0) / steps.length;

  return {
    finalPortfolioValue: round(finalPortfolioValue, 2),
    totalReturnPct: round(totalReturnPct, 2),
    annualizedReturnPct: round(annualizedReturnPct, 2),
    maxDrawdownPct: round(maxDrawdownPct, 2),
    turnoverPct: round(turnoverPct, 2),
    rebalanceCount,
    averageStablecoinAllocationPct: round(averageStablecoinAllocationPct, 2),
  };
}

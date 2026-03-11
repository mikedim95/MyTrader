import { calculateDriftPct, mergeAssetUniverse, round, sortSymbols } from "./allocation-utils.js";
import { AllocationMap, RebalancePlan, RebalanceTradeSuggestion, StrategyGuardConfig } from "./types.js";

interface RebalancePlannerInput {
  currentAllocation: AllocationMap;
  targetAllocation: AllocationMap;
  totalPortfolioValue: number;
  guards: StrategyGuardConfig;
}

const DEFAULT_MIN_DRIFT_TO_TRADE_PCT = 0.25;

function buildSuggestion(
  symbol: string,
  currentPct: number,
  targetPct: number,
  totalPortfolioValue: number
): RebalanceTradeSuggestion {
  const driftPct = round(targetPct - currentPct, 4);
  const currentValue = round((currentPct / 100) * totalPortfolioValue, 2);
  const targetValue = round((targetPct / 100) * totalPortfolioValue, 2);
  const notional = round(Math.abs(targetValue - currentValue), 2);

  return {
    asset: symbol,
    side: driftPct >= 0 ? "BUY" : "SELL",
    currentPct: round(currentPct, 2),
    targetPct: round(targetPct, 2),
    driftPct: round(Math.abs(driftPct), 2),
    currentValue,
    targetValue,
    notional,
  };
}

export function buildRebalancePlan(input: RebalancePlannerInput): RebalancePlan {
  const symbols = sortSymbols(mergeAssetUniverse(input.currentAllocation, input.targetAllocation));
  const warnings: string[] = [];
  const minTradeNotional = input.guards.min_trade_notional ?? 25;
  const maxTradesPerCycle = input.guards.max_trades_per_cycle ?? Number.POSITIVE_INFINITY;

  const allSuggestions = symbols
    .map((symbol) =>
      buildSuggestion(
        symbol,
        input.currentAllocation[symbol] ?? 0,
        input.targetAllocation[symbol] ?? 0,
        input.totalPortfolioValue
      )
    )
    .filter((suggestion) => suggestion.driftPct >= DEFAULT_MIN_DRIFT_TO_TRADE_PCT)
    .sort((left, right) => {
      if (right.driftPct !== left.driftPct) return right.driftPct - left.driftPct;
      return left.asset.localeCompare(right.asset);
    });

  const aboveNotional = allSuggestions.filter((suggestion) => suggestion.notional >= minTradeNotional);
  const belowNotionalCount = allSuggestions.length - aboveNotional.length;

  if (belowNotionalCount > 0) {
    warnings.push(
      `${belowNotionalCount} suggested trade(s) were skipped because they were below min_trade_notional (${minTradeNotional}).`
    );
  }

  const limited = aboveNotional.slice(0, Math.max(0, maxTradesPerCycle));
  if (limited.length < aboveNotional.length) {
    warnings.push(
      `${aboveNotional.length - limited.length} suggested trade(s) were truncated by max_trades_per_cycle (${maxTradesPerCycle}).`
    );
  }

  const estimatedTurnoverPct = round(
    limited.reduce((sum, suggestion) => sum + suggestion.driftPct, 0) / 2,
    2
  );

  return {
    rebalanceRequired: limited.length > 0,
    driftPct: calculateDriftPct(input.currentAllocation, input.targetAllocation),
    estimatedTurnoverPct,
    suggestions: limited,
    warnings,
  };
}

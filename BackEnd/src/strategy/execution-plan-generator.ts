import { randomUUID } from "node:crypto";
import { AllocationMap, ExecutionPlan, RebalancePlan, StrategyMode } from "./types.js";

interface ExecutionPlanGeneratorInput {
  strategyId: string;
  mode: StrategyMode;
  currentAllocation: AllocationMap;
  targetAllocation: AllocationMap;
  rebalancePlan: RebalancePlan;
  warnings: string[];
  actionReasonsByAsset: Record<string, string>;
  timestamp?: string;
}

export function generateExecutionPlan(input: ExecutionPlanGeneratorInput): ExecutionPlan {
  const timestamp = input.timestamp ?? new Date().toISOString();

  return {
    id: randomUUID(),
    strategyId: input.strategyId,
    timestamp,
    mode: input.mode,
    currentAllocation: input.currentAllocation,
    adjustedTargetAllocation: input.targetAllocation,
    rebalanceRequired: input.rebalancePlan.rebalanceRequired,
    driftPct: input.rebalancePlan.driftPct,
    estimatedTurnoverPct: input.rebalancePlan.estimatedTurnoverPct,
    recommendedTrades: input.rebalancePlan.suggestions.map((suggestion) => ({
      asset: suggestion.asset,
      side: suggestion.side,
      amountNotional: suggestion.notional,
      targetPercent: suggestion.targetPct,
      currentPercent: suggestion.currentPct,
      reason: input.actionReasonsByAsset[suggestion.asset] ?? "rebalance_adjustment",
    })),
    warnings: [...input.rebalancePlan.warnings, ...input.warnings],
  };
}

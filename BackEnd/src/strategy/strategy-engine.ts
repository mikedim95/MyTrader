import { enforceGuards } from "./guard-enforcer.js";
import { generateExecutionPlan } from "./execution-plan-generator.js";
import { buildRebalancePlan } from "./rebalance-planner.js";
import { evaluateRules } from "./rule-evaluator.js";
import { mergeAssetUniverse, normalizeAllocation, withAllAssets } from "./allocation-utils.js";
import { MarketSignalSnapshot, PortfolioState, StrategyConfig, StrategyEvaluationResult } from "./types.js";

interface StrategyEngineInput {
  strategy: StrategyConfig;
  portfolio: PortfolioState;
  marketSignals: MarketSignalSnapshot;
  modeOverride?: StrategyConfig["executionMode"];
}

export class StrategyEngine {
  evaluate(input: StrategyEngineInput): StrategyEvaluationResult {
    const symbols = mergeAssetUniverse(input.strategy.baseAllocation, input.portfolio.allocation);
    const currentAllocation = normalizeAllocation(withAllAssets(input.portfolio.allocation, symbols), symbols);
    const baseAllocation = normalizeAllocation(withAllAssets(input.strategy.baseAllocation, symbols), symbols);

    const ruleResult = evaluateRules({
      strategy: input.strategy,
      baseAllocation,
      portfolio: input.portfolio,
      signals: input.marketSignals,
    });

    const guardResult = enforceGuards({
      allocation: ruleResult.allocation,
      baseAllocation,
      guards: input.strategy.guards,
      disabledAssets: input.strategy.disabledAssets,
    });

    const adjustedTargetAllocation = normalizeAllocation(guardResult.allocation, symbols);

    const rebalancePlan = buildRebalancePlan({
      currentAllocation,
      targetAllocation: adjustedTargetAllocation,
      totalPortfolioValue: input.portfolio.totalValue,
      guards: input.strategy.guards,
    });

    const warnings = [...ruleResult.warnings, ...guardResult.warnings, ...rebalancePlan.warnings];

    const executionPlan = generateExecutionPlan({
      strategyId: input.strategy.id,
      mode: input.modeOverride ?? input.strategy.executionMode,
      currentAllocation,
      targetAllocation: adjustedTargetAllocation,
      rebalancePlan,
      warnings,
      actionReasonsByAsset: ruleResult.actionReasonsByAsset,
    });

    return {
      strategyId: input.strategy.id,
      evaluatedAt: new Date().toISOString(),
      currentAllocation,
      baseAllocation,
      adjustedTargetAllocation,
      traces: ruleResult.traces,
      warnings,
      rebalancePlan,
      executionPlan,
    };
  }
}

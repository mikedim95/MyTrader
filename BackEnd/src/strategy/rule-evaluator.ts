import { applyActionToAllocation } from "./allocation-adjuster.js";
import { createAssetGroupResolver } from "./asset-groups.js";
import { calculateDriftPct, mergeAssetUniverse, normalizeAllocation, round, withAllAssets } from "./allocation-utils.js";
import {
  AllocationMap,
  MarketSignalSnapshot,
  PortfolioState,
  RuleEvaluationResult,
  StrategyCondition,
  StrategyConfig,
  StrategyOperator,
  StrategyRule,
} from "./types.js";

interface EvaluationContext {
  strategy: StrategyConfig;
  currentAllocation: AllocationMap;
  portfolio: PortfolioState;
  signals: MarketSignalSnapshot;
}

function compare(left: number, operator: StrategyOperator, right: number): boolean {
  if (operator === ">") return left > right;
  if (operator === "<") return left < right;
  if (operator === ">=") return left >= right;
  if (operator === "<=") return left <= right;
  if (operator === "==") return left === right;
  return left !== right;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getIndicatorValue(condition: StrategyCondition, context: EvaluationContext): number {
  const symbol = condition.asset?.toUpperCase();
  const { signals, currentAllocation, strategy } = context;

  if (condition.indicator === "portfolio_drift") {
    return calculateDriftPct(currentAllocation, strategy.baseAllocation) / 100;
  }

  if (condition.indicator === "asset_weight") {
    if (!symbol) return 0;
    return (currentAllocation[symbol] ?? 0) / 100;
  }

  if (condition.indicator === "asset_trend") {
    if (!symbol) return 0;
    return signals.assetIndicators[symbol]?.asset_trend ?? 0;
  }

  if (condition.indicator === "price_change_24h") {
    if (symbol) return signals.assetIndicators[symbol]?.price_change_24h ?? 0;
    const changes = Object.values(signals.assetIndicators).map((entry) => entry.price_change_24h ?? 0);
    return average(changes);
  }

  if (condition.indicator === "volume_change") {
    if (symbol) return signals.assetIndicators[symbol]?.volume_change ?? 0;
    const changes = Object.values(signals.assetIndicators).map((entry) => entry.volume_change ?? 0);
    return average(changes);
  }

  return signals.indicators[condition.indicator] ?? 0;
}

function sortedActiveRules(rules: StrategyRule[]): StrategyRule[] {
  return [...rules]
    .filter((rule) => rule.enabled)
    .sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      return left.id.localeCompare(right.id);
    });
}

export function evaluateRules(input: {
  strategy: StrategyConfig;
  baseAllocation: AllocationMap;
  portfolio: PortfolioState;
  signals: MarketSignalSnapshot;
}): RuleEvaluationResult {
  const symbols = mergeAssetUniverse(input.baseAllocation, input.portfolio.allocation);
  const context: EvaluationContext = {
    strategy: input.strategy,
    currentAllocation: withAllAssets({ ...input.baseAllocation }, symbols),
    portfolio: input.portfolio,
    signals: input.signals,
  };

  const traces: RuleEvaluationResult["traces"] = [];
  const warnings: string[] = [];
  const actionReasonsByAsset: Record<string, string> = {};

  for (const rule of sortedActiveRules(input.strategy.rules)) {
    const indicatorValue = getIndicatorValue(rule.condition, context);
    const matched = compare(indicatorValue, rule.condition.operator, rule.condition.value);

    if (!matched) {
      traces.push({
        ruleId: rule.id,
        ruleName: rule.name,
        matched: false,
        conditionValue: round(indicatorValue, 6),
        operator: rule.condition.operator,
        expectedValue: round(rule.condition.value, 6),
        actionApplied: false,
        message: `Condition not met for ${rule.condition.indicator}.`,
      });
      continue;
    }

    const resolver = createAssetGroupResolver(Object.keys(context.currentAllocation));
    const adjusted = applyActionToAllocation(context.currentAllocation, rule.action, resolver);

    context.currentAllocation = normalizeAllocation(adjusted.allocation, symbols);
    adjusted.changedAssets.forEach((asset) => {
      actionReasonsByAsset[asset] = rule.id;
    });

    warnings.push(...adjusted.warnings.map((warning) => `Rule ${rule.id}: ${warning}`));
    traces.push({
      ruleId: rule.id,
      ruleName: rule.name,
      matched: true,
      conditionValue: round(indicatorValue, 6),
      operator: rule.condition.operator,
      expectedValue: round(rule.condition.value, 6),
      actionApplied: true,
      message: `Applied ${rule.action.type} action.`,
    });
  }

  return {
    allocation: normalizeAllocation(context.currentAllocation, symbols),
    traces,
    warnings,
    actionReasonsByAsset,
  };
}

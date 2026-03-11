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

const STRONGEST_ASSET_TOKEN = "STRONGEST_ASSET";
const WEAKEST_ASSET_TOKEN = "WEAKEST_ASSET";

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

function sortedSymbolsByRelativeStrength(context: EvaluationContext): string[] {
  const resolver = createAssetGroupResolver(Object.keys(context.currentAllocation));
  const stablecoins = new Set(resolver.getAssetsForToken("STABLECOINS"));
  const candidates = Object.keys(context.currentAllocation)
    .filter((symbol) => !stablecoins.has(symbol))
    .sort((left, right) => left.localeCompare(right));

  return candidates.sort((left, right) => {
    const leftStrength =
      context.signals.assetIndicators[left]?.relative_strength ?? context.signals.assetIndicators[left]?.price_change_24h ?? 0;
    const rightStrength =
      context.signals.assetIndicators[right]?.relative_strength ??
      context.signals.assetIndicators[right]?.price_change_24h ??
      0;
    if (rightStrength !== leftStrength) return rightStrength - leftStrength;
    return left.localeCompare(right);
  });
}

function resolveDynamicAssetToken(token: string | undefined, context: EvaluationContext): string | undefined {
  if (!token) return undefined;
  const normalized = token.toUpperCase();
  if (normalized !== STRONGEST_ASSET_TOKEN && normalized !== WEAKEST_ASSET_TOKEN) {
    return normalized;
  }

  const ranked = sortedSymbolsByRelativeStrength(context);
  if (ranked.length === 0) return undefined;
  return normalized === STRONGEST_ASSET_TOKEN ? ranked[0] : ranked[ranked.length - 1];
}

function resolveConditionAsset(condition: StrategyCondition, context: EvaluationContext): StrategyCondition {
  const resolvedAsset = resolveDynamicAssetToken(condition.asset, context);
  return {
    ...condition,
    asset: resolvedAsset,
  };
}

function resolveRuleAction(rule: StrategyRule, context: EvaluationContext): StrategyRule["action"] {
  return {
    ...rule.action,
    asset: resolveDynamicAssetToken(rule.action.asset, context),
    from: resolveDynamicAssetToken(rule.action.from, context),
    to: resolveDynamicAssetToken(rule.action.to, context),
  };
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

  if (condition.indicator === "relative_strength") {
    if (symbol) return signals.assetIndicators[symbol]?.relative_strength ?? 0;
    const strengths = Object.values(signals.assetIndicators).map((entry) => entry.relative_strength ?? 0);
    return average(strengths);
  }

  if (condition.indicator === "drawdown_pct") {
    if (symbol) return signals.assetIndicators[symbol]?.drawdown_pct ?? signals.indicators.drawdown_pct ?? 0;
    return signals.indicators.drawdown_pct ?? 0;
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
    const resolvedCondition = resolveConditionAsset(rule.condition, context);
    const resolvedAction = resolveRuleAction(rule, context);
    const indicatorValue = getIndicatorValue(resolvedCondition, context);
    const matched = compare(indicatorValue, resolvedCondition.operator, resolvedCondition.value);

    if (!matched) {
      traces.push({
        ruleId: rule.id,
        ruleName: rule.name,
        matched: false,
        conditionValue: round(indicatorValue, 6),
        operator: resolvedCondition.operator,
        expectedValue: round(resolvedCondition.value, 6),
        actionApplied: false,
        message: `Condition not met for ${resolvedCondition.indicator}.`,
      });
      continue;
    }

    const resolver = createAssetGroupResolver(Object.keys(context.currentAllocation));
    const adjusted = applyActionToAllocation(context.currentAllocation, resolvedAction, resolver);

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

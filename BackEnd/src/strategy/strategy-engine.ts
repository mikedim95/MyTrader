import { enforceGuards } from "./guard-enforcer.js";
import { generateExecutionPlan } from "./execution-plan-generator.js";
import { buildRebalancePlan } from "./rebalance-planner.js";
import { evaluateRules } from "./rule-evaluator.js";
import { scoreStrategyForCycle } from "./strategy-scoring.js";
import { detectMarketRegime } from "./strategy-regime.js";
import { mergeAssetUniverse, normalizeAllocation, withAllAssets } from "./allocation-utils.js";
import {
  AllocationMap,
  MarketRegime,
  MarketSignalSnapshot,
  PortfolioAccountType,
  PortfolioState,
  RuleEvaluationTrace,
  StrategyConfig,
  StrategyEvaluationResult,
  StrategyScoreResult,
} from "./types.js";

interface StrategyEngineInput {
  strategy: StrategyConfig;
  portfolio: PortfolioState;
  marketSignals: MarketSignalSnapshot;
  accountType?: PortfolioAccountType;
  modeOverride?: StrategyConfig["executionMode"];
  strategyUniverse?: Record<string, StrategyConfig>;
}

interface StrategyAllocationEvaluation {
  baseAllocation: AllocationMap;
  adjustedTargetAllocation: AllocationMap;
  traces: RuleEvaluationTrace[];
  warnings: string[];
  actionReasonsByAsset: Record<string, string>;
}

interface MergeAllocationsResult {
  allocation: AllocationMap;
  reasonByAsset: Record<string, string>;
}

interface AutomaticWeightingResult {
  strategyScores: StrategyScoreResult[];
  activeWeights: Record<string, number>;
  warnings: string[];
  marketRegime: MarketRegime;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizePercentMap(input: Record<string, number>, keys: string[]): Record<string, number> {
  const sortedKeys = [...keys].sort((left, right) => left.localeCompare(right));
  if (sortedKeys.length === 0) return {};

  const sanitized = sortedKeys.map((key) => ({
    key,
    value: Number.isFinite(input[key]) && input[key] > 0 ? input[key] : 0,
  }));

  const total = sanitized.reduce((sum, entry) => sum + entry.value, 0);
  const baseTotal = total > 0 ? total : sortedKeys.length;

  const basis = sanitized.map((entry) => {
    const raw = ((total > 0 ? entry.value : 1) / baseTotal) * 10_000;
    const floor = Math.floor(raw);
    return {
      key: entry.key,
      floor,
      remainder: raw - floor,
    };
  });

  const used = basis.reduce((sum, entry) => sum + entry.floor, 0);
  const remaining = 10_000 - used;

  basis
    .sort((left, right) => {
      if (right.remainder !== left.remainder) return right.remainder - left.remainder;
      return left.key.localeCompare(right.key);
    })
    .slice(0, Math.max(0, remaining))
    .forEach((entry) => {
      entry.floor += 1;
    });

  const output: Record<string, number> = {};
  basis
    .sort((left, right) => left.key.localeCompare(right.key))
    .forEach((entry) => {
      output[entry.key] = entry.floor / 100;
    });

  return output;
}

function toLowerKeyedMap(input: Record<string, number> | undefined): Record<string, number> {
  if (!input) return {};
  const normalized: Record<string, number> = {};
  Object.entries(input).forEach(([key, value]) => {
    const normalizedKey = key.trim().toLowerCase();
    if (!normalizedKey) return;
    if (!Number.isFinite(value)) return;
    normalized[normalizedKey] = value;
  });
  return normalized;
}

function categorizeStrategy(strategy: StrategyConfig): "aggressive" | "defensive" | "neutral" {
  const id = strategy.id.toLowerCase();
  const tags = (strategy.metadata?.tags ?? []).map((tag) => tag.toLowerCase());
  const joinedTags = tags.join(" ");

  if (
    id.includes("volatility") ||
    id.includes("drawdown") ||
    id.includes("hedge") ||
    joinedTags.includes("defensive")
  ) {
    return "defensive";
  }

  if (
    id.includes("momentum") ||
    id.includes("relative-strength") ||
    id.includes("rotation") ||
    joinedTags.includes("momentum")
  ) {
    return "aggressive";
  }

  return "neutral";
}

function allowedInRegime(strategy: StrategyConfig, regime: MarketRegime): boolean {
  const category = categorizeStrategy(strategy);
  if (regime === "risk_on") return category !== "defensive";
  if (regime === "risk_off" || regime === "high_volatility") return category !== "aggressive";
  return true;
}

function mergeWeightedAllocations(
  strategyAllocations: Record<string, AllocationMap>,
  weights: Record<string, number>
): MergeAllocationsResult {
  const strategyIds = Object.keys(strategyAllocations).sort((left, right) => left.localeCompare(right));
  if (strategyIds.length === 0) {
    return {
      allocation: { USDC: 100 },
      reasonByAsset: {},
    };
  }

  const universeSet = new Set<string>();
  strategyIds.forEach((strategyId) => {
    Object.keys(strategyAllocations[strategyId] ?? {}).forEach((asset) => {
      universeSet.add(asset);
    });
  });
  const universe = Array.from(universeSet).sort((left, right) => left.localeCompare(right));

  const merged: AllocationMap = {};
  const reasonByAsset: Record<string, string> = {};

  universe.forEach((asset) => {
    let weightedValue = 0;
    let bestStrategyId = strategyIds[0];
    let bestContribution = Number.NEGATIVE_INFINITY;

    strategyIds.forEach((strategyId) => {
      const strategyWeight = (weights[strategyId] ?? 0) / 100;
      const allocation = strategyAllocations[strategyId]?.[asset] ?? 0;
      const contribution = strategyWeight * allocation;
      weightedValue += contribution;

      if (contribution > bestContribution) {
        bestContribution = contribution;
        bestStrategyId = strategyId;
      }
    });

    merged[asset] = weightedValue;
    reasonByAsset[asset] = `composition:${bestStrategyId}`;
  });

  return {
    allocation: normalizeAllocation(merged, universe),
    reasonByAsset,
  };
}

export class StrategyEngine {
  private evaluateSingleStrategy(input: {
    strategy: StrategyConfig;
    portfolio: PortfolioState;
    signals: MarketSignalSnapshot;
    currentAllocation: AllocationMap;
    baseAllocation: AllocationMap;
  }): StrategyAllocationEvaluation {
    const symbols = mergeAssetUniverse(input.currentAllocation, input.baseAllocation);
    const normalizedBase = normalizeAllocation(withAllAssets(input.baseAllocation, symbols), symbols);

    const ruleResult = evaluateRules({
      strategy: {
        ...input.strategy,
        baseAllocation: normalizedBase,
      },
      baseAllocation: normalizedBase,
      portfolio: input.portfolio,
      signals: input.signals,
    });

    const guardResult = enforceGuards({
      allocation: ruleResult.allocation,
      baseAllocation: normalizedBase,
      guards: input.strategy.guards,
      disabledAssets: input.strategy.disabledAssets,
    });

    const adjustedTargetAllocation = normalizeAllocation(guardResult.allocation, symbols);

    return {
      baseAllocation: normalizedBase,
      adjustedTargetAllocation,
      traces: ruleResult.traces,
      warnings: [...ruleResult.warnings, ...guardResult.warnings],
      actionReasonsByAsset: ruleResult.actionReasonsByAsset,
    };
  }

  private buildManualWeights(strategyIds: string[], configuredWeights?: Record<string, number>): Record<string, number> {
    const normalizedConfigured = toLowerKeyedMap(configuredWeights);
    const raw: Record<string, number> = {};

    strategyIds.forEach((strategyId) => {
      raw[strategyId] = normalizedConfigured[strategyId.toLowerCase()] ?? 0;
    });

    return normalizePercentMap(raw, strategyIds);
  }

  private applyWeightShiftLimit(
    targetWeights: Record<string, number>,
    previousWeights: Record<string, number>,
    strategyIds: string[],
    maxShiftPerCycle: number
  ): Record<string, number> {
    const shift = Math.max(0, maxShiftPerCycle);
    if (shift <= 0) {
      return normalizePercentMap(targetWeights, strategyIds);
    }

    const limited: Record<string, number> = {};
    strategyIds.forEach((strategyId) => {
      const previous = Number.isFinite(previousWeights[strategyId]) ? previousWeights[strategyId] : 0;
      const target = Number.isFinite(targetWeights[strategyId]) ? targetWeights[strategyId] : 0;
      const delta = clamp(target - previous, -shift, shift);
      limited[strategyId] = Math.max(0, previous + delta);
    });

    return normalizePercentMap(limited, strategyIds);
  }

  private applyWeightBounds(
    weights: Record<string, number>,
    minWeightPct?: number,
    maxWeightPct?: number
  ): Record<string, number> {
    const strategyIds = Object.keys(weights).sort((left, right) => left.localeCompare(right));
    if (strategyIds.length === 0) return {};

    const minWeight = typeof minWeightPct === "number" ? clamp(minWeightPct, 0, 100) : 0;
    const maxWeight = typeof maxWeightPct === "number" ? clamp(maxWeightPct, minWeight, 100) : 100;
    let working = normalizePercentMap(weights, strategyIds);

    for (let pass = 0; pass < 5; pass += 1) {
      let total = 0;
      strategyIds.forEach((strategyId) => {
        working[strategyId] = clamp(working[strategyId] ?? 0, minWeight, maxWeight);
        total += working[strategyId];
      });

      const diff = 100 - total;
      if (Math.abs(diff) < 0.01) {
        return normalizePercentMap(working, strategyIds);
      }

      const adjustable = strategyIds.filter((strategyId) =>
        diff > 0 ? (working[strategyId] ?? 0) < maxWeight : (working[strategyId] ?? 0) > minWeight
      );
      if (adjustable.length === 0) {
        return normalizePercentMap(working, strategyIds);
      }

      const adjustment = diff / adjustable.length;
      adjustable.forEach((strategyId) => {
        working[strategyId] = clamp((working[strategyId] ?? 0) + adjustment, minWeight, maxWeight);
      });
    }

    return normalizePercentMap(working, strategyIds);
  }

  private buildAutomaticWeights(input: {
    strategy: StrategyConfig;
    baseStrategies: StrategyConfig[];
    signals: MarketSignalSnapshot;
  }): AutomaticWeightingResult {
    const warnings: string[] = [];
    const marketRegime = detectMarketRegime(input.signals);
    const strategyIds = input.baseStrategies.map((strategy) => strategy.id);
    const maxActiveStrategies = Math.max(
      1,
      Math.min(
        input.strategy.strategySelectionConfig?.maxActiveStrategies ?? Math.min(3, strategyIds.length),
        strategyIds.length
      )
    );
    const minStrategyScore = clamp(input.strategy.strategySelectionConfig?.minStrategyScore ?? 0.45, 0, 1);
    const scorePower = input.strategy.weightAdjustmentConfig?.scorePower ?? 1;
    const fallbackStrategyId = input.strategy.strategySelectionConfig?.fallbackStrategy?.toLowerCase();
    const maxShift = input.strategy.strategySelectionConfig?.maxWeightShiftPerCycle;
    const previousWeights = this.buildManualWeights(strategyIds, input.strategy.strategyWeights);

    const scores = input.baseStrategies
      .map((strategy) => scoreStrategyForCycle(strategy, input.signals, marketRegime))
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.strategyId.localeCompare(right.strategyId);
      });

    const scoreById = new Map(scores.map((entry) => [entry.strategyId, entry]));
    let eligible = input.baseStrategies.filter((strategy) => allowedInRegime(strategy, marketRegime));
    if (eligible.length === 0) {
      warnings.push(`No strategies matched regime ${marketRegime}; using full base strategy set.`);
      eligible = [...input.baseStrategies];
    }

    let selected = eligible
      .map((strategy) => scoreById.get(strategy.id))
      .filter((entry): entry is StrategyScoreResult => Boolean(entry))
      .filter((entry) => entry.score >= minStrategyScore)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.strategyId.localeCompare(right.strategyId);
      })
      .slice(0, maxActiveStrategies);

    if (selected.length === 0) {
      if (fallbackStrategyId) {
        const fallback = scores.find((entry) => entry.strategyId.toLowerCase() === fallbackStrategyId);
        if (fallback) {
          selected = [fallback];
          warnings.push(`All strategies scored below minimum. Using fallback strategy ${fallback.strategyId}.`);
        }
      }
    }

    if (selected.length === 0 && scores.length > 0) {
      selected = [scores[0]];
      warnings.push(`All strategies scored below minimum. Falling back to highest score strategy ${scores[0].strategyId}.`);
    }

    const rawWeights: Record<string, number> = {};
    selected.forEach((entry) => {
      rawWeights[entry.strategyId] = Math.max(0.0001, Math.pow(entry.score, scorePower));
    });

    let activeWeights = normalizePercentMap(rawWeights, selected.map((entry) => entry.strategyId));
    activeWeights = this.applyWeightBounds(
      activeWeights,
      input.strategy.weightAdjustmentConfig?.minWeightPctPerStrategy,
      input.strategy.weightAdjustmentConfig?.maxWeightPctPerStrategy
    );
    const maxShiftPerCycle = typeof maxShift === "number" ? Math.max(0, maxShift) : undefined;
    if (typeof maxShiftPerCycle === "number") {
      activeWeights = this.applyWeightShiftLimit(activeWeights, previousWeights, Object.keys(activeWeights), maxShiftPerCycle);
      activeWeights = this.applyWeightBounds(
        activeWeights,
        input.strategy.weightAdjustmentConfig?.minWeightPctPerStrategy,
        input.strategy.weightAdjustmentConfig?.maxWeightPctPerStrategy
      );
    }

    return {
      strategyScores: scores,
      activeWeights,
      warnings,
      marketRegime,
    };
  }

  evaluate(input: StrategyEngineInput): StrategyEvaluationResult {
    const strategyUniverse = input.strategyUniverse ?? { [input.strategy.id]: input.strategy };
    const symbols = mergeAssetUniverse(input.strategy.baseAllocation, input.portfolio.allocation);
    const currentAllocation = normalizeAllocation(withAllAssets(input.portfolio.allocation, symbols), symbols);

    let baseAllocation = normalizeAllocation(withAllAssets(input.strategy.baseAllocation, symbols), symbols);
    let compositionWarnings: string[] = [];
    let compositionTraces: RuleEvaluationTrace[] = [];
    let compositionReasonByAsset: Record<string, string> = {};
    let compositionDetails: StrategyEvaluationResult["composition"];

    const requestedBaseStrategies = (input.strategy.baseStrategies ?? [])
      .map((strategyId) => strategyId.trim().toLowerCase())
      .filter((strategyId) => strategyId.length > 0 && strategyId !== input.strategy.id.toLowerCase());

    if (requestedBaseStrategies.length > 0) {
      const baseStrategies = requestedBaseStrategies
        .map((strategyId) => strategyUniverse[strategyId] ?? strategyUniverse[strategyId.toLowerCase()])
        .filter((strategy): strategy is StrategyConfig => Boolean(strategy));

      const missingBaseIds = requestedBaseStrategies.filter(
        (strategyId) => !baseStrategies.some((strategy) => strategy.id.toLowerCase() === strategyId)
      );
      if (missingBaseIds.length > 0) {
        compositionWarnings.push(`Missing base strategies: ${missingBaseIds.join(", ")}.`);
      }

      if (baseStrategies.length > 0) {
        const baseEvaluations: Record<string, StrategyAllocationEvaluation> = {};
        const baseAllocations: Record<string, AllocationMap> = {};

        baseStrategies.forEach((strategy) => {
          const strategySymbols = mergeAssetUniverse(strategy.baseAllocation, currentAllocation);
          const strategyBaseAllocation = normalizeAllocation(withAllAssets(strategy.baseAllocation, strategySymbols), strategySymbols);
          const evaluation = this.evaluateSingleStrategy({
            strategy,
            portfolio: input.portfolio,
            signals: input.marketSignals,
            currentAllocation,
            baseAllocation: strategyBaseAllocation,
          });

          baseEvaluations[strategy.id] = evaluation;
          baseAllocations[strategy.id] = evaluation.adjustedTargetAllocation;
          compositionWarnings.push(...evaluation.warnings.map((warning) => `${strategy.id}: ${warning}`));
          compositionTraces.push(
            ...evaluation.traces.map((trace) => ({
              ...trace,
              ruleId: `${strategy.id}:${trace.ruleId}`,
              ruleName: trace.ruleName ? `${strategy.name} / ${trace.ruleName}` : strategy.name,
            }))
          );
        });

        const automaticMode = input.strategy.compositionMode === "automatic" || Boolean(input.strategy.autoStrategyUsage);
        let activeWeights: Record<string, number>;
        let strategyScores: StrategyScoreResult[];
        let marketRegime: MarketRegime;

        if (automaticMode) {
          const auto = this.buildAutomaticWeights({
            strategy: input.strategy,
            baseStrategies,
            signals: input.marketSignals,
          });

          activeWeights = auto.activeWeights;
          strategyScores = auto.strategyScores;
          marketRegime = auto.marketRegime;
          compositionWarnings.push(...auto.warnings);
        } else {
          activeWeights = this.buildManualWeights(baseStrategies.map((strategy) => strategy.id), input.strategy.strategyWeights);
          activeWeights = this.applyWeightBounds(
            activeWeights,
            input.strategy.weightAdjustmentConfig?.minWeightPctPerStrategy,
            input.strategy.weightAdjustmentConfig?.maxWeightPctPerStrategy
          );
          strategyScores = baseStrategies
            .map((strategy) => scoreStrategyForCycle(strategy, input.marketSignals, detectMarketRegime(input.marketSignals)))
            .sort((left, right) => left.strategyId.localeCompare(right.strategyId));
          marketRegime = detectMarketRegime(input.marketSignals);
        }

        const merged = mergeWeightedAllocations(baseAllocations, activeWeights);
        baseAllocation = merged.allocation;
        compositionReasonByAsset = merged.reasonByAsset;

        compositionDetails = {
          compositionMode: input.strategy.compositionMode ?? "manual",
          autoStrategyUsage: automaticMode,
          marketRegime,
          strategyScores,
          activeStrategyWeights: activeWeights,
        };
      }
    }

    const evaluated = this.evaluateSingleStrategy({
      strategy: input.strategy,
      portfolio: input.portfolio,
      signals: input.marketSignals,
      currentAllocation,
      baseAllocation,
    });

    const adjustedTargetAllocation = normalizeAllocation(
      evaluated.adjustedTargetAllocation,
      mergeAssetUniverse(evaluated.adjustedTargetAllocation, currentAllocation)
    );

    const rebalancePlan = buildRebalancePlan({
      currentAllocation,
      targetAllocation: adjustedTargetAllocation,
      totalPortfolioValue: input.portfolio.totalValue,
      guards: input.strategy.guards,
    });

    const warnings = [...compositionWarnings, ...evaluated.warnings, ...rebalancePlan.warnings];
    const actionReasonsByAsset = {
      ...compositionReasonByAsset,
      ...evaluated.actionReasonsByAsset,
    };

    const executionPlan = generateExecutionPlan({
      strategyId: input.strategy.id,
      accountType: input.accountType ?? "real",
      mode: input.modeOverride ?? input.strategy.executionMode,
      currentAllocation,
      targetAllocation: adjustedTargetAllocation,
      rebalancePlan,
      warnings,
      actionReasonsByAsset,
    });

    return {
      strategyId: input.strategy.id,
      evaluatedAt: new Date().toISOString(),
      currentAllocation,
      baseAllocation,
      adjustedTargetAllocation,
      traces: [...compositionTraces, ...evaluated.traces],
      warnings,
      rebalancePlan,
      executionPlan,
      composition: compositionDetails,
    };
  }
}

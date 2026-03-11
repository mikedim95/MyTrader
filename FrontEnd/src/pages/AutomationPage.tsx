import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { backendApi } from "@/lib/api";
import { useBacktests, useDemoAccountSettings, useStrategies, useStrategyRunDetails, useStrategyRuns } from "@/hooks/useTradingData";
import type {
  BacktestCreateRequest,
  PortfolioAccountType,
  StrategyCompositionMode,
  StrategyConfig,
  StrategyMode,
} from "@/types/api";
import { SpinnerValue } from "@/components/SpinnerValue";
import { cn } from "@/lib/utils";

interface DraftAllocationRow {
  id: string;
  symbol: string;
  percent: string;
}

interface DraftRule {
  id: string;
  name: string;
  priority: string;
  enabled: boolean;
  conditionIndicator: string;
  conditionOperator: string;
  conditionValue: string;
  conditionAsset: string;
  actionType: string;
  actionPercent: string;
  actionAsset: string;
  actionFrom: string;
  actionTo: string;
}

interface DraftStrategyWeightRow {
  id: string;
  strategyId: string;
  weight: string;
}

interface StrategyDraft {
  name: string;
  description: string;
  executionMode: StrategyMode;
  scheduleInterval: string;
  isEnabled: boolean;
  compositionMode: StrategyCompositionMode;
  baseStrategiesCsv: string;
  strategyWeightRows: DraftStrategyWeightRow[];
  autoStrategyUsage: boolean;
  selectionConfig: {
    minStrategyScore: string;
    maxActiveStrategies: string;
    maxWeightShiftPerCycle: string;
    strategyCooldownHours: string;
    minActiveDurationHours: string;
    fallbackStrategy: string;
  };
  weightAdjustment: {
    scorePower: string;
    minWeightPctPerStrategy: string;
    maxWeightPctPerStrategy: string;
  };
  metadataRiskLevel: string;
  metadataExpectedTurnover: string;
  metadataStablecoinExposure: string;
  disabledAssetsCsv: string;
  guards: {
    maxSingleAssetPct: string;
    minStablecoinPct: string;
    maxTradesPerCycle: string;
    minTradeNotional: string;
    cashReservePct: string;
  };
  baseAllocationRows: DraftAllocationRow[];
  rules: DraftRule[];
}

type GuardField = keyof StrategyDraft["guards"];

interface DraftRuleErrors {
  id?: string;
  priority?: string;
  conditionValue?: string;
  actionPercent?: string;
  actionAsset?: string;
  actionFrom?: string;
  actionTo?: string;
}

interface DraftWeightRowErrors {
  strategyId?: string;
  weight?: string;
}

interface DraftValidationErrors {
  name?: string;
  scheduleInterval?: string;
  disabledAssetsCsv?: string;
  baseAllocation?: string;
  composition: {
    baseStrategiesCsv?: string;
    minStrategyScore?: string;
    maxActiveStrategies?: string;
    maxWeightShiftPerCycle?: string;
    strategyCooldownHours?: string;
    minActiveDurationHours?: string;
    fallbackStrategy?: string;
    scorePower?: string;
    minWeightPctPerStrategy?: string;
    maxWeightPctPerStrategy?: string;
    strategyWeightRows?: string;
  };
  guards: Partial<Record<GuardField, string>>;
  baseAllocationRows: Record<string, { symbol?: string; percent?: string }>;
  strategyWeightRows: Record<string, DraftWeightRowErrors>;
  rules: Record<string, DraftRuleErrors>;
}

const MODE_OPTIONS: StrategyMode[] = ["manual", "semi_auto", "auto"];
const COMPOSITION_MODE_OPTIONS: StrategyCompositionMode[] = ["manual", "automatic"];
const INDICATOR_OPTIONS = [
  "volatility",
  "btc_dominance",
  "portfolio_drift",
  "asset_weight",
  "asset_trend",
  "price_change_24h",
  "volume_change",
  "market_direction",
  "relative_strength",
  "drawdown_pct",
];
const OPERATOR_OPTIONS = [">", "<", ">=", "<=", "==", "!="];
const ACTION_TYPE_OPTIONS = [
  "increase",
  "decrease",
  "shift",
  "increase_stablecoin_exposure",
  "reduce_altcoin_exposure",
];
const RISK_OPTIONS = ["", "low", "medium", "high"];
const TURNOVER_OPTIONS = ["", "low", "medium", "high"];
const STABLE_EXPOSURE_OPTIONS = ["", "low", "medium", "high"];
const SCHEDULE_INTERVAL_PATTERN = /^\d+(m|h|d)$/;

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function validateOptionalNumericField(
  value: string,
  label: string,
  options?: { integer?: boolean; min?: number; max?: number }
): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return `${label} must be numeric.`;
  }

  if (options?.integer && !Number.isInteger(parsed)) {
    return `${label} must be an integer.`;
  }

  if (typeof options?.min === "number" && parsed < options.min) {
    return `${label} must be >= ${options.min}.`;
  }

  if (typeof options?.max === "number" && parsed > options.max) {
    return `${label} must be <= ${options.max}.`;
  }

  return undefined;
}

function validateDraft(draft: StrategyDraft): DraftValidationErrors {
  const errors: DraftValidationErrors = {
    composition: {},
    guards: {},
    baseAllocationRows: {},
    strategyWeightRows: {},
    rules: {},
  };

  if (!draft.name.trim()) {
    errors.name = "Strategy name is required.";
  }

  const scheduleInterval = draft.scheduleInterval.trim().toLowerCase();
  if (!scheduleInterval) {
    errors.scheduleInterval = "Schedule interval is required.";
  } else if (!SCHEDULE_INTERVAL_PATTERN.test(scheduleInterval)) {
    errors.scheduleInterval = "Use format like 15m, 1h, or 1d.";
  }

  errors.guards.maxSingleAssetPct = validateOptionalNumericField(
    draft.guards.maxSingleAssetPct,
    "Max single %",
    { min: 0, max: 100 }
  );
  errors.guards.minStablecoinPct = validateOptionalNumericField(
    draft.guards.minStablecoinPct,
    "Min stable %",
    { min: 0, max: 100 }
  );
  errors.guards.maxTradesPerCycle = validateOptionalNumericField(
    draft.guards.maxTradesPerCycle,
    "Max trades",
    { integer: true, min: 0 }
  );
  errors.guards.minTradeNotional = validateOptionalNumericField(
    draft.guards.minTradeNotional,
    "Min notional",
    { min: 0 }
  );
  errors.guards.cashReservePct = validateOptionalNumericField(
    draft.guards.cashReservePct,
    "Cash reserve %",
    { min: 0, max: 100 }
  );

  let hasAnyBaseSymbol = false;
  for (const row of draft.baseAllocationRows) {
    const rowErrors: { symbol?: string; percent?: string } = {};
    const symbol = row.symbol.trim().toUpperCase();
    const percentRaw = row.percent.trim();

    if (symbol) {
      hasAnyBaseSymbol = true;
      if (!/^[A-Z0-9_]+$/.test(symbol)) {
        rowErrors.symbol = "Use uppercase letters/numbers only.";
      }
    }

    if (percentRaw && !symbol) {
      rowErrors.symbol = "Symbol is required when percent is set.";
    }

    if (symbol && !percentRaw) {
      rowErrors.percent = "Percent is required when symbol is set.";
    } else if (percentRaw) {
      const parsedPercent = Number(percentRaw);
      if (!Number.isFinite(parsedPercent)) {
        rowErrors.percent = "Percent must be numeric.";
      } else if (parsedPercent < 0) {
        rowErrors.percent = "Percent cannot be negative.";
      }
    }

    if (rowErrors.symbol || rowErrors.percent) {
      errors.baseAllocationRows[row.id] = rowErrors;
    }
  }

  if (!hasAnyBaseSymbol) {
    errors.baseAllocation = "Add at least one base allocation symbol.";
  }

  const disabledAssets = draft.disabledAssetsCsv
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const invalidDisabledAsset = disabledAssets.find((value) => !/^[A-Za-z0-9_]+$/.test(value));
  if (invalidDisabledAsset) {
    errors.disabledAssetsCsv = `Invalid disabled asset: ${invalidDisabledAsset}`;
  }

  const baseStrategies = draft.baseStrategiesCsv
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const invalidBaseStrategy = baseStrategies.find((value) => !/^[a-z0-9-]+$/.test(value));
  if (invalidBaseStrategy) {
    errors.composition.baseStrategiesCsv = `Invalid base strategy id: ${invalidBaseStrategy}`;
  }

  if ((draft.compositionMode === "automatic" || draft.autoStrategyUsage || baseStrategies.length > 0) && baseStrategies.length === 0) {
    errors.composition.baseStrategiesCsv = "Select at least one base strategy for composition.";
  }

  errors.composition.minStrategyScore = validateOptionalNumericField(
    draft.selectionConfig.minStrategyScore,
    "Min strategy score",
    { min: 0, max: 1 }
  );
  errors.composition.maxActiveStrategies = validateOptionalNumericField(
    draft.selectionConfig.maxActiveStrategies,
    "Max active strategies",
    { integer: true, min: 1, max: 20 }
  );
  errors.composition.maxWeightShiftPerCycle = validateOptionalNumericField(
    draft.selectionConfig.maxWeightShiftPerCycle,
    "Max weight shift per cycle",
    { min: 0, max: 100 }
  );
  errors.composition.strategyCooldownHours = validateOptionalNumericField(
    draft.selectionConfig.strategyCooldownHours,
    "Strategy cooldown hours",
    { integer: true, min: 0, max: 720 }
  );
  errors.composition.minActiveDurationHours = validateOptionalNumericField(
    draft.selectionConfig.minActiveDurationHours,
    "Min active duration hours",
    { integer: true, min: 0, max: 720 }
  );
  errors.composition.scorePower = validateOptionalNumericField(draft.weightAdjustment.scorePower, "Score power", {
    min: 0.1,
    max: 5,
  });
  errors.composition.minWeightPctPerStrategy = validateOptionalNumericField(
    draft.weightAdjustment.minWeightPctPerStrategy,
    "Min weight %",
    { min: 0, max: 100 }
  );
  errors.composition.maxWeightPctPerStrategy = validateOptionalNumericField(
    draft.weightAdjustment.maxWeightPctPerStrategy,
    "Max weight %",
    { min: 0, max: 100 }
  );

  const minWeight = draft.weightAdjustment.minWeightPctPerStrategy.trim()
    ? Number(draft.weightAdjustment.minWeightPctPerStrategy)
    : undefined;
  const maxWeight = draft.weightAdjustment.maxWeightPctPerStrategy.trim()
    ? Number(draft.weightAdjustment.maxWeightPctPerStrategy)
    : undefined;
  if (typeof minWeight === "number" && typeof maxWeight === "number" && Number.isFinite(minWeight) && Number.isFinite(maxWeight) && minWeight > maxWeight) {
    errors.composition.maxWeightPctPerStrategy = "Max weight % must be >= Min weight %.";
  }

  if (draft.selectionConfig.fallbackStrategy.trim() && !/^[a-z0-9-]+$/i.test(draft.selectionConfig.fallbackStrategy.trim())) {
    errors.composition.fallbackStrategy = "Fallback strategy must use letters, numbers, and hyphens.";
  }

  const seenWeightStrategies = new Set<string>();
  draft.strategyWeightRows.forEach((row) => {
    const rowErrors: DraftWeightRowErrors = {};
    const strategyId = row.strategyId.trim().toLowerCase();
    const weight = row.weight.trim();

    if (strategyId) {
      if (!/^[a-z0-9-]+$/.test(strategyId)) {
        rowErrors.strategyId = "Use lowercase letters, numbers, and hyphens.";
      } else if (seenWeightStrategies.has(strategyId)) {
        rowErrors.strategyId = "Strategy weight row must be unique.";
      } else {
        seenWeightStrategies.add(strategyId);
      }
    }

    if (weight && !strategyId) {
      rowErrors.strategyId = "Strategy id is required when weight is set.";
    }

    if (strategyId && !weight) {
      rowErrors.weight = "Weight is required when strategy id is set.";
    } else if (weight) {
      const parsedWeight = Number(weight);
      if (!Number.isFinite(parsedWeight)) {
        rowErrors.weight = "Weight must be numeric.";
      } else if (parsedWeight < 0) {
        rowErrors.weight = "Weight cannot be negative.";
      }
    }

    if (rowErrors.strategyId || rowErrors.weight) {
      errors.strategyWeightRows[row.id] = rowErrors;
    }
  });

  if (draft.compositionMode === "manual" && baseStrategies.length > 0 && draft.strategyWeightRows.length === 0) {
    errors.composition.strategyWeightRows = "Add strategy weights for manual composition mode.";
  }

  const seenRuleIds = new Set<string>();
  draft.rules.forEach((rule, index) => {
    const ruleErrors: DraftRuleErrors = {};
    const mapKey = String(index);

    const ruleId = rule.id.trim();
    if (!ruleId) {
      ruleErrors.id = "Rule ID is required.";
    } else {
      const normalizedRuleId = ruleId.toLowerCase();
      if (seenRuleIds.has(normalizedRuleId)) {
        ruleErrors.id = "Rule ID must be unique.";
      }
      seenRuleIds.add(normalizedRuleId);
    }

    const priority = Number(rule.priority);
    if (!Number.isInteger(priority) || priority <= 0) {
      ruleErrors.priority = "Priority must be a positive integer.";
    }

    const conditionValue = Number(rule.conditionValue);
    if (!Number.isFinite(conditionValue)) {
      ruleErrors.conditionValue = "Condition value must be numeric.";
    }

    const actionPercent = Number(rule.actionPercent);
    if (!Number.isFinite(actionPercent) || actionPercent <= 0) {
      ruleErrors.actionPercent = "Percent must be greater than 0.";
    }

    if ((rule.actionType === "increase" || rule.actionType === "decrease") && !rule.actionAsset.trim()) {
      ruleErrors.actionAsset = "Action asset is required for increase/decrease.";
    }

    if (rule.actionType === "shift") {
      if (!rule.actionFrom.trim()) {
        ruleErrors.actionFrom = "From is required for shift.";
      }
      if (!rule.actionTo.trim()) {
        ruleErrors.actionTo = "To is required for shift.";
      }
      if (
        rule.actionFrom.trim() &&
        rule.actionTo.trim() &&
        rule.actionFrom.trim().toUpperCase() === rule.actionTo.trim().toUpperCase()
      ) {
        ruleErrors.actionTo = "From and To must be different.";
      }
    }

    if (Object.values(ruleErrors).some(Boolean)) {
      errors.rules[mapKey] = ruleErrors;
    }
  });

  return errors;
}

function hasDraftValidationErrors(errors: DraftValidationErrors): boolean {
  if (errors.name || errors.scheduleInterval || errors.disabledAssetsCsv || errors.baseAllocation) {
    return true;
  }

  if (Object.values(errors.composition).some(Boolean)) {
    return true;
  }

  if (Object.values(errors.guards).some(Boolean)) {
    return true;
  }

  if (Object.values(errors.baseAllocationRows).some((rowErrors) => rowErrors.symbol || rowErrors.percent)) {
    return true;
  }

  if (Object.values(errors.strategyWeightRows).some((rowErrors) => rowErrors.strategyId || rowErrors.weight)) {
    return true;
  }

  if (Object.values(errors.rules).some((ruleErrors) => Object.values(ruleErrors).some(Boolean))) {
    return true;
  }

  return false;
}

function firstDraftValidationError(errors: DraftValidationErrors): string | undefined {
  if (errors.name) return errors.name;
  if (errors.scheduleInterval) return errors.scheduleInterval;
  if (errors.baseAllocation) return errors.baseAllocation;
  if (errors.disabledAssetsCsv) return errors.disabledAssetsCsv;
  const firstCompositionError = Object.values(errors.composition).find(Boolean);
  if (firstCompositionError) return firstCompositionError;

  const firstGuardError = Object.values(errors.guards).find(Boolean);
  if (firstGuardError) return firstGuardError;

  for (const rowError of Object.values(errors.baseAllocationRows)) {
    if (rowError.symbol) return rowError.symbol;
    if (rowError.percent) return rowError.percent;
  }

  for (const rowError of Object.values(errors.strategyWeightRows)) {
    if (rowError.strategyId) return rowError.strategyId;
    if (rowError.weight) return rowError.weight;
  }

  for (const ruleError of Object.values(errors.rules)) {
    for (const message of Object.values(ruleError)) {
      if (message) return message;
    }
  }

  return undefined;
}

function formatDateTime(value: string | undefined): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "--";
  return parsed.toLocaleString();
}

function formatUsd(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatUsdToken(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "USD$--";
  return `USD$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDuration(startedAt: string | undefined, completedAt: string | undefined): string {
  if (!startedAt || !completedAt) return "--";

  const started = new Date(startedAt).getTime();
  const completed = new Date(completedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return "--";

  const totalSeconds = Math.floor((completed - started) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes <= 0 ? `${seconds}s` : `${minutes}m ${seconds}s`;
}

function createStartIso(dateValue: string): string {
  return new Date(`${dateValue}T00:00:00.000Z`).toISOString();
}

function createEndIso(dateValue: string): string {
  return new Date(`${dateValue}T23:59:59.999Z`).toISOString();
}

function toOptionalNumber(value: string, label: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be numeric.`);
  }

  return parsed;
}

function toOptionalInteger(value: string, label: string): number | undefined {
  const parsed = toOptionalNumber(value, label);
  if (parsed === undefined) return undefined;
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} must be an integer.`);
  }
  return parsed;
}

function strategyToDraft(strategy: StrategyConfig): StrategyDraft {
  const allocationRows = Object.entries(strategy.baseAllocation)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([symbol, percent]) => ({
      id: newId("allocation"),
      symbol,
      percent: String(percent),
    }));

  const rules = strategy.rules.map((rule) => ({
    id: rule.id,
    name: rule.name ?? "",
    priority: String(rule.priority),
    enabled: rule.enabled,
    conditionIndicator: rule.condition.indicator,
    conditionOperator: rule.condition.operator,
    conditionValue: String(rule.condition.value),
    conditionAsset: rule.condition.asset ?? "",
    actionType: rule.action.type,
    actionPercent: String(rule.action.percent),
    actionAsset: rule.action.asset ?? "",
    actionFrom: rule.action.from ?? "",
    actionTo: rule.action.to ?? "",
  }));
  const strategyWeightRows = Object.entries(strategy.strategyWeights ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([strategyId, weight]) => ({
      id: newId("strategy-weight"),
      strategyId,
      weight: String(weight),
    }));

  return {
    name: strategy.name,
    description: strategy.description ?? "",
    executionMode: strategy.executionMode,
    scheduleInterval: strategy.scheduleInterval,
    isEnabled: strategy.isEnabled,
    compositionMode: strategy.compositionMode ?? "manual",
    baseStrategiesCsv: (strategy.baseStrategies ?? []).join(", "),
    strategyWeightRows,
    autoStrategyUsage: Boolean(strategy.autoStrategyUsage),
    selectionConfig: {
      minStrategyScore:
        typeof strategy.strategySelectionConfig?.minStrategyScore === "number"
          ? String(strategy.strategySelectionConfig.minStrategyScore)
          : "",
      maxActiveStrategies:
        typeof strategy.strategySelectionConfig?.maxActiveStrategies === "number"
          ? String(strategy.strategySelectionConfig.maxActiveStrategies)
          : "",
      maxWeightShiftPerCycle:
        typeof strategy.strategySelectionConfig?.maxWeightShiftPerCycle === "number"
          ? String(strategy.strategySelectionConfig.maxWeightShiftPerCycle)
          : "",
      strategyCooldownHours:
        typeof strategy.strategySelectionConfig?.strategyCooldownHours === "number"
          ? String(strategy.strategySelectionConfig.strategyCooldownHours)
          : "",
      minActiveDurationHours:
        typeof strategy.strategySelectionConfig?.minActiveDurationHours === "number"
          ? String(strategy.strategySelectionConfig.minActiveDurationHours)
          : "",
      fallbackStrategy: strategy.strategySelectionConfig?.fallbackStrategy ?? "",
    },
    weightAdjustment: {
      scorePower:
        typeof strategy.weightAdjustmentConfig?.scorePower === "number"
          ? String(strategy.weightAdjustmentConfig.scorePower)
          : "",
      minWeightPctPerStrategy:
        typeof strategy.weightAdjustmentConfig?.minWeightPctPerStrategy === "number"
          ? String(strategy.weightAdjustmentConfig.minWeightPctPerStrategy)
          : "",
      maxWeightPctPerStrategy:
        typeof strategy.weightAdjustmentConfig?.maxWeightPctPerStrategy === "number"
          ? String(strategy.weightAdjustmentConfig.maxWeightPctPerStrategy)
          : "",
    },
    metadataRiskLevel: strategy.metadata?.riskLevel ?? "",
    metadataExpectedTurnover: strategy.metadata?.expectedTurnover ?? "",
    metadataStablecoinExposure: strategy.metadata?.stablecoinExposure ?? "",
    disabledAssetsCsv: (strategy.disabledAssets ?? []).join(", "),
    guards: {
      maxSingleAssetPct:
        typeof strategy.guards.max_single_asset_pct === "number"
          ? String(strategy.guards.max_single_asset_pct)
          : "",
      minStablecoinPct:
        typeof strategy.guards.min_stablecoin_pct === "number"
          ? String(strategy.guards.min_stablecoin_pct)
          : "",
      maxTradesPerCycle:
        typeof strategy.guards.max_trades_per_cycle === "number"
          ? String(strategy.guards.max_trades_per_cycle)
          : "",
      minTradeNotional:
        typeof strategy.guards.min_trade_notional === "number"
          ? String(strategy.guards.min_trade_notional)
          : "",
      cashReservePct:
        typeof strategy.guards.cash_reserve_pct === "number"
          ? String(strategy.guards.cash_reserve_pct)
          : "",
    },
    baseAllocationRows: allocationRows.length > 0 ? allocationRows : [{ id: newId("allocation"), symbol: "", percent: "" }],
    rules,
  };
}

function draftToPayload(draft: StrategyDraft, strategyId: string): unknown {
  const baseAllocation: Record<string, number> = {};

  for (const row of draft.baseAllocationRows) {
    const symbol = row.symbol.trim().toUpperCase();
    if (!symbol) continue;

    const percent = Number(row.percent);
    if (!Number.isFinite(percent) || percent < 0) {
      throw new Error(`Base allocation for ${symbol} must be a non-negative number.`);
    }

    baseAllocation[symbol] = (baseAllocation[symbol] ?? 0) + percent;
  }

  if (Object.keys(baseAllocation).length === 0) {
    throw new Error("At least one base allocation entry is required.");
  }

  const rules = draft.rules.map((rule, index) => {
    const priority = Number(rule.priority);
    if (!Number.isInteger(priority) || priority <= 0) {
      throw new Error(`Rule ${index + 1}: priority must be a positive integer.`);
    }

    const conditionValue = Number(rule.conditionValue);
    if (!Number.isFinite(conditionValue)) {
      throw new Error(`Rule ${index + 1}: condition value must be numeric.`);
    }

    const actionPercent = Number(rule.actionPercent);
    if (!Number.isFinite(actionPercent) || actionPercent <= 0) {
      throw new Error(`Rule ${index + 1}: action percent must be greater than 0.`);
    }

    const actionType = rule.actionType;
    const action: Record<string, unknown> = {
      type: actionType,
      percent: actionPercent,
    };

    if ((actionType === "increase" || actionType === "decrease") && !rule.actionAsset.trim()) {
      throw new Error(`Rule ${index + 1}: action asset is required for ${actionType}.`);
    }

    if (actionType === "shift") {
      if (!rule.actionFrom.trim() || !rule.actionTo.trim()) {
        throw new Error(`Rule ${index + 1}: action from/to are required for shift.`);
      }
      action.from = rule.actionFrom.trim().toUpperCase();
      action.to = rule.actionTo.trim().toUpperCase();
    }

    if (rule.actionAsset.trim()) {
      action.asset = rule.actionAsset.trim().toUpperCase();
    }

    return {
      id: rule.id || `rule-${index + 1}`,
      name: rule.name.trim() || undefined,
      priority,
      enabled: rule.enabled,
      condition: {
        indicator: rule.conditionIndicator,
        operator: rule.conditionOperator,
        value: conditionValue,
        asset: rule.conditionAsset.trim() ? rule.conditionAsset.trim().toUpperCase() : undefined,
      },
      action,
    };
  });

  const metadata = {
    riskLevel: draft.metadataRiskLevel || undefined,
    expectedTurnover: draft.metadataExpectedTurnover || undefined,
    stablecoinExposure: draft.metadataStablecoinExposure || undefined,
  };

  const disabledAssets = draft.disabledAssetsCsv
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  const baseStrategies = Array.from(
    new Set(
      draft.baseStrategiesCsv
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    )
  );

  const strategyWeights = draft.strategyWeightRows.reduce<Record<string, number>>((acc, row) => {
    const strategyRef = row.strategyId.trim().toLowerCase();
    if (!strategyRef) return acc;
    const weight = Number(row.weight);
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error(`Strategy weight for ${strategyRef} must be a non-negative number.`);
    }
    acc[strategyRef] = weight;
    return acc;
  }, {});

  return {
    id: strategyId,
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    baseAllocation,
    rules,
    guards: {
      max_single_asset_pct: toOptionalNumber(draft.guards.maxSingleAssetPct, "max_single_asset_pct"),
      min_stablecoin_pct: toOptionalNumber(draft.guards.minStablecoinPct, "min_stablecoin_pct"),
      max_trades_per_cycle: toOptionalInteger(draft.guards.maxTradesPerCycle, "max_trades_per_cycle"),
      min_trade_notional: toOptionalNumber(draft.guards.minTradeNotional, "min_trade_notional"),
      cash_reserve_pct: toOptionalNumber(draft.guards.cashReservePct, "cash_reserve_pct"),
    },
    executionMode: draft.executionMode,
    metadata,
    isEnabled: draft.isEnabled,
    scheduleInterval: draft.scheduleInterval.trim().toLowerCase(),
    disabledAssets,
    compositionMode: draft.compositionMode,
    baseStrategies,
    strategyWeights,
    autoStrategyUsage: draft.autoStrategyUsage,
    strategySelectionConfig: {
      minStrategyScore: toOptionalNumber(draft.selectionConfig.minStrategyScore, "minStrategyScore"),
      maxActiveStrategies: toOptionalInteger(draft.selectionConfig.maxActiveStrategies, "maxActiveStrategies"),
      maxWeightShiftPerCycle: toOptionalNumber(draft.selectionConfig.maxWeightShiftPerCycle, "maxWeightShiftPerCycle"),
      strategyCooldownHours: toOptionalInteger(draft.selectionConfig.strategyCooldownHours, "strategyCooldownHours"),
      minActiveDurationHours: toOptionalInteger(draft.selectionConfig.minActiveDurationHours, "minActiveDurationHours"),
      fallbackStrategy: draft.selectionConfig.fallbackStrategy.trim().toLowerCase() || undefined,
    },
    weightAdjustmentConfig: {
      scorePower: toOptionalNumber(draft.weightAdjustment.scorePower, "scorePower"),
      minWeightPctPerStrategy: toOptionalNumber(
        draft.weightAdjustment.minWeightPctPerStrategy,
        "minWeightPctPerStrategy"
      ),
      maxWeightPctPerStrategy: toOptionalNumber(
        draft.weightAdjustment.maxWeightPctPerStrategy,
        "maxWeightPctPerStrategy"
      ),
    },
  };
}

export function AutomationPage() {
  const queryClient = useQueryClient();
  const [accountType, setAccountType] = useState<PortfolioAccountType>("real");
  const [isDemoBalanceModalOpen, setIsDemoBalanceModalOpen] = useState(false);
  const [isEditorModalOpen, setIsEditorModalOpen] = useState(false);
  const [isRunDetailsModalOpen, setIsRunDetailsModalOpen] = useState(false);

  const { data: strategyData, isPending: loadingStrategies, error: strategyError } = useStrategies();
  const { data: demoAccountData, isPending: loadingDemoAccount } = useDemoAccountSettings();
  const { data: runData, isPending: loadingRuns } = useStrategyRuns(accountType);
  const { data: backtestData, isPending: loadingBacktests } = useBacktests();

  const strategies = strategyData?.strategies ?? [];
  const runs = runData?.runs ?? [];
  const backtests = backtestData?.backtests ?? [];

  const [selectedStrategyId, setSelectedStrategyId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");

  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [demoBalanceDraft, setDemoBalanceDraft] = useState("");

  const [draft, setDraft] = useState<StrategyDraft | null>(null);
  const [draftStrategyId, setDraftStrategyId] = useState("");
  const [draftDirty, setDraftDirty] = useState(false);

  const today = new Date();
  const defaultEnd = today.toISOString().slice(0, 10);
  const defaultStart = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [initialCapital, setInitialCapital] = useState("10000");
  const [timeframe, setTimeframe] = useState<"1h" | "1d">("1d");
  const [rebalanceCostsPct, setRebalanceCostsPct] = useState("0.001");
  const [slippagePct, setSlippagePct] = useState("0.001");

  useEffect(() => {
    if ((!selectedStrategyId || !strategies.some((strategy) => strategy.id === selectedStrategyId)) && strategies.length > 0) {
      setSelectedStrategyId(strategies[0].id);
    }
  }, [selectedStrategyId, strategies]);

  useEffect(() => {
    if (runs.length === 0) {
      setSelectedRunId("");
      return;
    }

    if (!selectedRunId || !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[0].id);
    }
  }, [selectedRunId, runs]);

  useEffect(() => {
    const balance = demoAccountData?.demoAccount.balance;
    if (typeof balance === "number" && Number.isFinite(balance)) {
      setDemoBalanceDraft(String(balance));
    }
  }, [demoAccountData?.demoAccount.balance]);

  useEffect(() => {
    if (accountType !== "demo") {
      setIsDemoBalanceModalOpen(false);
    }
  }, [accountType]);

  const selectedStrategy = useMemo(
    () => strategies.find((strategy) => strategy.id === selectedStrategyId) ?? null,
    [selectedStrategyId, strategies]
  );

  useEffect(() => {
    if (!selectedStrategy) return;

    const shouldReset = draftStrategyId !== selectedStrategy.id || !draftDirty;
    if (!shouldReset) return;

    setDraft(strategyToDraft(selectedStrategy));
    setDraftStrategyId(selectedStrategy.id);
    setDraftDirty(false);
  }, [draftDirty, draftStrategyId, selectedStrategy]);

  const { data: runDetailsData, isPending: loadingRunDetails } = useStrategyRunDetails(
    isRunDetailsModalOpen ? selectedRunId || undefined : undefined
  );
  const selectedRun = runDetailsData?.run ?? runs.find((run) => run.id === selectedRunId) ?? null;
  const selectedRunExecutionPlan = runDetailsData?.executionPlan ?? null;
  const selectedStrategyLastRunAt = useMemo(
    () => runs.find((run) => run.strategyId === selectedStrategyId)?.startedAt ?? selectedStrategy?.lastRunAt,
    [runs, selectedStrategy?.lastRunAt, selectedStrategyId]
  );

  const invalidateAll = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["strategies"] }),
      queryClient.invalidateQueries({ queryKey: ["strategy-runs", accountType] }),
      queryClient.invalidateQueries({ queryKey: ["strategy-run", selectedRunId] }),
      queryClient.invalidateQueries({ queryKey: ["strategy-state", selectedStrategyId, accountType] }),
      queryClient.invalidateQueries({ queryKey: ["strategy-execution-plan", selectedStrategyId, accountType] }),
      queryClient.invalidateQueries({ queryKey: ["backtests"] }),
    ]);
  };

  const runNowMutation = useMutation({
    mutationFn: (strategyId: string) => backendApi.runStrategyNow(strategyId, accountType),
    onSuccess: async (result) => {
      setErrorMessage("");
      setMessage(`Strategy run created (${result.run.accountType}): ${result.run.status}.`);
      await invalidateAll();
    },
    onError: (error) => {
      setMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Unable to run strategy.");
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (input: { strategyId: string; enabled: boolean }) =>
      input.enabled ? backendApi.enableStrategy(input.strategyId) : backendApi.disableStrategy(input.strategyId),
    onSuccess: async (result) => {
      setErrorMessage("");
      setMessage(`${result.strategy.name} ${result.strategy.isEnabled ? "enabled" : "disabled"}.`);
      await invalidateAll();
    },
    onError: (error) => {
      setMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Unable to toggle strategy.");
    },
  });

  const saveStrategyMutation = useMutation({
    mutationFn: async (input: { strategyId: string; payload: unknown }) => {
      const validation = await backendApi.validateStrategy(input.payload);
      if (!validation.valid) {
        throw new Error((validation.errors ?? ["Strategy validation failed."]).join(" | "));
      }
      return backendApi.updateStrategy(input.strategyId, input.payload);
    },
    onSuccess: async (result) => {
      setErrorMessage("");
      setMessage(`Saved strategy ${result.strategy.name}.`);
      setDraft(strategyToDraft(result.strategy));
      setDraftDirty(false);
      await invalidateAll();
    },
    onError: (error) => {
      setMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Unable to save strategy.");
    },
  });

  const backtestMutation = useMutation({
    mutationFn: (payload: BacktestCreateRequest) => backendApi.createBacktest(payload),
    onSuccess: async (result) => {
      setErrorMessage("");
      setMessage(`Backtest ${result.backtestRun.id} started.`);
      await invalidateAll();
    },
    onError: (error) => {
      setMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Unable to create backtest.");
    },
  });

  const updateDemoBalanceMutation = useMutation({
    mutationFn: (balance: number) => backendApi.updateDemoAccountSettings(balance),
    onSuccess: async (result) => {
      setErrorMessage("");
      setMessage(`Demo balance updated to ${formatUsd(result.demoAccount.balance)}.`);
      setDemoBalanceDraft(String(result.demoAccount.balance));
      setIsDemoBalanceModalOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["demo-account-settings"] }),
        queryClient.invalidateQueries({ queryKey: ["strategy-state", selectedStrategyId, "demo"] }),
        queryClient.invalidateQueries({ queryKey: ["strategy-execution-plan", selectedStrategyId, "demo"] }),
      ]);
    },
    onError: (error) => {
      setMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Unable to update demo balance.");
    },
  });

  const busy =
    runNowMutation.isPending ||
    toggleMutation.isPending ||
    saveStrategyMutation.isPending ||
    backtestMutation.isPending ||
    updateDemoBalanceMutation.isPending;

  const draftValidation = useMemo(() => (draft ? validateDraft(draft) : null), [draft]);
  const draftHasErrors = draftValidation ? hasDraftValidationErrors(draftValidation) : false;

  const editorFieldClass = (hasError?: boolean, compact?: boolean): string =>
    cn(
      "mt-1 w-full rounded border bg-secondary text-foreground outline-none",
      compact ? "px-2 py-1.5" : "px-2 py-2",
      hasError ? "border-negative" : "border-border"
    );
  const inlineErrorClass = "mt-1 text-[11px] font-mono text-negative";

  const updateDraft = (updater: (previous: StrategyDraft) => StrategyDraft): void => {
    setDraft((previous) => {
      if (!previous) return previous;
      return updater(previous);
    });
    setDraftDirty(true);
  };

  const updateAllocationRow = (rowId: string, patch: Partial<DraftAllocationRow>): void => {
    updateDraft((previous) => ({
      ...previous,
      baseAllocationRows: previous.baseAllocationRows.map((row) =>
        row.id === rowId ? { ...row, ...patch } : row
      ),
    }));
  };

  const removeAllocationRow = (rowId: string): void => {
    updateDraft((previous) => ({
      ...previous,
      baseAllocationRows:
        previous.baseAllocationRows.length <= 1
          ? previous.baseAllocationRows
          : previous.baseAllocationRows.filter((row) => row.id !== rowId),
    }));
  };

  const addAllocationRow = (): void => {
    updateDraft((previous) => ({
      ...previous,
      baseAllocationRows: [...previous.baseAllocationRows, { id: newId("allocation"), symbol: "", percent: "" }],
    }));
  };

  const updateStrategyWeightRow = (rowId: string, patch: Partial<DraftStrategyWeightRow>): void => {
    updateDraft((previous) => ({
      ...previous,
      strategyWeightRows: previous.strategyWeightRows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    }));
  };

  const removeStrategyWeightRow = (rowId: string): void => {
    updateDraft((previous) => ({
      ...previous,
      strategyWeightRows: previous.strategyWeightRows.filter((row) => row.id !== rowId),
    }));
  };

  const addStrategyWeightRow = (): void => {
    updateDraft((previous) => ({
      ...previous,
      strategyWeightRows: [...previous.strategyWeightRows, { id: newId("strategy-weight"), strategyId: "", weight: "" }],
    }));
  };

  const updateRule = (ruleId: string, patch: Partial<DraftRule>): void => {
    updateDraft((previous) => ({
      ...previous,
      rules: previous.rules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)),
    }));
  };

  const removeRule = (ruleId: string): void => {
    updateDraft((previous) => ({
      ...previous,
      rules: previous.rules.filter((rule) => rule.id !== ruleId),
    }));
  };

  const addRule = (): void => {
    updateDraft((previous) => ({
      ...previous,
      rules: [
        ...previous.rules,
        {
          id: newId("rule"),
          name: "",
          priority: String(previous.rules.length + 1),
          enabled: true,
          conditionIndicator: "volatility",
          conditionOperator: ">",
          conditionValue: "0",
          conditionAsset: "",
          actionType: "increase_stablecoin_exposure",
          actionPercent: "1",
          actionAsset: "",
          actionFrom: "",
          actionTo: "",
        },
      ],
    }));
  };

  const handleSaveStrategy = (): void => {
    if (!selectedStrategy || !draft) return;
    if (draftValidation && draftHasErrors) {
      setMessage("");
      setErrorMessage(firstDraftValidationError(draftValidation) ?? "Fix validation errors before saving.");
      return;
    }

    try {
      const payload = draftToPayload(draft, selectedStrategy.id);
      saveStrategyMutation.mutate({ strategyId: selectedStrategy.id, payload });
    } catch (error) {
      setMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Strategy draft is invalid.");
    }
  };

  const handleResetDraft = (): void => {
    if (!selectedStrategy) return;
    setDraft(strategyToDraft(selectedStrategy));
    setDraftDirty(false);
  };

  const handleBacktestCreate = (): void => {
    if (!selectedStrategy) {
      setMessage("");
      setErrorMessage("Select a strategy before starting a backtest.");
      return;
    }

    const capital = Number(initialCapital);
    const costs = Number(rebalanceCostsPct);
    const slip = Number(slippagePct);

    if (!Number.isFinite(capital) || capital <= 0) {
      setMessage("");
      setErrorMessage("Initial capital must be positive.");
      return;
    }

    backtestMutation.mutate({
      strategyId: selectedStrategy.id,
      startDate: createStartIso(startDate),
      endDate: createEndIso(endDate),
      initialCapital: capital,
      baseCurrency: "USDC",
      timeframe,
      rebalanceCostsPct: Number.isFinite(costs) && costs >= 0 ? costs : 0.001,
      slippagePct: Number.isFinite(slip) && slip >= 0 ? slip : 0.001,
    });
  };

  const handleSaveDemoBalance = (): void => {
    const parsed = Number(demoBalanceDraft);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setMessage("");
      setErrorMessage("Demo balance must be a positive number.");
      return;
    }

    updateDemoBalanceMutation.mutate(parsed);
  };

  const openStrategyEditor = (strategyId: string): void => {
    setSelectedStrategyId(strategyId);
    setIsEditorModalOpen(true);
  };

  const closeStrategyEditor = (): void => {
    setIsEditorModalOpen(false);
  };

  const openRunDetails = (runId: string): void => {
    setSelectedRunId(runId);
    setIsRunDetailsModalOpen(true);
  };

  const closeRunDetails = (): void => {
    setIsRunDetailsModalOpen(false);
  };

  const runIndicators = selectedRun?.inputSnapshot?.marketSignals.indicators ?? {};
  const demoBalanceCurrent = demoAccountData?.demoAccount.balance;
  const demoBalanceParsed = Number(demoBalanceDraft);
  const demoBalanceDirty =
    typeof demoBalanceCurrent === "number" &&
    Number.isFinite(demoBalanceCurrent) &&
    Number.isFinite(demoBalanceParsed) &&
    demoBalanceParsed > 0 &&
    Math.abs(demoBalanceParsed - demoBalanceCurrent) > 0.000001;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-mono font-semibold text-foreground">Automation</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Structured strategy editor, run detail explorer, and backtesting.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Active account:{" "}
            <span className="font-mono text-foreground">
              {accountType === "demo" ? "Demo (uses live market data)" : "Real Money"}
            </span>
          </p>
        </div>

        <div className="inline-flex rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setAccountType("real")}
            className={cn(
              "px-3 py-2 text-xs font-mono transition-colors",
              accountType === "real"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            )}
          >
            Real Money
          </button>
          <button
            onClick={() => setAccountType("demo")}
            className={cn(
              "px-3 py-2 text-xs font-mono transition-colors border-l border-border",
              accountType === "demo"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            )}
          >
            Demo Account
          </button>
        </div>
      </div>

      {accountType === "demo" ? (
        <div className="flex justify-center">
          <div className="relative min-w-[280px] rounded-lg border border-border bg-card px-6 py-4 text-center">
            <button
              onClick={() => setIsDemoBalanceModalOpen(true)}
              className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground hover:text-foreground"
              aria-label="Edit demo balance"
              disabled={loadingDemoAccount}
            >
              <Pencil size={14} />
            </button>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Demo Balance</div>
            <div className="mt-1 text-2xl font-mono font-semibold text-foreground">{formatUsdToken(demoBalanceCurrent)}</div>
            <div className="mt-1 text-[11px] font-mono text-muted-foreground">
              Dummy money (uses live market data)
            </div>
          </div>
        </div>
      ) : null}

      {strategyError ? (
        <div className="rounded-md border border-negative/30 bg-negative/10 px-4 py-3 text-xs text-negative">
          {strategyError instanceof Error ? strategyError.message : "Failed to load strategies."}
        </div>
      ) : null}
      {message ? <div className="rounded-md border border-positive/30 bg-positive/10 px-4 py-3 text-xs text-positive">{message}</div> : null}
      {errorMessage ? <div className="rounded-md border border-negative/30 bg-negative/10 px-4 py-3 text-xs text-negative">{errorMessage}</div> : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Strategy Catalog</div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Name", "Mode", "Enabled", "Interval", "Risk", "Next Run", "Actions"].map((heading) => (
                  <th key={heading} className="py-3 px-4 text-[10px] font-mono uppercase tracking-wider text-muted-foreground text-right first:text-left">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingStrategies ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">Loading strategies...</td></tr>
              ) : strategies.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">No strategies found.</td></tr>
              ) : (
                strategies.map((strategy) => (
                  <tr
                    key={strategy.id}
                    className={cn("border-b border-border cursor-pointer", strategy.id === selectedStrategyId ? "bg-secondary/40" : "hover:bg-secondary/20")}
                    onClick={() => setSelectedStrategyId(strategy.id)}
                  >
                    <td className="py-3 px-4 text-left text-xs font-mono text-foreground">{strategy.name}</td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-foreground">{strategy.executionMode}</td>
                    <td className="py-3 px-4 text-right text-xs font-mono"><span className={strategy.isEnabled ? "text-positive" : "text-muted-foreground"}>{strategy.isEnabled ? "Yes" : "No"}</span></td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-foreground">{strategy.scheduleInterval}</td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-foreground">{strategy.metadata?.riskLevel ?? "--"}</td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-muted-foreground">{formatDateTime(strategy.nextRunAt)}</td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-foreground">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          openStrategyEditor(strategy.id);
                        }}
                        className="px-2 py-1 rounded border border-border text-[11px] font-mono text-foreground hover:bg-secondary"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Selected Strategy</div>
          <div className="text-sm font-mono text-foreground">{selectedStrategy?.name ?? "--"}</div>
          <div className="text-xs text-muted-foreground">{selectedStrategy?.description ?? "Select a strategy to edit."}</div>

          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Rules</div><div className="mt-1 text-foreground">{selectedStrategy?.rules.length ?? 0}</div></div>
            <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Last Run</div><div className="mt-1 text-foreground">{formatDateTime(selectedStrategyLastRunAt)}</div></div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => selectedStrategy && toggleMutation.mutate({ strategyId: selectedStrategy.id, enabled: !selectedStrategy.isEnabled })}
              disabled={busy || !selectedStrategy}
              className="px-3 py-2 rounded-md border border-border text-xs font-mono text-foreground hover:bg-secondary disabled:opacity-60"
            >
              {selectedStrategy?.isEnabled ? "Disable" : "Enable"}
            </button>
            <button
              onClick={() => selectedStrategy && runNowMutation.mutate(selectedStrategy.id)}
              disabled={busy || !selectedStrategy}
              className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-mono font-semibold hover:opacity-90 disabled:opacity-60"
            >
              Run Now
            </button>
          </div>
        </div>
      </div>

      {isEditorModalOpen ? (
        <div className="fixed inset-0 z-50 bg-background/75 p-4" onClick={closeStrategyEditor}>
          <div className="mx-auto max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-lg border border-border bg-card p-4 space-y-4" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Structured Strategy Editor</div>
                <div className="mt-1 text-xs font-mono text-foreground">{selectedStrategy?.name ?? "Selected Strategy"}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={closeStrategyEditor} className="px-3 py-1.5 rounded-md border border-border text-xs font-mono text-foreground hover:bg-secondary">Close</button>
                <button onClick={handleResetDraft} disabled={busy || !draftDirty || !selectedStrategy} className="px-3 py-1.5 rounded-md border border-border text-xs font-mono text-foreground hover:bg-secondary disabled:opacity-60">Reset</button>
                <button onClick={handleSaveStrategy} disabled={busy || !draftDirty || !draft || !selectedStrategy || draftHasErrors} className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-mono font-semibold hover:opacity-90 disabled:opacity-60">Save Strategy</button>
              </div>
            </div>
        {draftHasErrors ? <div className="text-xs font-mono text-negative">Fix inline validation errors to enable save.</div> : null}

        {!draft ? (
          <div className="text-sm text-muted-foreground">Select a strategy to edit.</div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
              <div>
                <label className="text-muted-foreground">Name</label>
                <input value={draft.name} onChange={(event) => updateDraft((prev) => ({ ...prev, name: event.target.value }))} className={editorFieldClass(Boolean(draftValidation?.name))} />
                {draftValidation?.name ? <div className={inlineErrorClass}>{draftValidation.name}</div> : null}
              </div>
              <div>
                <label className="text-muted-foreground">Execution Mode</label>
                <select value={draft.executionMode} onChange={(event) => updateDraft((prev) => ({ ...prev, executionMode: event.target.value as StrategyMode }))} className={editorFieldClass(false)}>
                  {MODE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-muted-foreground">Description</label>
                <textarea value={draft.description} onChange={(event) => updateDraft((prev) => ({ ...prev, description: event.target.value }))} className={editorFieldClass(false)} rows={2} />
              </div>
              <div>
                <label className="text-muted-foreground">Schedule Interval</label>
                <input value={draft.scheduleInterval} onChange={(event) => updateDraft((prev) => ({ ...prev, scheduleInterval: event.target.value }))} className={editorFieldClass(Boolean(draftValidation?.scheduleInterval))} placeholder="15m" />
                {draftValidation?.scheduleInterval ? <div className={inlineErrorClass}>{draftValidation.scheduleInterval}</div> : null}
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-foreground">
                  <input type="checkbox" checked={draft.isEnabled} onChange={(event) => updateDraft((prev) => ({ ...prev, isEnabled: event.target.checked }))} className="h-4 w-4" />
                  Enabled
                </label>
              </div>
            </div>

            <div className="rounded border border-border bg-secondary/20 p-3 space-y-3">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Strategy Composition</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
                <div>
                  <label className="text-muted-foreground">Composition Mode</label>
                  <select
                    value={draft.compositionMode}
                    onChange={(event) =>
                      updateDraft((prev) => ({ ...prev, compositionMode: event.target.value as StrategyCompositionMode }))
                    }
                    className={editorFieldClass(false)}
                  >
                    {COMPOSITION_MODE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="text-muted-foreground">Selected Base Strategies (comma separated ids)</label>
                  <input
                    value={draft.baseStrategiesCsv}
                    onChange={(event) => updateDraft((prev) => ({ ...prev, baseStrategiesCsv: event.target.value }))}
                    className={editorFieldClass(Boolean(draftValidation?.composition.baseStrategiesCsv))}
                    placeholder="momentum-rotation, volatility-hedge"
                  />
                  {draftValidation?.composition.baseStrategiesCsv ? (
                    <div className={inlineErrorClass}>{draftValidation.composition.baseStrategiesCsv}</div>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs font-mono text-foreground">
                <input
                  type="checkbox"
                  checked={draft.autoStrategyUsage}
                  onChange={(event) => updateDraft((prev) => ({ ...prev, autoStrategyUsage: event.target.checked }))}
                  className="h-4 w-4"
                />
                Auto Strategy Usage
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Strategy Weights</div>
                  <button
                    onClick={addStrategyWeightRow}
                    className="px-2 py-1 rounded border border-border text-xs font-mono text-foreground hover:bg-secondary"
                  >
                    Add Row
                  </button>
                </div>
                {draftValidation?.composition.strategyWeightRows ? (
                  <div className={inlineErrorClass}>{draftValidation.composition.strategyWeightRows}</div>
                ) : null}
                {draft.strategyWeightRows.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No strategy weights defined.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {draft.strategyWeightRows.map((row) => (
                      <div
                        key={row.id}
                        className="rounded border border-border bg-secondary/30 p-2 grid grid-cols-12 gap-2 items-end text-xs font-mono"
                      >
                        <div className="col-span-6">
                          <label className="text-muted-foreground">Strategy ID</label>
                          <input
                            value={row.strategyId}
                            onChange={(event) => updateStrategyWeightRow(row.id, { strategyId: event.target.value })}
                            className={editorFieldClass(Boolean(draftValidation?.strategyWeightRows[row.id]?.strategyId), true)}
                          />
                          {draftValidation?.strategyWeightRows[row.id]?.strategyId ? (
                            <div className={inlineErrorClass}>{draftValidation.strategyWeightRows[row.id]?.strategyId}</div>
                          ) : null}
                        </div>
                        <div className="col-span-4">
                          <label className="text-muted-foreground">Weight</label>
                          <input
                            value={row.weight}
                            onChange={(event) => updateStrategyWeightRow(row.id, { weight: event.target.value })}
                            className={editorFieldClass(Boolean(draftValidation?.strategyWeightRows[row.id]?.weight), true)}
                          />
                          {draftValidation?.strategyWeightRows[row.id]?.weight ? (
                            <div className={inlineErrorClass}>{draftValidation.strategyWeightRows[row.id]?.weight}</div>
                          ) : null}
                        </div>
                        <div className="col-span-2">
                          <button
                            onClick={() => removeStrategyWeightRow(row.id)}
                            className="w-full px-2 py-1.5 rounded border border-border text-xs font-mono text-foreground hover:bg-secondary"
                          >
                            Del
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs font-mono">
                <div>
                  <label className="text-muted-foreground">Min Strategy Score</label>
                  <input
                    value={draft.selectionConfig.minStrategyScore}
                    onChange={(event) =>
                      updateDraft((prev) => ({
                        ...prev,
                        selectionConfig: { ...prev.selectionConfig, minStrategyScore: event.target.value },
                      }))
                    }
                    className={editorFieldClass(Boolean(draftValidation?.composition.minStrategyScore))}
                  />
                  {draftValidation?.composition.minStrategyScore ? (
                    <div className={inlineErrorClass}>{draftValidation.composition.minStrategyScore}</div>
                  ) : null}
                </div>
                <div>
                  <label className="text-muted-foreground">Max Active Strategies</label>
                  <input
                    value={draft.selectionConfig.maxActiveStrategies}
                    onChange={(event) =>
                      updateDraft((prev) => ({
                        ...prev,
                        selectionConfig: { ...prev.selectionConfig, maxActiveStrategies: event.target.value },
                      }))
                    }
                    className={editorFieldClass(Boolean(draftValidation?.composition.maxActiveStrategies))}
                  />
                  {draftValidation?.composition.maxActiveStrategies ? (
                    <div className={inlineErrorClass}>{draftValidation.composition.maxActiveStrategies}</div>
                  ) : null}
                </div>
                <div>
                  <label className="text-muted-foreground">Max Weight Shift / Cycle</label>
                  <input
                    value={draft.selectionConfig.maxWeightShiftPerCycle}
                    onChange={(event) =>
                      updateDraft((prev) => ({
                        ...prev,
                        selectionConfig: { ...prev.selectionConfig, maxWeightShiftPerCycle: event.target.value },
                      }))
                    }
                    className={editorFieldClass(Boolean(draftValidation?.composition.maxWeightShiftPerCycle))}
                  />
                  {draftValidation?.composition.maxWeightShiftPerCycle ? (
                    <div className={inlineErrorClass}>{draftValidation.composition.maxWeightShiftPerCycle}</div>
                  ) : null}
                </div>
                <div>
                  <label className="text-muted-foreground">Strategy Cooldown (hours)</label>
                  <input
                    value={draft.selectionConfig.strategyCooldownHours}
                    onChange={(event) =>
                      updateDraft((prev) => ({
                        ...prev,
                        selectionConfig: { ...prev.selectionConfig, strategyCooldownHours: event.target.value },
                      }))
                    }
                    className={editorFieldClass(Boolean(draftValidation?.composition.strategyCooldownHours))}
                  />
                  {draftValidation?.composition.strategyCooldownHours ? (
                    <div className={inlineErrorClass}>{draftValidation.composition.strategyCooldownHours}</div>
                  ) : null}
                </div>
                <div>
                  <label className="text-muted-foreground">Min Active Duration (hours)</label>
                  <input
                    value={draft.selectionConfig.minActiveDurationHours}
                    onChange={(event) =>
                      updateDraft((prev) => ({
                        ...prev,
                        selectionConfig: { ...prev.selectionConfig, minActiveDurationHours: event.target.value },
                      }))
                    }
                    className={editorFieldClass(Boolean(draftValidation?.composition.minActiveDurationHours))}
                  />
                  {draftValidation?.composition.minActiveDurationHours ? (
                    <div className={inlineErrorClass}>{draftValidation.composition.minActiveDurationHours}</div>
                  ) : null}
                </div>
                <div>
                  <label className="text-muted-foreground">Fallback Strategy</label>
                  <input
                    value={draft.selectionConfig.fallbackStrategy}
                    onChange={(event) =>
                      updateDraft((prev) => ({
                        ...prev,
                        selectionConfig: { ...prev.selectionConfig, fallbackStrategy: event.target.value },
                      }))
                    }
                    className={editorFieldClass(Boolean(draftValidation?.composition.fallbackStrategy))}
                  />
                  {draftValidation?.composition.fallbackStrategy ? (
                    <div className={inlineErrorClass}>{draftValidation.composition.fallbackStrategy}</div>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs font-mono">
                <div>
                  <label className="text-muted-foreground">Score Power</label>
                  <input
                    value={draft.weightAdjustment.scorePower}
                    onChange={(event) =>
                      updateDraft((prev) => ({
                        ...prev,
                        weightAdjustment: { ...prev.weightAdjustment, scorePower: event.target.value },
                      }))
                    }
                    className={editorFieldClass(Boolean(draftValidation?.composition.scorePower))}
                  />
                  {draftValidation?.composition.scorePower ? (
                    <div className={inlineErrorClass}>{draftValidation.composition.scorePower}</div>
                  ) : null}
                </div>
                <div>
                  <label className="text-muted-foreground">Min Weight % / Strategy</label>
                  <input
                    value={draft.weightAdjustment.minWeightPctPerStrategy}
                    onChange={(event) =>
                      updateDraft((prev) => ({
                        ...prev,
                        weightAdjustment: { ...prev.weightAdjustment, minWeightPctPerStrategy: event.target.value },
                      }))
                    }
                    className={editorFieldClass(Boolean(draftValidation?.composition.minWeightPctPerStrategy))}
                  />
                  {draftValidation?.composition.minWeightPctPerStrategy ? (
                    <div className={inlineErrorClass}>{draftValidation.composition.minWeightPctPerStrategy}</div>
                  ) : null}
                </div>
                <div>
                  <label className="text-muted-foreground">Max Weight % / Strategy</label>
                  <input
                    value={draft.weightAdjustment.maxWeightPctPerStrategy}
                    onChange={(event) =>
                      updateDraft((prev) => ({
                        ...prev,
                        weightAdjustment: { ...prev.weightAdjustment, maxWeightPctPerStrategy: event.target.value },
                      }))
                    }
                    className={editorFieldClass(Boolean(draftValidation?.composition.maxWeightPctPerStrategy))}
                  />
                  {draftValidation?.composition.maxWeightPctPerStrategy ? (
                    <div className={inlineErrorClass}>{draftValidation.composition.maxWeightPctPerStrategy}</div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
              <div>
                <label className="text-muted-foreground">Risk Level</label>
                <select value={draft.metadataRiskLevel} onChange={(event) => updateDraft((prev) => ({ ...prev, metadataRiskLevel: event.target.value }))} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none">
                  {RISK_OPTIONS.map((option) => <option key={option} value={option}>{option || "--"}</option>)}
                </select>
              </div>
              <div>
                <label className="text-muted-foreground">Expected Turnover</label>
                <select value={draft.metadataExpectedTurnover} onChange={(event) => updateDraft((prev) => ({ ...prev, metadataExpectedTurnover: event.target.value }))} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none">
                  {TURNOVER_OPTIONS.map((option) => <option key={option} value={option}>{option || "--"}</option>)}
                </select>
              </div>
              <div>
                <label className="text-muted-foreground">Stablecoin Exposure</label>
                <select value={draft.metadataStablecoinExposure} onChange={(event) => updateDraft((prev) => ({ ...prev, metadataStablecoinExposure: event.target.value }))} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none">
                  {STABLE_EXPOSURE_OPTIONS.map((option) => <option key={option} value={option}>{option || "--"}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-xs font-mono">
              <div>
                <label className="text-muted-foreground">Max Single %</label>
                <input
                  value={draft.guards.maxSingleAssetPct}
                  onChange={(event) => updateDraft((prev) => ({ ...prev, guards: { ...prev.guards, maxSingleAssetPct: event.target.value } }))}
                  className={editorFieldClass(Boolean(draftValidation?.guards.maxSingleAssetPct))}
                />
                {draftValidation?.guards.maxSingleAssetPct ? <div className={inlineErrorClass}>{draftValidation.guards.maxSingleAssetPct}</div> : null}
              </div>
              <div>
                <label className="text-muted-foreground">Min Stable %</label>
                <input
                  value={draft.guards.minStablecoinPct}
                  onChange={(event) => updateDraft((prev) => ({ ...prev, guards: { ...prev.guards, minStablecoinPct: event.target.value } }))}
                  className={editorFieldClass(Boolean(draftValidation?.guards.minStablecoinPct))}
                />
                {draftValidation?.guards.minStablecoinPct ? <div className={inlineErrorClass}>{draftValidation.guards.minStablecoinPct}</div> : null}
              </div>
              <div>
                <label className="text-muted-foreground">Max Trades</label>
                <input
                  value={draft.guards.maxTradesPerCycle}
                  onChange={(event) => updateDraft((prev) => ({ ...prev, guards: { ...prev.guards, maxTradesPerCycle: event.target.value } }))}
                  className={editorFieldClass(Boolean(draftValidation?.guards.maxTradesPerCycle))}
                />
                {draftValidation?.guards.maxTradesPerCycle ? <div className={inlineErrorClass}>{draftValidation.guards.maxTradesPerCycle}</div> : null}
              </div>
              <div>
                <label className="text-muted-foreground">Min Notional</label>
                <input
                  value={draft.guards.minTradeNotional}
                  onChange={(event) => updateDraft((prev) => ({ ...prev, guards: { ...prev.guards, minTradeNotional: event.target.value } }))}
                  className={editorFieldClass(Boolean(draftValidation?.guards.minTradeNotional))}
                />
                {draftValidation?.guards.minTradeNotional ? <div className={inlineErrorClass}>{draftValidation.guards.minTradeNotional}</div> : null}
              </div>
              <div>
                <label className="text-muted-foreground">Cash Reserve %</label>
                <input
                  value={draft.guards.cashReservePct}
                  onChange={(event) => updateDraft((prev) => ({ ...prev, guards: { ...prev.guards, cashReservePct: event.target.value } }))}
                  className={editorFieldClass(Boolean(draftValidation?.guards.cashReservePct))}
                />
                {draftValidation?.guards.cashReservePct ? <div className={inlineErrorClass}>{draftValidation.guards.cashReservePct}</div> : null}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Base Allocation</div>
                <button onClick={addAllocationRow} className="px-2 py-1 rounded border border-border text-xs font-mono text-foreground hover:bg-secondary">Add Row</button>
              </div>
              {draftValidation?.baseAllocation ? <div className={inlineErrorClass}>{draftValidation.baseAllocation}</div> : null}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {draft.baseAllocationRows.map((row) => (
                  <div key={row.id} className="rounded border border-border bg-secondary/30 p-2 grid grid-cols-12 gap-2 items-end text-xs font-mono">
                    <div className="col-span-5">
                      <label className="text-muted-foreground">Symbol</label>
                      <input
                        value={row.symbol}
                        onChange={(event) => updateAllocationRow(row.id, { symbol: event.target.value })}
                        className={editorFieldClass(Boolean(draftValidation?.baseAllocationRows[row.id]?.symbol), true)}
                      />
                      {draftValidation?.baseAllocationRows[row.id]?.symbol ? <div className={inlineErrorClass}>{draftValidation.baseAllocationRows[row.id]?.symbol}</div> : null}
                    </div>
                    <div className="col-span-5">
                      <label className="text-muted-foreground">Percent</label>
                      <input
                        value={row.percent}
                        onChange={(event) => updateAllocationRow(row.id, { percent: event.target.value })}
                        className={editorFieldClass(Boolean(draftValidation?.baseAllocationRows[row.id]?.percent), true)}
                      />
                      {draftValidation?.baseAllocationRows[row.id]?.percent ? <div className={inlineErrorClass}>{draftValidation.baseAllocationRows[row.id]?.percent}</div> : null}
                    </div>
                    <div className="col-span-2"><button onClick={() => removeAllocationRow(row.id)} disabled={draft.baseAllocationRows.length <= 1} className="w-full px-2 py-1.5 rounded border border-border text-xs font-mono text-foreground hover:bg-secondary disabled:opacity-50">Del</button></div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-mono text-muted-foreground">Disabled Assets (comma separated)</label>
              <input
                value={draft.disabledAssetsCsv}
                onChange={(event) => updateDraft((prev) => ({ ...prev, disabledAssetsCsv: event.target.value }))}
                className={cn(editorFieldClass(Boolean(draftValidation?.disabledAssetsCsv)), "text-xs font-mono")}
                placeholder="DOGE, SHIB"
              />
              {draftValidation?.disabledAssetsCsv ? <div className={inlineErrorClass}>{draftValidation.disabledAssetsCsv}</div> : null}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Rules</div>
                <button onClick={addRule} className="px-2 py-1 rounded border border-border text-xs font-mono text-foreground hover:bg-secondary">Add Rule</button>
              </div>

              {draft.rules.length === 0 ? (
                <div className="text-sm text-muted-foreground">No rules defined.</div>
              ) : (
                <div className="space-y-2">
                  {draft.rules.map((rule, index) => {
                    const ruleErrors = draftValidation?.rules[String(index)];

                    return (
                    <div key={rule.id} className="rounded border border-border bg-secondary/30 p-3 space-y-2 text-xs font-mono">
                      <div className="flex items-center justify-between">
                        <div className="text-foreground">Rule {index + 1}</div>
                        <button onClick={() => removeRule(rule.id)} className="px-2 py-1 rounded border border-border text-xs font-mono text-foreground hover:bg-secondary">Remove</button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                        <div>
                          <label className="text-muted-foreground">ID</label>
                          <input value={rule.id} onChange={(event) => updateRule(rule.id, { id: event.target.value })} className={editorFieldClass(Boolean(ruleErrors?.id), true)} />
                          {ruleErrors?.id ? <div className={inlineErrorClass}>{ruleErrors.id}</div> : null}
                        </div>
                        <div><label className="text-muted-foreground">Name</label><input value={rule.name} onChange={(event) => updateRule(rule.id, { name: event.target.value })} className={editorFieldClass(false, true)} /></div>
                        <div>
                          <label className="text-muted-foreground">Priority</label>
                          <input value={rule.priority} onChange={(event) => updateRule(rule.id, { priority: event.target.value })} className={editorFieldClass(Boolean(ruleErrors?.priority), true)} />
                          {ruleErrors?.priority ? <div className={inlineErrorClass}>{ruleErrors.priority}</div> : null}
                        </div>
                        <div className="md:col-span-2 flex items-end"><label className="inline-flex items-center gap-2"><input type="checkbox" checked={rule.enabled} onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })} /> Enabled</label></div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                        <div><label className="text-muted-foreground">Indicator</label><select value={rule.conditionIndicator} onChange={(event) => updateRule(rule.id, { conditionIndicator: event.target.value })} className={editorFieldClass(false, true)}>{INDICATOR_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
                        <div><label className="text-muted-foreground">Operator</label><select value={rule.conditionOperator} onChange={(event) => updateRule(rule.id, { conditionOperator: event.target.value })} className={editorFieldClass(false, true)}>{OPERATOR_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
                        <div>
                          <label className="text-muted-foreground">Value</label>
                          <input value={rule.conditionValue} onChange={(event) => updateRule(rule.id, { conditionValue: event.target.value })} className={editorFieldClass(Boolean(ruleErrors?.conditionValue), true)} />
                          {ruleErrors?.conditionValue ? <div className={inlineErrorClass}>{ruleErrors.conditionValue}</div> : null}
                        </div>
                        <div><label className="text-muted-foreground">Condition Asset</label><input value={rule.conditionAsset} onChange={(event) => updateRule(rule.id, { conditionAsset: event.target.value })} className={editorFieldClass(false, true)} /></div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                        <div><label className="text-muted-foreground">Action</label><select value={rule.actionType} onChange={(event) => updateRule(rule.id, { actionType: event.target.value })} className={editorFieldClass(false, true)}>{ACTION_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
                        <div>
                          <label className="text-muted-foreground">Percent</label>
                          <input value={rule.actionPercent} onChange={(event) => updateRule(rule.id, { actionPercent: event.target.value })} className={editorFieldClass(Boolean(ruleErrors?.actionPercent), true)} />
                          {ruleErrors?.actionPercent ? <div className={inlineErrorClass}>{ruleErrors.actionPercent}</div> : null}
                        </div>
                        <div>
                          <label className="text-muted-foreground">Action Asset</label>
                          <input value={rule.actionAsset} onChange={(event) => updateRule(rule.id, { actionAsset: event.target.value })} className={editorFieldClass(Boolean(ruleErrors?.actionAsset), true)} />
                          {ruleErrors?.actionAsset ? <div className={inlineErrorClass}>{ruleErrors.actionAsset}</div> : null}
                        </div>
                        <div>
                          <label className="text-muted-foreground">From</label>
                          <input value={rule.actionFrom} onChange={(event) => updateRule(rule.id, { actionFrom: event.target.value })} className={editorFieldClass(Boolean(ruleErrors?.actionFrom), true)} />
                          {ruleErrors?.actionFrom ? <div className={inlineErrorClass}>{ruleErrors.actionFrom}</div> : null}
                        </div>
                        <div>
                          <label className="text-muted-foreground">To</label>
                          <input value={rule.actionTo} onChange={(event) => updateRule(rule.id, { actionTo: event.target.value })} className={editorFieldClass(Boolean(ruleErrors?.actionTo), true)} />
                          {ruleErrors?.actionTo ? <div className={inlineErrorClass}>{ruleErrors.actionTo}</div> : null}
                        </div>
                      </div>
                    </div>
                  );
                  })}
                </div>
              )}
            </div>
          </>
        )}
          </div>
        </div>
      ) : null}

      {isDemoBalanceModalOpen ? (
        <div className="fixed inset-0 z-50 bg-background/75 p-4" onClick={() => setIsDemoBalanceModalOpen(false)}>
          <div
            className="mx-auto w-full max-w-md rounded-lg border border-border bg-card p-4 space-y-3"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Edit Demo Balance</div>
                <div className="mt-1 text-xs font-mono text-muted-foreground">Set dummy USD funds used by demo strategy runs.</div>
              </div>
              <button
                onClick={() => setIsDemoBalanceModalOpen(false)}
                className="px-3 py-1.5 rounded-md border border-border text-xs font-mono text-foreground hover:bg-secondary"
              >
                Close
              </button>
            </div>

            <div>
              <label className="text-xs font-mono text-muted-foreground">Amount (USD$)</label>
              <input
                value={demoBalanceDraft}
                onChange={(event) => setDemoBalanceDraft(event.target.value)}
                className={cn(
                  "mt-1 w-full rounded border bg-secondary px-2 py-2 text-sm font-mono text-foreground outline-none",
                  !demoBalanceDraft || (Number.isFinite(demoBalanceParsed) && demoBalanceParsed > 0)
                    ? "border-border"
                    : "border-negative"
                )}
                placeholder="10000"
                disabled={loadingDemoAccount || updateDemoBalanceMutation.isPending}
              />
            </div>

            <div className="text-xs font-mono text-muted-foreground">
              Current saved: {formatUsdToken(demoBalanceCurrent)}
              {demoAccountData?.demoAccount.updatedAt ? `  |  Updated: ${formatDateTime(demoAccountData.demoAccount.updatedAt)}` : ""}
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleSaveDemoBalance}
                disabled={
                  loadingDemoAccount ||
                  updateDemoBalanceMutation.isPending ||
                  !Number.isFinite(demoBalanceParsed) ||
                  demoBalanceParsed <= 0 ||
                  !demoBalanceDirty
                }
                className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-mono font-semibold hover:opacity-90 disabled:opacity-60"
              >
                Save Demo Balance
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isRunDetailsModalOpen ? (
        <div className="fixed inset-0 z-50 bg-background/75 p-4" onClick={closeRunDetails}>
          <div className="mx-auto max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-lg border border-border bg-card p-4 space-y-3" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Run Details</div>
                <div className="mt-1 text-xs font-mono text-foreground">{selectedRun?.strategyId ?? "--"}</div>
              </div>
              <button onClick={closeRunDetails} className="px-3 py-1.5 rounded-md border border-border text-xs font-mono text-foreground hover:bg-secondary">
                Close
              </button>
            </div>

            {loadingRunDetails ? (
              <div className="text-sm text-muted-foreground">Loading selected run details...</div>
            ) : !selectedRun ? (
              <div className="text-sm text-muted-foreground">Select a run to inspect.</div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs font-mono">
                  <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Status</div><div className="mt-1 text-foreground">{selectedRun.status}</div></div>
                  <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Mode</div><div className="mt-1 text-foreground">{selectedRun.mode}</div></div>
                  <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Account</div><div className="mt-1 text-foreground">{selectedRun.accountType}</div></div>
                  <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Trigger</div><div className="mt-1 text-foreground">{selectedRun.trigger}</div></div>
                  <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Duration</div><div className="mt-1 text-foreground">{formatDuration(selectedRun.startedAt, selectedRun.completedAt)}</div></div>
                </div>

                {selectedRun.error ? <div className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-xs text-negative font-mono">{selectedRun.error}</div> : null}

                {selectedRun.warnings.length > 0 ? (
                  <div className="space-y-1">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Warnings</div>
                    {selectedRun.warnings.map((warning, index) => <div key={`${warning}-${index}`} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground font-mono">{warning}</div>)}
                  </div>
                ) : null}

                {selectedRun.inputSnapshot ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
                    <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Portfolio</div><div className="mt-1 text-foreground">{selectedRun.inputSnapshot.portfolio.totalValue.toLocaleString("en-US", { style: "currency", currency: "USD" })}</div></div>
                    <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Assets</div><div className="mt-1 text-foreground">{selectedRun.inputSnapshot.portfolio.assets.length}</div></div>
                    <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Volatility</div><div className="mt-1 text-foreground">{(runIndicators.volatility ?? 0).toFixed(4)}</div></div>
                    <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">BTC Dom</div><div className="mt-1 text-foreground">{(runIndicators.btc_dominance ?? 0).toFixed(4)}</div></div>
                  </div>
                ) : null}

                {selectedRun.adjustedAllocation ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {Object.entries(selectedRun.adjustedAllocation).sort(([left], [right]) => left.localeCompare(right)).map(([symbol, value]) => (
                      <div key={symbol} className="rounded border border-border bg-secondary/30 p-2 text-xs font-mono"><div className="text-muted-foreground">{symbol}</div><div className="mt-1 text-foreground">{value.toFixed(2)}%</div></div>
                    ))}
                  </div>
                ) : null}

                {selectedRunExecutionPlan ? (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
                      <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Rebalance</div><div className="mt-1 text-foreground">{selectedRunExecutionPlan.rebalanceRequired ? "Yes" : "No"}</div></div>
                      <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Drift</div><div className="mt-1 text-foreground">{selectedRunExecutionPlan.driftPct.toFixed(2)}%</div></div>
                      <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Turnover</div><div className="mt-1 text-foreground">{selectedRunExecutionPlan.estimatedTurnoverPct.toFixed(2)}%</div></div>
                      <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Trades</div><div className="mt-1 text-foreground">{selectedRunExecutionPlan.recommendedTrades.length}</div></div>
                    </div>

                    <div className="rounded border border-border overflow-hidden">
                      <div className="px-3 py-2 border-b border-border text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Execution Trades</div>
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-border">
                            {["Asset", "Side", "Current %", "Target %", "Notional", "Reason"].map((heading) => (
                              <th key={heading} className="py-2 px-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground text-right first:text-left">{heading}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {selectedRunExecutionPlan.recommendedTrades.length === 0 ? (
                            <tr><td colSpan={6} className="px-3 py-3 text-center text-xs text-muted-foreground">No trade actions for this run.</td></tr>
                          ) : (
                            selectedRunExecutionPlan.recommendedTrades.map((trade, index) => (
                              <tr key={`${trade.asset}-${trade.side}-${index}`} className="border-b border-border">
                                <td className="py-2 px-3 text-left text-xs font-mono text-foreground">{trade.asset}</td>
                                <td className="py-2 px-3 text-right text-xs font-mono text-foreground">{trade.side}</td>
                                <td className="py-2 px-3 text-right text-xs font-mono text-foreground">{trade.currentPercent.toFixed(2)}%</td>
                                <td className="py-2 px-3 text-right text-xs font-mono text-foreground">{trade.targetPercent.toFixed(2)}%</td>
                                <td className="py-2 px-3 text-right text-xs font-mono text-foreground">{trade.amountNotional.toLocaleString("en-US", { style: "currency", currency: "USD" })}</td>
                                <td className="py-2 px-3 text-right text-xs font-mono text-muted-foreground">{trade.reason}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Strategy Runs</div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Started", "Strategy", "Account", "Status", "Trigger", "Completed", "Duration", "Warn", "Actions"].map((heading) => (
                  <th key={heading} className="py-3 px-4 text-[10px] font-mono uppercase tracking-wider text-muted-foreground text-right first:text-left">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingRuns ? (
                <tr><td colSpan={9} className="px-4 py-6 text-center text-sm text-muted-foreground">Loading runs...</td></tr>
              ) : runs.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-6 text-center text-sm text-muted-foreground">No runs yet.</td></tr>
              ) : (
                runs.slice(0, 12).map((run) => (
                  <tr
                    key={run.id}
                    className={cn("border-b border-border cursor-pointer", run.id === selectedRunId ? "bg-secondary/40" : "hover:bg-secondary/20")}
                    onClick={() => setSelectedRunId(run.id)}
                  >
                    <td className="py-3 px-4 text-left text-xs font-mono text-muted-foreground">{formatDateTime(run.startedAt)}</td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-foreground">{run.strategyId}</td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-foreground">{run.accountType}</td>
                    <td className="py-3 px-4 text-right text-xs font-mono"><span className={run.status === "completed" ? "text-positive" : run.status === "failed" ? "text-negative" : "text-muted-foreground"}>{run.status}</span></td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-foreground">{run.trigger}</td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-muted-foreground">{formatDateTime(run.completedAt)}</td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-foreground">{formatDuration(run.startedAt, run.completedAt)}</td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-foreground">{run.warnings.length}</td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-foreground">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          openRunDetails(run.id);
                        }}
                        className="px-2 py-1 rounded border border-border text-[11px] font-mono text-foreground hover:bg-secondary"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="border-t border-border px-4 py-3 text-xs font-mono text-muted-foreground">
            Use <span className="text-foreground">View</span> on a run row to open detailed results.
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Backtest Runner</div>
          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div><label className="text-muted-foreground">Start Date</label><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none" disabled={busy} /></div>
            <div><label className="text-muted-foreground">End Date</label><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none" disabled={busy} /></div>
            <div><label className="text-muted-foreground">Initial Capital</label><input value={initialCapital} onChange={(event) => setInitialCapital(event.target.value)} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none" disabled={busy} /></div>
            <div><label className="text-muted-foreground">Timeframe</label><select value={timeframe} onChange={(event) => setTimeframe(event.target.value as "1h" | "1d")} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none" disabled={busy}><option value="1d">1d</option><option value="1h">1h</option></select></div>
            <div><label className="text-muted-foreground">Rebalance Cost %</label><input value={rebalanceCostsPct} onChange={(event) => setRebalanceCostsPct(event.target.value)} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none" disabled={busy} /></div>
            <div><label className="text-muted-foreground">Slippage %</label><input value={slippagePct} onChange={(event) => setSlippagePct(event.target.value)} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none" disabled={busy} /></div>
          </div>
          <button onClick={handleBacktestCreate} disabled={busy || !selectedStrategy} className="w-full rounded-md bg-primary px-4 py-2.5 text-xs font-mono font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">Start Backtest</button>

          <div className="rounded border border-border overflow-hidden">
            <div className="px-3 py-2 border-b border-border text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Recent Backtests</div>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full">
                <thead><tr className="border-b border-border">{["Created", "Strategy", "Status", "Return %"].map((heading) => <th key={heading} className="py-2 px-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground text-right first:text-left">{heading}</th>)}</tr></thead>
                <tbody>
                  {loadingBacktests ? (
                    <tr><td colSpan={4} className="px-3 py-4 text-center text-xs text-muted-foreground">Loading backtests...</td></tr>
                  ) : backtests.length === 0 ? (
                    <tr><td colSpan={4} className="px-3 py-4 text-center text-xs text-muted-foreground">No backtests yet.</td></tr>
                  ) : (
                    backtests.slice(0, 10).map((run) => (
                      <tr key={run.id} className="border-b border-border">
                        <td className="py-2 px-3 text-left text-xs font-mono text-muted-foreground">{formatDateTime(run.createdAt)}</td>
                        <td className="py-2 px-3 text-right text-xs font-mono text-foreground">{run.strategyId}</td>
                        <td className="py-2 px-3 text-right text-xs font-mono text-foreground">{run.status}</td>
                        <td className="py-2 px-3 text-right text-xs font-mono text-foreground">{typeof run.totalReturnPct === "number" ? `${run.totalReturnPct.toFixed(2)}%` : "--"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground">
        {busy ? <SpinnerValue loading value={undefined} /> : "Scheduler, strategy runs, and backtests auto-refresh every 20-30 seconds."}
      </div>
    </div>
  );
}

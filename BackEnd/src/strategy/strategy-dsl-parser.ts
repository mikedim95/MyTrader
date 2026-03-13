import { z } from "zod";
import {
  LegacyStrategyMode,
  StrategyActionType,
  StrategyConfig,
  StrategyCondition,
  StrategyCompositionMode,
  StrategyGuardConfig,
  StrategyMode,
  StrategyRule,
  LEGACY_STRATEGY_MODES,
  STRATEGY_ACTION_TYPES,
  STRATEGY_COMPOSITION_MODES,
  STRATEGY_INDICATORS,
  STRATEGY_MODES,
  STRATEGY_OPERATORS,
} from "./types.js";
import { normalizeAllocation, toUpperSymbol } from "./allocation-utils.js";
import { getBasicStrategyIds } from "./strategy-catalog.js";

const baseAllocationSchema = z.record(z.string(), z.number().finite().min(0));

const conditionSchema = z.object({
  indicator: z.enum(STRATEGY_INDICATORS),
  operator: z.enum(STRATEGY_OPERATORS),
  value: z.number().finite(),
  asset: z.string().min(1).optional(),
});

const actionSchema = z
  .object({
    type: z.enum(STRATEGY_ACTION_TYPES),
    asset: z.string().min(1).optional(),
    from: z.string().min(1).optional(),
    to: z.string().min(1).optional(),
    percent: z.number().finite().positive().max(100),
  })
  .superRefine((value, ctx) => {
    if ((value.type === "increase" || value.type === "decrease") && !value.asset) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Action types increase/decrease require an asset.",
        path: ["asset"],
      });
    }

    if (value.type === "shift" && (!value.from || !value.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Action type shift requires from and to.",
        path: ["from"],
      });
    }
  });

const ruleSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  priority: z.number().int().min(1),
  enabled: z.boolean().default(true),
  condition: conditionSchema,
  action: actionSchema,
});

const guardsSchema = z
  .object({
    max_single_asset_pct: z.number().finite().min(0).max(100).optional(),
    min_stablecoin_pct: z.number().finite().min(0).max(100).optional(),
    max_trades_per_cycle: z.number().int().min(1).max(200).optional(),
    min_trade_notional: z.number().finite().positive().optional(),
    cash_reserve_pct: z.number().finite().min(0).max(100).optional(),
  })
  .default({});

const metadataSchema = z
  .object({
    riskLevel: z.enum(["low", "medium", "high"]).optional(),
    expectedTurnover: z.enum(["low", "medium", "high"]).optional(),
    stablecoinExposure: z.enum(["low", "medium", "high"]).optional(),
    tags: z.array(z.string()).optional(),
  })
  .optional();

const strategyWeightsSchema = z.record(z.string().min(1), z.number().finite().min(0).max(100)).default({});

const strategySelectionConfigSchema = z
  .object({
    minStrategyScore: z.number().finite().min(0).max(1).optional(),
    maxActiveStrategies: z.number().int().min(1).max(20).optional(),
    maxWeightShiftPerCycle: z.number().finite().min(0).max(100).optional(),
    strategyCooldownHours: z.number().int().min(0).max(720).optional(),
    minActiveDurationHours: z.number().int().min(0).max(720).optional(),
    fallbackStrategy: z.string().min(1).optional(),
  })
  .default({});

const weightAdjustmentConfigSchema = z
  .object({
    scorePower: z.number().finite().min(0.1).max(5).optional(),
    minWeightPctPerStrategy: z.number().finite().min(0).max(100).optional(),
    maxWeightPctPerStrategy: z.number().finite().min(0).max(100).optional(),
  })
  .default({});

const strategyModeSchema = z.enum([...STRATEGY_MODES, ...LEGACY_STRATEGY_MODES] as const);

export const strategyDslSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  baseAllocation: baseAllocationSchema,
  rules: z.array(ruleSchema).default([]),
  guards: guardsSchema,
  executionMode: strategyModeSchema.default("manual"),
  metadata: metadataSchema,
  isEnabled: z.boolean().optional(),
  scheduleInterval: z.string().regex(/^\d+(s|m|h|d)$/i).optional(),
  lastRunAt: z.string().datetime().optional(),
  nextRunAt: z.string().datetime().optional(),
  disabledAssets: z.array(z.string().min(1)).optional(),
  compositionMode: z.enum(STRATEGY_COMPOSITION_MODES).default("manual"),
  baseStrategies: z.array(z.string().min(1)).optional(),
  allowedBaseStrategies: z.array(z.string().min(1)).optional(),
  strategyWeights: strategyWeightsSchema,
  autoStrategyUsage: z.boolean().default(false),
  strategySelectionConfig: strategySelectionConfigSchema,
  weightAdjustmentConfig: weightAdjustmentConfigSchema,
});

export type StrategyDslInput = z.infer<typeof strategyDslSchema>;

export interface DslValidationResult {
  success: boolean;
  data?: StrategyConfig;
  errors?: string[];
}

function normalizeCondition(input: StrategyCondition): StrategyCondition {
  return {
    ...input,
    asset: input.asset ? toUpperSymbol(input.asset) : undefined,
  };
}

function normalizeRule(rule: z.infer<typeof ruleSchema>, index: number): StrategyRule {
  const id = rule.id?.trim() ? rule.id.trim() : `rule-${index + 1}`;
  const actionType = rule.action.type as StrategyActionType;

  return {
    id,
    name: rule.name,
    priority: rule.priority,
    enabled: rule.enabled,
    condition: normalizeCondition(rule.condition),
    action: {
      type: actionType,
      asset: rule.action.asset ? toUpperSymbol(rule.action.asset) : undefined,
      from: rule.action.from ? toUpperSymbol(rule.action.from) : undefined,
      to: rule.action.to ? toUpperSymbol(rule.action.to) : undefined,
      percent: rule.action.percent,
    },
  };
}

function normalizeGuards(guards: StrategyGuardConfig): StrategyGuardConfig {
  return {
    max_single_asset_pct: guards.max_single_asset_pct,
    min_stablecoin_pct: guards.min_stablecoin_pct,
    max_trades_per_cycle: guards.max_trades_per_cycle,
    min_trade_notional: guards.min_trade_notional,
    cash_reserve_pct: guards.cash_reserve_pct,
  };
}

function normalizeCompositionMode(mode: StrategyCompositionMode | undefined): StrategyCompositionMode {
  return mode === "automatic" ? "automatic" : "manual";
}

function normalizeExecutionMode(mode: StrategyMode | LegacyStrategyMode | undefined): StrategyMode {
  if (mode === "semi_auto") return "hybrid";
  if (mode === "auto") return "automatic";
  if (mode === "hybrid" || mode === "automatic") return mode;
  return "manual";
}

function normalizeBaseStrategies(baseStrategies: string[] | undefined): string[] {
  if (!Array.isArray(baseStrategies)) return [];

  return Array.from(
    new Set(
      baseStrategies
        .map((strategyId) => strategyId.trim().toLowerCase())
        .filter((strategyId) => strategyId.length > 0)
    )
  );
}

function normalizeStrategyWeights(weights: Record<string, number> | undefined): Record<string, number> {
  if (!weights) return {};
  const normalized: Record<string, number> = {};

  Object.entries(weights).forEach(([strategyId, raw]) => {
    const key = strategyId.trim().toLowerCase();
    if (!key) return;
    if (!Number.isFinite(raw) || raw < 0) return;
    normalized[key] = raw;
  });

  return normalized;
}

function normalizeBaseAllocation(baseAllocation: Record<string, number>): Record<string, number> {
  const normalized: Record<string, number> = {};
  Object.entries(baseAllocation).forEach(([symbol, value]) => {
    normalized[toUpperSymbol(symbol)] = value;
  });

  return normalizeAllocation(normalized);
}

function collectSchemaErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });
}

function ensureRulePriorityOrder(rules: StrategyRule[]): StrategyRule[] {
  return [...rules].sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    return left.id.localeCompare(right.id);
  });
}

function buildStrategyId(inputName: string): string {
  return inputName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function validateStrategyDsl(input: unknown, nowIso = new Date().toISOString()): DslValidationResult {
  const parsed = strategyDslSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      errors: collectSchemaErrors(parsed.error),
    };
  }

  const normalizedRules = ensureRulePriorityOrder(parsed.data.rules.map((rule, index) => normalizeRule(rule, index)));

  const strategyId = parsed.data.id?.trim() ? parsed.data.id.trim() : buildStrategyId(parsed.data.name);
  if (!strategyId) {
    return {
      success: false,
      errors: ["Strategy id cannot be empty."],
    };
  }

  const baseAllocationBySymbol: Record<string, number> = {};
  const seenRawSymbols = new Set<string>();
  const duplicateSymbols = new Set<string>();
  Object.entries(parsed.data.baseAllocation).forEach(([symbol, value]) => {
    const normalizedSymbol = toUpperSymbol(symbol);
    if (seenRawSymbols.has(normalizedSymbol)) {
      duplicateSymbols.add(normalizedSymbol);
    }
    seenRawSymbols.add(normalizedSymbol);
    baseAllocationBySymbol[normalizedSymbol] = (baseAllocationBySymbol[normalizedSymbol] ?? 0) + value;
  });

  const baseAllocationTotal = Object.values(baseAllocationBySymbol).reduce((sum, value) => sum + value, 0);
  const selectedOrAllowedBaseStrategies = normalizeBaseStrategies(
    parsed.data.allowedBaseStrategies ?? parsed.data.baseStrategies
  );
  const normalizedWeights = normalizeStrategyWeights(parsed.data.strategyWeights);
  const fallbackStrategy = parsed.data.strategySelectionConfig.fallbackStrategy?.trim().toLowerCase();
  const basicCatalogIds = getBasicStrategyIds();
  const basicCatalogCount = basicCatalogIds.length;
  const basicCatalogSet = new Set(basicCatalogIds);

  let executionMode = normalizeExecutionMode(parsed.data.executionMode);
  if (executionMode === "automatic" && selectedOrAllowedBaseStrategies.length > 0) {
    executionMode = "hybrid";
  }

  const errors: string[] = [];
  if (duplicateSymbols.size > 0) {
    errors.push(`Duplicate base allocation symbols: ${Array.from(duplicateSymbols).sort().join(", ")}.`);
  }
  if (Math.abs(baseAllocationTotal - 100) > 0.0001) {
    errors.push("Base allocation must total exactly 100%.");
  }

  const requiresAllowedPool = executionMode === "manual" || executionMode === "hybrid";
  const usesAutomationControls = executionMode !== "manual";
  if (requiresAllowedPool && selectedOrAllowedBaseStrategies.length === 0) {
    errors.push(
      executionMode === "manual"
        ? "Manual mode requires at least one selected base strategy."
        : "Hybrid mode requires at least one allowed base strategy."
    );
  }

  if (usesAutomationControls) {
    if (fallbackStrategy && requiresAllowedPool && !selectedOrAllowedBaseStrategies.includes(fallbackStrategy)) {
      errors.push("Fallback strategy must belong to the selected/allowed strategy list.");
    }
    if (fallbackStrategy && executionMode === "automatic" && !basicCatalogSet.has(fallbackStrategy)) {
      errors.push("Fallback strategy must be a basic strategy id in automatic mode.");
    }

    const maxActiveStrategies = parsed.data.strategySelectionConfig.maxActiveStrategies;
    if (typeof maxActiveStrategies === "number") {
      if (executionMode === "automatic" && maxActiveStrategies > basicCatalogCount) {
        errors.push(`Max active strategies cannot exceed the basic strategy catalog size (${basicCatalogCount}).`);
      }
      if (
        requiresAllowedPool &&
        selectedOrAllowedBaseStrategies.length > 0 &&
        maxActiveStrategies > selectedOrAllowedBaseStrategies.length
      ) {
        errors.push("Max active strategies cannot exceed selected/allowed base strategies.");
      }
    }

    const minWeight = parsed.data.weightAdjustmentConfig.minWeightPctPerStrategy;
    const maxWeight = parsed.data.weightAdjustmentConfig.maxWeightPctPerStrategy;
    if (typeof minWeight === "number" && typeof maxWeight === "number" && minWeight > maxWeight) {
      errors.push("Min weight % per strategy cannot exceed max weight % per strategy.");
    }
  }

  const minStablePct = parsed.data.guards.min_stablecoin_pct ?? 0;
  const cashReservePct = parsed.data.guards.cash_reserve_pct ?? 0;
  if (minStablePct + cashReservePct > 100) {
    errors.push("Min stable % plus cash reserve % cannot exceed 100.");
  }

  if (requiresAllowedPool) {
    const invalidWeightIds = Object.keys(normalizedWeights).filter(
      (strategyId) => !selectedOrAllowedBaseStrategies.includes(strategyId)
    );
    if (invalidWeightIds.length > 0) {
      errors.push(`Strategy weights reference strategies outside selected/allowed pool: ${invalidWeightIds.join(", ")}.`);
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      errors,
    };
  }

  const normalized: StrategyConfig = {
    id: strategyId,
    name: parsed.data.name.trim(),
    description: parsed.data.description?.trim() || undefined,
    baseAllocation: normalizeBaseAllocation(baseAllocationBySymbol),
    rules: normalizedRules,
    guards: normalizeGuards(parsed.data.guards),
    executionMode,
    metadata: parsed.data.metadata,
    isEnabled: parsed.data.isEnabled ?? false,
    scheduleInterval: parsed.data.scheduleInterval ?? "15m",
    lastRunAt: parsed.data.lastRunAt,
    nextRunAt: parsed.data.nextRunAt,
    disabledAssets: Array.from(new Set((parsed.data.disabledAssets ?? []).map(toUpperSymbol))).sort(),
    compositionMode: normalizeCompositionMode(executionMode === "manual" ? "manual" : "automatic"),
    baseStrategies: executionMode === "automatic" ? [] : selectedOrAllowedBaseStrategies,
    strategyWeights: normalizedWeights,
    autoStrategyUsage: executionMode !== "manual",
    strategySelectionConfig: {
      minStrategyScore: parsed.data.strategySelectionConfig.minStrategyScore,
      maxActiveStrategies: parsed.data.strategySelectionConfig.maxActiveStrategies,
      maxWeightShiftPerCycle: parsed.data.strategySelectionConfig.maxWeightShiftPerCycle,
      strategyCooldownHours: parsed.data.strategySelectionConfig.strategyCooldownHours,
      minActiveDurationHours: parsed.data.strategySelectionConfig.minActiveDurationHours,
      fallbackStrategy,
    },
    weightAdjustmentConfig: {
      scorePower: parsed.data.weightAdjustmentConfig.scorePower,
      minWeightPctPerStrategy: parsed.data.weightAdjustmentConfig.minWeightPctPerStrategy,
      maxWeightPctPerStrategy: parsed.data.weightAdjustmentConfig.maxWeightPctPerStrategy,
    },
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return {
    success: true,
    data: normalized,
  };
}

export function mergeStrategyUpdate(existing: StrategyConfig, input: unknown): DslValidationResult {
  const combined = {
    ...existing,
    ...(typeof input === "object" && input !== null ? input : {}),
    id: existing.id,
    createdAt: existing.createdAt,
  };

  const validated = validateStrategyDsl(combined, existing.createdAt);
  if (!validated.success || !validated.data) {
    return validated;
  }

  return {
    success: true,
    data: {
      ...validated.data,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    },
  };
}

import { randomUUID } from "node:crypto";
import express, { Router } from "express";
import { z } from "zod";
import { BacktestEngine } from "./backtest-engine.js";
import { computeBacktestMetrics } from "./performance-metrics.js";
import { buildBacktestReport } from "./simulation-reporter.js";
import { mergeStrategyUpdate, validateStrategyDsl } from "./strategy-dsl-parser.js";
import { StrategyRepository } from "./strategy-repository.js";
import { StrategyRunner } from "./strategy-runner.js";
import { createNextRunAt, parseScheduleIntervalToMs } from "./allocation-utils.js";
import { createDemoAccountHoldings } from "./portfolio-state-service.js";
import { PortfolioAccountType } from "./types.js";
import { isBasicStrategyId } from "./strategy-catalog.js";
import { resolveStrategyUserScope } from "./strategy-user-scope.js";

const scheduleSchema = z.object({
  scheduleInterval: z.string().regex(/^\d+(s|m|h|d)$/i),
});

const isoOrDateSchema = z
  .string()
  .refine((value) => Number.isFinite(new Date(value).getTime()), "Invalid date value.");

const backtestRequestSchema = z.object({
  strategyId: z.string().min(1),
  startDate: isoOrDateSchema,
  endDate: isoOrDateSchema,
  initialCapital: z.number().finite().positive(),
  baseCurrency: z.string().min(1).default("USDC"),
  timeframe: z.enum(["1h", "1d"]).default("1d"),
  rebalanceCostsPct: z.number().finite().min(0).max(1).default(0.001),
  slippagePct: z.number().finite().min(0).max(1).default(0.001),
});
const candidateEvaluationRequestSchema = z.object({
  startDate: isoOrDateSchema,
  endDate: isoOrDateSchema,
  initialCapital: z.number().finite().positive().default(10_000),
  baseCurrency: z.string().min(1).default("USDC"),
  validationDays: z.number().int().min(7).max(365).default(45),
  rebalanceCostsPct: z.number().finite().min(0).max(1).default(0.001),
  slippagePct: z.number().finite().min(0).max(1).default(0.001),
});
const backtestMarketPreviewSchema = z.object({
  startDate: isoOrDateSchema,
  endDate: isoOrDateSchema,
  baseCurrency: z.string().min(1).default("USDC"),
  timeframe: z.enum(["1h", "1d"]).default("1d"),
  symbol: z.string().trim().min(1).default("BTC"),
});

const accountTypeSchema = z.enum(["real", "demo"]);
const demoAccountBalanceSchema = z.object({
  balance: z.number().finite().positive(),
});
const demoAccountInitializeSchema = z.object({
  balance: z.number().finite().positive(),
  allocations: z
    .array(
      z.object({
        symbol: z.string().min(1),
        percent: z.number().finite().positive(),
      })
    )
    .min(1),
});
const allocationEntrySchema = z.object({
  symbol: z.string().min(1),
  percent: z.number().finite().positive(),
});
const rebalanceAllocationProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  strategyId: z.string().trim().min(1),
  allocatedCapital: z.number().finite().positive(),
  baseCurrency: z.string().trim().min(1).default("USDC"),
  allocations: z.array(allocationEntrySchema).min(1),
  isEnabled: z.boolean().default(true),
  executionPolicy: z.enum(["manual", "on_strategy_run", "interval"]).default("manual"),
  autoExecuteMinDriftPct: z.number().finite().min(0).max(100).optional(),
  scheduleInterval: z.string().regex(/^\d+(s|m|h|d)$/i).optional(),
});
const strategyApprovalUpdateSchema = z.object({
  approvalState: z.enum(["draft", "testing", "paper", "approved", "rejected"]),
  approvalNote: z.string().trim().max(500).optional(),
});

interface StrategyApiDeps {
  repository: StrategyRepository;
  runner: StrategyRunner;
  backtestEngine: BacktestEngine;
}

function sendNotFound(res: express.Response, entity: string, id: string): void {
  res.status(404).json({ message: `${entity} ${id} not found.` });
}

function parseAccountType(req: express.Request): PortfolioAccountType {
  const queryValue = typeof req.query?.accountType === "string" ? req.query.accountType : undefined;
  const bodyValue =
    req.body && typeof req.body === "object" && typeof (req.body as Record<string, unknown>).accountType === "string"
      ? String((req.body as Record<string, unknown>).accountType)
      : undefined;

  const rawValue = (queryValue ?? bodyValue ?? "real").trim().toLowerCase();
  const parsed = accountTypeSchema.safeParse(rawValue);
  return parsed.success ? parsed.data : "real";
}

function buildAllocationMap(
  allocations: Array<{ symbol: string; percent: number }>
): Record<string, number> {
  return allocations.reduce<Record<string, number>>((acc, entry) => {
    const symbol = entry.symbol.trim().toUpperCase();
    if (!symbol) return acc;
    acc[symbol] = (acc[symbol] ?? 0) + entry.percent;
    return acc;
  }, {});
}

function allocationMapsEqual(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  if (leftEntries.length !== rightEntries.length) return false;

  return leftEntries.every(([symbol, percent], index) => {
    const [otherSymbol, otherPercent] = rightEntries[index] ?? [];
    return symbol === otherSymbol && Math.abs(percent - (otherPercent ?? 0)) < 0.0001;
  });
}

function findDuplicateAllocationSymbols(allocations: Array<{ symbol: string; percent: number }>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  allocations.forEach((entry) => {
    const symbol = entry.symbol.trim().toUpperCase();
    if (!symbol) return;
    if (seen.has(symbol)) {
      duplicates.add(symbol);
      return;
    }
    seen.add(symbol);
  });

  return Array.from(duplicates).sort((left, right) => left.localeCompare(right));
}

async function validateRebalanceAllocationCapitalBudget(
  repository: StrategyRepository,
  input: { allocatedCapital: number; isEnabled: boolean; excludedProfileId?: string },
  userScope?: ReturnType<typeof resolveStrategyUserScope>
): Promise<string | null> {
  if (!input.isEnabled) {
    return null;
  }

  const [demoAccount, profiles] = await Promise.all([
    repository.getDemoAccountSettings(userScope),
    repository.listRebalanceAllocationProfiles(userScope),
  ]);

  const committedCapital = profiles.reduce((sum, profile) => {
    if (!profile.isEnabled) return sum;
    if (profile.id === input.excludedProfileId) return sum;
    return sum + profile.allocatedCapital;
  }, 0);

  const projectedCapital = committedCapital + input.allocatedCapital;
  if (projectedCapital - demoAccount.balance > 0.0001) {
    return `Enabled allocations would reserve ${projectedCapital.toFixed(2)} while the demo account balance is ${demoAccount.balance.toFixed(2)}.`;
  }

  return null;
}

function canMoveToApprovalState(
  targetState: "draft" | "testing" | "paper" | "approved" | "rejected",
  latestEvaluationPassed: boolean
): { allowed: boolean; message?: string } {
  if ((targetState === "paper" || targetState === "approved") && !latestEvaluationPassed) {
    return {
      allowed: false,
      message: `Moving a strategy to ${targetState} requires a passing candidate evaluation.`,
    };
  }

  return { allowed: true };
}

export function createStrategyRouter(deps: StrategyApiDeps): Router {
  const router = Router();

  router.get("/strategy-settings/demo-account", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const demoAccount = await deps.repository.getDemoAccountSettings(userScope);
    res.json({ demoAccount });
  });

  router.put("/strategy-settings/demo-account", async (req, res) => {
    const parsed = demoAccountBalanceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid demo account payload.", errors: parsed.error.issues });
      return;
    }

    const userScope = resolveStrategyUserScope(req);
    const demoAccount = await deps.repository.setDemoAccountBalance(parsed.data.balance, userScope);
    res.json({ demoAccount });
  });

  router.post("/strategy-settings/demo-account/initialize", async (req, res) => {
    const parsed = demoAccountInitializeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid demo account initialization payload.", errors: parsed.error.issues });
      return;
    }

    const allocations = parsed.data.allocations.reduce<Record<string, number>>((acc, entry) => {
      const symbol = entry.symbol.trim().toUpperCase();
      if (!symbol) return acc;
      acc[symbol] = (acc[symbol] ?? 0) + entry.percent;
      return acc;
    }, {});

    const totalPercent = Object.values(allocations).reduce((sum, value) => sum + value, 0);
    if (Math.abs(totalPercent - 100) > 0.0001) {
      res.status(400).json({ message: "Allocation percentages must total exactly 100%." });
      return;
    }

    const userScope = resolveStrategyUserScope(req);
    const holdings = await createDemoAccountHoldings("USDC", parsed.data.balance, allocations);
    const demoAccount = await deps.repository.initializeDemoAccount(parsed.data.balance, holdings, userScope);
    res.status(201).json({ demoAccount });
  });

  router.delete("/strategy-settings/demo-account", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const demoAccount = await deps.repository.resetDemoAccount(userScope);
    res.json({ demoAccount });
  });

  router.get("/rebalance-allocations", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const profiles = await deps.repository.listRebalanceAllocationProfiles(userScope);
    res.json({ profiles });
  });

  router.post("/rebalance-allocations", async (req, res) => {
    const parsed = rebalanceAllocationProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid rebalance allocation payload.", errors: parsed.error.issues });
      return;
    }

    const userScope = resolveStrategyUserScope(req);
    const strategy = await deps.repository.getStrategy(parsed.data.strategyId, userScope);
    if (!strategy) {
      sendNotFound(res, "Strategy", parsed.data.strategyId);
      return;
    }
    if (isBasicStrategyId(strategy.id)) {
      res.status(400).json({ message: "Rebalance allocations must reference a usable custom strategy." });
      return;
    }
    if (!strategy.isEnabled) {
      res.status(400).json({ message: "Rebalance allocations must reference an enabled strategy." });
      return;
    }

    const duplicateSymbols = findDuplicateAllocationSymbols(parsed.data.allocations);
    if (duplicateSymbols.length > 0) {
      res.status(400).json({ message: `Duplicate allocation symbols are not allowed: ${duplicateSymbols.join(", ")}.` });
      return;
    }

    const allocation = buildAllocationMap(parsed.data.allocations);
    const totalPercent = Object.values(allocation).reduce((sum, value) => sum + value, 0);
    if (Math.abs(totalPercent - 100) > 0.0001) {
      res.status(400).json({ message: "Allocation percentages must total exactly 100%." });
      return;
    }

    if (parsed.data.executionPolicy === "interval") {
      const scheduleInterval = parsed.data.scheduleInterval?.trim().toLowerCase();
      if (!scheduleInterval) {
        res.status(400).json({ message: "scheduleInterval is required for interval execution." });
        return;
      }
      if (parseScheduleIntervalToMs(scheduleInterval) < 5000) {
        res.status(400).json({ message: "scheduleInterval must be at least 5 seconds." });
        return;
      }
    }

    const capitalBudgetError = await validateRebalanceAllocationCapitalBudget(
      deps.repository,
      {
        allocatedCapital: parsed.data.allocatedCapital,
        isEnabled: parsed.data.isEnabled,
      },
      userScope
    );
    if (capitalBudgetError) {
      res.status(400).json({ message: capitalBudgetError });
      return;
    }

    const holdings = await createDemoAccountHoldings(
      parsed.data.baseCurrency,
      parsed.data.allocatedCapital,
      allocation
    );
    const nowIso = new Date().toISOString();
    const scheduleInterval = parsed.data.scheduleInterval?.trim().toLowerCase();
    const profile = await deps.repository.saveRebalanceAllocationProfile(
      {
        id: randomUUID(),
        name: parsed.data.name.trim(),
        description: parsed.data.description?.trim() || undefined,
        strategyId: strategy.id,
        allocatedCapital: parsed.data.allocatedCapital,
        baseCurrency: parsed.data.baseCurrency.trim().toUpperCase(),
        allocation,
        holdings,
        isEnabled: parsed.data.isEnabled,
        executionPolicy: parsed.data.executionPolicy,
        autoExecuteMinDriftPct: parsed.data.autoExecuteMinDriftPct,
        scheduleInterval,
        nextExecutionAt:
          parsed.data.isEnabled && parsed.data.executionPolicy === "interval" && scheduleInterval
            ? createNextRunAt(nowIso, scheduleInterval)
            : undefined,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      userScope
    );

    res.status(201).json({ profile });
  });

  router.put("/rebalance-allocations/:id", async (req, res) => {
    const parsed = rebalanceAllocationProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid rebalance allocation payload.", errors: parsed.error.issues });
      return;
    }

    const userScope = resolveStrategyUserScope(req);
    const existing = await deps.repository.getRebalanceAllocationProfile(req.params.id, userScope);
    if (!existing) {
      sendNotFound(res, "Rebalance allocation", req.params.id);
      return;
    }

    const strategy = await deps.repository.getStrategy(parsed.data.strategyId, userScope);
    if (!strategy) {
      sendNotFound(res, "Strategy", parsed.data.strategyId);
      return;
    }
    if (isBasicStrategyId(strategy.id)) {
      res.status(400).json({ message: "Rebalance allocations must reference a usable custom strategy." });
      return;
    }
    if (!strategy.isEnabled) {
      res.status(400).json({ message: "Rebalance allocations must reference an enabled strategy." });
      return;
    }

    const duplicateSymbols = findDuplicateAllocationSymbols(parsed.data.allocations);
    if (duplicateSymbols.length > 0) {
      res.status(400).json({ message: `Duplicate allocation symbols are not allowed: ${duplicateSymbols.join(", ")}.` });
      return;
    }

    const allocation = buildAllocationMap(parsed.data.allocations);
    const totalPercent = Object.values(allocation).reduce((sum, value) => sum + value, 0);
    if (Math.abs(totalPercent - 100) > 0.0001) {
      res.status(400).json({ message: "Allocation percentages must total exactly 100%." });
      return;
    }

    const scheduleInterval = parsed.data.scheduleInterval?.trim().toLowerCase();
    if (parsed.data.executionPolicy === "interval") {
      if (!scheduleInterval) {
        res.status(400).json({ message: "scheduleInterval is required for interval execution." });
        return;
      }
      if (parseScheduleIntervalToMs(scheduleInterval) < 5000) {
        res.status(400).json({ message: "scheduleInterval must be at least 5 seconds." });
        return;
      }
    }

    const capitalBudgetError = await validateRebalanceAllocationCapitalBudget(
      deps.repository,
      {
        allocatedCapital: parsed.data.allocatedCapital,
        isEnabled: parsed.data.isEnabled,
        excludedProfileId: existing.id,
      },
      userScope
    );
    if (capitalBudgetError) {
      res.status(400).json({ message: capitalBudgetError });
      return;
    }

    const requiresHoldingReset =
      existing.baseCurrency.trim().toUpperCase() !== parsed.data.baseCurrency.trim().toUpperCase() ||
      Math.abs(existing.allocatedCapital - parsed.data.allocatedCapital) > 0.0001 ||
      !allocationMapsEqual(existing.allocation, allocation);
    const holdings = requiresHoldingReset
      ? await createDemoAccountHoldings(parsed.data.baseCurrency, parsed.data.allocatedCapital, allocation)
      : existing.holdings;
    const nowIso = new Date().toISOString();
    const profile = await deps.repository.saveRebalanceAllocationProfile(
      {
        ...existing,
        name: parsed.data.name.trim(),
        description: parsed.data.description?.trim() || undefined,
        strategyId: strategy.id,
        allocatedCapital: parsed.data.allocatedCapital,
        baseCurrency: parsed.data.baseCurrency.trim().toUpperCase(),
        allocation,
        holdings,
        isEnabled: parsed.data.isEnabled,
        executionPolicy: parsed.data.executionPolicy,
        autoExecuteMinDriftPct: parsed.data.autoExecuteMinDriftPct,
        scheduleInterval,
        nextExecutionAt:
          parsed.data.isEnabled && parsed.data.executionPolicy === "interval" && scheduleInterval
            ? createNextRunAt(nowIso, scheduleInterval)
            : undefined,
        updatedAt: nowIso,
      },
      userScope
    );

    res.json({ profile });
  });

  router.delete("/rebalance-allocations/:id", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const removed = await deps.repository.deleteRebalanceAllocationProfile(req.params.id, userScope);
    if (!removed) {
      sendNotFound(res, "Rebalance allocation", req.params.id);
      return;
    }

    res.json({ success: true });
  });

  router.get("/rebalance-allocations/:id/state", async (req, res) => {
    try {
      const userScope = resolveStrategyUserScope(req);
      const state = await deps.runner.evaluateRebalanceAllocationProfileState(req.params.id, userScope);
      if (!state) {
        sendNotFound(res, "Rebalance allocation", req.params.id);
        return;
      }

      res.json({
        profile: state.profile,
        strategy: state.strategy,
        accountType: "demo",
        currentAllocation: state.evaluation.currentAllocation,
        baseAllocation: state.evaluation.baseAllocation,
        adjustedTargetAllocation: state.evaluation.adjustedTargetAllocation,
        portfolio: state.portfolio,
        signals: state.marketSignals,
        marketContext: state.evaluation.marketContext,
        marketGate: state.evaluation.marketGate,
        executionPlan: state.evaluation.executionPlan,
        projectedOutcome: state.evaluation.projectedOutcome,
        traces: state.evaluation.traces,
        warnings: state.evaluation.warnings,
        composition: state.evaluation.composition,
      });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Unable to evaluate rebalance allocation." });
    }
  });

  router.post("/rebalance-allocations/:id/execute", async (req, res) => {
    try {
      const userScope = resolveStrategyUserScope(req);
      const run = await deps.runner.executeRebalanceAllocationProfile(req.params.id, "api", userScope);
      res.json({ run });
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Unable to execute rebalance allocation." });
    }
  });

  router.get("/strategies", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const strategies = await deps.repository.listStrategies(userScope);
    res.json({ strategies });
  });

  router.post("/strategies/validate", (req, res) => {
    const validated = validateStrategyDsl(req.body);
    if (!validated.success) {
      res.status(400).json({ valid: false, errors: validated.errors });
      return;
    }

    res.json({ valid: true, strategy: validated.data });
  });

  router.post("/strategies", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const validated = validateStrategyDsl(req.body);
    if (!validated.success || !validated.data) {
      res.status(400).json({ message: "Strategy validation failed.", errors: validated.errors ?? [] });
      return;
    }

    const existing = await deps.repository.getStrategy(validated.data.id, userScope);
    if (existing) {
      res.status(409).json({ message: `Strategy ${validated.data.id} already exists.` });
      return;
    }

    await deps.repository.saveStrategy(validated.data, userScope);
    res.status(201).json({ strategy: validated.data });
  });

  router.get("/strategies/:id", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const strategy = await deps.repository.getStrategy(req.params.id, userScope);
    if (!strategy) {
      sendNotFound(res, "Strategy", req.params.id);
      return;
    }

    res.json({ strategy });
  });

  router.put("/strategies/:id", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const existing = await deps.repository.getStrategy(req.params.id, userScope);
    if (!existing) {
      sendNotFound(res, "Strategy", req.params.id);
      return;
    }

    const merged = mergeStrategyUpdate(existing, req.body);
    if (!merged.success || !merged.data) {
      res.status(400).json({ message: "Strategy update validation failed.", errors: merged.errors ?? [] });
      return;
    }

    await deps.repository.saveStrategy(merged.data, userScope);
    res.json({ strategy: merged.data });
  });

  router.get("/strategies/:id/versions", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const strategy = await deps.repository.getStrategy(req.params.id, userScope);
    if (!strategy) {
      sendNotFound(res, "Strategy", req.params.id);
      return;
    }

    const versions = await deps.repository.listStrategyVersions(req.params.id, userScope);
    res.json({ strategy, versions });
  });

  router.get("/strategies/:id/evaluations", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const strategy = await deps.repository.getStrategy(req.params.id, userScope);
    if (!strategy) {
      sendNotFound(res, "Strategy", req.params.id);
      return;
    }

    const evaluations = await deps.repository.listStrategyEvaluations(req.params.id, userScope);
    res.json({ strategy, evaluations });
  });

  router.post("/strategies/:id/evaluate-candidate", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const strategy = await deps.repository.getStrategy(req.params.id, userScope);
    if (!strategy) {
      sendNotFound(res, "Strategy", req.params.id);
      return;
    }

    const parsed = candidateEvaluationRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid candidate evaluation payload.", errors: parsed.error.issues });
      return;
    }

    if (new Date(parsed.data.startDate) >= new Date(parsed.data.endDate)) {
      res.status(400).json({ message: "startDate must be before endDate." });
      return;
    }

    try {
      const evaluation = await deps.backtestEngine.evaluateCandidateStrategy(
        {
          strategyId: strategy.id,
          ...parsed.data,
        },
        userScope
      );
      const updatedStrategy = await deps.repository.getStrategy(strategy.id, userScope);
      res.status(201).json({ strategy: updatedStrategy ?? strategy, evaluation });
    } catch (error) {
      res.status(400).json({
        message: error instanceof Error ? error.message : "Unable to evaluate candidate strategy.",
      });
    }
  });

  router.post("/strategies/:id/approval", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const strategy = await deps.repository.getStrategy(req.params.id, userScope);
    if (!strategy) {
      sendNotFound(res, "Strategy", req.params.id);
      return;
    }

    const parsed = strategyApprovalUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid approval payload.", errors: parsed.error.issues });
      return;
    }

    const permission = canMoveToApprovalState(
      parsed.data.approvalState,
      strategy.latestEvaluationSummary?.riskGatePassed === true
    );
    if (!permission.allowed) {
      res.status(400).json({ message: permission.message ?? "Approval transition not allowed." });
      return;
    }

    const updated = await deps.repository.updateStrategyApprovalState(
      strategy.id,
      parsed.data.approvalState,
      parsed.data.approvalNote,
      userScope
    );
    if (!updated) {
      sendNotFound(res, "Strategy", req.params.id);
      return;
    }

    res.json({ strategy: updated });
  });

  router.delete("/strategies/:id", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const existing = await deps.repository.getStrategy(req.params.id, userScope);
    if (!existing) {
      sendNotFound(res, "Strategy", req.params.id);
      return;
    }

    if (!existing.baseStrategies || existing.baseStrategies.length === 0) {
      res.status(400).json({ message: "Base read-only strategies cannot be deleted." });
      return;
    }

    await deps.repository.deleteStrategy(req.params.id, userScope);
    res.json({ success: true });
  });

  router.post("/strategies/:id/run", async (req, res) => {
    try {
      const userScope = resolveStrategyUserScope(req);
      const run = await deps.runner.runStrategy(req.params.id, "api", parseAccountType(req), userScope);
      res.json({ run });
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Unable to run strategy." });
    }
  });

  router.post("/strategies/:id/run-now", async (req, res) => {
    try {
      const userScope = resolveStrategyUserScope(req);
      const run = await deps.runner.runStrategy(req.params.id, "api", parseAccountType(req), userScope);
      res.json({ run });
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Unable to run strategy." });
    }
  });

  router.post("/strategies/:id/execute-rebalance", async (req, res) => {
    try {
      const userScope = resolveStrategyUserScope(req);
      const run = await deps.runner.executeStrategy(req.params.id, "api", parseAccountType(req), userScope);
      res.json({ run });
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Unable to execute rebalance." });
    }
  });

  router.get("/strategies/:id/state", async (req, res) => {
    try {
      const accountType = parseAccountType(req);
      const userScope = resolveStrategyUserScope(req);
      const state = await deps.runner.evaluateStrategyState(req.params.id, accountType, userScope);
      if (!state) {
        sendNotFound(res, "Strategy", req.params.id);
        return;
      }

      res.json({
        strategyId: state.strategy.id,
        accountType: state.accountType,
        currentAllocation: state.evaluation.currentAllocation,
        baseAllocation: state.evaluation.baseAllocation,
        adjustedTargetAllocation: state.evaluation.adjustedTargetAllocation,
        portfolio: state.portfolio,
        signals: state.marketSignals,
        marketContext: state.evaluation.marketContext,
        marketGate: state.evaluation.marketGate,
        executionPlan: state.evaluation.executionPlan,
        traces: state.evaluation.traces,
        warnings: state.evaluation.warnings,
        composition: state.evaluation.composition,
      });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Unable to evaluate strategy state." });
    }
  });

  router.get("/strategies/:id/execution-plan", async (req, res) => {
    const accountType = parseAccountType(req);
    const userScope = resolveStrategyUserScope(req);
    const plan = await deps.repository.getLatestExecutionPlanByStrategy(req.params.id, accountType, userScope);
    if (!plan) {
      sendNotFound(res, "Execution plan for strategy", req.params.id);
      return;
    }

    res.json({ executionPlan: plan });
  });

  router.post("/strategies/:id/enable", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const strategy = await deps.repository.setStrategyEnabled(req.params.id, true, userScope);
    if (!strategy) {
      sendNotFound(res, "Strategy", req.params.id);
      return;
    }

    res.json({ strategy });
  });

  router.post("/strategies/:id/disable", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const strategy = await deps.repository.setStrategyEnabled(req.params.id, false, userScope);
    if (!strategy) {
      sendNotFound(res, "Strategy", req.params.id);
      return;
    }

    res.json({ strategy });
  });

  router.post("/strategies/:id/schedule", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid schedule payload.", errors: parsed.error.issues });
      return;
    }

    const scheduleInterval = parsed.data.scheduleInterval.toLowerCase();
    if (parseScheduleIntervalToMs(scheduleInterval) < 5000) {
      res.status(400).json({ message: "scheduleInterval must be at least 5 seconds." });
      return;
    }

    const strategy = await deps.repository.scheduleStrategy(req.params.id, scheduleInterval, userScope);
    if (!strategy) {
      sendNotFound(res, "Strategy", req.params.id);
      return;
    }

    res.json({ strategy });
  });

  router.get("/strategy-runs", async (req, res) => {
    const accountType = parseAccountType(req);
    const userScope = resolveStrategyUserScope(req);
    const runs = await deps.repository.listStrategyRuns(200, accountType, userScope);
    res.json({ runs });
  });

  router.get("/strategy-runs/:id", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const run = await deps.repository.getStrategyRun(req.params.id, userScope);
    if (!run) {
      sendNotFound(res, "Strategy run", req.params.id);
      return;
    }

    const executionPlan = run.executionPlanId
      ? await deps.repository.getExecutionPlan(run.executionPlanId, userScope)
      : null;
    res.json({ run, executionPlan });
  });

  router.post("/backtests", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const parsed = backtestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid backtest payload.", errors: parsed.error.issues });
      return;
    }

    const request = parsed.data;
    if (new Date(request.startDate) >= new Date(request.endDate)) {
      res.status(400).json({ message: "startDate must be before endDate." });
      return;
    }

    try {
      const result = userScope
        ? await deps.backtestEngine.runBacktest(request, userScope)
        : await deps.backtestEngine.runBacktest(request);
      res.status(201).json({ backtestRun: result.run, steps: result.steps.length });
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Backtest failed." });
    }
  });

  router.get("/backtests", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const backtests = await deps.repository.listBacktestRuns(100, userScope);
    res.json({ backtests });
  });

  router.get("/backtests/market-preview", async (req, res) => {
    const parsed = backtestMarketPreviewSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid backtest preview query.", errors: parsed.error.issues });
      return;
    }

    const request = parsed.data;
    if (new Date(request.startDate) >= new Date(request.endDate)) {
      res.status(400).json({ message: "startDate must be before endDate." });
      return;
    }

    try {
      const history = await deps.backtestEngine.getMarketPreview(request);
      res.json({
        symbol: request.symbol.trim().toUpperCase(),
        timeframe: request.timeframe,
        startDate: request.startDate,
        endDate: request.endDate,
        history,
      });
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Unable to load backtest preview." });
    }
  });

  router.get("/backtests/:id", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const run = await deps.repository.getBacktestRun(req.params.id, userScope);
    if (!run) {
      sendNotFound(res, "Backtest", req.params.id);
      return;
    }

    res.json({ backtestRun: run });
  });

  router.get("/backtests/:id/timeline", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const run = await deps.repository.getBacktestRun(req.params.id, userScope);
    if (!run) {
      sendNotFound(res, "Backtest", req.params.id);
      return;
    }

    const steps = await deps.repository.listBacktestSteps(run.id, userScope);
    const metrics = computeBacktestMetrics({
      initialCapital: run.initialCapital,
      startDate: run.startDate,
      endDate: run.endDate,
      steps,
    });

    const report = buildBacktestReport(run, steps, metrics);
    res.json({ timeline: report.timeline, run: report.run });
  });

  router.get("/backtests/:id/metrics", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const run = await deps.repository.getBacktestRun(req.params.id, userScope);
    if (!run) {
      sendNotFound(res, "Backtest", req.params.id);
      return;
    }

    const steps = await deps.repository.listBacktestSteps(run.id, userScope);
    const metrics = computeBacktestMetrics({
      initialCapital: run.initialCapital,
      startDate: run.startDate,
      endDate: run.endDate,
      steps,
    });

    res.json({ metrics });
  });

  return router;
}

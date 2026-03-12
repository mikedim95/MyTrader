import express, { Router } from "express";
import { z } from "zod";
import { BacktestEngine } from "./backtest-engine.js";
import { computeBacktestMetrics } from "./performance-metrics.js";
import { buildBacktestReport } from "./simulation-reporter.js";
import { mergeStrategyUpdate, validateStrategyDsl } from "./strategy-dsl-parser.js";
import { StrategyRepository } from "./strategy-repository.js";
import { StrategyRunner } from "./strategy-runner.js";
import { parseScheduleIntervalToMs } from "./allocation-utils.js";
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

const accountTypeSchema = z.enum(["real", "demo"]);
const demoAccountBalanceSchema = z.object({
  balance: z.number().finite().positive(),
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

  router.delete("/strategies/:id", async (req, res) => {
    const userScope = resolveStrategyUserScope(req);
    const existing = await deps.repository.getStrategy(req.params.id, userScope);
    if (!existing) {
      sendNotFound(res, "Strategy", req.params.id);
      return;
    }

    if (isBasicStrategyId(existing.id)) {
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

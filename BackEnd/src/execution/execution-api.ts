import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { resolveStrategyUserScope } from "../strategy/strategy-user-scope.js";
import { ExecutionGuardrailService } from "./execution-guardrail-service.js";
import { SignalOutcomeService } from "./signal-review-service.js";
import { ExecutionEngine } from "../services/execution/executionEngine.js";
import { PerformanceTracker } from "../services/learning/performanceTracker.js";
import { tradeSignalSchema } from "../services/signals/signalProcessor.js";

const accountTypeSchema = z.enum(["real", "demo"]);
const actionSchema = z.enum(["buy", "sell", "hold"]);
const recommendationSchema = z.enum([
  "buy_favorable",
  "mild_buy_favorable",
  "hold_neutral",
  "mild_sell_favorable",
  "sell_favorable",
]);
const regimeSchema = z.enum(["trend_up", "trend_down", "range", "uncertain"]);

const decisionContextSchema = z
  .object({
    technical_score: z.number().finite().optional(),
    news_score: z.number().finite().optional(),
    portfolio_score: z.number().finite().optional(),
    final_score: z.number().finite().optional(),
    market_regime: regimeSchema.optional(),
    recommendation: recommendationSchema.optional(),
    confidence: z.number().min(0).max(1).optional(),
    top_contributors: z.array(z.string()).optional(),
    blockers: z.array(z.string()).optional(),
    summary: z.string().trim().optional(),
  })
  .partial();

const guardrailRequestSchema = z.object({
  accountType: accountTypeSchema.optional(),
  proposedAction: actionSchema,
  asset: z.string().trim().min(2).max(24),
  requestedSize: z.number().min(0).max(100),
  decisionContext: decisionContextSchema.optional(),
  currentPortfolioExposure: z
    .object({
      assetExposurePct: z.number().min(0).max(100).optional(),
      btcExposurePct: z.number().min(0).max(100).optional(),
    })
    .partial()
    .optional(),
  volatilityMetric: z.number().min(0).optional(),
});

interface ExecutionApiDeps {
  executionGuardrailService: ExecutionGuardrailService;
  signalOutcomeService: SignalOutcomeService;
  executionEngine: ExecutionEngine;
  performanceTracker: PerformanceTracker;
}

function requireUserScope(req: Request, res: Response) {
  const scope = resolveStrategyUserScope(req);
  if (scope) {
    return scope;
  }

  res.status(400).json({
    message: "A signed-in user is required for this action.",
  });
  return null;
}

function parseAccountType(value: unknown): "real" | "demo" {
  const parsed = accountTypeSchema.safeParse(typeof value === "string" ? value.trim().toLowerCase() : "real");
  return parsed.success ? parsed.data : "real";
}

function parseLimit(value: unknown, fallback = 25): number {
  const parsed = Number.parseInt(typeof value === "string" ? value : "", 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 100);
}

export function createExecutionRouter(deps: ExecutionApiDeps): Router {
  const router = Router();

  router.post("/execution/guardrails/evaluate", async (req, res, next) => {
    try {
      const userScope = requireUserScope(req, res);
      if (!userScope) {
        return;
      }

      const parsedBody = guardrailRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({
          message: parsedBody.error.issues[0]?.message ?? "Invalid execution guardrail request.",
        });
        return;
      }

      const result = await deps.executionGuardrailService.evaluate(parsedBody.data, userScope);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/signals/review", async (req, res, next) => {
    try {
      const userScope = requireUserScope(req, res);
      if (!userScope) {
        return;
      }

      const accountType = parseAccountType(req.query.accountType);
      const limit = parseLimit(req.query.limit, 25);
      const result = await deps.signalOutcomeService.getSignalReview(accountType, limit, userScope);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/execution/simulate", async (req, res, next) => {
    try {
      const userScope = requireUserScope(req, res);
      if (!userScope) {
        return;
      }

      const parsedBody = tradeSignalSchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({
          message: parsedBody.error.issues[0]?.message ?? "Invalid trade signal payload.",
        });
        return;
      }

      const result = await deps.executionEngine.simulate(parsedBody.data, userScope);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/execution/history", async (req, res, next) => {
    try {
      const userScope = requireUserScope(req, res);
      if (!userScope) {
        return;
      }

      const limit = parseLimit(req.query.limit, 25);
      const result = await deps.performanceTracker.getExecutionHistory(userScope, limit);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/execution/performance", async (req, res, next) => {
    try {
      const userScope = requireUserScope(req, res);
      if (!userScope) {
        return;
      }

      const result = await deps.performanceTracker.getExecutionPerformance(userScope);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

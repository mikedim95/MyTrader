import { Router } from "express";
import { z } from "zod";
import { resolveStrategyUserScope } from "../strategy/strategy-user-scope.js";
import { DecisionIntelligenceService } from "./decision-service.js";

const accountTypeSchema = z.enum(["real", "demo"]);

interface DecisionApiDeps {
  decisionIntelligenceService: DecisionIntelligenceService;
}

function parseAccountType(value: unknown): "real" | "demo" {
  const parsed = accountTypeSchema.safeParse(typeof value === "string" ? value.trim().toLowerCase() : "real");
  return parsed.success ? parsed.data : "real";
}

export function createDecisionRouter(deps: DecisionApiDeps): Router {
  const router = Router();

  router.get("/decision/intelligence", async (req, res, next) => {
    try {
      const accountType = parseAccountType(req.query.accountType);
      const userScope = resolveStrategyUserScope(req);
      const intelligence = await deps.decisionIntelligenceService.getDecisionIntelligence(accountType, userScope);
      res.json(intelligence);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

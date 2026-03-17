import { Router } from "express";
import { BtcNewsInsightsService } from "./news-service.js";

interface NewsApiDeps {
  btcNewsInsightsService: BtcNewsInsightsService;
}

export function createNewsRouter(deps: NewsApiDeps): Router {
  const router = Router();

  router.get("/news/btc/insights", async (_req, res, next) => {
    try {
      const insights = await deps.btcNewsInsightsService.getInsights();
      res.json(insights);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

import { Response, Router } from "express";
import { z } from "zod";
import { ExchangeMarketService } from "./exchangeMarketService.js";
import { SUPPORTED_MARKET_SYMBOLS, SupportedMarketSymbol, normalizeMarketSymbol } from "./types.js";

interface ExchangeMarketApiDeps {
  exchangeMarketService: ExchangeMarketService;
}

const symbolQuerySchema = z.object({
  symbol: z.string().trim().min(1),
});

const orderBookQuerySchema = symbolQuerySchema.extend({
  depth: z.coerce.number().int().min(1).max(25).default(10),
});

function parseOrRespond<T>(schema: z.ZodSchema<T>, input: unknown, res: Response): T | null {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  res.status(400).json({
    message: "Invalid request payload.",
    errors: parsed.error.issues,
  });

  return null;
}

function resolveSupportedSymbol(input: string, res: Response): SupportedMarketSymbol | null {
  const symbol = normalizeMarketSymbol(input);
  if (symbol) {
    return symbol;
  }

  res.status(400).json({
    message: `Unsupported symbol. Supported symbols: ${SUPPORTED_MARKET_SYMBOLS.join(", ")}`,
  });

  return null;
}

export function createExchangeMarketRouter(deps: ExchangeMarketApiDeps): Router {
  const router = Router();

  router.get("/exchanges/health", async (_req, res, next) => {
    try {
      const exchanges = await deps.exchangeMarketService.getHealth();
      res.json({
        exchanges,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/exchanges/pairs", async (_req, res, next) => {
    try {
      const pairs = await deps.exchangeMarketService.getSupportedPairs();
      res.json({ pairs });
    } catch (error) {
      next(error);
    }
  });

  router.get("/exchanges/ticker", async (req, res, next) => {
    const query = parseOrRespond(symbolQuerySchema, req.query, res);
    if (!query) return;
    const symbol = resolveSupportedSymbol(query.symbol, res);
    if (!symbol) return;

    try {
      const exchanges = await deps.exchangeMarketService.getTickers(symbol);
      res.json({
        symbol,
        exchanges,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/exchanges/orderbook-summary", async (req, res, next) => {
    const query = parseOrRespond(orderBookQuerySchema, req.query, res);
    if (!query) return;
    const symbol = resolveSupportedSymbol(query.symbol, res);
    if (!symbol) return;
    const depth = query.depth ?? 10;

    try {
      const exchanges = await deps.exchangeMarketService.getOrderBookSummaries(symbol, depth);
      res.json({
        symbol,
        depth,
        exchanges,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/exchanges/compare", async (req, res, next) => {
    const query = parseOrRespond(symbolQuerySchema, req.query, res);
    if (!query) return;
    const symbol = resolveSupportedSymbol(query.symbol, res);
    if (!symbol) return;

    try {
      const comparison = await deps.exchangeMarketService.getComparison(symbol);
      res.json({
        ...comparison,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

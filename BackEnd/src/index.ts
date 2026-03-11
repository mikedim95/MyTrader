import "dotenv/config";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import {
  clearSessionCredentials,
  getConnectionStatus,
  setSessionCredentials,
  validateCredentials,
} from "./binanceClient.js";
import { getMiningOverviewData, getNicehashOverviewData } from "./miningService.js";
import { getDashboardData, getOrdersData } from "./portfolioService.js";
import { BacktestEngine } from "./strategy/backtest-engine.js";
import { StrategyRepository } from "./strategy/strategy-repository.js";
import { StrategyRunner } from "./strategy/strategy-runner.js";
import { StrategyScheduler } from "./strategy/strategy-scheduler.js";
import { createStrategyRouter } from "./strategy/strategy-api.js";

const app = express();

const port = Number(process.env.PORT ?? 3001);
const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:8080")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const rawSchedulerPollMs = Number(process.env.STRATEGY_SCHEDULER_POLL_MS ?? 15_000);
const schedulerPollMs = Number.isFinite(rawSchedulerPollMs) && rawSchedulerPollMs >= 5_000 ? rawSchedulerPollMs : 15_000;

const strategyRepository = new StrategyRepository(process.env.STRATEGY_STORE_PATH);
const strategyRunner = new StrategyRunner(strategyRepository);
const backtestEngine = new BacktestEngine(strategyRepository);
const strategyScheduler = new StrategyScheduler(strategyRepository, strategyRunner, schedulerPollMs);

app.use(
  cors({
    origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
  })
);
app.use(express.json({ limit: "10kb" }));
app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms`
    );
  });

  next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/binance/connection", async (_req, res) => {
  const connection = await getConnectionStatus();
  res.json(connection);
});

app.post("/api/binance/connection", async (req, res) => {
  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  const apiSecret = typeof req.body?.apiSecret === "string" ? req.body.apiSecret.trim() : "";
  const testnet = Boolean(req.body?.testnet);

  if (!apiKey || !apiSecret) {
    res.status(400).json({
      message: "Both apiKey and apiSecret are required.",
    });
    return;
  }

  try {
    const credentials = { apiKey, apiSecret, testnet };
    await validateCredentials(credentials);
    setSessionCredentials(credentials);

    const connection = await getConnectionStatus();
    res.json(connection);
  } catch (error) {
    clearSessionCredentials();
    res.status(400).json({
      connected: false,
      source: "session",
      testnet,
      message: error instanceof Error ? error.message : "Unable to validate Binance credentials.",
    });
  }
});

app.delete("/api/binance/connection", async (_req, res) => {
  clearSessionCredentials();
  const connection = await getConnectionStatus();
  res.json(connection);
});

app.get("/api/dashboard", async (_req, res) => {
  const dashboard = await getDashboardData();
  res.json(dashboard);
});

app.get("/api/orders", async (_req, res) => {
  const orders = await getOrdersData();
  res.json(orders);
});

app.get("/api/mining/overview", (_req, res) => {
  const overview = getMiningOverviewData();
  res.json(overview);
});

app.get("/api/mining/nicehash", async (_req, res) => {
  const overview = await getNicehashOverviewData();
  res.json(overview);
});

app.use(
  "/api",
  createStrategyRouter({
    repository: strategyRepository,
    runner: strategyRunner,
    backtestEngine,
  })
);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  res.status(500).json({ message });
});

const server = app.listen(port, () => {
  // Keep startup log minimal and avoid printing credentials.
  console.log(`Backend listening on http://localhost:${port}`);
});

strategyScheduler.start().catch((error) => {
  console.error(
    "[strategy-scheduler] Failed to start:",
    error instanceof Error ? error.message : error
  );
});

const shutdown = (): void => {
  strategyScheduler.stop();
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

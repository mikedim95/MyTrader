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
import { createMinerRouter } from "./miners/miner-api.js";
import { MinerAuthService } from "./miners/miner-auth-service.js";
import { MinerCgminerClient } from "./miners/miner-cgminer-client.js";
import { MinerCommandService } from "./miners/miner-command-service.js";
import { MinerCryptoService } from "./miners/miner-crypto-service.js";
import { MinerHttpClient } from "./miners/miner-http-client.js";
import { MinerPollingService } from "./miners/miner-polling-service.js";
import { MinerReadService } from "./miners/miner-read-service.js";
import { MinerRepository as FleetMinerRepository } from "./miners/miner-repository.js";
import { MinerVerifyService } from "./miners/miner-verify-service.js";
import { getDashboardData, getOrdersData } from "./portfolioService.js";
import type { DashboardResponse } from "./types.js";
import { BacktestEngine } from "./strategy/backtest-engine.js";
import { getDemoPortfolioState } from "./strategy/portfolio-state-service.js";
import { StrategyRepository } from "./strategy/strategy-repository.js";
import { StrategyRunner } from "./strategy/strategy-runner.js";
import { StrategyScheduler } from "./strategy/strategy-scheduler.js";
import { createStrategyRouter } from "./strategy/strategy-api.js";
import { resolveStrategyUserScope } from "./strategy/strategy-user-scope.js";

const app = express();

const port = Number(process.env.PORT ?? 3001);
const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:8080")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const rawSchedulerPollMs = Number(process.env.STRATEGY_SCHEDULER_POLL_MS ?? 15_000);
const schedulerPollMs = Number.isFinite(rawSchedulerPollMs) && rawSchedulerPollMs >= 5_000 ? rawSchedulerPollMs : 15_000;
const rawMinerPollMs = Number(process.env.MINER_POLL_MS ?? 15_000);
const minerPollMs = Number.isFinite(rawMinerPollMs) && rawMinerPollMs >= 5_000 ? rawMinerPollMs : 15_000;

const strategyRepository = new StrategyRepository(process.env.STRATEGY_STORE_PATH);
const strategyRunner = new StrategyRunner(strategyRepository);
const backtestEngine = new BacktestEngine(strategyRepository);
const strategyScheduler = new StrategyScheduler(strategyRepository, strategyRunner, schedulerPollMs);
const minerRepository = new FleetMinerRepository();
const minerCryptoService = new MinerCryptoService();
const minerHttpClient = new MinerHttpClient();
const minerCgminerClient = new MinerCgminerClient();
const minerAuthService = new MinerAuthService(minerHttpClient, minerCryptoService);
const minerReadService = new MinerReadService(minerRepository, minerHttpClient, minerCgminerClient, minerAuthService);
const minerVerifyService = new MinerVerifyService(minerHttpClient, minerCgminerClient);
const minerCommandService = new MinerCommandService(minerRepository, minerHttpClient, minerAuthService, minerReadService);
const minerPollingService = new MinerPollingService(minerRepository, minerReadService, minerPollMs);

const DEMO_ASSET_NAMES: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  BNB: "BNB",
  SOL: "Solana",
  XRP: "XRP",
  ADA: "Cardano",
  DOGE: "Dogecoin",
  USDC: "USD Coin",
  USDT: "Tether",
  FDUSD: "First Digital USD",
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseDashboardAccountType(req: Request): "real" | "demo" {
  const rawValue = typeof req.query?.accountType === "string" ? req.query.accountType.trim().toLowerCase() : "real";
  return rawValue === "demo" ? "demo" : "real";
}

function parseTextField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildSparklineFromChange(price: number, change24h: number): number[] {
  const previousPrice = Math.abs(100 + change24h) < 0.0001 ? price : price / (1 + change24h / 100);
  return Array.from({ length: 20 }, (_, index) => {
    const ratio = index / 19;
    return round(previousPrice + (price - previousPrice) * ratio, 6);
  });
}

async function getDemoDashboardData(demoCapital: number): Promise<DashboardResponse> {
  const portfolio = await getDemoPortfolioState("USDC", demoCapital);
  const generatedAt = portfolio.timestamp;
  const assets = portfolio.assets.map((asset) => ({
    id: asset.symbol.toLowerCase(),
    symbol: asset.symbol,
    name: DEMO_ASSET_NAMES[asset.symbol] ?? asset.symbol,
    price: round(asset.price, 8),
    change24h: round(asset.change24h ?? 0, 4),
    volume24h: round(asset.volume24h ?? 0, 2),
    marketCap: 0,
    balance: round(asset.quantity, 10),
    value: round(asset.value, 2),
    allocation: round(asset.allocation, 2),
    targetAllocation: round(asset.allocation, 2),
    sparkline: buildSparklineFromChange(asset.price, asset.change24h ?? 0),
  }));

  const previousTotalValue = assets.reduce((sum, asset) => {
    const denominator = 1 + asset.change24h / 100;
    if (!Number.isFinite(denominator) || Math.abs(denominator) < 0.0001) {
      return sum + asset.value;
    }
    return sum + asset.value / denominator;
  }, 0);
  const totalPortfolioValue = round(assets.reduce((sum, asset) => sum + asset.value, 0), 2);
  const portfolioChange24hValue = round(totalPortfolioValue - previousTotalValue, 2);
  const portfolioChange24h = previousTotalValue <= 0 ? 0 : round((portfolioChange24hValue / previousTotalValue) * 100, 2);
  const historyStart = previousTotalValue > 0 ? previousTotalValue : totalPortfolioValue;

  const portfolioHistory = Array.from({ length: 30 }, (_, index) => {
    const ratio = index / 29;
    return {
      time: `-${29 - index}h`,
      value: round(historyStart + (totalPortfolioValue - historyStart) * ratio, 2),
    };
  });

  const marketMovers = [...assets]
    .filter((asset) => !["USDC", "USDT", "FDUSD"].includes(asset.symbol))
    .sort((left, right) => Math.abs(right.change24h) - Math.abs(left.change24h))
    .slice(0, 5)
    .map((asset) => ({
      symbol: asset.symbol,
      name: asset.name,
      change: round(asset.change24h, 2),
    }));

  return {
    connection: {
      connected: true,
      source: "none",
      testnet: false,
      message: "Demo mode uses simulated holdings and live market prices.",
    },
    assets,
    totalPortfolioValue,
    portfolioChange24h,
    portfolioChange24hValue,
    portfolioHistory,
    marketMovers,
    recentActivity: [],
    generatedAt,
  };
}

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

app.get("/api/health", async (_req, res) => {
  const storage = await strategyRepository.getStorageStatus();
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    storage,
  });
});

app.get("/api/session/status", async (_req, res) => {
  const storage = await strategyRepository.getStorageStatus();
  res.json({
    requiresLogin: true,
    ...storage,
  });
});

app.post("/api/session/login", async (req, res) => {
  const username = parseTextField(req.body?.username);
  const password = parseTextField(req.body?.password);

  if (!username || !password) {
    const storage = await strategyRepository.getStorageStatus();
    res.status(400).json({
      message: "Username and password are required.",
      status: {
        requiresLogin: true,
        ...storage,
      },
    });
    return;
  }

  try {
    const session = await strategyRepository.authenticateUser(username, password);
    const storage = await strategyRepository.getStorageStatus();
    res.json({
      session,
      status: {
        requiresLogin: true,
        ...storage,
      },
    });
  } catch (error) {
    const storage = await strategyRepository.getStorageStatus();
    res.status(401).json({
      message: error instanceof Error ? error.message : "Unable to sign in.",
      status: {
        requiresLogin: true,
        ...storage,
      },
    });
  }
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

app.get("/api/dashboard", async (req, res) => {
  if (parseDashboardAccountType(req) === "demo") {
    const userScope = resolveStrategyUserScope(req);
    const demoAccount = await strategyRepository.getDemoAccountSettings(userScope);
    const dashboard = await getDemoDashboardData(demoAccount.balance);
    res.json(dashboard);
    return;
  }

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
  createMinerRouter({
    repository: minerRepository,
    verifyService: minerVerifyService,
    readService: minerReadService,
    commandService: minerCommandService,
    cryptoService: minerCryptoService,
    pollingService: minerPollingService,
  })
);

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
  console.error("[strategy-scheduler] Failed to start:", error);
});

minerRepository
  .init()
  .then(() => {
    minerPollingService.start();
  })
  .catch((error) => {
    console.error("[miner-polling] Failed to initialize:", error);
  });

const shutdown = (): void => {
  strategyScheduler.stop();
  minerPollingService.stop();
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

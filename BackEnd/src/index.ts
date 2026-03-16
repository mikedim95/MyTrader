import "dotenv/config";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import {
  clearUserCredentials,
  getConnectionStatus,
  storeUserCredentials,
  validateCredentials,
} from "./binanceClient.js";
import {
  clearNicehashCredentials,
  getNicehashConnectionStatus,
  storeNicehashCredentials,
  validateNicehashCredentials,
} from "./nicehashClient.js";
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
import {
  generateRecentDayLabels,
  getDailyCloseSeries,
  getDashboardData,
  getHourlyCloseSeries,
  getMarketCapForSymbol,
  getNameForSymbol,
  getOrdersData,
} from "./portfolioService.js";
import type { DashboardResponse } from "./types.js";
import { BacktestEngine } from "./strategy/backtest-engine.js";
import { getDemoPortfolioState } from "./strategy/portfolio-state-service.js";
import { StrategyRepository } from "./strategy/strategy-repository.js";
import { StrategyRunner } from "./strategy/strategy-runner.js";
import { StrategyScheduler } from "./strategy/strategy-scheduler.js";
import { createStrategyRouter } from "./strategy/strategy-api.js";
import { resolveStrategyUserScope } from "./strategy/strategy-user-scope.js";
import type { StrategyUserScope } from "./strategy/strategy-user-scope.js";

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

function requireUserScope(req: Request, res: Response): StrategyUserScope | null {
  const userScope = resolveStrategyUserScope(req);
  if (userScope) {
    return userScope;
  }

  res.status(400).json({
    message: "A signed-in user is required for this action.",
  });
  return null;
}

async function resolveDemoAccountSettings(userScope?: StrategyUserScope) {
  return strategyRepository.getDemoAccountSettings(userScope);
}

async function getDemoDashboardData(userScope?: StrategyUserScope): Promise<DashboardResponse> {
  const demoAccount = await resolveDemoAccountSettings(userScope);
  const portfolio = await getDemoPortfolioState("USDC", { demoAccount });
  const generatedAt = portfolio.timestamp;
  const demoInitialized = demoAccount.holdings.length > 0;
  const targetAllocationBySymbol = new Map(
    demoAccount.holdings.map((holding) => [holding.symbol.toUpperCase(), holding.targetAllocation])
  );

  const assetSeries = await Promise.all(
    portfolio.assets.map(async (asset) => {
      const [hourlyCloses, dailySeries] = await Promise.all([
        getHourlyCloseSeries(asset.symbol, null, asset.price).catch(() => Array.from({ length: 24 }, () => asset.price)),
        getDailyCloseSeries(asset.symbol, null, asset.price).catch(() => ({
          labels: generateRecentDayLabels(30),
          closes: Array.from({ length: 30 }, () => asset.price),
        })),
      ]);

      return {
        asset,
        hourlyValues: hourlyCloses.map((close) => round(asset.quantity * close, 2)),
        dailySeries,
      };
    })
  );

  const assets = assetSeries.map(({ asset, hourlyValues }) => ({
    id: asset.symbol.toLowerCase(),
    symbol: asset.symbol,
    name: getNameForSymbol(asset.symbol),
    price: round(asset.price, 8),
    change24h: round(asset.change24h ?? 0, 4),
    volume24h: round(asset.volume24h ?? 0, 2),
    marketCap: getMarketCapForSymbol(asset.symbol),
    balance: round(asset.quantity, 10),
    value: round(asset.value, 2),
    allocation: round(asset.allocation, 2),
    targetAllocation: round(targetAllocationBySymbol.get(asset.symbol) ?? asset.allocation, 2),
    sparkline: hourlyValues,
    sparklinePeriod: "24h" as const,
  }));

  const totalPortfolioValue = round(assets.reduce((sum, asset) => sum + asset.value, 0), 2);
  const demoBaselineValue =
    demoInitialized && Number.isFinite(demoAccount.balance) && demoAccount.balance > 0
      ? round(demoAccount.balance, 2)
      : totalPortfolioValue;
  const portfolioChange24hValue = demoInitialized ? round(totalPortfolioValue - demoBaselineValue, 2) : 0;
  const portfolioChange24h =
    !demoInitialized || demoBaselineValue <= 0 ? 0 : round((portfolioChange24hValue / demoBaselineValue) * 100, 2);

  const labels = assetSeries[0]?.dailySeries.labels ?? generateRecentDayLabels(30);
  const portfolioHistory = labels.map((label, index) => {
    const value = assetSeries.reduce((sum, { asset, dailySeries }) => {
      const priceAtIndex = dailySeries.closes[index] ?? asset.price;
      return sum + asset.quantity * priceAtIndex;
    }, 0);

    return {
      time: label,
      value: round(value, 2),
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
      connected: demoInitialized,
      source: "none",
      testnet: false,
      message: demoInitialized
        ? "Demo mode uses your saved simulated holdings and live market prices."
        : "Demo account not initialized yet. Set your starting capital and allocation to begin.",
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

app.get("/api/binance/connection", async (req, res) => {
  const userScope = resolveStrategyUserScope(req);
  const connection = await getConnectionStatus(userScope);
  res.json(connection);
});

app.post("/api/binance/connection", async (req, res) => {
  const userScope = requireUserScope(req, res);
  if (!userScope) return;

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

    const connection = await storeUserCredentials(userScope, credentials);
    res.json(connection);
  } catch (error) {
    res.status(400).json({
      connected: false,
      source: "stored",
      testnet,
      message: error instanceof Error ? error.message : "Unable to validate Binance credentials.",
    });
  }
});

app.delete("/api/binance/connection", async (req, res) => {
  const userScope = requireUserScope(req, res);
  if (!userScope) return;

  const connection = await clearUserCredentials(userScope);
  res.json(connection);
});

app.get("/api/dashboard", async (req, res) => {
  const userScope = resolveStrategyUserScope(req);
  if (parseDashboardAccountType(req) === "demo") {
    const dashboard = await getDemoDashboardData(userScope);
    res.json(dashboard);
    return;
  }

  const dashboard = await getDashboardData(userScope);
  res.json(dashboard);
});

app.get("/api/orders", async (req, res) => {
  const userScope = resolveStrategyUserScope(req);
  const orders = await getOrdersData(userScope);
  res.json(orders);
});

app.get("/api/mining/overview", (_req, res) => {
  const overview = getMiningOverviewData();
  res.json(overview);
});

app.get("/api/nicehash/connection", async (req, res) => {
  const userScope = resolveStrategyUserScope(req);
  const connection = await getNicehashConnectionStatus(userScope);
  res.json(connection);
});

app.post("/api/nicehash/connection", async (req, res) => {
  const userScope = requireUserScope(req, res);
  if (!userScope) return;

  const apiKey = parseTextField(req.body?.apiKey);
  const apiSecret = parseTextField(req.body?.apiSecret);
  const organizationId = parseTextField(req.body?.organizationId);
  const apiHost = parseTextField(req.body?.apiHost) || "https://api2.nicehash.com";

  if (!apiKey || !apiSecret || !organizationId) {
    res.status(400).json({
      message: "apiKey, apiSecret, and organizationId are required.",
    });
    return;
  }

  try {
    const credentials = {
      apiKey,
      apiSecret,
      organizationId,
      apiHost,
    };

    await validateNicehashCredentials(credentials);
    const connection = await storeNicehashCredentials(userScope, credentials);
    res.json(connection);
  } catch (error) {
    res.status(400).json({
      connected: false,
      source: "stored",
      message: error instanceof Error ? error.message : "Unable to validate NiceHash credentials.",
    });
  }
});

app.delete("/api/nicehash/connection", async (req, res) => {
  const userScope = requireUserScope(req, res);
  if (!userScope) return;

  const connection = await clearNicehashCredentials(userScope);
  res.json(connection);
});

app.get("/api/mining/nicehash", async (req, res) => {
  const userScope = resolveStrategyUserScope(req);
  const overview = await getNicehashOverviewData(userScope);
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

let server: ReturnType<typeof app.listen> | null = null;

const shutdown = (): void => {
  strategyScheduler.stop();
  minerPollingService.stop();
  if (!server) {
    process.exit(0);
    return;
  }

  server.close(() => {
    process.exit(0);
  });
};

async function bootstrap(): Promise<void> {
  await strategyRepository.init();

  server = app.listen(port, () => {
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
}

bootstrap().catch((error) => {
  console.error("[bootstrap] Failed to start backend:", error);
  process.exit(1);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

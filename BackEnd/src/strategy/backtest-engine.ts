import { randomUUID } from "node:crypto";
import { StrategyEngine } from "./strategy-engine.js";
import { StrategyRepository } from "./strategy-repository.js";
import { MockHistoricalMarketDataSource } from "./historical-market-data.js";
import { computeBacktestMetrics } from "./performance-metrics.js";
import { detectMarketRegime } from "./strategy-regime.js";
import { buildHistoricalStrategyMarketContext, BTC_CONTEXT_SYMBOLS } from "./strategy-market-context.js";
import { StrategyUserScope } from "./strategy-user-scope.js";
import {
  AllocationMap,
  BacktestRequest,
  BacktestRun,
  BacktestStep,
  CandidateEvaluationRequest,
  HistoricalMarketDataSource,
  MarketSignalSnapshot,
  PortfolioState,
  StrategyConfig,
  StrategyCandidateEvaluationSummary,
  StrategyRiskCheckResult,
} from "./types.js";
import { normalizeAllocation, round, sortSymbols } from "./allocation-utils.js";

interface Holdings {
  [symbol: string]: number;
}

const PREVIEW_CACHE_TTL_MS = Math.max(10_000, Number(process.env.BACKTEST_PREVIEW_CACHE_TTL_MS ?? 60_000) || 60_000);

function addDays(isoDate: string, days: number): string {
  const date = new Date(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function deriveTimeframe(startDate: string, endDate: string): "1h" | "1d" {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  const rangeDays = Math.max(1, Math.round((end - start) / (24 * 60 * 60 * 1000)));
  return rangeDays <= 45 ? "1h" : "1d";
}

function portfolioValueFromHoldings(holdings: Holdings, prices: Record<string, number>): number {
  return Object.entries(holdings).reduce((sum, [symbol, quantity]) => {
    const price = prices[symbol] ?? 0;
    return sum + quantity * price;
  }, 0);
}

function allocationFromHoldings(holdings: Holdings, prices: Record<string, number>): AllocationMap {
  const values: AllocationMap = {};
  const total = portfolioValueFromHoldings(holdings, prices);
  const symbols = sortSymbols(Object.keys(holdings));

  if (total <= 0) {
    return normalizeAllocation({ USDC: 100 }, symbols);
  }

  symbols.forEach((symbol) => {
    values[symbol] = ((holdings[symbol] ?? 0) * (prices[symbol] ?? 0) * 100) / total;
  });

  return normalizeAllocation(values, symbols);
}

function buildPortfolioState(
  timestamp: string,
  holdings: Holdings,
  prices: Record<string, number>,
  signals: MarketSignalSnapshot,
  baseCurrency: string
): PortfolioState {
  const symbols = sortSymbols(Object.keys(holdings));
  const totalValue = portfolioValueFromHoldings(holdings, prices);
  const allocation = allocationFromHoldings(holdings, prices);

  return {
    timestamp,
    baseCurrency,
    totalValue: round(totalValue, 2),
    allocation,
    assets: symbols.map((symbol) => ({
      symbol,
      quantity: round(holdings[symbol] ?? 0, 10),
      price: round(prices[symbol] ?? 0, 8),
      value: round((holdings[symbol] ?? 0) * (prices[symbol] ?? 0), 2),
      allocation: allocation[symbol] ?? 0,
      change24h: (signals.assetIndicators[symbol]?.price_change_24h ?? 0) * 100,
      volume24h: signals.assetIndicators[symbol]?.volume_24h ?? 0,
    })),
  };
}

function applyRebalance(
  holdings: Holdings,
  prices: Record<string, number>,
  targetAllocation: AllocationMap,
  costPct: number,
  slippagePct: number
): { holdings: Holdings; turnoverPct: number; totalValue: number } {
  const totalValue = portfolioValueFromHoldings(holdings, prices);
  if (totalValue <= 0) {
    return { holdings: { ...holdings }, turnoverPct: 0, totalValue: 0 };
  }

  const currentAllocation = allocationFromHoldings(holdings, prices);
  const symbols = sortSymbols([...Object.keys(currentAllocation), ...Object.keys(targetAllocation)]);

  const totalDrift = symbols.reduce((sum, symbol) => {
    const current = currentAllocation[symbol] ?? 0;
    const target = targetAllocation[symbol] ?? 0;
    return sum + Math.abs(target - current);
  }, 0);

  const turnoverPct = totalDrift / 2;
  const turnoverNotional = (turnoverPct / 100) * totalValue;
  const transactionCost = turnoverNotional * (costPct + slippagePct);
  const netValue = Math.max(0, totalValue - transactionCost);

  const nextHoldings: Holdings = {};
  symbols.forEach((symbol) => {
    const price = prices[symbol] ?? 0;
    if (price <= 0) {
      nextHoldings[symbol] = 0;
      return;
    }

    const targetValue = (targetAllocation[symbol] ?? 0) / 100 * netValue;
    nextHoldings[symbol] = targetValue / price;
  });

  return {
    holdings: nextHoldings,
    turnoverPct,
    totalValue: portfolioValueFromHoldings(nextHoldings, prices),
  };
}

export class BacktestEngine {
  private readonly previewCache = new Map<string, { expiresAt: number; history: Array<{ timestamp: string; price: number }> }>();

  constructor(
    private readonly repository: StrategyRepository,
    private readonly strategyEngine = new StrategyEngine(),
    private readonly historicalMarketData: HistoricalMarketDataSource = new MockHistoricalMarketDataSource()
  ) {}

  async getMarketPreview(
    request: Pick<BacktestRequest, "startDate" | "endDate" | "baseCurrency" | "timeframe"> & { symbol?: string }
  ): Promise<Array<{ timestamp: string; price: number }>> {
    const symbol = String(request.symbol ?? "BTC").trim().toUpperCase() || "BTC";
    const cacheKey = JSON.stringify({
      symbol,
      startDate: request.startDate,
      endDate: request.endDate,
      baseCurrency: request.baseCurrency,
      timeframe: request.timeframe,
    });
    const cached = this.previewCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.history.map((point) => ({ ...point }));
    }

    const series = await this.historicalMarketData.getSeries({
      symbols: [symbol],
      startDate: request.startDate,
      endDate: request.endDate,
      timeframe: request.timeframe,
      baseCurrency: request.baseCurrency,
    });

    const history = series.map((point) => ({
      timestamp: point.timestamp,
      price: round(point.prices[symbol] ?? 0, 6),
    }));
    if (this.previewCache.size >= 12) {
      const oldestKey = this.previewCache.keys().next().value;
      if (oldestKey) {
        this.previewCache.delete(oldestKey);
      }
    }
    this.previewCache.set(cacheKey, {
      expiresAt: Date.now() + PREVIEW_CACHE_TTL_MS,
      history,
    });
    return history.map((point) => ({ ...point }));
  }

  async evaluateCandidateStrategy(
    request: CandidateEvaluationRequest,
    userScope?: StrategyUserScope
  ): Promise<StrategyCandidateEvaluationSummary> {
    const strategy = await this.repository.getStrategy(request.strategyId, userScope);
    if (!strategy) {
      throw new Error(`Strategy ${request.strategyId} was not found.`);
    }

    const validationDays = Math.max(7, Math.floor(request.validationDays ?? 45));
    const startTs = new Date(request.startDate).getTime();
    const endTs = new Date(request.endDate).getTime();
    if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || startTs >= endTs) {
      throw new Error("Candidate evaluation requires a valid start and end date.");
    }

    const totalDays = Math.max(1, Math.floor((endTs - startTs) / (24 * 60 * 60 * 1000)));
    if (totalDays <= validationDays + 7) {
      throw new Error("Candidate evaluation window is too short. Keep at least 7 training days before validation.");
    }

    const validationStartDate = addDays(request.endDate, -(validationDays - 1));
    const trainEndDate = addDays(validationStartDate, -1);
    const timeframe = deriveTimeframe(request.startDate, trainEndDate);
    const validationTimeframe = deriveTimeframe(validationStartDate, request.endDate);

    const trainRequest: BacktestRequest = {
      strategyId: request.strategyId,
      startDate: request.startDate,
      endDate: trainEndDate,
      initialCapital: request.initialCapital,
      baseCurrency: request.baseCurrency,
      timeframe,
      rebalanceCostsPct: request.rebalanceCostsPct,
      slippagePct: request.slippagePct,
    };
    const validationRequest: BacktestRequest = {
      strategyId: request.strategyId,
      startDate: validationStartDate,
      endDate: request.endDate,
      initialCapital: request.initialCapital,
      baseCurrency: request.baseCurrency,
      timeframe: validationTimeframe,
      rebalanceCostsPct: request.rebalanceCostsPct,
      slippagePct: request.slippagePct,
    };

    const [trainResult, validationResult] = userScope
      ? await Promise.all([
          this.runBacktest(trainRequest, userScope),
          this.runBacktest(validationRequest, userScope),
        ])
      : await Promise.all([
          this.runBacktest(trainRequest),
          this.runBacktest(validationRequest),
        ]);

    if (trainResult.run.status !== "completed" || validationResult.run.status !== "completed") {
      throw new Error("Candidate evaluation could not complete both train and validation backtests.");
    }

    const riskChecks: StrategyRiskCheckResult[] = [];
    const riskControls = strategy.riskControls ?? {};

    if (riskControls.requireTrainValidationSplit !== false) {
      riskChecks.push({
        name: "train_validation_split",
        passed: new Date(trainEndDate).getTime() > new Date(request.startDate).getTime(),
        message: "Separate training and validation windows were generated.",
      });
    }

    if (riskControls.requirePositiveValidationReturn !== false) {
      const actualValue = validationResult.run.totalReturnPct ?? 0;
      const threshold = riskControls.minValidationReturnPct ?? 0;
      riskChecks.push({
        name: "validation_return",
        passed: actualValue >= threshold,
        actualValue,
        threshold,
        message: `Validation return ${actualValue.toFixed(2)}% vs minimum ${threshold.toFixed(2)}%.`,
      });
    }

    if (typeof riskControls.maxValidationDrawdownPct === "number") {
      const actualValue = validationResult.run.maxDrawdownPct ?? 0;
      const threshold = riskControls.maxValidationDrawdownPct;
      riskChecks.push({
        name: "validation_drawdown",
        passed: actualValue <= threshold,
        actualValue,
        threshold,
        message: `Validation drawdown ${actualValue.toFixed(2)}% vs max ${threshold.toFixed(2)}%.`,
      });
    }

    if (typeof riskControls.maxValidationTurnoverPct === "number") {
      const actualValue = validationResult.run.turnoverPct ?? 0;
      const threshold = riskControls.maxValidationTurnoverPct;
      riskChecks.push({
        name: "validation_turnover",
        passed: actualValue <= threshold,
        actualValue,
        threshold,
        message: `Validation turnover ${actualValue.toFixed(2)}% vs max ${threshold.toFixed(2)}%.`,
      });
    }

    const riskGatePassed = riskChecks.every((check) => check.passed);
    const recommendedApprovalState =
      riskGatePassed
        ? "paper"
        : (validationResult.run.totalReturnPct ?? 0) >= 0
          ? "testing"
          : "rejected";

    const summary: StrategyCandidateEvaluationSummary = {
      id: randomUUID(),
      strategyId: strategy.id,
      strategyVersion: strategy.version,
      createdAt: new Date().toISOString(),
      trainWindow: {
        startDate: request.startDate,
        endDate: trainEndDate,
        timeframe,
      },
      validationWindow: {
        startDate: validationStartDate,
        endDate: request.endDate,
        timeframe: validationTimeframe,
      },
      trainBacktestRunId: trainResult.run.id,
      validationBacktestRunId: validationResult.run.id,
      trainMetrics: {
        finalPortfolioValue: trainResult.run.finalValue ?? request.initialCapital,
        totalReturnPct: trainResult.run.totalReturnPct ?? 0,
        annualizedReturnPct: trainResult.run.annualizedReturnPct ?? 0,
        maxDrawdownPct: trainResult.run.maxDrawdownPct ?? 0,
        turnoverPct: trainResult.run.turnoverPct ?? 0,
        rebalanceCount: trainResult.run.rebalanceCount ?? 0,
        averageStablecoinAllocationPct: trainResult.run.averageStablecoinAllocationPct ?? 0,
      },
      validationMetrics: {
        finalPortfolioValue: validationResult.run.finalValue ?? request.initialCapital,
        totalReturnPct: validationResult.run.totalReturnPct ?? 0,
        annualizedReturnPct: validationResult.run.annualizedReturnPct ?? 0,
        maxDrawdownPct: validationResult.run.maxDrawdownPct ?? 0,
        turnoverPct: validationResult.run.turnoverPct ?? 0,
        rebalanceCount: validationResult.run.rebalanceCount ?? 0,
        averageStablecoinAllocationPct: validationResult.run.averageStablecoinAllocationPct ?? 0,
      },
      riskChecks,
      riskGatePassed,
      recommendedApprovalState,
      notes: [
        "Training and validation backtests reuse the same deterministic strategy engine as live evaluation.",
        "Historical replay still uses the current built-in mock market data source.",
      ],
    };

    await this.repository.saveStrategyEvaluation(summary, userScope);
    return summary;
  }

  async runBacktest(request: BacktestRequest): Promise<{
    run: BacktestRun;
    steps: BacktestStep[];
  }>;
  async runBacktest(request: BacktestRequest, userScope: StrategyUserScope): Promise<{
    run: BacktestRun;
    steps: BacktestStep[];
  }>;
  async runBacktest(request: BacktestRequest, userScope?: StrategyUserScope): Promise<{
    run: BacktestRun;
    steps: BacktestStep[];
  }> {
    const strategy = await this.repository.getStrategy(request.strategyId, userScope);
    if (!strategy) {
      throw new Error(`Strategy ${request.strategyId} was not found.`);
    }
    const strategyUniverse = (await this.repository.listStrategies(userScope)).reduce<Record<string, StrategyConfig>>(
      (acc, item) => {
        acc[item.id] = item;
        return acc;
      },
      {}
    );

    const run = await this.repository.createBacktestRun({
      strategyId: request.strategyId,
      startDate: request.startDate,
      endDate: request.endDate,
      initialCapital: request.initialCapital,
      status: "running",
    }, userScope);

    try {
      const portfolioSymbols = sortSymbols([...Object.keys(strategy.baseAllocation), request.baseCurrency]);
      const seriesSymbols = sortSymbols([...portfolioSymbols, ...BTC_CONTEXT_SYMBOLS]);
      const series = await this.historicalMarketData.getSeries({
        symbols: seriesSymbols,
        startDate: request.startDate,
        endDate: request.endDate,
        timeframe: request.timeframe,
        baseCurrency: request.baseCurrency,
      });

      if (series.length === 0) {
        throw new Error("Historical market data provider returned an empty series.");
      }

      const firstPoint = series[0];
      const initialTarget = normalizeAllocation(strategy.baseAllocation, portfolioSymbols);
      let holdings: Holdings = portfolioSymbols.reduce<Holdings>((acc, symbol) => {
        const price = firstPoint.prices[symbol] ?? 0;
        const targetValue = (initialTarget[symbol] ?? 0) / 100 * request.initialCapital;
        acc[symbol] = price > 0 ? targetValue / price : 0;
        return acc;
      }, {});

      let peakValue = request.initialCapital;
      const steps: BacktestStep[] = [];

      for (let pointIndex = 0; pointIndex < series.length; pointIndex += 1) {
        const point = series[pointIndex];
        const portfolioBefore = buildPortfolioState(
          point.timestamp,
          holdings,
          point.prices,
          point.signals,
          request.baseCurrency
        );
        const marketContext = buildHistoricalStrategyMarketContext({
          points: series,
          pointIndex,
          marketRegime: detectMarketRegime(point.signals),
        });

        const evaluation = this.strategyEngine.evaluate({
          strategy,
          portfolio: portfolioBefore,
          marketSignals: point.signals,
          marketContext,
          strategyUniverse,
        });

        let turnoverPct = 0;
        if (evaluation.rebalancePlan.rebalanceRequired) {
          const rebalance = applyRebalance(
            holdings,
            point.prices,
            evaluation.adjustedTargetAllocation,
            request.rebalanceCostsPct,
            request.slippagePct
          );

          holdings = rebalance.holdings;
          turnoverPct = rebalance.turnoverPct;
        }

        const portfolioAfter = buildPortfolioState(
          point.timestamp,
          holdings,
          point.prices,
          point.signals,
          request.baseCurrency
        );

        peakValue = Math.max(peakValue, portfolioAfter.totalValue);
        const drawdownPct = peakValue <= 0 ? 0 : ((peakValue - portfolioAfter.totalValue) / peakValue) * 100;

        steps.push({
          id: randomUUID(),
          backtestRunId: run.id,
          timestamp: point.timestamp,
          portfolioValue: round(portfolioAfter.totalValue, 2),
          allocationSnapshot: portfolioAfter.allocation,
          signalsSnapshot: point.signals,
          actionsTaken: evaluation.executionPlan.recommendedTrades,
          rebalanceRequired: evaluation.rebalancePlan.rebalanceRequired,
          turnoverPct: round(turnoverPct, 4),
          drawdownPct: round(Math.max(0, drawdownPct), 4),
        });
      }

      await this.repository.appendBacktestSteps(steps, userScope);

      const metrics = computeBacktestMetrics({
        initialCapital: request.initialCapital,
        startDate: request.startDate,
        endDate: request.endDate,
        steps,
      });

      const completed = await this.repository.updateBacktestRun(run.id, {
        status: "completed",
        finalValue: metrics.finalPortfolioValue,
        totalReturnPct: metrics.totalReturnPct,
        annualizedReturnPct: metrics.annualizedReturnPct,
        maxDrawdownPct: metrics.maxDrawdownPct,
        turnoverPct: metrics.turnoverPct,
        rebalanceCount: metrics.rebalanceCount,
        averageStablecoinAllocationPct: metrics.averageStablecoinAllocationPct,
        completedAt: new Date().toISOString(),
      }, userScope);

      if (!completed) {
        throw new Error(`Backtest run ${run.id} was not found during completion update.`);
      }

      return {
        run: completed,
        steps,
      };
    } catch (error) {
      const failed = await this.repository.updateBacktestRun(run.id, {
        status: "failed",
        error: error instanceof Error ? error.message : "Backtest failed.",
        completedAt: new Date().toISOString(),
      }, userScope);

      if (!failed) {
        throw error;
      }

      return {
        run: failed,
        steps: [],
      };
    }
  }
}

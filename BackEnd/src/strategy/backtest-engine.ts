import { randomUUID } from "node:crypto";
import { StrategyEngine } from "./strategy-engine.js";
import { StrategyRepository } from "./strategy-repository.js";
import { MockHistoricalMarketDataSource } from "./historical-market-data.js";
import { computeBacktestMetrics } from "./performance-metrics.js";
import { StrategyUserScope } from "./strategy-user-scope.js";
import {
  AllocationMap,
  BacktestRequest,
  BacktestRun,
  BacktestStep,
  HistoricalMarketDataSource,
  MarketSignalSnapshot,
  PortfolioState,
  StrategyConfig,
} from "./types.js";
import { normalizeAllocation, round, sortSymbols } from "./allocation-utils.js";

interface Holdings {
  [symbol: string]: number;
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
  constructor(
    private readonly repository: StrategyRepository,
    private readonly strategyEngine = new StrategyEngine(),
    private readonly historicalMarketData: HistoricalMarketDataSource = new MockHistoricalMarketDataSource()
  ) {}

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
      const symbols = sortSymbols([...Object.keys(strategy.baseAllocation), request.baseCurrency]);
      const series = await this.historicalMarketData.getSeries({
        symbols,
        startDate: request.startDate,
        endDate: request.endDate,
        timeframe: request.timeframe,
        baseCurrency: request.baseCurrency,
      });

      if (series.length === 0) {
        throw new Error("Historical market data provider returned an empty series.");
      }

      const firstPoint = series[0];
      const initialTarget = normalizeAllocation(strategy.baseAllocation, symbols);
      let holdings: Holdings = symbols.reduce<Holdings>((acc, symbol) => {
        const price = firstPoint.prices[symbol] ?? 0;
        const targetValue = (initialTarget[symbol] ?? 0) / 100 * request.initialCapital;
        acc[symbol] = price > 0 ? targetValue / price : 0;
        return acc;
      }, {});

      let peakValue = request.initialCapital;
      const steps: BacktestStep[] = [];

      for (const point of series) {
        const portfolioBefore = buildPortfolioState(
          point.timestamp,
          holdings,
          point.prices,
          point.signals,
          request.baseCurrency
        );

        const evaluation = this.strategyEngine.evaluate({
          strategy,
          portfolio: portfolioBefore,
          marketSignals: point.signals,
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

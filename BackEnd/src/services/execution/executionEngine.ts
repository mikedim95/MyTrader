import { ExchangeMarketService } from "../exchanges/exchangeMarketService.js";
import { calculateSpreadAbsolute, calculateSpreadPercent } from "../exchanges/types.js";
import { OrderSimulator, type ConsolidatedMarketSnapshot } from "./orderSimulator.js";
import { evaluateGuardrails, type GuardrailEvaluation } from "../risk/guardrails.js";
import { PerformanceTracker, type PaperPortfolioState } from "../learning/performanceTracker.js";
import { SignalProcessor, type ProcessedTradeSignal, type TradeSignal } from "../signals/signalProcessor.js";
import type { StrategyUserScope } from "../../strategy/strategy-user-scope.js";

export interface ExecutionSimulationResponse {
  allowed: boolean;
  blockReason?: string;
  execution: {
    id: string;
    signalId: string;
    symbol: string;
    action: "buy" | "sell";
    status: "filled" | "blocked";
    confidence: number;
    reason: string;
    size: number;
    notionalUsd: number;
    avgFillPrice: number | null;
    referencePrice: number;
    slippage: number | null;
    method: "limit+fallback" | null;
    executionTimeMs: number | null;
    explanation: string;
    bestBid: number;
    bestAsk: number;
    spreadPercent: number;
    chunks: Array<{
      index: number;
      size: number;
      limitPrice: number;
      fillPrice: number;
      outcome: "limit_fill" | "market_fallback";
      waitTimeMs: number;
    }>;
  };
  guardrails: GuardrailEvaluation;
  portfolio: PaperPortfolioState;
  generatedAt: string;
}

const EPSILON = 1e-8;

function round(value: number, digits = 8): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function resolveTargetNotionalUsd(signal: ProcessedTradeSignal, portfolio: PaperPortfolioState, market: ConsolidatedMarketSnapshot): number {
  const equity = Math.max(portfolio.totalEquityUSD, portfolio.balanceUSD, 0);
  const currentPosition = portfolio.positions.find((position) => position.symbol === signal.symbol);
  const currentPositionValue = currentPosition?.marketValue ?? ((currentPosition?.size ?? 0) * market.last);

  if (signal.action === "buy") {
    const desired = equity * (0.04 + signal.confidence * 0.08);
    return round(Math.min(desired, portfolio.balanceUSD), 2);
  }

  if (!currentPosition || currentPositionValue <= EPSILON) {
    return 0;
  }

  return round(currentPositionValue * Math.max(0.25, signal.confidence), 2);
}

function buildConsolidatedMarketSnapshot(
  tickers: Awaited<ReturnType<ExchangeMarketService["getTickers"]>>,
  orderBooks: Awaited<ReturnType<ExchangeMarketService["getOrderBookSummaries"]>> | null,
): ConsolidatedMarketSnapshot {
  const bestBidTicker = tickers.reduce((current, candidate) => (candidate.bid > current.bid ? candidate : current), tickers[0]);
  const bestAskTicker = tickers.reduce((current, candidate) => (candidate.ask < current.ask ? candidate : current), tickers[0]);
  const bestBidOrderBook = orderBooks?.find((entry) => entry.exchange === bestBidTicker.exchange);
  const bestAskOrderBook = orderBooks?.find((entry) => entry.exchange === bestAskTicker.exchange);
  const last =
    tickers.length > 0 ? round(tickers.reduce((sum, ticker) => sum + ticker.last, 0) / tickers.length, 8) : bestAskTicker.last;
  const bestBid = bestBidTicker.bid;
  const bestAsk = bestAskTicker.ask;

  return {
    symbol: bestBidTicker.symbol,
    bestBid,
    bestAsk,
    last,
    spreadAbsolute: calculateSpreadAbsolute(bestBid, bestAsk),
    spreadPercent: calculateSpreadPercent(bestBid, bestAsk),
    topBidVolume: round(bestBidOrderBook?.topBidVolume ?? 0, 8),
    topAskVolume: round(bestAskOrderBook?.topAskVolume ?? 0, 8),
    totalBidVolumeTopN: round(bestBidOrderBook?.totalBidVolumeTopN ?? 0, 8),
    totalAskVolumeTopN: round(bestAskOrderBook?.totalAskVolumeTopN ?? 0, 8),
    bestBidExchange: bestBidTicker.exchange,
    bestAskExchange: bestAskTicker.exchange,
    timestamp:
      bestBidOrderBook?.timestamp ??
      bestAskOrderBook?.timestamp ??
      bestBidTicker.timestamp ??
      bestAskTicker.timestamp,
  };
}

function buildBlockedExplanation(reason: string): string {
  return `Signal blocked before simulation: ${reason}`;
}

function buildFilledExplanation(signal: ProcessedTradeSignal, market: ConsolidatedMarketSnapshot): string {
  return `Simulated ${signal.action.toUpperCase()} split into three limit attempts inside a ${market.spreadPercent.toFixed(4)}% spread, with market fallback when limits did not fill.`;
}

export class ExecutionEngine {
  constructor(
    private readonly exchangeMarketService: ExchangeMarketService,
    private readonly signalProcessor: SignalProcessor,
    private readonly orderSimulator: OrderSimulator,
    private readonly performanceTracker: PerformanceTracker,
  ) {}

  async simulate(rawSignal: TradeSignal, scope?: StrategyUserScope): Promise<ExecutionSimulationResponse> {
    await this.performanceTracker.runOutcomeEvaluationPass();

    const signal = this.signalProcessor.prepare(rawSignal);
    const [tickers, orderBooksResult] = await Promise.all([
      this.exchangeMarketService.getTickers(signal.symbol),
      this.exchangeMarketService.getOrderBookSummaries(signal.symbol, 10).catch(() => null),
    ]);
    const market = buildConsolidatedMarketSnapshot(tickers, orderBooksResult);
    const portfolio = await this.performanceTracker.getOrCreatePortfolio(scope, new Map([[signal.symbol, market.last]]));
    const targetNotionalUsd = resolveTargetNotionalUsd(signal, portfolio, market);
    const targetSize = market.last > 0 ? round(targetNotionalUsd / market.last, 10) : 0;
    const [dailyLossPercent, recentSignals] = await Promise.all([
      this.performanceTracker.getDailyLossPercent(scope),
      this.performanceTracker.listRecentSignals(scope, signal.symbol),
    ]);
    const guardrails = evaluateGuardrails(signal, portfolio, {
      marketPrice: market.last,
      proposedSize: targetSize,
      proposedNotionalUSD: targetNotionalUsd,
      dailyLossPercent,
      recentSignals,
      now: signal.timestamp,
    });

    if (!guardrails.allowed) {
      const blocked = await this.performanceTracker.recordBlockedExecution({
        signal,
        scope,
        size: targetSize,
        notionalUsd: targetNotionalUsd,
        referencePrice: signal.action === "buy" ? market.bestAsk : market.bestBid,
        blockReason: guardrails.reason ?? "Guardrails blocked the signal.",
      });
      const nextPortfolio = await this.performanceTracker.getOrCreatePortfolio(scope, new Map([[signal.symbol, market.last]]));

      return {
        allowed: false,
        blockReason: guardrails.reason,
        execution: {
          id: blocked.id,
          signalId: signal.id,
          symbol: signal.symbol,
          action: signal.action,
          status: "blocked",
          confidence: signal.confidence,
          reason: signal.reason,
          size: targetSize,
          notionalUsd: targetNotionalUsd,
          avgFillPrice: null,
          referencePrice: signal.action === "buy" ? market.bestAsk : market.bestBid,
          slippage: null,
          method: null,
          executionTimeMs: null,
          explanation: buildBlockedExplanation(guardrails.reason ?? "Guardrails blocked the signal."),
          bestBid: market.bestBid,
          bestAsk: market.bestAsk,
          spreadPercent: market.spreadPercent,
          chunks: [],
        },
        guardrails,
        portfolio: nextPortfolio,
        generatedAt: new Date().toISOString(),
      };
    }

    const simulation = this.orderSimulator.simulate({
      signalId: signal.id,
      action: signal.action,
      size: targetSize,
      market,
    });
    const referencePrice = signal.action === "buy" ? market.bestAsk : market.bestBid;
    const currentPosition = portfolio.positions.find((position) => position.symbol === signal.symbol);
    const realizedPnl =
      signal.action === "sell" && currentPosition
        ? round((simulation.avgFillPrice - currentPosition.avgEntry) * simulation.filledSize, 8)
        : 0;
    const filledRecord = await this.performanceTracker.recordFilledExecution({
      signal,
      scope,
      size: simulation.filledSize,
      notionalUsd: round(simulation.avgFillPrice * simulation.filledSize, 8),
      avgPrice: simulation.avgFillPrice,
      referencePrice,
      slippage: simulation.slippage,
      method: simulation.method,
      executionTimeMs: simulation.executionTimeMs,
      chunks: simulation.chunks,
      realizedPnl,
    });
    const nextPortfolio = await this.performanceTracker.getOrCreatePortfolio(scope, new Map([[signal.symbol, market.last]]));

    return {
      allowed: true,
      execution: {
        id: filledRecord.id,
        signalId: signal.id,
        symbol: signal.symbol,
        action: signal.action,
        status: "filled",
        confidence: signal.confidence,
        reason: signal.reason,
        size: simulation.filledSize,
        notionalUsd: round(simulation.avgFillPrice * simulation.filledSize, 2),
        avgFillPrice: simulation.avgFillPrice,
        referencePrice,
        slippage: simulation.slippage,
        method: simulation.method,
        executionTimeMs: simulation.executionTimeMs,
        explanation: buildFilledExplanation(signal, market),
        bestBid: market.bestBid,
        bestAsk: market.bestAsk,
        spreadPercent: market.spreadPercent,
        chunks: simulation.chunks,
      },
      guardrails,
      portfolio: nextPortfolio,
      generatedAt: new Date().toISOString(),
    };
  }
}

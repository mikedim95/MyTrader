import { createHash } from "node:crypto";
import type { TradeSignalAction } from "../signals/signalProcessor.js";

export interface ConsolidatedMarketSnapshot {
  symbol: string;
  bestBid: number;
  bestAsk: number;
  last: number;
  spreadAbsolute: number;
  spreadPercent: number;
  topBidVolume: number;
  topAskVolume: number;
  totalBidVolumeTopN: number;
  totalAskVolumeTopN: number;
  bestBidExchange?: string | null;
  bestAskExchange?: string | null;
  timestamp: string;
}

export interface SimulatedExecutionChunk {
  index: number;
  size: number;
  limitPrice: number;
  fillPrice: number;
  outcome: "limit_fill" | "market_fallback";
  waitTimeMs: number;
}

export interface OrderSimulationRequest {
  signalId: string;
  action: TradeSignalAction;
  size: number;
  market: ConsolidatedMarketSnapshot;
}

export interface OrderSimulationResult {
  avgFillPrice: number;
  slippage: number;
  filledSize: number;
  executionTimeMs: number;
  method: "limit+fallback";
  chunks: SimulatedExecutionChunk[];
}

function round(value: number, digits = 8): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function deterministicFraction(seed: string): number {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 8);
  return parseInt(hex, 16) / 0xffffffff;
}

function splitIntoThree(size: number): number[] {
  const first = round(size / 3, 8);
  const second = round(size / 3, 8);
  const third = round(size - first - second, 8);
  return [first, second, third].filter((value) => value > 0);
}

export class OrderSimulator {
  simulate(request: OrderSimulationRequest): OrderSimulationResult {
    const sizes = splitIntoThree(request.size);
    const chunks: SimulatedExecutionChunk[] = [];
    const referenceTouch = request.action === "buy" ? request.market.bestAsk : request.market.bestBid;
    const spreadImprovement = Math.min(
      request.action === "buy" ? request.market.bestAsk * 0.001 : request.market.bestBid * 0.001,
      request.market.spreadAbsolute * 0.8,
    );

    let weightedTotal = 0;
    let filledTotal = 0;
    let elapsedMs = 0;

    sizes.forEach((chunkSize, index) => {
      const waitTimeMs = 400 + index * 250;
      const insideSpreadPrice =
        request.action === "buy"
          ? Math.max(request.market.bestBid, request.market.bestAsk - spreadImprovement)
          : Math.min(request.market.bestAsk, request.market.bestBid + spreadImprovement);
      const limitPrice = round(insideSpreadPrice, 2);
      const topVolume = request.action === "buy" ? request.market.topAskVolume : request.market.topBidVolume;
      const depthVolume = request.action === "buy" ? request.market.totalAskVolumeTopN : request.market.totalBidVolumeTopN;
      const immediateFill =
        request.action === "buy"
          ? request.market.last <= limitPrice || request.market.bestAsk <= limitPrice
          : request.market.last >= limitPrice || request.market.bestBid >= limitPrice;

      const spreadFactor = clamp(1 - request.market.spreadPercent / 0.35, 0, 1);
      const topLiquidityFactor = clamp(topVolume / Math.max(chunkSize, 0.00000001), 0, 2) / 2;
      const depthLiquidityFactor = clamp(depthVolume / Math.max(request.size, 0.00000001), 0, 2) / 2;
      const fillProbability = clamp(
        0.35 + spreadFactor * 0.25 + topLiquidityFactor * 0.2 + depthLiquidityFactor * 0.12 - index * 0.08,
        0.15,
        0.92,
      );
      const fillsOnLimit = immediateFill || deterministicFraction(`${request.signalId}:${index}`) <= fillProbability;
      const fallbackPrice =
        request.action === "buy"
          ? round(request.market.bestAsk * (1 + 0.0002 * (index + 1)), 2)
          : round(request.market.bestBid * (1 - 0.0002 * (index + 1)), 2);
      const fillPrice = fillsOnLimit ? limitPrice : fallbackPrice;

      elapsedMs += fillsOnLimit ? waitTimeMs : waitTimeMs + 300;
      weightedTotal += fillPrice * chunkSize;
      filledTotal += chunkSize;

      chunks.push({
        index: index + 1,
        size: round(chunkSize, 8),
        limitPrice,
        fillPrice,
        outcome: fillsOnLimit ? "limit_fill" : "market_fallback",
        waitTimeMs: fillsOnLimit ? waitTimeMs : waitTimeMs + 300,
      });
    });

    const avgFillPrice = filledTotal > 0 ? round(weightedTotal / filledTotal, 8) : referenceTouch;
    const slippage =
      request.action === "buy"
        ? round(((avgFillPrice - referenceTouch) / referenceTouch) * 100, 6)
        : round(((referenceTouch - avgFillPrice) / referenceTouch) * 100, 6);

    return {
      avgFillPrice,
      slippage,
      filledSize: round(filledTotal, 8),
      executionTimeMs: elapsedMs,
      method: "limit+fallback",
      chunks,
    };
  }
}

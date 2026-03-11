import {
  HistoricalMarketDataRequest,
  HistoricalMarketDataSource,
  HistoricalMarketPoint,
  MarketSignalSnapshot,
} from "./types.js";
import { round, toUpperSymbol } from "./allocation-utils.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function hashToUnit(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return ((hash >>> 0) % 10_000) / 10_000;
}

function buildTimestamps(startIso: string, endIso: string, timeframe: "1h" | "1d"): string[] {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const step = timeframe === "1h" ? HOUR_MS : DAY_MS;

  const values: string[] = [];
  for (let current = start; current <= end; current += step) {
    values.push(new Date(current).toISOString());
  }

  if (values.length === 0) {
    values.push(new Date(start).toISOString());
  }

  return values;
}

function basePriceForSymbol(symbol: string): number {
  if (symbol === "BTC") return 55_000;
  if (symbol === "ETH") return 3_100;
  if (symbol === "BNB") return 510;
  if (symbol === "SOL") return 150;
  if (symbol === "ADA") return 0.65;
  if (symbol === "USDC" || symbol === "USDT") return 1;
  return 25;
}

function buildPrice(symbol: string, stepIndex: number, totalSteps: number): number {
  const base = basePriceForSymbol(symbol);
  const seasonal = Math.sin((stepIndex / Math.max(1, totalSteps - 1)) * Math.PI * 4) * 0.08;
  const trend = (stepIndex / Math.max(1, totalSteps - 1) - 0.5) * 0.12;
  const noise = (hashToUnit(`${symbol}:${stepIndex}`) - 0.5) * 0.03;

  const multiplier = 1 + seasonal + trend + noise;
  if (symbol === "USDC" || symbol === "USDT") {
    return round(1 + noise * 0.005, 5);
  }

  return round(Math.max(base * 0.1, base * multiplier), 6);
}

function buildVolume(symbol: string, stepIndex: number): number {
  const baseVolume = symbol === "BTC" ? 25_000_000_000 : symbol === "ETH" ? 12_000_000_000 : 3_000_000_000;
  const wave = Math.cos(stepIndex / 7) * 0.1;
  const noise = (hashToUnit(`vol:${symbol}:${stepIndex}`) - 0.5) * 0.15;
  return Math.max(1, round(baseVolume * (1 + wave + noise), 2));
}

function buildSignals(
  symbols: string[],
  prices: Record<string, number>,
  previousPrices: Record<string, number> | null,
  volumes: Record<string, number>,
  stepIndex: number,
  totalSteps: number,
  timestamp: string
): MarketSignalSnapshot {
  const assetIndicators: MarketSignalSnapshot["assetIndicators"] = {};

  symbols.forEach((symbol) => {
    const current = prices[symbol];
    const previous = previousPrices?.[symbol] ?? current;
    const priceChange = previous === 0 ? 0 : (current - previous) / previous;
    const volumeChange = (hashToUnit(`vc:${symbol}:${stepIndex}`) - 0.5) * 0.4;

    assetIndicators[symbol] = {
      price_change_24h: round(priceChange, 6),
      volume_change: round(volumeChange, 6),
      asset_trend: round(Math.sign(priceChange), 4),
      volume_24h: volumes[symbol],
      drawdown_pct: round(Math.max(0, -priceChange), 6),
    };
  });

  const nonStable = symbols.filter((symbol) => symbol !== "USDC" && symbol !== "USDT");
  const rankedByReturn = [...nonStable].sort((left, right) => {
    const leftReturn = assetIndicators[left]?.price_change_24h ?? 0;
    const rightReturn = assetIndicators[right]?.price_change_24h ?? 0;
    if (rightReturn !== leftReturn) return rightReturn - leftReturn;
    return left.localeCompare(right);
  });
  const rankDenominator = Math.max(1, rankedByReturn.length - 1);
  rankedByReturn.forEach((symbol, index) => {
    const score = rankedByReturn.length <= 1 ? 1 : (rankDenominator - index) / rankDenominator;
    assetIndicators[symbol] = {
      ...assetIndicators[symbol],
      relative_strength: round(score, 6),
    };
  });

  symbols
    .filter((symbol) => symbol === "USDC" || symbol === "USDT")
    .forEach((symbol) => {
      assetIndicators[symbol] = {
        ...assetIndicators[symbol],
        relative_strength: 0.5,
      };
    });

  const averageAbsReturn =
    nonStable.length === 0
      ? 0
      : nonStable.reduce((sum, symbol) => sum + Math.abs(assetIndicators[symbol].price_change_24h ?? 0), 0) / nonStable.length;
  const drawdownPct =
    nonStable.length === 0
      ? 0
      : nonStable.reduce((sum, symbol) => sum + (assetIndicators[symbol].drawdown_pct ?? 0), 0) / nonStable.length;

  const btcPrice = prices.BTC ?? 1;
  const altBasket = symbols
    .filter((symbol) => symbol !== "BTC" && symbol !== "USDC" && symbol !== "USDT")
    .reduce((sum, symbol) => sum + prices[symbol], 0);
  const btcDominance = btcPrice / Math.max(1, btcPrice + altBasket);

  const marketDirection = nonStable.length
    ? nonStable.reduce((sum, symbol) => sum + (assetIndicators[symbol].price_change_24h ?? 0), 0) / nonStable.length
    : 0;

  return {
    timestamp,
    indicators: {
      volatility: round(averageAbsReturn, 6),
      btc_dominance: round(btcDominance, 6),
      market_direction: round(Math.sign(marketDirection), 2),
      drawdown_pct: round(drawdownPct, 6),
      progress_ratio: round(stepIndex / Math.max(1, totalSteps - 1), 6),
    },
    assetIndicators,
  };
}

export class MockHistoricalMarketDataSource implements HistoricalMarketDataSource {
  async getSeries(request: HistoricalMarketDataRequest): Promise<HistoricalMarketPoint[]> {
    const symbols = Array.from(new Set(request.symbols.map(toUpperSymbol))).sort((left, right) =>
      left.localeCompare(right)
    );

    const timestamps = buildTimestamps(request.startDate, request.endDate, request.timeframe);
    const points: HistoricalMarketPoint[] = [];
    let previousPrices: Record<string, number> | null = null;

    timestamps.forEach((timestamp, stepIndex) => {
      const prices: Record<string, number> = {};
      const volumes: Record<string, number> = {};

      symbols.forEach((symbol) => {
        prices[symbol] = buildPrice(symbol, stepIndex, timestamps.length);
        volumes[symbol] = buildVolume(symbol, stepIndex);
      });

      const signals = buildSignals(
        symbols,
        prices,
        previousPrices,
        volumes,
        stepIndex,
        timestamps.length,
        timestamp
      );

      points.push({
        timestamp,
        prices,
        volumes,
        signals,
      });

      previousPrices = prices;
    });

    return points;
  }
}

import { fetchHistoricalCandles } from "../publicMarketData.js";
import { round, toUpperSymbol } from "./allocation-utils.js";
import { StrategyRepository } from "./strategy-repository.js";
import {
  HistoricalCandle,
  HistoricalCandleProvider,
  HistoricalMarketDataRequest,
  HistoricalMarketDataSource,
  HistoricalMarketPoint,
  MarketSignalSnapshot,
} from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const STABLE_PRICE_SYMBOLS = new Set(["USDC", "USDT", "FDUSD", "BUSD", "DAI"]);
const RETENTION_DAYS = Math.max(90, Number.parseInt(String(process.env.HISTORICAL_CANDLE_RETENTION_DAYS ?? "540"), 10) || 540);
const REQUEST_DELAY_MS = Math.max(
  100,
  Number.parseInt(String(process.env.HISTORICAL_CANDLE_REQUEST_DELAY_MS ?? "250"), 10) || 250
);
const MAX_RETRIES = Math.max(
  1,
  Number.parseInt(String(process.env.HISTORICAL_CANDLE_MAX_RETRIES ?? "3"), 10) || 3
);
const FETCH_LIMIT = Math.min(
  1000,
  Math.max(100, Number.parseInt(String(process.env.HISTORICAL_CANDLE_FETCH_LIMIT ?? "500"), 10) || 500)
);
const RETRY_BASE_DELAY_MS = Math.max(
  250,
  Number.parseInt(String(process.env.HISTORICAL_CANDLE_RETRY_BASE_DELAY_MS ?? "750"), 10) || 750
);

function hashToUnit(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return ((hash >>> 0) % 10_000) / 10_000;
}

function intervalToMs(interval: "1h" | "1d"): number {
  return interval === "1h" ? HOUR_MS : DAY_MS;
}

function alignOpenTime(timestampMs: number, interval: "1h" | "1d"): number {
  const step = intervalToMs(interval);
  return Math.floor(timestampMs / step) * step;
}

function buildExpectedOpenTimes(startTime: number, endTime: number, interval: "1h" | "1d"): number[] {
  const step = intervalToMs(interval);
  const start = alignOpenTime(startTime, interval);
  const end = alignOpenTime(endTime, interval);
  const values: number[] = [];

  for (let current = start; current <= end; current += step) {
    values.push(current);
  }

  if (values.length === 0) {
    values.push(start);
  }

  return values;
}

function buildTimestamps(startIso: string, endIso: string, timeframe: "1h" | "1d"): string[] {
  return buildExpectedOpenTimes(new Date(startIso).getTime(), new Date(endIso).getTime(), timeframe).map((timestamp) =>
    new Date(timestamp).toISOString()
  );
}

function basePriceForSymbol(symbol: string): number {
  if (symbol === "BTC") return 55_000;
  if (symbol === "ETH") return 3_100;
  if (symbol === "XRP") return 0.65;
  if (symbol === "SOL") return 150;
  if (symbol === "ADA") return 0.65;
  if (STABLE_PRICE_SYMBOLS.has(symbol)) return 1;
  return 25;
}

function buildPrice(symbol: string, stepIndex: number, totalSteps: number): number {
  const base = basePriceForSymbol(symbol);
  const seasonal = Math.sin((stepIndex / Math.max(1, totalSteps - 1)) * Math.PI * 4) * 0.08;
  const trend = (stepIndex / Math.max(1, totalSteps - 1) - 0.5) * 0.12;
  const noise = (hashToUnit(`${symbol}:${stepIndex}`) - 0.5) * 0.03;

  const multiplier = 1 + seasonal + trend + noise;
  if (STABLE_PRICE_SYMBOLS.has(symbol)) {
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
    const volumeChange = previousPrices ? (hashToUnit(`vc:${symbol}:${stepIndex}`) - 0.5) * 0.4 : 0;

    assetIndicators[symbol] = {
      price_change_24h: round(priceChange, 6),
      volume_change: round(volumeChange, 6),
      asset_trend: round(Math.sign(priceChange), 4),
      volume_24h: volumes[symbol],
      drawdown_pct: round(Math.max(0, -priceChange), 6),
    };
  });

  const nonStable = symbols.filter((symbol) => !STABLE_PRICE_SYMBOLS.has(symbol));
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
    .filter((symbol) => STABLE_PRICE_SYMBOLS.has(symbol))
    .forEach((symbol) => {
      assetIndicators[symbol] = {
        ...assetIndicators[symbol],
        relative_strength: 0.5,
      };
    });

  const averageAbsReturn =
    nonStable.length === 0
      ? 0
      : nonStable.reduce((sum, symbol) => sum + Math.abs(assetIndicators[symbol].price_change_24h ?? 0), 0) /
        nonStable.length;
  const drawdownPct =
    nonStable.length === 0
      ? 0
      : nonStable.reduce((sum, symbol) => sum + (assetIndicators[symbol].drawdown_pct ?? 0), 0) / nonStable.length;

  const btcPrice = prices.BTC ?? 1;
  const altBasket = symbols
    .filter((symbol) => symbol !== "BTC" && !STABLE_PRICE_SYMBOLS.has(symbol))
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

function groupMissingRanges(openTimes: number[], existing: Map<number, HistoricalCandle>): Array<{ startTime: number; endTime: number }> {
  const gaps: Array<{ startTime: number; endTime: number }> = [];
  let gapStart: number | null = null;
  let gapEnd: number | null = null;

  openTimes.forEach((openTime) => {
    if (existing.has(openTime)) {
      if (gapStart !== null && gapEnd !== null) {
        gaps.push({ startTime: gapStart, endTime: gapEnd });
      }
      gapStart = null;
      gapEnd = null;
      return;
    }

    if (gapStart === null) {
      gapStart = openTime;
    }
    gapEnd = openTime;
  });

  if (gapStart !== null && gapEnd !== null) {
    gaps.push({ startTime: gapStart, endTime: gapEnd });
  }

  return gaps;
}

function normalizeFetchedCandle(symbol: string, interval: "1h" | "1d", row: unknown): HistoricalCandle | null {
  if (!Array.isArray(row) || row.length < 7) {
    return null;
  }

  const openTime = Number(row[0]);
  const open = Number(row[1]);
  const high = Number(row[2]);
  const low = Number(row[3]);
  const close = Number(row[4]);
  const volume = Number(row[5]);
  const closeTime = Number(row[6]);

  if (
    !Number.isFinite(openTime) ||
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close) ||
    !Number.isFinite(volume) ||
    !Number.isFinite(closeTime) ||
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0 ||
    volume < 0
  ) {
    return null;
  }

  return {
    symbol,
    interval,
    openTime,
    open,
    high,
    low,
    close,
    volume,
    closeTime,
  };
}

function buildSyntheticStableCandles(
  symbol: string,
  interval: "1h" | "1d",
  startTime: number,
  endTime: number
): HistoricalCandle[] {
  const step = intervalToMs(interval);
  return buildExpectedOpenTimes(startTime, endTime, interval).map((openTime) => ({
    symbol,
    interval,
    openTime,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 0,
    closeTime: openTime + step - 1,
  }));
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class PersistedHistoricalCandleProvider implements HistoricalCandleProvider {
  private lastRequestAt = 0;
  private lastPruneAt = 0;

  constructor(private readonly repository: StrategyRepository) {}

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < REQUEST_DELAY_MS) {
      await wait(REQUEST_DELAY_MS - elapsed);
    }
    this.lastRequestAt = Date.now();
  }

  private async pruneRetentionIfNeeded(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPruneAt < HOUR_MS) {
      return;
    }
    this.lastPruneAt = now;
    const retentionBeforeTime = now - RETENTION_DAYS * DAY_MS;
    await this.repository.pruneHistoricalCandles(retentionBeforeTime);
  }

  private async fetchGap(
    symbol: string,
    interval: "1h" | "1d",
    startTime: number,
    endTime: number
  ): Promise<HistoricalCandle[]> {
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
      attempt += 1;
      try {
        await this.throttle();
        return await fetchHistoricalCandles(symbol, interval, startTime, endTime);
      } catch (error) {
        if (attempt >= MAX_RETRIES) {
          throw new Error(
            `Failed to fetch ${symbol} ${interval} candles after ${MAX_RETRIES} attempts: ${
              error instanceof Error ? error.message : "unknown error"
            }`
          );
        }

        await wait(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }

    return [];
  }

  async getCandles(
    symbol: string,
    interval: "1h" | "1d",
    startTime: number,
    endTime: number
  ): Promise<HistoricalCandle[]> {
    const normalizedSymbol = toUpperSymbol(symbol);
    if (!normalizedSymbol) {
      return [];
    }

    if (STABLE_PRICE_SYMBOLS.has(normalizedSymbol)) {
      return buildSyntheticStableCandles(normalizedSymbol, interval, startTime, endTime);
    }

    const openTimes = buildExpectedOpenTimes(startTime, endTime, interval);
    const existing = await this.repository.listHistoricalCandles(
      normalizedSymbol,
      interval,
      openTimes[0],
      openTimes[openTimes.length - 1]
    );
    const byOpenTime = new Map(existing.map((candle) => [candle.openTime, candle]));
    const gaps = groupMissingRanges(openTimes, byOpenTime);

    if (gaps.length > 0) {
      const fetched: HistoricalCandle[] = [];
      for (const gap of gaps) {
        const gapCandles = await this.fetchGap(normalizedSymbol, interval, gap.startTime, gap.endTime);
        fetched.push(...gapCandles);
      }

      if (fetched.length > 0) {
        await this.repository.saveHistoricalCandles(fetched);
      }

      await this.pruneRetentionIfNeeded();
    }

    const finalCandles = await this.repository.listHistoricalCandles(
      normalizedSymbol,
      interval,
      openTimes[0],
      openTimes[openTimes.length - 1]
    );

    return finalCandles.sort((left, right) => left.openTime - right.openTime);
  }
}

export class PersistedHistoricalMarketDataSource implements HistoricalMarketDataSource {
  constructor(private readonly candleProvider: HistoricalCandleProvider) {}

  async getSeries(request: HistoricalMarketDataRequest): Promise<HistoricalMarketPoint[]> {
    const symbols = Array.from(new Set(request.symbols.map(toUpperSymbol))).sort((left, right) => left.localeCompare(right));
    const startTime = new Date(request.startDate).getTime();
    const endTime = new Date(request.endDate).getTime();
    const openTimes = buildExpectedOpenTimes(startTime, endTime, request.timeframe);

    const candlesBySymbol: Record<string, HistoricalCandle[]> = {};
    for (const symbol of symbols) {
      candlesBySymbol[symbol] = await this.candleProvider.getCandles(symbol, request.timeframe, startTime, endTime);
      if (candlesBySymbol[symbol].length === 0) {
        throw new Error(`No historical candles available for ${symbol} in the requested range.`);
      }
    }

    const candleMaps = Object.fromEntries(
      symbols.map((symbol) => [symbol, new Map(candlesBySymbol[symbol].map((candle) => [candle.openTime, candle]))])
    ) as Record<string, Map<number, HistoricalCandle>>;
    const fallbackCloseBySymbol = Object.fromEntries(
      symbols.map((symbol) => [symbol, candlesBySymbol[symbol][0]?.close ?? 0])
    ) as Record<string, number>;
    const points: HistoricalMarketPoint[] = [];
    let previousPrices: Record<string, number> | null = null;

    openTimes.forEach((openTime, stepIndex) => {
      const timestamp = new Date(openTime).toISOString();
      const prices: Record<string, number> = {};
      const volumes: Record<string, number> = {};

      symbols.forEach((symbol) => {
        const candle = candleMaps[symbol]?.get(openTime);
        if (candle) {
          fallbackCloseBySymbol[symbol] = candle.close;
          prices[symbol] = candle.close;
          volumes[symbol] = candle.volume;
          return;
        }

        if (!Number.isFinite(fallbackCloseBySymbol[symbol]) || fallbackCloseBySymbol[symbol] <= 0) {
          throw new Error(`Historical candle coverage for ${symbol} is incomplete near ${timestamp}.`);
        }

        prices[symbol] = fallbackCloseBySymbol[symbol];
        volumes[symbol] = 0;
      });

      const signals = buildSignals(symbols, prices, previousPrices, volumes, stepIndex, openTimes.length, timestamp);
      points.push({
        timestamp,
        prices,
        volumes,
        signals,
      });
      previousPrices = { ...prices };
    });

    return points;
  }
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

import type { HistoricalCandle } from "./strategy/types.js";

export const STABLE_COINS = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "DAI"]);

const COINBASE_EXCHANGE_BASE_URL = "https://api.exchange.coinbase.com";
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.PUBLIC_MARKET_DATA_TIMEOUT_MS ?? "", 10) > 0
  ? Number.parseInt(process.env.PUBLIC_MARKET_DATA_TIMEOUT_MS ?? "", 10)
  : 5000;
const TICKER_CACHE_TTL_MS = 15_000;
const CLOSE_SERIES_CACHE_TTL_MS = 60_000;
const MAX_CANDLES_PER_REQUEST = 300;
const USD_QUOTES = ["USD", "USDC", "USDT"] as const;

const ASSET_METADATA: Record<string, { name: string; marketCap: number }> = {
  BTC: { name: "Bitcoin", marketCap: 1_350_000_000_000 },
  ETH: { name: "Ethereum", marketCap: 420_000_000_000 },
  SOL: { name: "Solana", marketCap: 80_000_000_000 },
  XRP: { name: "XRP", marketCap: 40_000_000_000 },
  ADA: { name: "Cardano", marketCap: 23_000_000_000 },
  DOGE: { name: "Dogecoin", marketCap: 19_000_000_000 },
  AVAX: { name: "Avalanche", marketCap: 15_000_000_000 },
  LINK: { name: "Chainlink", marketCap: 12_000_000_000 },
  LTC: { name: "Litecoin", marketCap: 6_000_000_000 },
  BCH: { name: "Bitcoin Cash", marketCap: 9_000_000_000 },
  ETC: { name: "Ethereum Classic", marketCap: 5_500_000_000 },
  UNI: { name: "Uniswap", marketCap: 6_000_000_000 },
  AAVE: { name: "Aave", marketCap: 2_000_000_000 },
  INJ: { name: "Injective", marketCap: 2_500_000_000 },
  NEAR: { name: "NEAR Protocol", marketCap: 7_000_000_000 },
  HBAR: { name: "Hedera", marketCap: 4_500_000_000 },
  SUI: { name: "Sui", marketCap: 5_000_000_000 },
  TON: { name: "Toncoin", marketCap: 18_000_000_000 },
  SHIB: { name: "Shiba Inu", marketCap: 15_000_000_000 },
  PEPE: { name: "Pepe", marketCap: 4_500_000_000 },
  APT: { name: "Aptos", marketCap: 4_000_000_000 },
  ARB: { name: "Arbitrum", marketCap: 3_500_000_000 },
  OP: { name: "Optimism", marketCap: 3_000_000_000 },
  SEI: { name: "Sei", marketCap: 1_500_000_000 },
  RUNE: { name: "THORChain", marketCap: 2_500_000_000 },
  MATIC: { name: "Polygon", marketCap: 7_000_000_000 },
  XLM: { name: "Stellar", marketCap: 3_500_000_000 },
  ALGO: { name: "Algorand", marketCap: 1_800_000_000 },
  TRX: { name: "TRON", marketCap: 12_000_000_000 },
  DOT: { name: "Polkadot", marketCap: 10_000_000_000 },
  ATOM: { name: "Cosmos", marketCap: 4_000_000_000 },
  USDT: { name: "Tether", marketCap: 110_000_000_000 },
  USDC: { name: "USD Coin", marketCap: 35_000_000_000 },
};

type SupportedUsdQuote = (typeof USD_QUOTES)[number];

interface CoinbaseTickerResponse {
  ask?: string;
  bid?: string;
  price?: string;
  volume?: string;
}

interface CoinbaseStatsResponse {
  open?: string;
  volume?: string;
}

type CoinbaseCandleRow = [number, number, number, number, number, number];

interface AssetUsdSnapshot {
  price: number;
  change24h: number;
  volume24h: number;
  referenceQuote: string;
}

interface ProductTickerSnapshot {
  ask: number;
  bid: number;
  last: number;
  open24h: number;
  volume24h: number;
}

interface TimedSnapshot<T> {
  expiresAt: number;
  value: T;
}

const usdSnapshotCache = new Map<string, TimedSnapshot<AssetUsdSnapshot>>();
const recentCloseCache = new Map<string, TimedSnapshot<number[]>>();

function round(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function getTimedCacheValue<T>(cache: Map<string, TimedSnapshot<T>>, key: string): T | null {
  const cached = cache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return cached.value;
}

function setTimedCacheValue<T>(cache: Map<string, TimedSnapshot<T>>, key: string, value: T, ttlMs: number): T {
  cache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
  return value;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function intervalToMs(interval: "1h" | "1d"): number {
  return interval === "1h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
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

function normalizeCandleRow(symbol: string, interval: "1h" | "1d", row: unknown): HistoricalCandle | null {
  if (!Array.isArray(row) || row.length < 6) {
    return null;
  }

  const openTime = toNumber(row[0]) * 1000;
  const low = toNumber(row[1]);
  const high = toNumber(row[2]);
  const open = toNumber(row[3]);
  const close = toNumber(row[4]);
  const volume = toNumber(row[5]);

  if (
    !Number.isFinite(openTime) ||
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close) ||
    !Number.isFinite(volume) ||
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0 ||
    volume < 0
  ) {
    return null;
  }

  const step = intervalToMs(interval);
  return {
    symbol,
    interval,
    openTime,
    open,
    high,
    low,
    close,
    volume,
    closeTime: openTime + step - 1,
  };
}

async function fetchCoinbaseJson<T>(path: string, query?: Record<string, string | number>): Promise<T> {
  const url = new URL(path, COINBASE_EXCHANGE_BASE_URL);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      url.searchParams.set(key, String(value));
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  let bodyText = "";

  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "MyTraderBackend",
      },
    });
    bodyText = await response.text();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Public market data request timed out after ${REQUEST_TIMEOUT_MS}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Public market data request failed (${response.status}).`);
  }

  return JSON.parse(bodyText) as T;
}

async function fetchProductTicker(baseSymbol: string, quoteSymbol: string): Promise<ProductTickerSnapshot> {
  const productId = `${normalizeSymbol(baseSymbol)}-${normalizeSymbol(quoteSymbol)}`;
  const [ticker, stats] = await Promise.all([
    fetchCoinbaseJson<CoinbaseTickerResponse>(`/products/${productId}/ticker`),
    fetchCoinbaseJson<CoinbaseStatsResponse>(`/products/${productId}/stats`),
  ]);

  const last = toNumber(ticker.price);
  const ask = toNumber(ticker.ask);
  const bid = toNumber(ticker.bid);
  const open24h = toNumber(stats.open);
  const volumeBase = toNumber(stats.volume || ticker.volume);

  if (last <= 0) {
    throw new Error(`No public market price is available for ${productId}.`);
  }

  return {
    ask: ask > 0 ? ask : last,
    bid: bid > 0 ? bid : last,
    last,
    open24h,
    volume24h: round(volumeBase * last, 2),
  };
}

async function fetchUsdSnapshot(symbol: string): Promise<AssetUsdSnapshot> {
  const normalizedSymbol = normalizeSymbol(symbol);
  if (STABLE_COINS.has(normalizedSymbol)) {
    return {
      price: 1,
      change24h: 0,
      volume24h: 0,
      referenceQuote: normalizedSymbol,
    };
  }

  const cacheKey = `${normalizedSymbol}:usd`;
  const cached = getTimedCacheValue(usdSnapshotCache, cacheKey);
  if (cached) {
    return cached;
  }

  for (const quoteSymbol of USD_QUOTES) {
    if (quoteSymbol === normalizedSymbol) {
      continue;
    }

    try {
      const ticker = await fetchProductTicker(normalizedSymbol, quoteSymbol);
      const change24h = ticker.open24h > 0 ? ((ticker.last - ticker.open24h) / ticker.open24h) * 100 : 0;

      return setTimedCacheValue(
        usdSnapshotCache,
        cacheKey,
        {
          price: round(ticker.last, 8),
          change24h: round(change24h, 4),
          volume24h: round(ticker.volume24h, 2),
          referenceQuote: quoteSymbol,
        },
        TICKER_CACHE_TTL_MS
      );
    } catch {
      // Try the next USD-like quote.
    }
  }

  throw new Error(`No public USD market is available for ${normalizedSymbol}.`);
}

export function getNameForSymbol(symbol: string): string {
  return ASSET_METADATA[normalizeSymbol(symbol)]?.name ?? normalizeSymbol(symbol);
}

export function getMarketCapForSymbol(symbol: string): number {
  return ASSET_METADATA[normalizeSymbol(symbol)]?.marketCap ?? 0;
}

export async function getTickerSnapshot(symbol: string): Promise<{ price: number; change24h: number; volume24h: number }> {
  const snapshot = await fetchUsdSnapshot(symbol);
  return {
    price: snapshot.price,
    change24h: snapshot.change24h,
    volume24h: snapshot.volume24h,
  };
}

export async function getAssetUsdSnapshot(symbol: string): Promise<AssetUsdSnapshot> {
  return fetchUsdSnapshot(symbol);
}

export async function getTradingPairSnapshot(
  baseSymbol: string,
  quoteSymbol: string
): Promise<{
  base: AssetUsdSnapshot;
  quote: AssetUsdSnapshot;
  priceInQuote: number;
  inversePrice: number;
  pricingSource: "direct" | "inverse" | "usd_cross";
}> {
  const normalizedBase = normalizeSymbol(baseSymbol);
  const normalizedQuote = normalizeSymbol(quoteSymbol);

  if (!normalizedBase || !normalizedQuote) {
    throw new Error("Both base and quote assets are required.");
  }

  const [base, quote] = await Promise.all([
    getAssetUsdSnapshot(normalizedBase),
    getAssetUsdSnapshot(normalizedQuote),
  ]);

  if (normalizedBase === normalizedQuote) {
    return {
      base,
      quote,
      priceInQuote: 1,
      inversePrice: 1,
      pricingSource: "usd_cross",
    };
  }

  try {
    const direct = await fetchProductTicker(normalizedBase, normalizedQuote);
    return {
      base,
      quote,
      priceInQuote: round(direct.last, 8),
      inversePrice: round(1 / direct.last, 8),
      pricingSource: "direct",
    };
  } catch {
    // Fall back to the reverse market or USD cross pricing.
  }

  try {
    const inverse = await fetchProductTicker(normalizedQuote, normalizedBase);
    return {
      base,
      quote,
      priceInQuote: round(1 / inverse.last, 8),
      inversePrice: round(inverse.last, 8),
      pricingSource: "inverse",
    };
  } catch {
    // Fall back to USD cross pricing.
  }

  if (quote.price <= 0) {
    throw new Error(`Unable to price ${normalizedBase}/${normalizedQuote}.`);
  }

  const crossPrice = base.price / quote.price;
  return {
    base,
    quote,
    priceInQuote: round(crossPrice, 8),
    inversePrice: crossPrice > 0 ? round(1 / crossPrice, 8) : 0,
    pricingSource: "usd_cross",
  };
}

export async function fetchHistoricalCandles(
  symbol: string,
  interval: "1h" | "1d",
  startTime: number,
  endTime: number
): Promise<HistoricalCandle[]> {
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedSymbol) {
    return [];
  }

  if (STABLE_COINS.has(normalizedSymbol)) {
    return buildSyntheticStableCandles(normalizedSymbol, interval, startTime, endTime);
  }

  const step = intervalToMs(interval);
  const start = alignOpenTime(startTime, interval);
  const end = alignOpenTime(endTime, interval);
  const granularity = interval === "1h" ? 3600 : 86400;
  const candles: HistoricalCandle[] = [];
  let selectedQuote: SupportedUsdQuote | null = null;

  for (let cursor = start; cursor <= end; cursor += step * MAX_CANDLES_PER_REQUEST) {
    const chunkEnd = Math.min(end, cursor + step * (MAX_CANDLES_PER_REQUEST - 1));
    const quoteCandidates: SupportedUsdQuote[] = selectedQuote ? [selectedQuote] : [...USD_QUOTES];
    let chunk: HistoricalCandle[] | null = null;
    let lastError: Error | null = null;

    for (const quoteSymbol of quoteCandidates) {
      try {
        const response = await fetchCoinbaseJson<unknown>(`/products/${normalizedSymbol}-${quoteSymbol}/candles`, {
          granularity,
          start: new Date(cursor).toISOString(),
          end: new Date(chunkEnd + step - 1).toISOString(),
        });
        const rows = Array.isArray(response) ? response : [];
        chunk = rows
          .map((row) => normalizeCandleRow(normalizedSymbol, interval, row))
          .filter((entry): entry is HistoricalCandle => entry !== null)
          .sort((left, right) => left.openTime - right.openTime);
        selectedQuote = quoteSymbol;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unable to load public candles.");
      }
    }

    if (!chunk) {
      throw lastError ?? new Error(`No public candle market is available for ${normalizedSymbol}.`);
    }

    candles.push(...chunk);
  }

  const deduped = new Map<number, HistoricalCandle>();
  candles.forEach((candle) => {
    deduped.set(candle.openTime, candle);
  });

  return Array.from(deduped.values()).sort((left, right) => left.openTime - right.openTime);
}

export async function getRecentCloseSeries(
  symbol: string,
  interval: "1h" | "1d",
  limit: number,
  fallbackPrice: number
): Promise<number[]> {
  const normalizedSymbol = normalizeSymbol(symbol);
  const safeLimit = Math.max(1, Math.floor(limit));
  const cacheKey = `${normalizedSymbol}:${interval}:${safeLimit}:${round(fallbackPrice || 0, 6)}`;
  const cached = getTimedCacheValue(recentCloseCache, cacheKey);
  if (cached) {
    return cached;
  }

  const stableFallbackPrice = STABLE_COINS.has(normalizedSymbol) ? 1 : Math.max(0, fallbackPrice);
  if (STABLE_COINS.has(normalizedSymbol)) {
    return setTimedCacheValue(
      recentCloseCache,
      cacheKey,
      Array.from({ length: safeLimit }, () => round(stableFallbackPrice, 6)),
      CLOSE_SERIES_CACHE_TTL_MS
    );
  }

  const step = intervalToMs(interval);
  const endTime = alignOpenTime(Date.now(), interval);
  const startTime = endTime - step * (safeLimit - 1);

  try {
    const candles = await fetchHistoricalCandles(normalizedSymbol, interval, startTime, endTime);
    const byOpenTime = new Map(candles.map((candle) => [candle.openTime, candle]));
    const closes: number[] = [];
    let lastClose = stableFallbackPrice;

    buildExpectedOpenTimes(startTime, endTime, interval).forEach((openTime) => {
      const candle = byOpenTime.get(openTime);
      if (candle) {
        lastClose = candle.close;
      }
      closes.push(round(lastClose, 6));
    });

    return setTimedCacheValue(recentCloseCache, cacheKey, closes, CLOSE_SERIES_CACHE_TTL_MS);
  } catch {
    return Array.from({ length: safeLimit }, () => round(stableFallbackPrice, 6));
  }
}

export async function getHourlyCloseSeries(symbol: string, fallbackPrice: number): Promise<number[]> {
  return getRecentCloseSeries(symbol, "1h", 24, fallbackPrice);
}

export function generateRecentDayLabels(days: number): string[] {
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  const now = new Date();

  return Array.from({ length: days }, (_, index) => {
    const dayOffset = days - 1 - index;
    const date = new Date(now);
    date.setDate(now.getDate() - dayOffset);
    return formatter.format(date);
  });
}

export async function getDailyCloseSeries(
  symbol: string,
  fallbackPrice: number,
  days = 30
): Promise<{ labels: string[]; closes: number[] }> {
  const closes = await getRecentCloseSeries(symbol, "1d", days, fallbackPrice);
  return {
    labels: generateRecentDayLabels(days),
    closes,
  };
}

export type ExchangeId = "kraken" | "coinbase";

export const EXCHANGE_ORDER: ExchangeId[] = ["kraken", "coinbase"];

export const SUPPORTED_MARKET_SYMBOLS = ["BTC-USD", "ETH-USD", "BTC-EUR", "ETH-EUR"] as const;

export type SupportedMarketSymbol = (typeof SUPPORTED_MARKET_SYMBOLS)[number];

export type ExchangeHealthStatus = "online" | "offline";

export type NormalizedTicker = {
  exchange: ExchangeId;
  symbol: SupportedMarketSymbol;
  bid: number;
  ask: number;
  last: number;
  spreadAbsolute: number;
  spreadPercent: number;
  timestamp: string;
};

export type NormalizedOrderBookSummary = {
  exchange: ExchangeId;
  symbol: SupportedMarketSymbol;
  bestBid: number;
  bestAsk: number;
  spreadAbsolute: number;
  spreadPercent: number;
  topBidVolume: number;
  topAskVolume: number;
  totalBidVolumeTopN: number;
  totalAskVolumeTopN: number;
  timestamp: string;
};

export type ExchangeHealth = {
  exchange: ExchangeId;
  status: ExchangeHealthStatus;
  message?: string;
  timestamp: string;
};

export interface ExchangeBestVenue {
  exchange: ExchangeId;
  price: number;
}

export interface ExchangeMarketAdapter {
  readonly exchange: ExchangeId;
  getTicker(symbol: SupportedMarketSymbol): Promise<NormalizedTicker>;
  getOrderBook(symbol: SupportedMarketSymbol, depth: number): Promise<NormalizedOrderBookSummary>;
  getExchangeStatus(): Promise<ExchangeHealth>;
  getSupportedPairs(): Promise<SupportedMarketSymbol[]>;
}

export interface OrderBookLevel {
  price: number;
  volume: number;
}

interface CacheEntry {
  expiresAt: number;
  value?: unknown;
  pending?: Promise<unknown>;
}

export class MemoryTtlCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly ttlMs = 4_000) {}

  async getOrLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const current = this.entries.get(key);

    if (current && current.expiresAt > now && current.value !== undefined) {
      return current.value as T;
    }

    if (current?.pending) {
      return current.pending as Promise<T>;
    }

    const pending = loader()
      .then((value) => {
        this.entries.set(key, {
          value,
          expiresAt: Date.now() + this.ttlMs,
        });
        return value;
      })
      .catch((error) => {
        this.entries.delete(key);
        throw error;
      });

    this.entries.set(key, {
      expiresAt: 0,
      pending,
    });

    return pending;
  }
}

function parseJsonSafely(raw: string): unknown {
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function fetchJson<T>(url: string, timeoutMs = 5_000): Promise<T> {
  const headers = new Headers();
  headers.set("Accept", "application/json");
  headers.set("User-Agent", "MyTrader/1.0");

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  const payload = parseJsonSafely(text);

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "message" in payload &&
      typeof (payload as { message?: unknown }).message === "string"
        ? (payload as { message: string }).message
        : `Request failed with status ${response.status}.`;

    throw new Error(message);
  }

  return payload as T;
}

export function isSupportedMarketSymbol(value: string): value is SupportedMarketSymbol {
  return SUPPORTED_MARKET_SYMBOLS.includes(value as SupportedMarketSymbol);
}

export function normalizeMarketSymbol(value: string): SupportedMarketSymbol | null {
  const normalized = value.trim().toUpperCase();
  return isSupportedMarketSymbol(normalized) ? normalized : null;
}

export function parseNumericValue(value: unknown, label: string): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;

  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid numeric ${label}.`);
  }

  return numeric;
}

export function roundNumber(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function calculateSpreadAbsolute(bid: number, ask: number): number {
  return roundNumber(Math.max(ask - bid, 0), 10);
}

export function calculateSpreadPercent(bid: number, ask: number): number {
  const midpoint = (bid + ask) / 2;
  if (!Number.isFinite(midpoint) || midpoint <= 0) {
    return 0;
  }

  return roundNumber((calculateSpreadAbsolute(bid, ask) / midpoint) * 100, 6);
}

export function summarizeOrderBook(
  exchange: ExchangeId,
  symbol: SupportedMarketSymbol,
  bids: OrderBookLevel[],
  asks: OrderBookLevel[],
  timestamp: string
): NormalizedOrderBookSummary {
  const bestBid = bids[0]?.price;
  const bestAsk = asks[0]?.price;

  if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk)) {
    throw new Error(`Order book for ${exchange} ${symbol} did not contain valid best bid/ask levels.`);
  }

  const totalBidVolumeTopN = roundNumber(bids.reduce((sum, level) => sum + level.volume, 0), 8);
  const totalAskVolumeTopN = roundNumber(asks.reduce((sum, level) => sum + level.volume, 0), 8);

  return {
    exchange,
    symbol,
    bestBid,
    bestAsk,
    spreadAbsolute: calculateSpreadAbsolute(bestBid, bestAsk),
    spreadPercent: calculateSpreadPercent(bestBid, bestAsk),
    topBidVolume: roundNumber(bids[0]?.volume ?? 0, 8),
    topAskVolume: roundNumber(asks[0]?.volume ?? 0, 8),
    totalBidVolumeTopN,
    totalAskVolumeTopN,
    timestamp,
  };
}


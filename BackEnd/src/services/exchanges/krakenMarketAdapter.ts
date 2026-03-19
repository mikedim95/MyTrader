import {
  calculateSpreadAbsolute,
  calculateSpreadPercent,
  ExchangeHealth,
  ExchangeMarketAdapter,
  MemoryTtlCache,
  NormalizedOrderBookSummary,
  NormalizedTicker,
  OrderBookLevel,
  SUPPORTED_MARKET_SYMBOLS,
  SupportedMarketSymbol,
  fetchJson,
  parseNumericValue,
  roundNumber,
  summarizeOrderBook,
} from "./types.js";

interface KrakenEnvelope<T> {
  error?: string[];
  result?: T;
}

interface KrakenTickerEntry {
  a?: unknown[];
  b?: unknown[];
  c?: unknown[];
}

interface KrakenDepthEntry {
  asks?: unknown[][];
  bids?: unknown[][];
}

interface KrakenSystemStatusResult {
  status?: string;
  timestamp?: string;
}

const KRAKEN_BASE_URL = "https://api.kraken.com/0/public";

const KRAKEN_PAIR_BY_SYMBOL: Record<SupportedMarketSymbol, string> = {
  "BTC-USD": "BTC/USD",
  "ETH-USD": "ETH/USD",
  "BTC-EUR": "BTC/EUR",
  "ETH-EUR": "ETH/EUR",
};

function unwrapKrakenResult<T extends object>(payload: KrakenEnvelope<Record<string, T>>): T {
  const errors = payload.error ?? [];
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  const result = payload.result ? Object.values(payload.result)[0] : null;
  if (!result) {
    throw new Error("Kraken returned an empty result.");
  }

  return result;
}

function toOrderBookLevels(levels: unknown[][] | undefined, label: string): OrderBookLevel[] {
  return (levels ?? []).map((level, index) => ({
    price: parseNumericValue(level?.[0], `${label} price at index ${index}`),
    volume: roundNumber(parseNumericValue(level?.[1], `${label} volume at index ${index}`), 8),
  }));
}

function resolveBookTimestamp(entry: KrakenDepthEntry): string {
  const firstAskTs = Number(entry.asks?.[0]?.[2] ?? 0);
  const firstBidTs = Number(entry.bids?.[0]?.[2] ?? 0);
  const timestampSeconds = Math.max(firstAskTs, firstBidTs);

  if (Number.isFinite(timestampSeconds) && timestampSeconds > 0) {
    return new Date(timestampSeconds * 1000).toISOString();
  }

  return new Date().toISOString();
}

export class KrakenMarketAdapter implements ExchangeMarketAdapter {
  readonly exchange = "kraken" as const;
  private readonly cache = new MemoryTtlCache(4_000);

  async getTicker(symbol: SupportedMarketSymbol): Promise<NormalizedTicker> {
    return this.cache.getOrLoad(`ticker:${symbol}`, async () => {
      const pair = KRAKEN_PAIR_BY_SYMBOL[symbol];
      const payload = await fetchJson<KrakenEnvelope<Record<string, KrakenTickerEntry>>>(
        `${KRAKEN_BASE_URL}/Ticker?pair=${encodeURIComponent(pair)}`
      );
      const entry = unwrapKrakenResult(payload);
      const bid = parseNumericValue(entry.b?.[0], "Kraken bid");
      const ask = parseNumericValue(entry.a?.[0], "Kraken ask");
      const last = parseNumericValue(entry.c?.[0], "Kraken last");
      const timestamp = new Date().toISOString();

      return {
        exchange: this.exchange,
        symbol,
        bid,
        ask,
        last,
        spreadAbsolute: calculateSpreadAbsolute(bid, ask),
        spreadPercent: calculateSpreadPercent(bid, ask),
        timestamp,
      };
    });
  }

  async getOrderBook(symbol: SupportedMarketSymbol, depth: number): Promise<NormalizedOrderBookSummary> {
    return this.cache.getOrLoad(`orderbook:${symbol}:${depth}`, async () => {
      const pair = KRAKEN_PAIR_BY_SYMBOL[symbol];
      const payload = await fetchJson<KrakenEnvelope<Record<string, KrakenDepthEntry>>>(
        `${KRAKEN_BASE_URL}/Depth?pair=${encodeURIComponent(pair)}&count=${depth}`
      );
      const entry = unwrapKrakenResult(payload);
      const bids = toOrderBookLevels(entry.bids, "Kraken bid level");
      const asks = toOrderBookLevels(entry.asks, "Kraken ask level");

      return summarizeOrderBook(this.exchange, symbol, bids, asks, resolveBookTimestamp(entry));
    });
  }

  async getExchangeStatus(): Promise<ExchangeHealth> {
    return this.cache.getOrLoad("health", async () => {
      try {
        const payload = await fetchJson<KrakenEnvelope<KrakenSystemStatusResult>>(`${KRAKEN_BASE_URL}/SystemStatus`);
        const errors = payload.error ?? [];
        if (errors.length > 0) {
          throw new Error(errors.join("; "));
        }

        const result = payload.result ?? {};
        const status = result.status === "online" ? "online" : "offline";

        return {
          exchange: this.exchange,
          status,
          message: status === "online" ? undefined : result.status ?? "Unavailable",
          timestamp: typeof result.timestamp === "string" ? result.timestamp : new Date().toISOString(),
        };
      } catch (error) {
        return {
          exchange: this.exchange,
          status: "offline",
          message: error instanceof Error ? error.message : "Kraken public API unavailable.",
          timestamp: new Date().toISOString(),
        };
      }
    });
  }

  async getSupportedPairs(): Promise<SupportedMarketSymbol[]> {
    return [...SUPPORTED_MARKET_SYMBOLS];
  }
}


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

interface CoinbaseTickerPayload {
  ask?: string;
  bid?: string;
  price?: string;
  time?: string;
}

interface CoinbaseBookPayload {
  bids?: unknown[][];
  asks?: unknown[][];
}

interface CoinbaseTimePayload {
  iso?: string;
}

const COINBASE_BASE_URL = "https://api.exchange.coinbase.com";

function toOrderBookLevels(levels: unknown[][] | undefined, depth: number, label: string): OrderBookLevel[] {
  return (levels ?? []).slice(0, depth).map((level, index) => ({
    price: parseNumericValue(level?.[0], `${label} price at index ${index}`),
    volume: roundNumber(parseNumericValue(level?.[1], `${label} volume at index ${index}`), 8),
  }));
}

export class CoinbaseMarketAdapter implements ExchangeMarketAdapter {
  readonly exchange = "coinbase" as const;
  private readonly cache = new MemoryTtlCache(4_000);

  async getTicker(symbol: SupportedMarketSymbol): Promise<NormalizedTicker> {
    return this.cache.getOrLoad(`ticker:${symbol}`, async () => {
      const payload = await fetchJson<CoinbaseTickerPayload>(`${COINBASE_BASE_URL}/products/${symbol}/ticker`);
      const bid = parseNumericValue(payload.bid, "Coinbase bid");
      const ask = parseNumericValue(payload.ask, "Coinbase ask");
      const last = parseNumericValue(payload.price, "Coinbase last");

      return {
        exchange: this.exchange,
        symbol,
        bid,
        ask,
        last,
        spreadAbsolute: calculateSpreadAbsolute(bid, ask),
        spreadPercent: calculateSpreadPercent(bid, ask),
        timestamp: typeof payload.time === "string" ? payload.time : new Date().toISOString(),
      };
    });
  }

  async getOrderBook(symbol: SupportedMarketSymbol, depth: number): Promise<NormalizedOrderBookSummary> {
    return this.cache.getOrLoad(`orderbook:${symbol}:${depth}`, async () => {
      const payload = await fetchJson<CoinbaseBookPayload>(`${COINBASE_BASE_URL}/products/${symbol}/book?level=2`);
      const bids = toOrderBookLevels(payload.bids, depth, "Coinbase bid level");
      const asks = toOrderBookLevels(payload.asks, depth, "Coinbase ask level");

      return summarizeOrderBook(this.exchange, symbol, bids, asks, new Date().toISOString());
    });
  }

  async getExchangeStatus(): Promise<ExchangeHealth> {
    return this.cache.getOrLoad("health", async () => {
      try {
        const payload = await fetchJson<CoinbaseTimePayload>(`${COINBASE_BASE_URL}/time`);

        return {
          exchange: this.exchange,
          status: "online",
          timestamp: typeof payload.iso === "string" ? payload.iso : new Date().toISOString(),
        };
      } catch (error) {
        return {
          exchange: this.exchange,
          status: "offline",
          message: error instanceof Error ? error.message : "Coinbase public API unavailable.",
          timestamp: new Date().toISOString(),
        };
      }
    });
  }

  async getSupportedPairs(): Promise<SupportedMarketSymbol[]> {
    return [...SUPPORTED_MARKET_SYMBOLS];
  }
}


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

interface CryptoComEnvelope<T> {
  code?: number;
  message?: string;
  result?: T;
}

interface CryptoComTickerEntry {
  a?: string;
  b?: string;
  i?: string;
  k?: string;
  t?: number;
}

interface CryptoComBookEntry {
  asks?: unknown[][];
  bids?: unknown[][];
  t?: number;
}

interface CryptoComInstrumentEntry {
  symbol?: string;
  inst_type?: string;
  tradable?: boolean;
}

interface CryptoComResult<T> {
  data?: T[];
}

const CRYPTO_COM_BASE_URL = "https://api.crypto.com/exchange/v1";

const CRYPTO_COM_SYMBOL_BY_MARKET: Record<SupportedMarketSymbol, string> = {
  "BTC-USD": "BTC_USD",
  "ETH-USD": "ETH_USD",
  "BTC-EUR": "BTC_EUR",
  "ETH-EUR": "ETH_EUR",
};

const MARKET_SYMBOL_BY_CRYPTO_COM_SYMBOL = Object.fromEntries(
  Object.entries(CRYPTO_COM_SYMBOL_BY_MARKET).map(([marketSymbol, exchangeSymbol]) => [exchangeSymbol, marketSymbol])
) as Record<string, SupportedMarketSymbol>;

function unwrapCryptoComResult<T>(payload: CryptoComEnvelope<T>): T {
  if (payload.code !== 0) {
    throw new Error(payload.message?.trim() || `Crypto.com returned code ${payload.code ?? "unknown"}.`);
  }

  if (!payload.result) {
    throw new Error("Crypto.com returned an empty result.");
  }

  return payload.result;
}

function resolveTimestamp(timestampMs?: number): string {
  return typeof timestampMs === "number" && Number.isFinite(timestampMs) && timestampMs > 0
    ? new Date(timestampMs).toISOString()
    : new Date().toISOString();
}

function toOrderBookLevels(levels: unknown[][] | undefined, depth: number, label: string): OrderBookLevel[] {
  return (levels ?? []).slice(0, depth).map((level, index) => ({
    price: parseNumericValue(level?.[0], `${label} price at index ${index}`),
    volume: roundNumber(parseNumericValue(level?.[1], `${label} volume at index ${index}`), 8),
  }));
}

export class CryptoComMarketAdapter implements ExchangeMarketAdapter {
  readonly exchange = "crypto.com" as const;
  private readonly cache = new MemoryTtlCache(4_000);

  private async getInstruments(): Promise<CryptoComInstrumentEntry[]> {
    return this.cache.getOrLoad("instruments", async () => {
      const payload = await fetchJson<CryptoComEnvelope<CryptoComResult<CryptoComInstrumentEntry>>>(
        `${CRYPTO_COM_BASE_URL}/public/get-instruments`
      );
      const result = unwrapCryptoComResult(payload);
      return result.data ?? [];
    });
  }

  async getTicker(symbol: SupportedMarketSymbol): Promise<NormalizedTicker> {
    return this.cache.getOrLoad(`ticker:${symbol}`, async () => {
      const instrumentName = CRYPTO_COM_SYMBOL_BY_MARKET[symbol];
      const payload = await fetchJson<CryptoComEnvelope<CryptoComResult<CryptoComTickerEntry>>>(
        `${CRYPTO_COM_BASE_URL}/public/get-tickers?instrument_name=${encodeURIComponent(instrumentName)}`
      );
      const result = unwrapCryptoComResult(payload);
      const entry = (result.data ?? []).find((candidate) => candidate.i === instrumentName) ?? result.data?.[0];

      if (!entry) {
        throw new Error(`Crypto.com did not return ticker data for ${instrumentName}.`);
      }

      const bid = parseNumericValue(entry.b, "Crypto.com bid");
      const ask = parseNumericValue(entry.k, "Crypto.com ask");
      const last = parseNumericValue(entry.a, "Crypto.com last");

      return {
        exchange: this.exchange,
        symbol,
        bid,
        ask,
        last,
        spreadAbsolute: calculateSpreadAbsolute(bid, ask),
        spreadPercent: calculateSpreadPercent(bid, ask),
        timestamp: resolveTimestamp(entry.t),
      };
    });
  }

  async getOrderBook(symbol: SupportedMarketSymbol, depth: number): Promise<NormalizedOrderBookSummary> {
    return this.cache.getOrLoad(`orderbook:${symbol}:${depth}`, async () => {
      const instrumentName = CRYPTO_COM_SYMBOL_BY_MARKET[symbol];
      const payload = await fetchJson<CryptoComEnvelope<CryptoComResult<CryptoComBookEntry>>>(
        `${CRYPTO_COM_BASE_URL}/public/get-book?instrument_name=${encodeURIComponent(instrumentName)}&depth=${depth}`
      );
      const result = unwrapCryptoComResult(payload);
      const entry = result.data?.[0];

      if (!entry) {
        throw new Error(`Crypto.com did not return order book data for ${instrumentName}.`);
      }

      const bids = toOrderBookLevels(entry.bids, depth, "Crypto.com bid level");
      const asks = toOrderBookLevels(entry.asks, depth, "Crypto.com ask level");
      return summarizeOrderBook(this.exchange, symbol, bids, asks, resolveTimestamp(entry.t));
    });
  }

  async getExchangeStatus(): Promise<ExchangeHealth> {
    return this.cache.getOrLoad("health", async () => {
      try {
        const instruments = await this.getInstruments();
        const online = instruments.length > 0;

        return {
          exchange: this.exchange,
          status: online ? "online" : "offline",
          message: online ? undefined : "Crypto.com returned no instrument metadata.",
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        return {
          exchange: this.exchange,
          status: "offline",
          message: error instanceof Error ? error.message : "Crypto.com public API unavailable.",
          timestamp: new Date().toISOString(),
        };
      }
    });
  }

  async getSupportedPairs(): Promise<SupportedMarketSymbol[]> {
    const instruments = await this.getInstruments();
    const availablePairs = new Set<SupportedMarketSymbol>();

    for (const instrument of instruments) {
      if (instrument.inst_type !== "CCY_PAIR" || instrument.tradable === false || typeof instrument.symbol !== "string") {
        continue;
      }

      const supportedPair = MARKET_SYMBOL_BY_CRYPTO_COM_SYMBOL[instrument.symbol];
      if (supportedPair) {
        availablePairs.add(supportedPair);
      }
    }

    return SUPPORTED_MARKET_SYMBOLS.filter((pair) => availablePairs.has(pair));
  }
}

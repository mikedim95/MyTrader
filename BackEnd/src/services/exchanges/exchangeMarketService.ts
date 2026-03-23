import { CoinbaseMarketAdapter } from "./coinbaseMarketAdapter.js";
import { CryptoComMarketAdapter } from "./cryptoComMarketAdapter.js";
import { KrakenMarketAdapter } from "./krakenMarketAdapter.js";
import {
  EXCHANGE_ORDER,
  ExchangeBestVenue,
  ExchangeHealth,
  ExchangeId,
  ExchangeMarketAdapter,
  NormalizedOrderBookSummary,
  NormalizedTicker,
  SUPPORTED_MARKET_SYMBOLS,
  SupportedMarketSymbol,
} from "./types.js";

function sortByExchangeOrder<T extends { exchange: ExchangeId }>(items: T[]): T[] {
  return [...items].sort((left, right) => EXCHANGE_ORDER.indexOf(left.exchange) - EXCHANGE_ORDER.indexOf(right.exchange));
}

function toSuccessfulValues<T>(results: PromiseSettledResult<T>[]): T[] {
  return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

function resolveBestBuy(tickers: NormalizedTicker[]): ExchangeBestVenue | null {
  if (tickers.length === 0) return null;

  const best = tickers.reduce((current, candidate) => (candidate.ask < current.ask ? candidate : current), tickers[0]);
  return {
    exchange: best.exchange,
    price: best.ask,
  };
}

function resolveBestSell(tickers: NormalizedTicker[]): ExchangeBestVenue | null {
  if (tickers.length === 0) return null;

  const best = tickers.reduce((current, candidate) => (candidate.bid > current.bid ? candidate : current), tickers[0]);
  return {
    exchange: best.exchange,
    price: best.bid,
  };
}

export class ExchangeMarketService {
  private readonly adapters: ExchangeMarketAdapter[];

  constructor(adapters?: ExchangeMarketAdapter[]) {
    this.adapters = adapters ?? [new KrakenMarketAdapter(), new CoinbaseMarketAdapter(), new CryptoComMarketAdapter()];
  }

  async getHealth(): Promise<ExchangeHealth[]> {
    const results = await Promise.all(this.adapters.map((adapter) => adapter.getExchangeStatus()));
    return sortByExchangeOrder(results);
  }

  async getSupportedPairs(): Promise<SupportedMarketSymbol[]> {
    const pairLists = await Promise.all(this.adapters.map((adapter) => adapter.getSupportedPairs()));
    const availablePairs = new Set<SupportedMarketSymbol>();

    for (const pairs of pairLists) {
      for (const pair of pairs) {
        availablePairs.add(pair);
      }
    }

    return SUPPORTED_MARKET_SYMBOLS.filter((pair) => availablePairs.has(pair));
  }

  async getTickers(symbol: SupportedMarketSymbol): Promise<NormalizedTicker[]> {
    const results = await Promise.allSettled(this.adapters.map((adapter) => adapter.getTicker(symbol)));
    const tickers = sortByExchangeOrder(toSuccessfulValues(results));

    if (tickers.length === 0) {
      throw new Error(`Unable to load ${symbol} ticker data from the configured public exchange adapters.`);
    }

    return tickers;
  }

  async getOrderBookSummaries(symbol: SupportedMarketSymbol, depth: number): Promise<NormalizedOrderBookSummary[]> {
    const results = await Promise.allSettled(this.adapters.map((adapter) => adapter.getOrderBook(symbol, depth)));
    const summaries = sortByExchangeOrder(toSuccessfulValues(results));

    if (summaries.length === 0) {
      throw new Error(`Unable to load ${symbol} order book data from the configured public exchange adapters.`);
    }

    return summaries;
  }

  async getComparison(symbol: SupportedMarketSymbol): Promise<{
    symbol: SupportedMarketSymbol;
    exchanges: NormalizedTicker[];
    bestBuy: ExchangeBestVenue | null;
    bestSell: ExchangeBestVenue | null;
  }> {
    const tickers = await this.getTickers(symbol);

    return {
      symbol,
      exchanges: tickers,
      bestBuy: resolveBestBuy(tickers),
      bestSell: resolveBestSell(tickers),
    };
  }
}


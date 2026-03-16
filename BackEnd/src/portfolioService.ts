import { createFallbackDashboard, createFallbackOrders } from "./mockData.js";
import { getActiveCredentials, getConnectionStatus, publicGet, signedGet } from "./binanceClient.js";
import type { StrategyUserScope } from "./strategy/strategy-user-scope.js";
import {
  Activity,
  Asset,
  BinanceCredentials,
  DashboardResponse,
  Order,
  OrdersResponse,
  PortfolioHistoryPoint,
} from "./types.js";

export const STABLE_COINS = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "DAI"]);

const ASSET_METADATA: Record<string, { name: string; marketCap: number }> = {
  BTC: { name: "Bitcoin", marketCap: 1_350_000_000_000 },
  ETH: { name: "Ethereum", marketCap: 420_000_000_000 },
  BNB: { name: "BNB", marketCap: 95_000_000_000 },
  SOL: { name: "Solana", marketCap: 80_000_000_000 },
  ADA: { name: "Cardano", marketCap: 23_000_000_000 },
  XRP: { name: "XRP", marketCap: 40_000_000_000 },
  DOGE: { name: "Dogecoin", marketCap: 19_000_000_000 },
  AVAX: { name: "Avalanche", marketCap: 15_000_000_000 },
  LINK: { name: "Chainlink", marketCap: 12_000_000_000 },
  USDT: { name: "Tether", marketCap: 110_000_000_000 },
  USDC: { name: "USD Coin", marketCap: 35_000_000_000 },
};

const MAX_ASSETS = parsePositiveInt(process.env.MAX_ASSETS, 20);
const MIN_ASSET_VALUE_USD = parsePositiveFloat(process.env.MIN_ASSET_VALUE_USD, 1);

interface BinanceAccountBalance {
  asset: string;
  free: string;
  locked: string;
}

interface BinanceAccountResponse {
  balances: BinanceAccountBalance[];
}

interface BinanceTicker24hResponse {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
}

interface BinanceTickerPriceResponse {
  symbol: string;
  price: string;
}

type BinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string
];

interface BinanceTradeResponse {
  id: number;
  qty: string;
  time: number;
  isBuyer: boolean;
}

interface BinanceOrderResponse {
  orderId: number;
  time: number;
  symbol: string;
  side: "BUY" | "SELL";
  price: string;
  origQty: string;
  status: string;
}

interface AssetSnapshot {
  asset: Asset;
  previousValue: number;
}

interface AssetUsdSnapshot {
  price: number;
  change24h: number;
  volume24h: number;
  referenceQuote: string;
}

const USD_REFERENCE_QUOTES = ["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "DAI"] as const;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parsePositiveFloat(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function round(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

function toNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

export function getNameForSymbol(symbol: string): string {
  return ASSET_METADATA[symbol]?.name ?? symbol;
}

export function getMarketCapForSymbol(symbol: string): number {
  return ASSET_METADATA[symbol]?.marketCap ?? 0;
}

function getPairSymbol(assetSymbol: string): string {
  return `${assetSymbol}USDT`;
}

function fallbackSeries(base: number): number[] {
  return Array.from({ length: 24 }, (_, i) => round(base + Math.sin(i / 2.2) * base * 0.01, 6));
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

function formatRelativeTime(timestampMs: number): string {
  const deltaMs = Date.now() - timestampMs;
  const minutes = Math.max(0, Math.floor(deltaMs / 60_000));

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function formatOrderTime(timestampMs: number): string {
  const date = new Date(timestampMs);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function normalizeOrderStatus(rawStatus: string): Order["status"] {
  if (rawStatus === "FILLED") return "Filled";
  if (rawStatus === "NEW" || rawStatus === "PARTIALLY_FILLED" || rawStatus === "PENDING_CANCEL") return "Pending";
  return "Cancelled";
}

export async function getTickerSnapshot(
  symbol: string,
  credentials: BinanceCredentials | null
): Promise<{ price: number; change24h: number; volume24h: number }> {
  if (STABLE_COINS.has(symbol)) {
    return { price: 1, change24h: 0, volume24h: 0 };
  }

  const ticker = await publicGet<BinanceTicker24hResponse>(
    "/api/v3/ticker/24hr",
    { symbol: getPairSymbol(symbol) },
    credentials
  );

  return {
    price: toNumber(ticker.lastPrice),
    change24h: toNumber(ticker.priceChangePercent),
    volume24h: toNumber(ticker.quoteVolume),
  };
}

export async function getAssetUsdSnapshot(
  symbol: string,
  credentials: BinanceCredentials | null
): Promise<AssetUsdSnapshot> {
  const normalizedSymbol = symbol.trim().toUpperCase();

  if (STABLE_COINS.has(normalizedSymbol)) {
    return { price: 1, change24h: 0, volume24h: 0, referenceQuote: normalizedSymbol };
  }

  for (const quoteSymbol of USD_REFERENCE_QUOTES) {
    if (quoteSymbol === normalizedSymbol) {
      continue;
    }

    try {
      const ticker = await publicGet<BinanceTicker24hResponse>(
        "/api/v3/ticker/24hr",
        { symbol: `${normalizedSymbol}${quoteSymbol}` },
        credentials
      );

      return {
        price: toNumber(ticker.lastPrice),
        change24h: toNumber(ticker.priceChangePercent),
        volume24h: toNumber(ticker.quoteVolume),
        referenceQuote: quoteSymbol,
      };
    } catch {
      // Continue trying the next stable quote.
    }
  }

  throw new Error(`No USD reference market found for ${normalizedSymbol}.`);
}

export async function getTradingPairSnapshot(
  baseSymbol: string,
  quoteSymbol: string,
  credentials: BinanceCredentials | null
): Promise<{
  base: AssetUsdSnapshot;
  quote: AssetUsdSnapshot;
  priceInQuote: number;
  inversePrice: number;
  pricingSource: "direct" | "inverse" | "usd_cross";
}> {
  const normalizedBase = baseSymbol.trim().toUpperCase();
  const normalizedQuote = quoteSymbol.trim().toUpperCase();

  if (!normalizedBase || !normalizedQuote) {
    throw new Error("Both base and quote assets are required.");
  }

  const [base, quote] = await Promise.all([
    getAssetUsdSnapshot(normalizedBase, credentials),
    getAssetUsdSnapshot(normalizedQuote, credentials),
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
    const directTicker = await publicGet<BinanceTickerPriceResponse>(
      "/api/v3/ticker/price",
      { symbol: `${normalizedBase}${normalizedQuote}` },
      credentials
    );
    const directPrice = toNumber(directTicker.price);

    if (directPrice > 0) {
      return {
        base,
        quote,
        priceInQuote: directPrice,
        inversePrice: 1 / directPrice,
        pricingSource: "direct",
      };
    }
  } catch {
    // Fall back to the reverse or USD cross pricing.
  }

  try {
    const inverseTicker = await publicGet<BinanceTickerPriceResponse>(
      "/api/v3/ticker/price",
      { symbol: `${normalizedQuote}${normalizedBase}` },
      credentials
    );
    const inverseRawPrice = toNumber(inverseTicker.price);

    if (inverseRawPrice > 0) {
      return {
        base,
        quote,
        priceInQuote: 1 / inverseRawPrice,
        inversePrice: inverseRawPrice,
        pricingSource: "inverse",
      };
    }
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
    priceInQuote: crossPrice,
    inversePrice: crossPrice > 0 ? 1 / crossPrice : 0,
    pricingSource: "usd_cross",
  };
}

export async function getHourlyCloseSeries(
  symbol: string,
  credentials: BinanceCredentials | null,
  fallbackPrice: number
): Promise<number[]> {
  if (STABLE_COINS.has(symbol)) {
    return Array.from({ length: 24 }, () => round(fallbackPrice, 6));
  }

  const klines = await publicGet<BinanceKline[]>(
    "/api/v3/klines",
    { symbol: getPairSymbol(symbol), interval: "1h", limit: 24 },
    credentials
  );

  if (klines.length === 0) return fallbackSeries(fallbackPrice);
  return klines.map((kline) => round(toNumber(kline[4]), 6));
}

export async function getDailyCloseSeries(
  symbol: string,
  credentials: BinanceCredentials | null,
  fallbackPrice: number
): Promise<{ labels: string[]; closes: number[] }> {
  if (STABLE_COINS.has(symbol)) {
    return {
      labels: generateRecentDayLabels(30),
      closes: Array.from({ length: 30 }, () => fallbackPrice),
    };
  }

  const klines = await publicGet<BinanceKline[]>(
    "/api/v3/klines",
    { symbol: getPairSymbol(symbol), interval: "1d", limit: 30 },
    credentials
  );

  if (klines.length === 0) {
    return {
      labels: generateRecentDayLabels(30),
      closes: Array.from({ length: 30 }, () => fallbackPrice),
    };
  }

  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

  return {
    labels: klines.map((kline) => formatter.format(new Date(kline[6]))),
    closes: klines.map((kline) => round(toNumber(kline[4]), 6)),
  };
}

function toValueSeries(quantity: number, closes: number[]): number[] {
  return closes.map((close) => round(quantity * close, 2));
}

async function getAssetSnapshots(credentials: BinanceCredentials): Promise<AssetSnapshot[]> {
  const account = await signedGet<BinanceAccountResponse>("/api/v3/account", {}, credentials);
  const nonZeroBalances = account.balances
    .map((balance) => ({
      symbol: balance.asset.toUpperCase(),
      quantity: toNumber(balance.free) + toNumber(balance.locked),
    }))
    .filter((balance) => balance.quantity > 0);

  const snapshots = await Promise.all(
    nonZeroBalances.map(async (holding): Promise<AssetSnapshot | null> => {
      const symbol = holding.symbol;
      const metadata = ASSET_METADATA[symbol];

      try {
        const ticker = await getTickerSnapshot(symbol, credentials);
        const value = holding.quantity * ticker.price;
        const previousPrice =
          ticker.change24h <= -99.99 ? ticker.price : ticker.price / (1 + ticker.change24h / 100);
        const previousValue = holding.quantity * previousPrice;

        if (!STABLE_COINS.has(symbol) && value < MIN_ASSET_VALUE_USD) {
          return null;
        }

        const closeSeries = await getHourlyCloseSeries(symbol, credentials, ticker.price).catch(() => fallbackSeries(ticker.price));
        const sparkline = toValueSeries(holding.quantity, closeSeries);

        return {
          previousValue,
          asset: {
            id: symbol.toLowerCase(),
            symbol,
            name: metadata?.name ?? symbol,
            price: round(ticker.price, 6),
            change24h: round(ticker.change24h, 2),
            volume24h: round(ticker.volume24h, 2),
            marketCap: getMarketCapForSymbol(symbol),
            balance: round(holding.quantity, 8),
            value: round(value, 2),
            allocation: 0,
            targetAllocation: 0,
            sparkline,
            sparklinePeriod: "24h",
          },
        };
      } catch {
        if (STABLE_COINS.has(symbol)) {
          const value = holding.quantity;
          return {
            previousValue: value,
            asset: {
              id: symbol.toLowerCase(),
              symbol,
              name: metadata?.name ?? symbol,
              price: 1,
              change24h: 0,
              volume24h: 0,
              marketCap: getMarketCapForSymbol(symbol),
              balance: round(holding.quantity, 8),
              value: round(value, 2),
              allocation: 0,
              targetAllocation: 0,
              sparkline: Array.from({ length: 24 }, () => round(value, 2)),
              sparklinePeriod: "24h",
            },
          };
        }

        return null;
      }
    })
  );

  return snapshots
    .filter((snapshot): snapshot is AssetSnapshot => snapshot !== null)
    .sort((a, b) => b.asset.value - a.asset.value)
    .slice(0, MAX_ASSETS);
}

async function buildPortfolioHistory(assets: Asset[], credentials: BinanceCredentials): Promise<PortfolioHistoryPoint[]> {
  if (assets.length === 0) return [];

  const dailyData = await Promise.all(
    assets.map(async (asset) => {
      const series = await getDailyCloseSeries(asset.symbol, credentials, asset.price).catch(() => ({
        labels: generateRecentDayLabels(30),
        closes: Array.from({ length: 30 }, () => asset.price),
      }));
      return { symbol: asset.symbol, series };
    })
  );

  const labels = dailyData[0]?.series.labels ?? generateRecentDayLabels(30);

  return labels.map((label, index) => {
    const total = assets.reduce((sum, asset) => {
      const series = dailyData.find((entry) => entry.symbol === asset.symbol)?.series;
      const priceAtIndex = series?.closes[index] ?? asset.price;
      return sum + asset.balance * priceAtIndex;
    }, 0);

    return {
      time: label,
      value: round(total, 2),
    };
  });
}

async function buildRecentActivity(assets: Asset[], credentials: BinanceCredentials): Promise<Activity[]> {
  const symbols = assets
    .filter((asset) => !STABLE_COINS.has(asset.symbol))
    .slice(0, 5)
    .map((asset) => asset.symbol);

  if (symbols.length === 0) return [];

  const tradeGroups = await Promise.all(
    symbols.map(async (symbol) => {
      const trades = await signedGet<BinanceTradeResponse[]>(
        "/api/v3/myTrades",
        { symbol: getPairSymbol(symbol), limit: 5 },
        credentials
      ).catch(() => []);
      return { symbol, trades };
    })
  );

  const activities = tradeGroups
    .flatMap(({ symbol, trades }) =>
      trades.map((trade) => ({
        id: `${symbol}-${trade.id}`,
        type: trade.isBuyer ? "Buy" : "Sell",
        asset: symbol,
        amount: `${trade.isBuyer ? "+" : "-"}${toNumber(trade.qty).toLocaleString(undefined, {
          maximumFractionDigits: 8,
        })} ${symbol}`,
        time: formatRelativeTime(trade.time),
        timestamp: trade.time,
      }))
    )
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 4)
    .map(({ timestamp: _timestamp, ...activity }) => activity);

  return activities;
}

async function buildOrders(assets: Asset[], credentials: BinanceCredentials): Promise<Order[]> {
  const symbols = assets
    .filter((asset) => !STABLE_COINS.has(asset.symbol))
    .slice(0, 6)
    .map((asset) => asset.symbol);

  if (symbols.length === 0) return [];

  const orderGroups = await Promise.all(
    symbols.map(async (symbol) => {
      const orders = await signedGet<BinanceOrderResponse[]>(
        "/api/v3/allOrders",
        { symbol: getPairSymbol(symbol), limit: 20 },
        credentials
      ).catch(() => []);
      return { symbol, orders };
    })
  );

  const mappedOrders = orderGroups
    .flatMap(({ orders }) =>
      orders.map((order) => ({
        id: String(order.orderId),
        time: formatOrderTime(order.time),
        pair: order.symbol.endsWith("USDT")
          ? `${order.symbol.slice(0, -4)}/USDT`
          : `${order.symbol}/USDT`,
        side: (order.side === "BUY" ? "Buy" : "Sell") as Order["side"],
        price: round(toNumber(order.price), 8),
        amount: round(toNumber(order.origQty), 8),
        status: normalizeOrderStatus(order.status),
        timestamp: order.time,
      }))
    );

  return mappedOrders
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 40)
    .map(({ timestamp: _timestamp, ...order }): Order => order);
}

export async function getDashboardData(userScope?: StrategyUserScope): Promise<DashboardResponse> {
  const connection = await getConnectionStatus(userScope);
  const { credentials } = await getActiveCredentials(userScope);

  if (!connection.connected || !credentials) {
    return createFallbackDashboard(connection);
  }

  try {
    const snapshots = await getAssetSnapshots(credentials);
    const assets = snapshots.map((snapshot) => snapshot.asset);

    const totalPortfolioValue = snapshots.reduce((sum, snapshot) => sum + snapshot.asset.value, 0);
    const totalPreviousValue = snapshots.reduce((sum, snapshot) => sum + snapshot.previousValue, 0);

    const assetsWithAllocation = assets.map((asset) => {
      const allocation = totalPortfolioValue === 0 ? 0 : (asset.value / totalPortfolioValue) * 100;
      return {
        ...asset,
        allocation: round(allocation, 2),
        targetAllocation: round(allocation, 2),
      };
    });

    const portfolioChange24hValue = totalPortfolioValue - totalPreviousValue;
    const portfolioChange24h = totalPreviousValue === 0 ? 0 : (portfolioChange24hValue / totalPreviousValue) * 100;

    const marketMovers = [...assetsWithAllocation]
      .filter((asset) => !STABLE_COINS.has(asset.symbol))
      .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
      .slice(0, 5)
      .map((asset) => ({
        symbol: asset.symbol,
        name: getNameForSymbol(asset.symbol),
        change: round(asset.change24h, 2),
      }));

    const [portfolioHistory, recentActivity] = await Promise.all([
      buildPortfolioHistory(assetsWithAllocation, credentials),
      buildRecentActivity(assetsWithAllocation, credentials),
    ]);

    return {
      connection,
      assets: assetsWithAllocation,
      totalPortfolioValue: round(totalPortfolioValue, 2),
      portfolioChange24h: round(portfolioChange24h, 2),
      portfolioChange24hValue: round(portfolioChange24hValue, 2),
      portfolioHistory,
      marketMovers,
      recentActivity,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    return createFallbackDashboard({
      ...connection,
      connected: false,
      message: error instanceof Error ? error.message : "Failed to load live Binance portfolio data.",
    });
  }
}

export async function getOrdersData(userScope?: StrategyUserScope): Promise<OrdersResponse> {
  const connection = await getConnectionStatus(userScope);
  const { credentials } = await getActiveCredentials(userScope);

  if (!connection.connected || !credentials) {
    return createFallbackOrders(connection);
  }

  try {
    const snapshots = await getAssetSnapshots(credentials);
    const assets = snapshots.map((snapshot) => snapshot.asset);
    const orders = await buildOrders(assets, credentials);

    return {
      connection,
      orders,
    };
  } catch (error) {
    return createFallbackOrders({
      ...connection,
      connected: false,
      message: error instanceof Error ? error.message : "Failed to load live Binance orders.",
    });
  }
}

import { getDashboardData, getTickerSnapshot } from "../portfolioService.js";
import { allocationFromAssetValues } from "./asset-groups.js";
import { normalizeAllocation, round } from "./allocation-utils.js";
import { DemoAccountHolding, DemoAccountSettings, PortfolioAccountType, PortfolioState } from "./types.js";

const DEFAULT_DEMO_CAPITAL = 10_000;
const DEFAULT_DEMO_ALLOCATION = "BTC:40,ETH:30,BNB:10,USDC:20";
const STABLE_COINS = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "DAI"]);

function parsePositiveFloat(value: number | string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function parseDemoAllocation(rawValue: string | undefined, baseCurrency: string): Record<string, number> {
  const source = (rawValue ?? DEFAULT_DEMO_ALLOCATION).trim();
  const parsed: Record<string, number> = {};

  source.split(",").forEach((entry) => {
    const [left, right] = entry.split(":");
    const symbol = normalizeSymbol(left ?? "");
    const weight = Number((right ?? "").trim());
    if (!symbol || !Number.isFinite(weight) || weight < 0) return;
    parsed[symbol] = (parsed[symbol] ?? 0) + weight;
  });

  if (Object.keys(parsed).length === 0) {
    return { [baseCurrency]: 100 };
  }

  return normalizeAllocation(parsed);
}

function getResolvedDemoCapital(demoCapitalOverride?: number, demoAccount?: DemoAccountSettings): number {
  const fallbackCapital = parsePositiveFloat(process.env.DEMO_ACCOUNT_CAPITAL, DEFAULT_DEMO_CAPITAL);

  if (demoAccount) {
    return parsePositiveFloat(demoAccount.balance, fallbackCapital);
  }

  return parsePositiveFloat(demoCapitalOverride, fallbackCapital);
}

function normalizeHoldings(holdings: DemoAccountHolding[] | undefined): DemoAccountHolding[] {
  if (!Array.isArray(holdings)) return [];

  return holdings
    .map((holding) => ({
      symbol: normalizeSymbol(holding.symbol),
      quantity: Number.isFinite(holding.quantity) && holding.quantity >= 0 ? holding.quantity : 0,
      targetAllocation:
        Number.isFinite(holding.targetAllocation) && holding.targetAllocation >= 0 ? holding.targetAllocation : 0,
    }))
    .filter((holding) => holding.symbol.length > 0 && holding.quantity > 0);
}

export async function createDemoAccountHoldings(
  baseCurrency = "USDC",
  demoCapitalOverride?: number
): Promise<DemoAccountHolding[]> {
  const normalizedBase = normalizeSymbol(baseCurrency || "USDC");
  const demoCapital = getResolvedDemoCapital(demoCapitalOverride);
  const targetAllocation = parseDemoAllocation(process.env.DEMO_ACCOUNT_ALLOCATION, normalizedBase);
  const symbols = Array.from(new Set([...Object.keys(targetAllocation), normalizedBase]));

  const tickerEntries = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const ticker = await getTickerSnapshot(symbol, null);
        return [symbol, ticker] as const;
      } catch {
        return [symbol, { price: STABLE_COINS.has(symbol) ? 1 : 0, change24h: 0, volume24h: 0 }] as const;
      }
    })
  );

  const tickers = tickerEntries.reduce<Record<string, { price: number; change24h: number; volume24h: number }>>(
    (acc, [symbol, ticker]) => {
      acc[symbol] = ticker;
      return acc;
    },
    {}
  );

  const holdings = symbols
    .map((symbol) => {
      const ticker = tickers[symbol] ?? { price: 0, change24h: 0, volume24h: 0 };
      const targetPct = targetAllocation[symbol] ?? 0;
      const notional = (targetPct / 100) * demoCapital;
      const quantity = ticker.price > 0 ? notional / ticker.price : 0;

      return {
        symbol,
        quantity: round(quantity, 10),
        targetAllocation: round(targetPct, 4),
      };
    })
    .filter((holding) => holding.quantity > 0 || holding.targetAllocation > 0);

  const allocatedValue = holdings.reduce((sum, holding) => {
    const ticker = tickers[holding.symbol] ?? { price: 0, change24h: 0, volume24h: 0 };
    return sum + holding.quantity * ticker.price;
  }, 0);
  const remainder = Math.max(0, round(demoCapital - allocatedValue, 2));
  const baseHolding = holdings.find((holding) => holding.symbol === normalizedBase);

  if (remainder > 0) {
    const basePrice = tickers[normalizedBase]?.price ?? 1;
    if (baseHolding) {
      baseHolding.quantity = basePrice > 0 ? round(baseHolding.quantity + remainder / basePrice, 10) : round(baseHolding.quantity + remainder, 10);
    } else {
      holdings.push({
        symbol: normalizedBase,
        quantity: basePrice > 0 ? round(remainder / basePrice, 10) : round(remainder, 10),
        targetAllocation: round(targetAllocation[normalizedBase] ?? 0, 4),
      });
    }
  }

  return holdings.filter((holding) => holding.quantity > 0);
}

export async function getLivePortfolioState(baseCurrency = "USDC"): Promise<PortfolioState> {
  const dashboard = await getDashboardData();

  const assets = dashboard.assets.map((asset) => ({
    symbol: asset.symbol.toUpperCase(),
    quantity: asset.balance,
    price: asset.price,
    value: asset.value,
    allocation: asset.allocation,
    change24h: asset.change24h,
    volume24h: asset.volume24h,
  }));

  const inferredAllocation =
    assets.length > 0
      ? allocationFromAssetValues(assets.map((asset) => ({ symbol: asset.symbol, value: asset.value })))
      : {};

  const allocation =
    assets.length > 0
      ? normalizeAllocation(
          assets.reduce<Record<string, number>>((acc, asset) => {
            acc[asset.symbol] = asset.allocation;
            return acc;
          }, {}),
          Object.keys(inferredAllocation)
        )
      : normalizeAllocation({ [baseCurrency]: 100 });

  return {
    timestamp: dashboard.generatedAt,
    baseCurrency,
    totalValue: dashboard.totalPortfolioValue,
    assets,
    allocation,
  };
}

export async function getDemoPortfolioState(
  baseCurrency = "USDC",
  options?: { demoCapital?: number; demoAccount?: DemoAccountSettings }
): Promise<PortfolioState> {
  const normalizedBase = normalizeSymbol(baseCurrency || "USDC");
  const demoCapital = getResolvedDemoCapital(options?.demoCapital, options?.demoAccount);
  const savedHoldings = normalizeHoldings(options?.demoAccount?.holdings);
  const holdings = savedHoldings.length > 0 ? savedHoldings : await createDemoAccountHoldings(normalizedBase, demoCapital);
  const symbols = Array.from(new Set(holdings.map((holding) => holding.symbol)));

  const tickerEntries = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const ticker = await getTickerSnapshot(symbol, null);
        return [symbol, ticker] as const;
      } catch {
        return [symbol, { price: STABLE_COINS.has(symbol) ? 1 : 0, change24h: 0, volume24h: 0 }] as const;
      }
    })
  );

  const tickers = tickerEntries.reduce<Record<string, { price: number; change24h: number; volume24h: number }>>(
    (acc, [symbol, ticker]) => {
      acc[symbol] = ticker;
      return acc;
    },
    {}
  );

  const assets = holdings
    .map((holding) => {
      const ticker = tickers[holding.symbol] ?? { price: 0, change24h: 0, volume24h: 0 };
      const value = holding.quantity * ticker.price;

      return {
        symbol: holding.symbol,
        quantity: round(holding.quantity, 10),
        price: round(ticker.price, 8),
        value: round(value, 2),
        allocation: 0,
        change24h: round(ticker.change24h, 4),
        volume24h: round(ticker.volume24h, 2),
      };
    })
    .filter((asset) => asset.quantity > 0);

  if (assets.length === 0) {
    assets.push({
      symbol: normalizedBase,
      quantity: round(demoCapital, 10),
      price: 1,
      value: round(demoCapital, 2),
      allocation: 0,
      change24h: 0,
      volume24h: 0,
    });
  }

  const totalValue = assets.reduce((sum, asset) => sum + asset.value, 0);
  const allocation = normalizeAllocation(
    assets.reduce<Record<string, number>>((acc, asset) => {
      acc[asset.symbol] = totalValue > 0 ? (asset.value / totalValue) * 100 : 0;
      return acc;
    }, {}),
    assets.map((asset) => asset.symbol)
  );

  const assetsWithAllocation = assets
    .map((asset) => ({
      ...asset,
      allocation: allocation[asset.symbol] ?? 0,
    }))
    .sort((left, right) => right.value - left.value);

  return {
    timestamp: new Date().toISOString(),
    baseCurrency: normalizedBase,
    totalValue: round(totalValue, 2),
    assets: assetsWithAllocation,
    allocation,
  };
}

export async function getPortfolioState(
  accountType: PortfolioAccountType,
  baseCurrency = "USDC",
  options?: { demoCapital?: number; demoAccount?: DemoAccountSettings }
): Promise<PortfolioState> {
  if (accountType === "demo") {
    return getDemoPortfolioState(baseCurrency, options);
  }

  return getLivePortfolioState(baseCurrency);
}

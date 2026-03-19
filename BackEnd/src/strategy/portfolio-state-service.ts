import { getDashboardData, getTickerSnapshot } from "../portfolioService.js";
import { allocationFromAssetValues } from "./asset-groups.js";
import { normalizeAllocation, round } from "./allocation-utils.js";
import type { StrategyUserScope } from "./strategy-user-scope.js";
import {
  DemoAccountAllocationInput,
  DemoAccountHolding,
  DemoAccountSettings,
  PortfolioAccountType,
  PortfolioState,
  RebalanceAllocationProfile,
} from "./types.js";

const DEFAULT_DEMO_CAPITAL = 10_000;
const DEFAULT_DEMO_ALLOCATION = "BTC:40,ETH:30,XRP:10,USDC:20";
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

function allocationMapFromInput(
  allocations: DemoAccountAllocationInput[] | Record<string, number> | undefined,
  normalizedBase: string
): Record<string, number> | null {
  if (!allocations) return null;

  const rawMap: Record<string, number> = {};

  if (Array.isArray(allocations)) {
    allocations.forEach((entry) => {
      const symbol = normalizeSymbol(entry.symbol);
      const percent = Number(entry.percent);
      if (!symbol || !Number.isFinite(percent) || percent < 0) return;
      rawMap[symbol] = (rawMap[symbol] ?? 0) + percent;
    });
  } else {
    Object.entries(allocations).forEach(([symbol, percent]) => {
      const normalizedSymbol = normalizeSymbol(symbol);
      const safePercent = Number(percent);
      if (!normalizedSymbol || !Number.isFinite(safePercent) || safePercent < 0) return;
      rawMap[normalizedSymbol] = (rawMap[normalizedSymbol] ?? 0) + safePercent;
    });
  }

  if (Object.keys(rawMap).length === 0) {
    return { [normalizedBase]: 100 };
  }

  return normalizeAllocation(rawMap);
}

export function getEffectiveDemoHoldings(
  baseCurrency = "USDC",
  options?: { demoAccount?: DemoAccountSettings; botProfiles?: RebalanceAllocationProfile[] }
): DemoAccountHolding[] {
  const normalizedBase = normalizeSymbol(baseCurrency || "USDC");
  const totalCapital = getResolvedDemoCapital(undefined, options?.demoAccount);
  const coreHoldings = normalizeHoldings(options?.demoAccount?.holdings);
  const enabledProfiles = (options?.botProfiles ?? []).filter((profile) => profile.isEnabled);

  if (enabledProfiles.length === 0) {
    return coreHoldings;
  }

  const bySymbol = new Map<string, { quantity: number; targetAllocation: number }>();
  coreHoldings.forEach((holding) => {
    bySymbol.set(holding.symbol, {
      quantity: holding.quantity,
      targetAllocation: holding.targetAllocation,
    });
  });

  enabledProfiles.forEach((profile) => {
    const fundingSymbol = normalizeSymbol(profile.baseCurrency || normalizedBase);
    const reservedTargetAllocation = totalCapital > 0 ? (profile.allocatedCapital / totalCapital) * 100 : 0;
    const currentFunding = bySymbol.get(fundingSymbol) ?? { quantity: 0, targetAllocation: 0 };

    bySymbol.set(fundingSymbol, {
      quantity: Math.max(0, currentFunding.quantity - profile.allocatedCapital),
      targetAllocation: Math.max(0, currentFunding.targetAllocation - reservedTargetAllocation),
    });

    normalizeHoldings(profile.holdings).forEach((holding) => {
      const current = bySymbol.get(holding.symbol) ?? { quantity: 0, targetAllocation: 0 };
      const contributionTargetAllocation =
        totalCapital > 0 ? (holding.targetAllocation * profile.allocatedCapital) / totalCapital : 0;

      bySymbol.set(holding.symbol, {
        quantity: current.quantity + holding.quantity,
        targetAllocation: current.targetAllocation + contributionTargetAllocation,
      });
    });
  });

  return Array.from(bySymbol.entries())
    .map(([symbol, holding]) => ({
      symbol,
      quantity: round(Math.max(0, holding.quantity), 10),
      targetAllocation: round(Math.max(0, holding.targetAllocation), 4),
    }))
    .filter((holding) => holding.quantity > 0 || holding.targetAllocation > 0);
}

export async function createDemoAccountHoldings(
  baseCurrency = "USDC",
  demoCapitalOverride?: number,
  allocationOverride?: DemoAccountAllocationInput[] | Record<string, number>
): Promise<DemoAccountHolding[]> {
  const normalizedBase = normalizeSymbol(baseCurrency || "USDC");
  const demoCapital = getResolvedDemoCapital(demoCapitalOverride);
  const targetAllocation =
    allocationMapFromInput(allocationOverride, normalizedBase) ??
    parseDemoAllocation(process.env.DEMO_ACCOUNT_ALLOCATION, normalizedBase);
  const symbols = Array.from(new Set([...Object.keys(targetAllocation), normalizedBase]));

  const tickerEntries = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const ticker = await getTickerSnapshot(symbol);
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

export async function getLivePortfolioState(baseCurrency = "USDC", userScope?: StrategyUserScope): Promise<PortfolioState> {
  const dashboard = await getDashboardData(userScope);

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
  options?: { demoCapital?: number; demoAccount?: DemoAccountSettings; botProfiles?: RebalanceAllocationProfile[] }
): Promise<PortfolioState> {
  const normalizedBase = normalizeSymbol(baseCurrency || "USDC");
  const holdings = getEffectiveDemoHoldings(normalizedBase, options);
  const symbols = Array.from(new Set(holdings.map((holding) => holding.symbol)));

  const tickerEntries = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const ticker = await getTickerSnapshot(symbol);
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
  options?: {
    demoCapital?: number;
    demoAccount?: DemoAccountSettings;
    userScope?: StrategyUserScope;
    botProfiles?: RebalanceAllocationProfile[];
  }
): Promise<PortfolioState> {
  if (accountType === "demo") {
    return getDemoPortfolioState(baseCurrency, options);
  }

  return getLivePortfolioState(baseCurrency, options?.userScope);
}

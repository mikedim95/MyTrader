import { getAssetUsdSnapshot, getNameForSymbol, getTradingPairSnapshot } from "../portfolioService.js";
import { getPortfolioState } from "../strategy/portfolio-state-service.js";
import type { StrategyRepository } from "../strategy/strategy-repository.js";
import type { StrategyUserScope } from "../strategy/strategy-user-scope.js";
import type { DemoAccountHolding, PortfolioAccountType, RebalanceAllocationProfile } from "../strategy/types.js";

export type TradingAmountMode = "selling_asset" | "buying_asset" | "buying_asset_usdt";

export interface TradingAssetAvailability {
  symbol: string;
  name: string;
  totalAmount: number;
  reservedAmount: number;
  freeAmount: number;
  lockedAmount: number;
  priceUsd: number;
  totalValueUsd: number;
  reservedValueUsd: number;
  freeValueUsd: number;
}

export interface TradingPairPreviewResponse {
  accountType: PortfolioAccountType;
  pair: {
    baseSymbol: string;
    baseName: string;
    quoteSymbol: string;
    quoteName: string;
    basePriceUsd: number;
    quotePriceUsd: number;
    priceInQuote: number;
    inversePrice: number;
    baseChange24h: number;
    quoteChange24h: number;
    baseBalance: number;
    quoteBalance: number;
    baseReservedBalance: number;
    quoteReservedBalance: number;
    baseFreeBalance: number;
    quoteFreeBalance: number;
    baseLockedBalance: number;
    quoteLockedBalance: number;
    pricingSource: "direct" | "inverse" | "usd_cross";
    executionSymbol: string | null;
    executionSide: "BUY" | "SELL" | null;
    executable: boolean;
  };
  generatedAt: string;
}

export interface TradingAssetsResponse {
  accountType: PortfolioAccountType;
  assets: TradingAssetAvailability[];
  generatedAt: string;
}

export interface TradePreviewResponse {
  accountType: PortfolioAccountType;
  buyingAsset: TradingAssetAvailability;
  sellingAsset: TradingAssetAvailability;
  amountMode: TradingAmountMode;
  requestedAmount: number;
  buyAmount: number;
  sellAmount: number;
  buyWorthUsdt: number;
  priceInSellingAsset: number;
  inversePrice: number;
  pricingSource: "direct" | "inverse" | "usd_cross";
  executionSymbol: string | null;
  executionSide: "BUY" | "SELL" | null;
  executable: boolean;
  warnings: string[];
  blockingReasons: string[];
  generatedAt: string;
}

export interface TradeExecutionResponse {
  accountType: PortfolioAccountType;
  preview: TradePreviewResponse;
  execution: {
    status: "completed";
    orderId: string | null;
    symbol: string | null;
    side: "BUY" | "SELL" | null;
    executedBuyAmount: number;
    executedSellAmount: number;
    executedBuyWorthUsdt: number;
    message: string;
    executedAt: string;
    raw: unknown;
  };
}

interface TradeRequestInput {
  accountType: PortfolioAccountType;
  buyingAsset: string;
  sellingAsset: string;
  amountMode: TradingAmountMode;
  amount: number;
}

interface AvailabilitySnapshot {
  accountType: PortfolioAccountType;
  assets: TradingAssetAvailability[];
  bySymbol: Map<string, TradingAssetAvailability>;
}

const STABLE_SYMBOLS = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "DAI"]);

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function round(value: number, digits = 8): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function roundUsd(value: number): number {
  return round(value, 2);
}

function buildExecutionRoute(
  buyingAsset: string,
  sellingAsset: string,
  pricingSource: "direct" | "inverse" | "usd_cross"
): { symbol: string | null; side: "BUY" | "SELL" | null } {
  if (pricingSource === "direct") {
    return {
      symbol: `${buyingAsset}${sellingAsset}`,
      side: "BUY",
    };
  }

  if (pricingSource === "inverse") {
    return {
      symbol: `${sellingAsset}${buyingAsset}`,
      side: "SELL",
    };
  }

  return {
    symbol: null,
    side: null,
  };
}

function collectReservedHoldings(
  profiles: RebalanceAllocationProfile[]
): Map<string, number> {
  const reserved = new Map<string, number>();

  profiles
    .filter((profile) => profile.isEnabled)
    .forEach((profile) => {
      profile.holdings.forEach((holding) => {
        const symbol = normalizeSymbol(holding.symbol);
        reserved.set(symbol, (reserved.get(symbol) ?? 0) + Math.max(0, holding.quantity));
      });
    });

  return reserved;
}

function buildEmptyAvailability(symbol: string, priceUsd = 0): TradingAssetAvailability {
  return {
    symbol,
    name: getNameForSymbol(symbol),
    totalAmount: 0,
    reservedAmount: 0,
    freeAmount: 0,
    lockedAmount: 0,
    priceUsd: round(priceUsd, 8),
    totalValueUsd: 0,
    reservedValueUsd: 0,
    freeValueUsd: 0,
  };
}

async function priceForSymbol(symbol: string): Promise<number> {
  if (STABLE_SYMBOLS.has(symbol)) {
    return 1;
  }

  try {
    const snapshot = await getAssetUsdSnapshot(symbol);
    return round(snapshot.price, 8);
  } catch {
    return 0;
  }
}

export class TradingService {
  constructor(private readonly repository: StrategyRepository) {}

  private async getAvailabilitySnapshot(
    accountType: PortfolioAccountType,
    userScope?: StrategyUserScope
  ): Promise<AvailabilitySnapshot> {
    if (accountType === "demo") {
      const [demoAccount, profiles] = await Promise.all([
        this.repository.getDemoAccountSettings(userScope),
        this.repository.listRebalanceAllocationProfiles(userScope),
      ]);
      const portfolio = await getPortfolioState("demo", "USDC", { demoAccount, userScope, botProfiles: profiles });
      const reservedBySymbol = collectReservedHoldings(profiles);
      const assetSymbols = new Set<string>([
        ...portfolio.assets.map((asset) => normalizeSymbol(asset.symbol)),
        ...reservedBySymbol.keys(),
      ]);

      const assets = Array.from(assetSymbols).map((symbol) => {
        const portfolioAsset = portfolio.assets.find((asset) => normalizeSymbol(asset.symbol) === symbol);
        const priceUsd = portfolioAsset?.price ?? 0;
        const totalAmount = portfolioAsset?.quantity ?? 0;
        const reservedAmount = reservedBySymbol.get(symbol) ?? 0;
        const freeAmount = Math.max(0, totalAmount - reservedAmount);

        return {
          symbol,
          name: getNameForSymbol(symbol),
          totalAmount: round(totalAmount, 10),
          reservedAmount: round(reservedAmount, 10),
          freeAmount: round(freeAmount, 10),
          lockedAmount: 0,
          priceUsd: round(priceUsd, 8),
          totalValueUsd: roundUsd(totalAmount * priceUsd),
          reservedValueUsd: roundUsd(reservedAmount * priceUsd),
          freeValueUsd: roundUsd(freeAmount * priceUsd),
        };
      });

      assets.sort((left, right) => right.freeValueUsd - left.freeValueUsd || left.symbol.localeCompare(right.symbol));

      return {
        accountType,
        assets,
        bySymbol: new Map(assets.map((asset) => [asset.symbol, asset])),
      };
    }

    return {
      accountType,
      assets: [],
      bySymbol: new Map(),
    };
  }

  async getAssetAvailability(
    accountType: PortfolioAccountType,
    userScope?: StrategyUserScope
  ): Promise<TradingAssetsResponse> {
    const snapshot = await this.getAvailabilitySnapshot(accountType, userScope);
    return {
      accountType,
      assets: snapshot.assets,
      generatedAt: new Date().toISOString(),
    };
  }

  async getPairPreview(
    baseSymbol: string,
    quoteSymbol: string,
    accountType: PortfolioAccountType,
    userScope?: StrategyUserScope
  ): Promise<TradingPairPreviewResponse> {
    const normalizedBase = normalizeSymbol(baseSymbol);
    const normalizedQuote = normalizeSymbol(quoteSymbol);
    const snapshot = await this.getAvailabilitySnapshot(accountType, userScope);
    const pairSnapshot = await getTradingPairSnapshot(normalizedBase, normalizedQuote);
    const executionRoute = buildExecutionRoute(normalizedBase, normalizedQuote, pairSnapshot.pricingSource);
    const baseAvailability = snapshot.bySymbol.get(normalizedBase) ?? buildEmptyAvailability(normalizedBase, pairSnapshot.base.price);
    const quoteAvailability = snapshot.bySymbol.get(normalizedQuote) ?? buildEmptyAvailability(normalizedQuote, pairSnapshot.quote.price);

    return {
      accountType,
      pair: {
        baseSymbol: normalizedBase,
        baseName: getNameForSymbol(normalizedBase),
        quoteSymbol: normalizedQuote,
        quoteName: getNameForSymbol(normalizedQuote),
        basePriceUsd: round(pairSnapshot.base.price, 8),
        quotePriceUsd: round(pairSnapshot.quote.price, 8),
        priceInQuote: round(pairSnapshot.priceInQuote, 8),
        inversePrice: round(pairSnapshot.inversePrice, 8),
        baseChange24h: round(pairSnapshot.base.change24h, 4),
        quoteChange24h: round(pairSnapshot.quote.change24h, 4),
        baseBalance: round(baseAvailability.totalAmount, 10),
        quoteBalance: round(quoteAvailability.totalAmount, 10),
        baseReservedBalance: round(baseAvailability.reservedAmount, 10),
        quoteReservedBalance: round(quoteAvailability.reservedAmount, 10),
        baseFreeBalance: round(baseAvailability.freeAmount, 10),
        quoteFreeBalance: round(quoteAvailability.freeAmount, 10),
        baseLockedBalance: round(baseAvailability.lockedAmount, 10),
        quoteLockedBalance: round(quoteAvailability.lockedAmount, 10),
        pricingSource: pairSnapshot.pricingSource,
        executionSymbol: executionRoute.symbol,
        executionSide: executionRoute.side,
        executable: pairSnapshot.pricingSource !== "usd_cross",
      },
      generatedAt: new Date().toISOString(),
    };
  }

  private async buildTradePreview(
    input: TradeRequestInput,
    userScope?: StrategyUserScope
  ): Promise<TradePreviewResponse> {
    const buyingAsset = normalizeSymbol(input.buyingAsset);
    const sellingAsset = normalizeSymbol(input.sellingAsset);

    if (!buyingAsset || !sellingAsset) {
      throw new Error("Buying asset and selling asset are required.");
    }

    if (buyingAsset === sellingAsset) {
      throw new Error("Buying asset and selling asset must be different.");
    }

    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error("Amount must be greater than zero.");
    }

    const snapshot = await this.getAvailabilitySnapshot(input.accountType, userScope);
    const pairSnapshot = await getTradingPairSnapshot(buyingAsset, sellingAsset);
    const route = buildExecutionRoute(buyingAsset, sellingAsset, pairSnapshot.pricingSource);

    const buyingAvailability =
      snapshot.bySymbol.get(buyingAsset) ?? buildEmptyAvailability(buyingAsset, pairSnapshot.base.price);
    const sellingAvailability =
      snapshot.bySymbol.get(sellingAsset) ?? buildEmptyAvailability(sellingAsset, pairSnapshot.quote.price);

    let buyAmount = 0;
    let sellAmount = 0;
    let buyWorthUsdt = 0;

    if (input.amountMode === "selling_asset") {
      sellAmount = input.amount;
      buyAmount = pairSnapshot.priceInQuote > 0 ? sellAmount / pairSnapshot.priceInQuote : 0;
      buyWorthUsdt = buyAmount * pairSnapshot.base.price;
    } else if (input.amountMode === "buying_asset") {
      buyAmount = input.amount;
      sellAmount = buyAmount * pairSnapshot.priceInQuote;
      buyWorthUsdt = buyAmount * pairSnapshot.base.price;
    } else {
      buyWorthUsdt = input.amount;
      buyAmount = pairSnapshot.base.price > 0 ? buyWorthUsdt / pairSnapshot.base.price : 0;
      sellAmount = buyAmount * pairSnapshot.priceInQuote;
    }

    const warnings: string[] = [];
    const blockingReasons: string[] = [];

    if (pairSnapshot.pricingSource === "usd_cross") {
      blockingReasons.push("This asset pair only has a USD cross price. Direct execution requires a direct or reverse exchange market.");
    }

    if (sellAmount - sellingAvailability.freeAmount > 0.00000001) {
      blockingReasons.push(
        `${sellingAsset} free balance is ${round(sellingAvailability.freeAmount, 8)} but the trade needs ${round(sellAmount, 8)}.`
      );
    }

    if (sellAmount <= 0 || buyAmount <= 0 || buyWorthUsdt <= 0) {
      blockingReasons.push("The requested trade amount is too small to preview.");
    }

    if (input.accountType === "real") {
      blockingReasons.push("Live exchange execution is unavailable.");
    }

    if (input.accountType === "demo" && sellingAvailability.freeAmount <= 0) {
      warnings.push(`${sellingAsset} has no free balance available outside active bots.`);
    }

    return {
      accountType: input.accountType,
      buyingAsset: buyingAvailability,
      sellingAsset: sellingAvailability,
      amountMode: input.amountMode,
      requestedAmount: round(input.amount, 8),
      buyAmount: round(buyAmount, 8),
      sellAmount: round(sellAmount, 8),
      buyWorthUsdt: roundUsd(buyWorthUsdt),
      priceInSellingAsset: round(pairSnapshot.priceInQuote, 8),
      inversePrice: round(pairSnapshot.inversePrice, 8),
      pricingSource: pairSnapshot.pricingSource,
      executionSymbol: route.symbol,
      executionSide: route.side,
      executable: blockingReasons.length === 0,
      warnings,
      blockingReasons,
      generatedAt: new Date().toISOString(),
    };
  }

  async previewTrade(input: TradeRequestInput, userScope?: StrategyUserScope): Promise<TradePreviewResponse> {
    return this.buildTradePreview(input, userScope);
  }

  private async rebuildDemoHoldings(holdings: DemoAccountHolding[]): Promise<DemoAccountHolding[]> {
    const cleaned = holdings
      .map((holding) => ({
        symbol: normalizeSymbol(holding.symbol),
        quantity: round(Math.max(0, holding.quantity), 10),
      }))
      .filter((holding) => holding.quantity > 0);

    if (cleaned.length === 0) {
      return [];
    }

    const priced = await Promise.all(
      cleaned.map(async (holding) => {
        const price = await priceForSymbol(holding.symbol);
        return {
          ...holding,
          price,
          value: holding.quantity * price,
        };
      })
    );

    const totalValue = priced.reduce((sum, holding) => sum + holding.value, 0);

    return priced
      .map((holding) => ({
        symbol: holding.symbol,
        quantity: round(holding.quantity, 10),
        targetAllocation: totalValue > 0 ? round((holding.value / totalValue) * 100, 4) : 0,
      }))
      .filter((holding) => holding.quantity > 0);
  }

  async executeTrade(input: TradeRequestInput, userScope?: StrategyUserScope): Promise<TradeExecutionResponse> {
    const preview = await this.buildTradePreview(input, userScope);

    if (!preview.executable || preview.blockingReasons.length > 0) {
      throw new Error(preview.blockingReasons[0] ?? "This trade cannot be executed.");
    }

    if (input.accountType === "demo") {
      const demoAccount = await this.repository.getDemoAccountSettings(userScope);
      const quantities = new Map(
        demoAccount.holdings.map((holding) => [normalizeSymbol(holding.symbol), Math.max(0, holding.quantity)])
      );

      quantities.set(
        preview.sellingAsset.symbol,
        Math.max(0, (quantities.get(preview.sellingAsset.symbol) ?? 0) - preview.sellAmount)
      );
      quantities.set(
        preview.buyingAsset.symbol,
        (quantities.get(preview.buyingAsset.symbol) ?? 0) + preview.buyAmount
      );

      const nextHoldings = await this.rebuildDemoHoldings(
        Array.from(quantities.entries()).map(([symbol, quantity]) => ({
          symbol,
          quantity,
          targetAllocation: 0,
        }))
      );

      await this.repository.setDemoAccountHoldings(nextHoldings, userScope);

      return {
        accountType: "demo",
        preview,
        execution: {
          status: "completed",
          orderId: null,
          symbol: preview.executionSymbol,
          side: preview.executionSide,
          executedBuyAmount: preview.buyAmount,
          executedSellAmount: preview.sellAmount,
          executedBuyWorthUsdt: preview.buyWorthUsdt,
          message: `Demo conversion executed from ${preview.sellingAsset.symbol} into ${preview.buyingAsset.symbol}.`,
          executedAt: new Date().toISOString(),
          raw: {
            mode: "demo",
          },
        },
      };
    }

    throw new Error("Live exchange execution is unavailable.");
  }
}

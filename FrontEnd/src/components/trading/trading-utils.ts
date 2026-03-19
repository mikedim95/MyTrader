import type { TradingAmountMode, TradingAssetAvailability } from "@/types/api";

export const COMMON_SYMBOL_SUGGESTIONS = [
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "ADA",
  "DOGE",
  "AVAX",
  "LINK",
  "LTC",
  "BCH",
  "ETC",
  "UNI",
  "AAVE",
  "INJ",
  "NEAR",
  "HBAR",
  "SUI",
  "TON",
  "SHIB",
  "PEPE",
  "APT",
  "ARB",
  "OP",
  "SEI",
  "RUNE",
  "MATIC",
  "XLM",
  "ALGO",
  "TRX",
  "DOT",
  "ATOM",
  "USDT",
  "USDC",
  "FDUSD",
];

export const QUOTE_PRIORITY = ["USDT", "USDC", "FDUSD", "BTC", "ETH", "XRP"];
export const STABLE_SYMBOLS = new Set(["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "DAI"]);

export function normalizeSymbolInput(value: string): string {
  return value.trim().toUpperCase();
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function formatAssetAmount(value: number, symbol: string): string {
  if (!Number.isFinite(value)) return `-- ${symbol}`;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${symbol}`;
}

export function formatPairPrice(value: number): string {
  if (!Number.isFinite(value)) return "--";
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

export function pricingSourceLabel(source: "direct" | "inverse" | "usd_cross" | undefined): string {
  if (source === "direct") return "Direct market";
  if (source === "inverse") return "Reverse market";
  if (source === "usd_cross") return "USD cross";
  return "--";
}

export function pickAlternateSymbol(
  currentSymbol: string,
  excludedSymbol: string,
  orderedOptions: string[],
  fallback = "USDT"
): string {
  return orderedOptions.find((symbol) => symbol !== currentSymbol && symbol !== excludedSymbol) ?? fallback;
}

export function amountModeLabel(mode: TradingAmountMode, buyingAsset: string, sellingAsset: string): string {
  if (mode === "selling_asset") return `Selling ${sellingAsset || "asset"}`;
  if (mode === "buying_asset") return `Buying ${buyingAsset || "asset"}`;
  return `${buyingAsset || "Buy asset"} worth (USDT)`;
}

export function executionRouteLabel(executionSymbol: string | null, executionSide: "BUY" | "SELL" | null): string {
  if (!executionSymbol || !executionSide) return "Preview only";

  const quoteCandidates = ["USDT", "USDC", "FDUSD", "BTC", "ETH", "XRP"];
  const quote = quoteCandidates.find((candidate) => executionSymbol.endsWith(candidate)) ?? "";
  const base = quote ? executionSymbol.slice(0, -quote.length) : executionSymbol;
  return `${base}/${quote || "?"} ${executionSide}`;
}

export function buildEmptyAvailability(symbol: string, priceUsd = 0): TradingAssetAvailability {
  return {
    symbol,
    name: symbol,
    totalAmount: 0,
    reservedAmount: 0,
    freeAmount: 0,
    lockedAmount: 0,
    priceUsd,
    totalValueUsd: 0,
    reservedValueUsd: 0,
    freeValueUsd: 0,
  };
}

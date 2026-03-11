import { AllocationMap, StrategyGroup } from "./types.js";
import { DEFAULT_LARGE_CAPS, DEFAULT_STABLECOINS, sortSymbols, toUpperSymbol } from "./allocation-utils.js";

export interface AssetGroupResolver {
  getAssetsForToken(token: string): string[];
  getAllSymbols(): string[];
  isStablecoin(symbol: string): boolean;
}

export function createAssetGroupResolver(assetUniverse: string[], customStablecoins?: string[]): AssetGroupResolver {
  const symbols = sortSymbols(assetUniverse);
  const stablecoins = new Set(customStablecoins?.map(toUpperSymbol) ?? Array.from(DEFAULT_STABLECOINS));

  const getGroupAssets = (group: StrategyGroup): string[] => {
    if (group === "BTC") return symbols.includes("BTC") ? ["BTC"] : [];
    if (group === "ETH") return symbols.includes("ETH") ? ["ETH"] : [];
    if (group === "STABLECOINS") return symbols.filter((symbol) => stablecoins.has(symbol));
    if (group === "LARGE_CAPS") return symbols.filter((symbol) => DEFAULT_LARGE_CAPS.has(symbol));

    return symbols.filter(
      (symbol) => !stablecoins.has(symbol) && symbol !== "BTC" && symbol !== "ETH" && !DEFAULT_LARGE_CAPS.has(symbol)
    );
  };

  return {
    getAssetsForToken(token: string): string[] {
      const normalized = toUpperSymbol(token);
      if ((["BTC", "ETH", "STABLECOINS", "ALTCOINS", "LARGE_CAPS"] as string[]).includes(normalized)) {
        return getGroupAssets(normalized as StrategyGroup);
      }

      return symbols.includes(normalized) ? [normalized] : [];
    },
    getAllSymbols(): string[] {
      return [...symbols];
    },
    isStablecoin(symbol: string): boolean {
      return stablecoins.has(toUpperSymbol(symbol));
    },
  };
}

export function allocationFromAssetValues(values: Array<{ symbol: string; value: number }>): AllocationMap {
  const total = values.reduce((sum, entry) => sum + Math.max(0, entry.value), 0);
  if (total <= 0) {
    return {};
  }

  const map: AllocationMap = {};
  values.forEach(({ symbol, value }) => {
    map[toUpperSymbol(symbol)] = (Math.max(0, value) / total) * 100;
  });

  return map;
}

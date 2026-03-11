import { AssetGroupResolver } from "./asset-groups.js";
import { AllocationMap, StrategyAction } from "./types.js";
import { normalizeAllocation, round, withAllAssets } from "./allocation-utils.js";

export interface AllocationAdjustmentResult {
  allocation: AllocationMap;
  warnings: string[];
  changedAssets: string[];
}

function sumForSymbols(allocation: AllocationMap, symbols: string[]): number {
  return symbols.reduce((sum, symbol) => sum + (allocation[symbol] ?? 0), 0);
}

function toUniqueSorted(symbols: string[]): string[] {
  return Array.from(new Set(symbols)).sort((left, right) => left.localeCompare(right));
}

function redistributeFromSource(
  allocation: AllocationMap,
  sourceSymbols: string[],
  targetSymbols: string[],
  requestedPercent: number
): { movedPercent: number; changedAssets: string[] } {
  if (sourceSymbols.length === 0 || targetSymbols.length === 0 || requestedPercent <= 0) {
    return { movedPercent: 0, changedAssets: [] };
  }

  const sourceTotal = sumForSymbols(allocation, sourceSymbols);
  const movable = Math.min(requestedPercent, sourceTotal);
  if (movable <= 0) {
    return { movedPercent: 0, changedAssets: [] };
  }

  const changed = new Set<string>();

  sourceSymbols.forEach((symbol) => {
    const current = allocation[symbol] ?? 0;
    if (current <= 0) return;

    const reduction = (current / sourceTotal) * movable;
    allocation[symbol] = Math.max(0, current - reduction);
    changed.add(symbol);
  });

  const targetCurrentTotal = sumForSymbols(allocation, targetSymbols);
  if (targetCurrentTotal > 0) {
    targetSymbols.forEach((symbol) => {
      const current = allocation[symbol] ?? 0;
      const increase = (current / targetCurrentTotal) * movable;
      allocation[symbol] = current + increase;
      changed.add(symbol);
    });
  } else {
    const even = movable / targetSymbols.length;
    targetSymbols.forEach((symbol) => {
      allocation[symbol] = (allocation[symbol] ?? 0) + even;
      changed.add(symbol);
    });
  }

  return {
    movedPercent: round(movable, 4),
    changedAssets: toUniqueSorted(Array.from(changed)),
  };
}

function buildUniverseAllocation(allocation: AllocationMap, resolver: AssetGroupResolver): AllocationMap {
  return withAllAssets(allocation, resolver.getAllSymbols());
}

function resolveTargets(token: string | undefined, resolver: AssetGroupResolver): string[] {
  if (!token) return [];
  return resolver.getAssetsForToken(token);
}

export function applyActionToAllocation(
  currentAllocation: AllocationMap,
  action: StrategyAction,
  resolver: AssetGroupResolver
): AllocationAdjustmentResult {
  const working = buildUniverseAllocation({ ...currentAllocation }, resolver);
  const warnings: string[] = [];
  let changedAssets: string[] = [];

  const allSymbols = resolver.getAllSymbols();
  const stablecoins = resolver.getAssetsForToken("STABLECOINS");
  const altcoins = resolver.getAssetsForToken("ALTCOINS");

  if (action.type === "increase") {
    const targets = resolveTargets(action.asset, resolver);
    if (targets.length === 0) {
      warnings.push(`Increase action ignored because target ${action.asset ?? "asset"} was not found.`);
      return { allocation: normalizeAllocation(working, allSymbols), warnings, changedAssets };
    }

    const sources = allSymbols.filter((symbol) => !targets.includes(symbol));
    const result = redistributeFromSource(working, sources, targets, action.percent);
    changedAssets = result.changedAssets;

    if (result.movedPercent < action.percent) {
      warnings.push(
        `Increase action moved ${round(result.movedPercent, 2)}% instead of ${action.percent}% due to source allocation limits.`
      );
    }
  }

  if (action.type === "decrease") {
    const sources = resolveTargets(action.asset, resolver);
    if (sources.length === 0) {
      warnings.push(`Decrease action ignored because source ${action.asset ?? "asset"} was not found.`);
      return { allocation: normalizeAllocation(working, allSymbols), warnings, changedAssets };
    }

    const targets = allSymbols.filter((symbol) => !sources.includes(symbol));
    const result = redistributeFromSource(working, sources, targets, action.percent);
    changedAssets = result.changedAssets;

    if (result.movedPercent < action.percent) {
      warnings.push(
        `Decrease action moved ${round(result.movedPercent, 2)}% instead of ${action.percent}% due to source allocation limits.`
      );
    }
  }

  if (action.type === "shift") {
    const sources = resolveTargets(action.from, resolver);
    const targets = resolveTargets(action.to, resolver);

    if (sources.length === 0 || targets.length === 0) {
      warnings.push(
        `Shift action ignored because one side could not be resolved (from=${action.from ?? "n/a"}, to=${action.to ?? "n/a"}).`
      );
      return { allocation: normalizeAllocation(working, allSymbols), warnings, changedAssets };
    }

    const result = redistributeFromSource(working, sources, targets, action.percent);
    changedAssets = result.changedAssets;

    if (result.movedPercent < action.percent) {
      warnings.push(`Shift action moved ${round(result.movedPercent, 2)}% instead of ${action.percent}% due to source limits.`);
    }
  }

  if (action.type === "increase_stablecoin_exposure") {
    if (stablecoins.length === 0) {
      warnings.push("increase_stablecoin_exposure ignored because no stablecoin assets were available.");
      return { allocation: normalizeAllocation(working, allSymbols), warnings, changedAssets };
    }

    const sources = allSymbols.filter((symbol) => !stablecoins.includes(symbol));
    const result = redistributeFromSource(working, sources, stablecoins, action.percent);
    changedAssets = result.changedAssets;

    if (result.movedPercent < action.percent) {
      warnings.push(
        `increase_stablecoin_exposure moved ${round(result.movedPercent, 2)}% instead of ${action.percent}% due to source limits.`
      );
    }
  }

  if (action.type === "reduce_altcoin_exposure") {
    if (altcoins.length === 0 || stablecoins.length === 0) {
      warnings.push("reduce_altcoin_exposure ignored because altcoin/stablecoin groups were not available.");
      return { allocation: normalizeAllocation(working, allSymbols), warnings, changedAssets };
    }

    const result = redistributeFromSource(working, altcoins, stablecoins, action.percent);
    changedAssets = result.changedAssets;

    if (result.movedPercent < action.percent) {
      warnings.push(
        `reduce_altcoin_exposure moved ${round(result.movedPercent, 2)}% instead of ${action.percent}% due to source limits.`
      );
    }
  }

  return {
    allocation: normalizeAllocation(working, allSymbols),
    warnings,
    changedAssets,
  };
}

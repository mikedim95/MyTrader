import { createAssetGroupResolver } from "./asset-groups.js";
import {
  ensureNonNegative,
  mergeAssetUniverse,
  normalizeAllocation,
  round,
  sortSymbols,
  withAllAssets,
} from "./allocation-utils.js";
import { AllocationMap, GuardEnforcementResult, StrategyGuardConfig } from "./types.js";

function sumForSymbols(allocation: AllocationMap, symbols: string[]): number {
  return symbols.reduce((sum, symbol) => sum + (allocation[symbol] ?? 0), 0);
}

function redistributeEven(allocation: AllocationMap, symbols: string[], amount: number): void {
  if (symbols.length === 0 || amount <= 0) return;
  const each = amount / symbols.length;
  symbols.forEach((symbol) => {
    allocation[symbol] = (allocation[symbol] ?? 0) + each;
  });
}

function shiftFromSourcesToTargets(allocation: AllocationMap, sources: string[], targets: string[], amount: number): number {
  if (sources.length === 0 || targets.length === 0 || amount <= 0) return 0;

  const sourceTotal = sumForSymbols(allocation, sources);
  const moved = Math.min(amount, sourceTotal);
  if (moved <= 0) return 0;

  sources.forEach((symbol) => {
    const current = allocation[symbol] ?? 0;
    if (current <= 0) return;
    const reduction = (current / sourceTotal) * moved;
    allocation[symbol] = Math.max(0, current - reduction);
  });

  const targetTotal = sumForSymbols(allocation, targets);
  if (targetTotal > 0) {
    targets.forEach((symbol) => {
      const current = allocation[symbol] ?? 0;
      const increase = (current / targetTotal) * moved;
      allocation[symbol] = current + increase;
    });
  } else {
    redistributeEven(allocation, targets, moved);
  }

  return moved;
}

function enforceMaxSingleAsset(allocation: AllocationMap, maxPct: number): string[] {
  const warnings: string[] = [];
  const symbols = sortSymbols(Object.keys(allocation));

  let excess = 0;
  symbols.forEach((symbol) => {
    const current = allocation[symbol] ?? 0;
    if (current <= maxPct) return;

    excess += current - maxPct;
    allocation[symbol] = maxPct;
    warnings.push(`Guard max_single_asset_pct capped ${symbol} from ${round(current, 2)}% to ${maxPct}%.`);
  });

  if (excess <= 0) return warnings;

  const eligible = symbols.filter((symbol) => (allocation[symbol] ?? 0) < maxPct);
  if (eligible.length === 0) {
    const fallback = symbols[0] ?? "USDC";
    allocation[fallback] = (allocation[fallback] ?? 0) + excess;
    return warnings;
  }

  const headroom = eligible.reduce((sum, symbol) => sum + Math.max(0, maxPct - (allocation[symbol] ?? 0)), 0);
  if (headroom <= 0) {
    redistributeEven(allocation, eligible, excess);
    return warnings;
  }

  eligible.forEach((symbol) => {
    const room = Math.max(0, maxPct - (allocation[symbol] ?? 0));
    const added = (room / headroom) * excess;
    allocation[symbol] = (allocation[symbol] ?? 0) + added;
  });

  return warnings;
}

function enforceStablecoinFloor(
  allocation: AllocationMap,
  floorPct: number,
  stablecoinSymbols: string[]
): { warnings: string[]; moved: number } {
  const warnings: string[] = [];

  if (floorPct <= 0) {
    return { warnings, moved: 0 };
  }

  if (stablecoinSymbols.length === 0) {
    allocation.USDC = allocation.USDC ?? 0;
    stablecoinSymbols.push("USDC");
  }

  const stableTotal = sumForSymbols(allocation, stablecoinSymbols);
  if (stableTotal >= floorPct) {
    return { warnings, moved: 0 };
  }

  const needed = floorPct - stableTotal;
  const nonStable = Object.keys(allocation).filter((symbol) => !stablecoinSymbols.includes(symbol));
  const moved = shiftFromSourcesToTargets(allocation, nonStable, stablecoinSymbols, needed);

  if (moved < needed) {
    warnings.push(
      `Guard stablecoin floor requested ${round(needed, 2)}% but only ${round(moved, 2)}% could be shifted.`
    );
  } else {
    warnings.push(`Guard stablecoin floor restored stablecoin exposure to at least ${floorPct}%.`);
  }

  return { warnings, moved };
}

export function enforceGuards(input: {
  allocation: AllocationMap;
  baseAllocation: AllocationMap;
  guards: StrategyGuardConfig;
  disabledAssets?: string[];
}): GuardEnforcementResult {
  const warnings: string[] = [];
  const universe = mergeAssetUniverse(input.allocation, input.baseAllocation);
  const working = withAllAssets(ensureNonNegative({ ...input.allocation }), universe);

  const disabled = new Set((input.disabledAssets ?? []).map((symbol) => symbol.trim().toUpperCase()));
  if (disabled.size > 0) {
    let redistributed = 0;

    Array.from(disabled).forEach((symbol) => {
      if (!(symbol in working)) return;
      redistributed += working[symbol] ?? 0;
      working[symbol] = 0;
    });

    const recipients = Object.keys(working).filter((symbol) => !disabled.has(symbol));
    redistributeEven(working, recipients, redistributed);
    warnings.push(`Disabled assets were removed from allocation: ${Array.from(disabled).join(", ")}.`);
  }

  if (typeof input.guards.max_single_asset_pct === "number") {
    warnings.push(...enforceMaxSingleAsset(working, input.guards.max_single_asset_pct));
  }

  const resolver = createAssetGroupResolver(Object.keys(working));
  const stablecoins = resolver.getAssetsForToken("STABLECOINS");
  const stablecoinFloor = Math.max(
    input.guards.min_stablecoin_pct ?? 0,
    input.guards.cash_reserve_pct ?? 0
  );

  const floorResult = enforceStablecoinFloor(working, stablecoinFloor, stablecoins);
  warnings.push(...floorResult.warnings);

  return {
    allocation: normalizeAllocation(working, Object.keys(working)),
    warnings,
  };
}

import { AllocationMap } from "./types.js";

export const ALLOCATION_BASIS_POINTS = 10_000;

export const DEFAULT_STABLECOINS = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "DAI"]);
export const DEFAULT_LARGE_CAPS = new Set(["BTC", "ETH", "BNB", "XRP", "SOL", "ADA"]);

export function round(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

export function toUpperSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function sortSymbols(symbols: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(symbols).map(toUpperSymbol))).sort((left, right) => left.localeCompare(right));
}

export function parseScheduleIntervalToMs(interval: string): number {
  const trimmed = interval.trim().toLowerCase();
  const match = trimmed.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 15 * 60 * 1000;

  const amount = Number(match[1]);
  const unit = match[2];

  if (!Number.isFinite(amount) || amount <= 0) return 15 * 60 * 1000;

  if (unit === "s") return amount * 1000;
  if (unit === "m") return amount * 60 * 1000;
  if (unit === "h") return amount * 60 * 60 * 1000;
  return amount * 24 * 60 * 60 * 1000;
}

export function normalizeAllocation(input: AllocationMap, keepSymbols: string[] = []): AllocationMap {
  const allSymbols = sortSymbols([...Object.keys(input), ...keepSymbols]);
  const sanitized = allSymbols.map((symbol) => {
    const raw = input[symbol] ?? 0;
    const safe = Number.isFinite(raw) && raw > 0 ? raw : 0;
    return { symbol, value: safe };
  });

  const total = sanitized.reduce((sum, entry) => sum + entry.value, 0);
  if (total <= 0) {
    const fallback = allSymbols[0] ?? "USDC";
    return allSymbols.reduce<AllocationMap>((acc, symbol) => {
      acc[symbol] = symbol === fallback ? 100 : 0;
      return acc;
    }, {});
  }

  const rawBasis = sanitized.map((entry) => {
    const exact = (entry.value / total) * ALLOCATION_BASIS_POINTS;
    const floor = Math.floor(exact);
    return {
      symbol: entry.symbol,
      floor,
      remainder: exact - floor,
    };
  });

  let used = rawBasis.reduce((sum, entry) => sum + entry.floor, 0);
  const remaining = ALLOCATION_BASIS_POINTS - used;

  rawBasis
    .sort((left, right) => {
      if (right.remainder !== left.remainder) return right.remainder - left.remainder;
      return left.symbol.localeCompare(right.symbol);
    })
    .slice(0, Math.max(0, remaining))
    .forEach((entry) => {
      entry.floor += 1;
      used += 1;
    });

  if (used < ALLOCATION_BASIS_POINTS && rawBasis.length > 0) {
    rawBasis[0].floor += ALLOCATION_BASIS_POINTS - used;
  }

  const output: AllocationMap = {};
  rawBasis
    .sort((left, right) => left.symbol.localeCompare(right.symbol))
    .forEach((entry) => {
      output[entry.symbol] = round(entry.floor / 100, 2);
    });

  return output;
}

export function sumAllocation(allocation: AllocationMap): number {
  return round(Object.values(allocation).reduce((sum, value) => sum + value, 0), 2);
}

export function ensureNonNegative(allocation: AllocationMap): AllocationMap {
  const output: AllocationMap = {};
  Object.entries(allocation).forEach(([symbol, value]) => {
    output[toUpperSymbol(symbol)] = Number.isFinite(value) ? Math.max(0, value) : 0;
  });
  return output;
}

export function getStablecoinAllocation(allocation: AllocationMap, stablecoins: Set<string> = DEFAULT_STABLECOINS): number {
  return round(
    Object.entries(allocation)
      .filter(([symbol]) => stablecoins.has(toUpperSymbol(symbol)))
      .reduce((sum, [, value]) => sum + value, 0),
    2
  );
}

export function getAssetSymbols(allocation: AllocationMap): string[] {
  return sortSymbols(Object.keys(allocation));
}

export function mergeAssetUniverse(...groups: AllocationMap[]): string[] {
  const symbols = new Set<string>();
  groups.forEach((map) => {
    Object.keys(map).forEach((symbol) => symbols.add(toUpperSymbol(symbol)));
  });

  return sortSymbols(symbols);
}

export function withAllAssets(allocation: AllocationMap, symbols: string[]): AllocationMap {
  const output: AllocationMap = {};
  sortSymbols([...Object.keys(allocation), ...symbols]).forEach((symbol) => {
    output[symbol] = allocation[symbol] ?? 0;
  });
  return output;
}

export function createNextRunAt(lastRunAtIso: string, interval: string): string {
  const base = new Date(lastRunAtIso).getTime();
  const next = base + parseScheduleIntervalToMs(interval);
  return new Date(next).toISOString();
}

export function calculateDriftPct(current: AllocationMap, target: AllocationMap): number {
  const symbols = sortSymbols([...Object.keys(current), ...Object.keys(target)]);
  const drift = symbols.reduce((sum, symbol) => {
    const diff = Math.abs((target[symbol] ?? 0) - (current[symbol] ?? 0));
    return sum + diff;
  }, 0);

  return round(drift / 2, 2);
}

import { fetchHistoricalCandles, getMarketCapForSymbol, getTickerSnapshot } from "../publicMarketData.js";
import { detectMarketRegime } from "./strategy-regime.js";
import type {
  HistoricalMarketPoint,
  MarketSignalSnapshot,
  StrategyConfig,
  StrategyMarketContextCondition,
  StrategyMarketContextConfig,
  StrategyMarketContextIndicator,
  StrategyMarketContextSnapshot,
  StrategyMarketGateConditionResult,
  StrategyMarketGateFilterResult,
  StrategyMarketGateResult,
} from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const BTC_LONG_MA_DAYS = 200;
const BTC_CONTEXT_HISTORY_DAYS = 400;
const BTC_DOMINANCE_LOOKBACK_DAYS = 31;
const LIVE_CONTEXT_CACHE_TTL_MS = 60_000;
const DAILY_CLOSE_CACHE_TTL_MS = 5 * 60_000;
export const BTC_CONTEXT_SYMBOLS = ["BTC", "ETH", "XRP", "SOL", "ADA"] as const;
const BTC_HALVING_DATES = [
  "2012-11-28T00:00:00.000Z",
  "2016-07-09T00:00:00.000Z",
  "2020-05-11T00:00:00.000Z",
  "2024-04-20T00:00:00.000Z",
];

let cachedLiveContext:
  | {
      expiresAt: number;
      key: string;
      context: StrategyMarketContextSnapshot;
    }
  | null = null;

const dailyCloseCache = new Map<string, { expiresAt: number; closes: number[] }>();

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function latestHalvingTimestamp(targetTimestamp: number): number {
  const halvingTimestamps = BTC_HALVING_DATES.map((value) => new Date(value).getTime()).sort((left, right) => left - right);
  let latest = halvingTimestamps[0] ?? targetTimestamp;

  for (const halvingTimestamp of halvingTimestamps) {
    if (halvingTimestamp <= targetTimestamp) {
      latest = halvingTimestamp;
    }
  }

  return latest;
}

function resolveHalvingPhase(daysSinceHalving: number): StrategyMarketContextSnapshot["halvingPhase"] {
  if (daysSinceHalving < 0) return "pre_halving";
  if (daysSinceHalving <= 180) return "early_cycle";
  if (daysSinceHalving <= 540) return "mid_cycle";
  if (daysSinceHalving <= 900) return "late_cycle";
  return "post_cycle";
}

function computeOverheatingScore(daysSinceHalving: number, priceVsLongMaPct: number, drawdownFromAthPct: number): number {
  const cycleMaturityScore = clamp((daysSinceHalving - 180) / 540, 0, 1);
  const longMaPremiumScore = clamp((priceVsLongMaPct - 10) / 35, 0, 1);
  const athProximityScore = 1 - clamp((drawdownFromAthPct - 5) / 35, 0, 1);
  return round((cycleMaturityScore + longMaPremiumScore + athProximityScore) / 3, 4);
}

function computeProxyDominance(closeBySymbol: Record<string, number[]>, stepIndex: number): number {
  let btcProxy = 0;
  let totalProxy = 0;

  for (const symbol of BTC_CONTEXT_SYMBOLS) {
    const closes = closeBySymbol[symbol];
    if (!closes || closes.length === 0) continue;

    const normalizedIndex = Math.max(0, Math.min(stepIndex, closes.length - 1));
    const currentClose = closes[normalizedIndex] ?? closes[closes.length - 1] ?? 0;
    const latestClose = closes[closes.length - 1] ?? currentClose;
    const baseMarketCap = getMarketCapForSymbol(symbol);
    if (!Number.isFinite(currentClose) || currentClose <= 0 || !Number.isFinite(latestClose) || latestClose <= 0 || baseMarketCap <= 0) {
      continue;
    }

    const proxyMarketCap = baseMarketCap * (currentClose / latestClose);
    totalProxy += proxyMarketCap;
    if (symbol === "BTC") {
      btcProxy += proxyMarketCap;
    }
  }

  if (totalProxy <= 0) return 0;
  return btcProxy / totalProxy;
}

function computeDominanceTrend(closeBySymbol: Record<string, number[]>): { currentDominance?: number; trendPct?: number } {
  const btcSeries = closeBySymbol.BTC;
  if (!btcSeries || btcSeries.length === 0) {
    return {};
  }

  const currentIndex = btcSeries.length - 1;
  const previousIndex = Math.max(0, currentIndex - (BTC_DOMINANCE_LOOKBACK_DAYS - 1));
  const currentDominance = computeProxyDominance(closeBySymbol, currentIndex);
  const previousDominance = computeProxyDominance(closeBySymbol, previousIndex);

  return {
    currentDominance: round(currentDominance, 6),
    trendPct: round((currentDominance - previousDominance) * 100, 4),
  };
}

function buildContextFromCloses(input: {
  timestamp: string;
  marketRegime: StrategyMarketContextSnapshot["marketRegime"];
  btcCloses: number[];
  closeBySymbol: Record<string, number[]>;
}): StrategyMarketContextSnapshot {
  const btcCloses = input.btcCloses.filter((value) => Number.isFinite(value) && value > 0);
  const currentPrice = btcCloses[btcCloses.length - 1] ?? 0;
  const longMaWindow = btcCloses.slice(-Math.min(BTC_LONG_MA_DAYS, btcCloses.length));
  const longMa = average(longMaWindow);
  const ath = btcCloses.length > 0 ? Math.max(...btcCloses) : currentPrice;
  const priceVsLongMaPct = longMa > 0 ? ((currentPrice - longMa) / longMa) * 100 : 0;
  const drawdownFromAthPct = ath > 0 ? ((ath - currentPrice) / ath) * 100 : 0;
  const timestampMs = new Date(input.timestamp).getTime();
  const halvingTimestamp = latestHalvingTimestamp(timestampMs);
  const daysSinceHalving = Math.floor((timestampMs - halvingTimestamp) / DAY_MS);
  const halvingPhase = resolveHalvingPhase(daysSinceHalving);
  const overheatingScore = computeOverheatingScore(daysSinceHalving, priceVsLongMaPct, drawdownFromAthPct);
  const overheatingWarning =
    overheatingScore >= 0.72 ||
    (daysSinceHalving > 180 && priceVsLongMaPct >= 25 && drawdownFromAthPct <= 10);
  const dominance = computeDominanceTrend(input.closeBySymbol);

  return {
    timestamp: input.timestamp,
    marketRegime: input.marketRegime,
    btcPrice: round(currentPrice, 2),
    btcLongMaDays: BTC_LONG_MA_DAYS,
    btcLongMa: round(longMa, 2),
    btcPriceVsLongMaPct: round(priceVsLongMaPct, 2),
    btcAth: round(ath, 2),
    btcDrawdownFromAthPct: round(Math.max(0, drawdownFromAthPct), 2),
    daysSinceHalving,
    halvingPhase,
    overheatingWarning,
    overheatingScore,
    btcDominance: dominance.currentDominance,
    btcDominanceTrendPct: dominance.trendPct,
  };
}

async function fetchDailyCloses(symbol: string, limit: number, fallbackClose: number): Promise<number[]> {
  const normalizedSymbol = normalizeSymbol(symbol);
  const cacheKey = `${normalizedSymbol}:${limit}`;
  const cached = dailyCloseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.closes;
  }

  if (normalizedSymbol === "USDC" || normalizedSymbol === "USDT") {
    return Array.from({ length: limit }, () => round(fallbackClose || 1, 6));
  }

  try {
    const now = Date.now();
    const startTime = now - (limit - 1) * DAY_MS;
    const candles = await fetchHistoricalCandles(normalizedSymbol, "1d", startTime, now);
    if (candles.length === 0) {
      return Array.from({ length: limit }, () => round(fallbackClose, 6));
    }
    const closes = candles.slice(-limit).map((candle) => round(candle.close, 6));
    dailyCloseCache.set(cacheKey, {
      expiresAt: Date.now() + DAILY_CLOSE_CACHE_TTL_MS,
      closes,
    });
    return closes;
  } catch {
    return Array.from({ length: limit }, () => round(fallbackClose, 6));
  }
}

function hasMarketContextConfiguration(config: StrategyMarketContextConfig | undefined): boolean {
  if (!config) return false;
  if ((config.allowedMarketRegimes?.length ?? 0) > 0) return true;
  if ((config.allowedHalvingPhases?.length ?? 0) > 0) return true;
  if (config.priceVsLongMaFilter && config.priceVsLongMaFilter !== "any") return true;
  if (config.blockIfOverheated) return true;
  if ((config.indicatorConditions?.length ?? 0) > 0) return true;
  return false;
}

function compare(left: number, operator: StrategyMarketContextCondition["operator"], right: number): boolean {
  if (operator === ">") return left > right;
  if (operator === "<") return left < right;
  if (operator === ">=") return left >= right;
  if (operator === "<=") return left <= right;
  if (operator === "==") return left === right;
  return left !== right;
}

function resolveIndicatorValue(
  indicator: StrategyMarketContextIndicator,
  context: StrategyMarketContextSnapshot
): number {
  if (indicator === "days_since_halving") return context.daysSinceHalving;
  if (indicator === "btc_price_vs_long_ma_pct") return context.btcPriceVsLongMaPct;
  if (indicator === "btc_drawdown_from_ath_pct") return context.btcDrawdownFromAthPct;
  if (indicator === "btc_dominance_trend_pct") return context.btcDominanceTrendPct ?? 0;
  return context.overheatingScore;
}

function formatIndicatorLabel(indicator: StrategyMarketContextIndicator): string {
  if (indicator === "days_since_halving") return "Days Since Halving";
  if (indicator === "btc_price_vs_long_ma_pct") return "BTC Price vs Long MA %";
  if (indicator === "btc_drawdown_from_ath_pct") return "BTC Drawdown From ATH %";
  if (indicator === "btc_dominance_trend_pct") return "BTC Dominance Trend %";
  return "BTC Overheating Score";
}

function formatIndicatorValue(indicator: StrategyMarketContextIndicator, value: number): string {
  if (indicator === "days_since_halving") return `${Math.round(value)}d`;
  if (indicator === "btc_overheating_score") return round(value, 4).toFixed(4);
  return `${round(value, 2).toFixed(2)}%`;
}

function buildFilterResult(label: string, passed: boolean, actualValue: string, expectedValue: string): StrategyMarketGateFilterResult {
  return { label, passed, actualValue, expectedValue };
}

export async function buildLiveStrategyMarketContext(
  timestamp: string,
  marketRegime: StrategyMarketContextSnapshot["marketRegime"]
): Promise<StrategyMarketContextSnapshot> {
  const cacheKey = `${timestamp.slice(0, 16)}:${marketRegime}`;
  if (cachedLiveContext && cachedLiveContext.expiresAt > Date.now() && cachedLiveContext.key === cacheKey) {
    return cachedLiveContext.context;
  }

  const tickerSnapshots = await Promise.all(
    BTC_CONTEXT_SYMBOLS.map(async (symbol) => {
      const ticker = await getTickerSnapshot(symbol).catch(() => ({ price: 0, change24h: 0, volume24h: 0 }));
      return [symbol, ticker.price] as const;
    })
  );
  const fallbackPriceBySymbol = Object.fromEntries(tickerSnapshots) as Record<string, number>;

  const [btcCloses, dominanceCloses] = await Promise.all([
    fetchDailyCloses("BTC", BTC_CONTEXT_HISTORY_DAYS, fallbackPriceBySymbol.BTC ?? 0),
    Promise.all(
      BTC_CONTEXT_SYMBOLS.map(async (symbol) => [
        symbol,
        await fetchDailyCloses(symbol, BTC_DOMINANCE_LOOKBACK_DAYS, fallbackPriceBySymbol[symbol] ?? 0),
      ])
    ),
  ]);

  const closeBySymbol = Object.fromEntries(dominanceCloses) as Record<string, number[]>;
  closeBySymbol.BTC = btcCloses.slice(-BTC_DOMINANCE_LOOKBACK_DAYS);

  const context = buildContextFromCloses({
    timestamp,
    marketRegime,
    btcCloses,
    closeBySymbol,
  });

  cachedLiveContext = {
    key: cacheKey,
    expiresAt: Date.now() + LIVE_CONTEXT_CACHE_TTL_MS,
    context,
  };

  return context;
}

export function buildHistoricalStrategyMarketContext(input: {
  points: HistoricalMarketPoint[];
  pointIndex: number;
  marketRegime: StrategyMarketContextSnapshot["marketRegime"];
}): StrategyMarketContextSnapshot {
  const relevantPoints = input.points.slice(0, input.pointIndex + 1);
  const closeBySymbol = BTC_CONTEXT_SYMBOLS.reduce<Record<string, number[]>>((acc, symbol) => {
    acc[symbol] = relevantPoints
      .map((point) => point.prices[symbol])
      .filter((value): value is number => Number.isFinite(value) && value > 0);
    return acc;
  }, {});

  return buildContextFromCloses({
    timestamp: relevantPoints[relevantPoints.length - 1]?.timestamp ?? new Date().toISOString(),
    marketRegime: input.marketRegime,
    btcCloses: closeBySymbol.BTC ?? [],
    closeBySymbol,
  });
}

export function evaluateStrategyMarketGate(
  strategy: Pick<StrategyConfig, "marketContextConfig">,
  context: StrategyMarketContextSnapshot | undefined
): StrategyMarketGateResult | undefined {
  const config = strategy.marketContextConfig;
  if (!hasMarketContextConfiguration(config)) {
    return undefined;
  }

  if (!context) {
    return {
      configured: true,
      passed: false,
      blockingReasons: ["Market context is unavailable."],
      filterResults: [],
      conditionResults: [],
    };
  }

  const filterResults: StrategyMarketGateFilterResult[] = [];
  const conditionResults: StrategyMarketGateConditionResult[] = [];
  const blockingReasons: string[] = [];

  if ((config?.allowedMarketRegimes?.length ?? 0) > 0) {
    const allowed = config?.allowedMarketRegimes ?? [];
    const passed = allowed.includes(context.marketRegime);
    filterResults.push(
      buildFilterResult("Market Regime", passed, context.marketRegime, allowed.join(", "))
    );
    if (!passed) {
      blockingReasons.push(`Market regime ${context.marketRegime} is outside the allowed set.`);
    }
  }

  if ((config?.allowedHalvingPhases?.length ?? 0) > 0) {
    const allowed = config?.allowedHalvingPhases ?? [];
    const passed = allowed.includes(context.halvingPhase);
    filterResults.push(
      buildFilterResult("Halving Phase", passed, context.halvingPhase, allowed.join(", "))
    );
    if (!passed) {
      blockingReasons.push(`Halving phase ${context.halvingPhase} is outside the allowed set.`);
    }
  }

  if (config?.priceVsLongMaFilter && config.priceVsLongMaFilter !== "any") {
    const isAbove = context.btcPriceVsLongMaPct >= 0;
    const expectsAbove = config.priceVsLongMaFilter === "above_long_ma";
    const passed = expectsAbove ? isAbove : !isAbove;
    filterResults.push(
      buildFilterResult(
        "BTC Price vs Long MA",
        passed,
        `${context.btcPriceVsLongMaPct.toFixed(2)}%`,
        expectsAbove ? "Above long MA" : "Below long MA"
      )
    );
    if (!passed) {
      blockingReasons.push(
        expectsAbove ? "BTC price is below the long moving average." : "BTC price is above the long moving average."
      );
    }
  }

  if (config?.blockIfOverheated) {
    const passed = !context.overheatingWarning;
    filterResults.push(
      buildFilterResult(
        "Overheating Warning",
        passed,
        context.overheatingWarning ? "Active" : "Inactive",
        "Inactive"
      )
    );
    if (!passed) {
      blockingReasons.push("BTC cycle overheating warning is active.");
    }
  }

  for (const condition of config?.indicatorConditions ?? []) {
    const actualValue = resolveIndicatorValue(condition.indicator, context);
    const passed = compare(actualValue, condition.operator, condition.value);
    conditionResults.push({
      indicator: condition.indicator,
      operator: condition.operator,
      expectedValue: condition.value,
      actualValue: round(actualValue, 6),
      passed,
    });
    if (!passed) {
      blockingReasons.push(
        `${formatIndicatorLabel(condition.indicator)} ${condition.operator} ${formatIndicatorValue(
          condition.indicator,
          condition.value
        )} failed (actual ${formatIndicatorValue(condition.indicator, actualValue)}).`
      );
    }
  }

  return {
    configured: true,
    passed: blockingReasons.length === 0,
    blockingReasons,
    filterResults,
    conditionResults,
  };
}

export function detectStrategyMarketRegime(
  strategySignals: MarketSignalSnapshot
): StrategyMarketContextSnapshot["marketRegime"] {
  return detectMarketRegime(strategySignals);
}

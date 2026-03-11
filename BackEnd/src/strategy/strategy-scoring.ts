import { round } from "./allocation-utils.js";
import { MarketRegime, MarketSignalSnapshot, StrategyConfig, StrategyScoreResult } from "./types.js";

type StrategyStyle = "aggressive" | "neutral" | "defensive";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeRange(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function strategyStyle(strategy: StrategyConfig): StrategyStyle {
  const id = strategy.id.toLowerCase();
  const tags = (strategy.metadata?.tags ?? []).map((tag) => tag.toLowerCase());
  const tagSet = new Set(tags);

  if (
    id.includes("volatility") ||
    id.includes("drawdown") ||
    id.includes("hedge") ||
    tagSet.has("defensive")
  ) {
    return "defensive";
  }

  if (
    id.includes("momentum") ||
    id.includes("relative-strength") ||
    id.includes("rotation") ||
    tagSet.has("momentum")
  ) {
    return "aggressive";
  }

  return "neutral";
}

function regimeFit(style: StrategyStyle, regime: MarketRegime): number {
  if (regime === "risk_on") {
    if (style === "aggressive") return 1;
    if (style === "neutral") return 0.68;
    return 0.35;
  }

  if (regime === "risk_off") {
    if (style === "defensive") return 1;
    if (style === "neutral") return 0.67;
    return 0.3;
  }

  if (regime === "high_volatility") {
    if (style === "defensive") return 0.95;
    if (style === "neutral") return 0.62;
    return 0.22;
  }

  if (style === "aggressive") return 0.72;
  if (style === "defensive") return 0.74;
  return 0.85;
}

function turnoverStabilityScore(strategy: StrategyConfig): number {
  const expectedTurnover = strategy.metadata?.expectedTurnover ?? "medium";
  const turnoverBase = expectedTurnover === "low" ? 0.95 : expectedTurnover === "high" ? 0.45 : 0.72;
  const enabledRules = strategy.rules.filter((rule) => rule.enabled);
  const complexityPenalty = clamp(enabledRules.length / 24, 0, 0.35);
  const stablecoinExposure = strategy.metadata?.stablecoinExposure ?? "medium";
  const stableBonus = stablecoinExposure === "high" ? 0.12 : stablecoinExposure === "medium" ? 0.06 : 0;
  return clamp(turnoverBase - complexityPenalty + stableBonus, 0, 1);
}

function turnoverPenaltyScore(strategy: StrategyConfig): number {
  const enabledRules = strategy.rules.filter((rule) => rule.enabled);
  const averageMove = average(enabledRules.map((rule) => rule.action.percent));
  const normalizedRules = normalizeRange(enabledRules.length, 0, 12);
  const normalizedMove = normalizeRange(averageMove, 0, 20);
  const penalty = clamp(normalizedRules * 0.55 + normalizedMove * 0.45, 0, 1);
  return round(1 - penalty, 6);
}

function recentReturnScore(strategy: StrategyConfig, signals: MarketSignalSnapshot): number {
  const contributions = Object.entries(strategy.baseAllocation).map(([symbol, pct]) => {
    const weight = Number.isFinite(pct) ? pct / 100 : 0;
    const change = signals.assetIndicators[symbol]?.price_change_24h ?? 0;
    return weight * change;
  });

  const weightedReturn = contributions.reduce((sum, value) => sum + value, 0);
  return round(normalizeRange(weightedReturn, -0.15, 0.15), 6);
}

function drawdownPenaltyScore(signals: MarketSignalSnapshot): number {
  const drawdown = clamp(signals.indicators.drawdown_pct ?? 0, 0, 1);
  return round(1 - normalizeRange(drawdown, 0, 0.25), 6);
}

export function scoreStrategyForCycle(
  strategy: StrategyConfig,
  signals: MarketSignalSnapshot,
  regime: MarketRegime
): StrategyScoreResult {
  const components = {
    recent_return: recentReturnScore(strategy, signals),
    drawdown_penalty: drawdownPenaltyScore(signals),
    turnover_penalty: turnoverPenaltyScore(strategy),
    regime_fit: round(regimeFit(strategyStyle(strategy), regime), 6),
    stability: round(turnoverStabilityScore(strategy), 6),
  };

  const scoreRaw =
    components.recent_return * 0.34 +
    components.drawdown_penalty * 0.2 +
    components.turnover_penalty * 0.16 +
    components.regime_fit * 0.2 +
    components.stability * 0.1;

  return {
    strategyId: strategy.id,
    score: round(clamp(scoreRaw, 0, 1), 4),
    components,
  };
}

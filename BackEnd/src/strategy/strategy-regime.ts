import { MarketRegime, MarketSignalSnapshot } from "./types.js";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asFinite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

export function detectMarketRegime(signals: MarketSignalSnapshot): MarketRegime {
  const volatility = asFinite(signals.indicators.volatility, 0);
  const marketDirection = asFinite(signals.indicators.market_direction, 0);
  const drawdownPct = asFinite(signals.indicators.drawdown_pct, 0);

  if (volatility >= 0.06) return "high_volatility";
  if (drawdownPct >= 0.12 || marketDirection < 0) return "risk_off";
  if (marketDirection > 0 && volatility <= 0.035) return "risk_on";
  return "neutral";
}

export function regimeRiskMultiplier(regime: MarketRegime): number {
  if (regime === "risk_on") return 1;
  if (regime === "neutral") return 0.8;
  if (regime === "risk_off") return 0.55;
  return 0.45;
}

export function normalizeRegimeWeight(value: number): number {
  return clamp(value, 0, 1);
}

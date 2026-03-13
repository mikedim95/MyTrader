const BASIC_STRATEGY_IDS = [
  "mean-reversion",
  "periodic-rebalancing",
  "relative-strength-rotation",
  "drawdown-protection",
  "volatility-hedge",
  "btc-dominance-rotation",
  "momentum-rotation",
] as const;

const BASIC_STRATEGY_ID_SET = new Set<string>(BASIC_STRATEGY_IDS);

export function getBasicStrategyIds(): string[] {
  return [...BASIC_STRATEGY_IDS];
}

export function isBasicStrategyId(strategyId: string): boolean {
  return BASIC_STRATEGY_ID_SET.has(strategyId.trim().toLowerCase());
}

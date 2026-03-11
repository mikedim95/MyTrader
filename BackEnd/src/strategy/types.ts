export const STRATEGY_GROUPS = ["BTC", "ETH", "STABLECOINS", "ALTCOINS", "LARGE_CAPS"] as const;
export type StrategyGroup = (typeof STRATEGY_GROUPS)[number];

export const STRATEGY_INDICATORS = [
  "volatility",
  "btc_dominance",
  "portfolio_drift",
  "asset_weight",
  "asset_trend",
  "price_change_24h",
  "volume_change",
  "market_direction",
] as const;
export type StrategyIndicator = (typeof STRATEGY_INDICATORS)[number];

export const STRATEGY_OPERATORS = [">", "<", ">=", "<=", "==", "!="] as const;
export type StrategyOperator = (typeof STRATEGY_OPERATORS)[number];

export const STRATEGY_ACTION_TYPES = [
  "increase",
  "decrease",
  "shift",
  "increase_stablecoin_exposure",
  "reduce_altcoin_exposure",
] as const;
export type StrategyActionType = (typeof STRATEGY_ACTION_TYPES)[number];

export const STRATEGY_MODES = ["manual", "semi_auto", "auto"] as const;
export type StrategyMode = (typeof STRATEGY_MODES)[number];

export const STRATEGY_RUN_STATUSES = ["pending", "running", "completed", "failed", "skipped"] as const;
export type StrategyRunStatus = (typeof STRATEGY_RUN_STATUSES)[number];

export const BACKTEST_RUN_STATUSES = ["pending", "running", "completed", "failed"] as const;
export type BacktestRunStatus = (typeof BACKTEST_RUN_STATUSES)[number];

export type AllocationMap = Record<string, number>;

export interface StrategyCondition {
  indicator: StrategyIndicator;
  operator: StrategyOperator;
  value: number;
  asset?: string;
}

export interface StrategyAction {
  type: StrategyActionType;
  asset?: string;
  from?: string;
  to?: string;
  percent: number;
}

export interface StrategyRule {
  id: string;
  name?: string;
  priority: number;
  enabled: boolean;
  condition: StrategyCondition;
  action: StrategyAction;
}

export interface StrategyGuardConfig {
  max_single_asset_pct?: number;
  min_stablecoin_pct?: number;
  max_trades_per_cycle?: number;
  min_trade_notional?: number;
  cash_reserve_pct?: number;
}

export interface StrategyMetadata {
  riskLevel?: "low" | "medium" | "high";
  expectedTurnover?: "low" | "medium" | "high";
  stablecoinExposure?: "low" | "medium" | "high";
  tags?: string[];
}

export interface StrategyConfig {
  id: string;
  name: string;
  description?: string;
  baseAllocation: AllocationMap;
  rules: StrategyRule[];
  guards: StrategyGuardConfig;
  executionMode: StrategyMode;
  metadata?: StrategyMetadata;
  isEnabled: boolean;
  scheduleInterval: string;
  lastRunAt?: string;
  nextRunAt?: string;
  disabledAssets?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioAssetState {
  symbol: string;
  quantity: number;
  price: number;
  value: number;
  allocation: number;
  change24h?: number;
  volume24h?: number;
}

export interface PortfolioState {
  timestamp: string;
  baseCurrency: string;
  totalValue: number;
  assets: PortfolioAssetState[];
  allocation: AllocationMap;
}

export interface MarketSignalSnapshot {
  timestamp: string;
  indicators: Record<string, number>;
  assetIndicators: Record<string, Record<string, number>>;
}

export interface RuleEvaluationTrace {
  ruleId: string;
  ruleName?: string;
  matched: boolean;
  conditionValue: number;
  operator: StrategyOperator;
  expectedValue: number;
  actionApplied: boolean;
  message: string;
}

export interface RuleEvaluationResult {
  allocation: AllocationMap;
  traces: RuleEvaluationTrace[];
  warnings: string[];
  actionReasonsByAsset: Record<string, string>;
}

export interface GuardEnforcementResult {
  allocation: AllocationMap;
  warnings: string[];
}

export interface RebalanceTradeSuggestion {
  asset: string;
  side: "BUY" | "SELL";
  currentPct: number;
  targetPct: number;
  driftPct: number;
  currentValue: number;
  targetValue: number;
  notional: number;
}

export interface RebalancePlan {
  rebalanceRequired: boolean;
  driftPct: number;
  estimatedTurnoverPct: number;
  suggestions: RebalanceTradeSuggestion[];
  warnings: string[];
}

export interface ExecutionAction {
  asset: string;
  side: "BUY" | "SELL";
  amountNotional: number;
  targetPercent: number;
  currentPercent: number;
  reason: string;
}

export interface ExecutionPlan {
  id: string;
  strategyId: string;
  timestamp: string;
  mode: StrategyMode;
  currentAllocation: AllocationMap;
  adjustedTargetAllocation: AllocationMap;
  rebalanceRequired: boolean;
  driftPct: number;
  estimatedTurnoverPct: number;
  recommendedTrades: ExecutionAction[];
  warnings: string[];
}

export interface StrategyEvaluationResult {
  strategyId: string;
  evaluatedAt: string;
  currentAllocation: AllocationMap;
  baseAllocation: AllocationMap;
  adjustedTargetAllocation: AllocationMap;
  traces: RuleEvaluationTrace[];
  warnings: string[];
  rebalancePlan: RebalancePlan;
  executionPlan: ExecutionPlan;
}

export interface StrategyRun {
  id: string;
  strategyId: string;
  startedAt: string;
  completedAt?: string;
  status: StrategyRunStatus;
  mode: StrategyMode;
  trigger: "manual" | "schedule" | "api";
  inputSnapshot?: {
    portfolio: PortfolioState;
    marketSignals: MarketSignalSnapshot;
  };
  adjustedAllocation?: AllocationMap;
  executionPlanId?: string;
  warnings: string[];
  error?: string;
}

export interface BacktestRequest {
  strategyId: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  baseCurrency: string;
  timeframe: "1h" | "1d";
  rebalanceCostsPct: number;
  slippagePct: number;
}

export interface BacktestRun {
  id: string;
  strategyId: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  finalValue?: number;
  totalReturnPct?: number;
  annualizedReturnPct?: number;
  maxDrawdownPct?: number;
  turnoverPct?: number;
  rebalanceCount?: number;
  averageStablecoinAllocationPct?: number;
  status: BacktestRunStatus;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export interface BacktestStep {
  id: string;
  backtestRunId: string;
  timestamp: string;
  portfolioValue: number;
  allocationSnapshot: AllocationMap;
  signalsSnapshot: MarketSignalSnapshot;
  actionsTaken: ExecutionAction[];
  rebalanceRequired: boolean;
  turnoverPct: number;
  drawdownPct: number;
}

export interface BacktestMetrics {
  finalPortfolioValue: number;
  totalReturnPct: number;
  annualizedReturnPct: number;
  maxDrawdownPct: number;
  turnoverPct: number;
  rebalanceCount: number;
  averageStablecoinAllocationPct: number;
}

export interface HistoricalMarketPoint {
  timestamp: string;
  prices: Record<string, number>;
  volumes: Record<string, number>;
  signals: MarketSignalSnapshot;
}

export interface HistoricalMarketDataRequest {
  symbols: string[];
  startDate: string;
  endDate: string;
  timeframe: "1h" | "1d";
  baseCurrency: string;
}

export interface HistoricalMarketDataSource {
  getSeries(request: HistoricalMarketDataRequest): Promise<HistoricalMarketPoint[]>;
}

export interface StrategyStoreData {
  strategies: StrategyConfig[];
  strategyRuns: StrategyRun[];
  executionPlans: ExecutionPlan[];
  backtestRuns: BacktestRun[];
  backtestSteps: BacktestStep[];
}

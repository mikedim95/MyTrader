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
  "relative_strength",
  "drawdown_pct",
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

export const STRATEGY_MODES = ["manual", "hybrid", "automatic"] as const;
export type StrategyMode = (typeof STRATEGY_MODES)[number];
export const LEGACY_STRATEGY_MODES = ["semi_auto", "auto"] as const;
export type LegacyStrategyMode = (typeof LEGACY_STRATEGY_MODES)[number];

export const STRATEGY_COMPOSITION_MODES = ["manual", "automatic"] as const;
export type StrategyCompositionMode = (typeof STRATEGY_COMPOSITION_MODES)[number];

export const MARKET_REGIMES = ["risk_on", "neutral", "risk_off", "high_volatility"] as const;
export type MarketRegime = (typeof MARKET_REGIMES)[number];

export const BTC_HALVING_PHASES = [
  "pre_halving",
  "early_cycle",
  "mid_cycle",
  "late_cycle",
  "post_cycle",
] as const;
export type BtcHalvingPhase = (typeof BTC_HALVING_PHASES)[number];

export const STRATEGY_MARKET_CONTEXT_PRICE_FILTERS = ["any", "above_long_ma", "below_long_ma"] as const;
export type StrategyMarketContextPriceFilter = (typeof STRATEGY_MARKET_CONTEXT_PRICE_FILTERS)[number];

export const STRATEGY_MARKET_CONTEXT_INDICATORS = [
  "days_since_halving",
  "btc_price_vs_long_ma_pct",
  "btc_drawdown_from_ath_pct",
  "btc_dominance_trend_pct",
  "btc_overheating_score",
] as const;
export type StrategyMarketContextIndicator = (typeof STRATEGY_MARKET_CONTEXT_INDICATORS)[number];

export const PORTFOLIO_ACCOUNT_TYPES = ["real", "demo"] as const;
export type PortfolioAccountType = (typeof PORTFOLIO_ACCOUNT_TYPES)[number];
export const REBALANCE_ALLOCATION_EXECUTION_POLICIES = ["manual", "on_strategy_run", "interval"] as const;
export type RebalanceAllocationExecutionPolicy = (typeof REBALANCE_ALLOCATION_EXECUTION_POLICIES)[number];

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

export interface StrategySelectionConfig {
  minStrategyScore?: number;
  maxActiveStrategies?: number;
  maxWeightShiftPerCycle?: number;
  strategyCooldownHours?: number;
  minActiveDurationHours?: number;
  fallbackStrategy?: string;
}

export interface StrategyWeightAdjustmentConfig {
  scorePower?: number;
  minWeightPctPerStrategy?: number;
  maxWeightPctPerStrategy?: number;
}

export interface StrategyMarketContextCondition {
  indicator: StrategyMarketContextIndicator;
  operator: StrategyOperator;
  value: number;
}

export interface StrategyMarketContextConfig {
  allowedMarketRegimes?: MarketRegime[];
  allowedHalvingPhases?: BtcHalvingPhase[];
  priceVsLongMaFilter?: StrategyMarketContextPriceFilter;
  blockIfOverheated?: boolean;
  indicatorConditions?: StrategyMarketContextCondition[];
}

export interface StrategyScoreComponents {
  recent_return: number;
  drawdown_penalty: number;
  turnover_penalty: number;
  regime_fit: number;
  stability: number;
}

export interface StrategyScoreResult {
  strategyId: string;
  score: number;
  components: StrategyScoreComponents;
}

export interface DemoAccountHolding {
  symbol: string;
  quantity: number;
  targetAllocation: number;
}

export interface DemoAccountSettings {
  balance: number;
  updatedAt: string;
  seededAt?: string;
  holdings: DemoAccountHolding[];
}

export interface DemoAccountAllocationInput {
  symbol: string;
  percent: number;
}

export interface RebalanceAllocationProfile {
  id: string;
  name: string;
  description?: string;
  strategyId: string;
  allocatedCapital: number;
  baseCurrency: string;
  allocation: AllocationMap;
  holdings: DemoAccountHolding[];
  isEnabled: boolean;
  executionPolicy: RebalanceAllocationExecutionPolicy;
  autoExecuteMinDriftPct?: number;
  scheduleInterval?: string;
  lastEvaluatedAt?: string;
  lastExecutedAt?: string;
  nextExecutionAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyMarketContextSnapshot {
  timestamp: string;
  marketRegime: MarketRegime;
  btcPrice: number;
  btcLongMaDays: number;
  btcLongMa: number;
  btcPriceVsLongMaPct: number;
  btcAth: number;
  btcDrawdownFromAthPct: number;
  daysSinceHalving: number;
  halvingPhase: BtcHalvingPhase;
  overheatingWarning: boolean;
  overheatingScore: number;
  btcDominance?: number;
  btcDominanceTrendPct?: number;
}

export interface StrategyMarketGateFilterResult {
  label: string;
  passed: boolean;
  actualValue: string;
  expectedValue: string;
}

export interface StrategyMarketGateConditionResult {
  indicator: StrategyMarketContextIndicator;
  operator: StrategyOperator;
  expectedValue: number;
  actualValue: number;
  passed: boolean;
}

export interface StrategyMarketGateResult {
  configured: boolean;
  passed: boolean;
  blockingReasons: string[];
  filterResults: StrategyMarketGateFilterResult[];
  conditionResults: StrategyMarketGateConditionResult[];
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
  compositionMode?: StrategyCompositionMode;
  baseStrategies?: string[];
  strategyWeights?: Record<string, number>;
  autoStrategyUsage?: boolean;
  strategySelectionConfig?: StrategySelectionConfig;
  weightAdjustmentConfig?: StrategyWeightAdjustmentConfig;
  marketContextConfig?: StrategyMarketContextConfig;
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
  rebalanceAllocationId?: string;
  rebalanceAllocationName?: string;
  timestamp: string;
  accountType: PortfolioAccountType;
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
  marketContext?: StrategyMarketContextSnapshot;
  marketGate?: StrategyMarketGateResult;
  composition?: {
    compositionMode: StrategyCompositionMode;
    autoStrategyUsage: boolean;
    marketRegime: MarketRegime;
    strategyScores: StrategyScoreResult[];
    activeStrategyWeights: Record<string, number>;
  };
}

export interface StrategyRun {
  id: string;
  strategyId: string;
  rebalanceAllocationId?: string;
  rebalanceAllocationName?: string;
  startedAt: string;
  completedAt?: string;
  status: StrategyRunStatus;
  accountType: PortfolioAccountType;
  mode: StrategyMode;
  trigger: "manual" | "schedule" | "api";
  inputSnapshot?: {
    portfolio: PortfolioState;
    marketSignals: MarketSignalSnapshot;
    marketContext?: StrategyMarketContextSnapshot;
  };
  adjustedAllocation?: AllocationMap;
  executionPlanId?: string;
  warnings: string[];
  marketGate?: StrategyMarketGateResult;
  skipReason?: string;
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
  rebalanceAllocationProfiles: RebalanceAllocationProfile[];
  strategyRuns: StrategyRun[];
  executionPlans: ExecutionPlan[];
  backtestRuns: BacktestRun[];
  backtestSteps: BacktestStep[];
  demoAccount: DemoAccountSettings;
}

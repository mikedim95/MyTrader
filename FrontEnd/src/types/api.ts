export interface Asset {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  balance: number;
  value: number;
  allocation: number;
  targetAllocation: number;
  sparkline: number[];
}

export interface Order {
  id: string;
  time: string;
  pair: string;
  side: "Buy" | "Sell";
  price: number;
  amount: number;
  status: "Filled" | "Pending" | "Cancelled";
}

export interface Activity {
  id: string;
  type: string;
  asset: string;
  amount: string;
  time: string;
}

export interface ConnectionStatus {
  connected: boolean;
  source: "none" | "env" | "session";
  testnet: boolean;
  message?: string;
}

export interface DashboardResponse {
  connection: ConnectionStatus;
  assets: Asset[];
  totalPortfolioValue: number;
  portfolioChange24h: number;
  portfolioChange24hValue: number;
  portfolioHistory: { time: string; value: number }[];
  marketMovers: { symbol: string; name: string; change: number }[];
  recentActivity: Activity[];
  generatedAt: string;
}

export interface OrdersResponse {
  connection: ConnectionStatus;
  orders: Order[];
}

export interface MinerBasicInfo {
  id: string;
  name: string;
  model: string;
  status: string;
  hashrateTH: number | null;
  powerW: number | null;
  pool: string | null;
  lastSeen: string | null;
  estimatedDailyRevenueUSD: number | null;
  algorithm: string | null;
  market: string | null;
  profitabilityBTC: number | null;
  unpaidAmountBTC: number | null;
  acceptedSpeed: number | null;
  acceptedSpeedUnit: string | null;
  rejectedSpeed: number | null;
}

export interface MiningOverviewResponse {
  source: "none" | "env";
  connected: boolean;
  message?: string;
  totalMiners: number | null;
  activeMiners: number | null;
  totalHashrateTH: number | null;
  totalPowerW: number | null;
  averageChipTempC: number | null;
  estimatedDailyRevenueUSD: number | null;
  miners: MinerBasicInfo[];
  generatedAt: string;
}

export interface NicehashOverviewResponse {
  source: "none" | "env";
  connected: boolean;
  message?: string;
  poolStatus: string | null;
  poolName: string | null;
  poolUrl: string | null;
  algorithm: string | null;
  miningAddress: string | null;
  assignedMiners: number | null;
  activeMiners: number | null;
  hashrateTH: number | null;
  powerW: number | null;
  estimatedDailyRevenueUSD: number | null;
  estimatedDailyRevenueBTC: number | null;
  unpaidAmountBTC: number | null;
  accountTotalBTC: number | null;
  assets: NicehashAssetBalance[];
  miners: MinerBasicInfo[];
  generatedAt: string;
}

export interface NicehashAssetBalance {
  currency: string;
  available: number | null;
  pending: number | null;
  totalBalance: number | null;
  btcRate: number | null;
}

export type StrategyMode = "manual" | "semi_auto" | "auto";
export type StrategyOperator = ">" | "<" | ">=" | "<=" | "==" | "!=";
export type StrategyActionType =
  | "increase"
  | "decrease"
  | "shift"
  | "increase_stablecoin_exposure"
  | "reduce_altcoin_exposure";
export type StrategyRunStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type BacktestRunStatus = "pending" | "running" | "completed" | "failed";

export type AllocationMap = Record<string, number>;

export interface StrategyCondition {
  indicator: string;
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

export interface StrategyExecutionAction {
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
  recommendedTrades: StrategyExecutionAction[];
  warnings: string[];
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

export interface MarketSignalSnapshot {
  timestamp: string;
  indicators: Record<string, number>;
  assetIndicators: Record<string, Record<string, number>>;
}

export interface PortfolioState {
  timestamp: string;
  baseCurrency: string;
  totalValue: number;
  assets: Array<{
    symbol: string;
    quantity: number;
    price: number;
    value: number;
    allocation: number;
    change24h?: number;
    volume24h?: number;
  }>;
  allocation: AllocationMap;
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

export interface StrategyStateResponse {
  strategyId: string;
  currentAllocation: AllocationMap;
  adjustedTargetAllocation: AllocationMap;
  portfolio: PortfolioState;
  signals: MarketSignalSnapshot;
  executionPlan: ExecutionPlan;
  traces: RuleEvaluationTrace[];
  warnings: string[];
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

export interface BacktestMetrics {
  finalPortfolioValue: number;
  totalReturnPct: number;
  annualizedReturnPct: number;
  maxDrawdownPct: number;
  turnoverPct: number;
  rebalanceCount: number;
  averageStablecoinAllocationPct: number;
}

export interface BacktestTimelinePoint {
  timestamp: string;
  portfolioValue: number;
  drawdownPct: number;
  rebalanceRequired: boolean;
  turnoverPct: number;
}

export interface StrategiesResponse {
  strategies: StrategyConfig[];
}

export interface StrategyResponse {
  strategy: StrategyConfig;
}

export interface StrategyRunsResponse {
  runs: StrategyRun[];
}

export interface StrategyRunResponse {
  run: StrategyRun;
  executionPlan?: ExecutionPlan | null;
}

export interface ExecutionPlanResponse {
  executionPlan: ExecutionPlan;
}

export interface StrategyValidationResponse {
  valid: boolean;
  strategy?: StrategyConfig;
  errors?: string[];
}

export interface BacktestsResponse {
  backtests: BacktestRun[];
}

export interface BacktestResponse {
  backtestRun: BacktestRun;
}

export interface CreateBacktestResponse {
  backtestRun: BacktestRun;
  steps: number;
}

export interface BacktestTimelineResponse {
  timeline: BacktestTimelinePoint[];
  run: BacktestRun;
}

export interface BacktestMetricsResponse {
  metrics: BacktestMetrics;
}

export interface BacktestCreateRequest {
  strategyId: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  baseCurrency: string;
  timeframe: "1h" | "1d";
  rebalanceCostsPct: number;
  slippagePct: number;
}

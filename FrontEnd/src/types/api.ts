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
  sparklinePeriod: "24h";
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
  source: "none" | "env" | "session" | "stored";
  testnet: boolean;
  message?: string;
}

export interface NicehashConnectionStatus {
  connected: boolean;
  source: "none" | "env" | "session" | "stored";
  message?: string;
}

export type StrategyStorageMode = "database" | "offline";

export interface DummyCredentialHint {
  username: string;
  password: string;
}

export interface SessionStatusResponse {
  requiresLogin: boolean;
  storageMode: StrategyStorageMode;
  databaseAvailable: boolean;
  message: string;
  dummyCredentials?: DummyCredentialHint[];
}

export interface AppSession {
  userId?: number;
  username: string;
  storageMode: StrategyStorageMode;
  databaseAvailable: boolean;
}

export interface SessionLoginResponse {
  session: AppSession;
  status: SessionStatusResponse;
}

export interface MinerCapabilities {
  canReadHttp: boolean;
  canReadCgminer: boolean;
  canUnlock: boolean;
  canRestart: boolean;
  canReboot: boolean;
  canSwitchPool: boolean;
  canReadPresets: boolean;
}

export interface MinerEntity {
  id: number;
  name: string;
  ip: string;
  apiBaseUrl: string;
  model: string | null;
  firmware: string | null;
  currentPreset: string | null;
  isEnabled: boolean;
  verificationStatus: "pending" | "verified" | "failed";
  lastSeenAt: string | null;
  lastError: string | null;
  capabilities: MinerCapabilities | null;
  createdAt: string;
  updatedAt: string;
}

export interface MinerPoolEntity {
  id: number;
  minerId: number;
  poolIndex: number;
  url: string;
  username: string;
  status: string | null;
  isActive: boolean;
  updatedAt: string;
}

export interface MinerPoolLive {
  id: number;
  url: string;
  user: string;
  status: string;
  accepted?: number;
  rejected?: number;
  stale?: number;
}

export interface MinerLiveData {
  minerId: number;
  name: string;
  ip: string;
  online: boolean;
  minerState: string | null;
  unlocked: boolean;
  presetName: string | null;
  presetPretty: string | null;
  presetStatus: string | null;
  totalRateThs: number | null;
  boardTemps: number[];
  hotspotTemps: number[];
  chipTempStrings: string[];
  pcbTempStrings: string[];
  fanPwm: number | null;
  fanRpm: number[];
  chainRates: number[];
  chainStates: string[];
  powerWatts: number | null;
  poolActiveIndex: number | null;
  pools: MinerPoolLive[];
  lastSeenAt: string | null;
  raw?: unknown;
}

export interface MinerHistoryPoint {
  id: number;
  createdAt: string;
  online: boolean;
  totalRateThs: number | null;
  powerWatts: number | null;
  boardTemps: number[];
  hotspotTemps: number[];
  fanPwm: number | null;
}

export interface FleetHistoryPoint {
  timestamp: string;
  online: boolean;
  totalRateThs: number | null;
  maxBoardTemp: number | null;
  maxHotspotTemp: number | null;
  maxTemp: number | null;
  powerWatts: number | null;
}

export interface FleetHistorySeries {
  minerId: number;
  minerName: string;
  minerIp: string;
  points: FleetHistoryPoint[];
}

export type FleetHistoryScope = "hour" | "day" | "week" | "month";

export interface MinerVerificationResult {
  reachable: boolean;
  httpOk: boolean;
  cgminerOk: boolean;
  unlockOk: boolean;
  minerState: string | null;
  currentPreset: string | null;
  model: string | null;
  firmware: string | null;
  capabilities: MinerCapabilities;
  presets: Array<{
    name: string;
    pretty: string | null;
    status: string | null;
  }>;
  error: string | null;
}

export interface MinerPresetOption {
  name: string;
  pretty: string | null;
  status: string | null;
}

export interface FleetOverview {
  totalMiners: number;
  onlineMiners: number;
  enabledMiners: number;
  totalRateThs: number;
  totalPowerWatts: number;
  hottestBoardTemp: number | null;
  hottestHotspotTemp: number | null;
  generatedAt: string;
}

export interface MinerCommandResponse {
  liveData: MinerLiveData;
  response: unknown;
}

export interface MinersResponse {
  miners: MinerEntity[];
}

export interface MinerResponse {
  miner: MinerEntity | null;
}

export interface MinerDetailResponse {
  miner: MinerEntity;
  liveData: MinerLiveData;
  pools: MinerPoolEntity[];
  presets: MinerPresetOption[];
  commands: Array<{
    id: number;
    minerId: number;
    commandType: string;
    request: unknown;
    response: unknown;
    status: "pending" | "completed" | "failed";
    errorText: string | null;
    createdBy: string | null;
    createdAt: string;
  }>;
}

export interface MinerLiveResponse {
  liveData: MinerLiveData;
}

export interface MinerHistoryResponse {
  history: MinerHistoryPoint[];
}

export interface MinerPoolsResponse {
  pools: MinerPoolEntity[];
}

export interface FleetLiveResponse {
  miners: MinerLiveData[];
}

export interface FleetHistoryResponse {
  history: FleetHistorySeries[];
  generatedAt: string;
  scope: FleetHistoryScope;
}

export interface FleetOverviewResponse {
  overview: FleetOverview;
}

export interface VerifyMinerDraftResponse {
  apiBaseUrl: string;
  verification: MinerVerificationResult;
}

export interface CreateMinerResponse {
  miner: MinerEntity;
  verification: MinerVerificationResult;
  liveData: MinerLiveData | null;
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

export interface TradingPairPreview {
  baseSymbol: string;
  baseName: string;
  quoteSymbol: string;
  quoteName: string;
  basePriceUsd: number;
  quotePriceUsd: number;
  priceInQuote: number;
  inversePrice: number;
  baseChange24h: number;
  quoteChange24h: number;
  baseBalance: number;
  quoteBalance: number;
  pricingSource: "direct" | "inverse" | "usd_cross";
}

export interface TradingPairPreviewResponse {
  accountType: PortfolioAccountType;
  pair: TradingPairPreview;
  generatedAt: string;
}

export interface OrdersResponse {
  connection: ConnectionStatus;
  orders: Order[];
}

export type BtcNewsCurrentState = "bullish" | "mildly_bullish" | "neutral" | "mildly_bearish" | "bearish";

export interface BtcNewsInsightsSummary {
  bias_1h: number;
  bias_6h: number;
  bias_24h: number;
  total_items_24h: number;
  bullish_count_24h: number;
  bearish_count_24h: number;
  neutral_count_24h: number;
  dominant_topic_24h: string | null;
  current_state: BtcNewsCurrentState;
}

export interface BtcNewsInsightArticle {
  id: number;
  source: string;
  title: string;
  url: string;
  published_at: string | null;
  topic: string | null;
  sentiment: string | null;
  confidence: number;
  impact_score: number;
  time_horizon: string | null;
  btc_direction: string | null;
  action_bias: string | null;
  weighted_score: number;
  ai_summary: string | null;
  why_it_matters: string | null;
  raw_summary: string | null;
  created_at: string | null;
}

export interface BtcNewsTopicBreakdownItem {
  topic: string;
  count: number;
  total_weighted_score: number;
}

export interface BtcNewsActionBreakdown {
  buy_count: number;
  sell_count: number;
  hold_count: number;
}

export interface BtcNewsInsightsResponse {
  summary: BtcNewsInsightsSummary;
  top_articles: BtcNewsInsightArticle[];
  topic_breakdown: BtcNewsTopicBreakdownItem[];
  action_breakdown: BtcNewsActionBreakdown;
  generated_at: string;
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
  source: "none" | "env" | "session" | "stored";
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

export type StrategyMode = "manual" | "hybrid" | "automatic";
export type StrategyCompositionMode = "manual" | "automatic";
export type MarketRegime = "risk_on" | "neutral" | "risk_off" | "high_volatility";
export type BtcHalvingPhase = "pre_halving" | "early_cycle" | "mid_cycle" | "late_cycle" | "post_cycle";
export type StrategyMarketContextPriceFilter = "any" | "above_long_ma" | "below_long_ma";
export type StrategyMarketContextIndicator =
  | "days_since_halving"
  | "btc_price_vs_long_ma_pct"
  | "btc_drawdown_from_ath_pct"
  | "btc_dominance_trend_pct"
  | "btc_overheating_score";
export type StrategyOperator = ">" | "<" | ">=" | "<=" | "==" | "!=";
export type StrategyActionType =
  | "increase"
  | "decrease"
  | "shift"
  | "increase_stablecoin_exposure"
  | "reduce_altcoin_exposure";
export type PortfolioAccountType = "real" | "demo";
export type StrategyRunStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type BacktestRunStatus = "pending" | "running" | "completed" | "failed";
export type StrategyApprovalState = "draft" | "testing" | "paper" | "approved" | "rejected";
export type StrategyJobType =
  | "sync_historical_candles"
  | "run_backtest"
  | "evaluate_strategy_candidate"
  | "refresh_projected_outcome";
export type StrategyJobStatus = "pending" | "running" | "completed" | "failed";

export interface DemoAccountHolding {
  symbol: string;
  quantity: number;
  targetAllocation: number;
}

export interface DemoAccountAllocationInput {
  symbol: string;
  percent: number;
}

export interface DemoAccountSettings {
  balance: number;
  updatedAt: string;
  seededAt?: string;
  holdings: DemoAccountHolding[];
}

export interface DemoAccountInitializeRequest {
  balance: number;
  allocations: DemoAccountAllocationInput[];
}

export type RebalanceAllocationExecutionPolicy = "manual" | "on_strategy_run" | "interval";

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

export interface RebalanceAllocationInput {
  name: string;
  description?: string;
  strategyId: string;
  allocatedCapital: number;
  baseCurrency: string;
  allocations: DemoAccountAllocationInput[];
  isEnabled: boolean;
  executionPolicy: RebalanceAllocationExecutionPolicy;
  autoExecuteMinDriftPct?: number;
  scheduleInterval?: string;
}

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

export interface StrategyRiskControls {
  maxValidationDrawdownPct?: number;
  minValidationReturnPct?: number;
  maxValidationTurnoverPct?: number;
  requirePositiveValidationReturn?: boolean;
  requireTrainValidationSplit?: boolean;
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
  version: number;
  lineageId: string;
  approvalState: StrategyApprovalState;
  approvalUpdatedAt?: string;
  approvalNote?: string;
  riskControls?: StrategyRiskControls;
  latestEvaluationSummary?: StrategyCandidateEvaluationSummary;
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
  recommendedTrades: StrategyExecutionAction[];
  warnings: string[];
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
  accountType: PortfolioAccountType;
  currentAllocation: AllocationMap;
  baseAllocation: AllocationMap;
  adjustedTargetAllocation: AllocationMap;
  portfolio: PortfolioState;
  signals: MarketSignalSnapshot;
  marketContext?: StrategyMarketContextSnapshot;
  marketGate?: StrategyMarketGateResult;
  executionPlan: ExecutionPlan;
  projectedOutcome?: StrategyProjectedOutcome;
  traces: RuleEvaluationTrace[];
  warnings: string[];
  composition?: {
    compositionMode: StrategyCompositionMode;
    autoStrategyUsage: boolean;
    marketRegime: MarketRegime;
    strategyScores: StrategyScoreResult[];
    activeStrategyWeights: Record<string, number>;
  };
}

export interface RebalanceAllocationProfilesResponse {
  profiles: RebalanceAllocationProfile[];
}

export interface RebalanceAllocationProfileResponse {
  profile: RebalanceAllocationProfile;
}

export interface RebalanceAllocationStateResponse extends StrategyStateResponse {
  profile: RebalanceAllocationProfile;
  strategy: StrategyConfig;
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

export interface StrategyProjectedHolding {
  symbol: string;
  currentPercent: number;
  targetPercent: number;
  currentValue: number;
  targetValue: number;
  currentQuantity: number;
  targetQuantity: number;
  deltaValue: number;
}

export interface StrategyProjectedOutcome {
  generatedAt: string;
  accountType: PortfolioAccountType;
  baseCurrency: string;
  portfolioValue: number;
  driftPct: number;
  estimatedTurnoverPct: number;
  projectedAllocation: AllocationMap;
  holdings: StrategyProjectedHolding[];
}

export interface StrategyEvaluationWindow {
  startDate: string;
  endDate: string;
  timeframe: "1h" | "1d";
}

export interface StrategyRiskCheckResult {
  name: string;
  passed: boolean;
  actualValue?: number;
  threshold?: number;
  message: string;
}

export interface StrategyCandidateEvaluationSummary {
  id: string;
  strategyId: string;
  strategyVersion: number;
  createdAt: string;
  trainWindow: StrategyEvaluationWindow;
  validationWindow: StrategyEvaluationWindow;
  trainBacktestRunId: string;
  validationBacktestRunId: string;
  trainMetrics: BacktestMetrics;
  validationMetrics: BacktestMetrics;
  riskChecks: StrategyRiskCheckResult[];
  riskGatePassed: boolean;
  recommendedApprovalState: StrategyApprovalState;
  notes: string[];
}

export interface StrategyJob {
  id: string;
  type: StrategyJobType;
  status: StrategyJobStatus;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyVersionRecord {
  id: string;
  strategyId: string;
  version: number;
  createdAt: string;
  approvalState: StrategyApprovalState;
  strategySnapshot: StrategyConfig;
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

export interface StrategyVersionsResponse {
  strategy: StrategyConfig;
  versions: StrategyVersionRecord[];
}

export interface StrategyEvaluationsResponse {
  strategy: StrategyConfig;
  evaluations: StrategyCandidateEvaluationSummary[];
}

export interface StrategyEvaluationResponse {
  strategy: StrategyConfig;
  job: StrategyJob;
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

export interface DemoAccountSettingsResponse {
  demoAccount: DemoAccountSettings;
}

export interface BacktestsResponse {
  backtests: BacktestRun[];
}

export interface BacktestResponse {
  backtestRun: BacktestRun;
}

export interface CreateBacktestResponse {
  job: StrategyJob;
}

export interface StrategyJobsResponse {
  jobs: StrategyJob[];
}

export interface StrategyJobResponse {
  job: StrategyJob;
}

export interface BacktestTimelineResponse {
  timeline: BacktestTimelinePoint[];
  run: BacktestRun;
}

export interface BacktestMetricsResponse {
  metrics: BacktestMetrics;
}

export interface BacktestMarketPreviewPoint {
  timestamp: string;
  price: number;
}

export interface BacktestMarketPreviewRequest {
  startDate: string;
  endDate: string;
  baseCurrency?: string;
  timeframe?: "1h" | "1d";
  symbol?: string;
}

export interface BacktestMarketPreviewResponse {
  symbol: string;
  timeframe: "1h" | "1d";
  startDate: string;
  endDate: string;
  history: BacktestMarketPreviewPoint[];
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

export interface StrategyCandidateEvaluationRequest {
  startDate: string;
  endDate: string;
  initialCapital: number;
  baseCurrency: string;
  validationDays?: number;
  rebalanceCostsPct: number;
  slippagePct: number;
}

export interface HistoricalCandleSyncRequest {
  symbol: string;
  interval: "1h" | "1d";
  startTime: string;
  endTime: string;
}

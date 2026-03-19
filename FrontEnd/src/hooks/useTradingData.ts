import { useQuery } from "@tanstack/react-query";
import { backendApi } from "@/lib/api";
import type { BacktestMarketPreviewRequest, ExchangeMarketSymbol, FleetHistoryScope, PortfolioAccountType } from "@/types/api";

export function useDashboardData(accountType: PortfolioAccountType = "real") {
  return useQuery({
    queryKey: ["dashboard", accountType],
    queryFn: () => backendApi.getDashboard(accountType),
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}

export function useTradingPairPreview(
  baseSymbol: string | undefined,
  quoteSymbol: string | undefined,
  accountType: PortfolioAccountType = "real"
) {
  const base = baseSymbol?.trim().toUpperCase();
  const quote = quoteSymbol?.trim().toUpperCase();

  return useQuery({
    queryKey: ["trading-pair-preview", base, quote, accountType],
    queryFn: () => backendApi.getTradingPairPreview(base ?? "", quote ?? "", accountType),
    enabled: Boolean(base) && Boolean(quote) && base !== quote,
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}

export function useTradingAssets(accountType: PortfolioAccountType = "real") {
  return useQuery({
    queryKey: ["trading-assets", accountType],
    queryFn: () => backendApi.getTradingAssets(accountType),
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}

export function useOrdersData() {
  return useQuery({
    queryKey: ["orders"],
    queryFn: backendApi.getOrders,
    staleTime: 10_000,
    refetchInterval: 20_000,
    retry: 1,
  });
}

export function useBtcNewsInsights() {
  return useQuery({
    queryKey: ["btc-news-insights"],
    queryFn: backendApi.getBtcNewsInsights,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}

export function useDecisionIntelligence(accountType: PortfolioAccountType = "real") {
  return useQuery({
    queryKey: ["decision-intelligence", accountType],
    queryFn: () => backendApi.getDecisionIntelligence(accountType),
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}

export function useSignalReview(accountType: PortfolioAccountType = "real", limit = 25) {
  return useQuery({
    queryKey: ["signal-review", accountType, limit],
    queryFn: () => backendApi.getSignalReview(accountType, limit),
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}

export function useNicehashConnection(enabled = true) {
  return useQuery({
    queryKey: ["nicehash-connection"],
    queryFn: backendApi.getNicehashConnection,
    enabled,
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: false,
  });
}

export function useDemoAccountSettings() {
  return useQuery({
    queryKey: ["demo-account-settings"],
    queryFn: backendApi.getDemoAccountSettings,
    staleTime: 5_000,
    refetchInterval: 20_000,
    retry: 1,
  });
}

export function useMiningOverview() {
  return useQuery({
    queryKey: ["mining-overview"],
    queryFn: backendApi.getMiningOverview,
    staleTime: 10_000,
    refetchInterval: 20_000,
    retry: 1,
  });
}

export function useNicehashOverview() {
  return useQuery({
    queryKey: ["nicehash-overview"],
    queryFn: backendApi.getNicehashOverview,
    staleTime: 10_000,
    refetchInterval: 20_000,
    retry: 1,
  });
}

export function useExchangeHealth() {
  return useQuery({
    queryKey: ["exchange-health"],
    queryFn: backendApi.getExchangeHealth,
    staleTime: 4_000,
    refetchInterval: 5_000,
    retry: 1,
  });
}

export function useExchangePairs() {
  return useQuery({
    queryKey: ["exchange-pairs"],
    queryFn: backendApi.getExchangePairs,
    staleTime: 60_000,
    retry: 1,
  });
}

export function useExchangeTicker(symbol: ExchangeMarketSymbol | undefined) {
  return useQuery({
    queryKey: ["exchange-ticker", symbol],
    queryFn: () => backendApi.getExchangeTicker(symbol ?? "BTC-USD"),
    enabled: Boolean(symbol),
    staleTime: 4_000,
    refetchInterval: 5_000,
    retry: 1,
  });
}

export function useExchangeOrderBookSummary(symbol: ExchangeMarketSymbol | undefined, depth = 10) {
  return useQuery({
    queryKey: ["exchange-orderbook-summary", symbol, depth],
    queryFn: () => backendApi.getExchangeOrderBookSummary(symbol ?? "BTC-USD", depth),
    enabled: Boolean(symbol),
    staleTime: 4_000,
    refetchInterval: 5_000,
    retry: 1,
  });
}

export function useExchangeComparison(symbol: ExchangeMarketSymbol | undefined) {
  return useQuery({
    queryKey: ["exchange-comparison", symbol],
    queryFn: () => backendApi.getExchangeComparison(symbol ?? "BTC-USD"),
    enabled: Boolean(symbol),
    staleTime: 4_000,
    refetchInterval: 5_000,
    retry: 1,
  });
}

export function useFleetOverview() {
  return useQuery({
    queryKey: ["fleet-overview"],
    queryFn: backendApi.getFleetOverview,
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}

export function useFleetLive() {
  return useQuery({
    queryKey: ["fleet-live"],
    queryFn: backendApi.getFleetLive,
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}

export function useRebalanceAllocationProfiles() {
  return useQuery({
    queryKey: ["rebalance-allocation-profiles"],
    queryFn: backendApi.getRebalanceAllocationProfiles,
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}

export function useRebalanceAllocationState(profileId: string | undefined) {
  return useQuery({
    queryKey: ["rebalance-allocation-state", profileId],
    queryFn: () => backendApi.getRebalanceAllocationState(profileId ?? ""),
    enabled: Boolean(profileId),
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}

export function useFleetHistory(scope: FleetHistoryScope = "hour") {
  return useQuery({
    queryKey: ["fleet-history", scope],
    queryFn: () => backendApi.getFleetHistory(scope),
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}

export function useMiners() {
  return useQuery({
    queryKey: ["miners-list"],
    queryFn: backendApi.getMiners,
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}

export function useMinerDetails(minerId: number | undefined) {
  return useQuery({
    queryKey: ["miner-details", minerId],
    queryFn: () => backendApi.getMinerDetails(minerId ?? 0),
    enabled: typeof minerId === "number" && minerId > 0,
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}

export function useMinerHistory(minerId: number | undefined, limit = 120) {
  return useQuery({
    queryKey: ["miner-history", minerId, limit],
    queryFn: () => backendApi.getMinerHistory(minerId ?? 0, limit),
    enabled: typeof minerId === "number" && minerId > 0,
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}

export function useStrategies() {
  return useQuery({
    queryKey: ["strategies"],
    queryFn: backendApi.getStrategies,
    staleTime: 5_000,
    refetchInterval: 20_000,
    retry: 1,
  });
}

export function useStrategyVersions(strategyId: string | undefined) {
  return useQuery({
    queryKey: ["strategy-versions", strategyId],
    queryFn: () => backendApi.getStrategyVersions(strategyId ?? ""),
    enabled: Boolean(strategyId),
    staleTime: 10_000,
    retry: 1,
  });
}

export function useStrategyEvaluations(strategyId: string | undefined) {
  return useQuery({
    queryKey: ["strategy-evaluations", strategyId],
    queryFn: () => backendApi.getStrategyEvaluations(strategyId ?? ""),
    enabled: Boolean(strategyId),
    staleTime: 10_000,
    retry: 1,
  });
}

export function useStrategyRuns(accountType: PortfolioAccountType = "real") {
  return useQuery({
    queryKey: ["strategy-runs", accountType],
    queryFn: () => backendApi.getStrategyRuns(accountType),
    staleTime: 5_000,
    refetchInterval: 20_000,
    retry: 1,
  });
}

export function useStrategyRunDetails(runId: string | undefined) {
  return useQuery({
    queryKey: ["strategy-run", runId],
    queryFn: () => backendApi.getStrategyRun(runId ?? ""),
    enabled: Boolean(runId),
    staleTime: 5_000,
    refetchInterval: 20_000,
    retry: 1,
  });
}

export function useStrategyJobs(strategyId: string | undefined, limit = 12) {
  return useQuery({
    queryKey: ["strategy-jobs", strategyId, limit],
    queryFn: () => backendApi.getStrategyJobs({ strategyId, limit }),
    enabled: Boolean(strategyId),
    staleTime: 5_000,
    refetchInterval: 5_000,
    retry: 1,
  });
}

export function useStrategyJob(jobId: string | undefined) {
  return useQuery({
    queryKey: ["strategy-job", jobId],
    queryFn: () => backendApi.getStrategyJob(jobId ?? ""),
    enabled: Boolean(jobId),
    staleTime: 5_000,
    refetchInterval: 5_000,
    retry: 1,
  });
}

export function useBacktests() {
  return useQuery({
    queryKey: ["backtests"],
    queryFn: backendApi.getBacktests,
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}

export function useBacktestMarketPreview(request: BacktestMarketPreviewRequest | undefined) {
  return useQuery({
    queryKey: [
      "backtest-market-preview",
      request?.startDate,
      request?.endDate,
      request?.baseCurrency,
      request?.timeframe,
      request?.symbol,
    ],
    queryFn: () => backendApi.getBacktestMarketPreview(request ?? { startDate: "", endDate: "" }),
    enabled: Boolean(request?.startDate) && Boolean(request?.endDate),
    staleTime: 60_000,
    retry: 1,
  });
}

export function useStrategyState(strategyId: string | undefined, accountType: PortfolioAccountType = "real") {
  return useQuery({
    queryKey: ["strategy-state", strategyId, accountType],
    queryFn: () => backendApi.getStrategyState(strategyId ?? "", accountType),
    enabled: Boolean(strategyId),
    staleTime: 5_000,
    refetchInterval: 20_000,
    retry: 1,
  });
}

export function useStrategyExecutionPlan(strategyId: string | undefined, accountType: PortfolioAccountType = "real") {
  return useQuery({
    queryKey: ["strategy-execution-plan", strategyId, accountType],
    queryFn: () => backendApi.getStrategyExecutionPlan(strategyId ?? "", accountType),
    enabled: Boolean(strategyId),
    staleTime: 5_000,
    refetchInterval: 20_000,
    retry: 1,
  });
}

export function useBacktestMetrics(backtestId: string | undefined) {
  return useQuery({
    queryKey: ["backtest-metrics", backtestId],
    queryFn: () => backendApi.getBacktestMetrics(backtestId ?? ""),
    enabled: Boolean(backtestId),
    staleTime: 10_000,
    retry: 1,
  });
}

export function useBacktestTimeline(backtestId: string | undefined) {
  return useQuery({
    queryKey: ["backtest-timeline", backtestId],
    queryFn: () => backendApi.getBacktestTimeline(backtestId ?? ""),
    enabled: Boolean(backtestId),
    staleTime: 10_000,
    retry: 1,
  });
}

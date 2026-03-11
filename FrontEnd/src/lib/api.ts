import type {
  BacktestCreateRequest,
  BacktestMetricsResponse,
  BacktestResponse,
  BacktestTimelineResponse,
  BacktestsResponse,
  ConnectionStatus,
  CreateBacktestResponse,
  DashboardResponse,
  ExecutionPlanResponse,
  MiningOverviewResponse,
  NicehashOverviewResponse,
  OrdersResponse,
  StrategiesResponse,
  StrategyResponse,
  StrategyRunResponse,
  StrategyRunsResponse,
  StrategyStateResponse,
  StrategyValidationResponse,
} from "@/types/api";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

interface ConnectRequest {
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
}

function parseJsonSafely(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  const bodyText = await response.text();
  const payload = parseJsonSafely(bodyText);

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "message" in payload &&
      typeof (payload as { message: unknown }).message === "string"
        ? (payload as { message: string }).message
        : `Request failed with status ${response.status}`;

    throw new Error(message);
  }

  return payload as T;
}

export const backendApi = {
  getDashboard: () => apiRequest<DashboardResponse>("/api/dashboard"),
  getOrders: () => apiRequest<OrdersResponse>("/api/orders"),
  getMiningOverview: () => apiRequest<MiningOverviewResponse>("/api/mining/overview"),
  getNicehashOverview: () => apiRequest<NicehashOverviewResponse>("/api/mining/nicehash"),
  getBinanceConnection: () => apiRequest<ConnectionStatus>("/api/binance/connection"),
  connectBinance: (body: ConnectRequest) =>
    apiRequest<ConnectionStatus>("/api/binance/connection", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  disconnectBinance: () =>
    apiRequest<ConnectionStatus>("/api/binance/connection", {
      method: "DELETE",
    }),

  getStrategies: () => apiRequest<StrategiesResponse>("/api/strategies"),
  getStrategy: (strategyId: string) => apiRequest<StrategyResponse>(`/api/strategies/${strategyId}`),
  validateStrategy: (body: unknown) =>
    apiRequest<StrategyValidationResponse>("/api/strategies/validate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createStrategy: (body: unknown) =>
    apiRequest<StrategyResponse>("/api/strategies", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateStrategy: (strategyId: string, body: unknown) =>
    apiRequest<StrategyResponse>(`/api/strategies/${strategyId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  runStrategyNow: (strategyId: string) =>
    apiRequest<StrategyRunResponse>(`/api/strategies/${strategyId}/run-now`, {
      method: "POST",
    }),
  getStrategyState: (strategyId: string) =>
    apiRequest<StrategyStateResponse>(`/api/strategies/${strategyId}/state`),
  getStrategyExecutionPlan: (strategyId: string) =>
    apiRequest<ExecutionPlanResponse>(`/api/strategies/${strategyId}/execution-plan`),
  enableStrategy: (strategyId: string) =>
    apiRequest<StrategyResponse>(`/api/strategies/${strategyId}/enable`, {
      method: "POST",
    }),
  disableStrategy: (strategyId: string) =>
    apiRequest<StrategyResponse>(`/api/strategies/${strategyId}/disable`, {
      method: "POST",
    }),
  scheduleStrategy: (strategyId: string, scheduleInterval: string) =>
    apiRequest<StrategyResponse>(`/api/strategies/${strategyId}/schedule`, {
      method: "POST",
      body: JSON.stringify({ scheduleInterval }),
    }),
  getStrategyRuns: () => apiRequest<StrategyRunsResponse>("/api/strategy-runs"),
  getStrategyRun: (runId: string) => apiRequest<StrategyRunResponse>(`/api/strategy-runs/${runId}`),

  createBacktest: (body: BacktestCreateRequest) =>
    apiRequest<CreateBacktestResponse>("/api/backtests", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getBacktests: () => apiRequest<BacktestsResponse>("/api/backtests"),
  getBacktest: (backtestId: string) => apiRequest<BacktestResponse>(`/api/backtests/${backtestId}`),
  getBacktestTimeline: (backtestId: string) =>
    apiRequest<BacktestTimelineResponse>(`/api/backtests/${backtestId}/timeline`),
  getBacktestMetrics: (backtestId: string) =>
    apiRequest<BacktestMetricsResponse>(`/api/backtests/${backtestId}/metrics`),
};

export type { ConnectRequest };

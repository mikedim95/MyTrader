import type {
  BacktestCreateRequest,
  BacktestMetricsResponse,
  BacktestResponse,
  BacktestTimelineResponse,
  BacktestsResponse,
  ConnectionStatus,
  DemoAccountSettingsResponse,
  CreateBacktestResponse,
  DashboardResponse,
  ExecutionPlanResponse,
  MiningOverviewResponse,
  NicehashOverviewResponse,
  OrdersResponse,
  PortfolioAccountType,
  StrategiesResponse,
  StrategyResponse,
  StrategyRunResponse,
  StrategyRunsResponse,
  StrategyStateResponse,
  StrategyValidationResponse,
} from "@/types/api";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

function resolveUserScope(): { userId?: number; username?: string } {
  if (typeof window === "undefined") return {};

  const params = new URLSearchParams(window.location.search);
  const rawUserId = params.get("userId");
  const userId = rawUserId ? Number.parseInt(rawUserId, 10) : Number.NaN;
  if (Number.isInteger(userId) && userId > 0) {
    return { userId };
  }

  const userFromQuery = params.get("user") ?? params.get("username");
  if (userFromQuery && userFromQuery.trim().length > 0) {
    return { username: userFromQuery.trim().toLowerCase() };
  }

  const userFromStorage = window.localStorage.getItem("mytrader_user");
  if (userFromStorage && userFromStorage.trim().length > 0) {
    return { username: userFromStorage.trim().toLowerCase() };
  }

  return {};
}

interface ConnectRequest {
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
}

function withQuery(path: string, query?: Record<string, string | undefined>): string {
  if (!query) return path;

  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (!value) return;
    params.set(key, value);
  });

  const qs = params.toString();
  if (!qs) return path;
  return `${path}?${qs}`;
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
  const userScope = resolveUserScope();
  if (typeof userScope.userId === "number") {
    headers.set("x-user-id", String(userScope.userId));
  } else if (userScope.username) {
    headers.set("x-user", userScope.username);
  }

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
  getDashboard: (accountType: PortfolioAccountType = "real") =>
    apiRequest<DashboardResponse>(withQuery("/api/dashboard", { accountType })),
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
  getDemoAccountSettings: () =>
    apiRequest<DemoAccountSettingsResponse>("/api/strategy-settings/demo-account"),
  updateDemoAccountSettings: (balance: number) =>
    apiRequest<DemoAccountSettingsResponse>("/api/strategy-settings/demo-account", {
      method: "PUT",
      body: JSON.stringify({ balance }),
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
  deleteStrategy: (strategyId: string) =>
    apiRequest<{ success: boolean }>(`/api/strategies/${strategyId}`, {
      method: "DELETE",
    }),
  runStrategyNow: (strategyId: string, accountType: PortfolioAccountType = "real") =>
    apiRequest<StrategyRunResponse>(withQuery(`/api/strategies/${strategyId}/run-now`, { accountType }), {
      method: "POST",
    }),
  getStrategyState: (strategyId: string, accountType: PortfolioAccountType = "real") =>
    apiRequest<StrategyStateResponse>(withQuery(`/api/strategies/${strategyId}/state`, { accountType })),
  getStrategyExecutionPlan: (strategyId: string, accountType: PortfolioAccountType = "real") =>
    apiRequest<ExecutionPlanResponse>(withQuery(`/api/strategies/${strategyId}/execution-plan`, { accountType })),
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
  getStrategyRuns: (accountType: PortfolioAccountType = "real") =>
    apiRequest<StrategyRunsResponse>(withQuery("/api/strategy-runs", { accountType })),
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

import type {
  BacktestCreateRequest,
  BacktestMetricsResponse,
  BacktestResponse,
  BacktestTimelineResponse,
  BacktestsResponse,
  ConnectionStatus,
  DemoAccountSettingsResponse,
  CreateBacktestResponse,
  CreateMinerResponse,
  DashboardResponse,
  ExecutionPlanResponse,
  FleetLiveResponse,
  FleetOverviewResponse,
  MiningOverviewResponse,
  MinerCommandResponse,
  MinerDetailResponse,
  MinerHistoryResponse,
  MinerLiveResponse,
  MinerPoolsResponse,
  MinersResponse,
  NicehashOverviewResponse,
  OrdersResponse,
  PortfolioAccountType,
  SessionLoginResponse,
  SessionStatusResponse,
  StrategiesResponse,
  StrategyResponse,
  StrategyRunResponse,
  StrategyRunsResponse,
  StrategyStateResponse,
  StrategyValidationResponse,
  VerifyMinerDraftResponse,
} from "@/types/api";
import { getStoredSession } from "@/lib/session";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || "";

function resolveUserScope(): { userId?: number; username?: string } {
  const session = getStoredSession();
  if (!session) return {};
  if (typeof session.userId === "number") {
    return { userId: session.userId };
  }
  return { username: session.username };
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

async function publicApiRequest<T>(path: string, init?: RequestInit): Promise<T> {
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

    const error = new Error(message) as Error & {
      responsePayload?: unknown;
    };
    error.responsePayload = payload;
    throw error;
  }

  return payload as T;
}

export const backendApi = {
  getSessionStatus: () => publicApiRequest<SessionStatusResponse>("/api/session/status"),
  loginSession: (body: { username: string; password: string }) =>
    publicApiRequest<SessionLoginResponse>("/api/session/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getDashboard: (accountType: PortfolioAccountType = "real") =>
    apiRequest<DashboardResponse>(withQuery("/api/dashboard", { accountType })),
  getOrders: () => apiRequest<OrdersResponse>("/api/orders"),
  getMiningOverview: () => apiRequest<MiningOverviewResponse>("/api/mining/overview"),
  getNicehashOverview: () => apiRequest<NicehashOverviewResponse>("/api/mining/nicehash"),
  verifyMinerDraft: (body: { name: string; ip: string; password: string }) =>
    apiRequest<VerifyMinerDraftResponse>("/api/miners/verify-draft", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createMiner: (body: { name: string; ip: string; password: string }) =>
    apiRequest<CreateMinerResponse>("/api/miners", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getMiners: () => apiRequest<MinersResponse>("/api/miners"),
  getMinerDetails: (minerId: number) => apiRequest<MinerDetailResponse>(`/api/miners/${minerId}`),
  updateMiner: (minerId: number, body: { name?: string; ip?: string; password?: string; isEnabled?: boolean }) =>
    apiRequest<MinerResponse>(`/api/miners/${minerId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  verifyMiner: (minerId: number) =>
    apiRequest<{ verification: VerifyMinerDraftResponse["verification"] }>(`/api/miners/${minerId}/verify`, {
      method: "POST",
    }),
  enableMiner: (minerId: number) =>
    apiRequest<MinerResponse>(`/api/miners/${minerId}/enable`, {
      method: "POST",
    }),
  disableMiner: (minerId: number) =>
    apiRequest<MinerResponse>(`/api/miners/${minerId}/disable`, {
      method: "POST",
    }),
  getMinerLive: (minerId: number) => apiRequest<MinerLiveResponse>(`/api/miners/${minerId}/live`),
  getMinerHistory: (minerId: number, limit = 120) =>
    apiRequest<MinerHistoryResponse>(withQuery(`/api/miners/${minerId}/history`, { limit: String(limit) })),
  getMinerPools: (minerId: number) => apiRequest<MinerPoolsResponse>(`/api/miners/${minerId}/pools`),
  getFleetLive: () => apiRequest<FleetLiveResponse>("/api/fleet/live"),
  getFleetOverview: () => apiRequest<FleetOverviewResponse>("/api/fleet/overview"),
  restartMiner: (minerId: number) =>
    apiRequest<MinerCommandResponse>(`/api/miners/${minerId}/restart`, {
      method: "POST",
    }),
  rebootMiner: (minerId: number, after = 3) =>
    apiRequest<MinerCommandResponse>(`/api/miners/${minerId}/reboot`, {
      method: "POST",
      body: JSON.stringify({ after }),
    }),
  startMiner: (minerId: number) =>
    apiRequest<MinerCommandResponse>(`/api/miners/${minerId}/start`, {
      method: "POST",
    }),
  stopMiner: (minerId: number) =>
    apiRequest<MinerCommandResponse>(`/api/miners/${minerId}/stop`, {
      method: "POST",
    }),
  pauseMiner: (minerId: number) =>
    apiRequest<MinerCommandResponse>(`/api/miners/${minerId}/pause`, {
      method: "POST",
    }),
  resumeMiner: (minerId: number) =>
    apiRequest<MinerCommandResponse>(`/api/miners/${minerId}/resume`, {
      method: "POST",
    }),
  switchMinerPool: (minerId: number, poolId: number) =>
    apiRequest<MinerCommandResponse>(`/api/miners/${minerId}/switch-pool`, {
      method: "POST",
      body: JSON.stringify({ poolId }),
    }),
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

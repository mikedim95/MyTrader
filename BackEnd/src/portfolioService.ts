import { createFallbackDashboard, createFallbackOrders } from "./mockData.js";
import {
  STABLE_COINS,
  generateRecentDayLabels,
  getAssetUsdSnapshot,
  getDailyCloseSeries as getPublicDailyCloseSeries,
  getHourlyCloseSeries as getPublicHourlyCloseSeries,
  getMarketCapForSymbol,
  getNameForSymbol,
  getTickerSnapshot,
  getTradingPairSnapshot,
} from "./publicMarketData.js";
import type { StrategyUserScope } from "./strategy/strategy-user-scope.js";
import type { ConnectionStatus, DashboardResponse, OrdersResponse } from "./types.js";

const LIVE_ACCOUNT_UNAVAILABLE_CONNECTION: ConnectionStatus = {
  connected: false,
  source: "none",
  testnet: false,
  message: "Live exchange account integration is unavailable. Demo mode and public market data remain available.",
};

export { STABLE_COINS, generateRecentDayLabels, getAssetUsdSnapshot, getMarketCapForSymbol, getNameForSymbol, getTickerSnapshot, getTradingPairSnapshot };

export async function getHourlyCloseSeries(
  symbol: string,
  _credentials: unknown,
  fallbackPrice: number
): Promise<number[]> {
  return getPublicHourlyCloseSeries(symbol, fallbackPrice);
}

export async function getDailyCloseSeries(
  symbol: string,
  _credentials: unknown,
  fallbackPrice: number
): Promise<{ labels: string[]; closes: number[] }> {
  return getPublicDailyCloseSeries(symbol, fallbackPrice);
}

export async function getDashboardData(_userScope?: StrategyUserScope): Promise<DashboardResponse> {
  return createFallbackDashboard({ ...LIVE_ACCOUNT_UNAVAILABLE_CONNECTION });
}

export async function getOrdersData(_userScope?: StrategyUserScope): Promise<OrdersResponse> {
  return createFallbackOrders({ ...LIVE_ACCOUNT_UNAVAILABLE_CONNECTION });
}

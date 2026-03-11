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

export interface PortfolioHistoryPoint {
  time: string;
  value: number;
}

export interface MarketMover {
  symbol: string;
  name: string;
  change: number;
}

export type ConnectionSource = "none" | "env" | "session";

export interface ConnectionStatus {
  connected: boolean;
  source: ConnectionSource;
  testnet: boolean;
  message?: string;
}

export interface DashboardResponse {
  connection: ConnectionStatus;
  assets: Asset[];
  totalPortfolioValue: number;
  portfolioChange24h: number;
  portfolioChange24hValue: number;
  portfolioHistory: PortfolioHistoryPoint[];
  marketMovers: MarketMover[];
  recentActivity: Activity[];
  generatedAt: string;
}

export interface OrdersResponse {
  connection: ConnectionStatus;
  orders: Order[];
}

export interface BinanceCredentials {
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
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

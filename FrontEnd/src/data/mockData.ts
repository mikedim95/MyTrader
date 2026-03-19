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

const spark = (base: number, trend: number): number[] =>
  Array.from({ length: 24 }, (_, i) => base + trend * (i / 24) + (Math.random() - 0.5) * base * 0.03);

export const assets: Asset[] = [
  { id: "btc", symbol: "BTC", name: "Bitcoin", price: 67432.18, change24h: 2.34, volume24h: 28_400_000_000, marketCap: 1_320_000_000_000, balance: 1.2453, value: 83_987.45, allocation: 42.1, targetAllocation: 40, sparkline: spark(67000, 1500) },
  { id: "eth", symbol: "ETH", name: "Ethereum", price: 3521.67, change24h: -1.12, volume24h: 15_200_000_000, marketCap: 423_000_000_000, balance: 12.847, value: 45_240.87, allocation: 22.7, targetAllocation: 25, sparkline: spark(3550, -40) },
  { id: "sol", symbol: "SOL", name: "Solana", price: 178.43, change24h: 5.67, volume24h: 3_800_000_000, marketCap: 78_000_000_000, balance: 156.32, value: 27_888.94, allocation: 14.0, targetAllocation: 15, sparkline: spark(170, 8) },
  { id: "xrp", symbol: "XRP", name: "XRP", price: 0.6231, change24h: 1.21, volume24h: 2_300_000_000, marketCap: 40_000_000_000, balance: 23000, value: 14_331.3, allocation: 7.2, targetAllocation: 8, sparkline: spark(0.61, 0.02) },
  { id: "ada", symbol: "ADA", name: "Cardano", price: 0.6234, change24h: -2.45, volume24h: 890_000_000, marketCap: 22_000_000_000, balance: 15420, value: 9_616.95, allocation: 4.8, targetAllocation: 5, sparkline: spark(0.64, -0.015) },
  { id: "usdt", symbol: "USDT", name: "Tether", price: 1.0001, change24h: 0.01, volume24h: 52_000_000_000, marketCap: 112_000_000_000, balance: 18342.56, value: 18_344.39, allocation: 9.2, targetAllocation: 7, sparkline: spark(1, 0) },
];

export const totalPortfolioValue = 199_426.38;
export const portfolioChange24h = 1.87;
export const portfolioChange24hValue = 3_672.14;

export const portfolioHistory: { time: string; value: number }[] = Array.from({ length: 30 }, (_, i) => ({
  time: `Mar ${i + 1}`,
  value: 185000 + i * 500 + (Math.random() - 0.3) * 3000,
}));

export const orders: Order[] = [
  { id: "1", time: "2024-03-10 14:32", pair: "BTC/USDT", side: "Buy", price: 67200, amount: 0.15, status: "Filled" },
  { id: "2", time: "2024-03-10 13:18", pair: "ETH/USDT", side: "Sell", price: 3540, amount: 2.5, status: "Filled" },
  { id: "3", time: "2024-03-10 12:05", pair: "SOL/USDT", side: "Buy", price: 175.2, amount: 10, status: "Pending" },
  { id: "4", time: "2024-03-10 10:44", pair: "XRP/USDT", side: "Buy", price: 0.62, amount: 5000, status: "Filled" },
  { id: "5", time: "2024-03-09 22:15", pair: "ADA/USDT", side: "Sell", price: 0.635, amount: 5000, status: "Cancelled" },
  { id: "6", time: "2024-03-09 18:30", pair: "BTC/USDT", side: "Buy", price: 66800, amount: 0.25, status: "Filled" },
  { id: "7", time: "2024-03-09 15:12", pair: "ETH/USDT", side: "Buy", price: 3480, amount: 5, status: "Filled" },
  { id: "8", time: "2024-03-09 09:45", pair: "SOL/USDT", side: "Sell", price: 172, amount: 20, status: "Filled" },
];

export const recentActivity: Activity[] = [
  { id: "1", type: "Buy", asset: "BTC", amount: "+0.15 BTC", time: "2 hours ago" },
  { id: "2", type: "Sell", asset: "ETH", amount: "-2.5 ETH", time: "3 hours ago" },
  { id: "3", type: "Deposit", asset: "USDT", amount: "+5,000 USDT", time: "5 hours ago" },
  { id: "4", type: "Buy", asset: "SOL", amount: "+10 SOL", time: "6 hours ago" },
];

export const marketMovers = [
  { symbol: "SOL", name: "Solana", change: 5.67 },
  { symbol: "BTC", name: "Bitcoin", change: 2.34 },
  { symbol: "XRP", name: "XRP", change: 1.21 },
  { symbol: "ADA", name: "Cardano", change: -2.45 },
  { symbol: "ETH", name: "Ethereum", change: -1.12 },
];

export const automationFeatures = [
  { title: "Auto Rebalancing", description: "Automatically rebalance your portfolio based on target allocations and drift thresholds." },
  { title: "Strategy Engine", description: "Create and backtest custom trading strategies with technical indicators." },
  { title: "DCA Automation", description: "Set up recurring purchases on a schedule to dollar-cost average into positions." },
  { title: "AI Portfolio Advisor", description: "Get AI-powered suggestions for portfolio optimization based on market conditions." },
  { title: "Risk Management", description: "Configure stop-loss, take-profit, and trailing stop orders automatically." },
];

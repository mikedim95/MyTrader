import { getDashboardData } from "../portfolioService.js";
import { allocationFromAssetValues } from "./asset-groups.js";
import { PortfolioState } from "./types.js";
import { normalizeAllocation } from "./allocation-utils.js";

export async function getLivePortfolioState(baseCurrency = "USDC"): Promise<PortfolioState> {
  const dashboard = await getDashboardData();

  const assets = dashboard.assets.map((asset) => ({
    symbol: asset.symbol.toUpperCase(),
    quantity: asset.balance,
    price: asset.price,
    value: asset.value,
    allocation: asset.allocation,
    change24h: asset.change24h,
    volume24h: asset.volume24h,
  }));

  const inferredAllocation =
    assets.length > 0
      ? allocationFromAssetValues(assets.map((asset) => ({ symbol: asset.symbol, value: asset.value })))
      : {};

  const allocation =
    assets.length > 0
      ? normalizeAllocation(
          assets.reduce<Record<string, number>>((acc, asset) => {
            acc[asset.symbol] = asset.allocation;
            return acc;
          }, {}),
          Object.keys(inferredAllocation)
        )
      : normalizeAllocation({ [baseCurrency]: 100 });

  return {
    timestamp: dashboard.generatedAt,
    baseCurrency,
    totalValue: dashboard.totalPortfolioValue,
    assets,
    allocation,
  };
}

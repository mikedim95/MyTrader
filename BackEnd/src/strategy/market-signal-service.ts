import { MarketSignalSnapshot, PortfolioState } from "./types.js";
import { round } from "./allocation-utils.js";

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

export function buildMarketSignalsFromPortfolio(portfolio: PortfolioState): MarketSignalSnapshot {
  const nonStableAssets = portfolio.assets.filter((asset) => !["USDC", "USDT", "BUSD", "DAI", "FDUSD"].includes(asset.symbol));

  const changeValues = nonStableAssets
    .map((asset) => (asset.change24h ?? 0) / 100)
    .filter((value) => Number.isFinite(value));

  const volatility = standardDeviation(changeValues);
  const marketDirectionRaw = average(changeValues);
  const marketDirection = marketDirectionRaw > 0.002 ? 1 : marketDirectionRaw < -0.002 ? -1 : 0;

  const btcAsset = portfolio.assets.find((asset) => asset.symbol === "BTC");
  const nonStableTotalValue = nonStableAssets.reduce((sum, asset) => sum + asset.value, 0);
  const btcDominance =
    !btcAsset || nonStableTotalValue <= 0 ? 0.5 : btcAsset.value / Math.max(1, nonStableTotalValue);

  const averageVolume = average(portfolio.assets.map((asset) => asset.volume24h ?? 0));

  const assetIndicators = portfolio.assets.reduce<MarketSignalSnapshot["assetIndicators"]>((acc, asset) => {
    const priceChange = (asset.change24h ?? 0) / 100;
    const volumeChange = averageVolume > 0 ? ((asset.volume24h ?? 0) - averageVolume) / averageVolume : 0;

    acc[asset.symbol] = {
      asset_trend: round(Math.sign(priceChange), 4),
      price_change_24h: round(priceChange, 6),
      volume_change: round(volumeChange, 6),
      asset_weight: round((portfolio.allocation[asset.symbol] ?? 0) / 100, 6),
    };

    return acc;
  }, {});

  return {
    timestamp: new Date().toISOString(),
    indicators: {
      volatility: round(volatility, 6),
      btc_dominance: round(btcDominance, 6),
      market_direction: marketDirection,
      portfolio_drift: 0,
    },
    assetIndicators,
  };
}

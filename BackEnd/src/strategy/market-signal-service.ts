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
  const rankedNonStable = [...nonStableAssets]
    .map((asset) => ({
      symbol: asset.symbol,
      priceChange: (asset.change24h ?? 0) / 100,
    }))
    .sort((left, right) => {
      if (right.priceChange !== left.priceChange) return right.priceChange - left.priceChange;
      return left.symbol.localeCompare(right.symbol);
    });

  const relativeStrengthBySymbol: Record<string, number> = {};
  const rankDenominator = Math.max(1, rankedNonStable.length - 1);
  rankedNonStable.forEach((entry, index) => {
    const score = rankedNonStable.length <= 1 ? 1 : (rankDenominator - index) / rankDenominator;
    relativeStrengthBySymbol[entry.symbol] = round(score, 6);
  });

  const assetIndicators = portfolio.assets.reduce<MarketSignalSnapshot["assetIndicators"]>((acc, asset) => {
    const priceChange = (asset.change24h ?? 0) / 100;
    const volumeChange = averageVolume > 0 ? ((asset.volume24h ?? 0) - averageVolume) / averageVolume : 0;
    const drawdown = Math.max(0, -priceChange);

    acc[asset.symbol] = {
      asset_trend: round(Math.sign(priceChange), 4),
      price_change_24h: round(priceChange, 6),
      volume_change: round(volumeChange, 6),
      asset_weight: round((portfolio.allocation[asset.symbol] ?? 0) / 100, 6),
      relative_strength: relativeStrengthBySymbol[asset.symbol] ?? 0.5,
      drawdown_pct: round(drawdown, 6),
    };

    return acc;
  }, {});

  const drawdownValues = nonStableAssets.map((asset) => Math.max(0, -((asset.change24h ?? 0) / 100)));
  const drawdownPct = average(drawdownValues);

  return {
    timestamp: new Date().toISOString(),
    indicators: {
      volatility: round(volatility, 6),
      btc_dominance: round(btcDominance, 6),
      market_direction: marketDirection,
      portfolio_drift: 0,
      drawdown_pct: round(drawdownPct, 6),
    },
    assetIndicators,
  };
}

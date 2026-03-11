import { StrategyConfig } from "./types.js";
import { validateStrategyDsl } from "./strategy-dsl-parser.js";

const presetInputs: unknown[] = [
  {
    id: "volatility-hedge",
    name: "Volatility Hedge",
    description: "Reduce risk during elevated volatility by shifting from altcoins into stablecoins.",
    executionMode: "manual",
    scheduleInterval: "30m",
    isEnabled: false,
    baseAllocation: {
      BTC: 40,
      ETH: 25,
      BNB: 10,
      SOL: 10,
      USDC: 15,
    },
    rules: [
      {
        id: "volatility-high-shift",
        name: "High Volatility Defensive Shift",
        priority: 1,
        enabled: true,
        condition: {
          indicator: "volatility",
          operator: ">",
          value: 0.05,
        },
        action: {
          type: "shift",
          from: "ALTCOINS",
          to: "USDC",
          percent: 10,
        },
      },
      {
        id: "volatility-extreme-shift",
        name: "Extreme Volatility Flight to Stablecoins",
        priority: 2,
        enabled: true,
        condition: {
          indicator: "volatility",
          operator: ">=",
          value: 0.08,
        },
        action: {
          type: "increase_stablecoin_exposure",
          percent: 8,
        },
      },
    ],
    guards: {
      max_single_asset_pct: 50,
      min_stablecoin_pct: 20,
      max_trades_per_cycle: 5,
      min_trade_notional: 25,
      cash_reserve_pct: 10,
    },
    metadata: {
      riskLevel: "low",
      expectedTurnover: "medium",
      stablecoinExposure: "high",
      tags: ["defensive", "volatility"],
    },
  },
  {
    id: "btc-dominance-rotation",
    name: "BTC Dominance Rotation",
    description: "Rotate exposure between BTC and altcoins based on BTC dominance regimes.",
    executionMode: "semi_auto",
    scheduleInterval: "1h",
    isEnabled: false,
    baseAllocation: {
      BTC: 45,
      ETH: 25,
      SOL: 10,
      BNB: 10,
      USDC: 10,
    },
    rules: [
      {
        id: "dominance-breakout",
        name: "Dominance Breakout",
        priority: 1,
        enabled: true,
        condition: {
          indicator: "btc_dominance",
          operator: ">",
          value: 0.55,
        },
        action: {
          type: "increase",
          asset: "BTC",
          percent: 5,
        },
      },
      {
        id: "dominance-weakening",
        name: "Dominance Weakening",
        priority: 2,
        enabled: true,
        condition: {
          indicator: "btc_dominance",
          operator: "<",
          value: 0.45,
        },
        action: {
          type: "shift",
          from: "BTC",
          to: "ALTCOINS",
          percent: 5,
        },
      },
    ],
    guards: {
      max_single_asset_pct: 60,
      min_stablecoin_pct: 10,
      max_trades_per_cycle: 6,
      min_trade_notional: 25,
      cash_reserve_pct: 8,
    },
    metadata: {
      riskLevel: "medium",
      expectedTurnover: "medium",
      stablecoinExposure: "medium",
      tags: ["rotation", "btc-dominance"],
    },
  },
  {
    id: "momentum-rotation",
    name: "Momentum Rotation",
    description: "Modestly overweight stronger assets and trim weakening assets.",
    executionMode: "semi_auto",
    scheduleInterval: "1h",
    isEnabled: false,
    baseAllocation: {
      BTC: 35,
      ETH: 30,
      SOL: 10,
      BNB: 10,
      ADA: 5,
      USDC: 10,
    },
    rules: [
      {
        id: "btc-momentum-up",
        name: "BTC Positive Momentum",
        priority: 1,
        enabled: true,
        condition: {
          indicator: "asset_trend",
          operator: ">",
          value: 0,
          asset: "BTC",
        },
        action: {
          type: "increase",
          asset: "BTC",
          percent: 3,
        },
      },
      {
        id: "eth-momentum-up",
        name: "ETH Positive Momentum",
        priority: 2,
        enabled: true,
        condition: {
          indicator: "asset_trend",
          operator: ">",
          value: 0,
          asset: "ETH",
        },
        action: {
          type: "increase",
          asset: "ETH",
          percent: 3,
        },
      },
      {
        id: "alt-momentum-down",
        name: "Altcoin Weak Momentum",
        priority: 3,
        enabled: true,
        condition: {
          indicator: "market_direction",
          operator: "<",
          value: 0,
        },
        action: {
          type: "reduce_altcoin_exposure",
          percent: 3,
        },
      },
    ],
    guards: {
      max_single_asset_pct: 55,
      min_stablecoin_pct: 10,
      max_trades_per_cycle: 8,
      min_trade_notional: 20,
      cash_reserve_pct: 8,
    },
    metadata: {
      riskLevel: "high",
      expectedTurnover: "high",
      stablecoinExposure: "low",
      tags: ["momentum", "rotation"],
    },
  },
  {
    id: "mean-reversion",
    name: "Mean Reversion",
    description: "Trim overextended moves and add to oversold majors.",
    executionMode: "semi_auto",
    scheduleInterval: "1h",
    isEnabled: false,
    baseAllocation: {
      BTC: 35,
      ETH: 25,
      BNB: 10,
      SOL: 10,
      USDC: 20,
    },
    rules: [
      {
        id: "btc-overextended",
        name: "BTC Overextended",
        priority: 1,
        enabled: true,
        condition: {
          indicator: "price_change_24h",
          operator: ">",
          value: 0.06,
          asset: "BTC",
        },
        action: {
          type: "decrease",
          asset: "BTC",
          percent: 3,
        },
      },
      {
        id: "btc-oversold",
        name: "BTC Oversold",
        priority: 2,
        enabled: true,
        condition: {
          indicator: "price_change_24h",
          operator: "<",
          value: -0.06,
          asset: "BTC",
        },
        action: {
          type: "increase",
          asset: "BTC",
          percent: 3,
        },
      },
      {
        id: "eth-overextended",
        name: "ETH Overextended",
        priority: 3,
        enabled: true,
        condition: {
          indicator: "price_change_24h",
          operator: ">",
          value: 0.07,
          asset: "ETH",
        },
        action: {
          type: "decrease",
          asset: "ETH",
          percent: 3,
        },
      },
      {
        id: "eth-oversold",
        name: "ETH Oversold",
        priority: 4,
        enabled: true,
        condition: {
          indicator: "price_change_24h",
          operator: "<",
          value: -0.07,
          asset: "ETH",
        },
        action: {
          type: "increase",
          asset: "ETH",
          percent: 3,
        },
      },
    ],
    guards: {
      max_single_asset_pct: 55,
      min_stablecoin_pct: 12,
      max_trades_per_cycle: 8,
      min_trade_notional: 20,
      cash_reserve_pct: 10,
    },
    metadata: {
      riskLevel: "medium",
      expectedTurnover: "medium",
      stablecoinExposure: "medium",
      tags: ["mean-reversion"],
    },
  },
  {
    id: "periodic-rebalancing",
    name: "Periodic Rebalancing",
    description: "Hold strategic target weights and rebalance at fixed intervals.",
    executionMode: "semi_auto",
    scheduleInterval: "4h",
    isEnabled: false,
    baseAllocation: {
      BTC: 45,
      ETH: 25,
      BNB: 10,
      SOL: 5,
      USDC: 15,
    },
    rules: [],
    guards: {
      max_single_asset_pct: 55,
      min_stablecoin_pct: 12,
      max_trades_per_cycle: 10,
      min_trade_notional: 20,
      cash_reserve_pct: 10,
    },
    metadata: {
      riskLevel: "low",
      expectedTurnover: "low",
      stablecoinExposure: "medium",
      tags: ["periodic", "rebalance"],
    },
  },
  {
    id: "relative-strength-rotation",
    name: "Relative Strength Rotation",
    description: "Rotate exposure toward stronger assets and trim weaker ones.",
    executionMode: "semi_auto",
    scheduleInterval: "1h",
    isEnabled: false,
    baseAllocation: {
      BTC: 35,
      ETH: 25,
      BNB: 10,
      SOL: 15,
      USDC: 15,
    },
    rules: [
      {
        id: "strongest-asset-boost",
        name: "Strongest Asset Boost",
        priority: 1,
        enabled: true,
        condition: {
          indicator: "relative_strength",
          operator: ">",
          value: 0.7,
          asset: "STRONGEST_ASSET",
        },
        action: {
          type: "increase",
          asset: "STRONGEST_ASSET",
          percent: 5,
        },
      },
      {
        id: "weakest-asset-trim",
        name: "Weakest Asset Reduction",
        priority: 2,
        enabled: true,
        condition: {
          indicator: "relative_strength",
          operator: "<",
          value: 0.3,
          asset: "WEAKEST_ASSET",
        },
        action: {
          type: "decrease",
          asset: "WEAKEST_ASSET",
          percent: 4,
        },
      },
    ],
    guards: {
      max_single_asset_pct: 55,
      min_stablecoin_pct: 10,
      max_trades_per_cycle: 8,
      min_trade_notional: 20,
      cash_reserve_pct: 8,
    },
    metadata: {
      riskLevel: "high",
      expectedTurnover: "high",
      stablecoinExposure: "low",
      tags: ["rotation", "relative-strength"],
    },
  },
  {
    id: "drawdown-protection",
    name: "Drawdown Protection",
    description: "Defensive overlay that reduces risk when drawdown accelerates.",
    executionMode: "manual",
    scheduleInterval: "30m",
    isEnabled: false,
    baseAllocation: {
      BTC: 40,
      ETH: 25,
      BNB: 10,
      SOL: 10,
      USDC: 15,
    },
    rules: [
      {
        id: "moderate-drawdown-defense",
        name: "Moderate Drawdown Defense",
        priority: 1,
        enabled: true,
        condition: {
          indicator: "drawdown_pct",
          operator: ">",
          value: 0.1,
        },
        action: {
          type: "shift",
          from: "ALTCOINS",
          to: "USDC",
          percent: 8,
        },
      },
      {
        id: "severe-drawdown-defense",
        name: "Severe Drawdown Defense",
        priority: 2,
        enabled: true,
        condition: {
          indicator: "drawdown_pct",
          operator: ">",
          value: 0.2,
        },
        action: {
          type: "increase_stablecoin_exposure",
          percent: 15,
        },
      },
    ],
    guards: {
      max_single_asset_pct: 50,
      min_stablecoin_pct: 20,
      max_trades_per_cycle: 5,
      min_trade_notional: 25,
      cash_reserve_pct: 12,
    },
    metadata: {
      riskLevel: "low",
      expectedTurnover: "medium",
      stablecoinExposure: "high",
      tags: ["defensive", "drawdown"],
    },
  },
];

export function buildPresetStrategies(nowIso = new Date().toISOString()): StrategyConfig[] {
  const presets: StrategyConfig[] = [];

  for (const input of presetInputs) {
    const validated = validateStrategyDsl(input, nowIso);
    if (validated.success && validated.data) {
      presets.push({
        ...validated.data,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
  }

  return presets;
}

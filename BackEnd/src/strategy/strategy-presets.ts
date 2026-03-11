import { StrategyConfig } from "./types.js";
import { validateStrategyDsl } from "./strategy-dsl-parser.js";

const presetInputs: unknown[] = [
  {
    id: "volatility-hedge",
    name: "Volatility Hedge",
    description: "Reduce risk during elevated volatility by shifting from altcoins into stablecoins.",
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
    executionMode: "manual",
    metadata: {
      riskLevel: "low",
      expectedTurnover: "medium",
      stablecoinExposure: "high",
      tags: ["defensive", "volatility"],
    },
    isEnabled: false,
    scheduleInterval: "30m",
  },
  {
    id: "btc-dominance-rotation",
    name: "BTC Dominance Rotation",
    description: "Rotate exposure between BTC and altcoins based on BTC dominance regimes.",
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
    executionMode: "semi_auto",
    metadata: {
      riskLevel: "medium",
      expectedTurnover: "medium",
      stablecoinExposure: "medium",
      tags: ["rotation", "btc-dominance"],
    },
    isEnabled: false,
    scheduleInterval: "1h",
  },
  {
    id: "momentum-rotation",
    name: "Momentum Rotation",
    description: "Modestly overweight stronger assets and trim weakening assets.",
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
    executionMode: "semi_auto",
    metadata: {
      riskLevel: "high",
      expectedTurnover: "high",
      stablecoinExposure: "low",
      tags: ["momentum", "rotation"],
    },
    isEnabled: false,
    scheduleInterval: "1h",
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

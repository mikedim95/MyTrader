import type { ProcessedTradeSignal } from "../signals/signalProcessor.js";

export interface PortfolioPosition {
  symbol: string;
  size: number;
  avgEntry: number;
}

export interface PortfolioSnapshot {
  balanceUSD: number;
  startingBalanceUSD: number;
  totalEquityUSD: number;
  positions: PortfolioPosition[];
}

export interface RecentExecutionSignal {
  symbol: string;
  action: "buy" | "sell";
  fingerprint: string;
  timestamp: string;
  status: "filled" | "blocked";
}

export interface GuardrailEvaluation {
  allowed: boolean;
  reason?: string;
  reasons: string[];
  triggered: string[];
}

export interface GuardrailContext {
  marketPrice: number;
  proposedSize: number;
  proposedNotionalUSD: number;
  dailyLossPercent: number;
  recentSignals: RecentExecutionSignal[];
  now?: string;
}

const MAX_POSITION_PER_ASSET_PCT = 20;
const MAX_DAILY_LOSS_PCT = 5;
const COOLDOWN_MS = 2 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 60 * 1000;
const EPSILON = 1e-8;

function findPosition(symbol: string, portfolio: PortfolioSnapshot): PortfolioPosition | null {
  return portfolio.positions.find((position) => position.symbol === symbol) ?? null;
}

function isWithinWindow(timestamp: string, nowMs: number, windowMs: number): boolean {
  const parsedMs = new Date(timestamp).getTime();
  return Number.isFinite(parsedMs) && nowMs - parsedMs <= windowMs;
}

export function evaluateGuardrails(
  signal: ProcessedTradeSignal,
  portfolio: PortfolioSnapshot,
  context: GuardrailContext,
): GuardrailEvaluation {
  const reasons: string[] = [];
  const triggered: string[] = [];
  const nowMs = new Date(context.now ?? new Date().toISOString()).getTime();
  const currentPosition = findPosition(signal.symbol, portfolio);
  const currentPositionValue = (currentPosition?.size ?? 0) * context.marketPrice;

  if (context.dailyLossPercent >= MAX_DAILY_LOSS_PCT) {
    reasons.push(`Daily loss guardrail hit: ${context.dailyLossPercent.toFixed(2)}% exceeds the 5.00% limit.`);
    triggered.push("max_daily_loss");
  }

  const duplicateSignal = context.recentSignals.find(
    (entry) => entry.fingerprint === signal.fingerprint && isWithinWindow(entry.timestamp, nowMs, DUPLICATE_WINDOW_MS),
  );
  if (duplicateSignal) {
    reasons.push("Duplicate signal detected within the short protection window.");
    triggered.push("duplicate_signal");
  }

  const cooldownHit = context.recentSignals.find(
    (entry) => entry.symbol === signal.symbol && isWithinWindow(entry.timestamp, nowMs, COOLDOWN_MS),
  );
  if (cooldownHit) {
    reasons.push("Symbol cooldown is active for 2 minutes after the most recent processed signal.");
    triggered.push("symbol_cooldown");
  }

  if (signal.action === "buy") {
    if (context.proposedNotionalUSD > portfolio.balanceUSD + EPSILON) {
      reasons.push("Paper cash balance is not sufficient for the simulated buy size.");
      triggered.push("insufficient_cash");
    }

    const projectedExposurePct =
      portfolio.totalEquityUSD > 0
        ? ((currentPositionValue + context.proposedNotionalUSD) / portfolio.totalEquityUSD) * 100
        : 100;
    if (projectedExposurePct > MAX_POSITION_PER_ASSET_PCT + EPSILON) {
      reasons.push(
        `Projected ${signal.symbol} exposure would reach ${projectedExposurePct.toFixed(2)}%, above the 20.00% asset cap.`,
      );
      triggered.push("max_position_per_asset");
    }
  }

  if (signal.action === "sell") {
    if (!currentPosition || currentPosition.size <= EPSILON) {
      reasons.push(`No ${signal.symbol} position is available to sell in the paper portfolio.`);
      triggered.push("no_position");
    } else if (context.proposedSize > currentPosition.size + EPSILON) {
      reasons.push(`Sell size exceeds the available ${signal.symbol} paper position.`);
      triggered.push("insufficient_position");
    }
  }

  return {
    allowed: reasons.length === 0,
    reason: reasons[0],
    reasons,
    triggered,
  };
}

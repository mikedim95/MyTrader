import { createHash } from "node:crypto";
import { z } from "zod";

export const EXECUTION_SUPPORTED_SYMBOLS = ["BTC-USD"] as const;

export type ExecutionSupportedSymbol = (typeof EXECUTION_SUPPORTED_SYMBOLS)[number];
export type TradeSignalAction = "buy" | "sell";

export type TradeSignal = {
  id: string;
  symbol: ExecutionSupportedSymbol;
  action: TradeSignalAction;
  confidence: number;
  reason: string;
  timestamp: string;
};

export interface ProcessedTradeSignal extends TradeSignal {
  signalType: string;
  fingerprint: string;
}

function normalizeTimestamp(value: string, ctx: z.RefinementCtx): string {
  const normalized = value.trim();
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "timestamp must be a valid ISO date string.",
    });
    return z.NEVER;
  }

  return parsed.toISOString();
}

function normalizeReason(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 280);
}

function toSignalType(reason: string): string {
  const normalized = reason
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);

  return normalized || "manual_signal";
}

function buildFingerprint(symbol: string, action: TradeSignalAction, reason: string): string {
  return createHash("sha256").update(`${symbol}|${action}|${reason.toLowerCase()}`).digest("hex").slice(0, 24);
}

export const tradeSignalSchema = z.object({
  id: z.string().trim().min(1).max(64),
  symbol: z.enum(EXECUTION_SUPPORTED_SYMBOLS),
  action: z.enum(["buy", "sell"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().min(3).max(280),
  timestamp: z.string().transform((value, ctx) => normalizeTimestamp(value, ctx)),
});

export class SignalProcessor {
  prepare(signal: TradeSignal): ProcessedTradeSignal {
    const normalizedReason = normalizeReason(signal.reason);
    const signalType = toSignalType(normalizedReason);

    return {
      ...signal,
      reason: normalizedReason,
      signalType,
      fingerprint: buildFingerprint(signal.symbol, signal.action, normalizedReason),
    };
  }
}

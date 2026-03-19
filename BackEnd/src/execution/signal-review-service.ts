import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import pool from "../db.js";
import type {
  DecisionMarketRegime,
  DecisionRecommendation,
} from "../decision/decision-service.js";
import {
  mapBiasToCurrentState,
  type BtcNewsCurrentState,
} from "../news/news-service.js";
import { getTickerSnapshot } from "../portfolioService.js";
import type { HistoricalCandleProvider, PortfolioAccountType } from "../strategy/types.js";
import type { StrategyUserScope } from "../strategy/strategy-user-scope.js";

export type ExecutionGuardrailStatus = "allowed" | "reduced" | "blocked";
export type SignalAction = "buy" | "sell" | "hold";

export interface CreateSignalOutcomeInput {
  accountType: PortfolioAccountType;
  asset: string;
  technicalScore: number;
  newsScore: number;
  finalScore: number;
  recommendation: DecisionRecommendation;
  confidence: number;
  marketRegime: DecisionMarketRegime;
  actionTaken: SignalAction;
  requestedSize: number;
  adjustedSize: number | null;
  guardrailStatus: ExecutionGuardrailStatus;
  newsBias1h?: number | null;
  currentBtcExposurePct?: number | null;
  priceAtSignal?: number | null;
  reasons: string[];
  triggeredGuardrails: string[];
}

export interface SignalReviewMetricGroup {
  key: string;
  label: string;
  reviewed_count: number;
  win_rate: number;
}

export interface SignalReviewSummary {
  average_helpfulness: number | null;
  total_signals: number;
  reviewed_signal_count: number;
  pending_review_count: number;
  win_rate_by_recommendation: SignalReviewMetricGroup[];
  win_rate_by_regime: SignalReviewMetricGroup[];
  win_rate_by_news_state: SignalReviewMetricGroup[];
}

export interface SignalReviewItem {
  id: string;
  created_at: string;
  account_type: PortfolioAccountType;
  asset: string;
  technical_score: number;
  news_score: number;
  final_score: number;
  recommendation: DecisionRecommendation;
  confidence: number;
  market_regime: DecisionMarketRegime;
  action_taken: SignalAction;
  requested_size: number | null;
  adjusted_size: number | null;
  guardrail_status: ExecutionGuardrailStatus;
  news_state: BtcNewsCurrentState;
  price_at_signal: number | null;
  price_after_1h: number | null;
  price_after_6h: number | null;
  price_after_24h: number | null;
  pnl_after_1h: number | null;
  pnl_after_6h: number | null;
  pnl_after_24h: number | null;
  was_helpful_1h: boolean | null;
  was_helpful_6h: boolean | null;
  was_helpful_24h: boolean | null;
  reasons: string[];
  triggered_guardrails: string[];
}

export interface SignalReviewResponse {
  summary: SignalReviewSummary;
  signals: SignalReviewItem[];
  generated_at: string;
}

interface SignalOutcomeRow extends RowDataPacket {
  id: string;
  user_id: number | null;
  username: string | null;
  account_type: string | null;
  created_at: string | null;
  asset: string | null;
  technical_score: number | string | null;
  news_score: number | string | null;
  final_score: number | string | null;
  recommendation: string | null;
  confidence: number | string | null;
  market_regime: string | null;
  action_taken: string | null;
  requested_size: number | string | null;
  adjusted_size: number | string | null;
  guardrail_status: string | null;
  news_bias_1h: number | string | null;
  current_btc_exposure_pct: number | string | null;
  price_at_signal: number | string | null;
  price_after_1h: number | string | null;
  price_after_6h: number | string | null;
  price_after_24h: number | string | null;
  pnl_after_1h: number | string | null;
  pnl_after_6h: number | string | null;
  pnl_after_24h: number | string | null;
  was_helpful_1h: number | boolean | null;
  was_helpful_6h: number | boolean | null;
  was_helpful_24h: number | boolean | null;
  reasons_json: string | null;
  triggered_guardrails_json: string | null;
}

interface SignalActionAtRow extends RowDataPacket {
  created_at: string | null;
}

interface TurnoverRow extends RowDataPacket {
  turnover: number | string | null;
}

const HOUR_MS = 60 * 60 * 1000;
const MAX_REVIEW_BACKFILL_ROWS = 30;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toNumber(value: number | string | null | undefined, digits = 4): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function toNullableNumber(value: number | string | null | undefined, digits = 4): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function toNullableBoolean(value: number | boolean | null | undefined): boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return Number(value) === 1;
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeJsonStringArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
  } catch {
    return [];
  }
}

function normalizeAction(value: string | null | undefined): SignalAction {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "buy" || normalized === "sell" || normalized === "hold") {
    return normalized;
  }
  return "hold";
}

function normalizeGuardrailStatus(value: string | null | undefined): ExecutionGuardrailStatus {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "allowed" || normalized === "reduced" || normalized === "blocked") {
    return normalized;
  }
  return "allowed";
}

function normalizeRecommendation(value: string | null | undefined): DecisionRecommendation {
  const normalized = (value ?? "").trim() as DecisionRecommendation;
  if (
    normalized === "buy_favorable" ||
    normalized === "mild_buy_favorable" ||
    normalized === "hold_neutral" ||
    normalized === "mild_sell_favorable" ||
    normalized === "sell_favorable"
  ) {
    return normalized;
  }

  return "hold_neutral";
}

function normalizeMarketRegime(value: string | null | undefined): DecisionMarketRegime {
  const normalized = (value ?? "").trim() as DecisionMarketRegime;
  if (
    normalized === "trend_up" ||
    normalized === "trend_down" ||
    normalized === "range" ||
    normalized === "uncertain"
  ) {
    return normalized;
  }

  return "uncertain";
}

function buildScopeWhereClause(scope?: StrategyUserScope, alias?: string): { clause: string; params: unknown[] } {
  const prefix = alias ? `${alias}.` : "";

  if (typeof scope?.userId === "number" && scope.userId > 0 && scope.username) {
    return {
      clause: `(${prefix}user_id = ? OR LOWER(COALESCE(${prefix}username, '')) = ?)`,
      params: [scope.userId, scope.username.trim().toLowerCase()],
    };
  }

  if (typeof scope?.userId === "number" && scope.userId > 0) {
    return {
      clause: `${prefix}user_id = ?`,
      params: [scope.userId],
    };
  }

  if (scope?.username) {
    return {
      clause: `LOWER(COALESCE(${prefix}username, '')) = ?`,
      params: [scope.username.trim().toLowerCase()],
    };
  }

  return {
    clause: "1 = 1",
    params: [],
  };
}

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveHelpfulOutcome(record: SignalReviewItem): boolean | null {
  if (record.was_helpful_24h !== null) return record.was_helpful_24h;
  if (record.was_helpful_6h !== null) return record.was_helpful_6h;
  if (record.was_helpful_1h !== null) return record.was_helpful_1h;
  return null;
}

function computeAlignedPnl(action: SignalAction, rawReturnPct: number): number {
  if (action === "buy") return round(rawReturnPct, 4);
  if (action === "sell") return round(-rawReturnPct, 4);
  return 0;
}

function computeHelpful(action: SignalAction, rawReturnPct: number): boolean {
  if (action === "buy") return rawReturnPct > 0;
  if (action === "sell") return rawReturnPct < 0;
  return Math.abs(rawReturnPct) <= 1;
}

function candlePrice(value: number | null | undefined): number | null {
  if (!Number.isFinite(Number(value))) {
    return null;
  }
  return round(Number(value), 8);
}

function pickPriceFromCandles(
  candles: Array<{ openTime: number; closeTime: number; close: number }>,
  targetTime: number
): number | null {
  if (candles.length === 0) {
    return null;
  }

  const containing = candles.find((candle) => candle.openTime <= targetTime && candle.closeTime >= targetTime);
  if (containing) {
    return candlePrice(containing.close);
  }

  const next = candles.find((candle) => candle.openTime >= targetTime);
  if (next) {
    return candlePrice(next.close);
  }

  const previous = [...candles].reverse().find((candle) => candle.closeTime <= targetTime);
  if (previous) {
    return candlePrice(previous.close);
  }

  return candlePrice(candles[candles.length - 1]?.close ?? null);
}

function mapSignalRow(row: SignalOutcomeRow): SignalReviewItem {
  const newsScore = toNumber(row.news_score);

  return {
    id: row.id,
    created_at: normalizeText(row.created_at) ?? new Date().toISOString(),
    account_type: row.account_type === "demo" ? "demo" : "real",
    asset: normalizeText(row.asset)?.toUpperCase() ?? "BTC",
    technical_score: toNumber(row.technical_score),
    news_score: newsScore,
    final_score: toNumber(row.final_score),
    recommendation: normalizeRecommendation(row.recommendation),
    confidence: toNumber(row.confidence, 4),
    market_regime: normalizeMarketRegime(row.market_regime),
    action_taken: normalizeAction(row.action_taken),
    requested_size: toNullableNumber(row.requested_size),
    adjusted_size: toNullableNumber(row.adjusted_size),
    guardrail_status: normalizeGuardrailStatus(row.guardrail_status),
    news_state: mapBiasToCurrentState(newsScore),
    price_at_signal: toNullableNumber(row.price_at_signal, 8),
    price_after_1h: toNullableNumber(row.price_after_1h, 8),
    price_after_6h: toNullableNumber(row.price_after_6h, 8),
    price_after_24h: toNullableNumber(row.price_after_24h, 8),
    pnl_after_1h: toNullableNumber(row.pnl_after_1h, 4),
    pnl_after_6h: toNullableNumber(row.pnl_after_6h, 4),
    pnl_after_24h: toNullableNumber(row.pnl_after_24h, 4),
    was_helpful_1h: toNullableBoolean(row.was_helpful_1h),
    was_helpful_6h: toNullableBoolean(row.was_helpful_6h),
    was_helpful_24h: toNullableBoolean(row.was_helpful_24h),
    reasons: normalizeJsonStringArray(row.reasons_json),
    triggered_guardrails: normalizeJsonStringArray(row.triggered_guardrails_json),
  };
}

export class SignalOutcomeService {
  constructor(private readonly candleProvider: HistoricalCandleProvider) {}

  async init(): Promise<void> {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS signal_outcomes (
        id VARCHAR(36) PRIMARY KEY,
        user_id INT NULL,
        username VARCHAR(191) NULL,
        account_type ENUM('real', 'demo') NOT NULL DEFAULT 'real',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        asset VARCHAR(32) NOT NULL,
        technical_score DECIMAL(10, 4) NOT NULL DEFAULT 0,
        news_score DECIMAL(10, 4) NOT NULL DEFAULT 0,
        final_score DECIMAL(10, 4) NOT NULL DEFAULT 0,
        recommendation VARCHAR(32) NOT NULL,
        confidence DECIMAL(10, 4) NOT NULL DEFAULT 0,
        market_regime VARCHAR(32) NOT NULL,
        action_taken VARCHAR(16) NOT NULL,
        requested_size DECIMAL(12, 4) NULL,
        adjusted_size DECIMAL(12, 4) NULL,
        guardrail_status VARCHAR(16) NOT NULL DEFAULT 'allowed',
        news_bias_1h DECIMAL(10, 4) NULL,
        current_btc_exposure_pct DECIMAL(10, 4) NULL,
        price_at_signal DECIMAL(20, 8) NULL,
        price_after_1h DECIMAL(20, 8) NULL,
        price_after_6h DECIMAL(20, 8) NULL,
        price_after_24h DECIMAL(20, 8) NULL,
        pnl_after_1h DECIMAL(12, 4) NULL,
        pnl_after_6h DECIMAL(12, 4) NULL,
        pnl_after_24h DECIMAL(12, 4) NULL,
        was_helpful_1h TINYINT(1) NULL,
        was_helpful_6h TINYINT(1) NULL,
        was_helpful_24h TINYINT(1) NULL,
        reasons_json JSON NULL,
        triggered_guardrails_json JSON NULL,
        INDEX idx_signal_outcomes_user_created (user_id, created_at),
        INDEX idx_signal_outcomes_username_created (username, created_at),
        INDEX idx_signal_outcomes_asset_created (asset, created_at),
        INDEX idx_signal_outcomes_account_created (account_type, created_at)
      )
    `);
  }

  async recordSignalOutcome(input: CreateSignalOutcomeInput, userScope?: StrategyUserScope): Promise<string> {
    const id = randomUUID();

    await pool.execute(
      `
        INSERT INTO signal_outcomes (
          id,
          user_id,
          username,
          account_type,
          asset,
          technical_score,
          news_score,
          final_score,
          recommendation,
          confidence,
          market_regime,
          action_taken,
          requested_size,
          adjusted_size,
          guardrail_status,
          news_bias_1h,
          current_btc_exposure_pct,
          price_at_signal,
          reasons_json,
          triggered_guardrails_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        userScope?.userId ?? null,
        userScope?.username?.trim().toLowerCase() ?? null,
        input.accountType,
        input.asset.trim().toUpperCase(),
        round(input.technicalScore, 4),
        round(input.newsScore, 4),
        round(input.finalScore, 4),
        input.recommendation,
        round(input.confidence, 4),
        input.marketRegime,
        input.actionTaken,
        round(input.requestedSize, 4),
        input.adjustedSize === null ? null : round(input.adjustedSize, 4),
        input.guardrailStatus,
        input.newsBias1h === null || input.newsBias1h === undefined ? null : round(input.newsBias1h, 4),
        input.currentBtcExposurePct === null || input.currentBtcExposurePct === undefined
          ? null
          : round(input.currentBtcExposurePct, 4),
        input.priceAtSignal === null || input.priceAtSignal === undefined ? null : round(input.priceAtSignal, 8),
        JSON.stringify(input.reasons),
        JSON.stringify(input.triggeredGuardrails),
      ]
    );

    return id;
  }

  async getMostRecentActionAt(
    asset: string,
    accountType: PortfolioAccountType,
    userScope?: StrategyUserScope
  ): Promise<string | null> {
    const scopeFilter = buildScopeWhereClause(userScope);
    const [rows] = await pool.query<SignalActionAtRow[]>(
      `
        SELECT created_at
        FROM signal_outcomes
        WHERE ${scopeFilter.clause}
          AND account_type = ?
          AND asset = ?
          AND action_taken <> 'hold'
          AND guardrail_status <> 'blocked'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [...scopeFilter.params, accountType, asset.trim().toUpperCase()]
    );

    return normalizeText(rows[0]?.created_at);
  }

  async getDailyTurnoverPct(accountType: PortfolioAccountType, sinceIso: string, userScope?: StrategyUserScope): Promise<number> {
    const scopeFilter = buildScopeWhereClause(userScope);
    const [rows] = await pool.query<TurnoverRow[]>(
      `
        SELECT COALESCE(SUM(COALESCE(adjusted_size, requested_size, 0)), 0) AS turnover
        FROM signal_outcomes
        WHERE ${scopeFilter.clause}
          AND account_type = ?
          AND created_at >= ?
          AND action_taken <> 'hold'
          AND guardrail_status <> 'blocked'
      `,
      [...scopeFilter.params, accountType, sinceIso]
    );

    return toNumber(rows[0]?.turnover);
  }

  async getSignalReview(
    accountType: PortfolioAccountType = "real",
    limit = 25,
    userScope?: StrategyUserScope
  ): Promise<SignalReviewResponse> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const signals = await this.listSignals(accountType, safeLimit, userScope);
    const refreshable = signals.slice(0, MAX_REVIEW_BACKFILL_ROWS);

    if (refreshable.length > 0) {
      await this.refreshPendingOutcomes(refreshable);
    }

    const refreshedSignals = await this.listSignals(accountType, safeLimit, userScope);

    return {
      summary: this.buildSummary(refreshedSignals),
      signals: refreshedSignals,
      generated_at: new Date().toISOString(),
    };
  }

  private async listSignals(
    accountType: PortfolioAccountType,
    limit: number,
    userScope?: StrategyUserScope
  ): Promise<SignalReviewItem[]> {
    const scopeFilter = buildScopeWhereClause(userScope);
    const [rows] = await pool.query<SignalOutcomeRow[]>(
      `
        SELECT
          id,
          user_id,
          username,
          account_type,
          created_at,
          asset,
          technical_score,
          news_score,
          final_score,
          recommendation,
          confidence,
          market_regime,
          action_taken,
          requested_size,
          adjusted_size,
          guardrail_status,
          news_bias_1h,
          current_btc_exposure_pct,
          price_at_signal,
          price_after_1h,
          price_after_6h,
          price_after_24h,
          pnl_after_1h,
          pnl_after_6h,
          pnl_after_24h,
          was_helpful_1h,
          was_helpful_6h,
          was_helpful_24h,
          reasons_json,
          triggered_guardrails_json
        FROM signal_outcomes
        WHERE ${scopeFilter.clause}
          AND account_type = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
      [...scopeFilter.params, accountType, limit]
    );

    return rows.map(mapSignalRow);
  }

  private async refreshPendingOutcomes(signals: SignalReviewItem[]): Promise<void> {
    const now = Date.now();

    for (const signal of signals) {
      const signalTime = new Date(signal.created_at).getTime();
      if (!Number.isFinite(signalTime)) {
        continue;
      }

      const maturities = [
        { key: "1h", ms: HOUR_MS, price: signal.price_after_1h, helpful: signal.was_helpful_1h },
        { key: "6h", ms: 6 * HOUR_MS, price: signal.price_after_6h, helpful: signal.was_helpful_6h },
        { key: "24h", ms: 24 * HOUR_MS, price: signal.price_after_24h, helpful: signal.was_helpful_24h },
      ];
      const needsRefresh = maturities.some(
        (entry) => signalTime + entry.ms <= now && (entry.price === null || entry.helpful === null)
      );

      if (!needsRefresh && signal.price_at_signal !== null) {
        continue;
      }

      const endTime = signalTime + 24 * HOUR_MS;
      try {
        const candles = await this.candleProvider.getCandles(signal.asset, "1h", signalTime, endTime);
        const basePrice = signal.price_at_signal ?? pickPriceFromCandles(candles, signalTime) ?? (await this.resolveLivePrice(signal.asset));
        if (!basePrice || basePrice <= 0) {
          continue;
        }

        const updates: Record<string, number | boolean | null> = {
          price_at_signal: round(basePrice, 8),
        };

        maturities.forEach((entry) => {
          if (signalTime + entry.ms > now) {
            return;
          }

          const targetPrice = pickPriceFromCandles(candles, signalTime + entry.ms);
          if (targetPrice === null || targetPrice <= 0) {
            return;
          }

          const rawReturnPct = ((targetPrice - basePrice) / basePrice) * 100;
          const pnl = computeAlignedPnl(signal.action_taken, rawReturnPct);
          const helpful = computeHelpful(signal.action_taken, rawReturnPct);

          if (entry.key === "1h") {
            updates.price_after_1h = round(targetPrice, 8);
            updates.pnl_after_1h = pnl;
            updates.was_helpful_1h = helpful;
          } else if (entry.key === "6h") {
            updates.price_after_6h = round(targetPrice, 8);
            updates.pnl_after_6h = pnl;
            updates.was_helpful_6h = helpful;
          } else {
            updates.price_after_24h = round(targetPrice, 8);
            updates.pnl_after_24h = pnl;
            updates.was_helpful_24h = helpful;
          }
        });

        await this.applyOutcomeUpdate(signal.id, updates);
      } catch {
        // Keep pending review fields null until price data becomes available.
      }
    }
  }

  private async resolveLivePrice(asset: string): Promise<number | null> {
    try {
      const ticker = await getTickerSnapshot(asset.trim().toUpperCase());
      return round(ticker.price, 8);
    } catch {
      return null;
    }
  }

  private async applyOutcomeUpdate(
    signalId: string,
    updates: Record<string, number | boolean | null>
  ): Promise<void> {
    const assignments = Object.keys(updates);
    if (assignments.length === 0) {
      return;
    }

    const sql = `
      UPDATE signal_outcomes
      SET ${assignments.map((column) => `${column} = ?`).join(", ")}
      WHERE id = ?
    `;
    const values = assignments.map((column) => {
      const value = updates[column];
      if (typeof value === "boolean") {
        return value ? 1 : 0;
      }
      return value;
    });

    await pool.execute(sql, [...values, signalId]);
  }

  private buildSummary(signals: SignalReviewItem[]): SignalReviewSummary {
    const helpfulnessValues = signals.flatMap((signal) =>
      [signal.was_helpful_1h, signal.was_helpful_6h, signal.was_helpful_24h].filter(
        (entry): entry is boolean => entry !== null
      )
    );
    const reviewedSignals = signals.filter((signal) => resolveHelpfulOutcome(signal) !== null);

    return {
      average_helpfulness:
        helpfulnessValues.length > 0
          ? round(helpfulnessValues.filter(Boolean).length / helpfulnessValues.length, 4)
          : null,
      total_signals: signals.length,
      reviewed_signal_count: reviewedSignals.length,
      pending_review_count: signals.filter((signal) => resolveHelpfulOutcome(signal) === null).length,
      win_rate_by_recommendation: this.buildMetricGroups(signals, (signal) => signal.recommendation),
      win_rate_by_regime: this.buildMetricGroups(signals, (signal) => signal.market_regime),
      win_rate_by_news_state: this.buildMetricGroups(signals, (signal) => signal.news_state),
    };
  }

  private buildMetricGroups(
    signals: SignalReviewItem[],
    keySelector: (signal: SignalReviewItem) => string
  ): SignalReviewMetricGroup[] {
    const groups = new Map<string, { reviewed: number; wins: number }>();

    signals.forEach((signal) => {
      const helpful = resolveHelpfulOutcome(signal);
      if (helpful === null) {
        return;
      }

      const key = keySelector(signal);
      const current = groups.get(key) ?? { reviewed: 0, wins: 0 };
      current.reviewed += 1;
      current.wins += helpful ? 1 : 0;
      groups.set(key, current);
    });

    return Array.from(groups.entries())
      .map(([key, value]) => ({
        key,
        label: titleCase(key),
        reviewed_count: value.reviewed,
        win_rate: value.reviewed > 0 ? round(value.wins / value.reviewed, 4) : 0,
      }))
      .sort((left, right) => {
        if (right.reviewed_count !== left.reviewed_count) {
          return right.reviewed_count - left.reviewed_count;
        }
        return left.label.localeCompare(right.label);
      });
  }
}

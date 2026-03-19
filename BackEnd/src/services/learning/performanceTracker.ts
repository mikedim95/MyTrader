import { randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "../../db.js";
import { strategyUserScopeKey, type StrategyUserScope } from "../../strategy/strategy-user-scope.js";
import { ExchangeMarketService } from "../exchanges/exchangeMarketService.js";
import { normalizeMarketSymbol, type SupportedMarketSymbol } from "../exchanges/types.js";
import type { PortfolioPosition, PortfolioSnapshot, RecentExecutionSignal } from "../risk/guardrails.js";
import type { SimulatedExecutionChunk } from "../execution/orderSimulator.js";
import type { ProcessedTradeSignal } from "../signals/signalProcessor.js";

export interface PaperPortfolioPosition extends PortfolioPosition {
  marketPrice: number;
  marketValue: number;
  allocationPercent: number;
}

export interface PaperPortfolioState extends PortfolioSnapshot {
  positions: PaperPortfolioPosition[];
  updatedAt: string;
}

export interface ExecutionHistoryItem {
  id: string;
  signalId: string;
  signalType: string;
  symbol: string;
  action: "buy" | "sell";
  confidence: number;
  reason: string;
  status: "filled" | "blocked";
  size: number;
  notionalUsd: number;
  avgPrice: number | null;
  referencePrice: number | null;
  slippage: number | null;
  method: string | null;
  blockReason: string | null;
  realizedPnl: number;
  pnl: number | null;
  returnPercent: number | null;
  latestOutcomeHorizon: "1h" | "24h" | null;
  createdAt: string;
}

export interface ExecutionHistoryResponse {
  executions: ExecutionHistoryItem[];
  portfolio: PaperPortfolioState;
  generatedAt: string;
}

export interface ExecutionPerformanceSummary {
  winRate: number;
  avgReturn: number;
  totalTrades: number;
  evaluatedTrades: number;
  realizedPnl: number;
}

export interface ExecutionPerformanceBreakdown extends ExecutionPerformanceSummary {
  key: string;
  label: string;
}

export interface ExecutionPerformanceResponse {
  summary: ExecutionPerformanceSummary;
  breakdown: ExecutionPerformanceBreakdown[];
  portfolio: PaperPortfolioState;
  generatedAt: string;
}

export interface BlockedExecutionRecordInput {
  signal: ProcessedTradeSignal;
  scope?: StrategyUserScope;
  size: number;
  notionalUsd: number;
  referencePrice: number;
  blockReason: string;
}

export interface FilledExecutionRecordInput {
  signal: ProcessedTradeSignal;
  scope?: StrategyUserScope;
  size: number;
  notionalUsd: number;
  avgPrice: number;
  referencePrice: number;
  slippage: number;
  method: string;
  executionTimeMs: number;
  chunks: SimulatedExecutionChunk[];
  realizedPnl: number;
}

interface PortfolioRow extends RowDataPacket {
  id: string;
  scope_key: string;
  user_id: number | null;
  username: string | null;
  starting_balance_usd: number | string;
  balance_usd: number | string;
  updated_at: string | Date | null;
}

interface PositionRow extends RowDataPacket {
  id: string;
  portfolio_id: string;
  symbol: string;
  size: number | string;
  avg_entry: number | string;
}

interface RecentExecutionRow extends RowDataPacket {
  symbol: string | null;
  action: string | null;
  fingerprint: string | null;
  status: string | null;
  created_at: string | Date | null;
}

interface HistoryRow extends RowDataPacket {
  id: string;
  signal_id: string;
  signal_type: string | null;
  symbol: string | null;
  action: string | null;
  confidence: number | string | null;
  reason: string | null;
  status: string | null;
  size: number | string | null;
  notional_usd: number | string | null;
  avg_price: number | string | null;
  reference_price: number | string | null;
  slippage: number | string | null;
  method: string | null;
  block_reason: string | null;
  realized_pnl: number | string | null;
  created_at: string | Date | null;
  pnl_1h: number | string | null;
  return_percent_1h: number | string | null;
  evaluated_at_1h: string | Date | null;
  pnl_24h: number | string | null;
  return_percent_24h: number | string | null;
  evaluated_at_24h: string | Date | null;
}

interface DueOutcomeRow extends RowDataPacket {
  id: string;
  horizon: string;
  symbol: string | null;
  action: string | null;
  size: number | string | null;
  avg_price: number | string | null;
}

interface ScoreRow extends RowDataPacket {
  score_key: string;
  label: string;
  total_trades: number | string;
  evaluated_trades: number | string;
  wins: number | string;
  win_rate: number | string;
  avg_return: number | string;
  realized_pnl: number | string;
}

interface GroupAccumulator {
  label: string;
  totalTrades: number;
  evaluatedTrades: number;
  wins: number;
  returnTotal: number;
  realizedPnl: number;
}

const INITIAL_PAPER_BALANCE_USD = 10_000;
const OUTCOME_CHECK_INTERVAL_MS = Number(process.env.EXECUTION_OUTCOME_POLL_MS ?? 60_000);
const EPSILON = 1e-8;

function round(value: number, digits = 8): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toNumber(value: number | string | null | undefined, digits = 8): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return round(numeric, digits);
}

function toNullableNumber(value: number | string | null | undefined, digits = 8): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return round(numeric, digits);
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toIsoString(value: string | Date | null | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
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

function mapHistoryRow(row: HistoryRow): ExecutionHistoryItem {
  const has24h = row.evaluated_at_24h !== null;
  const has1h = row.evaluated_at_1h !== null;

  return {
    id: row.id,
    signalId: row.signal_id,
    signalType: normalizeText(row.signal_type) ?? "manual_signal",
    symbol: normalizeText(row.symbol) ?? "BTC-USD",
    action: row.action === "sell" ? "sell" : "buy",
    confidence: toNumber(row.confidence, 4),
    reason: normalizeText(row.reason) ?? "",
    status: row.status === "blocked" ? "blocked" : "filled",
    size: toNumber(row.size),
    notionalUsd: toNumber(row.notional_usd, 2),
    avgPrice: toNullableNumber(row.avg_price, 8),
    referencePrice: toNullableNumber(row.reference_price, 8),
    slippage: toNullableNumber(row.slippage, 6),
    method: normalizeText(row.method),
    blockReason: normalizeText(row.block_reason),
    realizedPnl: toNumber(row.realized_pnl, 2),
    pnl: has24h ? toNullableNumber(row.pnl_24h, 2) : has1h ? toNullableNumber(row.pnl_1h, 2) : null,
    returnPercent: has24h
      ? toNullableNumber(row.return_percent_24h, 4)
      : has1h
        ? toNullableNumber(row.return_percent_1h, 4)
        : null,
    latestOutcomeHorizon: has24h ? "24h" : has1h ? "1h" : null,
    createdAt: toIsoString(row.created_at),
  };
}

export class PerformanceTracker {
  private interval: NodeJS.Timeout | null = null;

  private evaluationInFlight = false;

  constructor(private readonly exchangeMarketService: ExchangeMarketService) {}

  async init(): Promise<void> {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS paper_portfolios (
        id VARCHAR(36) PRIMARY KEY,
        scope_key VARCHAR(191) NOT NULL UNIQUE,
        user_id INT NULL,
        username VARCHAR(191) NULL,
        starting_balance_usd DECIMAL(20, 8) NOT NULL DEFAULT ${INITIAL_PAPER_BALANCE_USD},
        balance_usd DECIMAL(20, 8) NOT NULL DEFAULT ${INITIAL_PAPER_BALANCE_USD},
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_paper_portfolios_user (user_id),
        INDEX idx_paper_portfolios_username (username)
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS paper_positions (
        id VARCHAR(36) PRIMARY KEY,
        portfolio_id VARCHAR(36) NOT NULL,
        symbol VARCHAR(32) NOT NULL,
        size DECIMAL(24, 10) NOT NULL DEFAULT 0,
        avg_entry DECIMAL(20, 8) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_paper_positions_portfolio_symbol (portfolio_id, symbol),
        INDEX idx_paper_positions_symbol (symbol)
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS executions (
        id VARCHAR(36) PRIMARY KEY,
        scope_key VARCHAR(191) NOT NULL,
        user_id INT NULL,
        username VARCHAR(191) NULL,
        signal_id VARCHAR(64) NOT NULL,
        signal_type VARCHAR(128) NOT NULL,
        fingerprint VARCHAR(64) NOT NULL,
        symbol VARCHAR(32) NOT NULL,
        action ENUM('buy', 'sell') NOT NULL,
        confidence DECIMAL(10, 4) NOT NULL DEFAULT 0,
        reason TEXT NOT NULL,
        size DECIMAL(24, 10) NOT NULL DEFAULT 0,
        notional_usd DECIMAL(20, 8) NOT NULL DEFAULT 0,
        avg_price DECIMAL(20, 8) NULL,
        reference_price DECIMAL(20, 8) NULL,
        slippage DECIMAL(12, 6) NULL,
        method VARCHAR(64) NULL,
        execution_time_ms INT NULL,
        chunk_details_json JSON NULL,
        status ENUM('filled', 'blocked') NOT NULL,
        block_reason VARCHAR(255) NULL,
        realized_pnl DECIMAL(20, 8) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_executions_scope_created (scope_key, created_at),
        INDEX idx_executions_symbol_created (symbol, created_at),
        INDEX idx_executions_fingerprint_created (fingerprint, created_at)
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS execution_outcomes (
        id VARCHAR(36) PRIMARY KEY,
        execution_id VARCHAR(36) NOT NULL,
        horizon ENUM('1h', '24h') NOT NULL,
        due_at DATETIME NOT NULL,
        evaluated_at DATETIME NULL,
        market_price DECIMAL(20, 8) NULL,
        pnl DECIMAL(20, 8) NULL,
        return_percent DECIMAL(12, 6) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_execution_outcomes_execution_horizon (execution_id, horizon),
        INDEX idx_execution_outcomes_due (evaluated_at, due_at)
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS strategy_scores (
        id VARCHAR(36) PRIMARY KEY,
        scope_key VARCHAR(191) NOT NULL,
        score_key VARCHAR(191) NOT NULL,
        label VARCHAR(191) NOT NULL,
        total_trades INT NOT NULL DEFAULT 0,
        evaluated_trades INT NOT NULL DEFAULT 0,
        wins INT NOT NULL DEFAULT 0,
        win_rate DECIMAL(12, 6) NOT NULL DEFAULT 0,
        avg_return DECIMAL(12, 6) NOT NULL DEFAULT 0,
        realized_pnl DECIMAL(20, 8) NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_strategy_scores_scope_key (scope_key, score_key)
      )
    `);
  }

  start(): void {
    if (this.interval) {
      return;
    }

    void this.runOutcomeEvaluationPass();
    this.interval = setInterval(() => {
      void this.runOutcomeEvaluationPass();
    }, OUTCOME_CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async getOrCreatePortfolio(scope?: StrategyUserScope, priceOverrides?: Map<string, number>): Promise<PaperPortfolioState> {
    const portfolioRow = await this.ensurePortfolioRow(scope);
    const [positionRows] = await pool.query<PositionRow[]>(
      `
        SELECT id, portfolio_id, symbol, size, avg_entry
        FROM paper_positions
        WHERE portfolio_id = ?
        ORDER BY symbol ASC
      `,
      [portfolioRow.id],
    );

    return this.buildPortfolioState(portfolioRow, positionRows, priceOverrides);
  }

  async listRecentSignals(scope: StrategyUserScope | undefined, symbol: string, limit = 12): Promise<RecentExecutionSignal[]> {
    const scopeFilter = buildScopeWhereClause(scope);
    const [rows] = await pool.query<RecentExecutionRow[]>(
      `
        SELECT symbol, action, fingerprint, status, created_at
        FROM executions
        WHERE ${scopeFilter.clause}
          AND symbol = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
      [...scopeFilter.params, symbol, limit],
    );

    return rows.map((row) => ({
      symbol: normalizeText(row.symbol) ?? symbol,
      action: row.action === "sell" ? "sell" : "buy",
      fingerprint: normalizeText(row.fingerprint) ?? "",
      status: row.status === "blocked" ? "blocked" : "filled",
      timestamp: toIsoString(row.created_at),
    }));
  }

  async getDailyLossPercent(scope?: StrategyUserScope): Promise<number> {
    const scopeFilter = buildScopeWhereClause(scope);
    const portfolio = await this.getOrCreatePortfolio(scope);
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);

    const [rows] = await pool.query<Array<RowDataPacket & { loss_abs: number | string | null }>>(
      `
        SELECT COALESCE(SUM(CASE WHEN realized_pnl < 0 THEN ABS(realized_pnl) ELSE 0 END), 0) AS loss_abs
        FROM executions
        WHERE ${scopeFilter.clause}
          AND status = 'filled'
          AND created_at >= ?
      `,
      [...scopeFilter.params, dayStart],
    );

    const lossAbs = toNumber(rows[0]?.loss_abs, 8);
    if (portfolio.startingBalanceUSD <= 0) {
      return 0;
    }

    return round((lossAbs / portfolio.startingBalanceUSD) * 100, 4);
  }

  async recordBlockedExecution(input: BlockedExecutionRecordInput): Promise<ExecutionHistoryItem> {
    const id = randomUUID();
    const scopeKey = strategyUserScopeKey(input.scope);

    await pool.execute(
      `
        INSERT INTO executions (
          id,
          scope_key,
          user_id,
          username,
          signal_id,
          signal_type,
          fingerprint,
          symbol,
          action,
          confidence,
          reason,
          size,
          notional_usd,
          reference_price,
          status,
          block_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'blocked', ?)
      `,
      [
        id,
        scopeKey,
        input.scope?.userId ?? null,
        input.scope?.username?.trim().toLowerCase() ?? null,
        input.signal.id,
        input.signal.signalType,
        input.signal.fingerprint,
        input.signal.symbol,
        input.signal.action,
        round(input.signal.confidence, 4),
        input.signal.reason,
        round(input.size, 8),
        round(input.notionalUsd, 2),
        round(input.referencePrice, 8),
        input.blockReason.slice(0, 255),
      ],
    );

    return this.getExecutionById(id, input.scope);
  }

  async recordFilledExecution(input: FilledExecutionRecordInput): Promise<ExecutionHistoryItem> {
    const scopeKey = strategyUserScopeKey(input.scope);
    const executionId = randomUUID();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const portfolioRow = await this.ensurePortfolioRowForUpdate(connection, input.scope);
      const [positionRows] = await connection.query<PositionRow[]>(
        `
          SELECT id, portfolio_id, symbol, size, avg_entry
          FROM paper_positions
          WHERE portfolio_id = ?
            AND symbol = ?
          LIMIT 1
          FOR UPDATE
        `,
        [portfolioRow.id, input.signal.symbol],
      );

      const currentPosition = positionRows[0];
      const currentBalance = toNumber(portfolioRow.balance_usd, 8);
      const currentSize = toNumber(currentPosition?.size, 10);
      const currentAvgEntry = toNumber(currentPosition?.avg_entry, 8);

      if (input.signal.action === "buy") {
        const cost = input.avgPrice * input.size;
        if (cost > currentBalance + EPSILON) {
          throw new Error("Paper cash balance changed before execution could be recorded.");
        }

        const nextBalance = round(currentBalance - cost, 8);
        const nextSize = round(currentSize + input.size, 10);
        const nextAvgEntry =
          nextSize > EPSILON ? round((currentSize * currentAvgEntry + input.size * input.avgPrice) / nextSize, 8) : 0;

        await connection.execute(`UPDATE paper_portfolios SET balance_usd = ? WHERE id = ?`, [nextBalance, portfolioRow.id]);

        if (currentPosition) {
          await connection.execute(`UPDATE paper_positions SET size = ?, avg_entry = ? WHERE id = ?`, [nextSize, nextAvgEntry, currentPosition.id]);
        } else {
          await connection.execute(
            `
              INSERT INTO paper_positions (id, portfolio_id, symbol, size, avg_entry)
              VALUES (?, ?, ?, ?, ?)
            `,
            [randomUUID(), portfolioRow.id, input.signal.symbol, nextSize, nextAvgEntry],
          );
        }
      } else {
        if (!currentPosition || currentSize <= EPSILON || input.size > currentSize + EPSILON) {
          throw new Error("Paper position changed before execution could be recorded.");
        }

        const proceeds = input.avgPrice * input.size;
        const nextBalance = round(currentBalance + proceeds, 8);
        const remainingSize = round(currentSize - input.size, 10);

        await connection.execute(`UPDATE paper_portfolios SET balance_usd = ? WHERE id = ?`, [nextBalance, portfolioRow.id]);

        if (remainingSize <= EPSILON) {
          await connection.execute(`DELETE FROM paper_positions WHERE id = ?`, [currentPosition.id]);
        } else {
          await connection.execute(`UPDATE paper_positions SET size = ? WHERE id = ?`, [remainingSize, currentPosition.id]);
        }
      }

      await connection.execute(
        `
          INSERT INTO executions (
            id,
            scope_key,
            user_id,
            username,
            signal_id,
            signal_type,
            fingerprint,
            symbol,
            action,
            confidence,
            reason,
            size,
            notional_usd,
            avg_price,
            reference_price,
            slippage,
            method,
            execution_time_ms,
            chunk_details_json,
            status,
            realized_pnl
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'filled', ?)
        `,
        [
          executionId,
          scopeKey,
          input.scope?.userId ?? null,
          input.scope?.username?.trim().toLowerCase() ?? null,
          input.signal.id,
          input.signal.signalType,
          input.signal.fingerprint,
          input.signal.symbol,
          input.signal.action,
          round(input.signal.confidence, 4),
          input.signal.reason,
          round(input.size, 10),
          round(input.notionalUsd, 8),
          round(input.avgPrice, 8),
          round(input.referencePrice, 8),
          round(input.slippage, 6),
          input.method,
          input.executionTimeMs,
          JSON.stringify(input.chunks),
          round(input.realizedPnl, 8),
        ],
      );

      const signalTime = new Date(input.signal.timestamp);
      const due1h = new Date(signalTime.getTime() + 60 * 60 * 1000);
      const due24h = new Date(signalTime.getTime() + 24 * 60 * 60 * 1000);

      await connection.execute(
        `
          INSERT INTO execution_outcomes (id, execution_id, horizon, due_at)
          VALUES (?, ?, '1h', ?), (?, ?, '24h', ?)
        `,
        [randomUUID(), executionId, due1h, randomUUID(), executionId, due24h],
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return this.getExecutionById(executionId, input.scope);
  }

  async getExecutionHistory(scope?: StrategyUserScope, limit = 25): Promise<ExecutionHistoryResponse> {
    await this.runOutcomeEvaluationPass();
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const rows = await this.listHistoryRows(scope, safeLimit);
    const portfolio = await this.getOrCreatePortfolio(scope);

    return {
      executions: rows.map(mapHistoryRow),
      portfolio,
      generatedAt: new Date().toISOString(),
    };
  }

  async getExecutionPerformance(scope?: StrategyUserScope): Promise<ExecutionPerformanceResponse> {
    await this.runOutcomeEvaluationPass();
    await this.refreshStrategyScores(scope);

    const scopeKey = strategyUserScopeKey(scope);
    const [rows] = await pool.query<ScoreRow[]>(
      `
        SELECT score_key, label, total_trades, evaluated_trades, wins, win_rate, avg_return, realized_pnl
        FROM strategy_scores
        WHERE scope_key = ?
        ORDER BY CASE WHEN score_key = 'overall' THEN 0 ELSE 1 END, label ASC
      `,
      [scopeKey],
    );

    const overall = rows.find((row) => row.score_key === "overall");
    const portfolio = await this.getOrCreatePortfolio(scope);

    return {
      summary: {
        winRate: toNumber(overall?.win_rate, 4),
        avgReturn: toNumber(overall?.avg_return, 4),
        totalTrades: toNumber(overall?.total_trades, 0),
        evaluatedTrades: toNumber(overall?.evaluated_trades, 0),
        realizedPnl: toNumber(overall?.realized_pnl, 2),
      },
      breakdown: rows
        .filter((row) => row.score_key !== "overall")
        .map((row) => ({
          key: row.score_key,
          label: row.label,
          winRate: toNumber(row.win_rate, 4),
          avgReturn: toNumber(row.avg_return, 4),
          totalTrades: toNumber(row.total_trades, 0),
          evaluatedTrades: toNumber(row.evaluated_trades, 0),
          realizedPnl: toNumber(row.realized_pnl, 2),
        })),
      portfolio,
      generatedAt: new Date().toISOString(),
    };
  }

  async runOutcomeEvaluationPass(): Promise<void> {
    if (this.evaluationInFlight) {
      return;
    }

    this.evaluationInFlight = true;
    try {
      const updatedCount = await this.evaluateDueOutcomes();
      if (updatedCount > 0) {
        const scopes = await this.listScopesWithTrades();
        for (const scopeKey of scopes) {
          await this.refreshStrategyScoresByScopeKey(scopeKey);
        }
      }
    } finally {
      this.evaluationInFlight = false;
    }
  }

  private async evaluateDueOutcomes(): Promise<number> {
    const [rows] = await pool.query<DueOutcomeRow[]>(
      `
        SELECT eo.id, eo.horizon, e.symbol, e.action, e.size, e.avg_price
        FROM execution_outcomes eo
        INNER JOIN executions e ON e.id = eo.execution_id
        WHERE eo.evaluated_at IS NULL
          AND eo.due_at <= NOW()
          AND e.status = 'filled'
        ORDER BY eo.due_at ASC
        LIMIT 100
      `,
    );

    if (rows.length === 0) {
      return 0;
    }

    const priceCache = new Map<string, number>();
    let updatedCount = 0;

    for (const row of rows) {
      const symbol = normalizeMarketSymbol(normalizeText(row.symbol) ?? "");
      if (!symbol) {
        continue;
      }

      const marketPrice = await this.resolveMarketPrice(symbol, priceCache);
      if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
        continue;
      }

      const size = toNumber(row.size, 10);
      const avgPrice = toNumber(row.avg_price, 8);
      if (size <= EPSILON || avgPrice <= EPSILON) {
        continue;
      }

      const direction = row.action === "sell" ? -1 : 1;
      const pnl = round((marketPrice - avgPrice) * size * direction, 8);
      const notionalUsd = avgPrice * size;
      const returnPercent = notionalUsd > 0 ? round((pnl / notionalUsd) * 100, 6) : 0;

      await pool.execute(
        `
          UPDATE execution_outcomes
          SET market_price = ?, pnl = ?, return_percent = ?, evaluated_at = ?
          WHERE id = ?
        `,
        [marketPrice, pnl, returnPercent, new Date(), row.id],
      );

      updatedCount += 1;
    }

    return updatedCount;
  }

  private async refreshStrategyScores(scope?: StrategyUserScope): Promise<void> {
    const scopeKey = strategyUserScopeKey(scope);
    await this.refreshStrategyScoresByScopeKey(scopeKey);
  }

  private async refreshStrategyScoresByScopeKey(scopeKey: string): Promise<void> {
    const rows = await this.listHistoryRowsByScopeKey(scopeKey);
    const groups = new Map<string, GroupAccumulator>();

    const pushIntoGroup = (key: string, label: string, item: ExecutionHistoryItem) => {
      const current =
        groups.get(key) ??
        ({
          label,
          totalTrades: 0,
          evaluatedTrades: 0,
          wins: 0,
          returnTotal: 0,
          realizedPnl: 0,
        } satisfies GroupAccumulator);

      current.totalTrades += 1;
      current.realizedPnl += item.realizedPnl;
      if (item.returnPercent !== null) {
        current.evaluatedTrades += 1;
        current.returnTotal += item.returnPercent;
        if (item.returnPercent > 0) {
          current.wins += 1;
        }
      }
      groups.set(key, current);
    };

    rows.map(mapHistoryRow).filter((item) => item.status === "filled").forEach((item) => {
      pushIntoGroup("overall", "Overall", item);
      pushIntoGroup(`signal:${item.signalType}`, titleCase(item.signalType), item);
    });

    await pool.execute(`DELETE FROM strategy_scores WHERE scope_key = ?`, [scopeKey]);

    for (const [key, group] of groups.entries()) {
      const avgReturn = group.evaluatedTrades > 0 ? group.returnTotal / group.evaluatedTrades : 0;
      const winRate = group.evaluatedTrades > 0 ? group.wins / group.evaluatedTrades : 0;

      await pool.execute(
        `
          INSERT INTO strategy_scores (
            id,
            scope_key,
            score_key,
            label,
            total_trades,
            evaluated_trades,
            wins,
            win_rate,
            avg_return,
            realized_pnl,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `,
        [
          randomUUID(),
          scopeKey,
          key,
          group.label,
          group.totalTrades,
          group.evaluatedTrades,
          group.wins,
          round(winRate, 6),
          round(avgReturn, 6),
          round(group.realizedPnl, 8),
        ],
      );
    }
  }

  private async listScopesWithTrades(): Promise<string[]> {
    const [rows] = await pool.query<Array<RowDataPacket & { scope_key: string }>>(`SELECT DISTINCT scope_key FROM executions`);
    return rows.map((row) => row.scope_key).filter(Boolean);
  }

  private async getExecutionById(id: string, scope?: StrategyUserScope): Promise<ExecutionHistoryItem> {
    const scopeFilter = buildScopeWhereClause(scope, "e");
    const [rows] = await pool.query<HistoryRow[]>(
      `
        SELECT
          e.id,
          e.signal_id,
          e.signal_type,
          e.symbol,
          e.action,
          e.confidence,
          e.reason,
          e.status,
          e.size,
          e.notional_usd,
          e.avg_price,
          e.reference_price,
          e.slippage,
          e.method,
          e.block_reason,
          e.realized_pnl,
          e.created_at,
          o1.pnl AS pnl_1h,
          o1.return_percent AS return_percent_1h,
          o1.evaluated_at AS evaluated_at_1h,
          o24.pnl AS pnl_24h,
          o24.return_percent AS return_percent_24h,
          o24.evaluated_at AS evaluated_at_24h
        FROM executions e
        LEFT JOIN execution_outcomes o1 ON o1.execution_id = e.id AND o1.horizon = '1h'
        LEFT JOIN execution_outcomes o24 ON o24.execution_id = e.id AND o24.horizon = '24h'
        WHERE ${scopeFilter.clause}
          AND e.id = ?
        LIMIT 1
      `,
      [...scopeFilter.params, id],
    );

    if (rows.length === 0) {
      throw new Error("Execution record not found.");
    }

    return mapHistoryRow(rows[0]);
  }

  private async listHistoryRows(scope?: StrategyUserScope, limit = 25): Promise<HistoryRow[]> {
    const scopeFilter = buildScopeWhereClause(scope, "e");
    const [rows] = await pool.query<HistoryRow[]>(
      `
        SELECT
          e.id,
          e.signal_id,
          e.signal_type,
          e.symbol,
          e.action,
          e.confidence,
          e.reason,
          e.status,
          e.size,
          e.notional_usd,
          e.avg_price,
          e.reference_price,
          e.slippage,
          e.method,
          e.block_reason,
          e.realized_pnl,
          e.created_at,
          o1.pnl AS pnl_1h,
          o1.return_percent AS return_percent_1h,
          o1.evaluated_at AS evaluated_at_1h,
          o24.pnl AS pnl_24h,
          o24.return_percent AS return_percent_24h,
          o24.evaluated_at AS evaluated_at_24h
        FROM executions e
        LEFT JOIN execution_outcomes o1 ON o1.execution_id = e.id AND o1.horizon = '1h'
        LEFT JOIN execution_outcomes o24 ON o24.execution_id = e.id AND o24.horizon = '24h'
        WHERE ${scopeFilter.clause}
        ORDER BY e.created_at DESC
        LIMIT ?
      `,
      [...scopeFilter.params, limit],
    );

    return rows;
  }

  private async listHistoryRowsByScopeKey(scopeKey: string): Promise<HistoryRow[]> {
    const [rows] = await pool.query<HistoryRow[]>(
      `
        SELECT
          e.id,
          e.signal_id,
          e.signal_type,
          e.symbol,
          e.action,
          e.confidence,
          e.reason,
          e.status,
          e.size,
          e.notional_usd,
          e.avg_price,
          e.reference_price,
          e.slippage,
          e.method,
          e.block_reason,
          e.realized_pnl,
          e.created_at,
          o1.pnl AS pnl_1h,
          o1.return_percent AS return_percent_1h,
          o1.evaluated_at AS evaluated_at_1h,
          o24.pnl AS pnl_24h,
          o24.return_percent AS return_percent_24h,
          o24.evaluated_at AS evaluated_at_24h
        FROM executions e
        LEFT JOIN execution_outcomes o1 ON o1.execution_id = e.id AND o1.horizon = '1h'
        LEFT JOIN execution_outcomes o24 ON o24.execution_id = e.id AND o24.horizon = '24h'
        WHERE e.scope_key = ?
        ORDER BY e.created_at DESC
      `,
      [scopeKey],
    );

    return rows;
  }

  private async ensurePortfolioRow(scope?: StrategyUserScope): Promise<PortfolioRow> {
    const scopeKey = strategyUserScopeKey(scope);
    const [rows] = await pool.query<PortfolioRow[]>(
      `
        SELECT id, scope_key, user_id, username, starting_balance_usd, balance_usd, updated_at
        FROM paper_portfolios
        WHERE scope_key = ?
        LIMIT 1
      `,
      [scopeKey],
    );
    if (rows[0]) {
      return rows[0];
    }

    await pool.execute(
      `
        INSERT INTO paper_portfolios (id, scope_key, user_id, username, starting_balance_usd, balance_usd)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE scope_key = scope_key
      `,
      [
        randomUUID(),
        scopeKey,
        scope?.userId ?? null,
        scope?.username?.trim().toLowerCase() ?? null,
        INITIAL_PAPER_BALANCE_USD,
        INITIAL_PAPER_BALANCE_USD,
      ],
    );

    const [createdRows] = await pool.query<PortfolioRow[]>(
      `
        SELECT id, scope_key, user_id, username, starting_balance_usd, balance_usd, updated_at
        FROM paper_portfolios
        WHERE scope_key = ?
        LIMIT 1
      `,
      [scopeKey],
    );

    if (!createdRows[0]) {
      throw new Error("Unable to initialize paper portfolio.");
    }

    return createdRows[0];
  }

  private async ensurePortfolioRowForUpdate(connection: PoolConnection, scope?: StrategyUserScope): Promise<PortfolioRow> {
    const scopeKey = strategyUserScopeKey(scope);
    let [rows] = await connection.query<PortfolioRow[]>(
      `
        SELECT id, scope_key, user_id, username, starting_balance_usd, balance_usd, updated_at
        FROM paper_portfolios
        WHERE scope_key = ?
        LIMIT 1
        FOR UPDATE
      `,
      [scopeKey],
    );

    if (!rows[0]) {
      await connection.execute(
        `
          INSERT INTO paper_portfolios (id, scope_key, user_id, username, starting_balance_usd, balance_usd)
          VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE scope_key = scope_key
        `,
        [
          randomUUID(),
          scopeKey,
          scope?.userId ?? null,
          scope?.username?.trim().toLowerCase() ?? null,
          INITIAL_PAPER_BALANCE_USD,
          INITIAL_PAPER_BALANCE_USD,
        ],
      );

      [rows] = await connection.query<PortfolioRow[]>(
        `
          SELECT id, scope_key, user_id, username, starting_balance_usd, balance_usd, updated_at
          FROM paper_portfolios
          WHERE scope_key = ?
          LIMIT 1
          FOR UPDATE
        `,
        [scopeKey],
      );
    }

    if (!rows[0]) {
      throw new Error("Unable to initialize paper portfolio.");
    }

    return rows[0];
  }

  private async buildPortfolioState(
    portfolioRow: PortfolioRow,
    positionRows: PositionRow[],
    priceOverrides?: Map<string, number>,
  ): Promise<PaperPortfolioState> {
    const priceMap = new Map<string, number>();

    for (const position of positionRows) {
      const symbol = normalizeText(position.symbol) ?? "";
      if (!symbol || priceMap.has(symbol)) {
        continue;
      }

      const override = priceOverrides?.get(symbol);
      if (override && Number.isFinite(override) && override > 0) {
        priceMap.set(symbol, override);
        continue;
      }

      const normalizedSymbol = normalizeMarketSymbol(symbol);
      if (!normalizedSymbol) {
        priceMap.set(symbol, toNumber(position.avg_entry, 8));
        continue;
      }

      const livePrice = await this.resolveMarketPrice(normalizedSymbol);
      priceMap.set(symbol, livePrice > 0 ? livePrice : toNumber(position.avg_entry, 8));
    }

    const balanceUSD = toNumber(portfolioRow.balance_usd, 8);
    const startingBalanceUSD = toNumber(portfolioRow.starting_balance_usd, 8);
    const positions: PaperPortfolioPosition[] = positionRows.map((row) => {
      const symbol = normalizeText(row.symbol) ?? "BTC-USD";
      const size = toNumber(row.size, 10);
      const marketPrice = priceMap.get(symbol) ?? toNumber(row.avg_entry, 8);
      const marketValue = round(size * marketPrice, 8);

      return {
        symbol,
        size,
        avgEntry: toNumber(row.avg_entry, 8),
        marketPrice,
        marketValue,
        allocationPercent: 0,
      };
    });

    const totalEquityUSD = round(balanceUSD + positions.reduce((sum, position) => sum + position.marketValue, 0), 8);
    const hydratedPositions = positions.map((position) => ({
      ...position,
      allocationPercent: totalEquityUSD > 0 ? round((position.marketValue / totalEquityUSD) * 100, 4) : 0,
    }));

    return {
      balanceUSD,
      startingBalanceUSD,
      totalEquityUSD,
      positions: hydratedPositions,
      updatedAt: toIsoString(portfolioRow.updated_at),
    };
  }

  private async resolveMarketPrice(symbol: SupportedMarketSymbol, cache?: Map<string, number>): Promise<number> {
    const cached = cache?.get(symbol);
    if (cached && Number.isFinite(cached)) {
      return cached;
    }

    try {
      const comparison = await this.exchangeMarketService.getComparison(symbol);
      const markPrice =
        comparison.bestBuy && comparison.bestSell
          ? round((comparison.bestBuy.price + comparison.bestSell.price) / 2, 8)
          : comparison.exchanges.length > 0
            ? round(
                comparison.exchanges.reduce((sum, exchange) => sum + exchange.last, 0) / comparison.exchanges.length,
                8,
              )
            : 0;
      cache?.set(symbol, markPrice);
      return markPrice;
    } catch {
      return 0;
    }
  }
}

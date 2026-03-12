import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import mysql, { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  BacktestRun,
  BacktestRunStatus,
  BacktestStep,
  DemoAccountSettings,
  ExecutionPlan,
  StrategyConfig,
  StrategyRun,
  StrategyRunStatus,
  StrategyStoreData,
} from "./types.js";
import { buildPresetStrategies } from "./strategy-presets.js";
import { createNextRunAt } from "./allocation-utils.js";
import { StrategyUserScope } from "./strategy-user-scope.js";

const DEFAULT_DEMO_ACCOUNT_BALANCE = 10_000;
const DEFAULT_DEMO_UPDATED_AT = new Date().toISOString();
const DEFAULT_ACTIVE_USER = "dummy_alice";
const DUMMY_USERS = [
  { username: "dummy_alice", email: "dummy_alice@myapp.local" },
  { username: "dummy_bob", email: "dummy_bob@myapp.local" },
];

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function createDefaultDemoAccountSettings(): DemoAccountSettings {
  return {
    balance: parsePositiveNumber(process.env.DEMO_ACCOUNT_CAPITAL, DEFAULT_DEMO_ACCOUNT_BALANCE),
    updatedAt: DEFAULT_DEMO_UPDATED_AT,
  };
}

const DEFAULT_STORE: StrategyStoreData = {
  strategies: [],
  strategyRuns: [],
  executionPlans: [],
  backtestRuns: [],
  backtestSteps: [],
  demoAccount: createDefaultDemoAccountSettings(),
};

function normalizeExecutionPlan(entry: Partial<ExecutionPlan>): ExecutionPlan | null {
  if (
    typeof entry.id !== "string" ||
    typeof entry.strategyId !== "string" ||
    typeof entry.timestamp !== "string" ||
    typeof entry.mode !== "string"
  ) {
    return null;
  }

  return {
    ...(entry as ExecutionPlan),
    accountType: entry.accountType === "demo" ? "demo" : "real",
    warnings: Array.isArray(entry.warnings) ? entry.warnings : [],
    recommendedTrades: Array.isArray(entry.recommendedTrades) ? entry.recommendedTrades : [],
  };
}

function normalizeStrategyRun(entry: Partial<StrategyRun>): StrategyRun | null {
  if (
    typeof entry.id !== "string" ||
    typeof entry.strategyId !== "string" ||
    typeof entry.startedAt !== "string" ||
    typeof entry.status !== "string" ||
    typeof entry.mode !== "string" ||
    typeof entry.trigger !== "string"
  ) {
    return null;
  }

  return {
    ...(entry as StrategyRun),
    accountType: entry.accountType === "demo" ? "demo" : "real",
    warnings: Array.isArray(entry.warnings) ? entry.warnings : [],
  };
}

function normalizeDemoAccountSettings(entry: unknown): DemoAccountSettings {
  if (!entry || typeof entry !== "object") {
    return createDefaultDemoAccountSettings();
  }

  const shape = entry as Partial<DemoAccountSettings>;
  const defaultSettings = createDefaultDemoAccountSettings();
  const balance =
    typeof shape.balance === "number" && Number.isFinite(shape.balance) && shape.balance > 0
      ? shape.balance
      : defaultSettings.balance;
  const updatedAt =
    typeof shape.updatedAt === "string" && shape.updatedAt.trim().length > 0
      ? shape.updatedAt
      : defaultSettings.updatedAt;

  return {
    balance,
    updatedAt,
  };
}

function cloneStore(store: StrategyStoreData): StrategyStoreData {
  return {
    strategies: [...store.strategies],
    strategyRuns: [...store.strategyRuns],
    executionPlans: [...store.executionPlans],
    backtestRuns: [...store.backtestRuns],
    backtestSteps: [...store.backtestSteps],
    demoAccount: { ...store.demoAccount },
  };
}

function parseStore(raw: string): StrategyStoreData {
  try {
    const parsed = JSON.parse(raw) as Partial<StrategyStoreData>;
    return {
      strategies: Array.isArray(parsed.strategies) ? parsed.strategies : [],
      strategyRuns: Array.isArray(parsed.strategyRuns)
        ? parsed.strategyRuns
            .map((item) => normalizeStrategyRun(item as Partial<StrategyRun>))
            .filter((item): item is StrategyRun => item !== null)
        : [],
      executionPlans: Array.isArray(parsed.executionPlans)
        ? parsed.executionPlans
            .map((item) => normalizeExecutionPlan(item as Partial<ExecutionPlan>))
            .filter((item): item is ExecutionPlan => item !== null)
        : [],
      backtestRuns: Array.isArray(parsed.backtestRuns) ? parsed.backtestRuns : [],
      backtestSteps: Array.isArray(parsed.backtestSteps) ? parsed.backtestSteps : [],
      demoAccount: normalizeDemoAccountSettings((parsed as { demoAccount?: unknown }).demoAccount),
    };
  } catch {
    return cloneStore(DEFAULT_STORE);
  }
}

function orderByIsoDescending<T extends { createdAt?: string; startedAt?: string; timestamp?: string }>(entries: T[]): T[] {
  return [...entries].sort((left, right) => {
    const leftTs = left.createdAt ?? left.startedAt ?? left.timestamp ?? "";
    const rightTs = right.createdAt ?? right.startedAt ?? right.timestamp ?? "";
    return rightTs.localeCompare(leftTs);
  });
}

interface StoreRow extends RowDataPacket {
  payload: unknown;
}

interface UserRow extends RowDataPacket {
  id: number;
  username: string;
}

function parseStorePayload(payload: unknown): StrategyStoreData {
  if (typeof payload === "string") {
    return parseStore(payload);
  }
  if (Buffer.isBuffer(payload)) {
    return parseStore(payload.toString("utf8"));
  }
  if (payload && typeof payload === "object") {
    try {
      return parseStore(JSON.stringify(payload));
    } catch {
      return cloneStore(DEFAULT_STORE);
    }
  }
  return cloneStore(DEFAULT_STORE);
}

export class StrategyRepository {
  private readonly storePath: string;
  private readonly pool: Pool;
  private writeQueue: Promise<unknown> = Promise.resolve();
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private activeUserId: number | null = null;
  private activeUsername: string | null = null;
  private readonly bootstrappedUserIds = new Set<number>();

  constructor(customPath?: string) {
    this.storePath = customPath ?? path.join(process.cwd(), "data", "strategy-store.json");
    this.pool = mysql.createPool({
      host: process.env.MYAPP_DB_HOST ?? "localhost",
      port: parsePositiveInteger(process.env.MYAPP_DB_PORT, 3306),
      user: process.env.MYAPP_DB_USER ?? "myapp_user",
      password: process.env.MYAPP_DB_PASSWORD ?? "myapp_pass",
      database: process.env.MYAPP_DB_NAME ?? "myapp",
      waitForConnections: true,
      connectionLimit: parsePositiveInteger(process.env.MYAPP_DB_CONNECTION_LIMIT, 10),
      decimalNumbers: true,
      dateStrings: true,
    });
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    if (!this.initPromise) {
      this.initPromise = this.initialize().catch((error) => {
        this.initPromise = null;
        throw error;
      });
    }
    await this.initPromise;
  }

  private requireActiveUserId(): number {
    if (!this.activeUserId) {
      throw new Error("Strategy repository active user is not initialized.");
    }
    return this.activeUserId;
  }

  private normalizeScope(scope?: StrategyUserScope): StrategyUserScope | undefined {
    if (!scope) return undefined;
    const userId =
      typeof scope.userId === "number" && Number.isInteger(scope.userId) && scope.userId > 0 ? scope.userId : undefined;
    const username = typeof scope.username === "string" ? scope.username.trim().toLowerCase() : undefined;
    if (!userId && !username) return undefined;
    return { userId, username };
  }

  private async withConnection<T>(handler: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      return await handler(conn);
    } finally {
      conn.release();
    }
  }

  private async ensureSchema(conn: PoolConnection): Promise<void> {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS agent_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        email VARCHAR(255) NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS strategy_user_store (
        user_id INT PRIMARY KEY,
        payload JSON NOT NULL,
        updated_at VARCHAR(40) NOT NULL,
        CONSTRAINT fk_strategy_user_store_user
          FOREIGN KEY (user_id) REFERENCES agent_users(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  private async seedDummyUsers(conn: PoolConnection): Promise<void> {
    for (const user of DUMMY_USERS) {
      await conn.query(
        `
          INSERT INTO agent_users (username, email)
          VALUES (?, ?)
          ON DUPLICATE KEY UPDATE email = VALUES(email)
        `,
        [user.username, user.email]
      );
    }
  }

  private async getOrCreateUserByUsername(conn: PoolConnection, username: string): Promise<UserRow> {
    const normalizedUsername = username.trim().toLowerCase();
    const email = `${normalizedUsername}@myapp.local`;

    await conn.query(
      `
        INSERT INTO agent_users (username, email)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE email = VALUES(email)
      `,
      [normalizedUsername, email]
    );

    const [rows] = await conn.query<UserRow[]>(
      `
        SELECT id, username
        FROM agent_users
        WHERE LOWER(username) = LOWER(?)
        LIMIT 1
      `,
      [normalizedUsername]
    );
    const user = rows[0];
    if (!user) {
      throw new Error(`Unable to resolve strategy repository user ${normalizedUsername}.`);
    }
    return user;
  }

  private async resolveActiveUser(conn: PoolConnection): Promise<void> {
    const configuredUserId = Number.parseInt(String(process.env.MYAPP_ACTIVE_USER_ID ?? ""), 10);
    if (Number.isInteger(configuredUserId) && configuredUserId > 0) {
      const [byIdRows] = await conn.query<UserRow[]>(
        `
          SELECT id, username
          FROM agent_users
          WHERE id = ?
          LIMIT 1
        `,
        [configuredUserId]
      );
      const byId = byIdRows[0];
      if (byId) {
        this.activeUserId = byId.id;
        this.activeUsername = byId.username;
        return;
      }
    }

    const configuredUsername = (process.env.MYAPP_ACTIVE_USER ?? DEFAULT_ACTIVE_USER).trim().toLowerCase();
    const user = await this.getOrCreateUserByUsername(conn, configuredUsername);

    this.activeUserId = user.id;
    this.activeUsername = user.username;
  }

  private async ensureStoreForUser(
    conn: PoolConnection,
    userId: number,
    options?: { allowLegacyImport: boolean }
  ): Promise<void> {
    if (this.bootstrappedUserIds.has(userId)) return;

    let store = await this.readStoreForUser(conn, userId);
    if (!store) {
      if (options?.allowLegacyImport) {
        store = (await this.loadLegacyStoreFromDisk()) ?? cloneStore(DEFAULT_STORE);
      } else {
        store = cloneStore(DEFAULT_STORE);
      }
    }

    const nowIso = new Date().toISOString();
    const presetStrategies = buildPresetStrategies(nowIso);
    if (store.strategies.length === 0) {
      store.strategies = presetStrategies.map((strategy) => ({
        ...strategy,
        nextRunAt: createNextRunAt(nowIso, strategy.scheduleInterval),
      }));
    } else {
      const existingById = new Set(store.strategies.map((strategy) => strategy.id));
      const missingPresets = presetStrategies
        .filter((strategy) => !existingById.has(strategy.id))
        .map((strategy) => ({
          ...strategy,
          nextRunAt: createNextRunAt(nowIso, strategy.scheduleInterval),
        }));
      if (missingPresets.length > 0) {
        store.strategies.push(...missingPresets);
      }
    }

    store.demoAccount = normalizeDemoAccountSettings(store.demoAccount);
    await this.writeStoreForUser(conn, userId, store);
    this.bootstrappedUserIds.add(userId);
  }

  private async resolveUserId(conn: PoolConnection, scope?: StrategyUserScope): Promise<number> {
    const normalizedScope = this.normalizeScope(scope);
    if (!normalizedScope) {
      const userId = this.requireActiveUserId();
      await this.ensureStoreForUser(conn, userId, { allowLegacyImport: true });
      return userId;
    }

    if (normalizedScope.userId) {
      const [rows] = await conn.query<UserRow[]>(
        `
          SELECT id, username
          FROM agent_users
          WHERE id = ?
          LIMIT 1
        `,
        [normalizedScope.userId]
      );
      const user = rows[0];
      if (!user) {
        throw new Error(`User id ${normalizedScope.userId} was not found.`);
      }
      await this.ensureStoreForUser(conn, user.id, { allowLegacyImport: false });
      return user.id;
    }

    const user = await this.getOrCreateUserByUsername(conn, normalizedScope.username ?? DEFAULT_ACTIVE_USER);
    await this.ensureStoreForUser(conn, user.id, { allowLegacyImport: false });
    return user.id;
  }

  private async loadLegacyStoreFromDisk(): Promise<StrategyStoreData | null> {
    try {
      const raw = await readFile(this.storePath, "utf8");
      return parseStore(raw);
    } catch {
      return null;
    }
  }

  private async readStoreForUser(conn: PoolConnection, userId: number): Promise<StrategyStoreData | null> {
    const [rows] = await conn.query<StoreRow[]>(
      `
        SELECT payload
        FROM strategy_user_store
        WHERE user_id = ?
        LIMIT 1
      `,
      [userId]
    );
    const row = rows[0];
    if (!row) return null;
    return parseStorePayload(row.payload);
  }

  private async writeStoreForUser(conn: PoolConnection, userId: number, store: StrategyStoreData): Promise<void> {
    await conn.query(
      `
        INSERT INTO strategy_user_store (user_id, payload, updated_at)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          payload = VALUES(payload),
          updated_at = VALUES(updated_at)
      `,
      [userId, JSON.stringify(store), new Date().toISOString()]
    );
  }

  private async initialize(): Promise<void> {
    await this.withConnection(async (conn) => {
      await this.ensureSchema(conn);
      await this.seedDummyUsers(conn);
      await this.resolveActiveUser(conn);
      await this.ensureStoreForUser(conn, this.requireActiveUserId(), { allowLegacyImport: true });
    });

    this.initialized = true;
    const scopes = await this.listUserScopes();
    for (const scope of scopes) {
      await this.markInterruptedRunsAsFailed(scope);
    }
  }

  private async readStore(scope?: StrategyUserScope): Promise<StrategyStoreData> {
    return this.withConnection(async (conn) => {
      const userId = await this.resolveUserId(conn, scope);
      const store = await this.readStoreForUser(conn, userId);
      return store ?? cloneStore(DEFAULT_STORE);
    });
  }

  private async writeStore(store: StrategyStoreData, scope?: StrategyUserScope): Promise<void> {
    await this.withConnection(async (conn) => {
      const userId = await this.resolveUserId(conn, scope);
      await this.writeStoreForUser(conn, userId, store);
    });
  }

  private async readAfterWrites<T>(
    scope: StrategyUserScope | undefined,
    reader: (store: StrategyStoreData) => T | Promise<T>
  ): Promise<T> {
    await this.init();
    await this.writeQueue;
    const store = await this.readStore(scope);
    return reader(store);
  }

  private mutate<T>(
    scope: StrategyUserScope | undefined,
    mutator: (store: StrategyStoreData) => T | Promise<T>
  ): Promise<T> {
    const action = async () => {
      await this.init();
      const store = await this.readStore(scope);
      const result = await mutator(store);
      await this.writeStore(store, scope);
      return result;
    };

    const next = this.writeQueue.then(action, action);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined
    );

    return next;
  }

  async markInterruptedRunsAsFailed(scope?: StrategyUserScope): Promise<void> {
    await this.mutate(scope, (store) => {
      const nowIso = new Date().toISOString();
      store.strategyRuns = store.strategyRuns.map((run) => {
        if (run.status !== "running") return run;
        return {
          ...run,
          status: "failed",
          completedAt: nowIso,
          error: "Interrupted by process restart.",
          warnings: [...run.warnings, "Run interrupted by process restart."],
        };
      });
    });
  }

  async listUserScopes(): Promise<StrategyUserScope[]> {
    await this.init();
    return this.withConnection(async (conn) => {
      const [rows] = await conn.query<UserRow[]>(
        `
          SELECT id, username
          FROM agent_users
          ORDER BY id ASC
        `
      );
      return rows.map((row) => ({ userId: row.id, username: row.username }));
    });
  }

  async listStrategies(scope?: StrategyUserScope): Promise<StrategyConfig[]> {
    return this.readAfterWrites(scope, (store) => orderByIsoDescending(store.strategies));
  }

  async getStrategy(strategyId: string, scope?: StrategyUserScope): Promise<StrategyConfig | null> {
    return this.readAfterWrites(scope, (store) => store.strategies.find((strategy) => strategy.id === strategyId) ?? null);
  }

  async saveStrategy(strategy: StrategyConfig, scope?: StrategyUserScope): Promise<StrategyConfig> {
    return this.mutate(scope, (store) => {
      const index = store.strategies.findIndex((item) => item.id === strategy.id);
      if (index >= 0) {
        store.strategies[index] = strategy;
      } else {
        store.strategies.push(strategy);
      }

      return strategy;
    });
  }

  async deleteStrategy(strategyId: string, scope?: StrategyUserScope): Promise<boolean> {
    return this.mutate(scope, (store) => {
      const before = store.strategies.length;
      store.strategies = store.strategies.filter((strategy) => strategy.id !== strategyId);
      const removed = store.strategies.length < before;
      if (!removed) {
        return false;
      }

      store.strategyRuns = store.strategyRuns.filter((run) => run.strategyId !== strategyId);
      store.executionPlans = store.executionPlans.filter((plan) => plan.strategyId !== strategyId);

      const removedBacktestRunIds = new Set(
        store.backtestRuns.filter((run) => run.strategyId === strategyId).map((run) => run.id)
      );
      store.backtestRuns = store.backtestRuns.filter((run) => run.strategyId !== strategyId);

      store.backtestSteps = store.backtestSteps.filter((step) => !removedBacktestRunIds.has(step.backtestRunId));

      return true;
    });
  }

  async setStrategyEnabled(
    strategyId: string,
    isEnabled: boolean,
    scope?: StrategyUserScope
  ): Promise<StrategyConfig | null> {
    return this.mutate(scope, (store) => {
      const strategy = store.strategies.find((item) => item.id === strategyId);
      if (!strategy) return null;

      const nowIso = new Date().toISOString();
      strategy.isEnabled = isEnabled;
      strategy.updatedAt = nowIso;
      strategy.nextRunAt = isEnabled ? createNextRunAt(nowIso, strategy.scheduleInterval) : undefined;
      return strategy;
    });
  }

  async scheduleStrategy(
    strategyId: string,
    scheduleInterval: string,
    scope?: StrategyUserScope
  ): Promise<StrategyConfig | null> {
    return this.mutate(scope, (store) => {
      const strategy = store.strategies.find((item) => item.id === strategyId);
      if (!strategy) return null;

      const nowIso = new Date().toISOString();
      strategy.scheduleInterval = scheduleInterval;
      strategy.updatedAt = nowIso;
      strategy.nextRunAt = createNextRunAt(nowIso, scheduleInterval);
      return strategy;
    });
  }

  async updateStrategyRunTimestamps(strategyId: string, completedAtIso: string, scope?: StrategyUserScope): Promise<void> {
    await this.mutate(scope, (store) => {
      const strategy = store.strategies.find((item) => item.id === strategyId);
      if (!strategy) return;

      strategy.lastRunAt = completedAtIso;
      strategy.nextRunAt = createNextRunAt(completedAtIso, strategy.scheduleInterval);
      strategy.updatedAt = completedAtIso;
    });
  }

  async listDueStrategies(nowIso: string, scope?: StrategyUserScope): Promise<StrategyConfig[]> {
    return this.readAfterWrites(scope, (store) =>
      store.strategies
        .filter((strategy) => {
          if (!strategy.isEnabled) return false;
          if (strategy.executionMode === "manual") return false;
          if (!strategy.nextRunAt) return true;
          return strategy.nextRunAt <= nowIso;
        })
        .sort((left, right) => {
          const leftRun = left.nextRunAt ?? "";
          const rightRun = right.nextRunAt ?? "";
          return leftRun.localeCompare(rightRun);
        })
    );
  }

  async getDemoAccountSettings(scope?: StrategyUserScope): Promise<DemoAccountSettings> {
    return this.readAfterWrites(scope, (store) => ({ ...store.demoAccount }));
  }

  async setDemoAccountBalance(balance: number, scope?: StrategyUserScope): Promise<DemoAccountSettings> {
    return this.mutate(scope, (store) => {
      const safeBalance = Number.isFinite(balance) && balance > 0 ? balance : store.demoAccount.balance;
      store.demoAccount = {
        balance: safeBalance,
        updatedAt: new Date().toISOString(),
      };
      return { ...store.demoAccount };
    });
  }

  async createStrategyRun(input: {
    strategyId: string;
    status: StrategyRunStatus;
    accountType: StrategyRun["accountType"];
    mode: StrategyRun["mode"];
    trigger: StrategyRun["trigger"];
    inputSnapshot?: StrategyRun["inputSnapshot"];
  }, scope?: StrategyUserScope): Promise<StrategyRun> {
    return this.mutate(scope, (store) => {
      const run: StrategyRun = {
        id: randomUUID(),
        strategyId: input.strategyId,
        startedAt: new Date().toISOString(),
        status: input.status,
        accountType: input.accountType,
        mode: input.mode,
        trigger: input.trigger,
        inputSnapshot: input.inputSnapshot,
        warnings: [],
      };

      store.strategyRuns.push(run);
      return run;
    });
  }

  async updateStrategyRun(runId: string, patch: Partial<StrategyRun>, scope?: StrategyUserScope): Promise<StrategyRun | null> {
    return this.mutate(scope, (store) => {
      const run = store.strategyRuns.find((item) => item.id === runId);
      if (!run) return null;

      Object.assign(run, patch);
      return run;
    });
  }

  async listStrategyRuns(
    limit = 200,
    accountType?: StrategyRun["accountType"],
    scope?: StrategyUserScope
  ): Promise<StrategyRun[]> {
    return this.readAfterWrites(scope, (store) =>
      orderByIsoDescending(store.strategyRuns)
        .filter((run) => (accountType ? run.accountType === accountType : true))
        .slice(0, limit)
    );
  }

  async getStrategyRun(runId: string, scope?: StrategyUserScope): Promise<StrategyRun | null> {
    return this.readAfterWrites(scope, (store) => store.strategyRuns.find((run) => run.id === runId) ?? null);
  }

  async saveExecutionPlan(plan: ExecutionPlan, scope?: StrategyUserScope): Promise<ExecutionPlan> {
    return this.mutate(scope, (store) => {
      const index = store.executionPlans.findIndex((item) => item.id === plan.id);
      if (index >= 0) {
        store.executionPlans[index] = plan;
      } else {
        store.executionPlans.push(plan);
      }

      return plan;
    });
  }

  async getExecutionPlan(planId: string, scope?: StrategyUserScope): Promise<ExecutionPlan | null> {
    return this.readAfterWrites(scope, (store) => store.executionPlans.find((item) => item.id === planId) ?? null);
  }

  async getLatestExecutionPlanByStrategy(
    strategyId: string,
    accountType?: ExecutionPlan["accountType"],
    scope?: StrategyUserScope
  ): Promise<ExecutionPlan | null> {
    return this.readAfterWrites(scope, (store) => {
      const plans = store.executionPlans
        .filter((plan) => plan.strategyId === strategyId && (accountType ? plan.accountType === accountType : true))
        .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
      return plans[0] ?? null;
    });
  }

  async createBacktestRun(input: {
    strategyId: string;
    startDate: string;
    endDate: string;
    initialCapital: number;
    status?: BacktestRunStatus;
  }, scope?: StrategyUserScope): Promise<BacktestRun> {
    return this.mutate(scope, (store) => {
      const run: BacktestRun = {
        id: randomUUID(),
        strategyId: input.strategyId,
        startDate: input.startDate,
        endDate: input.endDate,
        initialCapital: input.initialCapital,
        status: input.status ?? "pending",
        createdAt: new Date().toISOString(),
      };

      store.backtestRuns.push(run);
      return run;
    });
  }

  async updateBacktestRun(runId: string, patch: Partial<BacktestRun>, scope?: StrategyUserScope): Promise<BacktestRun | null> {
    return this.mutate(scope, (store) => {
      const run = store.backtestRuns.find((item) => item.id === runId);
      if (!run) return null;

      Object.assign(run, patch);
      return run;
    });
  }

  async listBacktestRuns(limit = 100, scope?: StrategyUserScope): Promise<BacktestRun[]> {
    return this.readAfterWrites(scope, (store) => orderByIsoDescending(store.backtestRuns).slice(0, limit));
  }

  async getBacktestRun(runId: string, scope?: StrategyUserScope): Promise<BacktestRun | null> {
    return this.readAfterWrites(scope, (store) => store.backtestRuns.find((item) => item.id === runId) ?? null);
  }

  async appendBacktestSteps(steps: BacktestStep[], scope?: StrategyUserScope): Promise<void> {
    if (steps.length === 0) return;

    await this.mutate(scope, (store) => {
      store.backtestSteps.push(...steps);
    });
  }

  async listBacktestSteps(backtestRunId: string, scope?: StrategyUserScope): Promise<BacktestStep[]> {
    return this.readAfterWrites(scope, (store) =>
      store.backtestSteps
        .filter((step) => step.backtestRunId === backtestRunId)
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    );
  }
}

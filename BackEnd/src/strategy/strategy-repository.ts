import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BacktestRun,
  BacktestRunStatus,
  BacktestStep,
  ExecutionPlan,
  StrategyConfig,
  StrategyRun,
  StrategyRunStatus,
  StrategyStoreData,
} from "./types.js";
import { buildPresetStrategies } from "./strategy-presets.js";
import { createNextRunAt } from "./allocation-utils.js";

const DEFAULT_STORE: StrategyStoreData = {
  strategies: [],
  strategyRuns: [],
  executionPlans: [],
  backtestRuns: [],
  backtestSteps: [],
};

function cloneStore(store: StrategyStoreData): StrategyStoreData {
  return {
    strategies: [...store.strategies],
    strategyRuns: [...store.strategyRuns],
    executionPlans: [...store.executionPlans],
    backtestRuns: [...store.backtestRuns],
    backtestSteps: [...store.backtestSteps],
  };
}

function parseStore(raw: string): StrategyStoreData {
  try {
    const parsed = JSON.parse(raw) as Partial<StrategyStoreData>;
    return {
      strategies: Array.isArray(parsed.strategies) ? parsed.strategies : [],
      strategyRuns: Array.isArray(parsed.strategyRuns) ? parsed.strategyRuns : [],
      executionPlans: Array.isArray(parsed.executionPlans) ? parsed.executionPlans : [],
      backtestRuns: Array.isArray(parsed.backtestRuns) ? parsed.backtestRuns : [],
      backtestSteps: Array.isArray(parsed.backtestSteps) ? parsed.backtestSteps : [],
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

export class StrategyRepository {
  private readonly storePath: string;
  private writeQueue: Promise<unknown> = Promise.resolve();
  private initialized = false;

  constructor(customPath?: string) {
    this.storePath = customPath ?? path.join(process.cwd(), "data", "strategy-store.json");
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    const directory = path.dirname(this.storePath);
    await mkdir(directory, { recursive: true });

    let store = cloneStore(DEFAULT_STORE);

    try {
      const raw = await readFile(this.storePath, "utf8");
      store = parseStore(raw);
    } catch {
      await writeFile(this.storePath, JSON.stringify(store, null, 2), "utf8");
    }

    if (store.strategies.length === 0) {
      const nowIso = new Date().toISOString();
      store.strategies = buildPresetStrategies(nowIso).map((strategy) => ({
        ...strategy,
        nextRunAt: createNextRunAt(nowIso, strategy.scheduleInterval),
      }));
      await this.writeStore(store);
    }

    this.initialized = true;
    await this.markInterruptedRunsAsFailed();
  }

  private async readStore(): Promise<StrategyStoreData> {
    const raw = await readFile(this.storePath, "utf8");
    return parseStore(raw);
  }

  private async writeStore(store: StrategyStoreData): Promise<void> {
    await writeFile(this.storePath, JSON.stringify(store, null, 2), "utf8");
  }

  private async readAfterWrites<T>(reader: (store: StrategyStoreData) => T | Promise<T>): Promise<T> {
    await this.init();
    await this.writeQueue;
    const store = await this.readStore();
    return reader(store);
  }

  private mutate<T>(mutator: (store: StrategyStoreData) => T | Promise<T>): Promise<T> {
    const action = async () => {
      await this.init();
      const store = await this.readStore();
      const result = await mutator(store);
      await this.writeStore(store);
      return result;
    };

    const next = this.writeQueue.then(action, action);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined
    );

    return next;
  }

  async markInterruptedRunsAsFailed(): Promise<void> {
    await this.mutate((store) => {
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

  async listStrategies(): Promise<StrategyConfig[]> {
    return this.readAfterWrites((store) => orderByIsoDescending(store.strategies));
  }

  async getStrategy(strategyId: string): Promise<StrategyConfig | null> {
    return this.readAfterWrites((store) => store.strategies.find((strategy) => strategy.id === strategyId) ?? null);
  }

  async saveStrategy(strategy: StrategyConfig): Promise<StrategyConfig> {
    return this.mutate((store) => {
      const index = store.strategies.findIndex((item) => item.id === strategy.id);
      if (index >= 0) {
        store.strategies[index] = strategy;
      } else {
        store.strategies.push(strategy);
      }

      return strategy;
    });
  }

  async setStrategyEnabled(strategyId: string, isEnabled: boolean): Promise<StrategyConfig | null> {
    return this.mutate((store) => {
      const strategy = store.strategies.find((item) => item.id === strategyId);
      if (!strategy) return null;

      const nowIso = new Date().toISOString();
      strategy.isEnabled = isEnabled;
      strategy.updatedAt = nowIso;
      strategy.nextRunAt = isEnabled ? createNextRunAt(nowIso, strategy.scheduleInterval) : undefined;
      return strategy;
    });
  }

  async scheduleStrategy(strategyId: string, scheduleInterval: string): Promise<StrategyConfig | null> {
    return this.mutate((store) => {
      const strategy = store.strategies.find((item) => item.id === strategyId);
      if (!strategy) return null;

      const nowIso = new Date().toISOString();
      strategy.scheduleInterval = scheduleInterval;
      strategy.updatedAt = nowIso;
      strategy.nextRunAt = createNextRunAt(nowIso, scheduleInterval);
      return strategy;
    });
  }

  async updateStrategyRunTimestamps(strategyId: string, completedAtIso: string): Promise<void> {
    await this.mutate((store) => {
      const strategy = store.strategies.find((item) => item.id === strategyId);
      if (!strategy) return;

      strategy.lastRunAt = completedAtIso;
      strategy.nextRunAt = createNextRunAt(completedAtIso, strategy.scheduleInterval);
      strategy.updatedAt = completedAtIso;
    });
  }

  async listDueStrategies(nowIso: string): Promise<StrategyConfig[]> {
    return this.readAfterWrites((store) =>
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

  async createStrategyRun(input: {
    strategyId: string;
    status: StrategyRunStatus;
    mode: StrategyRun["mode"];
    trigger: StrategyRun["trigger"];
    inputSnapshot?: StrategyRun["inputSnapshot"];
  }): Promise<StrategyRun> {
    return this.mutate((store) => {
      const run: StrategyRun = {
        id: randomUUID(),
        strategyId: input.strategyId,
        startedAt: new Date().toISOString(),
        status: input.status,
        mode: input.mode,
        trigger: input.trigger,
        inputSnapshot: input.inputSnapshot,
        warnings: [],
      };

      store.strategyRuns.push(run);
      return run;
    });
  }

  async updateStrategyRun(runId: string, patch: Partial<StrategyRun>): Promise<StrategyRun | null> {
    return this.mutate((store) => {
      const run = store.strategyRuns.find((item) => item.id === runId);
      if (!run) return null;

      Object.assign(run, patch);
      return run;
    });
  }

  async listStrategyRuns(limit = 200): Promise<StrategyRun[]> {
    return this.readAfterWrites((store) =>
      orderByIsoDescending(store.strategyRuns).slice(0, limit)
    );
  }

  async getStrategyRun(runId: string): Promise<StrategyRun | null> {
    return this.readAfterWrites((store) => store.strategyRuns.find((run) => run.id === runId) ?? null);
  }

  async saveExecutionPlan(plan: ExecutionPlan): Promise<ExecutionPlan> {
    return this.mutate((store) => {
      const index = store.executionPlans.findIndex((item) => item.id === plan.id);
      if (index >= 0) {
        store.executionPlans[index] = plan;
      } else {
        store.executionPlans.push(plan);
      }

      return plan;
    });
  }

  async getExecutionPlan(planId: string): Promise<ExecutionPlan | null> {
    return this.readAfterWrites((store) => store.executionPlans.find((item) => item.id === planId) ?? null);
  }

  async getLatestExecutionPlanByStrategy(strategyId: string): Promise<ExecutionPlan | null> {
    return this.readAfterWrites((store) => {
      const plans = store.executionPlans
        .filter((plan) => plan.strategyId === strategyId)
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
  }): Promise<BacktestRun> {
    return this.mutate((store) => {
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

  async updateBacktestRun(runId: string, patch: Partial<BacktestRun>): Promise<BacktestRun | null> {
    return this.mutate((store) => {
      const run = store.backtestRuns.find((item) => item.id === runId);
      if (!run) return null;

      Object.assign(run, patch);
      return run;
    });
  }

  async listBacktestRuns(limit = 100): Promise<BacktestRun[]> {
    return this.readAfterWrites((store) => orderByIsoDescending(store.backtestRuns).slice(0, limit));
  }

  async getBacktestRun(runId: string): Promise<BacktestRun | null> {
    return this.readAfterWrites((store) => store.backtestRuns.find((item) => item.id === runId) ?? null);
  }

  async appendBacktestSteps(steps: BacktestStep[]): Promise<void> {
    if (steps.length === 0) return;

    await this.mutate((store) => {
      store.backtestSteps.push(...steps);
    });
  }

  async listBacktestSteps(backtestRunId: string): Promise<BacktestStep[]> {
    return this.readAfterWrites((store) =>
      store.backtestSteps
        .filter((step) => step.backtestRunId === backtestRunId)
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    );
  }
}

import { StrategyRepository } from "./strategy-repository.js";
import { StrategyRunner } from "./strategy-runner.js";

export class StrategyScheduler {
  private timer: NodeJS.Timeout | null = null;
  private runningTick = false;

  constructor(
    private readonly repository: StrategyRepository,
    private readonly runner: StrategyRunner,
    private readonly pollIntervalMs = 15_000
  ) {}

  async start(): Promise<void> {
    await this.repository.init();
    if (this.timer) return;

    const loop = async () => {
      try {
        await this.tick();
      } finally {
        this.timer = setTimeout(loop, this.pollIntervalMs);
      }
    };

    this.timer = setTimeout(loop, this.pollIntervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.runningTick) return;
    this.runningTick = true;

    try {
      const nowIso = new Date().toISOString();
      const scopes = await this.repository.listUserScopes();

      for (const scope of scopes) {
        const dueStrategies = await this.repository.listDueStrategies(nowIso, scope);
        const dueProfiles = await this.repository.listDueRebalanceAllocationProfiles(nowIso, scope);

        for (const strategy of dueStrategies) {
          if (this.runner.isRunning(strategy.id, "real", scope)) {
            continue;
          }

          try {
            await this.runner.runStrategy(strategy.id, "schedule", "real", scope);
          } catch (error) {
            console.error(
              `[strategy-scheduler] user=${scope.username ?? scope.userId} strategy=${strategy.id} failed:`,
              error instanceof Error ? error.message : error
            );
          }
        }

        for (const profile of dueProfiles) {
          if (this.runner.isRunning(profile.strategyId, "demo", scope, profile.id)) {
            continue;
          }

          try {
            await this.runner.executeRebalanceAllocationProfile(profile.id, "schedule", scope, {
              respectAutoThreshold: true,
            });
          } catch (error) {
            console.error(
              `[strategy-scheduler] user=${scope.username ?? scope.userId} rebalance-allocation=${profile.id} failed:`,
              error instanceof Error ? error.message : error
            );
          }
        }
      }
    } finally {
      this.runningTick = false;
    }
  }
}

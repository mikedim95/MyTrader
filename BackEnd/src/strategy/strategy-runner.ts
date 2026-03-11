import { StrategyEngine } from "./strategy-engine.js";
import { StrategyRepository } from "./strategy-repository.js";
import { buildMarketSignalsFromPortfolio } from "./market-signal-service.js";
import { getPortfolioState } from "./portfolio-state-service.js";
import {
  MarketSignalSnapshot,
  PortfolioAccountType,
  PortfolioState,
  StrategyConfig,
  StrategyEvaluationResult,
  StrategyRun,
} from "./types.js";

export class StrategyRunner {
  private readonly activeStrategies = new Set<string>();

  constructor(private readonly repository: StrategyRepository, private readonly engine = new StrategyEngine()) {}

  private runKey(strategyId: string, accountType: PortfolioAccountType): string {
    return `${strategyId}:${accountType}`;
  }

  isRunning(strategyId: string, accountType: PortfolioAccountType = "real"): boolean {
    return this.activeStrategies.has(this.runKey(strategyId, accountType));
  }

  private async resolveDemoBalance(accountType: PortfolioAccountType): Promise<number | undefined> {
    if (accountType !== "demo") return undefined;
    const demoSettings = await this.repository.getDemoAccountSettings();
    return demoSettings.balance;
  }

  private async buildStrategyUniverse(): Promise<Record<string, StrategyConfig>> {
    const strategies = await this.repository.listStrategies();
    return strategies.reduce<Record<string, StrategyConfig>>((acc, strategy) => {
      acc[strategy.id] = strategy;
      return acc;
    }, {});
  }

  async evaluateStrategyState(
    strategyId: string,
    accountType?: PortfolioAccountType
  ): Promise<{
    strategy: StrategyConfig;
    evaluation: StrategyEvaluationResult;
    portfolio: PortfolioState;
    marketSignals: MarketSignalSnapshot;
    accountType: PortfolioAccountType;
  } | null>;
  async evaluateStrategyState(strategyId: string, accountType: PortfolioAccountType = "real"): Promise<{
    strategy: StrategyConfig;
    evaluation: StrategyEvaluationResult;
    portfolio: PortfolioState;
    marketSignals: MarketSignalSnapshot;
    accountType: PortfolioAccountType;
  } | null> {
    const strategy = await this.repository.getStrategy(strategyId);
    if (!strategy) return null;

    const demoBalance = await this.resolveDemoBalance(accountType);
    const portfolio = await getPortfolioState(accountType, "USDC", { demoCapital: demoBalance });
    const marketSignals = buildMarketSignalsFromPortfolio(portfolio);
    const strategyUniverse = await this.buildStrategyUniverse();

    const evaluation = this.engine.evaluate({
      strategy,
      portfolio,
      marketSignals,
      accountType,
      strategyUniverse,
    });

    return {
      strategy,
      evaluation,
      portfolio,
      marketSignals,
      accountType,
    };
  }

  async runStrategy(
    strategyId: string,
    trigger: StrategyRun["trigger"] = "api",
    accountType: PortfolioAccountType = "real"
  ): Promise<StrategyRun> {
    const strategy = await this.repository.getStrategy(strategyId);
    if (!strategy) {
      throw new Error(`Strategy ${strategyId} was not found.`);
    }

    const runKey = this.runKey(strategyId, accountType);

    if (this.activeStrategies.has(runKey)) {
      return this.repository.createStrategyRun({
        strategyId,
        status: "skipped",
        accountType,
        mode: strategy.executionMode,
        trigger,
      });
    }

    if (trigger === "schedule" && (!strategy.isEnabled || strategy.executionMode === "manual")) {
      return this.repository.createStrategyRun({
        strategyId,
        status: "skipped",
        accountType,
        mode: strategy.executionMode,
        trigger,
      });
    }

    this.activeStrategies.add(runKey);

    let run = await this.repository.createStrategyRun({
      strategyId,
      status: "running",
      accountType,
      mode: strategy.executionMode,
      trigger,
    });

    try {
      const demoBalance = await this.resolveDemoBalance(accountType);
      const portfolio = await getPortfolioState(accountType, "USDC", { demoCapital: demoBalance });
      const marketSignals = buildMarketSignalsFromPortfolio(portfolio);
      const strategyUniverse = await this.buildStrategyUniverse();

      run = (await this.repository.updateStrategyRun(run.id, {
        inputSnapshot: {
          portfolio,
          marketSignals,
        },
      })) ?? run;

      const evaluation = this.engine.evaluate({
        strategy,
        portfolio,
        marketSignals,
        accountType,
        strategyUniverse,
      });

      await this.repository.saveExecutionPlan(evaluation.executionPlan);

      const completedAt = new Date().toISOString();
      const completed = await this.repository.updateStrategyRun(run.id, {
        status: "completed",
        completedAt,
        accountType,
        adjustedAllocation: evaluation.adjustedTargetAllocation,
        executionPlanId: evaluation.executionPlan.id,
        warnings: evaluation.warnings,
      });

      await this.repository.updateStrategyRunTimestamps(strategy.id, completedAt);

      return completed ?? run;
    } catch (error) {
      const failed = await this.repository.updateStrategyRun(run.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Strategy run failed.",
      });

      return failed ?? run;
    } finally {
      this.activeStrategies.delete(runKey);
    }
  }
}

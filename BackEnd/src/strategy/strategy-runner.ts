import { StrategyEngine } from "./strategy-engine.js";
import { StrategyRepository } from "./strategy-repository.js";
import { buildMarketSignalsFromPortfolio } from "./market-signal-service.js";
import { getPortfolioState } from "./portfolio-state-service.js";
import { strategyUserScopeKey, StrategyUserScope } from "./strategy-user-scope.js";
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

  private runKey(strategyId: string, accountType: PortfolioAccountType, userScope?: StrategyUserScope): string {
    return `${strategyUserScopeKey(userScope)}:${strategyId}:${accountType}`;
  }

  isRunning(strategyId: string, accountType: PortfolioAccountType = "real", userScope?: StrategyUserScope): boolean {
    return this.activeStrategies.has(this.runKey(strategyId, accountType, userScope));
  }

  private async resolveDemoBalance(accountType: PortfolioAccountType, userScope?: StrategyUserScope): Promise<number | undefined> {
    if (accountType !== "demo") return undefined;
    const demoSettings = await this.repository.getDemoAccountSettings(userScope);
    return demoSettings.balance;
  }

  private async buildStrategyUniverse(userScope?: StrategyUserScope): Promise<Record<string, StrategyConfig>> {
    const strategies = await this.repository.listStrategies(userScope);
    return strategies.reduce<Record<string, StrategyConfig>>((acc, strategy) => {
      acc[strategy.id] = strategy;
      return acc;
    }, {});
  }

  async evaluateStrategyState(
    strategyId: string,
    accountType?: PortfolioAccountType,
    userScope?: StrategyUserScope
  ): Promise<{
    strategy: StrategyConfig;
    evaluation: StrategyEvaluationResult;
    portfolio: PortfolioState;
    marketSignals: MarketSignalSnapshot;
    accountType: PortfolioAccountType;
  } | null>;
  async evaluateStrategyState(
    strategyId: string,
    accountType: PortfolioAccountType = "real",
    userScope?: StrategyUserScope
  ): Promise<{
    strategy: StrategyConfig;
    evaluation: StrategyEvaluationResult;
    portfolio: PortfolioState;
    marketSignals: MarketSignalSnapshot;
    accountType: PortfolioAccountType;
  } | null> {
    const strategy = await this.repository.getStrategy(strategyId, userScope);
    if (!strategy) return null;

    const demoBalance = await this.resolveDemoBalance(accountType, userScope);
    const portfolio = await getPortfolioState(accountType, "USDC", { demoCapital: demoBalance });
    const marketSignals = buildMarketSignalsFromPortfolio(portfolio);
    const strategyUniverse = await this.buildStrategyUniverse(userScope);

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
    accountType: PortfolioAccountType = "real",
    userScope?: StrategyUserScope
  ): Promise<StrategyRun> {
    const strategy = await this.repository.getStrategy(strategyId, userScope);
    if (!strategy) {
      throw new Error(`Strategy ${strategyId} was not found.`);
    }

    const runKey = this.runKey(strategyId, accountType, userScope);

    if (this.activeStrategies.has(runKey)) {
      return this.repository.createStrategyRun({
        strategyId,
        status: "skipped",
        accountType,
        mode: strategy.executionMode,
        trigger,
      }, userScope);
    }

    if (trigger === "schedule" && (!strategy.isEnabled || strategy.executionMode === "manual")) {
      return this.repository.createStrategyRun({
        strategyId,
        status: "skipped",
        accountType,
        mode: strategy.executionMode,
        trigger,
      }, userScope);
    }

    this.activeStrategies.add(runKey);

    let run = await this.repository.createStrategyRun({
      strategyId,
      status: "running",
      accountType,
      mode: strategy.executionMode,
      trigger,
    }, userScope);

    try {
      const demoBalance = await this.resolveDemoBalance(accountType, userScope);
      const portfolio = await getPortfolioState(accountType, "USDC", { demoCapital: demoBalance });
      const marketSignals = buildMarketSignalsFromPortfolio(portfolio);
      const strategyUniverse = await this.buildStrategyUniverse(userScope);

      run = (await this.repository.updateStrategyRun(run.id, {
        inputSnapshot: {
          portfolio,
          marketSignals,
        },
      }, userScope)) ?? run;

      const evaluation = this.engine.evaluate({
        strategy,
        portfolio,
        marketSignals,
        accountType,
        strategyUniverse,
      });

      await this.repository.saveExecutionPlan(evaluation.executionPlan, userScope);

      const completedAt = new Date().toISOString();
      const completed = await this.repository.updateStrategyRun(run.id, {
        status: "completed",
        completedAt,
        accountType,
        adjustedAllocation: evaluation.adjustedTargetAllocation,
        executionPlanId: evaluation.executionPlan.id,
        warnings: evaluation.warnings,
      }, userScope);

      await this.repository.updateStrategyRunTimestamps(strategy.id, completedAt, userScope);

      return completed ?? run;
    } catch (error) {
      const failed = await this.repository.updateStrategyRun(run.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Strategy run failed.",
      }, userScope);

      return failed ?? run;
    } finally {
      this.activeStrategies.delete(runKey);
    }
  }
}

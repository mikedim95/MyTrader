import { StrategyEngine } from "./strategy-engine.js";
import { StrategyRepository } from "./strategy-repository.js";
import { buildMarketSignalsFromPortfolio } from "./market-signal-service.js";
import { buildLiveStrategyMarketContext } from "./strategy-market-context.js";
import { detectMarketRegime } from "./strategy-regime.js";
import { createDemoAccountHoldings, getPortfolioState } from "./portfolio-state-service.js";
import { strategyUserScopeKey, StrategyUserScope } from "./strategy-user-scope.js";
import {
  DemoAccountSettings,
  MarketSignalSnapshot,
  PortfolioAccountType,
  PortfolioState,
  StrategyConfig,
  StrategyEvaluationResult,
  StrategyMarketContextSnapshot,
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

  private async resolveDemoSettings(
    accountType: PortfolioAccountType,
    userScope?: StrategyUserScope
  ): Promise<DemoAccountSettings | undefined> {
    if (accountType !== "demo") return undefined;
    return this.repository.getDemoAccountSettings(userScope);
  }

  private async buildStrategyUniverse(userScope?: StrategyUserScope): Promise<Record<string, StrategyConfig>> {
    const strategies = await this.repository.listStrategies(userScope);
    return strategies.reduce<Record<string, StrategyConfig>>((acc, strategy) => {
      acc[strategy.id] = strategy;
      return acc;
    }, {});
  }

  private async buildMarketContext(marketSignals: MarketSignalSnapshot, timestamp: string): Promise<StrategyMarketContextSnapshot> {
    return buildLiveStrategyMarketContext(timestamp, detectMarketRegime(marketSignals));
  }

  private async evaluatePreparedStrategy(
    strategy: StrategyConfig,
    accountType: PortfolioAccountType,
    userScope?: StrategyUserScope
  ): Promise<{
    portfolio: PortfolioState;
    marketSignals: MarketSignalSnapshot;
    marketContext: StrategyMarketContextSnapshot;
    evaluation: StrategyEvaluationResult;
  }> {
    const demoSettings = await this.resolveDemoSettings(accountType, userScope);
    const portfolio = await getPortfolioState(accountType, "USDC", { demoAccount: demoSettings, userScope });
    const marketSignals = buildMarketSignalsFromPortfolio(portfolio);
    const marketContext = await this.buildMarketContext(marketSignals, portfolio.timestamp);
    const strategyUniverse = await this.buildStrategyUniverse(userScope);
    const evaluation = this.engine.evaluate({
      strategy,
      portfolio,
      marketSignals,
      marketContext,
      accountType,
      strategyUniverse,
    });

    return {
      portfolio,
      marketSignals,
      marketContext,
      evaluation,
    };
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
    marketContext: StrategyMarketContextSnapshot;
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
    marketContext: StrategyMarketContextSnapshot;
    accountType: PortfolioAccountType;
  } | null> {
    const strategy = await this.repository.getStrategy(strategyId, userScope);
    if (!strategy) return null;

    const { portfolio, marketSignals, marketContext, evaluation } = await this.evaluatePreparedStrategy(
      strategy,
      accountType,
      userScope
    );

    return {
      strategy,
      evaluation,
      portfolio,
      marketSignals,
      marketContext,
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
        warnings: ["Strategy run skipped because another run is already active."],
        skipReason: "Strategy run already in progress.",
      }, userScope);
    }

    if (trigger === "schedule" && (!strategy.isEnabled || strategy.executionMode === "manual")) {
      return this.repository.createStrategyRun({
        strategyId,
        status: "skipped",
        accountType,
        mode: strategy.executionMode,
        trigger,
        warnings: [
          !strategy.isEnabled
            ? "Strategy run skipped because the strategy is disabled."
            : "Strategy run skipped because manual strategies do not run on the scheduler.",
        ],
        skipReason: !strategy.isEnabled
          ? "Strategy is disabled."
          : "Manual strategies do not run on the scheduler.",
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
      const { portfolio, marketSignals, marketContext, evaluation } = await this.evaluatePreparedStrategy(
        strategy,
        accountType,
        userScope
      );

      run = (await this.repository.updateStrategyRun(run.id, {
        inputSnapshot: {
          portfolio,
          marketSignals,
          marketContext,
        },
      }, userScope)) ?? run;

      await this.repository.saveExecutionPlan(evaluation.executionPlan, userScope);

      if (evaluation.marketGate && !evaluation.marketGate.passed) {
        const skipped = await this.repository.updateStrategyRun(run.id, {
          status: "skipped",
          completedAt: new Date().toISOString(),
          accountType,
          adjustedAllocation: evaluation.adjustedTargetAllocation,
          executionPlanId: evaluation.executionPlan.id,
          warnings: evaluation.warnings,
          marketGate: evaluation.marketGate,
          skipReason: evaluation.marketGate.blockingReasons[0] ?? "Strategy execution blocked by market context gate.",
        }, userScope);

        return skipped ?? run;
      }

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

  async executeStrategy(
    strategyId: string,
    trigger: StrategyRun["trigger"] = "api",
    accountType: PortfolioAccountType = "demo",
    userScope?: StrategyUserScope
  ): Promise<StrategyRun> {
    const strategy = await this.repository.getStrategy(strategyId, userScope);
    if (!strategy) {
      throw new Error(`Strategy ${strategyId} was not found.`);
    }

    if (accountType !== "demo") {
      throw new Error("Live rebalance execution is not implemented yet. Use demo mode for executed rebalances.");
    }

    const runKey = this.runKey(strategyId, accountType, userScope);

    if (this.activeStrategies.has(runKey)) {
      return this.repository.createStrategyRun({
        strategyId,
        status: "skipped",
        accountType,
        mode: strategy.executionMode,
        trigger,
        warnings: ["Strategy execution skipped because another run is already active."],
        skipReason: "Strategy run already in progress.",
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
      const { portfolio, marketSignals, marketContext, evaluation } = await this.evaluatePreparedStrategy(
        strategy,
        accountType,
        userScope
      );

      run = (await this.repository.updateStrategyRun(run.id, {
        inputSnapshot: {
          portfolio,
          marketSignals,
          marketContext,
        },
      }, userScope)) ?? run;

      await this.repository.saveExecutionPlan(evaluation.executionPlan, userScope);

      if (evaluation.marketGate && !evaluation.marketGate.passed) {
        const skipped = await this.repository.updateStrategyRun(run.id, {
          status: "skipped",
          completedAt: new Date().toISOString(),
          accountType,
          adjustedAllocation: evaluation.adjustedTargetAllocation,
          executionPlanId: evaluation.executionPlan.id,
          warnings: evaluation.warnings,
          marketGate: evaluation.marketGate,
          skipReason: evaluation.marketGate.blockingReasons[0] ?? "Strategy execution blocked by market context gate.",
        }, userScope);

        return skipped ?? run;
      }

      const completedAt = new Date().toISOString();
      const executionWarnings = [...evaluation.warnings];

      if (!evaluation.executionPlan.rebalanceRequired) {
        executionWarnings.push("No rebalance was required. Demo holdings were left unchanged.");
      } else {
        if (!Number.isFinite(portfolio.totalValue) || portfolio.totalValue <= 0) {
          throw new Error("Demo account has no value to rebalance. Seed the demo account before executing.");
        }

        const nextHoldings = await createDemoAccountHoldings(
          portfolio.baseCurrency,
          portfolio.totalValue,
          evaluation.adjustedTargetAllocation
        );

        await this.repository.setDemoAccountHoldings(nextHoldings, userScope);
        executionWarnings.push("Demo rebalance executed at current market prices.");
      }

      const completed = await this.repository.updateStrategyRun(run.id, {
        status: "completed",
        completedAt,
        accountType,
        adjustedAllocation: evaluation.adjustedTargetAllocation,
        executionPlanId: evaluation.executionPlan.id,
        warnings: executionWarnings,
      }, userScope);

      await this.repository.updateStrategyRunTimestamps(strategy.id, completedAt, userScope);

      return completed ?? run;
    } catch (error) {
      const failed = await this.repository.updateStrategyRun(run.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Strategy execution failed.",
      }, userScope);

      return failed ?? run;
    } finally {
      this.activeStrategies.delete(runKey);
    }
  }
}

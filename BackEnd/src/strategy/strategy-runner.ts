import { StrategyEngine } from "./strategy-engine.js";
import { StrategyRepository } from "./strategy-repository.js";
import { buildMarketSignalsFromPortfolio } from "./market-signal-service.js";
import { getLivePortfolioState } from "./portfolio-state-service.js";
import {
  MarketSignalSnapshot,
  PortfolioState,
  StrategyConfig,
  StrategyEvaluationResult,
  StrategyRun,
} from "./types.js";

export class StrategyRunner {
  private readonly activeStrategies = new Set<string>();

  constructor(private readonly repository: StrategyRepository, private readonly engine = new StrategyEngine()) {}

  isRunning(strategyId: string): boolean {
    return this.activeStrategies.has(strategyId);
  }

  async evaluateStrategyState(strategyId: string): Promise<{
    strategy: StrategyConfig;
    evaluation: StrategyEvaluationResult;
    portfolio: PortfolioState;
    marketSignals: MarketSignalSnapshot;
  } | null> {
    const strategy = await this.repository.getStrategy(strategyId);
    if (!strategy) return null;

    const portfolio = await getLivePortfolioState();
    const marketSignals = buildMarketSignalsFromPortfolio(portfolio);

    const evaluation = this.engine.evaluate({
      strategy,
      portfolio,
      marketSignals,
    });

    return {
      strategy,
      evaluation,
      portfolio,
      marketSignals,
    };
  }

  async runStrategy(strategyId: string, trigger: StrategyRun["trigger"] = "api"): Promise<StrategyRun> {
    const strategy = await this.repository.getStrategy(strategyId);
    if (!strategy) {
      throw new Error(`Strategy ${strategyId} was not found.`);
    }

    if (this.activeStrategies.has(strategyId)) {
      return this.repository.createStrategyRun({
        strategyId,
        status: "skipped",
        mode: strategy.executionMode,
        trigger,
      });
    }

    if (trigger === "schedule" && (!strategy.isEnabled || strategy.executionMode === "manual")) {
      return this.repository.createStrategyRun({
        strategyId,
        status: "skipped",
        mode: strategy.executionMode,
        trigger,
      });
    }

    this.activeStrategies.add(strategyId);

    let run = await this.repository.createStrategyRun({
      strategyId,
      status: "running",
      mode: strategy.executionMode,
      trigger,
    });

    try {
      const portfolio = await getLivePortfolioState();
      const marketSignals = buildMarketSignalsFromPortfolio(portfolio);

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
      });

      await this.repository.saveExecutionPlan(evaluation.executionPlan);

      const completedAt = new Date().toISOString();
      const completed = await this.repository.updateStrategyRun(run.id, {
        status: "completed",
        completedAt,
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
      this.activeStrategies.delete(strategyId);
    }
  }
}

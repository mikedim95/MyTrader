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
  RebalanceAllocationProfile,
  StrategyConfig,
  StrategyEvaluationResult,
  StrategyMarketContextSnapshot,
  StrategyProjectedHolding,
  StrategyRun,
} from "./types.js";

const LIVE_APPROVAL_REQUIRED = String(process.env.STRATEGY_REQUIRE_APPROVAL_FOR_REAL_RUNS ?? "true").toLowerCase() !== "false";
const GLOBAL_KILL_SWITCH_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.STRATEGY_GLOBAL_KILL_SWITCH ?? "false").toLowerCase()
);

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export class StrategyRunner {
  private readonly activeStrategies = new Set<string>();

  constructor(private readonly repository: StrategyRepository, private readonly engine = new StrategyEngine()) {}

  private runKey(
    strategyId: string,
    accountType: PortfolioAccountType,
    userScope?: StrategyUserScope,
    executionScopeKey = "default"
  ): string {
    return `${strategyUserScopeKey(userScope)}:${strategyId}:${accountType}:${executionScopeKey}`;
  }

  isRunning(
    strategyId: string,
    accountType: PortfolioAccountType = "real",
    userScope?: StrategyUserScope,
    executionScopeKey = "default"
  ): boolean {
    return this.activeStrategies.has(this.runKey(strategyId, accountType, userScope, executionScopeKey));
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

  private createProfileDemoSettings(profile: RebalanceAllocationProfile): DemoAccountSettings {
    return {
      balance: profile.allocatedCapital,
      updatedAt: profile.updatedAt,
      holdings: profile.holdings.map((holding) => ({ ...holding })),
    };
  }

  private attachProfileToEvaluation(
    evaluation: StrategyEvaluationResult,
    profile: RebalanceAllocationProfile
  ): StrategyEvaluationResult {
    return {
      ...evaluation,
      executionPlan: {
        ...evaluation.executionPlan,
        rebalanceAllocationId: profile.id,
        rebalanceAllocationName: profile.name,
      },
    };
  }

  private buildProjectedOutcome(
    portfolio: PortfolioState,
    evaluation: StrategyEvaluationResult,
    accountType: PortfolioAccountType
  ): StrategyEvaluationResult["projectedOutcome"] {
    const assetsBySymbol = new Map(portfolio.assets.map((asset) => [asset.symbol.toUpperCase(), asset]));
    const universe = Array.from(
      new Set([
        ...Object.keys(portfolio.allocation).map((symbol) => symbol.toUpperCase()),
        ...Object.keys(evaluation.adjustedTargetAllocation).map((symbol) => symbol.toUpperCase()),
      ])
    ).sort((left, right) => left.localeCompare(right));

    const holdings: StrategyProjectedHolding[] = universe.map((symbol) => {
      const asset = assetsBySymbol.get(symbol);
      const currentPercent = portfolio.allocation[symbol] ?? 0;
      const targetPercent = evaluation.adjustedTargetAllocation[symbol] ?? 0;
      const currentValue = asset?.value ?? (currentPercent / 100) * portfolio.totalValue;
      const targetValue = (targetPercent / 100) * portfolio.totalValue;
      const currentPrice = asset?.price ?? (symbol === portfolio.baseCurrency.toUpperCase() ? 1 : 0);
      const currentQuantity = asset?.quantity ?? (currentPrice > 0 ? currentValue / currentPrice : 0);
      const targetQuantity = currentPrice > 0 ? targetValue / currentPrice : 0;

      return {
        symbol,
        currentPercent: round(currentPercent, 4),
        targetPercent: round(targetPercent, 4),
        currentValue: round(currentValue, 2),
        targetValue: round(targetValue, 2),
        currentQuantity: round(currentQuantity, 8),
        targetQuantity: round(targetQuantity, 8),
        deltaValue: round(targetValue - currentValue, 2),
      };
    });

    return {
      generatedAt: evaluation.evaluatedAt,
      accountType,
      baseCurrency: portfolio.baseCurrency,
      portfolioValue: round(portfolio.totalValue, 2),
      driftPct: round(evaluation.executionPlan.driftPct, 4),
      estimatedTurnoverPct: round(evaluation.executionPlan.estimatedTurnoverPct, 4),
      projectedAllocation: { ...evaluation.adjustedTargetAllocation },
      holdings,
    };
  }

  private getLiveRiskBlockReason(strategy: StrategyConfig, accountType: PortfolioAccountType): string | null {
    if (accountType !== "real") return null;
    if (GLOBAL_KILL_SWITCH_ENABLED) {
      return "Real-account strategy execution is blocked because the global strategy kill switch is enabled.";
    }
    if (LIVE_APPROVAL_REQUIRED && strategy.approvalState !== "approved") {
      return `Real-account strategy execution requires approval. Current state: ${strategy.approvalState}.`;
    }
    if (LIVE_APPROVAL_REQUIRED && strategy.latestEvaluationSummary?.riskGatePassed !== true) {
      return "Real-account strategy execution requires a passing candidate evaluation with risk checks.";
    }
    return null;
  }

  private async evaluateResolvedStrategy(
    strategy: StrategyConfig,
    accountType: PortfolioAccountType,
    userScope?: StrategyUserScope,
    options?: { demoAccount?: DemoAccountSettings; baseCurrency?: string }
  ): Promise<{
    portfolio: PortfolioState;
    marketSignals: MarketSignalSnapshot;
    marketContext: StrategyMarketContextSnapshot;
    evaluation: StrategyEvaluationResult;
  }> {
    const demoSettings = options?.demoAccount ?? (await this.resolveDemoSettings(accountType, userScope));
    const baseCurrency = options?.baseCurrency ?? "USDC";
    const portfolio = await getPortfolioState(accountType, baseCurrency, { demoAccount: demoSettings, userScope });
    const marketSignals = buildMarketSignalsFromPortfolio(portfolio);
    const [marketContext, strategyUniverse] = await Promise.all([
      this.buildMarketContext(marketSignals, portfolio.timestamp),
      this.buildStrategyUniverse(userScope),
    ]);
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
    return this.evaluateResolvedStrategy(strategy, accountType, userScope);
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
    evaluation.projectedOutcome = this.buildProjectedOutcome(portfolio, evaluation, accountType);

    return {
      strategy,
      evaluation,
      portfolio,
      marketSignals,
      marketContext,
      accountType,
    };
  }

  async evaluateRebalanceAllocationProfileState(
    profileId: string,
    userScope?: StrategyUserScope
  ): Promise<{
    profile: RebalanceAllocationProfile;
    strategy: StrategyConfig;
    evaluation: StrategyEvaluationResult;
    portfolio: PortfolioState;
    marketSignals: MarketSignalSnapshot;
    marketContext: StrategyMarketContextSnapshot;
  } | null> {
    const profile = await this.repository.getRebalanceAllocationProfile(profileId, userScope);
    if (!profile) return null;

    const strategy = await this.repository.getStrategy(profile.strategyId, userScope);
    if (!strategy) {
      throw new Error(`Strategy ${profile.strategyId} linked to allocation ${profile.name} was not found.`);
    }
    if (!strategy.isEnabled) {
      throw new Error(`Strategy ${strategy.name} linked to allocation ${profile.name} is disabled.`);
    }

    const scopedStrategy: StrategyConfig = {
      ...strategy,
      baseAllocation: { ...profile.allocation },
    };

    const prepared = await this.evaluateResolvedStrategy(scopedStrategy, "demo", userScope, {
      demoAccount: this.createProfileDemoSettings(profile),
      baseCurrency: profile.baseCurrency,
    });
    prepared.evaluation.projectedOutcome = this.buildProjectedOutcome(prepared.portfolio, prepared.evaluation, "demo");

    return {
      profile,
      strategy,
      evaluation: this.attachProfileToEvaluation(prepared.evaluation, profile),
      portfolio: prepared.portfolio,
      marketSignals: prepared.marketSignals,
      marketContext: prepared.marketContext,
    };
  }

  private async autoExecuteLinkedProfiles(
    strategyId: string,
    trigger: StrategyRun["trigger"],
    userScope?: StrategyUserScope
  ): Promise<void> {
    const profiles = await this.repository.listRebalanceAllocationProfilesByStrategy(strategyId, userScope);
    const eligibleProfiles = profiles.filter((profile) => profile.isEnabled && profile.executionPolicy === "on_strategy_run");
    if (eligibleProfiles.length === 0) return;

    for (const profile of eligibleProfiles) {
      try {
        await this.executeRebalanceAllocationProfile(profile.id, trigger, userScope, { respectAutoThreshold: true });
      } catch (error) {
        console.error(
          `[strategy-runner] auto-execution failed for profile=${profile.id} strategy=${strategyId}:`,
          error instanceof Error ? error.message : error
        );
      }
    }
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

    const liveRiskBlockReason = this.getLiveRiskBlockReason(strategy, accountType);
    if (liveRiskBlockReason) {
      const skipped = await this.repository.createStrategyRun(
        {
          strategyId,
          status: "skipped",
          accountType,
          mode: strategy.executionMode,
          trigger,
          warnings: [liveRiskBlockReason],
          skipReason: liveRiskBlockReason,
        },
        userScope
      );
      if (trigger === "schedule") {
        await this.repository.updateStrategyRunTimestamps(strategy.id, new Date().toISOString(), userScope);
      }
      return skipped;
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
        skipReason: !strategy.isEnabled ? "Strategy is disabled." : "Manual strategies do not run on the scheduler.",
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
      evaluation.projectedOutcome = this.buildProjectedOutcome(portfolio, evaluation, accountType);

      run = (await this.repository.updateStrategyRun(
        run.id,
        {
          inputSnapshot: {
            portfolio,
            marketSignals,
            marketContext,
          },
        },
        userScope
      )) ?? run;

      await this.repository.saveExecutionPlan(evaluation.executionPlan, userScope);

      if (evaluation.marketGate && !evaluation.marketGate.passed) {
        const completedAt = new Date().toISOString();
        const skipped = await this.repository.updateStrategyRun(
          run.id,
          {
            status: "skipped",
            completedAt,
            accountType,
            adjustedAllocation: evaluation.adjustedTargetAllocation,
            executionPlanId: evaluation.executionPlan.id,
            warnings: evaluation.warnings,
            marketGate: evaluation.marketGate,
            skipReason: evaluation.marketGate.blockingReasons[0] ?? "Strategy execution blocked by market context gate.",
          },
          userScope
        );

        if (trigger === "schedule") {
          await this.repository.updateStrategyRunTimestamps(strategy.id, completedAt, userScope);
        }

        return skipped ?? run;
      }

      const completedAt = new Date().toISOString();
      const completed = await this.repository.updateStrategyRun(
        run.id,
        {
          status: "completed",
          completedAt,
          accountType,
          adjustedAllocation: evaluation.adjustedTargetAllocation,
          executionPlanId: evaluation.executionPlan.id,
          warnings: evaluation.warnings,
        },
        userScope
      );

      await this.repository.updateStrategyRunTimestamps(strategy.id, completedAt, userScope);
      await this.autoExecuteLinkedProfiles(strategy.id, trigger, userScope);

      return completed ?? run;
    } catch (error) {
      const failed = await this.repository.updateStrategyRun(
        run.id,
        {
          status: "failed",
          completedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : "Strategy run failed.",
        },
        userScope
      );

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
      evaluation.projectedOutcome = this.buildProjectedOutcome(portfolio, evaluation, accountType);

      run = (await this.repository.updateStrategyRun(
        run.id,
        {
          inputSnapshot: {
            portfolio,
            marketSignals,
            marketContext,
          },
        },
        userScope
      )) ?? run;

      await this.repository.saveExecutionPlan(evaluation.executionPlan, userScope);

      if (evaluation.marketGate && !evaluation.marketGate.passed) {
        const skipped = await this.repository.updateStrategyRun(
          run.id,
          {
            status: "skipped",
            completedAt: new Date().toISOString(),
            accountType,
            adjustedAllocation: evaluation.adjustedTargetAllocation,
            executionPlanId: evaluation.executionPlan.id,
            warnings: evaluation.warnings,
            marketGate: evaluation.marketGate,
            skipReason: evaluation.marketGate.blockingReasons[0] ?? "Strategy execution blocked by market context gate.",
          },
          userScope
        );

        return skipped ?? run;
      }

      const completedAt = new Date().toISOString();
      const executionWarnings = [...evaluation.warnings];
      const shouldForceManualRebalance = trigger === "api" && evaluation.executionPlan.driftPct > 0;

      if (!evaluation.executionPlan.rebalanceRequired && !shouldForceManualRebalance) {
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
        executionWarnings.push(
          shouldForceManualRebalance && !evaluation.executionPlan.rebalanceRequired
            ? "Manual execution executed the demo rebalance to the exact target allocation at current market prices."
            : "Demo rebalance executed at current market prices."
        );
      }

      const completed = await this.repository.updateStrategyRun(
        run.id,
        {
          status: "completed",
          completedAt,
          accountType,
          adjustedAllocation: evaluation.adjustedTargetAllocation,
          executionPlanId: evaluation.executionPlan.id,
          warnings: executionWarnings,
        },
        userScope
      );

      await this.repository.updateStrategyRunTimestamps(strategy.id, completedAt, userScope);

      return completed ?? run;
    } catch (error) {
      const failed = await this.repository.updateStrategyRun(
        run.id,
        {
          status: "failed",
          completedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : "Strategy execution failed.",
        },
        userScope
      );

      return failed ?? run;
    } finally {
      this.activeStrategies.delete(runKey);
    }
  }

  async executeRebalanceAllocationProfile(
    profileId: string,
    trigger: StrategyRun["trigger"] = "api",
    userScope?: StrategyUserScope,
    options?: { respectAutoThreshold?: boolean }
  ): Promise<StrategyRun> {
    const profile = await this.repository.getRebalanceAllocationProfile(profileId, userScope);
    if (!profile) {
      throw new Error(`Rebalance allocation ${profileId} was not found.`);
    }

    const strategy = await this.repository.getStrategy(profile.strategyId, userScope);
    if (!strategy) {
      throw new Error(`Strategy ${profile.strategyId} linked to allocation ${profile.name} was not found.`);
    }
    if (!strategy.isEnabled) {
      const skipped = await this.repository.createStrategyRun(
        {
          strategyId: profile.strategyId,
          rebalanceAllocationId: profile.id,
          rebalanceAllocationName: profile.name,
          status: "skipped",
          accountType: "demo",
          mode: strategy.executionMode,
          trigger,
          warnings: ["Allocation execution skipped because the linked strategy is disabled."],
          skipReason: "Linked strategy is disabled.",
        },
        userScope
      );
      if (trigger === "schedule") {
        await this.repository.markRebalanceAllocationProfileEvaluated(profile.id, new Date().toISOString(), userScope);
      }
      return skipped;
    }

    const runKey = this.runKey(strategy.id, "demo", userScope, profile.id);
    if (this.activeStrategies.has(runKey)) {
      return this.repository.createStrategyRun({
        strategyId: strategy.id,
        rebalanceAllocationId: profile.id,
        rebalanceAllocationName: profile.name,
        status: "skipped",
        accountType: "demo",
        mode: strategy.executionMode,
        trigger,
        warnings: ["Allocation execution skipped because another run is already active."],
        skipReason: "Allocation run already in progress.",
      }, userScope);
    }

    this.activeStrategies.add(runKey);

    let run = await this.repository.createStrategyRun({
      strategyId: strategy.id,
      rebalanceAllocationId: profile.id,
      rebalanceAllocationName: profile.name,
      status: "running",
      accountType: "demo",
      mode: strategy.executionMode,
      trigger,
    }, userScope);

    try {
      const scopedStrategy: StrategyConfig = {
        ...strategy,
        baseAllocation: { ...profile.allocation },
      };

      const { portfolio, marketSignals, marketContext, evaluation } = await this.evaluateResolvedStrategy(scopedStrategy, "demo", userScope, {
        demoAccount: this.createProfileDemoSettings(profile),
        baseCurrency: profile.baseCurrency,
      });
      evaluation.projectedOutcome = this.buildProjectedOutcome(portfolio, evaluation, "demo");
      const evaluationWithProfile = this.attachProfileToEvaluation(evaluation, profile);
      const evaluatedAt = new Date().toISOString();

      await this.repository.markRebalanceAllocationProfileEvaluated(profile.id, evaluatedAt, userScope);

      run = (await this.repository.updateStrategyRun(
        run.id,
        {
          inputSnapshot: {
            portfolio,
            marketSignals,
            marketContext,
          },
        },
        userScope
      )) ?? run;

      await this.repository.saveExecutionPlan(evaluationWithProfile.executionPlan, userScope);

      if (evaluationWithProfile.marketGate && !evaluationWithProfile.marketGate.passed) {
        const skipped = await this.repository.updateStrategyRun(
          run.id,
          {
            status: "skipped",
            completedAt: evaluatedAt,
            accountType: "demo",
            adjustedAllocation: evaluationWithProfile.adjustedTargetAllocation,
            executionPlanId: evaluationWithProfile.executionPlan.id,
            warnings: evaluationWithProfile.warnings,
            marketGate: evaluationWithProfile.marketGate,
            skipReason:
              evaluationWithProfile.marketGate.blockingReasons[0] ?? "Allocation execution blocked by market context gate.",
          },
          userScope
        );

        return skipped ?? run;
      }

      const driftThreshold = profile.autoExecuteMinDriftPct ?? 0;
      if (
        options?.respectAutoThreshold &&
        Number.isFinite(driftThreshold) &&
        driftThreshold > 0 &&
        evaluationWithProfile.executionPlan.driftPct < driftThreshold
      ) {
        const skipped = await this.repository.updateStrategyRun(
          run.id,
          {
            status: "skipped",
            completedAt: evaluatedAt,
            accountType: "demo",
            adjustedAllocation: evaluationWithProfile.adjustedTargetAllocation,
            executionPlanId: evaluationWithProfile.executionPlan.id,
            warnings: [
              ...evaluationWithProfile.warnings,
              `Auto execution skipped because drift ${evaluationWithProfile.executionPlan.driftPct.toFixed(2)}% is below threshold ${driftThreshold.toFixed(2)}%.`,
            ],
            skipReason: "Auto execution threshold not met.",
          },
          userScope
        );

        return skipped ?? run;
      }

      const completedAt = new Date().toISOString();
      const executionWarnings = [...evaluationWithProfile.warnings];
      const shouldForceManualRebalance =
        trigger === "api" && evaluationWithProfile.executionPlan.driftPct > 0;

      if (!evaluationWithProfile.executionPlan.rebalanceRequired && !shouldForceManualRebalance) {
        executionWarnings.push("No rebalance was required. Allocation holdings were left unchanged.");
      } else {
        if (!Number.isFinite(portfolio.totalValue) || portfolio.totalValue <= 0) {
          throw new Error("Allocation has no value to rebalance. Seed it before executing.");
        }

        const nextHoldings = await createDemoAccountHoldings(
          profile.baseCurrency,
          portfolio.totalValue,
          evaluationWithProfile.adjustedTargetAllocation
        );

        await this.repository.applyRebalanceAllocationProfileExecution(profile.id, nextHoldings, completedAt, userScope);
        executionWarnings.push(
          shouldForceManualRebalance && !evaluationWithProfile.executionPlan.rebalanceRequired
            ? "Manual execution executed the allocation rebalance to the exact target allocation at current market prices."
            : "Allocation rebalance executed at current market prices."
        );
      }

      const completed = await this.repository.updateStrategyRun(
        run.id,
        {
          status: "completed",
          completedAt,
          accountType: "demo",
          adjustedAllocation: evaluationWithProfile.adjustedTargetAllocation,
          executionPlanId: evaluationWithProfile.executionPlan.id,
          warnings: executionWarnings,
        },
        userScope
      );

      return completed ?? run;
    } catch (error) {
      const failed = await this.repository.updateStrategyRun(
        run.id,
        {
          status: "failed",
          completedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : "Allocation execution failed.",
        },
        userScope
      );

      return failed ?? run;
    } finally {
      this.activeStrategies.delete(runKey);
    }
  }
}

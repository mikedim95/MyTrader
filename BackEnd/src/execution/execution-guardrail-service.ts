import { buildMarketSignalsFromPortfolio } from "../strategy/market-signal-service.js";
import { getPortfolioState } from "../strategy/portfolio-state-service.js";
import { StrategyRepository } from "../strategy/strategy-repository.js";
import type { PortfolioAccountType } from "../strategy/types.js";
import type { StrategyUserScope } from "../strategy/strategy-user-scope.js";
import type { DecisionIntelligenceResponse } from "../decision/decision-service.js";
import { DecisionIntelligenceService } from "../decision/decision-service.js";
import { BtcNewsInsightsService } from "../news/news-service.js";
import { getTickerSnapshot } from "../portfolioService.js";
import {
  ExecutionGuardrailStatus,
  SignalOutcomeService,
  type SignalAction,
} from "./signal-review-service.js";

const MIN_CONFIDENCE_THRESHOLD = clampConfidence(process.env.EXECUTION_GUARDRAIL_MIN_CONFIDENCE, 0.55);
const MAX_POSITION_SIZE_PCT = clampPercent(process.env.EXECUTION_GUARDRAIL_MAX_POSITION_SIZE_PCT, 25);
const MAX_BTC_EXPOSURE_PCT = clampPercent(process.env.EXECUTION_GUARDRAIL_MAX_BTC_EXPOSURE_PCT, 55);
const COOLDOWN_MINUTES = clampPositive(process.env.EXECUTION_GUARDRAIL_COOLDOWN_MINUTES, 60);
const MAX_DAILY_TURNOVER_PCT = clampPercent(process.env.EXECUTION_GUARDRAIL_MAX_DAILY_TURNOVER_PCT, 75);
const NEWS_SHOCK_BEARISH_BIAS = clampSigned(process.env.EXECUTION_GUARDRAIL_NEWS_SHOCK_BEARISH_BIAS, -6);
const VOLATILITY_LOCKOUT_THRESHOLD = clampPositive(process.env.EXECUTION_GUARDRAIL_VOLATILITY_LOCKOUT, 0.08);
const MILD_REDUCTION_FACTOR = clampReduction(process.env.EXECUTION_GUARDRAIL_MILD_REDUCTION_FACTOR, 0.5);

export interface ExecutionGuardrailEvaluationRequest {
  accountType?: PortfolioAccountType;
  proposedAction: SignalAction;
  asset: string;
  requestedSize: number;
  decisionContext?: Partial<DecisionIntelligenceResponse>;
  currentPortfolioExposure?: {
    assetExposurePct?: number;
    btcExposurePct?: number;
  };
  volatilityMetric?: number;
}

export interface ExecutionGuardrailEvaluationResponse {
  allowed: boolean;
  status: ExecutionGuardrailStatus;
  adjusted_size: number | null;
  reasons: string[];
  triggered_guardrails: string[];
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clampPercent(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, parsed));
}

function clampConfidence(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, parsed));
}

function clampPositive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function clampReduction(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0.1, Math.min(0.95, parsed));
}

function clampSigned(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function normalizeAction(value: string): SignalAction {
  const normalized = value.trim().toLowerCase();
  if (normalized === "buy" || normalized === "sell" || normalized === "hold") {
    return normalized;
  }
  return "hold";
}

function normalizeAsset(value: string): string {
  return value.trim().toUpperCase();
}

function mergeDecisionContext(
  base: DecisionIntelligenceResponse,
  override?: Partial<DecisionIntelligenceResponse>
): DecisionIntelligenceResponse {
  if (!override) {
    return base;
  }

  return {
    technical_score: Number.isFinite(override.technical_score) ? Number(override.technical_score) : base.technical_score,
    news_score: Number.isFinite(override.news_score) ? Number(override.news_score) : base.news_score,
    portfolio_score: Number.isFinite(override.portfolio_score) ? Number(override.portfolio_score) : base.portfolio_score,
    final_score: Number.isFinite(override.final_score) ? Number(override.final_score) : base.final_score,
    market_regime: override.market_regime ?? base.market_regime,
    recommendation: override.recommendation ?? base.recommendation,
    confidence: Number.isFinite(override.confidence) ? Number(override.confidence) : base.confidence,
    top_contributors: Array.isArray(override.top_contributors) ? override.top_contributors : base.top_contributors,
    blockers: Array.isArray(override.blockers) ? override.blockers : base.blockers,
    summary:
      typeof override.summary === "string" && override.summary.trim().length > 0 ? override.summary : base.summary,
  };
}

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

export class ExecutionGuardrailService {
  constructor(
    private readonly repository: StrategyRepository,
    private readonly decisionIntelligenceService: DecisionIntelligenceService,
    private readonly btcNewsInsightsService: BtcNewsInsightsService,
    private readonly signalOutcomeService: SignalOutcomeService
  ) {}

  async evaluate(
    request: ExecutionGuardrailEvaluationRequest,
    userScope?: StrategyUserScope
  ): Promise<ExecutionGuardrailEvaluationResponse> {
    const accountType = request.accountType === "demo" ? "demo" : "real";
    const action = normalizeAction(request.proposedAction);
    const asset = normalizeAsset(request.asset);
    const requestedSize = Math.max(0, round(Number(request.requestedSize) || 0, 4));
    const demoAccount = accountType === "demo" ? await this.repository.getDemoAccountSettings(userScope) : undefined;
    const portfolio = await getPortfolioState(accountType, "USDC", { demoAccount, userScope });
    const signals = buildMarketSignalsFromPortfolio(portfolio);
    const decision = mergeDecisionContext(
      await this.decisionIntelligenceService.getDecisionIntelligence(accountType, userScope),
      request.decisionContext
    );
    const news = await this.btcNewsInsightsService.getInsights();

    const currentAssetExposure =
      request.currentPortfolioExposure?.assetExposurePct ?? Number(portfolio.allocation[asset] ?? 0);
    const currentBtcExposure =
      request.currentPortfolioExposure?.btcExposurePct ?? Number(portfolio.allocation.BTC ?? 0);
    const volatilityMetric = Number.isFinite(request.volatilityMetric)
      ? Number(request.volatilityMetric)
      : Number(signals.indicators.volatility ?? 0);

    const reasons: string[] = [];
    const triggeredGuardrails: string[] = [];
    let adjustedSize = requestedSize;
    let blocked = false;

    if (action !== "hold" && requestedSize <= 0) {
      blocked = true;
      pushUnique(triggeredGuardrails, "invalid_requested_size");
      reasons.push("Requested size must be greater than 0 for buy or sell evaluations.");
    }

    if (!blocked && action === "sell") {
      if (currentAssetExposure <= 0) {
        blocked = true;
        pushUnique(triggeredGuardrails, "no_available_exposure");
        reasons.push(`${asset} has no current exposure available to reduce.`);
      } else if (adjustedSize > currentAssetExposure) {
        adjustedSize = round(currentAssetExposure, 4);
        pushUnique(triggeredGuardrails, "position_size_clamp");
        reasons.push(
          `${asset} sell size was reduced to ${adjustedSize.toFixed(2)}% because only ${currentAssetExposure.toFixed(2)}% is currently exposed.`
        );
      }
    }

    if (!blocked && action === "buy") {
      const availablePositionRoom = Math.max(0, MAX_POSITION_SIZE_PCT - currentAssetExposure);
      if (availablePositionRoom <= 0) {
        blocked = true;
        pushUnique(triggeredGuardrails, "max_position_size");
        reasons.push(`${asset} is already at the ${MAX_POSITION_SIZE_PCT.toFixed(2)}% position cap.`);
      } else if (adjustedSize > availablePositionRoom) {
        adjustedSize = round(availablePositionRoom, 4);
        pushUnique(triggeredGuardrails, "max_position_size");
        reasons.push(
          `${asset} buy size was reduced to ${adjustedSize.toFixed(2)}% to stay within the ${MAX_POSITION_SIZE_PCT.toFixed(2)}% position cap.`
        );
      }
    }

    if (!blocked && action !== "hold" && decision.confidence < MIN_CONFIDENCE_THRESHOLD) {
      blocked = true;
      pushUnique(triggeredGuardrails, "min_confidence_threshold");
      reasons.push(
        `Decision confidence ${(decision.confidence * 100).toFixed(0)}% is below the ${(MIN_CONFIDENCE_THRESHOLD * 100).toFixed(0)}% minimum threshold.`
      );
    }

    if (!blocked && action === "buy" && asset === "BTC" && currentBtcExposure + adjustedSize > MAX_BTC_EXPOSURE_PCT) {
      blocked = true;
      pushUnique(triggeredGuardrails, "max_btc_exposure");
      reasons.push(
        `BTC exposure would rise to ${(currentBtcExposure + adjustedSize).toFixed(2)}%, above the ${MAX_BTC_EXPOSURE_PCT.toFixed(2)}% cap.`
      );
    }

    if (!blocked && action !== "hold") {
      const lastActionAt = await this.signalOutcomeService.getMostRecentActionAt(asset, accountType, userScope);
      if (lastActionAt) {
        const elapsedMinutes = (Date.now() - new Date(lastActionAt).getTime()) / 60_000;
        if (Number.isFinite(elapsedMinutes) && elapsedMinutes < COOLDOWN_MINUTES) {
          blocked = true;
          pushUnique(triggeredGuardrails, "cooldown_after_last_trade");
          reasons.push(
            `${asset} is still inside the ${COOLDOWN_MINUTES.toFixed(0)} minute cooldown window after the last approved action.`
          );
        }
      }
    }

    if (!blocked && action !== "hold") {
      const turnoverUsed = await this.signalOutcomeService.getDailyTurnoverPct(
        accountType,
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        userScope
      );
      const turnoverRoom = Math.max(0, MAX_DAILY_TURNOVER_PCT - turnoverUsed);
      if (turnoverRoom <= 0) {
        blocked = true;
        pushUnique(triggeredGuardrails, "max_daily_turnover");
        reasons.push(`Daily turnover has already reached the ${MAX_DAILY_TURNOVER_PCT.toFixed(2)}% cap.`);
      } else if (adjustedSize > turnoverRoom) {
        adjustedSize = round(turnoverRoom, 4);
        pushUnique(triggeredGuardrails, "max_daily_turnover");
        reasons.push(
          `Requested size was reduced to ${adjustedSize.toFixed(2)}% because only ${turnoverRoom.toFixed(2)}% turnover room remains today.`
        );
      }
    }

    const conflictingTechnicalNews =
      Math.abs(decision.technical_score) >= 3 &&
      Math.abs(decision.news_score) >= 3 &&
      Math.sign(decision.technical_score) !== Math.sign(decision.news_score);

    if (!blocked && action === "buy" && news.summary.bias_1h <= NEWS_SHOCK_BEARISH_BIAS) {
      blocked = true;
      pushUnique(triggeredGuardrails, "news_shock_lockout");
      reasons.push(
        `1h BTC news bias is sharply bearish (${news.summary.bias_1h.toFixed(2)}), so buy actions are locked out.`
      );
    }

    if (!blocked && action !== "hold" && volatilityMetric >= VOLATILITY_LOCKOUT_THRESHOLD) {
      blocked = true;
      pushUnique(triggeredGuardrails, "volatility_lockout");
      reasons.push(
        `Observed volatility (${volatilityMetric.toFixed(4)}) is above the ${VOLATILITY_LOCKOUT_THRESHOLD.toFixed(4)} lockout threshold.`
      );
    }

    if (!blocked && action !== "hold" && conflictingTechnicalNews) {
      blocked = true;
      pushUnique(triggeredGuardrails, "conflicting_signal_lockout");
      reasons.push("Technical and news signals are strongly conflicting, so directional action is blocked.");
    }

    if (!blocked && action === "buy" && decision.final_score <= -2) {
      blocked = true;
      pushUnique(triggeredGuardrails, "decision_direction_conflict");
      reasons.push("The unified decision score is defensive, so buy actions are blocked.");
    }

    if (!blocked && action === "sell" && decision.final_score >= 2) {
      blocked = true;
      pushUnique(triggeredGuardrails, "decision_direction_conflict");
      reasons.push("The unified decision score is constructive, so sell actions are blocked.");
    }

    if (!blocked && action === "buy" && decision.recommendation === "mild_buy_favorable") {
      const reducedSize = round(adjustedSize * MILD_REDUCTION_FACTOR, 4);
      if (reducedSize < adjustedSize) {
        adjustedSize = reducedSize;
        pushUnique(triggeredGuardrails, "mild_environment_size_reduction");
        reasons.push(
          `Buy size was reduced to ${adjustedSize.toFixed(2)}% because the environment is only mildly favorable.`
        );
      }
    }

    if (!blocked && action === "sell" && decision.recommendation === "mild_sell_favorable") {
      const reducedSize = round(adjustedSize * MILD_REDUCTION_FACTOR, 4);
      if (reducedSize < adjustedSize) {
        adjustedSize = reducedSize;
        pushUnique(triggeredGuardrails, "mild_environment_size_reduction");
        reasons.push(
          `Sell size was reduced to ${adjustedSize.toFixed(2)}% because the environment is only mildly defensive.`
        );
      }
    }

    const status: ExecutionGuardrailStatus = blocked
      ? "blocked"
      : adjustedSize < requestedSize
        ? "reduced"
        : "allowed";
    const adjustedSizeResponse = status === "blocked" ? null : adjustedSize;

    if (reasons.length === 0) {
      reasons.push("No execution guardrail blocked the proposed action.");
    }

    const livePrice = await this.resolveAssetPrice(asset, portfolio);

    await this.signalOutcomeService.recordSignalOutcome(
      {
        accountType,
        asset,
        technicalScore: decision.technical_score,
        newsScore: decision.news_score,
        finalScore: decision.final_score,
        recommendation: decision.recommendation,
        confidence: decision.confidence,
        marketRegime: decision.market_regime,
        actionTaken: action,
        requestedSize,
        adjustedSize: adjustedSizeResponse,
        guardrailStatus: status,
        newsBias1h: news.summary.bias_1h,
        currentBtcExposurePct: currentBtcExposure,
        priceAtSignal: livePrice,
        reasons,
        triggeredGuardrails,
      },
      userScope
    );

    return {
      allowed: status !== "blocked",
      status,
      adjusted_size: adjustedSizeResponse,
      reasons,
      triggered_guardrails: triggeredGuardrails,
    };
  }

  private async resolveAssetPrice(
    asset: string,
    portfolio: Awaited<ReturnType<typeof getPortfolioState>>
  ): Promise<number | null> {
    const portfolioAsset = portfolio.assets.find((entry) => entry.symbol === asset);
    if (portfolioAsset?.price && Number.isFinite(portfolioAsset.price) && portfolioAsset.price > 0) {
      return round(portfolioAsset.price, 8);
    }

    try {
      const ticker = await getTickerSnapshot(asset);
      return round(ticker.price, 8);
    } catch {
      return null;
    }
  }
}

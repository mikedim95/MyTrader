import { buildMarketSignalsFromPortfolio } from "../strategy/market-signal-service.js";
import { getPortfolioState } from "../strategy/portfolio-state-service.js";
import { buildLiveStrategyMarketContext } from "../strategy/strategy-market-context.js";
import { detectMarketRegime } from "../strategy/strategy-regime.js";
import { StrategyRepository } from "../strategy/strategy-repository.js";
import type { StrategyUserScope } from "../strategy/strategy-user-scope.js";
import type { MarketSignalSnapshot, PortfolioAccountType, PortfolioState, StrategyMarketContextSnapshot } from "../strategy/types.js";
import type { BtcNewsInsightsResponse } from "../news/news-service.js";
import { BtcNewsInsightsService } from "../news/news-service.js";

export type DecisionMarketRegime = "trend_up" | "trend_down" | "range" | "uncertain";
export type DecisionRecommendation =
  | "buy_favorable"
  | "mild_buy_favorable"
  | "hold_neutral"
  | "mild_sell_favorable"
  | "sell_favorable";

export interface DecisionIntelligenceResponse {
  technical_score: number;
  news_score: number;
  portfolio_score: number;
  final_score: number;
  market_regime: DecisionMarketRegime;
  recommendation: DecisionRecommendation;
  confidence: number;
  top_contributors: string[];
  blockers: string[];
  summary: string;
}

interface DecisionInputSnapshot {
  portfolio: PortfolioState;
  signals: MarketSignalSnapshot;
  marketContext: StrategyMarketContextSnapshot;
  news: BtcNewsInsightsResponse;
}

interface WeightedReason {
  message: string;
  weight: number;
}

interface ScoreContribution {
  score: number;
  reasons: WeightedReason[];
  blockers: string[];
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatTopic(value: string | null | undefined): string {
  if (!value) {
    return "uncategorized";
  }

  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${round(value, 2).toFixed(2)}`;
}

function normalizeTextList(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  values.forEach((value) => {
    const next = value.trim();
    if (!next || seen.has(next)) {
      return;
    }
    seen.add(next);
    normalized.push(next);
  });

  return normalized;
}

function resolveRecommendation(finalScore: number): DecisionRecommendation {
  if (finalScore >= 6) return "buy_favorable";
  if (finalScore >= 2) return "mild_buy_favorable";
  if (finalScore > -2) return "hold_neutral";
  if (finalScore > -6) return "mild_sell_favorable";
  return "sell_favorable";
}

function resolveDecisionMarketRegime(
  technicalScore: number,
  newsScore: number,
  signals: MarketSignalSnapshot,
  marketContext: StrategyMarketContextSnapshot
): DecisionMarketRegime {
  const volatility = Number(signals.indicators.volatility ?? 0);
  const conflictingInputs =
    (technicalScore >= 3 && newsScore <= -3) ||
    (technicalScore <= -3 && newsScore >= 3);

  if (volatility >= 0.06 || marketContext.overheatingWarning || conflictingInputs) {
    return "uncertain";
  }
  if (technicalScore >= 4 && newsScore >= 2) {
    return "trend_up";
  }
  if (technicalScore <= -4 && newsScore <= -2) {
    return "trend_down";
  }
  if (Math.abs(technicalScore) < 3 && Math.abs(newsScore) < 3) {
    return "range";
  }
  return "uncertain";
}

function resolveTargetBtcExposure(contextScore: number): number {
  if (contextScore >= 6) return 50;
  if (contextScore >= 2) return 40;
  if (contextScore > -2) return 30;
  if (contextScore > -6) return 20;
  return 12;
}

function buildTechnicalContribution(
  signals: MarketSignalSnapshot,
  marketContext: StrategyMarketContextSnapshot
): ScoreContribution {
  const reasons: WeightedReason[] = [];
  const blockers: string[] = [];
  const marketDirection = Number(signals.indicators.market_direction ?? 0);
  const volatility = Number(signals.indicators.volatility ?? 0);
  const directionContribution = marketDirection * 3.5;
  const longMaContribution = clamp((marketContext.btcPriceVsLongMaPct ?? 0) / 5, -4, 4);
  const volatilityContribution = clamp((0.045 - volatility) * 90, -2.5, 1.5);
  const overheatingPenalty = marketContext.overheatingWarning ? -1.5 : 0;

  if (marketDirection > 0) {
    reasons.push({
      message: "Technical momentum is positive across the current portfolio universe.",
      weight: Math.abs(directionContribution),
    });
  } else if (marketDirection < 0) {
    reasons.push({
      message: "Technical momentum is negative across the current portfolio universe.",
      weight: Math.abs(directionContribution),
    });
  }

  if (Math.abs(longMaContribution) >= 0.5) {
    reasons.push({
      message:
        marketContext.btcPriceVsLongMaPct >= 0
          ? `BTC is trading ${round(marketContext.btcPriceVsLongMaPct, 1).toFixed(1)}% above its long-term trend.`
          : `BTC is trading ${round(Math.abs(marketContext.btcPriceVsLongMaPct), 1).toFixed(1)}% below its long-term trend.`,
      weight: Math.abs(longMaContribution),
    });
  }

  if (volatilityContribution >= 0.75) {
    reasons.push({
      message: "Observed volatility is contained, which supports cleaner technical signals.",
      weight: Math.abs(volatilityContribution),
    });
  }

  if (volatility >= 0.06) {
    blockers.push("Market volatility is elevated, so technical follow-through is less reliable.");
  }
  if (marketContext.overheatingWarning) {
    blockers.push("BTC cycle overheating warning is active.");
  }

  return {
    score: clamp(round(directionContribution + longMaContribution + volatilityContribution + overheatingPenalty), -10, 10),
    reasons,
    blockers,
  };
}

function buildNewsContribution(news: BtcNewsInsightsResponse): ScoreContribution {
  const reasons: WeightedReason[] = [];
  const blockers: string[] = [];
  const newsScore = clamp(round(news.summary.bias_6h), -10, 10);

  if (news.summary.total_items_24h === 0) {
    blockers.push("No BTC news items were available in the last 24h.");
    return {
      score: 0,
      reasons,
      blockers,
    };
  }

  if (newsScore >= 2) {
    reasons.push({
      message: `BTC news bias is supportive over 6h (${formatSigned(newsScore)}).`,
      weight: Math.abs(newsScore),
    });
  } else if (newsScore <= -2) {
    reasons.push({
      message: `BTC news bias is cautious over 6h (${formatSigned(newsScore)}).`,
      weight: Math.abs(newsScore),
    });
  } else {
    reasons.push({
      message: "BTC news flow is broadly balanced over the last 6 hours.",
      weight: 1,
    });
  }

  if (news.summary.dominant_topic_24h) {
    reasons.push({
      message: `Recent coverage is concentrated around ${formatTopic(news.summary.dominant_topic_24h)}.`,
      weight: 1.25,
    });
  }

  if (news.summary.bearish_count_24h > news.summary.bullish_count_24h && newsScore <= -2) {
    blockers.push("Recent article flow leans more bearish than bullish.");
  }

  return {
    score: newsScore,
    reasons,
    blockers,
  };
}

function buildPortfolioContribution(
  portfolio: PortfolioState,
  technicalScore: number,
  newsScore: number
): ScoreContribution {
  const reasons: WeightedReason[] = [];
  const blockers: string[] = [];
  const contextScore = round(technicalScore * 0.7 + newsScore * 0.3);
  const currentBtcExposure = Number(portfolio.allocation.BTC ?? 0);
  const targetBtcExposure = resolveTargetBtcExposure(contextScore);
  const gap = targetBtcExposure - currentBtcExposure;

  let score = 0;

  if (contextScore >= 2 && gap > 3) {
    score = clamp(round(gap / 5), 0, 6);
    reasons.push({
      message: `Portfolio BTC exposure (${currentBtcExposure.toFixed(1)}%) is below the current context target (${targetBtcExposure.toFixed(1)}%).`,
      weight: Math.abs(score),
    });
  } else if (contextScore <= -2 && gap < -3) {
    score = -clamp(round(Math.abs(gap) / 5), 0, 6);
    reasons.push({
      message: `Portfolio BTC exposure (${currentBtcExposure.toFixed(1)}%) is high for the current defensive context (${targetBtcExposure.toFixed(1)}%).`,
      weight: Math.abs(score),
    });
    blockers.push("Current BTC exposure is already elevated for a defensive backdrop.");
  } else if (Math.abs(gap) <= 5) {
    reasons.push({
      message: "Portfolio BTC exposure is broadly aligned with the current backdrop.",
      weight: 0.75,
    });
  }

  return {
    score: clamp(round(score), -10, 10),
    reasons,
    blockers,
  };
}

export function buildDecisionIntelligenceFromInputs(input: DecisionInputSnapshot): DecisionIntelligenceResponse {
  const technical = buildTechnicalContribution(input.signals, input.marketContext);
  const news = buildNewsContribution(input.news);
  const portfolio = buildPortfolioContribution(input.portfolio, technical.score, news.score);

  const finalScore = clamp(round(technical.score * 0.6 + news.score * 0.25 + portfolio.score * 0.15), -10, 10);
  const recommendation = resolveRecommendation(finalScore);
  const marketRegime = resolveDecisionMarketRegime(technical.score, news.score, input.signals, input.marketContext);

  const topContributors = [...technical.reasons, ...news.reasons, ...portfolio.reasons]
    .sort((left, right) => {
      if (right.weight !== left.weight) {
        return right.weight - left.weight;
      }
      return left.message.localeCompare(right.message);
    })
    .map((entry) => entry.message)
    .slice(0, 4);

  const blockers = normalizeTextList([...technical.blockers, ...news.blockers, ...portfolio.blockers]);
  const technicalNewsAligned =
    technical.score === 0 ||
    news.score === 0 ||
    Math.sign(technical.score) === Math.sign(news.score);
  const confidence = clamp(
    round(
      0.2 +
        Math.min(1, Math.abs(finalScore) / 10) * 0.4 +
        (technicalNewsAligned ? 0.25 : 0.08) +
        (input.news.summary.total_items_24h === 0 ? 0.05 : input.news.summary.total_items_24h < 4 ? 0.1 : 0.15) -
        Math.min(0.3, blockers.length * 0.08),
      4
    ),
    0,
    1
  );

  const recommendationText: Record<DecisionRecommendation, string> = {
    buy_favorable: "Buy conditions look favorable.",
    mild_buy_favorable: "Conditions lean mildly favorable for buying.",
    hold_neutral: "Conditions are broadly neutral for holding.",
    mild_sell_favorable: "Conditions lean mildly favorable for de-risking.",
    sell_favorable: "Conditions favor reducing risk.",
  };

  const summaryParts = [
    recommendationText[recommendation],
    `Technicals score ${formatSigned(technical.score)}, news scores ${formatSigned(news.score)}, and portfolio positioning contributes ${formatSigned(portfolio.score)}.`,
  ];

  if (blockers.length > 0) {
    summaryParts.push(`Main caution: ${blockers[0]}`);
  } else {
    summaryParts.push("No strong blocker detected.");
  }

  return {
    technical_score: technical.score,
    news_score: news.score,
    portfolio_score: portfolio.score,
    final_score: finalScore,
    market_regime: marketRegime,
    recommendation,
    confidence,
    top_contributors: normalizeTextList(topContributors),
    blockers,
    summary: summaryParts.join(" "),
  };
}

export class DecisionIntelligenceService {
  constructor(
    private readonly repository: StrategyRepository,
    private readonly btcNewsInsightsService: BtcNewsInsightsService
  ) {}

  async getDecisionIntelligence(
    accountType: PortfolioAccountType = "real",
    userScope?: StrategyUserScope
  ): Promise<DecisionIntelligenceResponse> {
    const demoAccount = accountType === "demo" ? await this.repository.getDemoAccountSettings(userScope) : undefined;
    const portfolio = await getPortfolioState(accountType, "USDC", { demoAccount, userScope });
    const signals = buildMarketSignalsFromPortfolio(portfolio);
    const marketContext = await buildLiveStrategyMarketContext(portfolio.timestamp, detectMarketRegime(signals));
    const news = await this.btcNewsInsightsService.getInsights();

    return buildDecisionIntelligenceFromInputs({
      portfolio,
      signals,
      marketContext,
      news,
    });
  }
}

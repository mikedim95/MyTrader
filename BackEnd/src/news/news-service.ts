import type { RowDataPacket } from "mysql2/promise";
import pool from "../db.js";

const NEWS_TABLE = "`newsFeed`.`btc_news_items`";

export type BtcNewsCurrentState =
  | "bullish"
  | "mildly_bullish"
  | "neutral"
  | "mildly_bearish"
  | "bearish";

export interface BtcNewsInsightsSummary {
  bias_1h: number;
  bias_6h: number;
  bias_24h: number;
  total_items_24h: number;
  bullish_count_24h: number;
  bearish_count_24h: number;
  neutral_count_24h: number;
  dominant_topic_24h: string | null;
  current_state: BtcNewsCurrentState;
}

export interface BtcNewsInsightArticle {
  id: number;
  source: string;
  title: string;
  url: string;
  published_at: string | null;
  topic: string | null;
  sentiment: string | null;
  confidence: number;
  impact_score: number;
  time_horizon: string | null;
  btc_direction: string | null;
  action_bias: string | null;
  weighted_score: number;
  ai_summary: string | null;
  why_it_matters: string | null;
  raw_summary: string | null;
  created_at: string | null;
}

export interface BtcNewsTopicBreakdownItem {
  topic: string;
  count: number;
  total_weighted_score: number;
}

export interface BtcNewsActionBreakdown {
  buy_count: number;
  sell_count: number;
  hold_count: number;
}

export interface BtcNewsInsightsResponse {
  summary: BtcNewsInsightsSummary;
  top_articles: BtcNewsInsightArticle[];
  topic_breakdown: BtcNewsTopicBreakdownItem[];
  action_breakdown: BtcNewsActionBreakdown;
  generated_at: string;
}

interface SummaryRow extends RowDataPacket {
  bias_1h: number | string | null;
  bias_6h: number | string | null;
  bias_24h: number | string | null;
  total_items_24h: number | string | null;
  bullish_count_24h: number | string | null;
  bearish_count_24h: number | string | null;
  neutral_count_24h: number | string | null;
}

interface DominantTopicRow extends RowDataPacket {
  topic: string | null;
}

interface ArticleRow extends RowDataPacket {
  id: number | string;
  source: string | null;
  title: string | null;
  url: string | null;
  published_at: string | null;
  topic: string | null;
  sentiment: string | null;
  confidence: number | string | null;
  impact_score: number | string | null;
  time_horizon: string | null;
  btc_direction: string | null;
  action_bias: string | null;
  weighted_score: number | string | null;
  ai_summary: string | null;
  why_it_matters: string | null;
  raw_summary: string | null;
  created_at: string | null;
}

interface TopicBreakdownRow extends RowDataPacket {
  topic: string | null;
  count: number | string | null;
  total_weighted_score: number | string | null;
}

interface ActionBreakdownRow extends RowDataPacket {
  buy_count: number | string | null;
  sell_count: number | string | null;
  hold_count: number | string | null;
}

function toNumber(value: number | string | null | undefined, digits = 2): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function toInteger(value: number | string | null | undefined): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.trunc(numeric));
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function mapBiasToCurrentState(bias6h: number): BtcNewsCurrentState {
  if (bias6h >= 8) return "bullish";
  if (bias6h >= 3) return "mildly_bullish";
  if (bias6h > -3) return "neutral";
  if (bias6h > -8) return "mildly_bearish";
  return "bearish";
}

export class BtcNewsInsightsService {
  async getInsights(): Promise<BtcNewsInsightsResponse> {
    const [summaryRows, dominantTopicRows, topArticleRows, topicBreakdownRows, actionBreakdownRows] = await Promise.all([
      pool.query<SummaryRow[]>(
        `
          SELECT
            COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL 1 HOUR THEN COALESCE(weighted_score, 0) ELSE 0 END), 0) AS bias_1h,
            COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL 6 HOUR THEN COALESCE(weighted_score, 0) ELSE 0 END), 0) AS bias_6h,
            COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL 24 HOUR THEN COALESCE(weighted_score, 0) ELSE 0 END), 0) AS bias_24h,
            COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL 24 HOUR THEN 1 ELSE 0 END), 0) AS total_items_24h,
            COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL 24 HOUR AND LOWER(COALESCE(sentiment, '')) = 'bullish' THEN 1 ELSE 0 END), 0) AS bullish_count_24h,
            COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL 24 HOUR AND LOWER(COALESCE(sentiment, '')) = 'bearish' THEN 1 ELSE 0 END), 0) AS bearish_count_24h,
            COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL 24 HOUR AND LOWER(COALESCE(sentiment, '')) = 'neutral' THEN 1 ELSE 0 END), 0) AS neutral_count_24h
          FROM ${NEWS_TABLE}
        `
      ),
      pool.query<DominantTopicRow[]>(
        `
          SELECT COALESCE(NULLIF(TRIM(topic), ''), 'uncategorized') AS topic
          FROM ${NEWS_TABLE}
          WHERE created_at >= NOW() - INTERVAL 24 HOUR
          GROUP BY COALESCE(NULLIF(TRIM(topic), ''), 'uncategorized')
          ORDER BY COUNT(*) DESC, ABS(SUM(COALESCE(weighted_score, 0))) DESC, topic ASC
          LIMIT 1
        `
      ),
      pool.query<ArticleRow[]>(
        `
          SELECT
            id,
            source,
            title,
            url,
            published_at,
            topic,
            sentiment,
            confidence,
            impact_score,
            time_horizon,
            btc_direction,
            action_bias,
            weighted_score,
            ai_summary,
            why_it_matters,
            raw_summary,
            created_at
          FROM ${NEWS_TABLE}
          WHERE created_at >= NOW() - INTERVAL 24 HOUR
          ORDER BY ABS(COALESCE(weighted_score, 0)) DESC, COALESCE(published_at, created_at) DESC
          LIMIT 5
        `
      ),
      pool.query<TopicBreakdownRow[]>(
        `
          SELECT
            COALESCE(NULLIF(TRIM(topic), ''), 'uncategorized') AS topic,
            COUNT(*) AS count,
            COALESCE(SUM(COALESCE(weighted_score, 0)), 0) AS total_weighted_score
          FROM ${NEWS_TABLE}
          WHERE created_at >= NOW() - INTERVAL 24 HOUR
          GROUP BY COALESCE(NULLIF(TRIM(topic), ''), 'uncategorized')
          ORDER BY count DESC, ABS(total_weighted_score) DESC, topic ASC
        `
      ),
      pool.query<ActionBreakdownRow[]>(
        `
          SELECT
            COALESCE(SUM(CASE WHEN LOWER(COALESCE(action_bias, '')) = 'buy' THEN 1 ELSE 0 END), 0) AS buy_count,
            COALESCE(SUM(CASE WHEN LOWER(COALESCE(action_bias, '')) = 'sell' THEN 1 ELSE 0 END), 0) AS sell_count,
            COALESCE(SUM(CASE WHEN LOWER(COALESCE(action_bias, '')) = 'hold' THEN 1 ELSE 0 END), 0) AS hold_count
          FROM ${NEWS_TABLE}
          WHERE created_at >= NOW() - INTERVAL 24 HOUR
        `
      ),
    ]);

    const summaryRow = summaryRows[0][0];
    const dominantTopicRow = dominantTopicRows[0][0];
    const actionBreakdownRow = actionBreakdownRows[0][0];

    const summary: BtcNewsInsightsSummary = {
      bias_1h: toNumber(summaryRow?.bias_1h),
      bias_6h: toNumber(summaryRow?.bias_6h),
      bias_24h: toNumber(summaryRow?.bias_24h),
      total_items_24h: toInteger(summaryRow?.total_items_24h),
      bullish_count_24h: toInteger(summaryRow?.bullish_count_24h),
      bearish_count_24h: toInteger(summaryRow?.bearish_count_24h),
      neutral_count_24h: toInteger(summaryRow?.neutral_count_24h),
      dominant_topic_24h: normalizeNullableText(dominantTopicRow?.topic),
      current_state: mapBiasToCurrentState(toNumber(summaryRow?.bias_6h)),
    };

    return {
      summary,
      top_articles: topArticleRows[0].map((row) => ({
        id: toInteger(row.id),
        source: normalizeNullableText(row.source) ?? "Unknown source",
        title: normalizeNullableText(row.title) ?? "Untitled article",
        url: normalizeNullableText(row.url) ?? "",
        published_at: normalizeNullableText(row.published_at),
        topic: normalizeNullableText(row.topic),
        sentiment: normalizeNullableText(row.sentiment),
        confidence: toNumber(row.confidence, 4),
        impact_score: toNumber(row.impact_score),
        time_horizon: normalizeNullableText(row.time_horizon),
        btc_direction: normalizeNullableText(row.btc_direction),
        action_bias: normalizeNullableText(row.action_bias),
        weighted_score: toNumber(row.weighted_score),
        ai_summary: normalizeNullableText(row.ai_summary),
        why_it_matters: normalizeNullableText(row.why_it_matters),
        raw_summary: normalizeNullableText(row.raw_summary),
        created_at: normalizeNullableText(row.created_at),
      })),
      topic_breakdown: topicBreakdownRows[0].map((row) => ({
        topic: normalizeNullableText(row.topic) ?? "uncategorized",
        count: toInteger(row.count),
        total_weighted_score: toNumber(row.total_weighted_score),
      })),
      action_breakdown: {
        buy_count: toInteger(actionBreakdownRow?.buy_count),
        sell_count: toInteger(actionBreakdownRow?.sell_count),
        hold_count: toInteger(actionBreakdownRow?.hold_count),
      },
      generated_at: new Date().toISOString(),
    };
  }
}

import {
  ArrowUpRight,
  BrainCircuit,
  Clock3,
  Minus,
  Newspaper,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { useBtcNewsInsights } from "@/hooks/useTradingData";
import { cn } from "@/lib/utils";
import type {
  BtcNewsCurrentState,
  BtcNewsInsightArticle,
  BtcNewsInsightsResponse,
  BtcNewsTopicBreakdownItem,
} from "@/types/api";

const STATE_META: Record<
  BtcNewsCurrentState,
  {
    label: string;
    badgeClassName: string;
    accentClassName: string;
    icon: typeof TrendingUp;
  }
> = {
  bullish: {
    label: "Bullish",
    badgeClassName: "border-positive/30 bg-positive/10 text-positive",
    accentClassName: "text-positive",
    icon: TrendingUp,
  },
  mildly_bullish: {
    label: "Mildly Bullish",
    badgeClassName: "border-positive/20 bg-positive/5 text-positive",
    accentClassName: "text-positive",
    icon: TrendingUp,
  },
  neutral: {
    label: "Neutral",
    badgeClassName: "border-border bg-secondary/40 text-muted-foreground",
    accentClassName: "text-muted-foreground",
    icon: Minus,
  },
  mildly_bearish: {
    label: "Mildly Bearish",
    badgeClassName: "border-negative/20 bg-negative/5 text-negative",
    accentClassName: "text-negative",
    icon: TrendingDown,
  },
  bearish: {
    label: "Bearish",
    badgeClassName: "border-negative/30 bg-negative/10 text-negative",
    accentClassName: "text-negative",
    icon: TrendingDown,
  },
};

const ACTION_COLORS: Record<string, string> = {
  buy: "hsl(168, 100%, 48%)",
  sell: "hsl(340, 100%, 62%)",
  hold: "hsl(230, 32%, 62%)",
};

function formatBias(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function formatConfidence(value: number): string {
  const normalized = value <= 1 ? value * 100 : value;
  return `${normalized.toFixed(0)}%`;
}

function formatPublishedAt(value: string | null): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatTopic(value: string | null | undefined): string {
  if (!value) return "Uncategorized";
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getSentimentClassName(sentiment: string | null): string {
  switch ((sentiment ?? "").trim().toLowerCase()) {
    case "bullish":
      return "border-positive/20 bg-positive/5 text-positive";
    case "bearish":
      return "border-negative/20 bg-negative/5 text-negative";
    default:
      return "border-border bg-secondary/40 text-muted-foreground";
  }
}

function getWeightedScoreClassName(score: number): string {
  if (score > 0) return "text-positive";
  if (score < 0) return "text-negative";
  return "text-muted-foreground";
}

function SummaryTile({
  label,
  value,
  helper,
  className,
}: {
  label: string;
  value: string | number;
  helper?: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 animate-fade-up">
      <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-2 text-lg font-mono font-semibold text-foreground", className)}>{value}</div>
      {helper ? <div className="mt-1 text-xs text-muted-foreground">{helper}</div> : null}
    </div>
  );
}

function ArticleCard({ article }: { article: BtcNewsInsightArticle }) {
  return (
    <article className="rounded-xl border border-border bg-card p-5 animate-fade-up">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        <span>{article.source}</span>
        <span className="text-border">•</span>
        <span>{formatPublishedAt(article.published_at)}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded border border-border bg-secondary/40 px-2 py-1 text-[11px] font-mono uppercase tracking-wider text-foreground">
          {formatTopic(article.topic)}
        </span>
        <span className={cn("rounded border px-2 py-1 text-[11px] font-mono uppercase tracking-wider", getSentimentClassName(article.sentiment))}>
          {article.sentiment ?? "neutral"}
        </span>
        <span className="rounded border border-border bg-secondary/40 px-2 py-1 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Confidence {formatConfidence(article.confidence)}
        </span>
        <span className={cn("rounded border border-border px-2 py-1 text-[11px] font-mono uppercase tracking-wider", getWeightedScoreClassName(article.weighted_score))}>
          Weighted {formatBias(article.weighted_score)}
        </span>
      </div>

      <h3 className="mt-4 text-base font-mono font-semibold text-foreground">{article.title}</h3>

      <div className="mt-4 space-y-3 text-sm text-muted-foreground">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Context</div>
          <p className="mt-1 leading-6 text-foreground/90">{article.ai_summary ?? article.raw_summary ?? "No AI summary available yet."}</p>
        </div>
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Why It Matters</div>
          <p className="mt-1 leading-6">{article.why_it_matters ?? "Context not available yet."}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-muted-foreground">
          <span>{article.action_bias ? `Bias ${article.action_bias}` : "Bias n/a"}</span>
          <span>{article.time_horizon ? `Horizon ${article.time_horizon}` : "Horizon n/a"}</span>
        </div>
        <a
          href={article.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-mono text-foreground transition-colors hover:border-primary/30 hover:bg-secondary/40"
        >
          Open Article
          <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      </div>
    </article>
  );
}

function TopicBreakdownTable({ items }: { items: BtcNewsTopicBreakdownItem[] }) {
  return (
    <div className="rounded-xl border border-border bg-card animate-fade-up overflow-hidden">
      <div className="border-b border-border px-5 py-4">
        <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Topic Breakdown</div>
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            {["Topic", "Count", "Weighted Score"].map((heading) => (
              <th
                key={heading}
                className="px-4 py-3 text-left text-[11px] font-mono uppercase tracking-wider text-muted-foreground last:text-right"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.topic} className="border-b border-border last:border-b-0">
              <td className="px-4 py-3 text-sm font-mono text-foreground">{formatTopic(item.topic)}</td>
              <td className="px-4 py-3 text-sm font-mono text-foreground">{item.count}</td>
              <td className={cn("px-4 py-3 text-right text-sm font-mono", getWeightedScoreClassName(item.total_weighted_score))}>
                {formatBias(item.total_weighted_score)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={`news-summary-skeleton-${index}`} className="h-24 w-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Skeleton className="h-[320px] w-full" />
        <Skeleton className="h-[320px] w-full" />
      </div>
      <Skeleton className="h-[320px] w-full" />
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={`news-article-skeleton-${index}`} className="h-72 w-full" />
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center animate-fade-scale-in">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-border bg-secondary/30 text-muted-foreground">
        <Newspaper className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-lg font-mono font-semibold text-foreground">No BTC news insights yet</h3>
      <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
        This pane will populate after the n8n workflow stores processed BTC news items in MySQL.
      </p>
    </div>
  );
}

export function BtcNewsInsightsPage() {
  const { data, isPending, error } = useBtcNewsInsights();
  const isLoading = isPending && !data;

  if (isLoading) {
    return <LoadingState />;
  }

  if (error && !data) {
    return (
      <div className="p-4 md:p-6">
        <div className="rounded-md border border-negative/30 bg-negative/10 px-4 py-3 text-sm text-negative">
          {error instanceof Error ? error.message : "Failed to load BTC news insights."}
        </div>
      </div>
    );
  }

  const insights = data as BtcNewsInsightsResponse | undefined;
  const summary = insights?.summary;
  const hasData = Boolean(summary && summary.total_items_24h > 0);

  if (!insights || !summary || !hasData) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <div>
          <h2 className="text-lg md:text-xl font-mono font-semibold text-foreground">BTC News Insights</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Context from processed BTC-specific news already stored by your workflow.
          </p>
        </div>
        <EmptyState />
      </div>
    );
  }

  const stateMeta = STATE_META[summary.current_state];
  const StateIcon = stateMeta.icon;

  const biasChartData = [
    { window: "1h", score: summary.bias_1h },
    { window: "6h", score: summary.bias_6h },
    { window: "24h", score: summary.bias_24h },
  ];

  const actionChartData = [
    { name: "buy", value: insights.action_breakdown.buy_count, fill: ACTION_COLORS.buy },
    { name: "sell", value: insights.action_breakdown.sell_count, fill: ACTION_COLORS.sell },
    { name: "hold", value: insights.action_breakdown.hold_count, fill: ACTION_COLORS.hold },
  ].filter((item) => item.value > 0);

  const topicChartData = insights.topic_breakdown.slice(0, 8).map((item, index) => ({
    name: formatTopic(item.topic),
    score: item.total_weighted_score,
    fill:
      item.total_weighted_score > 0
        ? "hsl(168, 100%, 48%)"
        : item.total_weighted_score < 0
          ? "hsl(340, 100%, 62%)"
          : ["hsl(230, 32%, 62%)", "hsl(45, 90%, 58%)", "hsl(200, 85%, 56%)", "hsl(280, 52%, 62%)"][index % 4],
  }));

  const sentimentCounts = [
    { label: "Bullish", value: summary.bullish_count_24h, className: "text-positive" },
    { label: "Bearish", value: summary.bearish_count_24h, className: "text-negative" },
    { label: "Neutral", value: summary.neutral_count_24h, className: "text-muted-foreground" },
  ];

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg md:text-xl font-mono font-semibold text-foreground">BTC News Insights</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Decision-support context from processed BTC-specific news in the last 24 hours.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-mono uppercase tracking-wider", stateMeta.badgeClassName)}>
            <StateIcon className="h-3.5 w-3.5" />
            {stateMeta.label}
          </div>
          <div className="text-xs font-mono text-muted-foreground">Updated {formatPublishedAt(insights.generated_at)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6 stagger-children">
        <SummaryTile label="Current State" value={stateMeta.label} className={stateMeta.accentClassName} />
        <SummaryTile label="News Bias 1h" value={formatBias(summary.bias_1h)} className={getWeightedScoreClassName(summary.bias_1h)} />
        <SummaryTile label="News Bias 6h" value={formatBias(summary.bias_6h)} className={getWeightedScoreClassName(summary.bias_6h)} />
        <SummaryTile label="News Bias 24h" value={formatBias(summary.bias_24h)} className={getWeightedScoreClassName(summary.bias_24h)} />
        <SummaryTile label="Items 24h" value={summary.total_items_24h} />
        <SummaryTile label="Dominant Topic" value={formatTopic(summary.dominant_topic_24h)} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-xl border border-border bg-card p-5 animate-fade-up">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">News Bias</div>
              <div className="mt-2 text-sm text-muted-foreground">Short, medium, and day context from aggregated weighted article scores.</div>
            </div>
            <BrainCircuit className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-4 h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={biasChartData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="window" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: "hsl(var(--secondary) / 0.4)" }}
                  contentStyle={{
                    background: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 12,
                    color: "hsl(var(--foreground))",
                  }}
                  formatter={(value: number) => [formatBias(Number(value)), "Bias"]}
                />
                <Bar dataKey="score" radius={[8, 8, 0, 0]} animationDuration={700}>
                  {biasChartData.map((entry) => (
                    <Cell
                      key={`bias-${entry.window}`}
                      fill={entry.score > 0 ? "hsl(168, 100%, 48%)" : entry.score < 0 ? "hsl(340, 100%, 62%)" : "hsl(230, 32%, 62%)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5 animate-fade-up">
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Sentiment Counts</div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {sentimentCounts.map((item) => (
                <div key={item.label} className="rounded-lg border border-border bg-secondary/20 p-4">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{item.label}</div>
                  <div className={cn("mt-2 text-xl font-mono font-semibold", item.className)}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 animate-fade-up">
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Action Breakdown</div>
            <div className="mt-2 text-sm text-muted-foreground">How the processed article set leans across buy, sell, and hold framing.</div>
            <div className="mt-4 h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 12,
                      color: "hsl(var(--foreground))",
                    }}
                    formatter={(value: number, name) => [value, String(name).toUpperCase()]}
                  />
                  <Pie
                    data={actionChartData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={58}
                    outerRadius={82}
                    paddingAngle={3}
                    animationDuration={800}
                  >
                    {actionChartData.map((entry) => (
                      <Cell key={`action-${entry.name}`} fill={entry.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs font-mono">
              {actionChartData.map((item) => (
                <div key={item.name} className="inline-flex items-center gap-2 text-muted-foreground">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.fill }} />
                  {item.name.toUpperCase()} {item.value}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-xl border border-border bg-card p-5 animate-fade-up">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Recent Drivers</div>
              <div className="mt-2 text-sm text-muted-foreground">Topic clusters contributing the most net context over the last 24 hours.</div>
            </div>
            <Clock3 className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-4 h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topicChartData} layout="vertical" margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.25} />
                <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={110}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "hsl(var(--secondary) / 0.35)" }}
                  contentStyle={{
                    background: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 12,
                    color: "hsl(var(--foreground))",
                  }}
                  formatter={(value: number) => [formatBias(Number(value)), "Weighted Score"]}
                />
                <Bar dataKey="score" radius={[0, 8, 8, 0]} animationDuration={850}>
                  {topicChartData.map((entry) => (
                    <Cell key={`topic-${entry.name}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <TopicBreakdownTable items={insights.topic_breakdown} />
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-muted-foreground" />
          <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Top Contributing Articles</div>
        </div>
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
          {insights.top_articles.map((article) => (
            <ArticleCard key={article.id} article={article} />
          ))}
        </div>
      </div>
    </div>
  );
}

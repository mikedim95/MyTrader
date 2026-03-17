import {
  AlertTriangle,
  BrainCircuit,
  Gauge,
  Minus,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { useDecisionIntelligence } from "@/hooks/useTradingData";
import { cn } from "@/lib/utils";
import type {
  DecisionIntelligenceResponse,
  DecisionMarketRegime,
  DecisionRecommendation,
  PortfolioAccountType,
} from "@/types/api";

interface DecisionIntelligencePageProps {
  accountType: PortfolioAccountType;
}

const RECOMMENDATION_META: Record<
  DecisionRecommendation,
  {
    label: string;
    badgeClassName: string;
    icon: typeof TrendingUp;
    helper: string;
  }
> = {
  buy_favorable: {
    label: "Buy Favorable",
    badgeClassName: "border-positive/30 bg-positive/10 text-positive",
    icon: TrendingUp,
    helper: "The combined context favors adding risk, but this layer remains informational only.",
  },
  mild_buy_favorable: {
    label: "Mild Buy Favorable",
    badgeClassName: "border-positive/20 bg-positive/5 text-positive",
    icon: TrendingUp,
    helper: "The backdrop leans constructive, but conviction is moderate rather than aggressive.",
  },
  hold_neutral: {
    label: "Hold Neutral",
    badgeClassName: "border-border bg-secondary/40 text-muted-foreground",
    icon: Minus,
    helper: "Signals are mixed or balanced, so the environment does not strongly favor action.",
  },
  mild_sell_favorable: {
    label: "Mild Sell Favorable",
    badgeClassName: "border-negative/20 bg-negative/5 text-negative",
    icon: TrendingDown,
    helper: "Conditions lean defensive, but not enough to imply strong urgency.",
  },
  sell_favorable: {
    label: "Sell Favorable",
    badgeClassName: "border-negative/30 bg-negative/10 text-negative",
    icon: TrendingDown,
    helper: "The combined context favors de-risking. This remains decision support, not execution.",
  },
};

const REGIME_LABELS: Record<DecisionMarketRegime, string> = {
  trend_up: "Trend Up",
  trend_down: "Trend Down",
  range: "Range",
  uncertain: "Uncertain",
};

function formatScore(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function formatConfidence(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function getScoreClassName(value: number): string {
  if (value > 0) return "text-positive";
  if (value < 0) return "text-negative";
  return "text-muted-foreground";
}

function LoadingState() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <Skeleton className="h-7 w-64" />
        <Skeleton className="mt-2 h-4 w-[32rem] max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={`decision-metric-${index}`} className="h-24 w-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Skeleton className="h-[320px] w-full" />
        <Skeleton className="h-[320px] w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center animate-fade-scale-in">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-border bg-secondary/30 text-muted-foreground">
        <BrainCircuit className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-lg font-mono font-semibold text-foreground">No decision context yet</h3>
      <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
        This view will populate once portfolio data, market context, or BTC news inputs become available.
      </p>
    </div>
  );
}

function MetricTile({
  label,
  value,
  helper,
  className,
}: {
  label: string;
  value: string;
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

function ListCard({
  title,
  icon: Icon,
  items,
  emptyText,
  tone = "default",
}: {
  title: string;
  icon: typeof Sparkles;
  items: string[];
  emptyText: string;
  tone?: "default" | "warning";
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 animate-fade-up">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", tone === "warning" ? "text-negative" : "text-primary")} />
        <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{title}</div>
      </div>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-secondary/20 px-4 py-3 text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          items.map((item, index) => (
            <div key={`${title}-${index}`} className="rounded-lg border border-border bg-secondary/20 px-4 py-3 text-sm text-foreground">
              {item}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function DecisionIntelligencePage({ accountType }: DecisionIntelligencePageProps) {
  const { data, isPending, error } = useDecisionIntelligence(accountType);
  const isLoading = isPending && !data;

  if (isLoading) {
    return <LoadingState />;
  }

  if (error && !data) {
    return (
      <div className="p-4 md:p-6">
        <div className="rounded-md border border-negative/30 bg-negative/10 px-4 py-3 text-sm text-negative">
          {error instanceof Error ? error.message : "Failed to load decision intelligence."}
        </div>
      </div>
    );
  }

  const decision = data as DecisionIntelligenceResponse | undefined;
  if (!decision || (!decision.summary && decision.top_contributors.length === 0 && decision.blockers.length === 0)) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <div>
          <h2 className="text-lg md:text-xl font-mono font-semibold text-foreground">Decision Intelligence</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Unified context from technicals, BTC news, and portfolio exposure.
          </p>
        </div>
        <EmptyState />
      </div>
    );
  }

  const recommendationMeta = RECOMMENDATION_META[decision.recommendation];
  const RecommendationIcon = recommendationMeta.icon;

  const scoreChartData = [
    { name: "Technical", value: decision.technical_score },
    { name: "News", value: decision.news_score },
    { name: "Portfolio", value: decision.portfolio_score },
    { name: "Final", value: decision.final_score },
  ];

  const confidenceChartData = [
    { name: "confidence", value: Math.max(0.001, decision.confidence), fill: "hsl(168, 100%, 48%)" },
    { name: "uncertainty", value: Math.max(0, 1 - decision.confidence), fill: "hsl(230, 18%, 22%)" },
  ];

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg md:text-xl font-mono font-semibold text-foreground">Decision Intelligence</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One explainable context layer built from technicals, BTC news, and current portfolio exposure.
          </p>
        </div>
        <div className="text-xs font-mono text-muted-foreground">Account context: {accountType.toUpperCase()}</div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-xl border border-border bg-card p-5 animate-fade-up">
          <div className="flex flex-wrap items-center gap-2">
            <div className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-mono uppercase tracking-wider", recommendationMeta.badgeClassName)}>
              <RecommendationIcon className="h-3.5 w-3.5" />
              {recommendationMeta.label}
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/30 px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-muted-foreground">
              <Gauge className="h-3.5 w-3.5" />
              {REGIME_LABELS[decision.market_regime]}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-[0.9fr_1.1fr]">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Summary</div>
              <p className="mt-3 max-w-2xl text-base leading-7 text-foreground">{decision.summary}</p>
              <p className="mt-4 text-sm text-muted-foreground">{recommendationMeta.helper}</p>
            </div>

            <div className="rounded-xl border border-border bg-secondary/20 p-4">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Decision Score</div>
              <div className={cn("mt-3 text-4xl font-mono font-semibold", getScoreClassName(decision.final_score))}>
                {formatScore(decision.final_score)}
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  <span>Confidence</span>
                  <span>{formatConfidence(decision.confidence)}</span>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary via-positive to-positive transition-[width] duration-700"
                    style={{ width: `${Math.max(4, decision.confidence * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 animate-fade-up">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Confidence Mix</div>
              <div className="mt-2 text-sm text-muted-foreground">
                A compact view of conviction versus residual uncertainty in the current decision context.
              </div>
            </div>
            <BrainCircuit className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="relative mt-4 h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip
                  formatter={(value: number, name) => [
                    name === "confidence" ? formatConfidence(Number(value)) : formatConfidence(Number(value)),
                    String(name),
                  ]}
                  contentStyle={{
                    background: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 12,
                    color: "hsl(var(--foreground))",
                  }}
                />
                <Pie
                  data={confidenceChartData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={72}
                  outerRadius={98}
                  startAngle={90}
                  endAngle={-270}
                  stroke="none"
                  animationDuration={900}
                >
                  {confidenceChartData.map((entry) => (
                    <Cell key={`confidence-${entry.name}`} fill={entry.fill} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Confidence</div>
              <div className="mt-2 text-3xl font-mono font-semibold text-foreground">{formatConfidence(decision.confidence)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 stagger-children">
        <MetricTile label="Technical Score" value={formatScore(decision.technical_score)} className={getScoreClassName(decision.technical_score)} />
        <MetricTile label="News Score" value={formatScore(decision.news_score)} className={getScoreClassName(decision.news_score)} />
        <MetricTile label="Portfolio Score" value={formatScore(decision.portfolio_score)} className={getScoreClassName(decision.portfolio_score)} />
        <MetricTile label="Market Regime" value={REGIME_LABELS[decision.market_regime]} helper="Deterministic regime mapping from current inputs." />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-xl border border-border bg-card p-5 animate-fade-up">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Score Blend</div>
              <div className="mt-2 text-sm text-muted-foreground">Technical, news, and positioning inputs before the final recommendation mapping.</div>
            </div>
            <Sparkles className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-4 h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={scoreChartData} layout="vertical" margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.25} />
                <XAxis type="number" domain={[-10, 10]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={88} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(value: number) => [formatScore(Number(value)), "Score"]}
                  contentStyle={{
                    background: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 12,
                    color: "hsl(var(--foreground))",
                  }}
                />
                <Bar dataKey="value" radius={[0, 8, 8, 0]} animationDuration={850}>
                  {scoreChartData.map((entry) => (
                    <Cell
                      key={`decision-score-${entry.name}`}
                      fill={entry.value > 0 ? "hsl(168, 100%, 48%)" : entry.value < 0 ? "hsl(340, 100%, 62%)" : "hsl(230, 18%, 40%)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 animate-fade-up">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Interpretation</div>
          </div>
          <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-border bg-secondary/20 p-4">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Recommendation</div>
              <div className={cn("mt-2 text-xl font-mono font-semibold", getScoreClassName(decision.final_score))}>{recommendationMeta.label}</div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/20 p-4">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Context</div>
              <div className="mt-2 text-sm leading-6 text-foreground">{decision.summary}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ListCard
          title="Top Contributors"
          icon={Sparkles}
          items={decision.top_contributors}
          emptyText="No strong contributor was detected."
        />
        <ListCard
          title="Blockers"
          icon={AlertTriangle}
          items={decision.blockers}
          emptyText="No strong blocker detected."
          tone="warning"
        />
      </div>
    </div>
  );
}

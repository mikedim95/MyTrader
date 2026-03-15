import { Activity, Flame, Loader2 } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FleetHistorySeries } from "@/types/api";

interface FleetHistoryChartsProps {
  history: FleetHistorySeries[];
  isLoading?: boolean;
}

const SERIES_COLORS = [
  "#00f5d4",
  "#ff9f1c",
  "#4cc9f0",
  "#f72585",
  "#84cc16",
  "#fb7185",
  "#38bdf8",
  "#eab308",
  "#c084fc",
  "#22c55e",
] as const;

type ChartMetricKey = "totalRateThs" | "maxTemp";

function formatAxisTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTooltipTime(value: string): string {
  return new Date(value).toLocaleString();
}

function getSeriesMeta(history: FleetHistorySeries[], metric: ChartMetricKey) {
  return history
    .filter((series) => series.points.some((point) => typeof point[metric] === "number"))
    .map((series, index) => ({
      key: `miner_${series.minerId}`,
      label: `${series.minerName} (${series.minerIp})`,
      color: SERIES_COLORS[index % SERIES_COLORS.length],
      points: series.points,
    }));
}

function buildChartRows(history: FleetHistorySeries[], metric: ChartMetricKey) {
  const rows = new Map<string, Record<string, string | number | null>>();

  for (const series of history) {
    const key = `miner_${series.minerId}`;

    for (const point of series.points) {
      const row = rows.get(point.timestamp) ?? {
        timestamp: point.timestamp,
      };

      row[key] = typeof point[metric] === "number" ? point[metric] : null;
      rows.set(point.timestamp, row);
    }
  }

  return Array.from(rows.values()).sort((left, right) => {
    const leftTime = new Date(String(left.timestamp)).getTime();
    const rightTime = new Date(String(right.timestamp)).getTime();
    return leftTime - rightTime;
  });
}

function ChartCard({
  title,
  subtitle,
  icon: Icon,
  history,
  metric,
  unit,
  isLoading = false,
}: {
  title: string;
  subtitle: string;
  icon: typeof Activity;
  history: FleetHistorySeries[];
  metric: ChartMetricKey;
  unit: string;
  isLoading?: boolean;
}) {
  const seriesMeta = getSeriesMeta(history, metric);
  const rows = buildChartRows(history, metric);
  const hasData = rows.length > 0 && seriesMeta.length > 0;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{title}</div>
          <div className="mt-1 text-sm font-mono text-muted-foreground">{subtitle}</div>
        </div>
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <Icon className="h-4 w-4 text-primary" />}
      </div>

      {hasData ? (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatAxisTime}
              minTickGap={24}
              tick={{ fontSize: 10, fontFamily: "IBM Plex Mono", fill: "hsl(230, 15%, 55%)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(value: number) => (metric === "totalRateThs" ? `${value.toFixed(0)}` : `${value.toFixed(0)}C`)}
              tick={{ fontSize: 10, fontFamily: "IBM Plex Mono", fill: "hsl(230, 15%, 55%)" }}
              width={44}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              labelFormatter={(value) => formatTooltipTime(String(value))}
              contentStyle={{
                background: "hsl(230, 28%, 8%)",
                border: "1px solid hsl(231, 18%, 16%)",
                borderRadius: "6px",
                fontFamily: "IBM Plex Mono",
                fontSize: "12px",
              }}
              labelStyle={{ color: "hsl(230, 15%, 55%)" }}
              itemStyle={{ color: "hsl(233, 38%, 92%)" }}
              formatter={(value: number, name: string) => [`${value.toFixed(metric === "totalRateThs" ? 2 : 1)} ${unit}`, name]}
            />
            <Legend wrapperStyle={{ fontFamily: "IBM Plex Mono", fontSize: "11px", paddingTop: "10px" }} />
            {seriesMeta.map((series) => (
              <Line
                key={series.key}
                type="monotone"
                dataKey={series.key}
                name={series.label}
                stroke={series.color}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex h-[280px] items-center justify-center rounded-lg border border-dashed border-border/80 bg-secondary/20">
          <div className="max-w-sm text-center">
            <div className="text-sm font-mono text-foreground">No historical {metric === "totalRateThs" ? "hashrate" : "temperature"} data yet.</div>
            <div className="mt-2 text-xs font-mono text-muted-foreground">
              The chart fills automatically as miner snapshots are written into MySQL by the fleet poller.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function FleetHistoryCharts({ history, isLoading = false }: FleetHistoryChartsProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartCard
        title="Fleet Hashrate History"
        subtitle="All registered miners from persisted backend snapshots."
        icon={Activity}
        history={history}
        metric="totalRateThs"
        unit="TH/s"
        isLoading={isLoading}
      />
      <ChartCard
        title="Fleet Temperature History"
        subtitle="Highest available temperature per miner at each saved snapshot."
        icon={Flame}
        history={history}
        metric="maxTemp"
        unit="C"
        isLoading={isLoading}
      />
    </div>
  );
}

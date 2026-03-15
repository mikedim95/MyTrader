import { useEffect, useMemo, useState } from "react";
import { Activity, Flame, Loader2 } from "lucide-react";
import { Brush, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FleetHistoryScope, FleetHistorySeries } from "@/types/api";

interface FleetHistoryChartsProps {
  history: FleetHistorySeries[];
  scope: FleetHistoryScope;
  onScopeChange: (scope: FleetHistoryScope) => void;
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

const SCOPE_OPTIONS: Array<{ value: FleetHistoryScope; label: string }> = [
  { value: "hour", label: "Hour" },
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

type ChartMetricKey = "totalRateThs" | "maxTemp";

function formatAxisTime(value: string, scope: FleetHistoryScope): string {
  const date = new Date(value);

  if (scope === "hour") {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (scope === "day") {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
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

function getDefaultBrushWindow(scope: FleetHistoryScope, rowCount: number) {
  const sizeByScope: Record<FleetHistoryScope, number> = {
    hour: 30,
    day: 32,
    week: 28,
    month: 24,
  };

  const desiredSize = sizeByScope[scope];
  const startIndex = Math.max(0, rowCount - desiredSize);
  const endIndex = Math.max(0, rowCount - 1);
  return { startIndex, endIndex };
}

function clampBrushIndex(value: number, rowCount: number): number {
  if (!Number.isFinite(value)) {
    return Math.max(0, rowCount - 1);
  }

  const normalized = Math.trunc(value);
  return Math.max(0, Math.min(Math.max(0, rowCount - 1), normalized));
}

function normalizeBrushWindow(
  next: { startIndex?: number; endIndex?: number } | undefined,
  previous: { startIndex: number; endIndex: number },
  rowCount: number
) {
  if (rowCount <= 0) {
    return { startIndex: 0, endIndex: 0 };
  }

  const safeStart = Number.isFinite(next?.startIndex)
    ? clampBrushIndex(next?.startIndex as number, rowCount)
    : previous.startIndex;
  const safeEnd = Number.isFinite(next?.endIndex)
    ? clampBrushIndex(next?.endIndex as number, rowCount)
    : previous.endIndex;

  if (safeStart <= safeEnd) {
    return { startIndex: safeStart, endIndex: safeEnd };
  }

  return { startIndex: safeEnd, endIndex: safeStart };
}

function ChartCard({
  title,
  subtitle,
  icon: Icon,
  history,
  metric,
  scope,
  unit,
  isLoading = false,
}: {
  title: string;
  subtitle: string;
  icon: typeof Activity;
  history: FleetHistorySeries[];
  metric: ChartMetricKey;
  scope: FleetHistoryScope;
  unit: string;
  isLoading?: boolean;
}) {
  const seriesMeta = useMemo(() => getSeriesMeta(history, metric), [history, metric]);
  const rows = useMemo(() => buildChartRows(history, metric), [history, metric]);
  const hasData = rows.length > 0 && seriesMeta.length > 0;
  const [brushWindow, setBrushWindow] = useState(() => getDefaultBrushWindow(scope, rows.length));

  useEffect(() => {
    setBrushWindow(getDefaultBrushWindow(scope, rows.length));
  }, [scope, rows.length]);

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
        <ResponsiveContainer width="100%" height={320}>
          <LineChart syncId="fleet-history" data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis
              dataKey="timestamp"
              tickFormatter={(value) => formatAxisTime(String(value), scope)}
              minTickGap={24}
              tick={{ fontSize: 10, fontFamily: "IBM Plex Mono", fill: "hsl(230, 15%, 55%)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(value: number) => (metric === "totalRateThs" ? `${value.toFixed(0)} TH` : `${value.toFixed(0)}C`)}
              tick={{ fontSize: 10, fontFamily: "IBM Plex Mono", fill: "hsl(230, 15%, 55%)" }}
              width={66}
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
            {seriesMeta.map((series, idx) => (
              <Line
                key={series.key}
                type="monotone"
                dataKey={series.key}
                name={series.label}
                stroke={series.color}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={true}
                animationDuration={1200 + idx * 200}
                animationEasing="ease-out"
              />
            ))}
            {rows.length > 1 ? (
              <Brush
                dataKey="timestamp"
                startIndex={brushWindow.startIndex}
                endIndex={brushWindow.endIndex}
                onChange={(next) =>
                  setBrushWindow((previous) => normalizeBrushWindow(next, previous, rows.length))
                }
                height={26}
                travellerWidth={10}
                stroke="#00f5d4"
                fill="rgba(10, 14, 26, 0.9)"
                tickFormatter={(value) => formatAxisTime(String(value), scope)}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed border-border/80 bg-secondary/20">
          <div className="max-w-sm text-center">
            <div className="text-sm font-mono text-foreground">
              No historical {metric === "totalRateThs" ? "hashrate" : "temperature"} data yet.
            </div>
            <div className="mt-2 text-xs font-mono text-muted-foreground">
              The chart fills automatically as miner snapshots are written into MySQL by the fleet poller.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function FleetHistoryCharts({ history, scope, onScopeChange, isLoading = false }: FleetHistoryChartsProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">History Scope</div>
          <div className="mt-1 text-sm font-mono text-muted-foreground">
            Hashrate is shown consistently per miner in TH/s. Use the slider under each chart to move the visible window.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {SCOPE_OPTIONS.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant={scope === option.value ? "default" : "outline"}
              className={cn("font-mono text-xs", scope === option.value ? "shadow-[0_0_0_1px_rgba(0,245,212,0.35)_inset]" : "")}
              onClick={() => onScopeChange(option.value)}
              disabled={isLoading}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Fleet Hashrate History"
          subtitle="Per-miner hashrate in TH/s from persisted backend snapshots."
          icon={Activity}
          history={history}
          metric="totalRateThs"
          scope={scope}
          unit="TH/s"
          isLoading={isLoading}
        />
        <ChartCard
          title="Fleet Temperature History"
          subtitle="Highest valid miner temperature per snapshot. Invalid zero readings are ignored."
          icon={Flame}
          history={history}
          metric="maxTemp"
          scope={scope}
          unit="C"
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}

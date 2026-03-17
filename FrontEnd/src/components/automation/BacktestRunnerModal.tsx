import { useEffect, useMemo, useState } from "react";
import { Brush, CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarRange, ChevronDown, ChevronUp, Loader2, SlidersHorizontal, Wallet2 } from "lucide-react";
import { useBacktestMarketPreview } from "@/hooks/useTradingData";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { BacktestMarketPreviewPoint } from "@/types/api";

interface BacktestRunnerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  strategyName?: string;
  initialCapital: string;
  onInitialCapitalChange: (value: string) => void;
  startDate: string;
  endDate: string;
  onDateRangeChange: (range: { startDate: string; endDate: string }) => void;
  timeframe: "1h" | "1d";
  rebalanceCostsPct: string;
  onRebalanceCostsPctChange: (value: string) => void;
  slippagePct: string;
  onSlippagePctChange: (value: string) => void;
  isSubmitting?: boolean;
  onSubmit: () => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PREVIEW_LOOKBACK_DAYS = 365 * 4;
const PRESET_OPTIONS = [
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "180D", days: 180 },
  { label: "1Y", days: 365 },
  { label: "2Y", days: 365 * 2 },
  { label: "4Y", days: 365 * 4 },
] as const;
const EMPTY_PREVIEW: BacktestMarketPreviewPoint[] = [];

function toDateInputValue(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatAxisDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--";
  return date.toLocaleDateString([], { month: "short", year: "2-digit" });
}

function formatTooltipDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
    notation: value >= 100000 ? "compact" : "standard",
  }).format(value);
}

function clampBrushIndex(value: number, rowCount: number): number {
  if (!Number.isFinite(value)) return Math.max(0, rowCount - 1);
  return Math.max(0, Math.min(Math.max(0, rowCount - 1), Math.trunc(value)));
}

function normalizeBrushWindow(
  next: { startIndex?: number; endIndex?: number } | undefined,
  previous: { startIndex: number; endIndex: number },
  rowCount: number
) {
  if (rowCount <= 0) return { startIndex: 0, endIndex: 0 };
  const safeStart = Number.isFinite(next?.startIndex) ? clampBrushIndex(next?.startIndex as number, rowCount) : previous.startIndex;
  const safeEnd = Number.isFinite(next?.endIndex) ? clampBrushIndex(next?.endIndex as number, rowCount) : previous.endIndex;
  if (safeStart <= safeEnd) return { startIndex: safeStart, endIndex: safeEnd };
  return { startIndex: safeEnd, endIndex: safeStart };
}

function getDateKey(value: string): string {
  return value.slice(0, 10);
}

function resolveRangeIndices(rows: BacktestMarketPreviewPoint[], startDate: string, endDate: string) {
  if (rows.length === 0) {
    return { startIndex: 0, endIndex: 0 };
  }

  const normalizedStart = startDate || getDateKey(rows[0].timestamp);
  const normalizedEnd = endDate || getDateKey(rows[rows.length - 1].timestamp);

  const startMatch = rows.findIndex((row) => getDateKey(row.timestamp) >= normalizedStart);
  const endMatchFromEnd = [...rows].reverse().findIndex((row) => getDateKey(row.timestamp) <= normalizedEnd);

  const startIndex = startMatch === -1 ? rows.length - 1 : startMatch;
  const endIndex = endMatchFromEnd === -1 ? 0 : rows.length - 1 - endMatchFromEnd;

  if (startIndex <= endIndex) {
    return { startIndex, endIndex };
  }

  return { startIndex: endIndex, endIndex: startIndex };
}

function getRangeLengthDays(startDate: string, endDate: string): number {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.max(1, Math.round((end - start) / DAY_MS) + 1);
}

function describeTimeframe(timeframe: "1h" | "1d"): string {
  return timeframe === "1h" ? "Hourly replay for shorter windows." : "Daily replay for longer windows.";
}

export function BacktestRunnerModal({
  open,
  onOpenChange,
  strategyName,
  initialCapital,
  onInitialCapitalChange,
  startDate,
  endDate,
  onDateRangeChange,
  timeframe,
  rebalanceCostsPct,
  onRebalanceCostsPctChange,
  slippagePct,
  onSlippagePctChange,
  isSubmitting = false,
  onSubmit,
}: BacktestRunnerModalProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const previewEndDate = useMemo(() => toDateInputValue(new Date()), []);
  const previewStartDate = useMemo(() => toDateInputValue(new Date(Date.now() - PREVIEW_LOOKBACK_DAYS * DAY_MS)), []);
  const previewRequest = open
    ? {
        startDate: previewStartDate,
        endDate: previewEndDate,
        timeframe: "1d" as const,
        baseCurrency: "USDC",
        symbol: "BTC",
      }
    : undefined;
  const { data: previewData, isPending: loadingPreview } = useBacktestMarketPreview(previewRequest);
  const previewRows = previewData?.history ?? EMPTY_PREVIEW;
  const selectedRange = useMemo(
    () => resolveRangeIndices(previewRows, startDate, endDate),
    [previewRows, startDate, endDate]
  );
  const selectedDays = useMemo(() => getRangeLengthDays(startDate, endDate), [startDate, endDate]);

  useEffect(() => {
    if (!open || previewRows.length === 0) {
      return;
    }

    const nextStartDate = getDateKey(previewRows[selectedRange.startIndex]?.timestamp ?? previewRows[0].timestamp);
    const nextEndDate = getDateKey(previewRows[selectedRange.endIndex]?.timestamp ?? previewRows[previewRows.length - 1].timestamp);

    if (nextStartDate !== startDate || nextEndDate !== endDate) {
      onDateRangeChange({ startDate: nextStartDate, endDate: nextEndDate });
    }
  }, [endDate, onDateRangeChange, open, previewRows, selectedRange.endIndex, selectedRange.startIndex, startDate]);

  const handleBrushChange = (next: { startIndex?: number; endIndex?: number } | undefined) => {
    const normalized = normalizeBrushWindow(next, selectedRange, previewRows.length);
    const nextStartDate = getDateKey(previewRows[normalized.startIndex]?.timestamp ?? startDate);
    const nextEndDate = getDateKey(previewRows[normalized.endIndex]?.timestamp ?? endDate);

    if (nextStartDate !== startDate || nextEndDate !== endDate) {
      onDateRangeChange({ startDate: nextStartDate, endDate: nextEndDate });
    }
  };

  const applyPreset = (days: number) => {
    if (previewRows.length === 0) {
      return;
    }

    const endIndex = previewRows.length - 1;
    const startIndex = Math.max(0, endIndex - Math.max(1, days - 1));
    onDateRangeChange({
      startDate: getDateKey(previewRows[startIndex].timestamp),
      endDate: getDateKey(previewRows[endIndex].timestamp),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden border-border bg-card p-0">
        <div className="flex max-h-[90vh] flex-col">
          <div className="border-b border-border bg-card px-6 py-5">
            <DialogHeader className="space-y-3 text-left">
              <div className="text-[11px] font-mono uppercase tracking-[0.24em] text-muted-foreground">Backtest Runner</div>
              <DialogTitle className="font-mono text-xl text-foreground">
                {strategyName ? `Replay ${strategyName}` : "Replay Strategy"}
              </DialogTitle>
              <DialogDescription className="max-w-3xl text-sm leading-6 text-muted-foreground">
                A backtest replays the selected strategy over historical BTC-led market snapshots. The required inputs are
                the market window and your starting capital. Execution assumptions like cost and slippage stay available
                under advanced settings if you want a stricter stress test.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-border bg-secondary/20 p-4">
                <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  <CalendarRange className="h-3.5 w-3.5" />
                  Replay Window
                </div>
                <div className="mt-3 text-base font-mono text-foreground">
                  {startDate} to {endDate}
                </div>
                <div className="mt-1 text-xs font-mono text-muted-foreground">{selectedDays} day window</div>
              </div>

              <div className="rounded-xl border border-border bg-secondary/20 p-4">
                <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  <Wallet2 className="h-3.5 w-3.5" />
                  Initial Capital
                </div>
                <input
                  value={initialCapital}
                  onChange={(event) => onInitialCapitalChange(event.target.value)}
                  className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none transition-colors focus:border-primary"
                  placeholder="10000"
                  disabled={isSubmitting}
                />
              </div>

              <div className="rounded-xl border border-border bg-secondary/20 p-4">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Simulation Resolution</div>
                <div className="mt-3 text-base font-mono text-foreground">{timeframe}</div>
                <div className="mt-1 text-xs font-mono text-muted-foreground">{describeTimeframe(timeframe)}</div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-background/50 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">BTC Range Picker</div>
                  <div className="mt-1 text-sm font-mono text-muted-foreground">
                    Drag the chart handles to choose the replay window. Shorter windows automatically switch to hourly
                    replay; longer windows use daily closes.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {PRESET_OPTIONS.map((option) => (
                    <Button
                      key={option.label}
                      type="button"
                      variant={selectedDays === option.days ? "default" : "outline"}
                      className={cn(
                        "h-8 px-3 font-mono text-[11px]",
                        selectedDays === option.days ? "shadow-[0_0_0_1px_rgba(0,245,212,0.35)_inset]" : ""
                      )}
                      disabled={loadingPreview || isSubmitting}
                      onClick={() => applyPreset(option.days)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="mt-4 h-[320px]">
                {loadingPreview ? (
                  <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border/70 bg-secondary/20">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : previewRows.length === 0 ? (
                  <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border/70 bg-secondary/20 px-6 text-center text-sm text-muted-foreground">
                    BTC preview history is unavailable right now.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={previewRows} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.25} />
                      <XAxis
                        dataKey="timestamp"
                        tickFormatter={(value) => formatAxisDate(String(value))}
                        minTickGap={28}
                        tick={{ fontSize: 11, fontFamily: "IBM Plex Mono", fill: "hsl(230, 15%, 55%)" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tickFormatter={(value: number) => formatCurrency(value)}
                        tick={{ fontSize: 11, fontFamily: "IBM Plex Mono", fill: "hsl(230, 15%, 55%)" }}
                        width={78}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        labelFormatter={(value) => formatTooltipDate(String(value))}
                        formatter={(value: number) => [formatCurrency(value), "BTC"]}
                        contentStyle={{
                          background: "hsl(230, 28%, 8%)",
                          border: "1px solid hsl(231, 18%, 16%)",
                          borderRadius: "6px",
                          fontFamily: "IBM Plex Mono",
                          fontSize: "12px",
                        }}
                        labelStyle={{ color: "hsl(230, 15%, 55%)" }}
                        itemStyle={{ color: "hsl(233, 38%, 92%)" }}
                      />
                      <ReferenceArea
                        x1={previewRows[selectedRange.startIndex]?.timestamp}
                        x2={previewRows[selectedRange.endIndex]?.timestamp}
                        fill="rgba(0,245,212,0.12)"
                        strokeOpacity={0}
                      />
                      <Line
                        type="monotone"
                        dataKey="price"
                        name="BTC"
                        stroke="#00f5d4"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                      {previewRows.length > 1 ? (
                        <Brush
                          dataKey="timestamp"
                          startIndex={selectedRange.startIndex}
                          endIndex={selectedRange.endIndex}
                          onChange={handleBrushChange}
                          height={28}
                          travellerWidth={10}
                          stroke="#00f5d4"
                          fill="rgba(10, 14, 26, 0.92)"
                          tickFormatter={(value) => formatAxisDate(String(value))}
                        />
                      ) : null}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-secondary/10">
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left"
                onClick={() => setShowAdvanced((previous) => !previous)}
              >
                <div>
                  <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Advanced Assumptions
                  </div>
                  <div className="mt-1 text-xs font-mono text-muted-foreground">
                    Transaction cost and slippage only matter if you want a harsher execution model.
                  </div>
                </div>
                {showAdvanced ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </button>

              {showAdvanced ? (
                <div className="grid gap-3 border-t border-border px-4 py-4 md:grid-cols-2">
                  <div>
                    <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Rebalance Cost %</label>
                    <input
                      value={rebalanceCostsPct}
                      onChange={(event) => onRebalanceCostsPctChange(event.target.value)}
                      className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none transition-colors focus:border-primary"
                      disabled={isSubmitting}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Slippage %</label>
                    <input
                      value={slippagePct}
                      onChange={(event) => onSlippagePctChange(event.target.value)}
                      className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none transition-colors focus:border-primary"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter className="border-t border-border bg-card px-6 py-4">
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs font-mono text-muted-foreground">
                Backtests always run in <span className="text-foreground">USDC</span> and use the selected BTC window as the
                replay range.
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" className="font-mono text-xs" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button type="button" className="font-mono text-xs" onClick={onSubmit} disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Start Backtest
                </Button>
              </div>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

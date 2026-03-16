import { memo, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pie, PieChart, Cell, ResponsiveContainer } from "recharts";
import { backendApi } from "@/lib/api";
import { useStrategies, useStrategyState } from "@/hooks/useTradingData";
import { cn } from "@/lib/utils";
import type { PortfolioAccountType } from "@/types/api";

const CHART_COLORS = [
  "hsl(168, 100%, 48%)",
  "hsl(230, 60%, 60%)",
  "hsl(340, 100%, 62%)",
  "hsl(45, 100%, 60%)",
  "hsl(200, 80%, 50%)",
  "hsl(280, 60%, 60%)",
  "hsl(120, 65%, 45%)",
  "hsl(10, 85%, 58%)",
];

function formatDateTime(value: string | undefined): string {
  if (!value) return "--";

  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "--";

  return parsed.toLocaleString();
}

function formatPercent(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value.toFixed(2)}%`;
}

function formatUsd(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const BASIC_STRATEGY_IDS = new Set<string>([
  "mean-reversion",
  "periodic-rebalancing",
  "relative-strength-rotation",
  "drawdown-protection",
  "volatility-hedge",
  "btc-dominance-rotation",
  "momentum-rotation",
]);

interface RebalancePageProps {
  accountType: PortfolioAccountType;
}

interface AllocationRow {
  symbol: string;
  current: number;
  target: number;
  diff: number;
}

interface AllocationChartSlice {
  name: string;
  value: number;
  color: string;
}

interface AllocationPieCardProps {
  title: string;
  data: AllocationChartSlice[];
  dataSignature: string;
  animationDelayMs?: number;
}

function buildAllocationSignature(rows: AllocationRow[]): string {
  return rows.map((row) => `${row.symbol}:${row.current.toFixed(4)}:${row.target.toFixed(4)}`).join("|");
}

function buildChartSignature(data: AllocationChartSlice[]): string {
  return data.map((entry) => `${entry.name}:${entry.value.toFixed(4)}`).join("|");
}

function renderAllocationLabel({ name, value }: { name?: string; value?: number }): string {
  if (!name || typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }

  return `${name} ${value.toFixed(1)}%`;
}

const AllocationPieCard = memo(
  function AllocationPieCard({ title, data, dataSignature, animationDelayMs = 0 }: AllocationPieCardProps) {
    return (
      <div
        className="rounded-lg border border-border bg-card p-5 animate-fade-scale-in [&_.recharts-layer]:transition-none [&_.recharts-sector]:transition-none [&_.recharts-text]:transition-none"
        style={{ animationDelay: `${animationDelayMs}ms` }}
      >
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-4 text-center">{title}</div>
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={108}
              dataKey="value"
              stroke="none"
              isAnimationActive={false}
              label={renderAllocationLabel}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  },
  (previousProps, nextProps) =>
    previousProps.title === nextProps.title &&
    previousProps.dataSignature === nextProps.dataSignature &&
    previousProps.animationDelayMs === nextProps.animationDelayMs
);

export function RebalancePage({ accountType }: RebalancePageProps) {
  const queryClient = useQueryClient();

  const { data: strategiesData, isPending: loadingStrategies, error: strategiesError } = useStrategies();
  const strategies = (strategiesData?.strategies ?? []).filter((strategy) => !BASIC_STRATEGY_IDS.has(strategy.id));

  const [selectedStrategyId, setSelectedStrategyId] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    if ((!selectedStrategyId || !strategies.some((strategy) => strategy.id === selectedStrategyId)) && strategies.length > 0) {
      setSelectedStrategyId(strategies[0].id);
    }
  }, [selectedStrategyId, strategies]);

  const selectedStrategy = useMemo(
    () => strategies.find((strategy) => strategy.id === selectedStrategyId) ?? null,
    [selectedStrategyId, strategies]
  );

  const {
    data: state,
    isPending: loadingState,
    error: stateError,
  } = useStrategyState(selectedStrategyId || undefined, accountType);

  const invalidateRebalanceQueries = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["strategy-runs", accountType] }),
      queryClient.invalidateQueries({ queryKey: ["strategies"] }),
      queryClient.invalidateQueries({ queryKey: ["strategy-state", selectedStrategyId, accountType] }),
      queryClient.invalidateQueries({ queryKey: ["strategy-execution-plan", selectedStrategyId, accountType] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard", accountType] }),
      queryClient.invalidateQueries({ queryKey: ["demo-account-settings"] }),
    ]);
  };

  const executeRebalanceMutation = useMutation({
    mutationFn: (strategyId: string) => backendApi.executeStrategyRebalance(strategyId, accountType),
    onSuccess: async (result) => {
      setErrorMessage("");
      const executionApplied = result.run.warnings.some((warning) =>
        warning.toLowerCase().includes("demo rebalance executed")
      );
      setMessage(
        executionApplied
          ? "Demo rebalance executed. Holdings were refreshed using current market prices."
          : `Rebalance execution completed with status: ${result.run.status}.`
      );
      await invalidateRebalanceQueries();
    },
    onError: (error) => {
      setMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Unable to execute rebalance.");
    },
  });

  const executionPlan = state?.executionPlan ?? null;
  const currentAllocation = executionPlan?.currentAllocation ?? state?.currentAllocation ?? {};
  const targetAllocation = executionPlan?.adjustedTargetAllocation ?? state?.adjustedTargetAllocation ?? {};

  const allocationRows = useMemo<AllocationRow[]>(() => {
    const symbols = Array.from(new Set([...Object.keys(currentAllocation), ...Object.keys(targetAllocation)])).sort((a, b) =>
      a.localeCompare(b)
    );

    return symbols.map((symbol) => {
      const current = currentAllocation[symbol] ?? 0;
      const target = targetAllocation[symbol] ?? 0;
      const diff = target - current;

      return {
        symbol,
        current,
        target,
        diff,
      };
    });
  }, [currentAllocation, targetAllocation]);

  const allocationSignature = useMemo(() => buildAllocationSignature(allocationRows), [allocationRows]);

  const allocationColors = useMemo(() => {
    return allocationRows.reduce<Record<string, string>>((colorMap, row, index) => {
      colorMap[row.symbol] = CHART_COLORS[index % CHART_COLORS.length];
      return colorMap;
    }, {});
  }, [allocationSignature]);

  const currentChart = useMemo<AllocationChartSlice[]>(() => {
    return allocationRows
      .filter((row) => row.current > 0)
      .map((row) => ({
        name: row.symbol,
        value: row.current,
        color: allocationColors[row.symbol],
      }));
  }, [allocationSignature]);

  const targetChart = useMemo<AllocationChartSlice[]>(() => {
    return allocationRows
      .filter((row) => row.target > 0)
      .map((row) => ({
        name: row.symbol,
        value: row.target,
        color: allocationColors[row.symbol],
      }));
  }, [allocationSignature]);

  const currentChartSignature = useMemo(() => buildChartSignature(currentChart), [currentChart]);
  const targetChartSignature = useMemo(() => buildChartSignature(targetChart), [targetChart]);

  const warnings = useMemo(() => {
    const combined = [...(executionPlan?.warnings ?? []), ...(state?.warnings ?? [])];
    return Array.from(new Set(combined));
  }, [executionPlan?.warnings, state?.warnings]);

  const handleExecuteRebalance = (): void => {
    if (!selectedStrategy) return;
    executeRebalanceMutation.mutate(selectedStrategy.id);
  };

  const rebalanceRequired = executionPlan?.rebalanceRequired ?? false;
  const canExecuteRebalance =
    accountType === "demo" &&
    Boolean(selectedStrategy) &&
    rebalanceRequired &&
    !loadingState &&
    !executeRebalanceMutation.isPending;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h2 className="text-lg font-mono font-semibold text-foreground">Rebalance</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Review the current trade plan and execute demo reallocations at current market prices.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <select
            value={selectedStrategyId}
            onChange={(event) => setSelectedStrategyId(event.target.value)}
            className="rounded-md border border-border bg-secondary px-3 py-2 text-xs font-mono text-foreground outline-none"
          >
            {strategies.length === 0 ? <option value="">No strategies</option> : null}
            {strategies.map((strategy) => (
              <option key={strategy.id} value={strategy.id}>
                {strategy.name}
              </option>
            ))}
          </select>

          <button
            onClick={handleExecuteRebalance}
            disabled={!canExecuteRebalance}
            className="px-4 py-2 rounded-md border border-border text-xs font-mono font-semibold text-foreground hover:bg-secondary disabled:opacity-60"
          >
            Execute Demo Rebalance
          </button>
        </div>
      </div>

      <div className="text-[11px] font-mono text-muted-foreground">
        Strategy evaluation stays in Automation. Execute applies the current target allocation to demo holdings using live market prices.
      </div>

      {message ? (
        <div className="rounded-md border border-positive/30 bg-positive/10 px-4 py-3 text-xs text-positive">{message}</div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-md border border-negative/30 bg-negative/10 px-4 py-3 text-xs text-negative">{errorMessage}</div>
      ) : null}

      {strategiesError ? (
        <div className="rounded-md border border-negative/30 bg-negative/10 px-4 py-3 text-xs text-negative">
          {strategiesError instanceof Error ? strategiesError.message : "Failed to load strategies."}
        </div>
      ) : null}

      {stateError ? (
        <div className="rounded-md border border-negative/30 bg-negative/10 px-4 py-3 text-xs text-negative">
          {stateError instanceof Error ? stateError.message : "Failed to evaluate strategy state."}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Selected Strategy</div>
          <div className="mt-2 text-sm font-mono text-foreground">{selectedStrategy?.name ?? "--"}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Rebalance Required</div>
          <div className={cn("mt-2 text-sm font-mono", rebalanceRequired ? "text-positive" : "text-muted-foreground")}>
            {rebalanceRequired ? "Yes" : "No"}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Drift</div>
          <div className="mt-2 text-sm font-mono text-foreground">{formatPercent(executionPlan?.driftPct)}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Estimated Turnover</div>
          <div className="mt-2 text-sm font-mono text-foreground">{formatPercent(executionPlan?.estimatedTurnoverPct)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <AllocationPieCard title="Current Allocation" data={currentChart} dataSignature={currentChartSignature} animationDelayMs={40} />
        <AllocationPieCard
          title="Adjusted Target Allocation"
          data={targetChart}
          dataSignature={targetChartSignature}
          animationDelayMs={140}
        />
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Allocation Delta
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              {["Asset", "Current", "Target", "Difference", "Action"].map((heading) => (
                <th
                  key={heading}
                  className="py-3 px-4 text-[10px] font-mono uppercase tracking-wider text-muted-foreground text-right first:text-left"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loadingStrategies || loadingState ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Loading rebalance view...
                </td>
              </tr>
            ) : allocationRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No allocation data available.
                </td>
              </tr>
            ) : (
              allocationRows.map((row) => (
                <tr key={row.symbol} className="border-b border-border">
                  <td className="py-3 px-4 text-left text-sm font-mono text-foreground">{row.symbol}</td>
                  <td className="py-3 px-4 text-right text-sm font-mono text-foreground">{row.current.toFixed(2)}%</td>
                  <td className="py-3 px-4 text-right text-sm font-mono text-foreground">{row.target.toFixed(2)}%</td>
                  <td
                    className={cn(
                      "py-3 px-4 text-right text-sm font-mono",
                      row.diff > 0 ? "text-positive" : row.diff < 0 ? "text-negative" : "text-muted-foreground"
                    )}
                  >
                    {row.diff > 0 ? "+" : ""}
                    {row.diff.toFixed(2)}%
                  </td>
                  <td className="py-3 px-4 text-right text-sm font-mono">
                    <span
                      className={cn(
                        "px-2 py-1 rounded text-[10px]",
                        row.diff > 0
                          ? "bg-positive/10 text-positive"
                          : row.diff < 0
                            ? "bg-negative/10 text-negative"
                            : "bg-secondary text-muted-foreground"
                      )}
                    >
                      {row.diff > 0 ? "BUY" : row.diff < 0 ? "SELL" : "HOLD"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Recommended Trades
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              {["Asset", "Side", "Current %", "Target %", "Notional", "Reason"].map((heading) => (
                <th
                  key={heading}
                  className="py-3 px-4 text-[10px] font-mono uppercase tracking-wider text-muted-foreground text-right first:text-left"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {executionPlan?.recommendedTrades?.length ? (
              executionPlan.recommendedTrades.map((trade, index) => (
                <tr key={`${trade.asset}-${trade.side}-${index}`} className="border-b border-border">
                  <td className="py-3 px-4 text-left text-sm font-mono text-foreground">{trade.asset}</td>
                  <td className={cn("py-3 px-4 text-right text-sm font-mono", trade.side === "BUY" ? "text-positive" : "text-negative")}>
                    {trade.side}
                  </td>
                  <td className="py-3 px-4 text-right text-sm font-mono text-foreground">{trade.currentPercent.toFixed(2)}%</td>
                  <td className="py-3 px-4 text-right text-sm font-mono text-foreground">{trade.targetPercent.toFixed(2)}%</td>
                  <td className="py-3 px-4 text-right text-sm font-mono text-foreground">{formatUsd(trade.amountNotional)}</td>
                  <td className="py-3 px-4 text-right text-xs font-mono text-muted-foreground">{trade.reason}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No trades recommended for the latest evaluation.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">Warnings</div>
        {warnings.length === 0 ? (
          <div className="text-sm text-muted-foreground">No warnings for this strategy evaluation.</div>
        ) : (
          <ul className="space-y-2">
            {warnings.map((warning) => (
              <li key={warning} className="text-xs text-muted-foreground font-mono border border-border rounded px-3 py-2">
                {warning}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 text-[11px] text-muted-foreground">
          Last evaluation snapshot: {formatDateTime(state?.executionPlan.timestamp)}
        </div>
      </div>
    </div>
  );
}

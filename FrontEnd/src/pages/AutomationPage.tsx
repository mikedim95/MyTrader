import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { backendApi } from "@/lib/api";
import { useBacktests, useStrategies, useStrategyRunDetails, useStrategyRuns } from "@/hooks/useTradingData";
import type { BacktestCreateRequest, StrategyConfig, StrategyMode } from "@/types/api";
import { SpinnerValue } from "@/components/SpinnerValue";
import { cn } from "@/lib/utils";

interface DraftAllocationRow {
  id: string;
  symbol: string;
  percent: string;
}

interface DraftRule {
  id: string;
  name: string;
  priority: string;
  enabled: boolean;
  conditionIndicator: string;
  conditionOperator: string;
  conditionValue: string;
  conditionAsset: string;
  actionType: string;
  actionPercent: string;
  actionAsset: string;
  actionFrom: string;
  actionTo: string;
}

interface StrategyDraft {
  name: string;
  description: string;
  executionMode: StrategyMode;
  scheduleInterval: string;
  isEnabled: boolean;
  metadataRiskLevel: string;
  metadataExpectedTurnover: string;
  metadataStablecoinExposure: string;
  disabledAssetsCsv: string;
  guards: {
    maxSingleAssetPct: string;
    minStablecoinPct: string;
    maxTradesPerCycle: string;
    minTradeNotional: string;
    cashReservePct: string;
  };
  baseAllocationRows: DraftAllocationRow[];
  rules: DraftRule[];
}

const MODE_OPTIONS: StrategyMode[] = ["manual", "semi_auto", "auto"];
const INDICATOR_OPTIONS = [
  "volatility",
  "btc_dominance",
  "portfolio_drift",
  "asset_weight",
  "asset_trend",
  "price_change_24h",
  "volume_change",
  "market_direction",
];
const OPERATOR_OPTIONS = [">", "<", ">=", "<=", "==", "!="];
const ACTION_TYPE_OPTIONS = [
  "increase",
  "decrease",
  "shift",
  "increase_stablecoin_exposure",
  "reduce_altcoin_exposure",
];
const RISK_OPTIONS = ["", "low", "medium", "high"];
const TURNOVER_OPTIONS = ["", "low", "medium", "high"];
const STABLE_EXPOSURE_OPTIONS = ["", "low", "medium", "high"];

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDateTime(value: string | undefined): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "--";
  return parsed.toLocaleString();
}

function formatDuration(startedAt: string | undefined, completedAt: string | undefined): string {
  if (!startedAt || !completedAt) return "--";

  const started = new Date(startedAt).getTime();
  const completed = new Date(completedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return "--";

  const totalSeconds = Math.floor((completed - started) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes <= 0 ? `${seconds}s` : `${minutes}m ${seconds}s`;
}

function createStartIso(dateValue: string): string {
  return new Date(`${dateValue}T00:00:00.000Z`).toISOString();
}

function createEndIso(dateValue: string): string {
  return new Date(`${dateValue}T23:59:59.999Z`).toISOString();
}

function toOptionalNumber(value: string, label: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be numeric.`);
  }

  return parsed;
}

function toOptionalInteger(value: string, label: string): number | undefined {
  const parsed = toOptionalNumber(value, label);
  if (parsed === undefined) return undefined;
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} must be an integer.`);
  }
  return parsed;
}

function strategyToDraft(strategy: StrategyConfig): StrategyDraft {
  const allocationRows = Object.entries(strategy.baseAllocation)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([symbol, percent]) => ({
      id: newId("allocation"),
      symbol,
      percent: String(percent),
    }));

  const rules = strategy.rules.map((rule) => ({
    id: rule.id,
    name: rule.name ?? "",
    priority: String(rule.priority),
    enabled: rule.enabled,
    conditionIndicator: rule.condition.indicator,
    conditionOperator: rule.condition.operator,
    conditionValue: String(rule.condition.value),
    conditionAsset: rule.condition.asset ?? "",
    actionType: rule.action.type,
    actionPercent: String(rule.action.percent),
    actionAsset: rule.action.asset ?? "",
    actionFrom: rule.action.from ?? "",
    actionTo: rule.action.to ?? "",
  }));

  return {
    name: strategy.name,
    description: strategy.description ?? "",
    executionMode: strategy.executionMode,
    scheduleInterval: strategy.scheduleInterval,
    isEnabled: strategy.isEnabled,
    metadataRiskLevel: strategy.metadata?.riskLevel ?? "",
    metadataExpectedTurnover: strategy.metadata?.expectedTurnover ?? "",
    metadataStablecoinExposure: strategy.metadata?.stablecoinExposure ?? "",
    disabledAssetsCsv: (strategy.disabledAssets ?? []).join(", "),
    guards: {
      maxSingleAssetPct:
        typeof strategy.guards.max_single_asset_pct === "number"
          ? String(strategy.guards.max_single_asset_pct)
          : "",
      minStablecoinPct:
        typeof strategy.guards.min_stablecoin_pct === "number"
          ? String(strategy.guards.min_stablecoin_pct)
          : "",
      maxTradesPerCycle:
        typeof strategy.guards.max_trades_per_cycle === "number"
          ? String(strategy.guards.max_trades_per_cycle)
          : "",
      minTradeNotional:
        typeof strategy.guards.min_trade_notional === "number"
          ? String(strategy.guards.min_trade_notional)
          : "",
      cashReservePct:
        typeof strategy.guards.cash_reserve_pct === "number"
          ? String(strategy.guards.cash_reserve_pct)
          : "",
    },
    baseAllocationRows: allocationRows.length > 0 ? allocationRows : [{ id: newId("allocation"), symbol: "", percent: "" }],
    rules,
  };
}

function draftToPayload(draft: StrategyDraft, strategyId: string): unknown {
  const baseAllocation: Record<string, number> = {};

  for (const row of draft.baseAllocationRows) {
    const symbol = row.symbol.trim().toUpperCase();
    if (!symbol) continue;

    const percent = Number(row.percent);
    if (!Number.isFinite(percent) || percent < 0) {
      throw new Error(`Base allocation for ${symbol} must be a non-negative number.`);
    }

    baseAllocation[symbol] = (baseAllocation[symbol] ?? 0) + percent;
  }

  if (Object.keys(baseAllocation).length === 0) {
    throw new Error("At least one base allocation entry is required.");
  }

  const rules = draft.rules.map((rule, index) => {
    const priority = Number(rule.priority);
    if (!Number.isInteger(priority) || priority <= 0) {
      throw new Error(`Rule ${index + 1}: priority must be a positive integer.`);
    }

    const conditionValue = Number(rule.conditionValue);
    if (!Number.isFinite(conditionValue)) {
      throw new Error(`Rule ${index + 1}: condition value must be numeric.`);
    }

    const actionPercent = Number(rule.actionPercent);
    if (!Number.isFinite(actionPercent) || actionPercent <= 0) {
      throw new Error(`Rule ${index + 1}: action percent must be greater than 0.`);
    }

    const actionType = rule.actionType;
    const action: Record<string, unknown> = {
      type: actionType,
      percent: actionPercent,
    };

    if ((actionType === "increase" || actionType === "decrease") && !rule.actionAsset.trim()) {
      throw new Error(`Rule ${index + 1}: action asset is required for ${actionType}.`);
    }

    if (actionType === "shift") {
      if (!rule.actionFrom.trim() || !rule.actionTo.trim()) {
        throw new Error(`Rule ${index + 1}: action from/to are required for shift.`);
      }
      action.from = rule.actionFrom.trim().toUpperCase();
      action.to = rule.actionTo.trim().toUpperCase();
    }

    if (rule.actionAsset.trim()) {
      action.asset = rule.actionAsset.trim().toUpperCase();
    }

    return {
      id: rule.id || `rule-${index + 1}`,
      name: rule.name.trim() || undefined,
      priority,
      enabled: rule.enabled,
      condition: {
        indicator: rule.conditionIndicator,
        operator: rule.conditionOperator,
        value: conditionValue,
        asset: rule.conditionAsset.trim() ? rule.conditionAsset.trim().toUpperCase() : undefined,
      },
      action,
    };
  });

  const metadata = {
    riskLevel: draft.metadataRiskLevel || undefined,
    expectedTurnover: draft.metadataExpectedTurnover || undefined,
    stablecoinExposure: draft.metadataStablecoinExposure || undefined,
  };

  const disabledAssets = draft.disabledAssetsCsv
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  return {
    id: strategyId,
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    baseAllocation,
    rules,
    guards: {
      max_single_asset_pct: toOptionalNumber(draft.guards.maxSingleAssetPct, "max_single_asset_pct"),
      min_stablecoin_pct: toOptionalNumber(draft.guards.minStablecoinPct, "min_stablecoin_pct"),
      max_trades_per_cycle: toOptionalInteger(draft.guards.maxTradesPerCycle, "max_trades_per_cycle"),
      min_trade_notional: toOptionalNumber(draft.guards.minTradeNotional, "min_trade_notional"),
      cash_reserve_pct: toOptionalNumber(draft.guards.cashReservePct, "cash_reserve_pct"),
    },
    executionMode: draft.executionMode,
    metadata,
    isEnabled: draft.isEnabled,
    scheduleInterval: draft.scheduleInterval.trim().toLowerCase(),
    disabledAssets,
  };
}

export function AutomationPage() {
  const queryClient = useQueryClient();

  const { data: strategyData, isPending: loadingStrategies, error: strategyError } = useStrategies();
  const { data: runData, isPending: loadingRuns } = useStrategyRuns();
  const { data: backtestData, isPending: loadingBacktests } = useBacktests();

  const strategies = strategyData?.strategies ?? [];
  const runs = runData?.runs ?? [];
  const backtests = backtestData?.backtests ?? [];

  const [selectedStrategyId, setSelectedStrategyId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");

  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [draft, setDraft] = useState<StrategyDraft | null>(null);
  const [draftStrategyId, setDraftStrategyId] = useState("");
  const [draftDirty, setDraftDirty] = useState(false);

  const today = new Date();
  const defaultEnd = today.toISOString().slice(0, 10);
  const defaultStart = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [initialCapital, setInitialCapital] = useState("10000");
  const [timeframe, setTimeframe] = useState<"1h" | "1d">("1d");
  const [rebalanceCostsPct, setRebalanceCostsPct] = useState("0.001");
  const [slippagePct, setSlippagePct] = useState("0.001");

  useEffect(() => {
    if ((!selectedStrategyId || !strategies.some((strategy) => strategy.id === selectedStrategyId)) && strategies.length > 0) {
      setSelectedStrategyId(strategies[0].id);
    }
  }, [selectedStrategyId, strategies]);

  useEffect(() => {
    if ((!selectedRunId || !runs.some((run) => run.id === selectedRunId)) && runs.length > 0) {
      setSelectedRunId(runs[0].id);
    }
  }, [selectedRunId, runs]);

  const selectedStrategy = useMemo(
    () => strategies.find((strategy) => strategy.id === selectedStrategyId) ?? null,
    [selectedStrategyId, strategies]
  );

  useEffect(() => {
    if (!selectedStrategy) return;

    const shouldReset = draftStrategyId !== selectedStrategy.id || !draftDirty;
    if (!shouldReset) return;

    setDraft(strategyToDraft(selectedStrategy));
    setDraftStrategyId(selectedStrategy.id);
    setDraftDirty(false);
  }, [draftDirty, draftStrategyId, selectedStrategy]);

  const { data: runDetailsData, isPending: loadingRunDetails } = useStrategyRunDetails(selectedRunId || undefined);
  const selectedRun = runDetailsData?.run ?? runs.find((run) => run.id === selectedRunId) ?? null;
  const selectedRunExecutionPlan = runDetailsData?.executionPlan ?? null;

  const invalidateAll = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["strategies"] }),
      queryClient.invalidateQueries({ queryKey: ["strategy-runs"] }),
      queryClient.invalidateQueries({ queryKey: ["strategy-run", selectedRunId] }),
      queryClient.invalidateQueries({ queryKey: ["strategy-state", selectedStrategyId] }),
      queryClient.invalidateQueries({ queryKey: ["strategy-execution-plan", selectedStrategyId] }),
      queryClient.invalidateQueries({ queryKey: ["backtests"] }),
    ]);
  };

  const runNowMutation = useMutation({
    mutationFn: (strategyId: string) => backendApi.runStrategyNow(strategyId),
    onSuccess: async (result) => {
      setErrorMessage("");
      setMessage(`Strategy run created: ${result.run.status}.`);
      await invalidateAll();
    },
    onError: (error) => {
      setMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Unable to run strategy.");
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (input: { strategyId: string; enabled: boolean }) =>
      input.enabled ? backendApi.enableStrategy(input.strategyId) : backendApi.disableStrategy(input.strategyId),
    onSuccess: async (result) => {
      setErrorMessage("");
      setMessage(`${result.strategy.name} ${result.strategy.isEnabled ? "enabled" : "disabled"}.`);
      await invalidateAll();
    },
    onError: (error) => {
      setMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Unable to toggle strategy.");
    },
  });

  const saveStrategyMutation = useMutation({
    mutationFn: async (input: { strategyId: string; payload: unknown }) => {
      const validation = await backendApi.validateStrategy(input.payload);
      if (!validation.valid) {
        throw new Error((validation.errors ?? ["Strategy validation failed."]).join(" | "));
      }
      return backendApi.updateStrategy(input.strategyId, input.payload);
    },
    onSuccess: async (result) => {
      setErrorMessage("");
      setMessage(`Saved strategy ${result.strategy.name}.`);
      setDraft(strategyToDraft(result.strategy));
      setDraftDirty(false);
      await invalidateAll();
    },
    onError: (error) => {
      setMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Unable to save strategy.");
    },
  });

  const backtestMutation = useMutation({
    mutationFn: (payload: BacktestCreateRequest) => backendApi.createBacktest(payload),
    onSuccess: async (result) => {
      setErrorMessage("");
      setMessage(`Backtest ${result.backtestRun.id} started.`);
      await invalidateAll();
    },
    onError: (error) => {
      setMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Unable to create backtest.");
    },
  });

  const busy =
    runNowMutation.isPending ||
    toggleMutation.isPending ||
    saveStrategyMutation.isPending ||
    backtestMutation.isPending;

  const updateDraft = (updater: (previous: StrategyDraft) => StrategyDraft): void => {
    setDraft((previous) => {
      if (!previous) return previous;
      return updater(previous);
    });
    setDraftDirty(true);
  };

  const updateAllocationRow = (rowId: string, patch: Partial<DraftAllocationRow>): void => {
    updateDraft((previous) => ({
      ...previous,
      baseAllocationRows: previous.baseAllocationRows.map((row) =>
        row.id === rowId ? { ...row, ...patch } : row
      ),
    }));
  };

  const removeAllocationRow = (rowId: string): void => {
    updateDraft((previous) => ({
      ...previous,
      baseAllocationRows:
        previous.baseAllocationRows.length <= 1
          ? previous.baseAllocationRows
          : previous.baseAllocationRows.filter((row) => row.id !== rowId),
    }));
  };

  const addAllocationRow = (): void => {
    updateDraft((previous) => ({
      ...previous,
      baseAllocationRows: [...previous.baseAllocationRows, { id: newId("allocation"), symbol: "", percent: "" }],
    }));
  };

  const updateRule = (ruleId: string, patch: Partial<DraftRule>): void => {
    updateDraft((previous) => ({
      ...previous,
      rules: previous.rules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)),
    }));
  };

  const removeRule = (ruleId: string): void => {
    updateDraft((previous) => ({
      ...previous,
      rules: previous.rules.filter((rule) => rule.id !== ruleId),
    }));
  };

  const addRule = (): void => {
    updateDraft((previous) => ({
      ...previous,
      rules: [
        ...previous.rules,
        {
          id: newId("rule"),
          name: "",
          priority: String(previous.rules.length + 1),
          enabled: true,
          conditionIndicator: "volatility",
          conditionOperator: ">",
          conditionValue: "0",
          conditionAsset: "",
          actionType: "increase_stablecoin_exposure",
          actionPercent: "1",
          actionAsset: "",
          actionFrom: "",
          actionTo: "",
        },
      ],
    }));
  };

  const handleSaveStrategy = (): void => {
    if (!selectedStrategy || !draft) return;

    try {
      const payload = draftToPayload(draft, selectedStrategy.id);
      saveStrategyMutation.mutate({ strategyId: selectedStrategy.id, payload });
    } catch (error) {
      setMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Strategy draft is invalid.");
    }
  };

  const handleResetDraft = (): void => {
    if (!selectedStrategy) return;
    setDraft(strategyToDraft(selectedStrategy));
    setDraftDirty(false);
  };

  const handleBacktestCreate = (): void => {
    if (!selectedStrategy) {
      setMessage("");
      setErrorMessage("Select a strategy before starting a backtest.");
      return;
    }

    const capital = Number(initialCapital);
    const costs = Number(rebalanceCostsPct);
    const slip = Number(slippagePct);

    if (!Number.isFinite(capital) || capital <= 0) {
      setMessage("");
      setErrorMessage("Initial capital must be positive.");
      return;
    }

    backtestMutation.mutate({
      strategyId: selectedStrategy.id,
      startDate: createStartIso(startDate),
      endDate: createEndIso(endDate),
      initialCapital: capital,
      baseCurrency: "USDC",
      timeframe,
      rebalanceCostsPct: Number.isFinite(costs) && costs >= 0 ? costs : 0.001,
      slippagePct: Number.isFinite(slip) && slip >= 0 ? slip : 0.001,
    });
  };

  const runIndicators = selectedRun?.inputSnapshot?.marketSignals.indicators ?? {};

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-mono font-semibold text-foreground">Automation</h2>
        <p className="text-sm text-muted-foreground mt-1">Structured strategy editor, run detail explorer, and backtesting.</p>
      </div>

      {strategyError ? (
        <div className="rounded-md border border-negative/30 bg-negative/10 px-4 py-3 text-xs text-negative">
          {strategyError instanceof Error ? strategyError.message : "Failed to load strategies."}
        </div>
      ) : null}
      {message ? <div className="rounded-md border border-positive/30 bg-positive/10 px-4 py-3 text-xs text-positive">{message}</div> : null}
      {errorMessage ? <div className="rounded-md border border-negative/30 bg-negative/10 px-4 py-3 text-xs text-negative">{errorMessage}</div> : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Strategy Catalog</div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Name", "Mode", "Enabled", "Interval", "Risk", "Next Run"].map((heading) => (
                  <th key={heading} className="py-3 px-4 text-[10px] font-mono uppercase tracking-wider text-muted-foreground text-right first:text-left">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingStrategies ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">Loading strategies...</td></tr>
              ) : strategies.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">No strategies found.</td></tr>
              ) : (
                strategies.map((strategy) => (
                  <tr
                    key={strategy.id}
                    className={cn("border-b border-border cursor-pointer", strategy.id === selectedStrategyId ? "bg-secondary/40" : "hover:bg-secondary/20")}
                    onClick={() => setSelectedStrategyId(strategy.id)}
                  >
                    <td className="py-3 px-4 text-left text-xs font-mono text-foreground">{strategy.name}</td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-foreground">{strategy.executionMode}</td>
                    <td className="py-3 px-4 text-right text-xs font-mono"><span className={strategy.isEnabled ? "text-positive" : "text-muted-foreground"}>{strategy.isEnabled ? "Yes" : "No"}</span></td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-foreground">{strategy.scheduleInterval}</td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-foreground">{strategy.metadata?.riskLevel ?? "--"}</td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-muted-foreground">{formatDateTime(strategy.nextRunAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Selected Strategy</div>
          <div className="text-sm font-mono text-foreground">{selectedStrategy?.name ?? "--"}</div>
          <div className="text-xs text-muted-foreground">{selectedStrategy?.description ?? "Select a strategy to edit."}</div>

          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Rules</div><div className="mt-1 text-foreground">{selectedStrategy?.rules.length ?? 0}</div></div>
            <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Last Run</div><div className="mt-1 text-foreground">{formatDateTime(selectedStrategy?.lastRunAt)}</div></div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => selectedStrategy && toggleMutation.mutate({ strategyId: selectedStrategy.id, enabled: !selectedStrategy.isEnabled })}
              disabled={busy || !selectedStrategy}
              className="px-3 py-2 rounded-md border border-border text-xs font-mono text-foreground hover:bg-secondary disabled:opacity-60"
            >
              {selectedStrategy?.isEnabled ? "Disable" : "Enable"}
            </button>
            <button
              onClick={() => selectedStrategy && runNowMutation.mutate(selectedStrategy.id)}
              disabled={busy || !selectedStrategy}
              className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-mono font-semibold hover:opacity-90 disabled:opacity-60"
            >
              Run Now
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Structured Strategy Editor</div>
          <div className="flex gap-2">
            <button onClick={handleResetDraft} disabled={busy || !draftDirty || !selectedStrategy} className="px-3 py-1.5 rounded-md border border-border text-xs font-mono text-foreground hover:bg-secondary disabled:opacity-60">Reset</button>
            <button onClick={handleSaveStrategy} disabled={busy || !draftDirty || !draft || !selectedStrategy} className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-mono font-semibold hover:opacity-90 disabled:opacity-60">Save Strategy</button>
          </div>
        </div>

        {!draft ? (
          <div className="text-sm text-muted-foreground">Select a strategy to edit.</div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
              <div>
                <label className="text-muted-foreground">Name</label>
                <input value={draft.name} onChange={(event) => updateDraft((prev) => ({ ...prev, name: event.target.value }))} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none" />
              </div>
              <div>
                <label className="text-muted-foreground">Execution Mode</label>
                <select value={draft.executionMode} onChange={(event) => updateDraft((prev) => ({ ...prev, executionMode: event.target.value as StrategyMode }))} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none">
                  {MODE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-muted-foreground">Description</label>
                <textarea value={draft.description} onChange={(event) => updateDraft((prev) => ({ ...prev, description: event.target.value }))} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none" rows={2} />
              </div>
              <div>
                <label className="text-muted-foreground">Schedule Interval</label>
                <input value={draft.scheduleInterval} onChange={(event) => updateDraft((prev) => ({ ...prev, scheduleInterval: event.target.value }))} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none" placeholder="15m" />
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-foreground">
                  <input type="checkbox" checked={draft.isEnabled} onChange={(event) => updateDraft((prev) => ({ ...prev, isEnabled: event.target.checked }))} className="h-4 w-4" />
                  Enabled
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
              <div>
                <label className="text-muted-foreground">Risk Level</label>
                <select value={draft.metadataRiskLevel} onChange={(event) => updateDraft((prev) => ({ ...prev, metadataRiskLevel: event.target.value }))} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none">
                  {RISK_OPTIONS.map((option) => <option key={option} value={option}>{option || "--"}</option>)}
                </select>
              </div>
              <div>
                <label className="text-muted-foreground">Expected Turnover</label>
                <select value={draft.metadataExpectedTurnover} onChange={(event) => updateDraft((prev) => ({ ...prev, metadataExpectedTurnover: event.target.value }))} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none">
                  {TURNOVER_OPTIONS.map((option) => <option key={option} value={option}>{option || "--"}</option>)}
                </select>
              </div>
              <div>
                <label className="text-muted-foreground">Stablecoin Exposure</label>
                <select value={draft.metadataStablecoinExposure} onChange={(event) => updateDraft((prev) => ({ ...prev, metadataStablecoinExposure: event.target.value }))} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none">
                  {STABLE_EXPOSURE_OPTIONS.map((option) => <option key={option} value={option}>{option || "--"}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-xs font-mono">
              <div><label className="text-muted-foreground">Max Single %</label><input value={draft.guards.maxSingleAssetPct} onChange={(event) => updateDraft((prev) => ({ ...prev, guards: { ...prev.guards, maxSingleAssetPct: event.target.value } }))} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none" /></div>
              <div><label className="text-muted-foreground">Min Stable %</label><input value={draft.guards.minStablecoinPct} onChange={(event) => updateDraft((prev) => ({ ...prev, guards: { ...prev.guards, minStablecoinPct: event.target.value } }))} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none" /></div>
              <div><label className="text-muted-foreground">Max Trades</label><input value={draft.guards.maxTradesPerCycle} onChange={(event) => updateDraft((prev) => ({ ...prev, guards: { ...prev.guards, maxTradesPerCycle: event.target.value } }))} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none" /></div>
              <div><label className="text-muted-foreground">Min Notional</label><input value={draft.guards.minTradeNotional} onChange={(event) => updateDraft((prev) => ({ ...prev, guards: { ...prev.guards, minTradeNotional: event.target.value } }))} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none" /></div>
              <div><label className="text-muted-foreground">Cash Reserve %</label><input value={draft.guards.cashReservePct} onChange={(event) => updateDraft((prev) => ({ ...prev, guards: { ...prev.guards, cashReservePct: event.target.value } }))} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none" /></div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Base Allocation</div>
                <button onClick={addAllocationRow} className="px-2 py-1 rounded border border-border text-xs font-mono text-foreground hover:bg-secondary">Add Row</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {draft.baseAllocationRows.map((row) => (
                  <div key={row.id} className="rounded border border-border bg-secondary/30 p-2 grid grid-cols-12 gap-2 items-end text-xs font-mono">
                    <div className="col-span-5"><label className="text-muted-foreground">Symbol</label><input value={row.symbol} onChange={(event) => updateAllocationRow(row.id, { symbol: event.target.value })} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-1.5 text-foreground outline-none" /></div>
                    <div className="col-span-5"><label className="text-muted-foreground">Percent</label><input value={row.percent} onChange={(event) => updateAllocationRow(row.id, { percent: event.target.value })} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-1.5 text-foreground outline-none" /></div>
                    <div className="col-span-2"><button onClick={() => removeAllocationRow(row.id)} disabled={draft.baseAllocationRows.length <= 1} className="w-full px-2 py-1.5 rounded border border-border text-xs font-mono text-foreground hover:bg-secondary disabled:opacity-50">Del</button></div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-mono text-muted-foreground">Disabled Assets (comma separated)</label>
              <input value={draft.disabledAssetsCsv} onChange={(event) => updateDraft((prev) => ({ ...prev, disabledAssetsCsv: event.target.value }))} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none text-xs font-mono" placeholder="DOGE, SHIB" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Rules</div>
                <button onClick={addRule} className="px-2 py-1 rounded border border-border text-xs font-mono text-foreground hover:bg-secondary">Add Rule</button>
              </div>

              {draft.rules.length === 0 ? (
                <div className="text-sm text-muted-foreground">No rules defined.</div>
              ) : (
                <div className="space-y-2">
                  {draft.rules.map((rule, index) => (
                    <div key={rule.id} className="rounded border border-border bg-secondary/30 p-3 space-y-2 text-xs font-mono">
                      <div className="flex items-center justify-between">
                        <div className="text-foreground">Rule {index + 1}</div>
                        <button onClick={() => removeRule(rule.id)} className="px-2 py-1 rounded border border-border text-xs font-mono text-foreground hover:bg-secondary">Remove</button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                        <div><label className="text-muted-foreground">ID</label><input value={rule.id} onChange={(event) => updateRule(rule.id, { id: event.target.value })} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-1.5 text-foreground outline-none" /></div>
                        <div><label className="text-muted-foreground">Name</label><input value={rule.name} onChange={(event) => updateRule(rule.id, { name: event.target.value })} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-1.5 text-foreground outline-none" /></div>
                        <div><label className="text-muted-foreground">Priority</label><input value={rule.priority} onChange={(event) => updateRule(rule.id, { priority: event.target.value })} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-1.5 text-foreground outline-none" /></div>
                        <div className="md:col-span-2 flex items-end"><label className="inline-flex items-center gap-2"><input type="checkbox" checked={rule.enabled} onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })} /> Enabled</label></div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                        <div><label className="text-muted-foreground">Indicator</label><select value={rule.conditionIndicator} onChange={(event) => updateRule(rule.id, { conditionIndicator: event.target.value })} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-1.5 text-foreground outline-none">{INDICATOR_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
                        <div><label className="text-muted-foreground">Operator</label><select value={rule.conditionOperator} onChange={(event) => updateRule(rule.id, { conditionOperator: event.target.value })} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-1.5 text-foreground outline-none">{OPERATOR_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
                        <div><label className="text-muted-foreground">Value</label><input value={rule.conditionValue} onChange={(event) => updateRule(rule.id, { conditionValue: event.target.value })} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-1.5 text-foreground outline-none" /></div>
                        <div><label className="text-muted-foreground">Condition Asset</label><input value={rule.conditionAsset} onChange={(event) => updateRule(rule.id, { conditionAsset: event.target.value })} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-1.5 text-foreground outline-none" /></div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                        <div><label className="text-muted-foreground">Action</label><select value={rule.actionType} onChange={(event) => updateRule(rule.id, { actionType: event.target.value })} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-1.5 text-foreground outline-none">{ACTION_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
                        <div><label className="text-muted-foreground">Percent</label><input value={rule.actionPercent} onChange={(event) => updateRule(rule.id, { actionPercent: event.target.value })} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-1.5 text-foreground outline-none" /></div>
                        <div><label className="text-muted-foreground">Action Asset</label><input value={rule.actionAsset} onChange={(event) => updateRule(rule.id, { actionAsset: event.target.value })} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-1.5 text-foreground outline-none" /></div>
                        <div><label className="text-muted-foreground">From</label><input value={rule.actionFrom} onChange={(event) => updateRule(rule.id, { actionFrom: event.target.value })} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-1.5 text-foreground outline-none" /></div>
                        <div><label className="text-muted-foreground">To</label><input value={rule.actionTo} onChange={(event) => updateRule(rule.id, { actionTo: event.target.value })} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-1.5 text-foreground outline-none" /></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Strategy Runs</div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Started", "Strategy", "Status", "Trigger", "Completed", "Duration", "Warn"].map((heading) => (
                  <th key={heading} className="py-3 px-4 text-[10px] font-mono uppercase tracking-wider text-muted-foreground text-right first:text-left">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingRuns ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">Loading runs...</td></tr>
              ) : runs.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">No runs yet.</td></tr>
              ) : (
                runs.slice(0, 12).map((run) => (
                  <tr
                    key={run.id}
                    className={cn("border-b border-border cursor-pointer", run.id === selectedRunId ? "bg-secondary/40" : "hover:bg-secondary/20")}
                    onClick={() => setSelectedRunId(run.id)}
                  >
                    <td className="py-3 px-4 text-left text-xs font-mono text-muted-foreground">{formatDateTime(run.startedAt)}</td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-foreground">{run.strategyId}</td>
                    <td className="py-3 px-4 text-right text-xs font-mono"><span className={run.status === "completed" ? "text-positive" : run.status === "failed" ? "text-negative" : "text-muted-foreground"}>{run.status}</span></td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-foreground">{run.trigger}</td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-muted-foreground">{formatDateTime(run.completedAt)}</td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-foreground">{formatDuration(run.startedAt, run.completedAt)}</td>
                    <td className="py-3 px-4 text-right text-xs font-mono text-foreground">{run.warnings.length}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="border-t border-border p-4 space-y-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Run Details</div>

            {loadingRunDetails ? (
              <div className="text-sm text-muted-foreground">Loading selected run details...</div>
            ) : !selectedRun ? (
              <div className="text-sm text-muted-foreground">Select a run to inspect.</div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
                  <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Status</div><div className="mt-1 text-foreground">{selectedRun.status}</div></div>
                  <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Mode</div><div className="mt-1 text-foreground">{selectedRun.mode}</div></div>
                  <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Trigger</div><div className="mt-1 text-foreground">{selectedRun.trigger}</div></div>
                  <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Duration</div><div className="mt-1 text-foreground">{formatDuration(selectedRun.startedAt, selectedRun.completedAt)}</div></div>
                </div>

                {selectedRun.error ? <div className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-xs text-negative font-mono">{selectedRun.error}</div> : null}

                {selectedRun.warnings.length > 0 ? (
                  <div className="space-y-1">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Warnings</div>
                    {selectedRun.warnings.map((warning, index) => <div key={`${warning}-${index}`} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground font-mono">{warning}</div>)}
                  </div>
                ) : null}

                {selectedRun.inputSnapshot ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
                    <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Portfolio</div><div className="mt-1 text-foreground">{selectedRun.inputSnapshot.portfolio.totalValue.toLocaleString("en-US", { style: "currency", currency: "USD" })}</div></div>
                    <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Assets</div><div className="mt-1 text-foreground">{selectedRun.inputSnapshot.portfolio.assets.length}</div></div>
                    <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Volatility</div><div className="mt-1 text-foreground">{(runIndicators.volatility ?? 0).toFixed(4)}</div></div>
                    <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">BTC Dom</div><div className="mt-1 text-foreground">{(runIndicators.btc_dominance ?? 0).toFixed(4)}</div></div>
                  </div>
                ) : null}

                {selectedRun.adjustedAllocation ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {Object.entries(selectedRun.adjustedAllocation).sort(([left], [right]) => left.localeCompare(right)).map(([symbol, value]) => (
                      <div key={symbol} className="rounded border border-border bg-secondary/30 p-2 text-xs font-mono"><div className="text-muted-foreground">{symbol}</div><div className="mt-1 text-foreground">{value.toFixed(2)}%</div></div>
                    ))}
                  </div>
                ) : null}

                {selectedRunExecutionPlan ? (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
                      <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Rebalance</div><div className="mt-1 text-foreground">{selectedRunExecutionPlan.rebalanceRequired ? "Yes" : "No"}</div></div>
                      <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Drift</div><div className="mt-1 text-foreground">{selectedRunExecutionPlan.driftPct.toFixed(2)}%</div></div>
                      <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Turnover</div><div className="mt-1 text-foreground">{selectedRunExecutionPlan.estimatedTurnoverPct.toFixed(2)}%</div></div>
                      <div className="rounded border border-border bg-secondary/30 p-2"><div className="text-muted-foreground">Trades</div><div className="mt-1 text-foreground">{selectedRunExecutionPlan.recommendedTrades.length}</div></div>
                    </div>

                    <div className="rounded border border-border overflow-hidden">
                      <div className="px-3 py-2 border-b border-border text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Execution Trades</div>
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-border">
                            {["Asset", "Side", "Current %", "Target %", "Notional", "Reason"].map((heading) => (
                              <th key={heading} className="py-2 px-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground text-right first:text-left">{heading}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {selectedRunExecutionPlan.recommendedTrades.length === 0 ? (
                            <tr><td colSpan={6} className="px-3 py-3 text-center text-xs text-muted-foreground">No trade actions for this run.</td></tr>
                          ) : (
                            selectedRunExecutionPlan.recommendedTrades.map((trade, index) => (
                              <tr key={`${trade.asset}-${trade.side}-${index}`} className="border-b border-border">
                                <td className="py-2 px-3 text-left text-xs font-mono text-foreground">{trade.asset}</td>
                                <td className="py-2 px-3 text-right text-xs font-mono text-foreground">{trade.side}</td>
                                <td className="py-2 px-3 text-right text-xs font-mono text-foreground">{trade.currentPercent.toFixed(2)}%</td>
                                <td className="py-2 px-3 text-right text-xs font-mono text-foreground">{trade.targetPercent.toFixed(2)}%</td>
                                <td className="py-2 px-3 text-right text-xs font-mono text-foreground">{trade.amountNotional.toLocaleString("en-US", { style: "currency", currency: "USD" })}</td>
                                <td className="py-2 px-3 text-right text-xs font-mono text-muted-foreground">{trade.reason}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Backtest Runner</div>
          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div><label className="text-muted-foreground">Start Date</label><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none" disabled={busy} /></div>
            <div><label className="text-muted-foreground">End Date</label><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none" disabled={busy} /></div>
            <div><label className="text-muted-foreground">Initial Capital</label><input value={initialCapital} onChange={(event) => setInitialCapital(event.target.value)} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none" disabled={busy} /></div>
            <div><label className="text-muted-foreground">Timeframe</label><select value={timeframe} onChange={(event) => setTimeframe(event.target.value as "1h" | "1d")} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none" disabled={busy}><option value="1d">1d</option><option value="1h">1h</option></select></div>
            <div><label className="text-muted-foreground">Rebalance Cost %</label><input value={rebalanceCostsPct} onChange={(event) => setRebalanceCostsPct(event.target.value)} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none" disabled={busy} /></div>
            <div><label className="text-muted-foreground">Slippage %</label><input value={slippagePct} onChange={(event) => setSlippagePct(event.target.value)} className="mt-1 w-full rounded border border-border bg-secondary px-2 py-2 text-foreground outline-none" disabled={busy} /></div>
          </div>
          <button onClick={handleBacktestCreate} disabled={busy || !selectedStrategy} className="w-full rounded-md bg-primary px-4 py-2.5 text-xs font-mono font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">Start Backtest</button>

          <div className="rounded border border-border overflow-hidden">
            <div className="px-3 py-2 border-b border-border text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Recent Backtests</div>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full">
                <thead><tr className="border-b border-border">{["Created", "Strategy", "Status", "Return %"].map((heading) => <th key={heading} className="py-2 px-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground text-right first:text-left">{heading}</th>)}</tr></thead>
                <tbody>
                  {loadingBacktests ? (
                    <tr><td colSpan={4} className="px-3 py-4 text-center text-xs text-muted-foreground">Loading backtests...</td></tr>
                  ) : backtests.length === 0 ? (
                    <tr><td colSpan={4} className="px-3 py-4 text-center text-xs text-muted-foreground">No backtests yet.</td></tr>
                  ) : (
                    backtests.slice(0, 10).map((run) => (
                      <tr key={run.id} className="border-b border-border">
                        <td className="py-2 px-3 text-left text-xs font-mono text-muted-foreground">{formatDateTime(run.createdAt)}</td>
                        <td className="py-2 px-3 text-right text-xs font-mono text-foreground">{run.strategyId}</td>
                        <td className="py-2 px-3 text-right text-xs font-mono text-foreground">{run.status}</td>
                        <td className="py-2 px-3 text-right text-xs font-mono text-foreground">{typeof run.totalReturnPct === "number" ? `${run.totalReturnPct.toFixed(2)}%` : "--"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground">
        {busy ? <SpinnerValue loading value={undefined} /> : "Scheduler, strategy runs, and backtests auto-refresh every 20-30 seconds."}
      </div>
    </div>
  );
}

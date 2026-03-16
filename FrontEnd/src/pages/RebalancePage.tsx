import { memo, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { backendApi } from "@/lib/api";
import { useRebalanceAllocationProfiles, useRebalanceAllocationState, useStrategies } from "@/hooks/useTradingData";
import { cn } from "@/lib/utils";
import type {
  DemoAccountAllocationInput,
  PortfolioAccountType,
  RebalanceAllocationExecutionPolicy,
  RebalanceAllocationInput,
  RebalanceAllocationProfile,
  StrategyConfig,
} from "@/types/api";

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

const BASIC_STRATEGY_IDS = new Set<string>([
  "mean-reversion",
  "periodic-rebalancing",
  "relative-strength-rotation",
  "drawdown-protection",
  "volatility-hedge",
  "btc-dominance-rotation",
  "momentum-rotation",
]);

const EXECUTION_POLICY_META: Record<
  RebalanceAllocationExecutionPolicy,
  { label: string; helper: string }
> = {
  manual: {
    label: "Manual",
    helper: "Only execute when you press the command button.",
  },
  on_strategy_run: {
    label: "On Strategy Run",
    helper: "Auto-execute after the linked strategy evaluates and drift crosses the threshold.",
  },
  interval: {
    label: "Interval",
    helper: "Re-evaluate and auto-execute on a dedicated schedule interval.",
  },
};

const BASE_CURRENCY_OPTIONS = ["USDC", "USDT", "FDUSD", "USD"];
const COMMON_ALLOCATION_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "USDC", "USDT", "XRP", "ADA", "DOGE", "AVAX", "LINK", "TON", "SUI", "TRX"];

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

interface DraftAllocationRow {
  id: string;
  symbol: string;
  percent: string;
}

interface AllocationFormState {
  name: string;
  description: string;
  strategyId: string;
  allocatedCapital: string;
  baseCurrency: string;
  executionPolicy: RebalanceAllocationExecutionPolicy;
  autoExecuteMinDriftPct: string;
  scheduleInterval: string;
  isEnabled: boolean;
  allocationRows: DraftAllocationRow[];
}

interface AllocationPieCardProps {
  title: string;
  data: AllocationChartSlice[];
  dataSignature: string;
  animationDelayMs?: number;
}

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

function createRowId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createDraftAllocationRow(symbol = "", percent = ""): DraftAllocationRow {
  return { id: createRowId(), symbol, percent };
}

function createDefaultFormState(strategyId = ""): AllocationFormState {
  return {
    name: "",
    description: "",
    strategyId,
    allocatedCapital: "500",
    baseCurrency: "USDC",
    executionPolicy: "manual",
    autoExecuteMinDriftPct: "2",
    scheduleInterval: "1d",
    isEnabled: true,
    allocationRows: [createDraftAllocationRow("BTC", "40"), createDraftAllocationRow("ETH", "30"), createDraftAllocationRow("USDC", "30")],
  };
}

function createFormStateFromProfile(profile: RebalanceAllocationProfile): AllocationFormState {
  const allocationRows = Object.entries(profile.allocation)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([symbol, percent]) => createDraftAllocationRow(symbol, percent.toString()));

  return {
    name: profile.name,
    description: profile.description ?? "",
    strategyId: profile.strategyId,
    allocatedCapital: profile.allocatedCapital.toString(),
    baseCurrency: profile.baseCurrency,
    executionPolicy: profile.executionPolicy,
    autoExecuteMinDriftPct: profile.autoExecuteMinDriftPct?.toString() ?? "2",
    scheduleInterval: profile.scheduleInterval ?? "1d",
    isEnabled: profile.isEnabled,
    allocationRows: allocationRows.length > 0 ? allocationRows : [createDraftAllocationRow()],
  };
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function buildAllocationSignature(rows: AllocationRow[]): string {
  return rows.map((row) => `${row.symbol}:${row.current.toFixed(4)}:${row.target.toFixed(4)}`).join("|");
}

function buildChartSignature(data: AllocationChartSlice[]): string {
  return data.map((entry) => `${entry.name}:${entry.value.toFixed(4)}`).join("|");
}

function renderAllocationLabel({ name, value }: { name?: string; value?: number }): string {
  if (!name || typeof value !== "number" || !Number.isFinite(value)) return "";
  return `${name} ${value.toFixed(1)}%`;
}

function getStrategyName(strategyId: string, strategies: StrategyConfig[]): string {
  return strategies.find((strategy) => strategy.id === strategyId)?.name ?? strategyId;
}

const AllocationPieCard = memo(
  function AllocationPieCard({ title, data, dataSignature, animationDelayMs = 0 }: AllocationPieCardProps) {
    return (
      <div
        className="rounded-lg border border-border bg-card p-5 animate-fade-scale-in [&_.recharts-layer]:transition-none [&_.recharts-sector]:transition-none [&_.recharts-text]:transition-none"
        style={{ animationDelay: `${animationDelayMs}ms` }}
      >
        <div className="mb-4 text-center text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{title}</div>
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
  const usableStrategies = useMemo(
    () => (strategiesData?.strategies ?? []).filter((strategy) => strategy.isEnabled && !BASIC_STRATEGY_IDS.has(strategy.id)),
    [strategiesData?.strategies]
  );

  const {
    data: profilesData,
    isPending: loadingProfiles,
    error: profilesError,
  } = useRebalanceAllocationProfiles();
  const profiles = profilesData?.profiles ?? [];

  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [formState, setFormState] = useState<AllocationFormState>(() => createDefaultFormState());
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!selectedProfileId || !profiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId(profiles[0]?.id ?? "");
    }
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    if (!profileModalOpen && !editingProfileId) {
      setFormState((current) => (current.strategyId ? current : createDefaultFormState(usableStrategies[0]?.id ?? "")));
    }
  }, [editingProfileId, profileModalOpen, usableStrategies]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId]
  );

  const {
    data: state,
    isPending: loadingState,
    error: stateError,
  } = useRebalanceAllocationState(selectedProfileId || undefined);

  const invalidateQueries = async (profileId?: string): Promise<void> => {
    const targetProfileId = profileId ?? selectedProfileId;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["rebalance-allocation-profiles"] }),
      queryClient.invalidateQueries({ queryKey: ["rebalance-allocation-state", targetProfileId] }),
      queryClient.invalidateQueries({ queryKey: ["strategy-runs", "demo"] }),
      queryClient.invalidateQueries({ queryKey: ["strategies"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard", "demo"] }),
      queryClient.invalidateQueries({ queryKey: ["demo-account-settings"] }),
    ]);
  };

  const createProfileMutation = useMutation({
    mutationFn: (payload: RebalanceAllocationInput) => backendApi.createRebalanceAllocationProfile(payload),
    onSuccess: async (result) => {
      setSuccessMessage(`Allocation "${result.profile.name}" created.`);
      setErrorMessage("");
      setProfileModalOpen(false);
      setEditingProfileId(null);
      setSelectedProfileId(result.profile.id);
      await invalidateQueries(result.profile.id);
    },
    onError: (error) => {
      setSuccessMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Unable to create allocation.");
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: ({ profileId, payload }: { profileId: string; payload: RebalanceAllocationInput }) =>
      backendApi.updateRebalanceAllocationProfile(profileId, payload),
    onSuccess: async (result) => {
      setSuccessMessage(`Allocation "${result.profile.name}" updated.`);
      setErrorMessage("");
      setProfileModalOpen(false);
      setEditingProfileId(null);
      setSelectedProfileId(result.profile.id);
      await invalidateQueries(result.profile.id);
    },
    onError: (error) => {
      setSuccessMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Unable to update allocation.");
    },
  });

  const deleteProfileMutation = useMutation({
    mutationFn: (profileId: string) => backendApi.deleteRebalanceAllocationProfile(profileId),
    onSuccess: async (_, profileId) => {
      const deleted = profiles.find((profile) => profile.id === profileId);
      setSuccessMessage(deleted ? `Allocation "${deleted.name}" deleted.` : "Allocation deleted.");
      setErrorMessage("");
      if (selectedProfileId === profileId) {
        setSelectedProfileId("");
      }
      await invalidateQueries(profileId);
    },
    onError: (error) => {
      setSuccessMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Unable to delete allocation.");
    },
  });

  const executeProfileMutation = useMutation({
    mutationFn: (profileId: string) => backendApi.executeRebalanceAllocationProfile(profileId),
    onSuccess: async (result) => {
      const message = result.run.warnings.some((warning) => warning.toLowerCase().includes("executed"))
        ? "Allocation rebalance executed using the latest market prices."
        : `Allocation execution completed with status: ${result.run.status}.`;
      setSuccessMessage(message);
      setErrorMessage("");
      await invalidateQueries(result.run.rebalanceAllocationId);
    },
    onError: (error) => {
      setSuccessMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Unable to execute allocation.");
    },
  });

  const currentAllocation = state?.executionPlan?.currentAllocation ?? state?.currentAllocation ?? {};
  const targetAllocation = state?.executionPlan?.adjustedTargetAllocation ?? state?.adjustedTargetAllocation ?? {};

  const allocationRows = useMemo<AllocationRow[]>(() => {
    const symbols = Array.from(new Set([...Object.keys(currentAllocation), ...Object.keys(targetAllocation)])).sort((a, b) =>
      a.localeCompare(b)
    );

    return symbols.map((symbol) => ({
      symbol,
      current: currentAllocation[symbol] ?? 0,
      target: targetAllocation[symbol] ?? 0,
      diff: (targetAllocation[symbol] ?? 0) - (currentAllocation[symbol] ?? 0),
    }));
  }, [currentAllocation, targetAllocation]);

  const allocationSignature = useMemo(() => buildAllocationSignature(allocationRows), [allocationRows]);
  const allocationColors = useMemo(
    () =>
      allocationRows.reduce<Record<string, string>>((colorMap, row, index) => {
        colorMap[row.symbol] = CHART_COLORS[index % CHART_COLORS.length];
        return colorMap;
      }, {}),
    [allocationRows, allocationSignature]
  );

  const currentChart = useMemo<AllocationChartSlice[]>(
    () =>
      allocationRows
        .filter((row) => Number.isFinite(row.current) && row.current > 0)
        .map((row) => ({ name: row.symbol, value: row.current, color: allocationColors[row.symbol] })),
    [allocationColors, allocationRows, allocationSignature]
  );

  const targetChart = useMemo<AllocationChartSlice[]>(
    () =>
      allocationRows
        .filter((row) => Number.isFinite(row.target) && row.target > 0)
        .map((row) => ({ name: row.symbol, value: row.target, color: allocationColors[row.symbol] })),
    [allocationColors, allocationRows, allocationSignature]
  );

  const currentChartSignature = useMemo(() => buildChartSignature(currentChart), [currentChart]);
  const targetChartSignature = useMemo(() => buildChartSignature(targetChart), [targetChart]);

  const warnings = useMemo(() => {
    const combined = [...(state?.executionPlan?.warnings ?? []), ...(state?.warnings ?? [])];
    return Array.from(new Set(combined));
  }, [state?.executionPlan?.warnings, state?.warnings]);

  const linkedStrategyName = useMemo(() => {
    if (!selectedProfile) return "--";
    return state?.strategy?.name ?? getStrategyName(selectedProfile.strategyId, strategiesData?.strategies ?? []);
  }, [selectedProfile, state?.strategy?.name, strategiesData?.strategies]);

  const selectedPolicy = selectedProfile?.executionPolicy ?? "manual";
  const canExecute =
    accountType === "demo" &&
    Boolean(selectedProfile) &&
    !loadingState &&
    !executeProfileMutation.isPending &&
    !createProfileMutation.isPending &&
    !updateProfileMutation.isPending;

  const openCreateModal = (): void => {
    setSuccessMessage("");
    setErrorMessage("");
    setEditingProfileId(null);
    setFormState(createDefaultFormState(usableStrategies[0]?.id ?? ""));
    setProfileModalOpen(true);
  };

  const openEditModal = (profile: RebalanceAllocationProfile): void => {
    setSuccessMessage("");
    setErrorMessage("");
    setEditingProfileId(profile.id);
    setFormState(createFormStateFromProfile(profile));
    setProfileModalOpen(true);
  };

  const closeProfileModal = (): void => {
    if (createProfileMutation.isPending || updateProfileMutation.isPending) return;
    setProfileModalOpen(false);
    setEditingProfileId(null);
  };

  const totalDraftPercent = useMemo(
    () =>
      formState.allocationRows.reduce((sum, row) => {
        const percent = Number(row.percent);
        return Number.isFinite(percent) ? sum + percent : sum;
      }, 0),
    [formState.allocationRows]
  );

  const symbolSuggestions = useMemo(() => {
    const fromProfiles = profiles.flatMap((profile) => Object.keys(profile.allocation));
    return Array.from(new Set([...COMMON_ALLOCATION_SYMBOLS, ...fromProfiles])).sort((left, right) => left.localeCompare(right));
  }, [profiles]);

  const submitProfileForm = (): void => {
    const name = formState.name.trim();
    const strategyId = formState.strategyId.trim();
    const baseCurrency = normalizeSymbol(formState.baseCurrency);
    const allocatedCapital = Number(formState.allocatedCapital);
    const autoExecuteMinDriftPct = Number(formState.autoExecuteMinDriftPct);
    const normalizedRows = formState.allocationRows
      .map((row) => ({ symbol: normalizeSymbol(row.symbol), percent: Number(row.percent) }))
      .filter((row) => row.symbol && Number.isFinite(row.percent) && row.percent > 0);
    const totalPercent = normalizedRows.reduce((sum, row) => sum + row.percent, 0);
    const duplicateSymbols = new Set<string>();
    const uniqueSymbols = new Set<string>();
    normalizedRows.forEach((row) => {
      if (uniqueSymbols.has(row.symbol)) {
        duplicateSymbols.add(row.symbol);
      }
      uniqueSymbols.add(row.symbol);
    });

    if (!name) {
      setErrorMessage("Allocation name is required.");
      return;
    }
    if (!strategyId) {
      setErrorMessage("Choose a usable strategy for this allocation.");
      return;
    }
    if (!usableStrategies.some((strategy) => strategy.id === strategyId)) {
      setErrorMessage("The linked strategy must be enabled and usable.");
      return;
    }
    if (!Number.isFinite(allocatedCapital) || allocatedCapital <= 0) {
      setErrorMessage("Allocated capital must be greater than zero.");
      return;
    }
    if (!baseCurrency) {
      setErrorMessage("Base currency is required.");
      return;
    }
    if (normalizedRows.length === 0) {
      setErrorMessage("Add at least one asset allocation row.");
      return;
    }
    if (duplicateSymbols.size > 0) {
      setErrorMessage(`Duplicate asset symbols are not allowed: ${Array.from(duplicateSymbols).join(", ")}.`);
      return;
    }
    if (Math.abs(totalPercent - 100) > 0.001) {
      setErrorMessage(`Allocation rows must total 100.00%. Current total: ${totalPercent.toFixed(2)}%.`);
      return;
    }
    if (
      (formState.executionPolicy === "on_strategy_run" || formState.executionPolicy === "interval") &&
      (!Number.isFinite(autoExecuteMinDriftPct) || autoExecuteMinDriftPct < 0)
    ) {
      setErrorMessage("Auto-execution drift threshold must be zero or greater.");
      return;
    }
    if (formState.executionPolicy === "interval" && !formState.scheduleInterval.trim()) {
      setErrorMessage("Interval execution requires a schedule interval such as 1h or 1d.");
      return;
    }

    const payload: RebalanceAllocationInput = {
      name,
      description: formState.description.trim() || undefined,
      strategyId,
      allocatedCapital,
      baseCurrency,
      allocations: normalizedRows as DemoAccountAllocationInput[],
      isEnabled: formState.isEnabled,
      executionPolicy: formState.executionPolicy,
      autoExecuteMinDriftPct:
        formState.executionPolicy === "manual" ? undefined : Number(autoExecuteMinDriftPct.toFixed(4)),
      scheduleInterval: formState.executionPolicy === "interval" ? formState.scheduleInterval.trim().toLowerCase() : undefined,
    };

    setSuccessMessage("");
    setErrorMessage("");

    if (editingProfileId) {
      updateProfileMutation.mutate({ profileId: editingProfileId, payload });
      return;
    }

    createProfileMutation.mutate(payload);
  };

  const removeProfile = (profile: RebalanceAllocationProfile): void => {
    if (deleteProfileMutation.isPending) return;
    if (!window.confirm(`Delete allocation "${profile.name}"?`)) return;
    setSuccessMessage("");
    setErrorMessage("");
    deleteProfileMutation.mutate(profile.id);
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-mono font-semibold text-foreground">Rebalance</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Store multiple allocation situations, link each one to a usable strategy, and execute them manually or automatically.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {selectedProfile ? (
            <>
              <button
                type="button"
                onClick={() => openEditModal(selectedProfile)}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-2 text-xs font-mono font-semibold text-foreground transition-colors hover:bg-secondary"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
              <button
                type="button"
                onClick={() => executeProfileMutation.mutate(selectedProfile.id)}
                disabled={!canExecute}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-mono font-semibold text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Play className="h-3.5 w-3.5" />
                Execute Allocation
              </button>
            </>
          ) : null}

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-4 py-2 text-xs font-mono font-semibold text-primary transition-colors hover:bg-primary/15"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Allocation
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card px-4 py-3 text-[11px] text-muted-foreground">
        Strategies decide the target. Allocation profiles define the capital, holdings, and auto-execution rules for each specific rebalance situation.
      </div>

      {successMessage ? (
        <div className="rounded-md border border-positive/30 bg-positive/10 px-4 py-3 text-xs text-positive">{successMessage}</div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-md border border-negative/30 bg-negative/10 px-4 py-3 text-xs text-negative">{errorMessage}</div>
      ) : null}

      {strategiesError ? (
        <div className="rounded-md border border-negative/30 bg-negative/10 px-4 py-3 text-xs text-negative">
          {strategiesError instanceof Error ? strategiesError.message : "Failed to load strategies."}
        </div>
      ) : null}

      {profilesError ? (
        <div className="rounded-md border border-negative/30 bg-negative/10 px-4 py-3 text-xs text-negative">
          {profilesError instanceof Error ? profilesError.message : "Failed to load allocation profiles."}
        </div>
      ) : null}

      {profiles.length === 0 && !loadingProfiles ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center animate-fade-scale-in">
          <div className="text-[11px] font-mono uppercase tracking-[0.24em] text-muted-foreground">No Active Allocation</div>
          <h3 className="mt-3 text-lg font-mono font-semibold text-foreground">Create your first rebalance allocation</h3>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">
            Each allocation keeps its own capital, asset mix, linked strategy, and execution policy so you can switch between multiple rebalance situations.
          </p>
          <button
            type="button"
            onClick={openCreateModal}
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-mono font-semibold text-primary-foreground"
          >
            <Plus className="h-4 w-4" />
            Create Allocation
          </button>
        </div>
      ) : null}

      {profiles.length > 0 ? (
        <div className="space-y-4">
          <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Stored Allocation Situations</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {profiles.map((profile) => {
              const selected = profile.id === selectedProfileId;
              const strategyName = getStrategyName(profile.strategyId, strategiesData?.strategies ?? []);
              const policyMeta = EXECUTION_POLICY_META[profile.executionPolicy];

              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => setSelectedProfileId(profile.id)}
                  className={cn(
                    "rounded-xl border bg-card p-4 text-left transition-all duration-200 animate-fade-up",
                    selected ? "border-primary/40 shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]" : "border-border hover:border-primary/20 hover:bg-secondary/25"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-mono font-semibold text-foreground">{profile.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{strategyName}</div>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded px-2 py-1 text-[10px] font-mono uppercase tracking-wider",
                        profile.isEnabled ? "bg-positive/10 text-positive" : "bg-secondary text-muted-foreground"
                      )}
                    >
                      {profile.isEnabled ? "Enabled" : "Paused"}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs font-mono">
                    <div>
                      <div className="text-muted-foreground">Capital</div>
                      <div className="mt-1 text-foreground">{formatUsd(profile.allocatedCapital)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Policy</div>
                      <div className="mt-1 text-foreground">{policyMeta.label}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Last Exec</div>
                      <div className="mt-1 text-foreground">{profile.lastExecutedAt ? formatDateTime(profile.lastExecutedAt) : "--"}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Next Run</div>
                      <div className="mt-1 text-foreground">{profile.nextExecutionAt ? formatDateTime(profile.nextExecutionAt) : "--"}</div>
                    </div>
                  </div>

                  {profile.description ? <div className="mt-4 text-xs text-muted-foreground">{profile.description}</div> : null}

                  {selected ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditModal(profile);
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-mono text-foreground hover:bg-secondary"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeProfile(profile);
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-negative/30 px-2.5 py-1.5 text-[11px] font-mono text-negative hover:bg-negative/10"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {selectedProfile ? (
        <>
          {stateError ? (
            <div className="rounded-md border border-negative/30 bg-negative/10 px-4 py-3 text-xs text-negative">
              {stateError instanceof Error ? stateError.message : "Failed to evaluate the selected allocation."}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Loaded Allocation</div>
              <div className="mt-2 text-sm font-mono text-foreground">{selectedProfile.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">{formatUsd(selectedProfile.allocatedCapital)} capital</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Linked Strategy</div>
              <div className="mt-2 text-sm font-mono text-foreground">{linkedStrategyName}</div>
              <div className="mt-1 text-xs text-muted-foreground">Enabled custom strategy required</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Execution Policy</div>
              <div className="mt-2 text-sm font-mono text-foreground">{EXECUTION_POLICY_META[selectedPolicy].label}</div>
              <div className="mt-1 text-xs text-muted-foreground">{EXECUTION_POLICY_META[selectedPolicy].helper}</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Rebalance Required</div>
              <div
                className={cn(
                  "mt-2 text-sm font-mono",
                  state?.executionPlan?.rebalanceRequired ? "text-positive" : "text-muted-foreground"
                )}
              >
                {state?.executionPlan?.rebalanceRequired ? "Yes" : loadingState ? "Loading..." : "No"}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Drift / Turnover</div>
              <div className="mt-2 text-sm font-mono text-foreground">{formatPercent(state?.executionPlan?.driftPct)}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Turnover {formatPercent(state?.executionPlan?.estimatedTurnoverPct)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <AllocationPieCard title="Current Allocation" data={currentChart} dataSignature={currentChartSignature} animationDelayMs={40} />
            <AllocationPieCard
              title="Adjusted Target Allocation"
              data={targetChart}
              dataSignature={targetChartSignature}
              animationDelayMs={140}
            />
          </div>

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="border-b border-border px-5 py-4 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Allocation Delta
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="border-b border-border">
                    {["Asset", "Current", "Target", "Difference", "Action"].map((heading) => (
                      <th
                        key={heading}
                        className="px-4 py-3 text-right text-[10px] font-mono uppercase tracking-wider text-muted-foreground first:text-left"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loadingProfiles || loadingStrategies || loadingState ? (
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
                      <tr key={row.symbol} className="border-b border-border last:border-b-0">
                        <td className="px-4 py-3 text-left text-sm font-mono text-foreground">{row.symbol}</td>
                        <td className="px-4 py-3 text-right text-sm font-mono text-foreground">{row.current.toFixed(2)}%</td>
                        <td className="px-4 py-3 text-right text-sm font-mono text-foreground">{row.target.toFixed(2)}%</td>
                        <td
                          className={cn(
                            "px-4 py-3 text-right text-sm font-mono",
                            row.diff > 0 ? "text-positive" : row.diff < 0 ? "text-negative" : "text-muted-foreground"
                          )}
                        >
                          {row.diff > 0 ? "+" : ""}
                          {row.diff.toFixed(2)}%
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-mono">
                          <span
                            className={cn(
                              "rounded px-2 py-1 text-[10px]",
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
          </div>

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="border-b border-border px-5 py-4 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Recommended Trades
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr className="border-b border-border">
                    {["Asset", "Side", "Current %", "Target %", "Notional", "Reason"].map((heading) => (
                      <th
                        key={heading}
                        className="px-4 py-3 text-right text-[10px] font-mono uppercase tracking-wider text-muted-foreground first:text-left"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state?.executionPlan?.recommendedTrades?.length ? (
                    state.executionPlan.recommendedTrades.map((trade, index) => (
                      <tr key={`${trade.asset}-${trade.side}-${index}`} className="border-b border-border last:border-b-0">
                        <td className="px-4 py-3 text-left text-sm font-mono text-foreground">{trade.asset}</td>
                        <td className={cn("px-4 py-3 text-right text-sm font-mono", trade.side === "BUY" ? "text-positive" : "text-negative")}>
                          {trade.side}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-mono text-foreground">{trade.currentPercent.toFixed(2)}%</td>
                        <td className="px-4 py-3 text-right text-sm font-mono text-foreground">{trade.targetPercent.toFixed(2)}%</td>
                        <td className="px-4 py-3 text-right text-sm font-mono text-foreground">{formatUsd(trade.amountNotional)}</td>
                        <td className="px-4 py-3 text-right text-xs font-mono text-muted-foreground">{trade.reason}</td>
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
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Warnings</div>
            {warnings.length === 0 ? (
              <div className="text-sm text-muted-foreground">No warnings for this allocation evaluation.</div>
            ) : (
              <div className="space-y-2">
                {warnings.map((warning) => (
                  <div key={warning} className="rounded border border-border px-3 py-2 text-xs font-mono text-muted-foreground">
                    {warning}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 grid grid-cols-1 gap-3 text-[11px] text-muted-foreground md:grid-cols-3">
              <div>Last evaluation: {formatDateTime(selectedProfile.lastEvaluatedAt)}</div>
              <div>Last execution: {formatDateTime(selectedProfile.lastExecutedAt)}</div>
              <div>Next scheduled check: {formatDateTime(selectedProfile.nextExecutionAt)}</div>
            </div>
          </div>
        </>
      ) : null}

      {profileModalOpen ? (
        <div className="fixed inset-0 z-[70] animate-overlay-fade" onClick={closeProfileModal}>
          <div className="absolute inset-0 bg-background/80 backdrop-blur-md" />
          <div className="relative flex h-full w-full items-end justify-center p-0 sm:items-center sm:p-4 md:p-6">
            <div
              className="flex h-full w-full flex-col overflow-hidden rounded-none border border-border bg-[linear-gradient(180deg,_hsl(var(--card))_0%,_hsl(var(--secondary)/0.45)_100%)] shadow-2xl animate-fade-scale-in sm:h-auto sm:max-h-[calc(100vh-3rem)] sm:max-w-5xl sm:rounded-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-card/95 px-4 py-4 backdrop-blur sm:px-6">
                <div className="min-w-0">
                  <div className="text-[11px] font-mono uppercase tracking-[0.26em] text-muted-foreground">
                    {editingProfileId ? "Edit Allocation" : "Create Allocation"}
                  </div>
                  <h3 className="mt-2 text-lg font-semibold text-foreground sm:text-xl">
                    {editingProfileId ? "Update rebalance situation" : "Create a new rebalance situation"}
                  </h3>
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    Link a dedicated capital bucket to an enabled custom strategy, then choose whether it executes manually, on strategy runs, or on its own interval.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeProfileModal}
                  className="shrink-0 rounded-lg border border-border bg-secondary/40 p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                  aria-label="Close allocation modal"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <datalist id="rebalance-allocation-symbols">
                {symbolSuggestions.map((symbol) => (
                  <option key={symbol} value={symbol} />
                ))}
              </datalist>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
                <div className="mx-auto w-full max-w-4xl space-y-5">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Allocation Name</label>
                      <input
                        value={formState.name}
                        onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))}
                        className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-3 text-sm font-mono text-foreground outline-none"
                        placeholder="Growth basket"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Linked Strategy</label>
                      <select
                        value={formState.strategyId}
                        onChange={(event) => setFormState((current) => ({ ...current, strategyId: event.target.value }))}
                        className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-3 text-sm font-mono text-foreground outline-none"
                      >
                        <option value="">Select a strategy</option>
                        {usableStrategies.map((strategy) => (
                          <option key={strategy.id} value={strategy.id}>
                            {strategy.name}
                          </option>
                        ))}
                      </select>
                      {usableStrategies.length === 0 ? (
                        <div className="mt-2 text-xs text-negative">
                          Create and enable a custom strategy in Strategies before saving an allocation profile.
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Description</label>
                    <textarea
                      value={formState.description}
                      onChange={(event) => setFormState((current) => ({ ...current, description: event.target.value }))}
                      className="mt-1 min-h-[88px] w-full rounded-md border border-border bg-secondary px-3 py-3 text-sm text-foreground outline-none"
                      placeholder="Optional notes about when this allocation should be used."
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Allocated Capital</label>
                      <input
                        value={formState.allocatedCapital}
                        onChange={(event) => setFormState((current) => ({ ...current, allocatedCapital: event.target.value }))}
                        className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-3 text-sm font-mono text-foreground outline-none"
                        placeholder="500"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Base Currency</label>
                      <select
                        value={formState.baseCurrency}
                        onChange={(event) => setFormState((current) => ({ ...current, baseCurrency: event.target.value }))}
                        className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-3 text-sm font-mono text-foreground outline-none"
                      >
                        {BASE_CURRENCY_OPTIONS.map((currency) => (
                          <option key={currency} value={currency}>
                            {currency}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end">
                      <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={formState.isEnabled}
                          onChange={(event) => setFormState((current) => ({ ...current, isEnabled: event.target.checked }))}
                          className="h-4 w-4 rounded border-border bg-secondary"
                        />
                        Enabled for automation
                      </label>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Execution Policy</div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                      {(Object.entries(EXECUTION_POLICY_META) as Array<
                        [RebalanceAllocationExecutionPolicy, (typeof EXECUTION_POLICY_META)[RebalanceAllocationExecutionPolicy]]
                      >).map(([policy, meta]) => (
                        <button
                          key={policy}
                          type="button"
                          onClick={() => setFormState((current) => ({ ...current, executionPolicy: policy }))}
                          className={cn(
                            "rounded-lg border p-3 text-left transition-colors",
                            formState.executionPolicy === policy
                              ? "border-primary/40 bg-primary/10"
                              : "border-border bg-card hover:bg-secondary/40"
                          )}
                        >
                          <div className="text-sm font-mono font-semibold text-foreground">{meta.label}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{meta.helper}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Auto Drift Threshold %</label>
                      <input
                        value={formState.autoExecuteMinDriftPct}
                        onChange={(event) => setFormState((current) => ({ ...current, autoExecuteMinDriftPct: event.target.value }))}
                        disabled={formState.executionPolicy === "manual"}
                        className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-3 text-sm font-mono text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60"
                        placeholder="2"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Schedule Interval</label>
                      <input
                        value={formState.scheduleInterval}
                        onChange={(event) => setFormState((current) => ({ ...current, scheduleInterval: event.target.value }))}
                        disabled={formState.executionPolicy !== "interval"}
                        className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-3 text-sm font-mono text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60"
                        placeholder="1d"
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-card/60 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Target Allocation</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          Set the asset percentages for this stored rebalance situation. Total must equal 100%.
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Current Total</div>
                        <div className={cn("mt-1 text-sm font-mono", Math.abs(totalDraftPercent - 100) < 0.001 ? "text-positive" : "text-foreground")}>
                          {totalDraftPercent.toFixed(2)}%
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 space-y-3">
                      {formState.allocationRows.map((row, index) => (
                        <div key={row.id} className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_160px_auto]">
                          <div>
                            <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Asset {index + 1}</label>
                            <input
                              value={row.symbol}
                              onChange={(event) =>
                                setFormState((current) => ({
                                  ...current,
                                  allocationRows: current.allocationRows.map((entry) =>
                                    entry.id === row.id ? { ...entry, symbol: event.target.value.toUpperCase() } : entry
                                  ),
                                }))
                              }
                              list="rebalance-allocation-symbols"
                              spellCheck={false}
                              className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-3 text-sm font-mono uppercase text-foreground outline-none"
                              placeholder="BTC"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Percent</label>
                            <input
                              value={row.percent}
                              onChange={(event) =>
                                setFormState((current) => ({
                                  ...current,
                                  allocationRows: current.allocationRows.map((entry) =>
                                    entry.id === row.id ? { ...entry, percent: event.target.value } : entry
                                  ),
                                }))
                              }
                              className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-3 text-sm font-mono text-foreground outline-none"
                              placeholder="25"
                            />
                          </div>
                          <div className="flex items-end">
                            <button
                              type="button"
                              onClick={() =>
                                setFormState((current) => ({
                                  ...current,
                                  allocationRows:
                                    current.allocationRows.length > 1
                                      ? current.allocationRows.filter((entry) => entry.id !== row.id)
                                      : [createDraftAllocationRow()],
                                }))
                              }
                              className="inline-flex h-12 items-center justify-center rounded-md border border-border px-3 text-xs font-mono text-muted-foreground hover:text-foreground"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <button
                        type="button"
                        onClick={() =>
                          setFormState((current) => ({
                            ...current,
                            allocationRows: [...current.allocationRows, createDraftAllocationRow()],
                          }))
                        }
                        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-mono text-foreground hover:bg-secondary"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Asset
                      </button>
                      <div className="text-xs text-muted-foreground">Examples: BTC 40, ETH 25, SOL 15, USDC 20</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="sticky bottom-0 flex flex-col gap-3 border-t border-border bg-card/95 px-4 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="text-xs text-muted-foreground">
                  Automatic modes always use the linked strategy. The strategy decides the target; this allocation decides the capital bucket and execution timing.
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={closeProfileModal}
                    disabled={createProfileMutation.isPending || updateProfileMutation.isPending}
                    className="rounded-md border border-border px-4 py-2.5 text-sm font-mono text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitProfileForm}
                    disabled={createProfileMutation.isPending || updateProfileMutation.isPending || loadingStrategies || usableStrategies.length === 0}
                    className="rounded-md bg-primary px-4 py-2.5 text-sm font-mono font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {editingProfileId ? "Save Allocation" : "Create Allocation"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

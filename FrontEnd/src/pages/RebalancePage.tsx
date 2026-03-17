import { memo, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Loader2, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { backendApi } from "@/lib/api";
import {
  useDashboardData,
  useDemoAccountSettings,
  useRebalanceAllocationProfiles,
  useRebalanceAllocationState,
  useStrategies,
  useStrategyRunDetails,
  useStrategyRuns,
} from "@/hooks/useTradingData";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import type {
  Asset,
  DemoAccountAllocationInput,
  PortfolioAccountType,
  RebalanceAllocationExecutionPolicy,
  RebalanceAllocationInput,
  RebalanceAllocationProfile,
  RebalanceAllocationProfilesResponse,
  RebalanceAllocationStateResponse,
  StrategyConfig,
  StrategyRun,
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
const EMPTY_ASSETS: Asset[] = [];
const EMPTY_PROFILES: RebalanceAllocationProfile[] = [];
const EMPTY_RUNS: StrategyRun[] = [];
const EMPTY_ALLOCATION_MAP: Record<string, number> = {};

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
  sliderPercent: number;
  allocatedValue: string;
  isEnabled: boolean;
}

interface DraftAllocationRowValidation {
  symbol: string;
  heldValue: number;
  targetValue: number;
  exceedsHoldings: boolean;
  shortfallValue: number;
}

interface AllocationFormState {
  name: string;
  description: string;
  strategyId: string;
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

interface PendingActionModalProps {
  title: string;
  description: string;
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

function formatPercent(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value.toFixed(2)}%`;
}

function formatUsd(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatNotional(value: number | undefined, currency: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function createRowId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatDraftAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, "");
}

function createDraftAllocationRow(
  symbol = "",
  allocatedValue = "0",
  sliderPercent = 0,
  isEnabled = false
): DraftAllocationRow {
  return { id: createRowId(), symbol, allocatedValue, sliderPercent, isEnabled };
}

function buildManagedAssetSymbols(portfolioAssets: Asset[], baseCurrency: string, extraSymbols: string[] = []): string[] {
  const symbols: string[] = [];
  const seen = new Set<string>();
  const pushSymbol = (value: string): void => {
    const symbol = normalizeSymbol(value);
    if (!symbol || seen.has(symbol)) return;
    seen.add(symbol);
    symbols.push(symbol);
  };

  portfolioAssets.forEach((asset) => pushSymbol(asset.symbol));
  extraSymbols.forEach((symbol) => pushSymbol(symbol));

  if (symbols.length === 0) {
    pushSymbol(baseCurrency);
  }

  return symbols;
}

function buildManagedAllocationRows(portfolioAssets: Asset[], baseCurrency: string): DraftAllocationRow[] {
  const normalizedBaseCurrency = normalizeSymbol(baseCurrency);
  const symbols = buildManagedAssetSymbols(portfolioAssets, normalizedBaseCurrency);
  return symbols.map((symbol) => createDraftAllocationRow(symbol, "0", 0, false));
}

function createDefaultFormState(strategyId = "", portfolioAssets: Asset[] = [], baseCurrency = "USDC"): AllocationFormState {
  return {
    name: "",
    description: "",
    strategyId,
    baseCurrency,
    executionPolicy: "manual",
    autoExecuteMinDriftPct: "2",
    scheduleInterval: "1d",
    isEnabled: true,
    allocationRows: buildManagedAllocationRows(portfolioAssets, baseCurrency),
  };
}

function createFormStateFromProfile(profile: RebalanceAllocationProfile, portfolioAssets: Asset[] = []): AllocationFormState {
  const portfolioValueBySymbol = portfolioAssets.reduce<Record<string, number>>((map, asset) => {
    map[normalizeSymbol(asset.symbol)] = asset.value;
    return map;
  }, {});
  const symbols = buildManagedAssetSymbols(portfolioAssets, profile.baseCurrency, Object.keys(profile.allocation));
  const allocationRows = symbols.map((symbol) => {
    const heldValue = portfolioValueBySymbol[symbol] ?? 0;
    const allocatedValue = ((profile.allocation[symbol] ?? 0) / 100) * profile.allocatedCapital;
    const clampedValue = heldValue > 0 ? Math.min(allocatedValue, heldValue) : 0;
    const sliderPercent = heldValue > 0 ? Math.min(100, (clampedValue / heldValue) * 100) : 0;
    return createDraftAllocationRow(symbol, formatDraftAmount(clampedValue), sliderPercent, clampedValue > 0);
  });

  return {
    name: profile.name,
    description: profile.description ?? "",
    strategyId: profile.strategyId,
    baseCurrency: profile.baseCurrency,
    executionPolicy: profile.executionPolicy,
    autoExecuteMinDriftPct: profile.autoExecuteMinDriftPct?.toString() ?? "2",
    scheduleInterval: profile.scheduleInterval ?? "1d",
    isEnabled: profile.isEnabled,
    allocationRows: allocationRows.length > 0 ? allocationRows : [createDraftAllocationRow(profile.baseCurrency, "0", 0, false)],
  };
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function buildChartSignature(data: AllocationChartSlice[]): string {
  return data.map((entry) => `${entry.name}:${entry.value.toFixed(4)}`).join("|");
}

function buildAllocationRows(
  currentAllocation: Record<string, number>,
  targetAllocation: Record<string, number>
): AllocationRow[] {
  const symbols = Array.from(new Set([...Object.keys(currentAllocation), ...Object.keys(targetAllocation)])).sort((a, b) =>
    a.localeCompare(b)
  );

  return symbols.map((symbol) => ({
    symbol,
    current: currentAllocation[symbol] ?? 0,
    target: targetAllocation[symbol] ?? 0,
    diff: (targetAllocation[symbol] ?? 0) - (currentAllocation[symbol] ?? 0),
  }));
}

function mergeUniqueWarnings(...collections: ReadonlyArray<readonly string[]>): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  collections.forEach((collection) => {
    collection.forEach((warning) => {
      const normalized = warning.trim();
      if (!normalized || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      merged.push(normalized);
    });
  });

  return merged;
}

function createExecutedStateSnapshot(
  state: RebalanceAllocationStateResponse,
  run: StrategyRun
): RebalanceAllocationStateResponse {
  const executedAllocation = run.adjustedAllocation ?? state.executionPlan.adjustedTargetAllocation ?? state.adjustedTargetAllocation;
  const completedAt = run.completedAt ?? new Date().toISOString();
  const warnings = mergeUniqueWarnings(run.warnings, state.executionPlan?.warnings ?? [], state.warnings ?? []);

  return {
    ...state,
    currentAllocation: { ...executedAllocation },
    adjustedTargetAllocation: { ...executedAllocation },
    portfolio: {
      ...state.portfolio,
      timestamp: completedAt,
      allocation: { ...executedAllocation },
    },
    executionPlan: {
      ...state.executionPlan,
      timestamp: completedAt,
      currentAllocation: { ...executedAllocation },
      adjustedTargetAllocation: { ...executedAllocation },
      rebalanceRequired: false,
      driftPct: 0,
      estimatedTurnoverPct: 0,
      recommendedTrades: [],
      warnings,
    },
    projectedOutcome: state.projectedOutcome
      ? {
          ...state.projectedOutcome,
          generatedAt: completedAt,
          driftPct: 0,
          estimatedTurnoverPct: 0,
          projectedAllocation: { ...executedAllocation },
          holdings: state.projectedOutcome.holdings.map((holding) => {
            const nextPercent = executedAllocation[holding.symbol] ?? holding.targetPercent;
            return {
              ...holding,
              currentPercent: nextPercent,
              targetPercent: nextPercent,
              currentValue: holding.targetValue,
              currentQuantity: holding.targetQuantity,
              deltaValue: 0,
            };
          }),
        }
      : state.projectedOutcome,
    warnings,
  };
}

function getDraftRowAllocatedValue(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, parsed);
}

function clampAllocatedValue(value: number, heldValue: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(heldValue) || heldValue <= 0) return 0;
  return Math.min(value, heldValue);
}

function deriveSliderPercentFromValue(allocatedValue: number, heldValue: number): number {
  if (!Number.isFinite(allocatedValue) || allocatedValue <= 0 || !Number.isFinite(heldValue) || heldValue <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (allocatedValue / heldValue) * 100));
}

function getAllocationEntries(allocation: RebalanceAllocationProfile["allocation"]): Array<[string, number]> {
  return Object.entries(allocation).sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0].localeCompare(right[0]);
  });
}

function renderAllocationLabel({ name, value }: { name?: string; value?: number }): string {
  if (!name || typeof value !== "number" || !Number.isFinite(value)) return "";
  return `${name} ${value.toFixed(1)}%`;
}

function getStrategyName(strategyId: string, strategies: StrategyConfig[]): string {
  return strategies.find((strategy) => strategy.id === strategyId)?.name ?? strategyId;
}

function getRunStatusClassName(status: StrategyRun["status"]): string {
  switch (status) {
    case "completed":
      return "text-positive";
    case "failed":
      return "text-negative";
    case "skipped":
      return "text-amber-200";
    default:
      return "text-muted-foreground";
  }
}

function getRunSummary(run: StrategyRun): string {
  if (run.status === "failed") {
    return run.error ?? "Execution failed.";
  }
  if (run.status === "skipped") {
    return run.skipReason ?? run.warnings[0] ?? "Execution skipped.";
  }
  if (run.warnings.some((warning) => warning.toLowerCase().includes("executed"))) {
    return "Rebalance executed.";
  }
  if (run.warnings.some((warning) => warning.toLowerCase().includes("no rebalance"))) {
    return "Evaluated with no changes.";
  }
  return "Run completed.";
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

function PendingActionModal({ title, description }: PendingActionModalProps) {
  return (
    <div className="fixed inset-0 z-[80] animate-overlay-fade">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-md" />
      <div className="relative flex min-h-full items-center justify-center px-4 py-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-fade-scale-in sm:p-7">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
            <div className="min-w-0">
              <div className="text-lg font-semibold text-foreground">{title}</div>
              <div className="mt-2 text-sm leading-6 text-muted-foreground">{description}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RebalancePage({ accountType }: RebalancePageProps) {
  const queryClient = useQueryClient();
  const { data: dashboardData } = useDashboardData(accountType);
  const { data: demoAccountSettingsData } = useDemoAccountSettings();
  const { data: historyData, isPending: loadingHistory } = useStrategyRuns("demo");

  const { data: strategiesData, isPending: loadingStrategies, error: strategiesError } = useStrategies();
  const usableStrategies = useMemo(
    () => (strategiesData?.strategies ?? []).filter((strategy) => strategy.isEnabled && !BASIC_STRATEGY_IDS.has(strategy.id)),
    [strategiesData?.strategies]
  );
  const defaultStrategyId = usableStrategies[0]?.id ?? "";

  const {
    data: profilesData,
    isPending: loadingProfiles,
    error: profilesError,
  } = useRebalanceAllocationProfiles();
  const profiles = profilesData?.profiles ?? EMPTY_PROFILES;
  const historyRuns = historyData?.runs ?? EMPTY_RUNS;
  const demoAccountBalance = demoAccountSettingsData?.demoAccount.balance;

  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [runDetailsModalOpen, setRunDetailsModalOpen] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [formState, setFormState] = useState<AllocationFormState>(() => createDefaultFormState());
  const [errorMessage, setErrorMessage] = useState("");

  const portfolioAssets = dashboardData?.assets ?? EMPTY_ASSETS;
  const portfolioAssetMap = useMemo(
    () =>
      portfolioAssets.reduce<Record<string, Asset>>((map, asset) => {
        map[asset.symbol.toUpperCase()] = asset;
        return map;
      }, {}),
    [portfolioAssets]
  );

  const reservedCapitalExcludingEdit = useMemo(() => {
    return profiles.reduce((sum, profile) => {
      if (!profile.isEnabled) return sum;
      if (profile.id === editingProfileId) return sum;
      return sum + profile.allocatedCapital;
    }, 0);
  }, [editingProfileId, profiles]);

  const draftAllocatedCapitalValue = useMemo(
    () =>
      formState.allocationRows.reduce((sum, row) => {
        if (!row.isEnabled) return sum;
        return sum + getDraftRowAllocatedValue(row.allocatedValue);
      }, 0),
    [formState.allocationRows]
  );

  const projectedCapitalReservation = useMemo(() => {
    const requestedCapital = draftAllocatedCapitalValue > 0 && formState.isEnabled ? draftAllocatedCapitalValue : 0;
    return reservedCapitalExcludingEdit + requestedCapital;
  }, [draftAllocatedCapitalValue, formState.isEnabled, reservedCapitalExcludingEdit]);

  useEffect(() => {
    if (!selectedProfileId || !profiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId(profiles[0]?.id ?? "");
    }
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    if (profileModalOpen || editingProfileId || !defaultStrategyId) {
      return;
    }

    setFormState((current) =>
      current.strategyId ? current : createDefaultFormState(defaultStrategyId, portfolioAssets, current.baseCurrency)
    );
  }, [defaultStrategyId, editingProfileId, portfolioAssets, profileModalOpen]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId]
  );
  const allocationHistory = useMemo(
    () => historyRuns.filter((run) => run.rebalanceAllocationId === selectedProfileId),
    [historyRuns, selectedProfileId]
  );

  const {
    data: state,
    isPending: loadingState,
    error: stateError,
  } = useRebalanceAllocationState(selectedProfileId || undefined);
  const { data: runDetailsData, isPending: loadingRunDetails } = useStrategyRunDetails(
    runDetailsModalOpen ? selectedRunId || undefined : undefined
  );
  const selectedRun = runDetailsData?.run ?? allocationHistory.find((run) => run.id === selectedRunId) ?? null;
  const selectedRunExecutionPlan = runDetailsData?.executionPlan ?? null;

  const upsertProfileInCache = (profile: RebalanceAllocationProfile): void => {
    queryClient.setQueryData<RebalanceAllocationProfilesResponse>(["rebalance-allocation-profiles"], (current) => {
      const existingProfiles = current?.profiles ?? [];
      const nextProfiles = [profile, ...existingProfiles.filter((entry) => entry.id !== profile.id)];
      return { profiles: nextProfiles };
    });
  };

  const removeProfileFromCache = (profileId: string): void => {
    queryClient.setQueryData<RebalanceAllocationProfilesResponse>(["rebalance-allocation-profiles"], (current) => ({
      profiles: (current?.profiles ?? []).filter((entry) => entry.id !== profileId),
    }));
  };

  const invalidateQueries = async (options?: { profileId?: string; includeState?: boolean; runId?: string }): Promise<void> => {
    const targetProfileId = options?.profileId ?? selectedProfileId;
    const tasks = [
      queryClient.invalidateQueries({ queryKey: ["rebalance-allocation-profiles"] }),
      queryClient.invalidateQueries({ queryKey: ["strategy-runs", "demo"] }),
      queryClient.invalidateQueries({ queryKey: ["strategies"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard", "demo"] }),
      queryClient.invalidateQueries({ queryKey: ["demo-account-settings"] }),
    ];

    if (options?.includeState !== false && targetProfileId) {
      tasks.push(queryClient.invalidateQueries({ queryKey: ["rebalance-allocation-state", targetProfileId] }));
    }

    if (options?.runId) {
      tasks.push(queryClient.invalidateQueries({ queryKey: ["strategy-run", options.runId] }));
    }

    await Promise.all(tasks);
  };

  const createProfileMutation = useMutation({
    mutationFn: (payload: RebalanceAllocationInput) => backendApi.createRebalanceAllocationProfile(payload),
    onSuccess: (result) => {
      toast.success(`Allocation "${result.profile.name}" created.`);
      setErrorMessage("");
      setProfileModalOpen(false);
      setEditingProfileId(null);
      setSelectedProfileId(result.profile.id);
      upsertProfileInCache(result.profile);
      void invalidateQueries({ profileId: result.profile.id });
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Unable to create allocation.");
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: ({ profileId, payload }: { profileId: string; payload: RebalanceAllocationInput }) =>
      backendApi.updateRebalanceAllocationProfile(profileId, payload),
    onSuccess: (result) => {
      toast.success(`Allocation "${result.profile.name}" updated.`);
      setErrorMessage("");
      setProfileModalOpen(false);
      setEditingProfileId(null);
      setSelectedProfileId(result.profile.id);
      upsertProfileInCache(result.profile);
      void invalidateQueries({ profileId: result.profile.id });
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Unable to update allocation.");
    },
  });

  const deleteProfileMutation = useMutation({
    mutationFn: (profileId: string) => backendApi.deleteRebalanceAllocationProfile(profileId),
    onSuccess: (_, profileId) => {
      const deleted = profiles.find((profile) => profile.id === profileId);
      toast.success(deleted ? `Allocation "${deleted.name}" deleted.` : "Allocation deleted.");
      setErrorMessage("");
      const nextProfileId = profiles.find((profile) => profile.id !== profileId)?.id ?? "";
      if (selectedProfileId === profileId) {
        setSelectedProfileId(nextProfileId);
      }
      removeProfileFromCache(profileId);
      queryClient.removeQueries({ queryKey: ["rebalance-allocation-state", profileId], exact: true });
      void invalidateQueries({ includeState: false });
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Unable to delete allocation.");
    },
  });

  const executeProfileMutation = useMutation({
    mutationFn: (profileId: string) => backendApi.executeRebalanceAllocationProfile(profileId),
    onSuccess: (result) => {
      const message = result.run.warnings.some((warning) => warning.toLowerCase().includes("executed"))
        ? "Allocation rebalance executed using the latest market prices."
        : `Allocation execution completed with status: ${result.run.status}.`;
      toast.success(message);
      setErrorMessage("");
      const targetProfileId = result.run.rebalanceAllocationId ?? selectedProfileId;
      const canProjectExecutedState =
        result.run.status === "completed" &&
        Boolean(result.run.adjustedAllocation) &&
        Boolean(targetProfileId) &&
        Boolean(queryClient.getQueryData<RebalanceAllocationStateResponse>(["rebalance-allocation-state", targetProfileId]));

      if (targetProfileId) {
        setSelectedProfileId(targetProfileId);
        queryClient.setQueryData<RebalanceAllocationProfilesResponse>(["rebalance-allocation-profiles"], (current) => ({
          profiles: (current?.profiles ?? []).map((profile) =>
            profile.id === targetProfileId
              ? {
                  ...profile,
                  lastEvaluatedAt: result.run.completedAt ?? profile.lastEvaluatedAt,
                  lastExecutedAt: result.run.completedAt ?? profile.lastExecutedAt,
                  updatedAt: result.run.completedAt ?? profile.updatedAt,
                }
              : profile
          ),
        }));

        if (canProjectExecutedState) {
          queryClient.setQueryData<RebalanceAllocationStateResponse>(
            ["rebalance-allocation-state", targetProfileId],
            (current) => (current ? createExecutedStateSnapshot(current, result.run) : current)
          );
        }
      }

      setSelectedRunId(result.run.id);
      void invalidateQueries({
        profileId: targetProfileId,
        includeState: !canProjectExecutedState,
        runId: result.run.id,
      });
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Unable to execute allocation.");
    },
  });

  const currentAllocation = state?.executionPlan?.currentAllocation ?? state?.currentAllocation ?? EMPTY_ALLOCATION_MAP;
  const targetAllocation = state?.executionPlan?.adjustedTargetAllocation ?? state?.adjustedTargetAllocation ?? EMPTY_ALLOCATION_MAP;

  const allocationRows = useMemo<AllocationRow[]>(() => buildAllocationRows(currentAllocation, targetAllocation), [currentAllocation, targetAllocation]);

  const allocationColors = useMemo(
    () =>
      allocationRows.reduce<Record<string, string>>((colorMap, row, index) => {
        colorMap[row.symbol] = CHART_COLORS[index % CHART_COLORS.length];
        return colorMap;
      }, {}),
    [allocationRows]
  );

  const currentChart = useMemo<AllocationChartSlice[]>(
    () =>
      allocationRows
        .filter((row) => Number.isFinite(row.current) && row.current > 0)
        .map((row) => ({ name: row.symbol, value: row.current, color: allocationColors[row.symbol] })),
    [allocationColors, allocationRows]
  );

  const targetChart = useMemo<AllocationChartSlice[]>(
    () =>
      allocationRows
        .filter((row) => Number.isFinite(row.target) && row.target > 0)
        .map((row) => ({ name: row.symbol, value: row.target, color: allocationColors[row.symbol] })),
    [allocationColors, allocationRows]
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
  const selectedRunBaseCurrency =
    selectedRun?.inputSnapshot?.portfolio.baseCurrency ?? selectedProfile?.baseCurrency ?? "USDC";
  const selectedRunAllocationRows = useMemo<AllocationRow[]>(
    () =>
      buildAllocationRows(
        selectedRunExecutionPlan?.currentAllocation ?? selectedRun?.inputSnapshot?.portfolio.allocation ?? {},
        selectedRunExecutionPlan?.adjustedTargetAllocation ?? selectedRun?.adjustedAllocation ?? {}
      ),
    [selectedRun?.adjustedAllocation, selectedRun?.inputSnapshot?.portfolio.allocation, selectedRunExecutionPlan]
  );
  const selectedRunSummary = useMemo(() => {
    if (!selectedRun) return "Select a rebalance event to inspect it.";
    if (selectedRun.status === "failed") {
      return selectedRun.error ?? "This rebalance event failed before completion.";
    }
    if (selectedRun.status === "skipped") {
      return selectedRun.skipReason ?? selectedRun.warnings[0] ?? "This rebalance event was skipped.";
    }
    if (!selectedRunExecutionPlan) {
      return "Loading the execution plan for this rebalance event.";
    }

    const portfolioValue = selectedRun.inputSnapshot?.portfolio.totalValue;
    const assetCount = selectedRun.inputSnapshot?.portfolio.assets.length ?? 0;
    const tradeCount = selectedRunExecutionPlan.recommendedTrades.length;
    const executionState = selectedRun.warnings.some((warning) => warning.toLowerCase().includes("executed"))
      ? "The rebalance executed"
      : "The rebalance evaluated";

    return `${executionState} from ${formatNotional(portfolioValue, selectedRunBaseCurrency)}${assetCount > 0 ? ` across ${assetCount} assets` : ""}. Drift measured ${formatPercent(selectedRunExecutionPlan.driftPct)}, estimated turnover was ${formatPercent(selectedRunExecutionPlan.estimatedTurnoverPct)}, and ${tradeCount} trade${tradeCount === 1 ? "" : "s"} ${tradeCount === 1 ? "was" : "were"} generated.`;
  }, [selectedRun, selectedRunBaseCurrency, selectedRunExecutionPlan]);

  const selectedPolicy = selectedProfile?.executionPolicy ?? "manual";
  const canExecute =
    accountType === "demo" &&
    Boolean(selectedProfile) &&
    !loadingState &&
    !executeProfileMutation.isPending &&
    !createProfileMutation.isPending &&
    !updateProfileMutation.isPending;

  const pendingAction = createProfileMutation.isPending
    ? {
        title: "Creating allocation",
        description: "Saving the capital bucket, validating the linked strategy, and preparing the rebalance allocation now.",
      }
    : updateProfileMutation.isPending
      ? {
          title: "Saving allocation",
          description: "Updating the allocation profile and refreshing the linked rebalance state.",
        }
      : executeProfileMutation.isPending
        ? {
            title: "Executing allocation",
            description: "Refreshing market data and applying the latest rebalance plan. This can take a few seconds.",
          }
        : null;

  useEffect(() => {
    if (allocationHistory.length === 0) {
      setSelectedRunId("");
      return;
    }

    if (!selectedRunId || !allocationHistory.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(allocationHistory[0]?.id ?? "");
    }
  }, [allocationHistory, selectedRunId]);

  const openCreateModal = (): void => {
    setErrorMessage("");
    setEditingProfileId(null);
    setFormState(createDefaultFormState(defaultStrategyId, portfolioAssets));
    setProfileModalOpen(true);
  };

  const openEditModal = (profile: RebalanceAllocationProfile): void => {
    setErrorMessage("");
    setEditingProfileId(profile.id);
    setFormState(createFormStateFromProfile(profile, portfolioAssets));
    setProfileModalOpen(true);
  };

  const closeProfileModal = (): void => {
    if (createProfileMutation.isPending || updateProfileMutation.isPending) return;
    setProfileModalOpen(false);
    setEditingProfileId(null);
  };

  const allocationRowValidationById = useMemo<Record<string, DraftAllocationRowValidation>>(
    () =>
      formState.allocationRows.reduce<Record<string, DraftAllocationRowValidation>>((map, row) => {
        const symbol = normalizeSymbol(row.symbol);
        const targetValue = row.isEnabled ? getDraftRowAllocatedValue(row.allocatedValue) : 0;
        const heldValue = portfolioAssetMap[symbol]?.value ?? 0;
        const exceedsHoldings =
          row.isEnabled && Boolean(symbol) && Number.isFinite(targetValue) && targetValue - heldValue > 0.0001;

        map[row.id] = {
          symbol,
          heldValue,
          targetValue,
          exceedsHoldings,
          shortfallValue: exceedsHoldings ? targetValue - heldValue : 0,
        };

        return map;
      }, {}),
    [formState.allocationRows, portfolioAssetMap]
  );

  const overAllocatedRows = useMemo(
    () => Object.values(allocationRowValidationById).filter((row) => row.exceedsHoldings),
    [allocationRowValidationById]
  );

  const updateManagedFundSlider = (rowId: string, nextSliderPercent: number): void => {
    const clampedSlider = Math.max(0, Math.min(100, nextSliderPercent));

    setFormState((current) => ({
      ...current,
      allocationRows: current.allocationRows.map((entry) => {
        if (entry.id !== rowId) return entry;
        const heldValue = portfolioAssetMap[normalizeSymbol(entry.symbol)]?.value ?? 0;
        const allocatedValue = clampAllocatedValue((heldValue * clampedSlider) / 100, heldValue);
        return {
          ...entry,
          isEnabled: clampedSlider > 0,
          sliderPercent: clampedSlider,
          allocatedValue: formatDraftAmount(allocatedValue),
        };
      }),
    }));
  };

  const updateManagedFundValue = (rowId: string, rawValue: string): void => {
    setFormState((current) => ({
      ...current,
      allocationRows: current.allocationRows.map((entry) => {
        if (entry.id !== rowId) return entry;
        const heldValue = portfolioAssetMap[normalizeSymbol(entry.symbol)]?.value ?? 0;
        if (rawValue.trim() === "") {
          return {
            ...entry,
            isEnabled: false,
            sliderPercent: 0,
            allocatedValue: "",
          };
        }

        const clampedValue = clampAllocatedValue(Number(rawValue), heldValue);
        return {
          ...entry,
          isEnabled: clampedValue > 0,
          sliderPercent: deriveSliderPercentFromValue(clampedValue, heldValue),
          allocatedValue: formatDraftAmount(clampedValue),
        };
      }),
    }));
  };

  const submitProfileForm = (): void => {
    const name = formState.name.trim();
    const strategyId = formState.strategyId.trim();
    const baseCurrency = normalizeSymbol(formState.baseCurrency);
    const allocatedCapital = draftAllocatedCapitalValue;
    const autoExecuteMinDriftPct = Number(formState.autoExecuteMinDriftPct);
    const enabledRows = formState.allocationRows.filter((row) => row.isEnabled && normalizeSymbol(row.symbol));
    const invalidEnabledRows = enabledRows.filter((row) => {
      const allocatedValue = getDraftRowAllocatedValue(row.allocatedValue);
      return !Number.isFinite(allocatedValue) || allocatedValue <= 0;
    });
    const normalizedRows = enabledRows
      .map((row) => ({ symbol: normalizeSymbol(row.symbol), allocatedValue: getDraftRowAllocatedValue(row.allocatedValue) }))
      .filter((row) => row.symbol && Number.isFinite(row.allocatedValue) && row.allocatedValue > 0);
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
      setErrorMessage("Managed capital must be greater than zero.");
      return;
    }
    if (
      formState.isEnabled &&
      Number.isFinite(demoAccountBalance) &&
      projectedCapitalReservation - demoAccountBalance > 0.0001
    ) {
      setErrorMessage(
        `Enabled allocations would reserve ${formatUsd(projectedCapitalReservation)} while the demo account balance is ${formatUsd(demoAccountBalance)}.`
      );
      return;
    }
    if (!baseCurrency) {
      setErrorMessage("Base currency is required.");
      return;
    }
    if (enabledRows.length === 0) {
      setErrorMessage("Enable at least one managed fund.");
      return;
    }
    if (invalidEnabledRows.length > 0) {
      setErrorMessage(`Enabled funds must have a value greater than zero. Fix ${normalizeSymbol(invalidEnabledRows[0].symbol)}.`);
      return;
    }
    if (normalizedRows.length === 0) {
      setErrorMessage("Enabled funds must allocate a positive value.");
      return;
    }
    if (duplicateSymbols.size > 0) {
      setErrorMessage(`Duplicate asset symbols are not allowed: ${Array.from(duplicateSymbols).join(", ")}.`);
      return;
    }
    if (overAllocatedRows.length > 0) {
      const firstInvalidRow = overAllocatedRows[0];
      setErrorMessage(
        `${firstInvalidRow.symbol} target requires ${formatUsd(firstInvalidRow.targetValue)} but only ${formatUsd(firstInvalidRow.heldValue)} is currently held.`
      );
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
      allocations: normalizedRows.map((row) => ({
        symbol: row.symbol,
        percent: allocatedCapital > 0 ? (row.allocatedValue / allocatedCapital) * 100 : 0,
      })) as DemoAccountAllocationInput[],
      isEnabled: formState.isEnabled,
      executionPolicy: formState.executionPolicy,
      autoExecuteMinDriftPct:
        formState.executionPolicy === "manual" ? undefined : Number(autoExecuteMinDriftPct.toFixed(4)),
      scheduleInterval: formState.executionPolicy === "interval" ? formState.scheduleInterval.trim().toLowerCase() : undefined,
    };

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
    setErrorMessage("");
    deleteProfileMutation.mutate(profile.id);
  };

  const openRunDetails = (runId: string): void => {
    setSelectedRunId(runId);
    setRunDetailsModalOpen(true);
  };

  const closeRunDetails = (): void => {
    setRunDetailsModalOpen(false);
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
        Strategies decide the target. Allocation profiles define the capital bucket, managed funds, and auto-execution rules for each rebalance situation.
      </div>

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

      {loadingProfiles || loadingStrategies ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={`profile-skeleton-${index}`} className="rounded-xl border border-border bg-card p-4 animate-fade-up">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="mt-2 h-4 w-40" />
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={`summary-skeleton-${index}`} className="rounded-lg border border-border bg-card p-4">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-3 h-5 w-28" />
                <Skeleton className="mt-2 h-4 w-24" />
              </div>
            ))}
          </div>
        </div>
      ) : profiles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center animate-fade-scale-in">
          <div className="text-[11px] font-mono uppercase tracking-[0.24em] text-muted-foreground">No Active Allocation</div>
          <h3 className="mt-3 text-lg font-mono font-semibold text-foreground">Create your first rebalance allocation</h3>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">
            Each allocation keeps its own capital bucket, enabled funds, linked strategy, and execution policy so you can switch between multiple rebalance situations.
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
              const allocationEntries = getAllocationEntries(profile.allocation);

              return (
                <div
                  key={profile.id}
                  className={cn(
                    "rounded-xl border bg-card p-4 text-left transition-all duration-200 animate-fade-up",
                    selected ? "border-primary/40 shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]" : "border-border hover:border-primary/20 hover:bg-secondary/25"
                  )}
                >
                  <button type="button" onClick={() => setSelectedProfileId(profile.id)} className="w-full text-left">
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
                        <div className="text-muted-foreground">Managed Capital</div>
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

                    <div className="mt-4 rounded-lg border border-border bg-secondary/20 p-3">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Managed Funds</div>
                      <div className="mt-3 space-y-2">
                        {allocationEntries.map(([symbol, percent]) => (
                          <div key={`${profile.id}-${symbol}`} className="flex items-center justify-between gap-3 text-xs font-mono">
                            <div className="min-w-0">
                              <div className="truncate text-foreground">{symbol}</div>
                              <div className="text-muted-foreground">Included fund</div>
                            </div>
                            <div className="shrink-0 text-right text-foreground">
                              {formatNotional((profile.allocatedCapital * percent) / 100, profile.baseCurrency)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </button>

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
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {selectedProfile ? (
        <>
          {loadingState && !state ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={`selected-skeleton-${index}`} className="rounded-lg border border-border bg-card p-4">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="mt-3 h-5 w-28" />
                    <Skeleton className="mt-2 h-4 w-20" />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {Array.from({ length: 2 }).map((_, index) => (
                  <div key={`chart-skeleton-${index}`} className="rounded-lg border border-border bg-card p-5">
                    <Skeleton className="mx-auto h-4 w-36" />
                    <Skeleton className="mx-auto mt-6 h-[280px] w-[280px] rounded-full" />
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-border bg-card p-5">
                <Skeleton className="h-4 w-32" />
                <div className="mt-4 space-y-3">
                  {Array.from({ length: 5 }).map((__, rowIndex) => (
                    <Skeleton key={`table-skeleton-${rowIndex}`} className="h-10 w-full" />
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {!loadingState || state ? (
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
                    Array.from({ length: 5 }).map((_, rowIndex) => (
                      <tr key={`allocation-delta-skeleton-${rowIndex}`} className="border-b border-border last:border-b-0">
                        {Array.from({ length: 5 }).map((__, cellIndex) => (
                          <td key={`allocation-delta-skeleton-${rowIndex}-${cellIndex}`} className="px-4 py-3">
                            <Skeleton className={cn("h-4", cellIndex === 4 ? "ml-auto w-14" : "w-full")} />
                          </td>
                        ))}
                      </tr>
                    ))
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
                  ) : loadingProfiles || loadingStrategies || loadingState ? (
                    Array.from({ length: 4 }).map((_, rowIndex) => (
                      <tr key={`recommended-trades-skeleton-${rowIndex}`} className="border-b border-border last:border-b-0">
                        {Array.from({ length: 6 }).map((__, cellIndex) => (
                          <td key={`recommended-trades-skeleton-${rowIndex}-${cellIndex}`} className="px-4 py-3">
                            <Skeleton className={cn("h-4", cellIndex === 5 ? "ml-auto w-full" : "w-full")} />
                          </td>
                        ))}
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

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Rebalance History</div>
              <div className="text-[11px] font-mono text-muted-foreground">
                {allocationHistory.length} event{allocationHistory.length === 1 ? "" : "s"}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px]">
                <thead>
                  <tr className="border-b border-border">
                    {["Started", "Status", "Trigger", "Completed", "Duration", "Notes", "Action"].map((heading) => (
                      <th
                        key={heading}
                        className={cn(
                          "px-4 py-3 text-right text-[10px] font-mono uppercase tracking-wider text-muted-foreground first:text-left",
                          heading === "Action" ? "sticky right-0 z-10 bg-card" : ""
                        )}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loadingHistory ? (
                    Array.from({ length: 4 }).map((_, rowIndex) => (
                      <tr key={`history-skeleton-${rowIndex}`} className="border-b border-border last:border-b-0">
                        {Array.from({ length: 7 }).map((__, cellIndex) => (
                          <td key={`history-skeleton-${rowIndex}-${cellIndex}`} className="px-4 py-3">
                            <Skeleton className={cn("h-4", cellIndex === 6 ? "ml-auto w-20" : "w-full")} />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : allocationHistory.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">
                        No rebalance events have been recorded for this allocation yet.
                      </td>
                    </tr>
                  ) : (
                    allocationHistory.slice(0, 12).map((run) => {
                      const selected = run.id === selectedRunId;

                      return (
                        <tr
                          key={run.id}
                          className={cn(
                            "group cursor-pointer border-b border-border last:border-b-0",
                            selected ? "bg-secondary/40" : "hover:bg-secondary/20"
                          )}
                          onClick={() => openRunDetails(run.id)}
                        >
                          <td className="px-4 py-3 text-left text-xs font-mono text-muted-foreground">{formatDateTime(run.startedAt)}</td>
                          <td className="px-4 py-3 text-right text-xs font-mono">
                            <span className={getRunStatusClassName(run.status)}>{run.status}</span>
                          </td>
                          <td className="px-4 py-3 text-right text-xs font-mono text-foreground">{run.trigger}</td>
                          <td className="px-4 py-3 text-right text-xs font-mono text-muted-foreground">{formatDateTime(run.completedAt)}</td>
                          <td className="px-4 py-3 text-right text-xs font-mono text-foreground">{formatDuration(run.startedAt, run.completedAt)}</td>
                          <td className="px-4 py-3 text-right text-xs font-mono text-muted-foreground">
                            <div className="ml-auto max-w-[320px] truncate">{getRunSummary(run)}</div>
                          </td>
                          <td
                            className={cn(
                              "sticky right-0 z-10 px-4 py-3 text-right",
                              selected ? "bg-secondary/40" : "bg-card group-hover:bg-secondary/20"
                            )}
                          >
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openRunDetails(run.id);
                              }}
                              className="rounded-md border border-border px-2.5 py-1.5 text-[11px] font-mono text-foreground hover:bg-secondary"
                            >
                              Inspect
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border px-4 py-3 text-xs font-mono text-muted-foreground">
              Click any event to open the full rebalance explanation and trade breakdown.
            </div>
          </div>
            </>
          ) : null}
        </>
      ) : null}

      {runDetailsModalOpen ? (
        <div className="fixed inset-0 z-[75] animate-overlay-fade" onClick={closeRunDetails}>
          <div className="absolute inset-0 bg-background/80 backdrop-blur-md" />
          <div className="relative flex min-h-full items-center justify-center px-4 py-6">
            <div
              className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl animate-fade-scale-in"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
                <div className="min-w-0">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Rebalance Event</div>
                  <div className="mt-1 truncate text-sm font-mono text-foreground">
                    {selectedRun?.rebalanceAllocationName ?? selectedProfile?.name ?? "--"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {selectedRun ? `Started ${formatDateTime(selectedRun.startedAt)}` : "Select a rebalance event to inspect it."}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeRunDetails}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-mono text-foreground hover:bg-secondary"
                >
                  Close
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                {loadingRunDetails ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                      {Array.from({ length: 6 }).map((_, index) => (
                        <Skeleton key={`run-details-metric-skeleton-${index}`} className="h-16 w-full" />
                      ))}
                    </div>
                    <Skeleton className="h-28 w-full" />
                    <Skeleton className="h-56 w-full" />
                    <Skeleton className="h-48 w-full" />
                  </div>
                ) : !selectedRun ? (
                  <div className="text-sm text-muted-foreground">No rebalance event selected.</div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-6 text-xs font-mono">
                      <div className="rounded-lg border border-border bg-secondary/30 p-3">
                        <div className="text-muted-foreground">Status</div>
                        <div className={cn("mt-2 text-sm", getRunStatusClassName(selectedRun.status))}>{selectedRun.status}</div>
                      </div>
                      <div className="rounded-lg border border-border bg-secondary/30 p-3">
                        <div className="text-muted-foreground">Trigger</div>
                        <div className="mt-2 text-sm text-foreground">{selectedRun.trigger}</div>
                      </div>
                      <div className="rounded-lg border border-border bg-secondary/30 p-3">
                        <div className="text-muted-foreground">Started</div>
                        <div className="mt-2 text-sm text-foreground">{formatDateTime(selectedRun.startedAt)}</div>
                      </div>
                      <div className="rounded-lg border border-border bg-secondary/30 p-3">
                        <div className="text-muted-foreground">Completed</div>
                        <div className="mt-2 text-sm text-foreground">{formatDateTime(selectedRun.completedAt)}</div>
                      </div>
                      <div className="rounded-lg border border-border bg-secondary/30 p-3">
                        <div className="text-muted-foreground">Duration</div>
                        <div className="mt-2 text-sm text-foreground">{formatDuration(selectedRun.startedAt, selectedRun.completedAt)}</div>
                      </div>
                      <div className="rounded-lg border border-border bg-secondary/30 p-3">
                        <div className="text-muted-foreground">Warnings</div>
                        <div className="mt-2 text-sm text-foreground">{selectedRun.warnings.length}</div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">How This Rebalance Happened</div>
                      <div className="mt-2 text-sm leading-6 text-foreground">{selectedRunSummary}</div>
                    </div>

                    {selectedRun.error ? (
                      <div className="rounded-md border border-negative/30 bg-negative/10 px-4 py-3 text-xs font-mono text-negative">
                        {selectedRun.error}
                      </div>
                    ) : null}

                    {selectedRun.skipReason ? (
                      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs font-mono text-amber-200">
                        Skip Reason: {selectedRun.skipReason}
                      </div>
                    ) : null}

                    {selectedRunExecutionPlan ? (
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-5 text-xs font-mono">
                        <div className="rounded-lg border border-border bg-secondary/30 p-3">
                          <div className="text-muted-foreground">Portfolio Value</div>
                          <div className="mt-2 text-sm text-foreground">
                            {formatNotional(selectedRun.inputSnapshot?.portfolio.totalValue, selectedRunBaseCurrency)}
                          </div>
                        </div>
                        <div className="rounded-lg border border-border bg-secondary/30 p-3">
                          <div className="text-muted-foreground">Rebalance Required</div>
                          <div className="mt-2 text-sm text-foreground">{selectedRunExecutionPlan.rebalanceRequired ? "Yes" : "No"}</div>
                        </div>
                        <div className="rounded-lg border border-border bg-secondary/30 p-3">
                          <div className="text-muted-foreground">Drift</div>
                          <div className="mt-2 text-sm text-foreground">{formatPercent(selectedRunExecutionPlan.driftPct)}</div>
                        </div>
                        <div className="rounded-lg border border-border bg-secondary/30 p-3">
                          <div className="text-muted-foreground">Turnover</div>
                          <div className="mt-2 text-sm text-foreground">{formatPercent(selectedRunExecutionPlan.estimatedTurnoverPct)}</div>
                        </div>
                        <div className="rounded-lg border border-border bg-secondary/30 p-3">
                          <div className="text-muted-foreground">Trade Count</div>
                          <div className="mt-2 text-sm text-foreground">{selectedRunExecutionPlan.recommendedTrades.length}</div>
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-lg border border-border overflow-hidden">
                      <div className="border-b border-border px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                        Allocation Shift
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[640px]">
                          <thead>
                            <tr className="border-b border-border">
                              {["Asset", "Before", "Target", "Difference", "Action"].map((heading) => (
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
                            {selectedRunAllocationRows.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="px-4 py-6 text-center text-sm text-muted-foreground">
                                  No allocation comparison is available for this event.
                                </td>
                              </tr>
                            ) : (
                              selectedRunAllocationRows.map((row) => (
                                <tr key={`run-allocation-${row.symbol}`} className="border-b border-border last:border-b-0">
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

                    <div className="rounded-lg border border-border overflow-hidden">
                      <div className="border-b border-border px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                        Trade Actions
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
                            {selectedRunExecutionPlan?.recommendedTrades.length ? (
                              selectedRunExecutionPlan.recommendedTrades.map((trade, index) => (
                                <tr key={`${trade.asset}-${trade.side}-${index}`} className="border-b border-border last:border-b-0">
                                  <td className="px-4 py-3 text-left text-sm font-mono text-foreground">{trade.asset}</td>
                                  <td
                                    className={cn(
                                      "px-4 py-3 text-right text-sm font-mono",
                                      trade.side === "BUY" ? "text-positive" : "text-negative"
                                    )}
                                  >
                                    {trade.side}
                                  </td>
                                  <td className="px-4 py-3 text-right text-sm font-mono text-foreground">{trade.currentPercent.toFixed(2)}%</td>
                                  <td className="px-4 py-3 text-right text-sm font-mono text-foreground">{trade.targetPercent.toFixed(2)}%</td>
                                  <td className="px-4 py-3 text-right text-sm font-mono text-foreground">
                                    {formatNotional(trade.amountNotional, selectedRunBaseCurrency)}
                                  </td>
                                  <td className="px-4 py-3 text-right text-xs font-mono text-muted-foreground">{trade.reason}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">
                                  No trade actions were generated for this event.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {selectedRun.inputSnapshot?.portfolio.assets?.length ? (
                      <div className="rounded-lg border border-border overflow-hidden">
                        <div className="border-b border-border px-4 py-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                          Portfolio Snapshot Before Rebalance
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[720px]">
                            <thead>
                              <tr className="border-b border-border">
                                {["Asset", "Quantity", "Value", "Allocation"].map((heading) => (
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
                              {selectedRun.inputSnapshot.portfolio.assets.map((asset) => (
                                <tr key={`run-asset-${asset.symbol}`} className="border-b border-border last:border-b-0">
                                  <td className="px-4 py-3 text-left text-sm font-mono text-foreground">{asset.symbol}</td>
                                  <td className="px-4 py-3 text-right text-sm font-mono text-foreground">
                                    {asset.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                                  </td>
                                  <td className="px-4 py-3 text-right text-sm font-mono text-foreground">
                                    {formatNotional(asset.value, selectedRunBaseCurrency)}
                                  </td>
                                  <td className="px-4 py-3 text-right text-sm font-mono text-foreground">{asset.allocation.toFixed(2)}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : null}

                    {selectedRun.warnings.length > 0 ? (
                      <div className="rounded-lg border border-border bg-card p-4">
                        <div className="mb-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Warnings</div>
                        <div className="space-y-2">
                          {selectedRun.warnings.map((warning, index) => (
                            <div key={`${warning}-${index}`} className="rounded border border-border px-3 py-2 text-xs font-mono text-muted-foreground">
                              {warning}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {profileModalOpen ? (
        <div className="fixed inset-0 z-[70] animate-overlay-fade" onClick={closeProfileModal}>
          <div className="absolute inset-0 bg-background/80 backdrop-blur-md" />
          <div className="relative flex min-h-full w-full items-start justify-center overflow-y-auto p-0 sm:items-center sm:p-4 md:p-6">
            <div
              className="flex min-h-full w-full flex-col overflow-hidden rounded-none border border-border bg-[linear-gradient(180deg,_hsl(var(--card))_0%,_hsl(var(--secondary)/0.45)_100%)] shadow-2xl animate-fade-scale-in sm:h-auto sm:min-h-0 sm:max-h-[calc(100vh-3rem)] sm:max-w-5xl sm:rounded-2xl"
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
                      <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Managed Capital</label>
                      <div
                        className={cn(
                          "mt-1 flex h-[50px] items-center rounded-md border bg-secondary px-3 py-3 text-sm font-mono",
                          "border-border text-foreground"
                        )}
                      >
                        {formatNotional(draftAllocatedCapitalValue, normalizeSymbol(formState.baseCurrency))}
                      </div>
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

                  <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card/60 p-4 sm:grid-cols-3">
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Demo Capital</div>
                      <div className="mt-2 text-sm font-mono text-foreground">{formatUsd(demoAccountBalance)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Already Reserved</div>
                      <div className="mt-2 text-sm font-mono text-foreground">{formatUsd(reservedCapitalExcludingEdit)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Projected Reserved</div>
                      <div
                        className={cn(
                          "mt-2 text-sm font-mono",
                          Number.isFinite(demoAccountBalance) && projectedCapitalReservation - (demoAccountBalance ?? 0) > 0.0001
                            ? "text-negative"
                            : "text-foreground"
                        )}
                      >
                        {formatUsd(projectedCapitalReservation)}
                      </div>
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
                        <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Managed Funds</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          The strategy sets the target allocation. Here you only choose how much of each currently held asset belongs to this managed bucket.
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Managed Total</div>
                        <div className="mt-1 text-sm font-mono text-foreground">
                          {formatNotional(draftAllocatedCapitalValue, normalizeSymbol(formState.baseCurrency))}
                        </div>
                      </div>
                    </div>

                    {overAllocatedRows.length > 0 ? (
                      <div className="mt-4 rounded-md border border-negative/40 bg-negative/10 px-3 py-2 text-xs font-mono text-negative">
                        {overAllocatedRows[0].symbol} needs {formatUsd(overAllocatedRows[0].targetValue)} but only {formatUsd(overAllocatedRows[0].heldValue)} is currently held.
                      </div>
                    ) : null}

                    <div className="mt-4 space-y-3">
                      {formState.allocationRows.map((row, index) => {
                        const rowValidation = allocationRowValidationById[row.id];

                        return (
                          <div
                            key={row.id}
                            className={cn(
                              "grid grid-cols-1 gap-3 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_140px_minmax(220px,1fr)_180px]",
                              row.isEnabled ? "border-border bg-card/50" : "border-border/60 bg-secondary/10 opacity-80"
                            )}
                          >
                            <div>
                              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Fund {index + 1}</label>
                              <div
                                className={cn(
                                  "mt-1 flex h-[50px] items-center rounded-md border bg-secondary px-3 py-3 text-sm font-mono",
                                  rowValidation?.exceedsHoldings ? "border-negative text-negative" : "border-border text-foreground"
                                )}
                              >
                                {normalizeSymbol(row.symbol) || "--"}
                              </div>
                              <div className={cn("mt-1 text-xs", rowValidation?.exceedsHoldings ? "text-negative" : "text-muted-foreground")}>
                                Held now: {formatUsd(portfolioAssetMap[normalizeSymbol(row.symbol)]?.value ?? 0)}
                                {row.isEnabled ? `  Allocating ${formatUsd(rowValidation?.targetValue ?? 0)}.` : "  Fund disabled."}
                              </div>
                            </div>
                            <div>
                              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Use Fund</label>
                              <label
                                className={cn(
                                  "mt-1 flex h-[50px] cursor-pointer items-center gap-3 rounded-md border px-3 py-3 text-sm font-mono",
                                  row.isEnabled ? "border-primary/30 bg-primary/10 text-foreground" : "border-border bg-secondary text-muted-foreground"
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={row.isEnabled}
                                  onChange={(event) =>
                                    setFormState((current) => ({
                                      ...current,
                                      allocationRows: current.allocationRows.map((entry) =>
                                        entry.id === row.id
                                          ? {
                                              ...entry,
                                              isEnabled: event.target.checked,
                                              sliderPercent: event.target.checked ? (entry.sliderPercent > 0 ? entry.sliderPercent : 100) : 0,
                                              allocatedValue: event.target.checked
                                                ? formatDraftAmount(
                                                    portfolioAssetMap[normalizeSymbol(entry.symbol)]?.value ?? 0
                                                  )
                                                : "0",
                                            }
                                          : entry
                                      ),
                                    }))
                                  }
                                  className="h-4 w-4 rounded border-border bg-secondary"
                                />
                                <span>{row.isEnabled ? "Included" : "Disabled"}</span>
                              </label>
                            </div>
                            <div>
                              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Allocation Slider</label>
                              <div className="mt-1 rounded-md border border-border bg-secondary px-3 py-3">
                                <div className="flex items-center gap-3">
                                  <input
                                    type="range"
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={Math.round(row.sliderPercent)}
                                    onChange={(event) => updateManagedFundSlider(row.id, Number(event.target.value))}
                                    disabled={!row.isEnabled}
                                    className="h-2 w-full accent-primary disabled:cursor-not-allowed"
                                  />
                                  <div className="w-12 shrink-0 text-right text-xs font-mono text-foreground">
                                    {Math.round(row.sliderPercent)}%
                                  </div>
                                </div>
                                <div className="mt-2 text-[11px] text-muted-foreground">
                                  Allocate a fraction of this asset's currently held value.
                                </div>
                              </div>
                            </div>
                            <div>
                              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                                Static Value ({normalizeSymbol(formState.baseCurrency)})
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={rowValidation?.heldValue ?? 0}
                                step="0.01"
                                value={row.isEnabled ? row.allocatedValue : "0"}
                                onChange={(event) => updateManagedFundValue(row.id, event.target.value)}
                                disabled={!row.isEnabled}
                                className={cn(
                                  "mt-1 w-full rounded-md border bg-secondary px-3 py-3 text-sm font-mono outline-none disabled:cursor-not-allowed disabled:opacity-60",
                                  rowValidation?.exceedsHoldings ? "border-negative text-negative" : "border-border text-foreground"
                                )}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-4 text-xs text-muted-foreground">
                      All currently available funds are listed automatically. Use the slider to allocate a percentage of each asset's own held value, or type the exact static value directly and the slider will update immediately.
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
                    disabled={
                      createProfileMutation.isPending ||
                      updateProfileMutation.isPending ||
                      loadingStrategies ||
                      usableStrategies.length === 0 ||
                      overAllocatedRows.length > 0
                    }
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

      {pendingAction ? <PendingActionModal title={pendingAction.title} description={pendingAction.description} /> : null}
    </div>
  );
}

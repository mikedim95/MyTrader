import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Plus, RotateCcw, X } from "lucide-react";
import { backendApi } from "@/lib/api";
import { useDashboardData, useDemoAccountSettings } from "@/hooks/useTradingData";
import { SpinnerValue } from "@/components/SpinnerValue";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import type { AppSession, DemoAccountHolding, PortfolioAccountType } from "@/types/api";

interface TopBarProps {
  accountType: PortfolioAccountType;
  onAccountTypeChange: (mode: PortfolioAccountType) => void;
  session: AppSession;
  onLogout: () => void;
  onProfileOpen: () => void;
}

interface DemoAllocationDraftRow {
  id: string;
  symbol: string;
  percent: string;
}

const DEFAULT_DEMO_BALANCE = 10_000;
const DEFAULT_DEMO_ALLOCATION_TEMPLATE = [
  { symbol: "BTC", percent: 40 },
  { symbol: "ETH", percent: 30 },
  { symbol: "XRP", percent: 10 },
  { symbol: "USDC", percent: 20 },
];

function createDraftRow(symbol = "", percent = ""): DemoAllocationDraftRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    symbol,
    percent,
  };
}

function createDefaultAllocationRows(): DemoAllocationDraftRow[] {
  return DEFAULT_DEMO_ALLOCATION_TEMPLATE.map((row) => createDraftRow(row.symbol, String(row.percent)));
}

function createRowsFromHoldings(holdings: DemoAccountHolding[] | undefined): DemoAllocationDraftRow[] {
  if (!Array.isArray(holdings) || holdings.length === 0) {
    return createDefaultAllocationRows();
  }

  return holdings
    .slice()
    .sort((left, right) => right.targetAllocation - left.targetAllocation)
    .map((holding) => createDraftRow(holding.symbol, String(holding.targetAllocation)));
}

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatUsdToken(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return formatCurrency(value);
}

function formatDateTime(value: string | undefined): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "--";
  return parsed.toLocaleString();
}

function getUserInitials(username: string): string {
  return username
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "U";
}

export function TopBar({ accountType, onAccountTypeChange, session, onLogout, onProfileOpen }: TopBarProps) {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { data, isPending } = useDashboardData(accountType);
  const { data: demoAccountData, isPending: loadingDemoAccount } = useDemoAccountSettings();
  const [isDemoSetupModalOpen, setIsDemoSetupModalOpen] = useState(false);
  const [hasDismissedEmptyDemoPrompt, setHasDismissedEmptyDemoPrompt] = useState(false);
  const [demoBalanceDraft, setDemoBalanceDraft] = useState(String(DEFAULT_DEMO_BALANCE));
  const [allocationRows, setAllocationRows] = useState<DemoAllocationDraftRow[]>(createDefaultAllocationRows());
  const [setupErrorMessage, setSetupErrorMessage] = useState<string>("");
  const isLoading = isPending && !data;

  const demoAccount = demoAccountData?.demoAccount;
  const demoInitialized = (demoAccount?.holdings.length ?? 0) > 0;
  const isDemoMode = accountType === "demo";
  const connectionConnected = data?.connection.connected ?? false;
  const demoValue = isDemoMode ? data?.totalPortfolioValue ?? 0 : undefined;
  const demoHoldingsCount = demoAccount?.holdings.length ?? 0;

  const refreshDemoData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["demo-account-settings"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["strategy-runs"] }),
      queryClient.invalidateQueries({ queryKey: ["strategy-state"] }),
      queryClient.invalidateQueries({ queryKey: ["strategy-execution-plan"] }),
    ]);
  };

  const openDemoSetupModal = (useExistingSeed: boolean) => {
    const nextBalance =
      typeof demoAccount?.balance === "number" && Number.isFinite(demoAccount.balance) && demoAccount.balance > 0
        ? demoAccount.balance
        : DEFAULT_DEMO_BALANCE;
    const nextRows = useExistingSeed ? createRowsFromHoldings(demoAccount?.holdings) : createDefaultAllocationRows();
    setDemoBalanceDraft(String(nextBalance));
    setAllocationRows(nextRows);
    setSetupErrorMessage("");
    setHasDismissedEmptyDemoPrompt(false);
    setIsDemoSetupModalOpen(true);
  };

  useEffect(() => {
    if (!isDemoMode) {
      setHasDismissedEmptyDemoPrompt(false);
      return;
    }

    if (loadingDemoAccount || demoInitialized || isDemoSetupModalOpen || hasDismissedEmptyDemoPrompt) {
      return;
    }

    openDemoSetupModal(false);
  }, [
    demoInitialized,
    hasDismissedEmptyDemoPrompt,
    isDemoMode,
    isDemoSetupModalOpen,
    loadingDemoAccount,
  ]);

  const initializeDemoAccountMutation = useMutation({
    mutationFn: () =>
      backendApi.initializeDemoAccount({
        balance: Number(demoBalanceDraft),
        allocations: allocationRows.map((row) => ({
          symbol: row.symbol.trim().toUpperCase(),
          percent: Number(row.percent),
        })),
      }),
    onSuccess: async () => {
      setSetupErrorMessage("");
      setIsDemoSetupModalOpen(false);
      await refreshDemoData();
    },
    onError: (error) => {
      setSetupErrorMessage(error instanceof Error ? error.message : "Unable to initialize demo account.");
    },
  });

  const resetDemoAccountMutation = useMutation({
    mutationFn: backendApi.resetDemoAccount,
    onSuccess: async () => {
      await refreshDemoData();
      openDemoSetupModal(true);
    },
    onError: (error) => {
      setSetupErrorMessage(error instanceof Error ? error.message : "Unable to reset demo account.");
    },
  });

  const normalizedRows = useMemo(
    () =>
      allocationRows.map((row) => ({
        ...row,
        normalizedSymbol: row.symbol.trim().toUpperCase(),
        numericPercent: Number(row.percent),
      })),
    [allocationRows]
  );

  const duplicateSymbols = useMemo(() => {
    const counts = new Map<string, number>();
    normalizedRows.forEach((row) => {
      if (!row.normalizedSymbol) return;
      counts.set(row.normalizedSymbol, (counts.get(row.normalizedSymbol) ?? 0) + 1);
    });
    return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([symbol]) => symbol));
  }, [normalizedRows]);

  const totalAllocationPercent = normalizedRows.reduce(
    (sum, row) => sum + (Number.isFinite(row.numericPercent) && row.numericPercent > 0 ? row.numericPercent : 0),
    0
  );
  const parsedDemoBalance = Number(demoBalanceDraft);
  const balanceValid = Number.isFinite(parsedDemoBalance) && parsedDemoBalance > 0;
  const hasAllocationRows = normalizedRows.length > 0;
  const allocationsTotalValid = Math.abs(totalAllocationPercent - 100) <= 0.0001;
  const allocationRowsValid = normalizedRows.every(
    (row) =>
      row.normalizedSymbol.length > 0 &&
      /^[A-Z0-9_-]{2,12}$/.test(row.normalizedSymbol) &&
      Number.isFinite(row.numericPercent) &&
      row.numericPercent > 0
  );
  const hasDuplicates = duplicateSymbols.size > 0;
  const canInitializeDemo =
    balanceValid &&
    hasAllocationRows &&
    allocationRowsValid &&
    allocationsTotalValid &&
    !hasDuplicates &&
    !initializeDemoAccountMutation.isPending &&
    !resetDemoAccountMutation.isPending;

  const activeBadgeLabel = isDemoMode
    ? demoInitialized
      ? "Demo Ready"
      : "Needs Setup"
    : connectionConnected
      ? data?.connection.testnet
        ? "Testnet"
        : "Live"
      : "Offline";
  const activeBadgeTone = isDemoMode
    ? demoInitialized
      ? "bg-primary/15 text-primary border-primary/30"
      : "bg-amber-500/10 text-amber-300 border-amber-400/30"
    : connectionConnected
      ? "bg-primary/15 text-primary border-primary/30"
      : "bg-secondary text-muted-foreground border-border";

  const activeAccountValue = isDemoMode
    ? demoInitialized
      ? formatUsdToken(demoValue)
      : "Set Up Demo"
    : connectionConnected && data
      ? formatCurrency(data.totalPortfolioValue)
      : "Connect Account";

  const changePct = data?.portfolioChange24h;
  const changeValue = data?.portfolioChange24hValue;

  return (
    <>
      <header className={cn(
        "page-enter flex items-center justify-between gap-3 border-b border-border bg-card/80 backdrop-blur-xl",
        isMobile ? "h-14 px-14 pr-4" : "h-14 px-5"
      )}>
        {/* Left: Mode toggle */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative inline-flex items-center rounded-full border border-border bg-background/60 p-0.5 shrink-0">
            <span
              className={cn(
                "pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-0.125rem)] rounded-full transition-all duration-500 ease-out",
                accountType === "demo"
                  ? "translate-x-0 bg-primary/20 shadow-[0_0_12px_hsl(var(--primary)/0.3)] ring-1 ring-primary/40"
                  : "translate-x-full bg-[hsl(30,100%,60%)]/20 shadow-[0_0_12px_hsl(30,100%,60%,0.3)] ring-1 ring-[hsl(30,100%,60%)]/40"
              )}
            />
            <button
              onClick={() => onAccountTypeChange("demo")}
              className={cn(
                "relative z-10 rounded-full px-3 py-1.5 text-xs font-mono uppercase tracking-widest transition-colors duration-300",
                isMobile ? "w-16" : "w-20",
                accountType === "demo" ? "text-primary font-semibold" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Demo
            </button>
            <button
              type="button"
              disabled
              className={cn(
                "relative z-10 rounded-full px-3 py-1.5 text-xs font-mono uppercase tracking-widest transition-colors duration-300",
                isMobile ? "w-16" : "w-20",
                "cursor-not-allowed text-muted-foreground/60"
              )}
              title="Live exchange account mode is unavailable."
            >
              Live
            </button>
          </div>

          {/* Account status - hidden on very small screens */}
          {!isMobile && (
            <div className="flex items-center gap-3 min-w-0">
              <span className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.2em] shrink-0",
                activeBadgeTone
              )}>
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full shrink-0",
                  isDemoMode
                    ? demoInitialized ? "bg-primary animate-pulse" : "bg-amber-400 animate-pulse"
                    : connectionConnected ? "bg-primary animate-pulse" : "bg-muted-foreground"
                )} />
                {activeBadgeLabel}
              </span>

              <div className="flex items-baseline gap-2 min-w-0">
                <SpinnerValue
                  loading={isLoading && !isDemoMode}
                  value={activeAccountValue}
                  className="text-sm font-mono font-semibold text-foreground truncate"
                />
                {(isDemoMode ? demoInitialized : connectionConnected) && changePct !== undefined && changeValue !== undefined ? (
                  <span className={cn("text-xs font-mono shrink-0", changePct < 0 ? "text-negative" : "text-positive")}>
                    {changePct >= 0 ? "+" : ""}{changePct}%
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {/* Right side */}
        <div className="flex shrink-0 items-center gap-2">
          {isDemoMode ? (
            <button
              onClick={() => {
                setSetupErrorMessage("");
                if (demoInitialized) {
                  resetDemoAccountMutation.mutate();
                  return;
                }
                openDemoSetupModal(false);
              }}
              disabled={loadingDemoAccount || initializeDemoAccountMutation.isPending || resetDemoAccountMutation.isPending}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-mono font-medium transition-all duration-300 disabled:opacity-60",
                demoInitialized
                  ? "border-border bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
              )}
            >
              {demoInitialized ? <RotateCcw className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {!isMobile && (demoInitialized ? "Reset" : "Setup")}
            </button>
          ) : null}

          <button className="relative rounded-full border border-border bg-secondary/30 p-2.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
            <Bell className="h-4 w-4" />
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary animate-pulse" />
          </button>

          <button
            onClick={onProfileOpen}
            className="flex items-center gap-2.5 rounded-full border border-border bg-secondary/30 pl-3 pr-1.5 py-1.5 transition hover:bg-secondary/60"
          >
            {!isMobile && <span className="text-xs font-mono text-muted-foreground">{session.username}</span>}
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
              <span className="text-xs font-mono font-semibold text-primary">{getUserInitials(session.username)}</span>
            </div>
          </button>
        </div>
      </header>

      {isDemoSetupModalOpen ? (
        <div
          className="fixed inset-0 z-50 bg-background/80 px-4 py-8 backdrop-blur-md animate-overlay-fade overflow-y-auto"
          onClick={() => {
            setIsDemoSetupModalOpen(false);
            if (!demoInitialized) {
              setHasDismissedEmptyDemoPrompt(true);
            }
          }}
        >
          <div
            className="mx-auto mt-10 w-full max-w-3xl rounded-2xl border border-border bg-[linear-gradient(180deg,_hsl(var(--card))_0%,_hsl(var(--secondary)/0.55)_100%)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] animate-fade-scale-in"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-[0.26em] text-muted-foreground">
                  Demo Account Setup
                </div>
                <h3 className="mt-2 text-xl font-semibold text-foreground">
                  {demoInitialized ? "Start over with a fresh simulated account." : `Welcome, ${session.username}.`}
                </h3>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  Choose your starting capital and target allocation. This demo portfolio is saved per user in the
                  database and stays separate from your live account.
                </p>
              </div>
              <button
                onClick={() => {
                  setIsDemoSetupModalOpen(false);
                  if (!demoInitialized) {
                    setHasDismissedEmptyDemoPrompt(true);
                  }
                }}
                className="rounded-lg border border-border bg-background/60 p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr,1.6fr]">
              <div className="rounded-2xl border border-border bg-background/45 p-4">
                <div className="text-[11px] font-mono uppercase tracking-[0.24em] text-muted-foreground">
                  Starting Capital
                </div>
                <div className="mt-3">
                  <label className="text-xs font-mono text-muted-foreground">Amount in USD</label>
                  <input
                    value={demoBalanceDraft}
                    onChange={(event) => setDemoBalanceDraft(event.target.value)}
                    className={cn(
                      "mt-2 w-full rounded-xl border bg-secondary/80 px-3 py-3 text-lg font-mono text-foreground outline-none transition-colors",
                      balanceValid ? "border-border focus:border-primary" : "border-negative"
                    )}
                    placeholder="10000"
                    disabled={initializeDemoAccountMutation.isPending || resetDemoAccountMutation.isPending}
                  />
                </div>
                <div className="mt-4 rounded-xl border border-border bg-card/70 px-3 py-3">
                  <div className="text-[11px] font-mono uppercase tracking-[0.24em] text-muted-foreground">
                    Saved Snapshot
                  </div>
                  <div className="mt-2 text-sm font-mono text-foreground">
                    {demoInitialized ? formatUsdToken(demoAccount?.balance) : "Not initialized"}
                  </div>
                  <div className="mt-1 text-xs font-mono text-muted-foreground">
                    {demoInitialized ? `Last seeded ${formatDateTime(demoAccount?.seededAt)}` : "You can set this for the first time now."}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-background/45 p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-[11px] font-mono uppercase tracking-[0.24em] text-muted-foreground">
                      Asset Configuration
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">Enter target allocation percentages that total exactly 100%.</div>
                  </div>
                  <button
                    onClick={() => setAllocationRows((previous) => [...previous, createDraftRow("", "")])}
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/70 px-3 py-2 text-xs font-mono text-foreground transition hover:bg-secondary"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Asset
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  {allocationRows.map((row, index) => {
                    const normalizedSymbol = row.symbol.trim().toUpperCase();
                    const numericPercent = Number(row.percent);
                    const rowSymbolInvalid = normalizedSymbol.length === 0 || !/^[A-Z0-9_-]{2,12}$/.test(normalizedSymbol);
                    const rowPercentInvalid = !Number.isFinite(numericPercent) || numericPercent <= 0;
                    const rowDuplicate = duplicateSymbols.has(normalizedSymbol);

                    return (
                      <div key={row.id} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_auto] gap-3">
                        <div>
                          <label className="text-[11px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                            Asset {index + 1}
                          </label>
                          <input
                            value={row.symbol}
                            onChange={(event) =>
                              setAllocationRows((previous) =>
                                previous.map((entry) =>
                                  entry.id === row.id ? { ...entry, symbol: event.target.value.toUpperCase() } : entry
                                )
                              )
                            }
                            className={cn(
                              "mt-2 w-full rounded-xl border bg-secondary/80 px-3 py-2.5 text-sm font-mono text-foreground outline-none transition-colors",
                              !rowSymbolInvalid && !rowDuplicate ? "border-border focus:border-primary" : "border-negative"
                            )}
                            placeholder="BTC"
                            disabled={initializeDemoAccountMutation.isPending || resetDemoAccountMutation.isPending}
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                            Allocation %
                          </label>
                          <input
                            value={row.percent}
                            onChange={(event) =>
                              setAllocationRows((previous) =>
                                previous.map((entry) => (entry.id === row.id ? { ...entry, percent: event.target.value } : entry))
                              )
                            }
                            className={cn(
                              "mt-2 w-full rounded-xl border bg-secondary/80 px-3 py-2.5 text-sm font-mono text-foreground outline-none transition-colors",
                              !rowPercentInvalid ? "border-border focus:border-primary" : "border-negative"
                            )}
                            placeholder="25"
                            disabled={initializeDemoAccountMutation.isPending || resetDemoAccountMutation.isPending}
                          />
                        </div>
                        <div className="flex items-end">
                          <button
                            onClick={() =>
                              setAllocationRows((previous) =>
                                previous.length > 1 ? previous.filter((entry) => entry.id !== row.id) : previous
                              )
                            }
                            disabled={allocationRows.length <= 1 || initializeDemoAccountMutation.isPending || resetDemoAccountMutation.isPending}
                            className="rounded-xl border border-border bg-card/70 px-3 py-2.5 text-xs font-mono text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/70 px-3 py-3">
                  <div>
                    <div className="text-[11px] font-mono uppercase tracking-[0.24em] text-muted-foreground">
                      Allocation Total
                    </div>
                    <div className={cn("mt-1 text-sm font-mono", allocationsTotalValid ? "text-foreground" : "text-negative")}>
                      {totalAllocationPercent.toFixed(2)}%
                    </div>
                  </div>
                  <div className="text-right text-xs font-mono text-muted-foreground">
                    {hasDuplicates
                      ? `Duplicate symbols: ${Array.from(duplicateSymbols).join(", ")}`
                      : allocationsTotalValid
                        ? "Distribution is valid."
                        : "Percentages must total exactly 100%."}
                  </div>
                </div>
              </div>
            </div>

            {setupErrorMessage ? (
              <div className="mt-5 rounded-xl border border-negative/30 bg-negative/10 px-4 py-3 text-xs text-negative">
                {setupErrorMessage}
              </div>
            ) : null}

            <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs text-muted-foreground">
                Real and demo accounts stay separate for each signed-in user.
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setIsDemoSetupModalOpen(false);
                    if (!demoInitialized) {
                      setHasDismissedEmptyDemoPrompt(true);
                    }
                  }}
                  className="rounded-xl border border-border px-4 py-2.5 text-xs font-mono text-foreground transition hover:bg-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={() => initializeDemoAccountMutation.mutate()}
                  disabled={!canInitializeDemo}
                  className="rounded-xl bg-primary px-4 py-2.5 text-xs font-mono font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
                >
                  {initializeDemoAccountMutation.isPending ? "Initializing..." : "Initialize Demo Account"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

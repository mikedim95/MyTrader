import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Pencil } from "lucide-react";
import { backendApi } from "@/lib/api";
import { useDashboardData, useDemoAccountSettings } from "@/hooks/useTradingData";
import { SpinnerValue } from "@/components/SpinnerValue";
import { cn } from "@/lib/utils";
import type { AppSession, PortfolioAccountType } from "@/types/api";

interface TopBarProps {
  accountType: PortfolioAccountType;
  onAccountTypeChange: (mode: PortfolioAccountType) => void;
  session: AppSession;
  onLogout: () => void;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatUsdToken(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function getUserInitials(username: string): string {
  return username
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "U";
}

export function TopBar({ accountType, onAccountTypeChange, session, onLogout }: TopBarProps) {
  const queryClient = useQueryClient();
  const { data, isPending } = useDashboardData(accountType);
  const { data: demoAccountData, isPending: loadingDemoAccount } = useDemoAccountSettings();
  const [isDemoBalanceModalOpen, setIsDemoBalanceModalOpen] = useState(false);
  const [demoBalanceDraft, setDemoBalanceDraft] = useState("");
  const isLoading = isPending && !data;

  useEffect(() => {
    const balance = demoAccountData?.demoAccount.balance;
    if (typeof balance === "number" && Number.isFinite(balance)) {
      setDemoBalanceDraft(String(balance));
    }
  }, [demoAccountData?.demoAccount.balance]);

  const updateDemoBalanceMutation = useMutation({
    mutationFn: (balance: number) => backendApi.updateDemoAccountSettings(balance),
    onSuccess: async (result) => {
      setDemoBalanceDraft(String(result.demoAccount.balance));
      setIsDemoBalanceModalOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["demo-account-settings"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "demo"] }),
        queryClient.invalidateQueries({ queryKey: ["strategy-runs"] }),
        queryClient.invalidateQueries({ queryKey: ["strategy-state"] }),
        queryClient.invalidateQueries({ queryKey: ["strategy-execution-plan"] }),
      ]);
    },
  });

  const connectionLabel = data
    ? data.connection.connected
      ? data.connection.testnet
        ? "TESTNET"
        : "LIVE"
      : "OFFLINE"
    : "--";

  const connectionTone = data?.connection.connected
    ? "bg-positive/10 text-positive"
    : "bg-secondary text-muted-foreground";

  const changePct = data?.portfolioChange24h;
  const changeValue = data?.portfolioChange24hValue;
  const demoBalanceCurrent = demoAccountData?.demoAccount.balance;
  const demoBalanceParsed = Number(demoBalanceDraft);
  const demoBalanceDirty =
    typeof demoBalanceCurrent === "number" &&
    Number.isFinite(demoBalanceCurrent) &&
    Number.isFinite(demoBalanceParsed) &&
    demoBalanceParsed > 0 &&
    Math.abs(demoBalanceParsed - demoBalanceCurrent) > 0.000001;

  return (
    <>
      <header className="page-enter h-16 flex items-center justify-between px-6 border-b border-border bg-card/95 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="relative inline-flex items-center rounded-lg border border-border bg-secondary/60 p-1 shadow-inner">
            <span
              className={cn(
                "pointer-events-none absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] rounded-md bg-primary/20 ring-1 ring-primary/40 transition-transform duration-300 ease-out",
                accountType === "demo" ? "translate-x-0" : "translate-x-full"
              )}
            />
            <button
              onClick={() => onAccountTypeChange("demo")}
              className={cn(
                "relative z-10 w-24 rounded-md px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider transition-colors",
                accountType === "demo" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Dummy
            </button>
            <button
              onClick={() => onAccountTypeChange("real")}
              className={cn(
                "relative z-10 w-24 rounded-md px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider transition-colors",
                accountType === "real" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Real
            </button>
          </div>

          <div
            className={cn(
              "group flex items-center gap-2 rounded-lg border px-3 py-1.5 transition-all duration-300",
              accountType === "demo"
                ? "border-primary/40 bg-primary/10 shadow-[0_0_18px_hsl(var(--primary)/0.18)] pulse-accent"
                : "border-border bg-secondary/40"
            )}
          >
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Dummy Assets</div>
            <SpinnerValue
              loading={loadingDemoAccount}
              value={formatUsdToken(demoBalanceCurrent)}
              className="text-xs font-mono font-semibold text-foreground"
            />
            <button
              onClick={() => setIsDemoBalanceModalOpen(true)}
              aria-label="Edit dummy balance"
              disabled={loadingDemoAccount}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <Pencil size={12} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <span className={`text-[10px] font-mono px-2 py-1 rounded ${connectionTone}`} title={data?.connection.message}>
            <SpinnerValue loading={isLoading} value={connectionLabel} spinnerClassName="h-3.5 w-3.5" />
          </span>

          <div className="text-right">
            <div className="text-xs font-mono text-muted-foreground">Portfolio Value</div>
            <div className="flex items-center gap-2">
              <SpinnerValue
                loading={isLoading}
                value={data ? formatCurrency(data.totalPortfolioValue) : undefined}
                className="text-sm font-mono font-semibold text-foreground"
              />

              <SpinnerValue
                loading={isLoading}
                value={
                  changePct !== undefined
                    ? `${changePct >= 0 ? "+" : ""}${changePct}%`
                    : undefined
                }
                className={`text-xs font-mono ${changePct !== undefined && changePct < 0 ? "text-negative" : "text-positive"}`}
              />

              <SpinnerValue
                loading={isLoading}
                value={
                  changeValue !== undefined
                    ? `(${changeValue >= 0 ? "+" : ""}${formatCurrency(changeValue)})`
                    : undefined
                }
                className={`text-xs font-mono ${changeValue !== undefined && changeValue < 0 ? "text-negative" : "text-positive"}`}
              />
            </div>
          </div>

          <button className="relative p-2 rounded-md hover:bg-secondary transition-colors">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
          </button>

          <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/40 px-3 py-1.5">
            <div className="text-right">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                {session.storageMode === "offline" ? "Dummy Session" : "User Session"}
              </div>
              <div className="text-xs font-mono text-foreground">{session.username}</div>
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <span className="text-xs font-mono font-semibold text-foreground">{getUserInitials(session.username)}</span>
            </div>
            <button
              onClick={onLogout}
              className="rounded-md border border-border px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground transition hover:text-foreground"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {isDemoBalanceModalOpen ? (
        <div className="fixed inset-0 z-50 bg-background/75 p-4" onClick={() => setIsDemoBalanceModalOpen(false)}>
          <div
            className="mx-auto w-full max-w-md rounded-lg border border-border bg-card p-4 space-y-3 mt-20"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Edit Dummy Assets</div>
                <div className="mt-1 text-xs font-mono text-muted-foreground">Set dummy USD funds used by demo strategy runs.</div>
              </div>
              <button
                onClick={() => setIsDemoBalanceModalOpen(false)}
                className="px-3 py-1.5 rounded-md border border-border text-xs font-mono text-foreground hover:bg-secondary"
              >
                Close
              </button>
            </div>

            <div>
              <label className="text-xs font-mono text-muted-foreground">Amount (USD$)</label>
              <input
                value={demoBalanceDraft}
                onChange={(event) => setDemoBalanceDraft(event.target.value)}
                className={cn(
                  "mt-1 w-full rounded border bg-secondary px-2 py-2 text-sm font-mono text-foreground outline-none",
                  !demoBalanceDraft || (Number.isFinite(demoBalanceParsed) && demoBalanceParsed > 0)
                    ? "border-border"
                    : "border-negative"
                )}
                placeholder="10000"
                disabled={loadingDemoAccount || updateDemoBalanceMutation.isPending}
              />
            </div>

            <div className="text-xs font-mono text-muted-foreground">
              Current saved: {formatUsdToken(demoBalanceCurrent)}
              {demoAccountData?.demoAccount.updatedAt
                ? `  |  Updated: ${new Date(demoAccountData.demoAccount.updatedAt).toLocaleString()}`
                : ""}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => updateDemoBalanceMutation.mutate(demoBalanceParsed)}
                disabled={
                  loadingDemoAccount ||
                  updateDemoBalanceMutation.isPending ||
                  !Number.isFinite(demoBalanceParsed) ||
                  demoBalanceParsed <= 0 ||
                  !demoBalanceDirty
                }
                className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-mono font-semibold hover:opacity-90 disabled:opacity-60"
              >
                Save Dummy Assets
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

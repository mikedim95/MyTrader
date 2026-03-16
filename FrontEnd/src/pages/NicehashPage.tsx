import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { SpinnerValue } from "@/components/SpinnerValue";
import { useNicehashOverview } from "@/hooks/useTradingData";
import { BulkActionToolbar } from "@/components/miners/BulkActionToolbar";
import { MinerStatusBadge } from "@/components/miners/MinerStatusBadge";
import type { MinerStatus } from "@/data/minerMockData";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";

function formatBalance(value: number | null | undefined): string {
  if (value === null || value === undefined) return "--";
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function toMinerStatus(status: string | null | undefined): MinerStatus {
  const normalized = (status ?? "").trim().toLowerCase();
  if (normalized.includes("offline") || normalized.includes("disconnected")) return "Offline";
  if (normalized.includes("reboot")) return "Rebooting";
  if (normalized.includes("overheat")) return "Overheating";
  if (normalized.includes("low")) return "Low Hashrate";
  if (normalized.includes("warning")) return "Warning";
  if (normalized.includes("mining") || normalized.includes("online") || normalized.includes("active")) return "Online";
  return "Warning";
}

function formatMinerHashrate(
  acceptedSpeed: number | null | undefined,
  acceptedSpeedUnit: string | null | undefined,
  hashrateTH: number | null | undefined
): string {
  if (acceptedSpeed !== null && acceptedSpeed !== undefined) {
    return `${acceptedSpeed.toFixed(3)} ${acceptedSpeedUnit ?? ""}`.trim();
  }

  if (hashrateTH !== null && hashrateTH !== undefined) {
    return `${hashrateTH.toFixed(3)} TH/s`;
  }

  return "--";
}

export function NicehashPage() {
  const { data, isPending, error } = useNicehashOverview();
  const isLoading = isPending && !data;

  const miners = data?.miners ?? [];
  const assets = data?.assets ?? [];

  const [selectedMinerIds, setSelectedMinerIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelectedMinerIds((current) => {
      const valid = new Set(miners.map((miner) => miner.id));
      return new Set(Array.from(current).filter((id) => valid.has(id)));
    });
  }, [miners]);

  const allSelected = miners.length > 0 && selectedMinerIds.size === miners.length;

  const toggleMiner = (id: string) => {
    setSelectedMinerIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAllMiners = () => {
    setSelectedMinerIds((current) => {
      if (current.size === miners.length) {
        return new Set();
      }
      return new Set(miners.map((miner) => miner.id));
    });
  };

  const revenueValue =
    data?.estimatedDailyRevenueUSD !== null && data?.estimatedDailyRevenueUSD !== undefined
      ? `$${data.estimatedDailyRevenueUSD.toFixed(2)}`
      : data?.estimatedDailyRevenueBTC !== null && data?.estimatedDailyRevenueBTC !== undefined
        ? `${data.estimatedDailyRevenueBTC.toFixed(8)} BTC`
        : undefined;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h2 className="text-lg md:text-xl font-mono font-semibold text-foreground">NiceHash</h2>
        <p className="text-sm text-muted-foreground mt-1">Live wallet and rig status from your NiceHash account.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 md:gap-4 stagger-children">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Pool Status</div>
          <SpinnerValue
            loading={isLoading}
            value={data?.poolStatus ?? (data?.connected ? "Connected" : undefined)}
            className={`mt-2 text-lg md:text-xl font-mono font-semibold ${data?.connected ? "text-positive" : "text-muted-foreground"}`}
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Active / Assigned</div>
          <SpinnerValue
            loading={isLoading}
            value={
              data?.assignedMiners !== null && data?.assignedMiners !== undefined
                ? data?.activeMiners !== null && data?.activeMiners !== undefined
                  ? `${data.activeMiners} / ${data.assignedMiners}`
                  : `${data.assignedMiners}`
                : undefined
            }
            className="mt-2 text-lg md:text-xl font-mono font-semibold text-foreground"
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Hashrate</div>
          <SpinnerValue
            loading={isLoading}
            value={data?.hashrateTH !== null && data?.hashrateTH !== undefined ? `${data.hashrateTH.toFixed(3)} TH/s` : undefined}
            className="mt-2 text-lg md:text-xl font-mono font-semibold text-foreground"
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Est. Daily Revenue</div>
          <SpinnerValue loading={isLoading} value={revenueValue} className="mt-2 text-lg md:text-xl font-mono font-semibold text-foreground" />
        </div>

        <div className="rounded-lg border border-border bg-card p-4 col-span-2 md:col-span-1">
          <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Wallet Total (BTC)</div>
          <SpinnerValue
            loading={isLoading}
            value={
              data?.accountTotalBTC !== null && data?.accountTotalBTC !== undefined
                ? data.accountTotalBTC.toFixed(8)
                : undefined
            }
            className="mt-2 text-lg md:text-xl font-mono font-semibold text-foreground"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 space-y-2 animate-fade-up">
        <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Pool Details</div>
        <div className="text-sm font-mono text-foreground">
          Name: <SpinnerValue loading={isLoading} value={data?.poolName ?? undefined} />
        </div>
        <div className="text-sm font-mono text-foreground break-all">
          URL: <SpinnerValue loading={isLoading} value={data?.poolUrl ?? undefined} />
        </div>
        <div className="text-sm font-mono text-foreground">
          Algorithm: <SpinnerValue loading={isLoading} value={data?.algorithm ?? undefined} />
        </div>
        <div className="text-sm font-mono text-foreground break-all">
          Mining Address: <SpinnerValue loading={isLoading} value={data?.miningAddress ?? undefined} />
        </div>
        <div className="text-sm font-mono text-foreground">
          Unpaid Balance:{" "}
          <SpinnerValue
            loading={isLoading}
            value={data?.unpaidAmountBTC !== null && data?.unpaidAmountBTC !== undefined ? `${data.unpaidAmountBTC.toFixed(8)} BTC` : undefined}
          />
        </div>
        <div className="text-sm font-mono text-foreground">
          Power Draw:{" "}
          <SpinnerValue
            loading={isLoading}
            value={data?.powerW !== null && data?.powerW !== undefined ? `${(data.powerW / 1000).toFixed(2)} kW` : undefined}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card animate-fade-up overflow-x-auto">
        <div className="px-5 py-4 border-b border-border">
          <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Wallet Assets</div>
        </div>

        {isLoading ? (
          <div className="px-5 py-6 space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={`wallet-skeleton-${index}`} className="h-8 w-full" />
            ))}
          </div>
        ) : assets.length === 0 ? (
          <div className="px-5 py-6 text-sm text-muted-foreground">
            No non-zero wallet assets found yet. Save NiceHash credentials in Settings for this user, or configure backend environment credentials.
          </div>
        ) : (
          <table className="w-full min-w-[500px]">
            <thead>
              <tr className="border-b border-border">
                {["Asset", "Total", "Available", "Pending"].map((heading) => (
                  <th
                    key={heading}
                    className="py-3 px-4 text-[11px] font-mono uppercase tracking-wider text-muted-foreground text-right first:text-left"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.currency} className="border-b border-border">
                  <td className="py-3 px-4 text-sm font-mono text-foreground">{asset.currency}</td>
                  <td className="py-3 px-4 text-right text-sm font-mono text-foreground">{formatBalance(asset.totalBalance)}</td>
                  <td className="py-3 px-4 text-right text-sm font-mono text-foreground">{formatBalance(asset.available)}</td>
                  <td className="py-3 px-4 text-right text-sm font-mono text-foreground">{formatBalance(asset.pending)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card animate-fade-up overflow-x-auto">
        <div className="px-5 py-4 border-b border-border">
          <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Assigned Miners</div>
        </div>

        <div className="px-5 py-3 border-b border-border">
          <BulkActionToolbar count={selectedMinerIds.size} />
        </div>

        {isLoading ? (
          <div className="px-5 py-6 space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={`miner-skeleton-${index}`} className="h-10 w-full" />
            ))}
          </div>
        ) : miners.length === 0 ? (
          <div className="px-5 py-6 text-sm text-muted-foreground">
            No live NiceHash miner records received yet. Ensure your API key has mining data permission (VMDS).
          </div>
        ) : (
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b border-border">
                <th className="py-3 px-4 text-left w-10">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAllMiners} />
                </th>
                {["Miner", "Status", "Hashrate", "Algorithm", "Unpaid", "Profitability", "Last Seen"].map((heading) => (
                  <th
                    key={heading}
                    className="py-3 px-4 text-[11px] font-mono uppercase tracking-wider text-muted-foreground text-right first:text-left"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {miners.map((miner) => (
                <tr key={miner.id} className="border-b border-border">
                  <td className="py-3 px-4 text-left">
                    <Checkbox checked={selectedMinerIds.has(miner.id)} onCheckedChange={() => toggleMiner(miner.id)} />
                  </td>
                  <td className="py-3 px-4 text-sm font-mono text-foreground text-left">
                    {miner.name}
                    <div className="text-xs text-muted-foreground">{miner.model}</div>
                  </td>
                  <td className="py-3 px-4 text-right text-sm font-mono text-foreground">
                    <div className="inline-flex flex-col items-end gap-1">
                      <MinerStatusBadge online={toMinerStatus(miner.status) === "Online"} minerState={miner.status} />
                      <span className="text-[11px] text-muted-foreground">{miner.status}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right text-sm font-mono text-foreground">
                    {formatMinerHashrate(miner.acceptedSpeed, miner.acceptedSpeedUnit, miner.hashrateTH)}
                  </td>
                  <td className="py-3 px-4 text-right text-sm font-mono text-foreground">{miner.algorithm ?? "--"}</td>
                  <td className="py-3 px-4 text-right text-sm font-mono text-foreground">
                    {miner.unpaidAmountBTC !== null ? `${miner.unpaidAmountBTC.toFixed(8)} BTC` : "--"}
                  </td>
                  <td className="py-3 px-4 text-right text-sm font-mono text-foreground">
                    {miner.profitabilityBTC !== null ? `${miner.profitabilityBTC.toFixed(8)} BTC/day` : "--"}
                  </td>
                  <td className="py-3 px-4 text-right text-sm font-mono text-muted-foreground">{formatTimestamp(miner.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {error && !data ? (
        <div className="rounded-md border border-negative/30 bg-negative/10 px-4 py-3 text-sm text-negative">
          {error instanceof Error ? error.message : "Failed to load NiceHash data."}
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-secondary/40 p-4 text-xs text-muted-foreground">
        <div className="inline-flex items-center gap-1 font-mono uppercase tracking-wider">
          <Lock className="h-3.5 w-3.5" />
          Coming Soon
        </div>
        <div className="mt-1">
          Profit switching, wallet management, benchmark controls, and payout analytics are still inactive.
        </div>
      </div>
    </div>
  );
}

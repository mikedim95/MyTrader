import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { AssetRow } from "@/components/AssetRow";
import { AssetDetailsDialog } from "@/components/AssetDetailsDialog";
import { SpinnerValue } from "@/components/SpinnerValue";
import { useDashboardData } from "@/hooks/useTradingData";
import type { Asset, PortfolioAccountType } from "@/types/api";

interface PortfolioPageProps {
  accountType: PortfolioAccountType;
  onSelectAsset?: (asset: Asset) => void;
}

export function PortfolioPage({ accountType, onSelectAsset }: PortfolioPageProps) {
  const { data, isPending, error } = useDashboardData(accountType);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const isLoading = isPending && !data;

  const assets = data?.assets ?? [];

  const fmtUsd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

  const topPosition = [...assets].sort((a, b) => b.value - a.value)[0];

  useEffect(() => {
    if (!selectedAsset) return;
    const refreshedAsset = assets.find((asset) => asset.id === selectedAsset.id);
    if (refreshedAsset) {
      setSelectedAsset(refreshedAsset);
    }
  }, [assets, selectedAsset]);

  const handleSelectAsset = (asset: Asset) => {
    setSelectedAsset(asset);
    onSelectAsset?.(asset);
  };

  return (
    <>
      <div className="p-6 space-y-4">
        <div>
          <h2 className="text-lg font-mono font-semibold text-foreground">Portfolio</h2>
          <p className="text-sm text-muted-foreground mt-1">Core holdings overview.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Total Value</div>
            <SpinnerValue
              loading={isLoading}
              value={data ? fmtUsd(data.totalPortfolioValue) : undefined}
              className="mt-2 text-xl font-mono font-semibold text-foreground"
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">24h Change</div>
            <SpinnerValue
              loading={isLoading}
              value={
                data
                  ? `${data.portfolioChange24hValue >= 0 ? "+" : ""}${fmtUsd(data.portfolioChange24hValue)}`
                  : undefined
              }
              className={`mt-2 text-xl font-mono font-semibold ${data && data.portfolioChange24hValue < 0 ? "text-negative" : "text-positive"}`}
            />
            <SpinnerValue
              loading={isLoading}
              value={data ? `${data.portfolioChange24h >= 0 ? "+" : ""}${data.portfolioChange24h}%` : undefined}
              className={`text-[11px] font-mono ${data && data.portfolioChange24h < 0 ? "text-negative" : "text-positive"}`}
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Assets</div>
            <SpinnerValue
              loading={isLoading}
              value={data ? data.assets.length : undefined}
              className="mt-2 text-xl font-mono font-semibold text-foreground"
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Top Position</div>
            <SpinnerValue
              loading={isLoading}
              value={topPosition ? `${topPosition.symbol} ${fmtUsd(topPosition.value)}` : undefined}
              className="mt-2 text-xl font-mono font-semibold text-foreground"
            />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card">
          <div className="px-5 py-4 border-b border-border">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Holdings</div>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Asset", "Price", "Balance", "Value", "Allocation", "24h", "Value Trend"].map((heading) => (
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
              {isLoading
                ? Array.from({ length: 3 }).map((_, rowIndex) => (
                    <tr key={`loading-row-${rowIndex}`} className="border-b border-border">
                      {Array.from({ length: 7 }).map((__, colIndex) => (
                        <td key={`loading-cell-${rowIndex}-${colIndex}`} className="py-3 px-4 text-right first:text-left">
                          <div className="inline-flex">
                            <SpinnerValue loading value={undefined} />
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))
                : assets.map((asset) => (
                    <AssetRow key={asset.id} asset={asset} onClick={() => handleSelectAsset(asset)} />
                  ))}
            </tbody>
          </table>

          {!isLoading && assets.length === 0 ? (
            <div className="px-5 py-6 text-sm text-muted-foreground">
              {accountType === "demo"
                ? "Demo account not initialized yet. Use the top bar to choose your starting capital and asset mix."
                : "No live holdings found for the connected account."}
            </div>
          ) : null}
        </div>

        {error && !data ? (
          <div className="rounded-md border border-negative/30 bg-negative/10 px-4 py-3 text-xs text-negative">
            {error instanceof Error ? error.message : "Failed to load portfolio data."}
          </div>
        ) : null}

        <div className="rounded-lg border border-border bg-secondary/40 p-4 text-[11px] text-muted-foreground">
          <div className="inline-flex items-center gap-1 font-mono uppercase tracking-wider">
            <Lock className="h-3 w-3" />
            Coming Soon
          </div>
          <div className="mt-1">Advanced portfolio analytics and optimization tools are inactive for now.</div>
        </div>
      </div>

      <AssetDetailsDialog
        asset={selectedAsset}
        open={Boolean(selectedAsset)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedAsset(null);
          }
        }}
      />
    </>
  );
}

import { AssetRow } from "@/components/AssetRow";
import { SpinnerValue } from "@/components/SpinnerValue";
import { cn } from "@/lib/utils";
import type { Asset, PortfolioAccountType } from "@/types/api";

interface HoldingsTableProps {
  accountType: PortfolioAccountType;
  assets: Asset[];
  className?: string;
  description?: string;
  isLoading: boolean;
  onSelectAsset?: (asset: Asset) => void;
  title?: string;
}

export function HoldingsTable({
  accountType,
  assets,
  className,
  description,
  isLoading,
  onSelectAsset,
  title = "Holdings",
}: HoldingsTableProps) {
  return (
    <div className={cn("rounded-lg border border-border bg-card animate-fade-up overflow-hidden", className)}>
      <div className="border-b border-border px-5 py-4">
        <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{title}</div>
        {description ? <div className="mt-2 text-sm text-muted-foreground">{description}</div> : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="border-b border-border">
              {["Asset", "Price", "Balance", "Value", "Allocation", "24h", "Value Trend"].map((heading) => (
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
                  <AssetRow
                    key={asset.id}
                    asset={asset}
                    onClick={onSelectAsset ? () => onSelectAsset(asset) : undefined}
                  />
                ))}
          </tbody>
        </table>
      </div>

      {!isLoading && assets.length === 0 ? (
        <div className="px-5 py-6 text-sm text-muted-foreground">
          {accountType === "demo"
            ? "Demo account not initialized yet. Use the top bar to choose your starting capital and asset mix."
            : "No live holdings found for the connected account."}
        </div>
      ) : null}
    </div>
  );
}

import { TrendingDown, TrendingUp } from "lucide-react";
import type { Asset } from "@/types/api";
import { Sparkline } from "@/components/AssetRow";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface AssetDetailsDialogProps {
  asset: Asset | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatUsd(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatCompactUsd(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (absolute >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (absolute >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return formatUsd(value);
}

function formatNumeric(value: number, maximumFractionDigits = 4): string {
  return value.toLocaleString("en-US", { maximumFractionDigits });
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 text-sm font-mono text-foreground">{value}</div>
    </div>
  );
}

export function AssetDetailsDialog({ asset, open, onOpenChange }: AssetDetailsDialogProps) {
  if (!asset) return null;

  const historicalValues = asset.sparkline.length > 0 ? asset.sparkline : [asset.value];
  const firstValue = historicalValues[0] ?? asset.value;
  const lastValue = historicalValues[historicalValues.length - 1] ?? asset.value;
  const valueChange = lastValue - firstValue;
  const valueChangePct = firstValue > 0 ? (valueChange / firstValue) * 100 : 0;
  const lowValue = Math.min(...historicalValues);
  const highValue = Math.max(...historicalValues);
  const positivePrice = asset.change24h >= 0;
  const positiveValue = valueChange >= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl border-border bg-card p-0">
        <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="border-b border-border p-6 lg:border-b-0 lg:border-r">
            <DialogHeader className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-secondary/60">
                  <span className="text-sm font-mono font-semibold text-foreground">{asset.symbol.slice(0, 2)}</span>
                </div>
                <div>
                  <DialogTitle className="font-mono text-xl">{asset.symbol}</DialogTitle>
                  <DialogDescription>{asset.name}</DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="mt-6 flex flex-wrap items-end gap-3">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Live Position Value</div>
                <div className="mt-2 text-3xl font-mono font-semibold text-foreground">{formatUsd(asset.value)}</div>
              </div>

              <div
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-mono",
                  positiveValue ? "border-positive/30 bg-positive/10 text-positive" : "border-negative/30 bg-negative/10 text-negative"
                )}
              >
                {positiveValue ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {positiveValue ? "+" : ""}
                {formatUsd(valueChange)} ({positiveValue ? "+" : ""}
                {valueChangePct.toFixed(2)}%)
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-border bg-background/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    Historical Position Value
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Trend now reflects what this holding was worth over the last 24 hours.</div>
                </div>
                <div className="rounded-md border border-border px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  {asset.sparklinePeriod}
                </div>
              </div>

              <div className="mt-5 overflow-hidden rounded-lg border border-border/70 bg-secondary/10 p-4">
                <Sparkline data={historicalValues} positive={positiveValue} width={520} height={180} />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <StatTile label="Open Value" value={formatUsd(firstValue)} />
                <StatTile label="Low Value" value={formatUsd(lowValue)} />
                <StatTile label="High Value" value={formatUsd(highValue)} />
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <StatTile label="Current Price" value={formatUsd(asset.price)} />
              <StatTile
                label="24h Price Change"
                value={`${positivePrice ? "+" : ""}${asset.change24h.toFixed(2)}%`}
              />
              <StatTile label="Balance" value={`${formatNumeric(asset.balance, 8)} ${asset.symbol}`} />
              <StatTile label="Allocation" value={`${asset.allocation.toFixed(2)}%`} />
              <StatTile label="Target Allocation" value={`${asset.targetAllocation.toFixed(2)}%`} />
              <StatTile
                label="24h Volume"
                value={asset.volume24h > 0 ? formatCompactUsd(asset.volume24h) : "--"}
              />
              <StatTile
                label="Market Cap"
                value={asset.marketCap > 0 ? formatCompactUsd(asset.marketCap) : "--"}
              />
              <StatTile label="Value Range" value={`${formatUsd(lowValue)} - ${formatUsd(highValue)}`} />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

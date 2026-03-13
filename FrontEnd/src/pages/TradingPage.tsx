import { useEffect, useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { SpinnerValue } from "@/components/SpinnerValue";
import { useDashboardData } from "@/hooks/useTradingData";
import { cn } from "@/lib/utils";
import type { PortfolioAccountType } from "@/types/api";

interface TradingPageProps {
  accountType: PortfolioAccountType;
}

export function TradingPage({ accountType }: TradingPageProps) {
  const { data, isPending, error } = useDashboardData(accountType);
  const isLoading = isPending && !data;

  const [side, setSide] = useState<"Buy" | "Sell">("Buy");
  const [symbol, setSymbol] = useState<string>("");
  const [amount, setAmount] = useState<string>("");

  const assets = data?.assets ?? [];

  useEffect(() => {
    if (!symbol && assets.length > 0) {
      setSymbol(assets[0].symbol);
    }
  }, [assets, symbol]);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.symbol === symbol) ?? assets[0] ?? null,
    [assets, symbol]
  );

  const parsedAmount = Number(amount);
  const estimatedTotal = selectedAsset && Number.isFinite(parsedAmount) && parsedAmount > 0
    ? parsedAmount * selectedAsset.price
    : null;

  const fmtUsd = (value: number) =>
    value.toLocaleString("en-US", { style: "currency", currency: "USD" });

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-mono font-semibold text-foreground">Trading</h2>
        <p className="text-sm text-muted-foreground mt-1">Basic order form for quick spot entries.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-lg border border-border bg-card p-5 space-y-4">
          <div className="flex gap-2">
            {(["Buy", "Sell"] as const).map((nextSide) => (
              <button
                key={nextSide}
                onClick={() => setSide(nextSide)}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-xs font-mono uppercase tracking-wider transition-colors",
                  side === nextSide
                    ? nextSide === "Buy"
                      ? "border-positive bg-positive/10 text-positive"
                      : "border-negative bg-negative/10 text-negative"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {nextSide}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Asset</label>
              <select
                value={selectedAsset?.symbol ?? ""}
                onChange={(event) => setSymbol(event.target.value)}
                disabled={isLoading || assets.length === 0}
                className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-2.5 text-sm font-mono text-foreground outline-none disabled:opacity-70"
              >
                {assets.length === 0 ? (
                  <option value="">No live assets</option>
                ) : (
                  assets.map((asset) => (
                    <option key={asset.id} value={asset.symbol}>
                      {asset.symbol}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Amount ({selectedAsset?.symbol ?? "asset"})
              </label>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                disabled={isLoading || !selectedAsset}
                className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-2.5 text-sm font-mono text-foreground outline-none disabled:opacity-70"
              />
            </div>

            <div>
              <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Price (USD)</label>
              <div className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-2.5 text-sm font-mono text-foreground">
                <SpinnerValue
                  loading={isLoading}
                  value={selectedAsset ? fmtUsd(selectedAsset.price) : undefined}
                  placeholder="--"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Estimated Total</label>
              <div className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-2.5 text-sm font-mono text-foreground">
                <SpinnerValue
                  loading={isLoading}
                  value={estimatedTotal !== null ? fmtUsd(estimatedTotal) : undefined}
                  placeholder="--"
                />
              </div>
            </div>
          </div>

          <button
            disabled={isLoading || !selectedAsset || !Number.isFinite(parsedAmount) || parsedAmount <= 0}
            className="w-full rounded-md bg-primary px-4 py-3 text-xs font-mono font-semibold uppercase tracking-wider text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
          >
            Place {side} Order (Preview)
          </button>

          <p className="text-[11px] text-muted-foreground">
            Order execution and advanced order types are currently inactive.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Basic Market Info</div>
          <div className="space-y-2 text-sm font-mono">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Connection</span>
              <SpinnerValue
                loading={isLoading}
                value={
                  data
                    ? data.connection.connected
                      ? data.connection.testnet
                        ? "Testnet"
                        : "Live"
                      : "Offline"
                    : undefined
                }
                className={data?.connection.connected ? "text-positive" : "text-muted-foreground"}
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Pair</span>
              <SpinnerValue
                loading={isLoading}
                value={selectedAsset ? `${selectedAsset.symbol}/USDT` : undefined}
                className="text-foreground"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">24h Change</span>
              <SpinnerValue
                loading={isLoading}
                value={
                  selectedAsset
                    ? `${selectedAsset.change24h >= 0 ? "+" : ""}${selectedAsset.change24h}%`
                    : undefined
                }
                className={cn(selectedAsset && selectedAsset.change24h < 0 ? "text-negative" : "text-positive")}
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Available Balance</span>
              <SpinnerValue
                loading={isLoading}
                value={
                  selectedAsset
                    ? `${selectedAsset.balance.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${selectedAsset.symbol}`
                    : undefined
                }
                className="text-foreground"
              />
            </div>
          </div>

          {error && !data ? (
            <div className="rounded-md border border-negative/30 bg-negative/10 p-3 text-[11px] text-negative">
              {error instanceof Error ? error.message : "Failed to load trading data."}
            </div>
          ) : null}

          <div className="rounded-md border border-border bg-secondary/50 p-3 text-[11px] text-muted-foreground">
            <div className="inline-flex items-center gap-1 font-mono uppercase tracking-wider">
              <Lock className="h-3 w-3" />
              Advanced Trading
            </div>
            <div className="mt-1">Limit orders, TP/SL, and automation are coming soon.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

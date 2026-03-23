import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpFromLine, Coins, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip as ChartTooltip } from "recharts";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { backendApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  Activity,
  Asset,
  ExchangeId,
  PortfolioAccountType,
  TradingAmountMode,
  TradingAssetAvailability,
  TradingFiatCurrency,
  TradingTransactionRequest,
} from "@/types/api";

interface AssetDetailsDialogProps {
  asset: Asset | null;
  open: boolean;
  accountType: PortfolioAccountType;
  portfolioTotalValue: number;
  tradingAssets: TradingAssetAvailability[];
  recentActivity: Activity[];
  onOpenChange: (open: boolean) => void;
}

type TradeAction = "buy" | "sell";
type EntryMode = "crypto" | "fiat";

const EXCHANGES: ExchangeId[] = ["kraken", "crypto.com", "coinbase"];
const FIATS: TradingFiatCurrency[] = ["USD", "EUR"];
const USD_PRIORITY = ["USDC", "USDT", "USD", "BUSD", "FDUSD", "TUSD", "DAI"];
const EMPTY_ASSET: Asset = {
  id: "__empty__",
  symbol: "",
  name: "",
  price: 0,
  balance: 0,
  value: 0,
  allocation: 0,
  targetAllocation: 0,
  change24h: 0,
  sparkline: [],
};

function usd(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fiat(value: number, currency: TradingFiatCurrency) {
  return value.toLocaleString("en-US", { style: "currency", currency, maximumFractionDigits: 2 });
}

function num(value: number, digits = 6) {
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function inputNumber(value: number, digits = 6) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return String(Number(value.toFixed(digits)));
}

function amount(value: number, symbol: string) {
  return `${num(value, 8)} ${symbol}`;
}

function pct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function accent(symbol: string) {
  const hash = Array.from(symbol.toUpperCase()).reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0);
  return `hsl(${hash % 360}, ${70 + (hash % 12)}%, ${54 + (hash % 8)}%)`;
}

function settlementSymbol(fiatCurrency: TradingFiatCurrency, tradingAssets: TradingAssetAvailability[]) {
  if (fiatCurrency === "EUR") return "EUR";
  const bySymbol = new Map(tradingAssets.map((asset) => [asset.symbol, asset]));
  return (
    USD_PRIORITY.map((symbol) => bySymbol.get(symbol))
      .filter((asset): asset is TradingAssetAvailability => Boolean(asset))
      .sort((a, b) => b.freeValueUsd - a.freeValueUsd)[0]?.symbol ?? "USDC"
  );
}

function amountMode(action: TradeAction, entryMode: EntryMode): TradingAmountMode {
  if (action === "buy") return entryMode === "crypto" ? "buying_asset" : "selling_asset";
  return entryMode === "crypto" ? "selling_asset" : "buying_asset";
}

function Stat({ label, value, subvalue, tone = "default" }: { label: string; value: string; subvalue?: string; tone?: "default" | "positive" | "negative" }) {
  return (
    <div className="rounded-2xl border border-border bg-secondary/12 p-4">
      <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-muted-foreground">{label}</div>
      <div className={cn("mt-3 text-xl font-mono font-semibold text-foreground", tone === "positive" && "text-positive", tone === "negative" && "text-negative")}>
        {value}
      </div>
      {subvalue ? <div className="mt-1 text-xs text-muted-foreground">{subvalue}</div> : null}
    </div>
  );
}

export function AssetDetailsDialog({
  asset,
  open,
  accountType,
  portfolioTotalValue,
  tradingAssets,
  recentActivity,
  onOpenChange,
}: AssetDetailsDialogProps) {
  const queryClient = useQueryClient();
  const [tradeAction, setTradeAction] = useState<TradeAction>("buy");
  const [exchange, setExchange] = useState<ExchangeId>("kraken");
  const [fiatCurrency, setFiatCurrency] = useState<TradingFiatCurrency>("USD");
  const [entryMode, setEntryMode] = useState<EntryMode>("fiat");
  const [amountInput, setAmountInput] = useState("");
  const activeAsset = asset ?? EMPTY_ASSET;

  useEffect(() => {
    if (!asset || !open) return;
    setTradeAction("buy");
    setExchange("kraken");
    setFiatCurrency("USD");
    setEntryMode("fiat");
    setAmountInput("");
  }, [asset?.id, open]);

  useEffect(() => {
    setEntryMode(tradeAction === "buy" ? "fiat" : "crypto");
    setAmountInput("");
  }, [tradeAction]);

  const assetColor = accent(activeAsset.symbol || "asset");
  const points =
    activeAsset.sparkline.length > 1 ? activeAsset.sparkline : [activeAsset.price, activeAsset.price];
  const chart = points.map((value, index) => ({ index, value }));
  const first = points[0] ?? activeAsset.price;
  const last = points[points.length - 1] ?? activeAsset.price;
  const delta = last - first;
  const deltaPct = first > 0 ? (delta / first) * 100 : 0;
  const low = Math.min(...points);
  const high = Math.max(...points);

  const assetBalance = tradingAssets.find((row) => row.symbol === activeAsset.symbol) ?? null;
  const paySymbol = settlementSymbol(fiatCurrency, tradingAssets);
  const payBalance = tradingAssets.find((row) => row.symbol === paySymbol) ?? null;
  const parsedAmount = Number(amountInput);
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;

  const previewPayload = validAmount
    ? ({
        accountType,
        buyingAsset: tradeAction === "buy" ? activeAsset.symbol : paySymbol,
        sellingAsset: tradeAction === "buy" ? paySymbol : activeAsset.symbol,
        amountMode: amountMode(tradeAction, entryMode),
        amount: parsedAmount,
        exchange,
        fiatCurrency,
      } satisfies TradingTransactionRequest)
    : null;

  const previewQuery = useQuery({
    queryKey: ["asset-detail-preview", accountType, activeAsset.symbol, tradeAction, exchange, fiatCurrency, entryMode, amountInput],
    queryFn: () => backendApi.previewTrade(previewPayload as TradingTransactionRequest),
    enabled: open && Boolean(asset) && Boolean(previewPayload),
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const executeMutation = useMutation({
    mutationFn: (payload: TradingTransactionRequest) => backendApi.executeTrade(payload),
    onSuccess: async (response) => {
      toast.success(response.execution.message);
      setAmountInput("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", accountType] }),
        queryClient.invalidateQueries({ queryKey: ["trading-assets", accountType] }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["demo-account-settings"] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Trade failed.");
    },
  });

  const activity = recentActivity
    .filter((item) => item.asset.trim().toUpperCase() === activeAsset.symbol.toUpperCase())
    .slice(0, 5);
  const maxInput =
    tradeAction === "buy"
      ? entryMode === "fiat"
        ? payBalance?.freeAmount ?? 0
        : activeAsset.price > 0
          ? (payBalance?.freeValueUsd ?? 0) / activeAsset.price
          : 0
      : entryMode === "crypto"
        ? assetBalance?.freeAmount ?? activeAsset.balance
        : assetBalance?.freeValueUsd ?? activeAsset.value;

  const quickButtons =
    entryMode === "fiat"
      ? [
          { label: "Clear", value: 0 },
          { label: "100", value: 100 },
          { label: "250", value: 250 },
          { label: "Max", value: maxInput },
        ]
      : [
          { label: "Clear", value: 0 },
          { label: "25%", value: maxInput * 0.25 },
          { label: "50%", value: maxInput * 0.5 },
          { label: "Max", value: maxInput },
        ];

  const executeDisabled =
    !asset ||
    !previewPayload ||
    !previewQuery.data ||
    !previewQuery.data.executable ||
    previewQuery.data.blockingReasons.length > 0 ||
    previewQuery.isFetching ||
    executeMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(94vh,980px)] max-w-[min(96vw,1500px)] gap-0 overflow-hidden border-border bg-card p-0">
        <div className="grid h-full min-h-0 lg:grid-cols-[minmax(0,1.35fr)_420px]">
          <div className="min-h-0 overflow-y-auto p-6 md:p-8">
            <DialogHeader className="space-y-3">
              <div className="text-sm text-muted-foreground">Portfolio / {activeAsset.name}</div>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full text-lg font-mono font-semibold text-background" style={{ backgroundColor: assetColor }}>
                    {activeAsset.symbol.slice(0, 2)}
                  </div>
                  <div>
                    <DialogTitle className="font-mono text-3xl">{activeAsset.name}</DialogTitle>
                    <DialogDescription className="mt-1 font-mono text-lg uppercase tracking-wider">{activeAsset.symbol}</DialogDescription>
                  </div>
                </div>
                <div className="text-left md:text-right">
                  <div className="text-4xl font-mono font-semibold text-foreground">{usd(activeAsset.price)}</div>
                  <div className={cn("mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-mono", activeAsset.change24h >= 0 ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative")}>
                    {activeAsset.change24h >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    {pct(activeAsset.change24h)}
                  </div>
                </div>
              </div>
            </DialogHeader>

            <div className="mt-8 rounded-[28px] border border-border bg-[#0b1224] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">Price movement</div>
                  <div className="mt-2 text-2xl font-mono font-semibold text-foreground">{usd(last || activeAsset.price)}</div>
                  <div className={cn("mt-1 text-sm font-mono", delta >= 0 ? "text-positive" : "text-negative")}>
                    {delta >= 0 ? "+" : "-"}{usd(Math.abs(delta))} | {pct(deltaPct)}
                  </div>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/40 px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                  24H trace
                </div>
              </div>

              <div className="mt-5 h-[300px] rounded-[24px] border border-border/60 bg-[linear-gradient(180deg,rgba(8,18,40,0.95),rgba(8,18,40,0.65))] p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chart} margin={{ top: 6, right: 6, left: 6, bottom: 6 }}>
                    <defs>
                      <linearGradient id={`asset-fill-${activeAsset.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={assetColor} stopOpacity={0.45} />
                        <stop offset="100%" stopColor={assetColor} stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <ChartTooltip
                      cursor={{ stroke: "rgba(255,255,255,0.14)", strokeDasharray: "4 4" }}
                      content={({ active, payload }) => {
                        const value = payload?.[0]?.value;
                        if (!active || typeof value !== "number") return null;
                        return <div className="rounded-lg border border-border bg-card/95 px-3 py-2 text-xs font-mono text-foreground shadow-xl">{usd(value)}</div>;
                      }}
                    />
                    <Area type="monotone" dataKey="value" stroke={assetColor} fill={`url(#asset-fill-${activeAsset.id})`} strokeWidth={2.25} dot={false} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {["Live", "24H", "7D", "30D", "90D"].map((label, index) => (
                  <button
                    key={label}
                    type="button"
                    disabled={index !== 1}
                    className={cn("rounded-full border px-4 py-2 text-sm font-mono transition-colors", index === 1 ? "border-primary/35 bg-primary/12 text-primary" : "border-border bg-background/30 text-muted-foreground opacity-55")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-8 space-y-8">
              <div className="rounded-3xl border border-border bg-secondary/12 p-5">
                <div className="text-4xl font-mono font-semibold text-foreground">{usd(activeAsset.value)}</div>
                <div className="mt-2 text-lg font-mono text-muted-foreground">{amount(activeAsset.balance, activeAsset.symbol)}</div>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <Button type="button" className="h-14 rounded-full bg-primary/18 font-mono text-primary hover:bg-primary/24" variant="secondary" onClick={() => setTradeAction("buy")}>
                    <ArrowDownToLine className="h-4 w-4" />
                    Buy More
                  </Button>
                  <Button type="button" className="h-14 rounded-full bg-secondary font-mono text-foreground hover:bg-secondary/90" variant="secondary" onClick={() => setTradeAction("sell")}>
                    <ArrowUpFromLine className="h-4 w-4" />
                    Reduce
                  </Button>
                </div>
              </div>

              <div>
                <div className="text-3xl font-mono font-semibold text-foreground">Performance</div>
                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Stat label="Position move" value={`${activeAsset.change24h >= 0 ? "+" : "-"}${usd(Math.abs((activeAsset.value * activeAsset.change24h) / 100))}`} tone={activeAsset.change24h >= 0 ? "positive" : "negative"} />
                  <Stat label="Portfolio share" value={`${activeAsset.allocation.toFixed(2)}%`} />
                  <Stat label="Target weight" value={`${activeAsset.targetAllocation.toFixed(2)}%`} subvalue={`${(activeAsset.targetAllocation - activeAsset.allocation).toFixed(2)} pts drift`} />
                  <Stat label="24H range" value={`${usd(low)} - ${usd(high)}`} />
                </div>
              </div>

              <div>
                <div className="text-3xl font-mono font-semibold text-foreground">Breakdown</div>
                <div className="mt-5 space-y-3">
                  {[
                    { label: "Portfolio balance", qty: amount(activeAsset.balance, activeAsset.symbol), val: usd(activeAsset.value), icon: <Wallet className="h-4 w-4 text-primary" /> },
                    { label: "Free to trade", qty: amount(assetBalance?.freeAmount ?? activeAsset.balance, activeAsset.symbol), val: usd(assetBalance?.freeValueUsd ?? activeAsset.value), icon: <Coins className="h-4 w-4 text-primary" /> },
                    { label: "Reserved in strategies", qty: amount(assetBalance?.reservedAmount ?? 0, activeAsset.symbol), val: usd(assetBalance?.reservedValueUsd ?? 0), icon: <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/50" /> },
                    { label: "Locked", qty: amount(assetBalance?.lockedAmount ?? 0, activeAsset.symbol), val: usd((assetBalance?.lockedAmount ?? 0) * (assetBalance?.priceUsd ?? activeAsset.price)), icon: <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/50" /> },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-secondary/10 px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background/60">{row.icon}</div>
                        <div>
                          <div className="text-base font-mono font-semibold text-foreground">{row.label}</div>
                          <div className="mt-1 text-sm text-muted-foreground">{row.qty}</div>
                        </div>
                      </div>
                      <div className="text-right text-lg font-mono font-semibold text-foreground">{row.val}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-4">
                  <div className="text-3xl font-mono font-semibold text-foreground">Recent activity</div>
                  <div className="text-sm font-mono text-muted-foreground">{activity.length} entries</div>
                </div>
                <div className="mt-5 space-y-3">
                  {activity.length > 0 ? activity.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background/40 px-4 py-3">
                      <div>
                        <div className="text-sm font-mono font-semibold text-foreground">{item.type}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{new Date(item.time).toLocaleString()}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-mono text-foreground">{item.amount}</div>
                        <div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">{item.asset}</div>
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-border bg-secondary/10 px-5 py-8 text-sm text-muted-foreground">
                      No recent portfolio activity for {activeAsset.symbol} was returned by the dashboard feed.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto border-t border-border bg-background/45 p-6 lg:border-l lg:border-t-0">
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                {(["buy", "sell"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setTradeAction(mode)}
                    className={cn("border-b-2 pb-2 text-2xl font-mono font-semibold transition-colors", tradeAction === mode ? "border-primary text-foreground" : "border-transparent text-muted-foreground")}
                  >
                    {mode === "buy" ? "Buy" : "Sell"}
                  </button>
                ))}
              </div>

              <div className="space-y-3 rounded-3xl border border-border bg-card/70 p-5">
                <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">Amount</div>
                      <div className="mt-2 text-5xl font-mono font-semibold text-foreground">{amountInput && validAmount ? amountInput : "0"}</div>
                    <div className="mt-2 text-sm text-muted-foreground">in {entryMode === "fiat" ? fiatCurrency : activeAsset.symbol}</div>
                  </div>
                  <div className="rounded-full border border-border bg-secondary/20 px-3 py-2 text-sm font-mono text-foreground">{activeAsset.symbol}</div>
                </div>

                <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
                  <Input value={amountInput} onChange={(event) => setAmountInput(event.target.value)} inputMode="decimal" placeholder="0.00" className="h-14 border-border bg-background/50 text-lg font-mono" />
                  <Button type="button" variant="outline" className="h-14 border-border bg-background/40 font-mono" onClick={() => setEntryMode((current) => (current === "crypto" ? "fiat" : "crypto"))}>
                    {entryMode === "crypto" ? fiatCurrency : activeAsset.symbol}
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {quickButtons.map((button) => (
                    <Button
                      key={button.label}
                      type="button"
                      variant="secondary"
                      className={cn("rounded-full font-mono", button.label === "Clear" ? "bg-negative/12 text-negative hover:bg-negative/20" : "bg-primary/14 text-primary hover:bg-primary/20")}
                      onClick={() => setAmountInput(inputNumber(button.value, 6))}
                    >
                      {button.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">Exchange</div>
                  <Select value={exchange} onValueChange={(value) => setExchange(value as ExchangeId)}>
                    <SelectTrigger className="border-border bg-secondary/10 font-mono"><SelectValue /></SelectTrigger>
                    <SelectContent>{EXCHANGES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">Quote</div>
                  <Select value={fiatCurrency} onValueChange={(value) => setFiatCurrency(value as TradingFiatCurrency)}>
                    <SelectTrigger className="border-border bg-secondary/10 font-mono"><SelectValue /></SelectTrigger>
                    <SelectContent>{FIATS.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-3xl border border-border bg-card/70 p-5">
                <div className="text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">Pay with</div>
                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl border border-border bg-secondary/12 px-4 py-4">
                    <div className="text-base font-mono font-semibold text-foreground">{paySymbol}</div>
                    <div className="mt-1 text-sm text-muted-foreground">Free balance {amount(payBalance?.freeAmount ?? 0, paySymbol)}</div>
                    <div className="mt-2 text-sm font-mono text-foreground">{usd(payBalance?.freeValueUsd ?? 0)}</div>
                  </div>
                  <div className="rounded-2xl border border-border bg-secondary/12 px-4 py-4">
                    <div className="text-base font-mono font-semibold text-foreground">{activeAsset.symbol}</div>
                    <div className="mt-1 text-sm text-muted-foreground">Free balance {amount(assetBalance?.freeAmount ?? activeAsset.balance, activeAsset.symbol)}</div>
                    <div className="mt-2 text-sm font-mono text-foreground">{usd(assetBalance?.freeValueUsd ?? activeAsset.value)}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-border bg-card/70 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-2xl font-mono font-semibold text-foreground">Preview</div>
                  {previewQuery.data?.marketTimestamp ? <div className="text-xs font-mono text-muted-foreground">{new Date(previewQuery.data.marketTimestamp).toLocaleTimeString()}</div> : null}
                </div>
                {!validAmount ? (
                  <div className="mt-4 rounded-2xl border border-dashed border-border bg-secondary/12 px-4 py-8 text-sm text-muted-foreground">Enter an amount to preview the trade.</div>
                ) : previewQuery.isFetching ? (
                  <div className="mt-4 rounded-2xl border border-border bg-secondary/12 px-4 py-8 text-sm text-muted-foreground">Loading preview...</div>
                ) : previewQuery.error ? (
                  <div className="mt-4 rounded-2xl border border-negative/40 bg-negative/10 px-4 py-4 text-sm text-negative">{previewQuery.error instanceof Error ? previewQuery.error.message : "Preview failed."}</div>
                ) : previewQuery.data ? (
                  <div className="mt-4 space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Stat label="Rate" value={fiat(previewQuery.data.priceInFiat, fiatCurrency)} />
                      <Stat label={tradeAction === "buy" ? "Estimated receive" : "Estimated proceeds"} value={tradeAction === "buy" ? amount(previewQuery.data.buyAmount, previewQuery.data.buyingAsset.symbol) : fiat(previewQuery.data.buyWorthFiat, fiatCurrency)} subvalue={tradeAction === "buy" ? fiat(previewQuery.data.buyWorthFiat, fiatCurrency) : amount(previewQuery.data.buyAmount, previewQuery.data.buyingAsset.symbol)} />
                    </div>
                    {previewQuery.data.warnings[0] ? <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">{previewQuery.data.warnings[0]}</div> : null}
                    {previewQuery.data.blockingReasons[0] ? <div className="rounded-2xl border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">{previewQuery.data.blockingReasons[0]}</div> : null}
                  </div>
                ) : null}
              </div>

              <Button
                type="button"
                onClick={() => previewPayload && executeMutation.mutate(previewPayload)}
                disabled={executeDisabled}
                className={cn("h-14 w-full rounded-2xl text-lg font-mono font-semibold", tradeAction === "buy" ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-secondary text-foreground hover:bg-secondary/90")}
              >
                {executeMutation.isPending ? "Executing..." : `${tradeAction === "buy" ? "Buy" : "Sell"} ${activeAsset.symbol}`}
              </Button>

              <div className="text-xs text-muted-foreground">
                Portfolio diversity: {portfolioTotalValue > 0 ? ((activeAsset.value / portfolioTotalValue) * 100).toFixed(2) : activeAsset.allocation.toFixed(2)}%
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

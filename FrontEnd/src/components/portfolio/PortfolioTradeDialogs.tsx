import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowLeftRight, Coins, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { backendApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  Asset,
  ExchangeId,
  PortfolioAccountType,
  TradingAmountMode,
  TradingAssetAvailability,
  TradingFiatCurrency,
  TradingTransactionRequest,
} from "@/types/api";

type TradeAction = "buy" | "sell";
type TradeStep = "asset" | "amount";
type EntryMode = "crypto" | "fiat";

interface PortfolioTradeDialogsProps {
  accountType: PortfolioAccountType;
  portfolioAssets: Asset[];
  tradingAssets: TradingAssetAvailability[];
}

interface TradeAssetOption {
  symbol: string;
  name: string;
  balance: number;
  value: number;
  owned: boolean;
}

const EXCHANGE_OPTIONS: Array<{ value: ExchangeId; label: string }> = [
  { value: "kraken", label: "Kraken" },
  { value: "crypto.com", label: "Crypto.com" },
];

const FIAT_OPTIONS: Array<{ value: TradingFiatCurrency; label: string }> = [
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
];

const USD_SETTLEMENT_PRIORITY = ["USDC", "USDT", "USD", "BUSD", "FDUSD", "TUSD", "DAI"];
const FIAT_SYMBOLS = new Set(["USD", "EUR", ...USD_SETTLEMENT_PRIORITY]);
const COMMON_BUY_SYMBOLS = [
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "ADA",
  "DOGE",
  "AVAX",
  "LINK",
  "DOT",
  "ATOM",
  "NEAR",
  "SUI",
  "TON",
];

function formatFiat(value: number, currency: TradingFiatCurrency): string {
  if (!Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "EUR" ? 2 : 2,
  });
}

function formatAmount(value: number, symbol: string): string {
  if (!Number.isFinite(value)) return `-- ${symbol}`;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${symbol}`;
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function resolveSettlementAssetSymbol(
  fiatCurrency: TradingFiatCurrency,
  tradingAssets: TradingAssetAvailability[]
): string {
  if (fiatCurrency === "EUR") {
    return "EUR";
  }

  const bySymbol = new Map(tradingAssets.map((asset) => [asset.symbol, asset]));
  const prioritized = USD_SETTLEMENT_PRIORITY
    .map((symbol) => bySymbol.get(symbol))
    .filter((asset): asset is TradingAssetAvailability => Boolean(asset))
    .sort((left, right) => right.freeValueUsd - left.freeValueUsd);

  return prioritized[0]?.symbol ?? "USDC";
}

function buildTradeAssetOptions(action: TradeAction, assets: Asset[]): TradeAssetOption[] {
  const cryptoAssets = assets
    .filter((asset) => !FIAT_SYMBOLS.has(asset.symbol))
    .map((asset) => ({
      symbol: asset.symbol,
      name: asset.name,
      balance: asset.balance,
      value: asset.value,
      owned: true,
    }));

  if (action === "sell") {
    return cryptoAssets
      .filter((asset) => asset.balance > 0)
      .sort((left, right) => right.value - left.value || left.symbol.localeCompare(right.symbol));
  }

  const seen = new Set<string>();
  const options: TradeAssetOption[] = [];

  for (const asset of cryptoAssets.sort((left, right) => right.value - left.value || left.symbol.localeCompare(right.symbol))) {
    seen.add(asset.symbol);
    options.push(asset);
  }

  for (const symbol of COMMON_BUY_SYMBOLS) {
    if (seen.has(symbol)) continue;
    options.push({
      symbol,
      name: symbol,
      balance: 0,
      value: 0,
      owned: false,
    });
  }

  return options;
}

function resolveAmountMode(action: TradeAction | null, entryMode: EntryMode): TradingAmountMode | null {
  if (!action) return null;
  if (action === "buy") {
    return entryMode === "crypto" ? "buying_asset" : "selling_asset";
  }
  return entryMode === "crypto" ? "selling_asset" : "buying_asset";
}

function labelForAmountMode(action: TradeAction, entryMode: EntryMode, symbol: string, fiatCurrency: TradingFiatCurrency): string {
  if (entryMode === "crypto") {
    return action === "buy" ? `Amount to receive in ${symbol}` : `Amount to sell in ${symbol}`;
  }
  return action === "buy" ? `Amount to spend in ${fiatCurrency}` : `Amount to receive in ${fiatCurrency}`;
}

function actionLabel(action: TradeAction | null): string {
  return action === "sell" ? "Sell" : "Buy";
}

export function PortfolioTradeDialogs({
  accountType,
  portfolioAssets,
  tradingAssets,
}: PortfolioTradeDialogsProps) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<TradeAction | null>(null);
  const [step, setStep] = useState<TradeStep>("asset");
  const [search, setSearch] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [exchange, setExchange] = useState<ExchangeId>("kraken");
  const [fiatCurrency, setFiatCurrency] = useState<TradingFiatCurrency>("USD");
  const [entryMode, setEntryMode] = useState<EntryMode>("fiat");
  const [amountInput, setAmountInput] = useState("");

  const deferredAmountInput = useDeferredValue(amountInput);
  const assetOptions = useMemo(
    () => (action ? buildTradeAssetOptions(action, portfolioAssets) : []),
    [action, portfolioAssets]
  );
  const filteredAssetOptions = useMemo(() => {
    const normalizedSearch = search.trim().toUpperCase();
    if (!normalizedSearch) return assetOptions;

    return assetOptions.filter(
      (asset) =>
        asset.symbol.includes(normalizedSearch) ||
        asset.name.toUpperCase().includes(normalizedSearch)
    );
  }, [assetOptions, search]);

  const selectedAsset = assetOptions.find((asset) => asset.symbol === selectedSymbol) ?? null;
  const settlementAssetSymbol = useMemo(
    () => resolveSettlementAssetSymbol(fiatCurrency, tradingAssets),
    [fiatCurrency, tradingAssets]
  );
  const settlementAssetAvailability =
    tradingAssets.find((asset) => asset.symbol === settlementAssetSymbol) ?? null;
  const selectedAssetAvailability =
    tradingAssets.find((asset) => asset.symbol === selectedSymbol) ?? null;
  const amountMode = resolveAmountMode(action, entryMode);
  const parsedAmount = Number(deferredAmountInput);
  const hasValidAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;

  const previewPayload = useMemo<TradingTransactionRequest | null>(() => {
    if (!action || !selectedSymbol || !amountMode || !hasValidAmount) {
      return null;
    }

    if (action === "buy") {
      return {
        accountType,
        buyingAsset: selectedSymbol,
        sellingAsset: settlementAssetSymbol,
        amountMode,
        amount: parsedAmount,
        exchange,
        fiatCurrency,
      };
    }

    return {
      accountType,
      buyingAsset: settlementAssetSymbol,
      sellingAsset: selectedSymbol,
      amountMode,
      amount: parsedAmount,
      exchange,
      fiatCurrency,
    };
  }, [accountType, action, amountMode, exchange, fiatCurrency, hasValidAmount, parsedAmount, selectedSymbol, settlementAssetSymbol]);

  const previewQuery = useQuery({
    queryKey: [
      "portfolio-trade-preview",
      accountType,
      action,
      selectedSymbol,
      settlementAssetSymbol,
      amountMode,
      exchange,
      fiatCurrency,
      deferredAmountInput,
    ],
    queryFn: () => backendApi.previewTrade(previewPayload as TradingTransactionRequest),
    enabled: step === "amount" && Boolean(previewPayload),
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const preview = previewQuery.data ?? null;
  const spendAvailability = action === "buy" ? settlementAssetAvailability : selectedAssetAvailability;

  const closeFlow = () => {
    setAction(null);
    setStep("asset");
    setSearch("");
    setSelectedSymbol("");
    setExchange("kraken");
    setFiatCurrency("USD");
    setEntryMode("fiat");
    setAmountInput("");
  };

  const openFlow = (nextAction: TradeAction) => {
    setAction(nextAction);
    setStep("asset");
    setSearch("");
    setSelectedSymbol("");
    setExchange("kraken");
    setFiatCurrency("USD");
    setEntryMode(nextAction === "buy" ? "fiat" : "crypto");
    setAmountInput("");
  };

  const executeMutation = useMutation({
    mutationFn: (payload: TradingTransactionRequest) => backendApi.executeTrade(payload),
    onSuccess: (response) => {
      toast.success(response.execution.message);
      closeFlow();
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", accountType] }),
        queryClient.invalidateQueries({ queryKey: ["trading-assets", accountType] }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["demo-account-settings"] }),
      ]);
    },
  });

  useEffect(() => {
    if (!action) return;
    if (action === "sell" && selectedSymbol && !assetOptions.some((asset) => asset.symbol === selectedSymbol)) {
      setSelectedSymbol("");
      setStep("asset");
    }
  }, [action, assetOptions, selectedSymbol]);

  const executeDisabled =
    !previewPayload ||
    !preview ||
    !preview.executable ||
    preview.blockingReasons.length > 0 ||
    previewQuery.isFetching ||
    executeMutation.isPending;

  return (
    <>
      <div className="grid grid-cols-2 divide-x divide-border overflow-hidden rounded-xl border border-border animate-fade-up">
          <Button
            type="button"
            onClick={() => openFlow("buy")}
            className="h-16 rounded-none border-0 bg-positive/14 font-mono text-base text-positive hover:bg-positive/20"
          >
            <TrendingUp className="h-4 w-4" />
            Buy
          </Button>
          <Button
            type="button"
            onClick={() => openFlow("sell")}
            className="h-16 rounded-none border-0 bg-negative/14 font-mono text-base text-negative hover:bg-negative/20"
          >
            <TrendingDown className="h-4 w-4" />
            Sell
          </Button>
      </div>

      <Dialog open={Boolean(action) && step === "asset"} onOpenChange={(open) => !open && closeFlow()}>
        <DialogContent className="max-w-2xl border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-mono text-xl">{actionLabel(action)} Crypto</DialogTitle>
            <DialogDescription>
              Pick the asset you want to {action === "sell" ? "sell from this portfolio" : "buy into this portfolio"}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by symbol or name"
            />

            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {filteredAssetOptions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-secondary/20 px-4 py-10 text-center text-sm text-muted-foreground">
                  {action === "sell"
                    ? "No sellable crypto assets are available in this portfolio."
                    : "No matching crypto assets were found."}
                </div>
              ) : (
                filteredAssetOptions.map((asset) => (
                  <button
                    key={asset.symbol}
                    type="button"
                    onClick={() => {
                      setSelectedSymbol(asset.symbol);
                      setAmountInput("");
                      setStep("amount");
                    }}
                    className="w-full rounded-xl border border-border bg-secondary/15 px-4 py-4 text-left transition-colors hover:border-primary/25 hover:bg-secondary/30"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-background/40">
                          <Coins className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <div className="text-sm font-mono font-semibold text-foreground">{asset.symbol}</div>
                          <div className="text-xs text-muted-foreground">{asset.name}</div>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-sm font-mono text-foreground">
                          {asset.owned ? formatAmount(asset.balance, asset.symbol) : "Not held yet"}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {asset.owned ? `Position ${formatFiat(asset.value, "USD")}` : "Available to add"}
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(action) && step === "amount"} onOpenChange={(open) => !open && closeFlow()}>
        <DialogContent className="max-w-3xl border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-mono text-xl">
              {actionLabel(action)} {selectedSymbol || "Asset"}
            </DialogTitle>
            <DialogDescription>
              Choose the exchange, quote fiat, and amount. Execution returns directly to the portfolio after confirmation.
            </DialogDescription>
          </DialogHeader>

          <div key={`${action}-${selectedSymbol}-${fiatCurrency}-${exchange}`} className="space-y-5 tab-panel-enter">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="ghost" size="sm" onClick={() => setStep("asset")}>
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/25 px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                {actionLabel(action)} {selectedSymbol}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Exchange</div>
                <Select value={exchange} onValueChange={(value) => setExchange(value as ExchangeId)}>
                  <SelectTrigger className="border-border bg-secondary/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXCHANGE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Fiat Quote</div>
                <Select value={fiatCurrency} onValueChange={(value) => setFiatCurrency(value as TradingFiatCurrency)}>
                  <SelectTrigger className="border-border bg-secondary/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIAT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-border bg-secondary/15 p-4">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Crypto</div>
                <div className="mt-2 text-lg font-mono font-semibold text-foreground">{selectedSymbol}</div>
                <div className="mt-1 text-xs text-muted-foreground">{selectedAsset?.name ?? selectedSymbol}</div>
              </div>
              <div className="rounded-lg border border-border bg-secondary/15 p-4">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Settlement</div>
                <div className="mt-2 text-lg font-mono font-semibold text-foreground">{settlementAssetSymbol}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {fiatCurrency} trades settle into {settlementAssetSymbol}.
                </div>
              </div>
              <div className="rounded-lg border border-border bg-secondary/15 p-4">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  {action === "buy" ? "Available To Spend" : "Available To Sell"}
                </div>
                <div className="mt-2 text-lg font-mono font-semibold text-foreground">
                  {spendAvailability
                    ? formatAmount(
                        spendAvailability.freeAmount,
                        action === "buy" ? settlementAssetSymbol : selectedSymbol
                      )
                    : `0 ${action === "buy" ? settlementAssetSymbol : selectedSymbol}`}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {action === "buy"
                    ? `Free balance outside active bots in ${settlementAssetSymbol}.`
                    : `Free balance outside active bots in ${selectedSymbol}.`}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-secondary/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Amount</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {labelForAmountMode(action ?? "buy", entryMode, selectedSymbol, fiatCurrency)}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEntryMode((current) => (current === "crypto" ? "fiat" : "crypto"))}
                  className="border-border bg-background/40"
                >
                  <ArrowLeftRight className="h-4 w-4" />
                  {entryMode === "crypto" ? `Switch to ${fiatCurrency}` : `Switch to ${selectedSymbol}`}
                </Button>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Input
                  value={amountInput}
                  onChange={(event) => setAmountInput(event.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="border-border bg-background/50 text-lg font-mono"
                />
                <div className="min-w-[84px] rounded-lg border border-border bg-background/40 px-3 py-2 text-center text-sm font-mono text-foreground">
                  {entryMode === "crypto" ? selectedSymbol : fiatCurrency}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Simulation</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {exchange === "crypto.com" ? "Crypto.com" : "Kraken"} {selectedSymbol}/{fiatCurrency}
                  </div>
                </div>
                {preview?.marketTimestamp ? (
                  <div className="text-[11px] font-mono text-muted-foreground">
                    Rate at {new Date(preview.marketTimestamp).toLocaleTimeString()}
                  </div>
                ) : null}
              </div>

              {!hasValidAmount ? (
                <div className="mt-4 rounded-lg border border-dashed border-border bg-secondary/20 px-4 py-8 text-center text-sm text-muted-foreground">
                  Enter an amount to load the simulated rate.
                </div>
              ) : previewQuery.isFetching ? (
                <div className="mt-4 rounded-lg border border-border bg-secondary/20 px-4 py-8 text-center text-sm text-muted-foreground">
                  Loading simulated rate...
                </div>
              ) : previewQuery.error ? (
                <div className="mt-4 rounded-lg border border-negative/40 bg-negative/10 px-4 py-4 text-sm text-negative">
                  {previewQuery.error instanceof Error ? previewQuery.error.message : "Unable to preview this trade."}
                </div>
              ) : preview ? (
                <div className="mt-4 space-y-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg border border-border bg-secondary/15 p-4">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Rate</div>
                      <div className="mt-2 text-lg font-mono font-semibold text-foreground">
                        {formatFiat(preview.priceInFiat, fiatCurrency)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">per {preview.tradedAssetSymbol}</div>
                    </div>
                    <div className="rounded-lg border border-border bg-secondary/15 p-4">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                        {action === "buy" ? "Estimated Receive" : "Estimated Proceeds"}
                      </div>
                      <div className="mt-2 text-lg font-mono font-semibold text-foreground">
                        {action === "buy"
                          ? formatAmount(preview.buyAmount, preview.buyingAsset.symbol)
                          : formatFiat(preview.buyWorthFiat, fiatCurrency)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {action === "buy"
                          ? formatFiat(preview.buyWorthFiat, fiatCurrency)
                          : formatAmount(preview.buyAmount, preview.buyingAsset.symbol)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-secondary/15 p-4">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                        {action === "buy" ? "Estimated Spend" : "Estimated Sell Size"}
                      </div>
                      <div className="mt-2 text-lg font-mono font-semibold text-foreground">
                        {action === "buy"
                          ? formatAmount(preview.sellAmount, preview.sellingAsset.symbol)
                          : formatAmount(preview.sellAmount, preview.sellingAsset.symbol)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        USD value {formatFiat(preview.buyWorthUsdt, "USD")}
                      </div>
                    </div>
                  </div>

                  {preview.warnings.length > 0 ? (
                    <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
                      {preview.warnings[0]}
                    </div>
                  ) : null}

                  {preview.blockingReasons.length > 0 ? (
                    <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
                      {preview.blockingReasons[0]}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter className="border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={closeFlow}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => previewPayload && executeMutation.mutate(previewPayload)}
              disabled={executeDisabled}
              className={cn(
                action === "buy"
                  ? "bg-positive text-background hover:bg-positive/90"
                  : "bg-negative text-background hover:bg-negative/90"
              )}
            >
              {executeMutation.isPending ? "Executing..." : `${actionLabel(action)} ${selectedSymbol}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

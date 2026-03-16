import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Lock } from "lucide-react";
import { SpinnerValue } from "@/components/SpinnerValue";
import { useDashboardData, useTradingPairPreview } from "@/hooks/useTradingData";
import { cn } from "@/lib/utils";
import type { PortfolioAccountType } from "@/types/api";

interface TradingPageProps {
  accountType: PortfolioAccountType;
}

type TradeSide = "Buy" | "Sell";
type TradeAmountMode = "base" | "quote" | "usd";

const COMMON_SYMBOL_SUGGESTIONS = [
  "BTC",
  "ETH",
  "BNB",
  "SOL",
  "XRP",
  "ADA",
  "DOGE",
  "AVAX",
  "LINK",
  "LTC",
  "BCH",
  "ETC",
  "UNI",
  "AAVE",
  "INJ",
  "NEAR",
  "HBAR",
  "SUI",
  "TON",
  "SHIB",
  "PEPE",
  "APT",
  "ARB",
  "OP",
  "SEI",
  "RUNE",
  "MATIC",
  "XLM",
  "ALGO",
  "TRX",
  "DOT",
  "ATOM",
  "USDT",
  "USDC",
  "FDUSD",
];

const COMMON_PAIR_PRESETS = [
  { base: "BTC", quote: "USDT" },
  { base: "BTC", quote: "USDC" },
  { base: "ETH", quote: "USDT" },
  { base: "ETH", quote: "USDC" },
  { base: "SOL", quote: "USDT" },
  { base: "BNB", quote: "USDT" },
  { base: "XRP", quote: "USDT" },
  { base: "ADA", quote: "USDT" },
  { base: "DOGE", quote: "USDT" },
  { base: "TON", quote: "USDT" },
  { base: "SUI", quote: "USDT" },
  { base: "BTC", quote: "ETH" },
  { base: "ETH", quote: "BTC" },
  { base: "SOL", quote: "BTC" },
  { base: "BNB", quote: "BTC" },
];

const QUOTE_PRIORITY = ["USDT", "USDC", "FDUSD", "BTC", "ETH", "BNB"];
const STABLE_SYMBOLS = new Set(["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "DAI"]);

function normalizeSymbolInput(value: string): string {
  return value.trim().toUpperCase();
}

function formatUsd(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatAssetAmount(value: number, symbol: string): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${symbol}`;
}

function formatPairPrice(value: number): string {
  if (!Number.isFinite(value)) return "--";

  if (value >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  if (value >= 1) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }

  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function pricingSourceLabel(source: "direct" | "inverse" | "usd_cross" | undefined): string {
  if (source === "direct") return "Direct market";
  if (source === "inverse") return "Reverse market";
  if (source === "usd_cross") return "USD cross";
  return "--";
}

export function TradingPage({ accountType }: TradingPageProps) {
  const { data, isPending, error } = useDashboardData(accountType);
  const isLoading = isPending && !data;

  const [side, setSide] = useState<TradeSide>("Buy");
  const [baseSymbolInput, setBaseSymbolInput] = useState("");
  const [quoteSymbolInput, setQuoteSymbolInput] = useState("");
  const [amountMode, setAmountMode] = useState<TradeAmountMode>("base");
  const [amountInput, setAmountInput] = useState("");

  const assets = data?.assets ?? [];

  const symbolSuggestions = useMemo(() => {
    return Array.from(new Set([...COMMON_SYMBOL_SUGGESTIONS, ...assets.map((asset) => asset.symbol.toUpperCase())])).sort((left, right) =>
      left.localeCompare(right)
    );
  }, [assets]);

  useEffect(() => {
    if (baseSymbolInput) {
      return;
    }

    const preferredBase =
      assets.find((asset) => !STABLE_SYMBOLS.has(asset.symbol.toUpperCase()))?.symbol ??
      symbolSuggestions.find((symbol) => !STABLE_SYMBOLS.has(symbol)) ??
      "BTC";
    setBaseSymbolInput(preferredBase);
  }, [assets, baseSymbolInput, symbolSuggestions]);

  useEffect(() => {
    if (quoteSymbolInput) {
      return;
    }

    const normalizedBase = normalizeSymbolInput(baseSymbolInput);
    const preferredQuote = [...QUOTE_PRIORITY, ...symbolSuggestions].find((symbol) => symbol !== normalizedBase) ?? "USDT";
    setQuoteSymbolInput(preferredQuote);
  }, [baseSymbolInput, quoteSymbolInput, symbolSuggestions]);

  const normalizedBaseSymbol = useMemo(() => normalizeSymbolInput(baseSymbolInput), [baseSymbolInput]);
  const normalizedQuoteSymbol = useMemo(() => normalizeSymbolInput(quoteSymbolInput), [quoteSymbolInput]);
  const deferredBaseSymbol = useDeferredValue(normalizedBaseSymbol);
  const deferredQuoteSymbol = useDeferredValue(normalizedQuoteSymbol);

  const invalidPairMessage = useMemo(() => {
    if (!normalizedBaseSymbol || !normalizedQuoteSymbol) {
      return "Enter both assets to preview a pair.";
    }

    if (!/^[A-Z0-9_-]{2,20}$/.test(normalizedBaseSymbol) || !/^[A-Z0-9_-]{2,20}$/.test(normalizedQuoteSymbol)) {
      return "Asset symbols must use 2-20 letters, numbers, underscores, or dashes.";
    }

    if (normalizedBaseSymbol === normalizedQuoteSymbol) {
      return "Base and quote assets must be different.";
    }

    return null;
  }, [normalizedBaseSymbol, normalizedQuoteSymbol]);

  const {
    data: pairPreviewData,
    isPending: loadingPairPreview,
    error: pairPreviewError,
  } = useTradingPairPreview(
    deferredBaseSymbol || undefined,
    deferredQuoteSymbol || undefined,
    accountType
  );

  const pair = pairPreviewData?.pair ?? null;
  const parsedAmount = Number(amountInput);
  const hasValidAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;

  const amountModeButtons = useMemo(
    () => [
      { id: "base" as const, label: normalizedBaseSymbol || "Base Asset" },
      { id: "quote" as const, label: normalizedQuoteSymbol || "Quote Asset" },
      { id: "usd" as const, label: "USD" },
    ],
    [normalizedBaseSymbol, normalizedQuoteSymbol]
  );

  const preview = useMemo(() => {
    if (!pair || !hasValidAmount || pair.basePriceUsd <= 0 || pair.quotePriceUsd <= 0 || pair.priceInQuote <= 0) {
      return null;
    }

    let baseAmount = 0;
    let quoteAmount = 0;
    let usdAmount = 0;

    if (amountMode === "base") {
      baseAmount = parsedAmount;
      quoteAmount = baseAmount * pair.priceInQuote;
      usdAmount = baseAmount * pair.basePriceUsd;
    } else if (amountMode === "quote") {
      quoteAmount = parsedAmount;
      baseAmount = quoteAmount / pair.priceInQuote;
      usdAmount = quoteAmount * pair.quotePriceUsd;
    } else {
      usdAmount = parsedAmount;
      baseAmount = usdAmount / pair.basePriceUsd;
      quoteAmount = usdAmount / pair.quotePriceUsd;
    }

    return {
      baseAmount,
      quoteAmount,
      usdAmount,
    };
  }, [amountMode, hasValidAmount, pair, parsedAmount]);

  const balanceRequirement = useMemo(() => {
    if (!pair || !preview) {
      return null;
    }

    if (side === "Buy") {
      return {
        label: `Required ${pair.quoteSymbol}`,
        required: preview.quoteAmount,
        available: pair.quoteBalance,
        symbol: pair.quoteSymbol,
      };
    }

    return {
      label: `Required ${pair.baseSymbol}`,
      required: preview.baseAmount,
      available: pair.baseBalance,
      symbol: pair.baseSymbol,
    };
  }, [pair, preview, side]);

  const insufficientBalance =
    balanceRequirement !== null && balanceRequirement.required > balanceRequirement.available + 0.00000001;

  const spendBalanceLabel = side === "Buy" ? `Available ${pair?.quoteSymbol ?? "quote"}` : `Available ${pair?.baseSymbol ?? "base"}`;
  const orderPreviewDisabled = isLoading || Boolean(invalidPairMessage) || !pair || !preview;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h2 className="text-lg md:text-xl font-mono font-semibold text-foreground">Trading</h2>
        <p className="text-sm text-muted-foreground mt-1">Flexible pair preview for spot trades across base, quote, or USD sizing.</p>
      </div>

      <datalist id="trade-symbol-suggestions">
        {symbolSuggestions.map((symbol) => (
          <option key={symbol} value={symbol} />
        ))}
      </datalist>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-lg border border-border bg-card p-5 space-y-4 animate-fade-up">
          <div className="flex gap-2">
            {(["Buy", "Sell"] as const).map((nextSide) => (
              <button
                key={nextSide}
                onClick={() => setSide(nextSide)}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2.5 text-sm font-mono uppercase tracking-wider transition-colors",
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

          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 items-end">
            <div>
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Base Asset</label>
              <input
                value={baseSymbolInput}
                onChange={(event) => setBaseSymbolInput(event.target.value)}
                list="trade-symbol-suggestions"
                spellCheck={false}
                placeholder="BTC"
                className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-3 text-sm font-mono uppercase text-foreground outline-none"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                setBaseSymbolInput(quoteSymbolInput);
                setQuoteSymbolInput(baseSymbolInput);
              }}
              className="h-11 w-11 rounded-md border border-border bg-secondary text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Swap base and quote assets"
            >
              <ArrowRightLeft className="mx-auto h-4 w-4" />
            </button>

            <div>
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Quote Asset</label>
              <input
                value={quoteSymbolInput}
                onChange={(event) => setQuoteSymbolInput(event.target.value)}
                list="trade-symbol-suggestions"
                spellCheck={false}
                placeholder="ETH"
                className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-3 text-sm font-mono uppercase text-foreground outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Quick Pairs</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {COMMON_PAIR_PRESETS.map((preset) => {
                const isActive = normalizedBaseSymbol === preset.base && normalizedQuoteSymbol === preset.quote;
                return (
                  <button
                    key={`${preset.base}-${preset.quote}`}
                    type="button"
                    onClick={() => {
                      setBaseSymbolInput(preset.base);
                      setQuoteSymbolInput(preset.quote);
                    }}
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-[11px] font-mono transition-colors",
                      isActive
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
                    )}
                  >
                    {preset.base}/{preset.quote}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Amount Mode</label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {amountModeButtons.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setAmountMode(mode.id)}
                  className={cn(
                    "rounded-md border px-3 py-2.5 text-sm font-mono uppercase tracking-wider transition-colors",
                    amountMode === mode.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Amount ({amountMode === "usd" ? "USD" : amountMode === "base" ? normalizedBaseSymbol || "base" : normalizedQuoteSymbol || "quote"})
              </label>
              <input
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                placeholder="0.00"
                className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-3 text-sm font-mono text-foreground outline-none"
              />
            </div>

            <div>
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Pair Price ({normalizedQuoteSymbol || "quote"} per {normalizedBaseSymbol || "base"})
              </label>
              <div className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-3 text-sm font-mono text-foreground">
                <SpinnerValue
                  loading={loadingPairPreview && !pair}
                  value={pair ? `${formatPairPrice(pair.priceInQuote)} ${pair.quoteSymbol}` : undefined}
                  placeholder="--"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-md border border-border bg-secondary/60 px-3 py-3">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Base Amount</div>
              <div className="mt-2 text-sm font-mono text-foreground">
                <SpinnerValue
                  loading={loadingPairPreview && !preview}
                  value={preview && pair ? formatAssetAmount(preview.baseAmount, pair.baseSymbol) : undefined}
                  placeholder="--"
                />
              </div>
            </div>
            <div className="rounded-md border border-border bg-secondary/60 px-3 py-3">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Quote Amount</div>
              <div className="mt-2 text-sm font-mono text-foreground">
                <SpinnerValue
                  loading={loadingPairPreview && !preview}
                  value={preview && pair ? formatAssetAmount(preview.quoteAmount, pair.quoteSymbol) : undefined}
                  placeholder="--"
                />
              </div>
            </div>
            <div className="rounded-md border border-border bg-secondary/60 px-3 py-3">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">USD Notional</div>
              <div className="mt-2 text-sm font-mono text-foreground">
                <SpinnerValue
                  loading={loadingPairPreview && !preview}
                  value={preview ? formatUsd(preview.usdAmount) : undefined}
                  placeholder="--"
                />
              </div>
            </div>
          </div>

          {invalidPairMessage ? (
            <div className="rounded-md border border-negative/30 bg-negative/10 p-3 text-xs text-negative">{invalidPairMessage}</div>
          ) : null}

          {pairPreviewError ? (
            <div className="rounded-md border border-negative/30 bg-negative/10 p-3 text-xs text-negative">
              {pairPreviewError instanceof Error ? pairPreviewError.message : "Unable to load pair preview."}
            </div>
          ) : null}

          {balanceRequirement ? (
            <div
              className={cn(
                "rounded-md border p-3 text-xs font-mono",
                insufficientBalance
                  ? "border-negative/30 bg-negative/10 text-negative"
                  : "border-border bg-secondary/50 text-muted-foreground"
              )}
            >
              {balanceRequirement.label}: {formatAssetAmount(balanceRequirement.required, balanceRequirement.symbol)}.
              Available: {formatAssetAmount(balanceRequirement.available, balanceRequirement.symbol)}.
            </div>
          ) : null}

          <button
            disabled={orderPreviewDisabled}
            className="w-full rounded-md bg-primary px-4 py-3.5 text-sm font-mono font-semibold uppercase tracking-wider text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
          >
            Preview {side} {normalizedBaseSymbol || "base"}/{normalizedQuoteSymbol || "quote"}
          </button>

          <p className="text-xs text-muted-foreground">
            Preview only. Live execution, order routing, and advanced order types are still inactive.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 space-y-4 animate-fade-up" style={{ animationDelay: "120ms" }}>
          <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Pair Overview</div>
          <div className="space-y-3 text-sm font-mono">
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
                      : accountType === "demo"
                        ? "Demo"
                        : "Offline"
                    : undefined
                }
                className={data?.connection.connected || accountType === "demo" ? "text-positive" : "text-muted-foreground"}
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Pair</span>
              <SpinnerValue
                loading={loadingPairPreview && !pair}
                value={pair ? `${pair.baseSymbol}/${pair.quoteSymbol}` : undefined}
                className="text-foreground"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Pricing</span>
              <SpinnerValue
                loading={loadingPairPreview && !pair}
                value={pair ? pricingSourceLabel(pair.pricingSource) : undefined}
                className="text-foreground"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{pair?.baseSymbol ?? "Base"} 24h</span>
              <SpinnerValue
                loading={loadingPairPreview && !pair}
                value={pair ? `${pair.baseChange24h >= 0 ? "+" : ""}${pair.baseChange24h}%` : undefined}
                className={cn(pair && pair.baseChange24h < 0 ? "text-negative" : "text-positive")}
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{pair?.quoteSymbol ?? "Quote"} 24h</span>
              <SpinnerValue
                loading={loadingPairPreview && !pair}
                value={pair ? `${pair.quoteChange24h >= 0 ? "+" : ""}${pair.quoteChange24h}%` : undefined}
                className={cn(pair && pair.quoteChange24h < 0 ? "text-negative" : "text-positive")}
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{pair?.baseSymbol ?? "Base"} Balance</span>
              <SpinnerValue
                loading={loadingPairPreview && !pair}
                value={pair ? formatAssetAmount(pair.baseBalance, pair.baseSymbol) : undefined}
                className="text-foreground"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{pair?.quoteSymbol ?? "Quote"} Balance</span>
              <SpinnerValue
                loading={loadingPairPreview && !pair}
                value={pair ? formatAssetAmount(pair.quoteBalance, pair.quoteSymbol) : undefined}
                className="text-foreground"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{spendBalanceLabel}</span>
              <SpinnerValue
                loading={loadingPairPreview && !pair}
                value={
                  pair
                    ? side === "Buy"
                      ? formatAssetAmount(pair.quoteBalance, pair.quoteSymbol)
                      : formatAssetAmount(pair.baseBalance, pair.baseSymbol)
                    : undefined
                }
                className="text-foreground"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{pair?.baseSymbol ?? "Base"} USD</span>
              <SpinnerValue
                loading={loadingPairPreview && !pair}
                value={pair ? formatUsd(pair.basePriceUsd) : undefined}
                className="text-foreground"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{pair?.quoteSymbol ?? "Quote"} USD</span>
              <SpinnerValue
                loading={loadingPairPreview && !pair}
                value={pair ? formatUsd(pair.quotePriceUsd) : undefined}
                className="text-foreground"
              />
            </div>
          </div>

          {error && !data ? (
            <div className="rounded-md border border-negative/30 bg-negative/10 p-3 text-xs text-negative">
              {error instanceof Error ? error.message : "Failed to load trading data."}
            </div>
          ) : null}

          <div className="rounded-md border border-border bg-secondary/50 p-3 text-xs text-muted-foreground">
            <div className="inline-flex items-center gap-1 font-mono uppercase tracking-wider">
              <Lock className="h-3.5 w-3.5" />
              Advanced Trading
            </div>
            <div className="mt-1">Pair preview now supports arbitrary symbols. Execution, TP/SL, and routing are still coming later.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

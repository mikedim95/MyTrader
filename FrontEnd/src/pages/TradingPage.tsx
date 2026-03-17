import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/sonner";
import { TradeComposerPanel } from "@/components/trading/TradeComposerPanel";
import { TradingContextPanel } from "@/components/trading/TradingContextPanel";
import { TradingPreviewPanel } from "@/components/trading/TradingPreviewPanel";
import {
  COMMON_SYMBOL_SUGGESTIONS,
  QUOTE_PRIORITY,
  STABLE_SYMBOLS,
  buildEmptyAvailability,
  normalizeSymbolInput,
  pickAlternateSymbol,
} from "@/components/trading/trading-utils";
import { useDashboardData, useTradingAssets, useTradingPairPreview } from "@/hooks/useTradingData";
import { backendApi } from "@/lib/api";
import type {
  Asset,
  DashboardResponse,
  PortfolioAccountType,
  TradeExecutionResponse,
  TradePreviewResponse,
  TradingAmountMode,
  TradingAssetAvailability,
  TradingTransactionRequest,
} from "@/types/api";

interface TradingPageProps {
  accountType: PortfolioAccountType;
}

interface LocalPreview {
  buyAmount: number;
  sellAmount: number;
  buyWorthUsdt: number;
}

function roundAmount(value: number, digits = 8): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildAssetAvailabilityFallback(assets: Asset[] | undefined): TradingAssetAvailability[] {
  return (assets ?? []).map((asset) => ({
    symbol: asset.symbol,
    name: asset.name,
    totalAmount: asset.balance,
    reservedAmount: 0,
    freeAmount: asset.balance,
    lockedAmount: 0,
    priceUsd: asset.price,
    totalValueUsd: asset.value,
    reservedValueUsd: 0,
    freeValueUsd: asset.value,
  }));
}

function updateTradingAssetAvailabilities(
  current: TradingAssetAvailability[] | undefined,
  response: TradeExecutionResponse
): TradingAssetAvailability[] | undefined {
  if (!current) return current;

  const map = new Map(current.map((asset) => [asset.symbol, { ...asset }]));
  const applyDelta = (symbol: string, delta: number, priceUsd: number, name: string) => {
    const existing = map.get(symbol) ?? buildEmptyAvailability(symbol, priceUsd);
    existing.name = existing.name || name;
    existing.priceUsd = Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : existing.priceUsd;
    existing.totalAmount = roundAmount(Math.max(0, existing.totalAmount + delta), 10);
    existing.freeAmount = roundAmount(Math.max(0, existing.freeAmount + delta), 10);
    existing.totalValueUsd = roundAmount(existing.totalAmount * existing.priceUsd, 2);
    existing.freeValueUsd = roundAmount(existing.freeAmount * existing.priceUsd, 2);
    existing.reservedValueUsd = roundAmount(existing.reservedAmount * existing.priceUsd, 2);
    map.set(symbol, existing);
  };

  applyDelta(
    response.preview.sellingAsset.symbol,
    -response.execution.executedSellAmount,
    response.preview.sellingAsset.priceUsd,
    response.preview.sellingAsset.name
  );
  applyDelta(
    response.preview.buyingAsset.symbol,
    response.execution.executedBuyAmount,
    response.preview.buyingAsset.priceUsd,
    response.preview.buyingAsset.name
  );

  return Array.from(map.values())
    .filter((asset) => asset.totalAmount > 0.0000000001 || asset.reservedAmount > 0.0000000001)
    .sort((left, right) => right.freeValueUsd - left.freeValueUsd || left.symbol.localeCompare(right.symbol));
}

function updateDashboardSnapshot(
  current: DashboardResponse | undefined,
  response: TradeExecutionResponse
): DashboardResponse | undefined {
  if (!current) return current;

  const map = new Map(current.assets.map((asset) => [asset.symbol, { ...asset }]));
  const applyDelta = (symbol: string, delta: number, priceUsd: number, fallbackName: string) => {
    const existing = map.get(symbol) ?? {
      id: symbol.toLowerCase(),
      symbol,
      name: fallbackName,
      price: priceUsd,
      change24h: 0,
      volume24h: 0,
      marketCap: 0,
      balance: 0,
      value: 0,
      allocation: 0,
      targetAllocation: 0,
      sparkline: Array.from({ length: 24 }, () => roundAmount(priceUsd, 2)),
      sparklinePeriod: "24h" as const,
    };

    existing.price = Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : existing.price;
    existing.balance = roundAmount(Math.max(0, existing.balance + delta), 10);
    existing.value = roundAmount(existing.balance * existing.price, 2);
    if (!existing.sparkline.length) {
      existing.sparkline = Array.from({ length: 24 }, () => existing.value);
    }
    map.set(symbol, existing);
  };

  applyDelta(
    response.preview.sellingAsset.symbol,
    -response.execution.executedSellAmount,
    response.preview.sellingAsset.priceUsd,
    response.preview.sellingAsset.name
  );
  applyDelta(
    response.preview.buyingAsset.symbol,
    response.execution.executedBuyAmount,
    response.preview.buyingAsset.priceUsd,
    response.preview.buyingAsset.name
  );

  const assets = Array.from(map.values())
    .filter((asset) => asset.balance > 0.0000000001)
    .sort((left, right) => right.value - left.value);
  const totalPortfolioValue = roundAmount(assets.reduce((sum, asset) => sum + asset.value, 0), 2);
  const baselineValue = current.totalPortfolioValue - current.portfolioChange24hValue;
  const portfolioChange24hValue = roundAmount(totalPortfolioValue - baselineValue, 2);
  const portfolioChange24h =
    baselineValue > 0 ? roundAmount((portfolioChange24hValue / baselineValue) * 100, 2) : current.portfolioChange24h;

  const nextAssets = assets.map((asset) => ({
    ...asset,
    allocation: totalPortfolioValue > 0 ? roundAmount((asset.value / totalPortfolioValue) * 100, 2) : 0,
  }));

  const portfolioHistory =
    current.portfolioHistory.length > 0
      ? current.portfolioHistory.map((point, index) =>
          index === current.portfolioHistory.length - 1 ? { ...point, value: totalPortfolioValue } : point
        )
      : current.portfolioHistory;

  return {
    ...current,
    assets: nextAssets,
    totalPortfolioValue,
    portfolioChange24hValue,
    portfolioChange24h,
    portfolioHistory,
  };
}

export function TradingPage({ accountType }: TradingPageProps) {
  const queryClient = useQueryClient();
  const { data: dashboardData, isPending: dashboardPending, error: dashboardError } = useDashboardData(accountType);
  const { data: tradingAssetsData, isPending: tradingAssetsPending, error: tradingAssetsError } = useTradingAssets(accountType);

  const [buyingAssetInput, setBuyingAssetInput] = useState("");
  const [sellingAssetInput, setSellingAssetInput] = useState("");
  const [amountMode, setAmountMode] = useState<TradingAmountMode>("selling_asset");
  const [amountInput, setAmountInput] = useState("");
  const [serverPreview, setServerPreview] = useState<TradePreviewResponse | null>(null);
  const [executionResult, setExecutionResult] = useState<TradeExecutionResponse | null>(null);

  const fallbackAssetAvailabilities = useMemo(
    () => buildAssetAvailabilityFallback(dashboardData?.assets),
    [dashboardData?.assets]
  );
  const assetAvailabilities = useMemo(
    () => (tradingAssetsData?.assets && tradingAssetsData.assets.length > 0 ? tradingAssetsData.assets : fallbackAssetAvailabilities),
    [fallbackAssetAvailabilities, tradingAssetsData?.assets]
  );
  const symbolSuggestions = useMemo(
    () => Array.from(new Set([...COMMON_SYMBOL_SUGGESTIONS, ...assetAvailabilities.map((asset) => asset.symbol)])).sort((a, b) => a.localeCompare(b)),
    [assetAvailabilities]
  );

  const normalizedBuyingAsset = useMemo(() => normalizeSymbolInput(buyingAssetInput), [buyingAssetInput]);
  const normalizedSellingAsset = useMemo(() => normalizeSymbolInput(sellingAssetInput), [sellingAssetInput]);
  const deferredBuyingAsset = useDeferredValue(normalizedBuyingAsset);
  const deferredSellingAsset = useDeferredValue(normalizedSellingAsset);

  const buyingOptions = useMemo(
    () => symbolSuggestions.filter((symbol) => symbol !== normalizedSellingAsset || symbol === normalizedBuyingAsset),
    [normalizedBuyingAsset, normalizedSellingAsset, symbolSuggestions]
  );
  const sellingOptions = useMemo(
    () => symbolSuggestions.filter((symbol) => symbol !== normalizedBuyingAsset || symbol === normalizedSellingAsset),
    [normalizedBuyingAsset, normalizedSellingAsset, symbolSuggestions]
  );

  useEffect(() => {
    if (buyingAssetInput) return;
    const preferredBuying =
      assetAvailabilities.find((asset) => !STABLE_SYMBOLS.has(asset.symbol))?.symbol ??
      symbolSuggestions.find((symbol) => !STABLE_SYMBOLS.has(symbol)) ??
      "BTC";
    setBuyingAssetInput(preferredBuying);
  }, [assetAvailabilities, buyingAssetInput, symbolSuggestions]);

  useEffect(() => {
    if (sellingAssetInput) return;
    const preferredSelling =
      assetAvailabilities.find((asset) => STABLE_SYMBOLS.has(asset.symbol) && asset.freeAmount > 0 && asset.symbol !== normalizedBuyingAsset)?.symbol ??
      assetAvailabilities.find((asset) => asset.freeAmount > 0 && asset.symbol !== normalizedBuyingAsset)?.symbol ??
      [...QUOTE_PRIORITY, ...symbolSuggestions].find((symbol) => symbol !== normalizedBuyingAsset) ??
      "USDT";
    setSellingAssetInput(preferredSelling);
  }, [assetAvailabilities, normalizedBuyingAsset, sellingAssetInput, symbolSuggestions]);

  useEffect(() => {
    if (!normalizedBuyingAsset || !normalizedSellingAsset || normalizedBuyingAsset !== normalizedSellingAsset) return;
    setSellingAssetInput(pickAlternateSymbol(normalizedSellingAsset, normalizedBuyingAsset, [...QUOTE_PRIORITY, ...symbolSuggestions]));
  }, [normalizedBuyingAsset, normalizedSellingAsset, symbolSuggestions]);

  useEffect(() => {
    setServerPreview(null);
    setExecutionResult(null);
  }, [accountType, normalizedBuyingAsset, normalizedSellingAsset, amountMode, amountInput]);

  const invalidPairMessage = useMemo(() => {
    if (!normalizedBuyingAsset || !normalizedSellingAsset) return "Choose both a buying asset and a selling asset.";
    if (!/^[A-Z0-9_-]{2,20}$/.test(normalizedBuyingAsset) || !/^[A-Z0-9_-]{2,20}$/.test(normalizedSellingAsset)) {
      return "Asset symbols must use 2-20 letters, numbers, underscores, or dashes.";
    }
    if (normalizedBuyingAsset === normalizedSellingAsset) return "Buying asset and selling asset must be different.";
    return null;
  }, [normalizedBuyingAsset, normalizedSellingAsset]);

  const { data: pairPreviewData, isPending: loadingPairPreview, error: pairPreviewError } = useTradingPairPreview(
    deferredBuyingAsset || undefined,
    deferredSellingAsset || undefined,
    accountType
  );

  const pair = pairPreviewData?.pair ?? null;
  const parsedAmount = Number(amountInput);
  const hasValidAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;

  const amountModeButtons = useMemo(
    () => [
      { id: "selling_asset" as const, label: normalizedSellingAsset || "Selling asset" },
      { id: "buying_asset" as const, label: normalizedBuyingAsset || "Buying asset" },
      { id: "buying_asset_usdt" as const, label: "Buy worth in USDT" },
    ],
    [normalizedBuyingAsset, normalizedSellingAsset]
  );

  const localPreview = useMemo<LocalPreview | null>(() => {
    if (!pair || !hasValidAmount || pair.basePriceUsd <= 0 || pair.quotePriceUsd <= 0 || pair.priceInQuote <= 0) return null;
    if (amountMode === "selling_asset") {
      const sellAmount = parsedAmount;
      const buyAmount = sellAmount / pair.priceInQuote;
      return { sellAmount, buyAmount, buyWorthUsdt: buyAmount * pair.basePriceUsd };
    }
    if (amountMode === "buying_asset") {
      const buyAmount = parsedAmount;
      const sellAmount = buyAmount * pair.priceInQuote;
      return { sellAmount, buyAmount, buyWorthUsdt: buyAmount * pair.basePriceUsd };
    }
    const buyWorthUsdt = parsedAmount;
    const buyAmount = buyWorthUsdt / pair.basePriceUsd;
    return { sellAmount: buyAmount * pair.priceInQuote, buyAmount, buyWorthUsdt };
  }, [amountMode, hasValidAmount, pair, parsedAmount]);

  const buyingAvailability = useMemo(() => {
    if (!normalizedBuyingAsset) return null;
    return (
      assetAvailabilities.find((asset) => asset.symbol === normalizedBuyingAsset) ??
      (pair && pair.baseSymbol === normalizedBuyingAsset
        ? {
            symbol: normalizedBuyingAsset,
            name: pair.baseName,
            totalAmount: pair.baseBalance,
            reservedAmount: pair.baseReservedBalance ?? 0,
            freeAmount: pair.baseFreeBalance ?? pair.baseBalance,
            lockedAmount: pair.baseLockedBalance ?? 0,
            priceUsd: pair.basePriceUsd,
            totalValueUsd: pair.baseBalance * pair.basePriceUsd,
            reservedValueUsd: (pair.baseReservedBalance ?? 0) * pair.basePriceUsd,
            freeValueUsd: (pair.baseFreeBalance ?? pair.baseBalance) * pair.basePriceUsd,
          }
        : buildEmptyAvailability(normalizedBuyingAsset))
    );
  }, [assetAvailabilities, normalizedBuyingAsset, pair]);

  const sellingAvailability = useMemo(() => {
    if (!normalizedSellingAsset) return null;
    return (
      assetAvailabilities.find((asset) => asset.symbol === normalizedSellingAsset) ??
      (pair && pair.quoteSymbol === normalizedSellingAsset
        ? {
            symbol: normalizedSellingAsset,
            name: pair.quoteName,
            totalAmount: pair.quoteBalance,
            reservedAmount: pair.quoteReservedBalance ?? 0,
            freeAmount: pair.quoteFreeBalance ?? pair.quoteBalance,
            lockedAmount: pair.quoteLockedBalance ?? 0,
            priceUsd: pair.quotePriceUsd,
            totalValueUsd: pair.quoteBalance * pair.quotePriceUsd,
            reservedValueUsd: (pair.quoteReservedBalance ?? 0) * pair.quotePriceUsd,
            freeValueUsd: (pair.quoteFreeBalance ?? pair.quoteBalance) * pair.quotePriceUsd,
          }
        : buildEmptyAvailability(normalizedSellingAsset))
    );
  }, [assetAvailabilities, normalizedSellingAsset, pair]);

  const insufficientFreeBalance = Boolean(localPreview && sellingAvailability && localPreview.sellAmount > sellingAvailability.freeAmount + 0.00000001);
  const localBalanceMessage =
    localPreview && sellingAvailability && insufficientFreeBalance
      ? `Requires ${localPreview.sellAmount.toFixed(8)} ${sellingAvailability.symbol} but only ${sellingAvailability.freeAmount.toFixed(8)} is free outside rebalance allocations.`
      : null;

  const previewPayload = useMemo<TradingTransactionRequest | null>(() => {
    if (!normalizedBuyingAsset || !normalizedSellingAsset || !hasValidAmount) return null;
    return {
      accountType,
      buyingAsset: normalizedBuyingAsset,
      sellingAsset: normalizedSellingAsset,
      amountMode,
      amount: parsedAmount,
    };
  }, [accountType, amountMode, hasValidAmount, normalizedBuyingAsset, normalizedSellingAsset, parsedAmount]);

  const previewMutation = useMutation({
    mutationFn: (payload: TradingTransactionRequest) => backendApi.previewTrade(payload),
    onSuccess: (response) => {
      setServerPreview(response);
      setExecutionResult(null);
    },
  });

  const executeMutation = useMutation({
    mutationFn: (payload: TradingTransactionRequest) => backendApi.executeTrade(payload),
    onSuccess: (response) => {
      setExecutionResult(response);
      setServerPreview(response.preview);
      if (accountType === "demo") {
        queryClient.setQueryData<DashboardResponse | undefined>(["dashboard", accountType], (current) =>
          updateDashboardSnapshot(current, response)
        );
        queryClient.setQueryData<{
          accountType: PortfolioAccountType;
          assets: TradingAssetAvailability[];
          generatedAt: string;
        } | undefined>(["trading-assets", accountType], (current) =>
          current
            ? {
                ...current,
                assets: updateTradingAssetAvailabilities(current.assets, response) ?? current.assets,
                generatedAt: new Date().toISOString(),
              }
            : current
        );
      }
      toast.success(response.execution.message);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", accountType] }),
        queryClient.invalidateQueries({ queryKey: ["trading-assets", accountType] }),
        queryClient.invalidateQueries({ queryKey: ["trading-pair-preview", normalizedBuyingAsset, normalizedSellingAsset, accountType] }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["decision-intelligence", accountType] }),
        queryClient.invalidateQueries({ queryKey: ["demo-account-settings"] }),
      ]);
    },
  });

  const previewResponse = executionResult?.preview ?? serverPreview;
  const previewDisabled = Boolean(invalidPairMessage) || !previewPayload || !localPreview || previewMutation.isPending || executeMutation.isPending;
  const executeDisabled = previewDisabled || pair?.executable === false || insufficientFreeBalance;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h2 className="text-lg md:text-xl font-mono font-semibold text-foreground">Trading</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Choose the asset you are buying, the asset you are selling, and size the conversion from the sell side, buy side, or buy-side USDT worth.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.9fr)] gap-4">
        <TradeComposerPanel
          buyingAssetInput={buyingAssetInput}
          sellingAssetInput={sellingAssetInput}
          buyingOptions={buyingOptions}
          sellingOptions={sellingOptions}
          assetAvailabilities={assetAvailabilities}
          normalizedBuyingAsset={normalizedBuyingAsset}
          normalizedSellingAsset={normalizedSellingAsset}
          amountMode={amountMode}
          amountModeButtons={amountModeButtons}
          amountInput={amountInput}
          pair={pair}
          localPreview={localPreview}
          loadingPairPreview={loadingPairPreview}
          invalidPairMessage={invalidPairMessage}
          pairErrorMessage={pairPreviewError instanceof Error ? pairPreviewError.message : null}
          tradingAssetsErrorMessage={
            tradingAssetsError instanceof Error && assetAvailabilities.length === 0 ? tradingAssetsError.message : null
          }
          localBalanceMessage={localBalanceMessage}
          insufficientFreeBalance={insufficientFreeBalance}
          previewDisabled={previewDisabled}
          executeDisabled={executeDisabled}
          previewPending={previewMutation.isPending}
          executePending={executeMutation.isPending}
          onBuyingAssetChange={(nextBuying) => {
            setBuyingAssetInput(nextBuying);
            if (nextBuying === normalizedSellingAsset) {
              setSellingAssetInput(pickAlternateSymbol(normalizedSellingAsset, nextBuying, [...QUOTE_PRIORITY, ...symbolSuggestions]));
            }
          }}
          onSellingAssetChange={(nextSelling) => {
            setSellingAssetInput(nextSelling);
            if (nextSelling === normalizedBuyingAsset) {
              setBuyingAssetInput(pickAlternateSymbol(normalizedBuyingAsset, nextSelling, symbolSuggestions, "BTC"));
            }
          }}
          onSwapAssets={() => {
            if (!normalizedBuyingAsset || !normalizedSellingAsset) return;
            setBuyingAssetInput(normalizedSellingAsset);
            setSellingAssetInput(normalizedBuyingAsset);
          }}
          onAmountModeChange={setAmountMode}
          onAmountInputChange={setAmountInput}
          onPreview={() => previewPayload && previewMutation.mutate(previewPayload)}
          onExecute={() => previewPayload && executeMutation.mutate(previewPayload)}
        />

        <TradingContextPanel
          connection={dashboardData?.connection}
          accountType={accountType}
          loadingConnection={dashboardPending && !dashboardData}
          pair={pair}
          loadingPairPreview={loadingPairPreview}
          buyingAvailability={buyingAvailability}
          sellingAvailability={sellingAvailability}
          assetAvailabilities={assetAvailabilities}
          assetsPending={tradingAssetsPending}
          dashboardErrorMessage={dashboardError instanceof Error ? dashboardError.message : null}
        />
      </div>

      {(previewMutation.error || executeMutation.error) && !previewResponse ? (
        <div className="rounded-md border border-negative/30 bg-negative/10 p-3 text-xs text-negative">
          {(executeMutation.error ?? previewMutation.error) instanceof Error
            ? ((executeMutation.error ?? previewMutation.error) as Error).message
            : "Trading request failed."}
        </div>
      ) : null}

      <TradingPreviewPanel preview={previewResponse} executionResult={executionResult} />
    </div>
  );
}

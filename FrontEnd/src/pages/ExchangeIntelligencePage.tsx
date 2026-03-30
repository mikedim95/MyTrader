import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { AssetDetailsDialog } from "@/components/AssetDetailsDialog";
import { ExchangeHealthCard } from "@/components/exchange-intelligence/ExchangeHealthCard";
import { ComparisonTable, type ExchangeComparisonRow } from "@/components/exchange-intelligence/ComparisonTable";
import { PairSelector } from "@/components/exchange-intelligence/PairSelector";
import { RecommendationBox } from "@/components/exchange-intelligence/RecommendationBox";
import { HoldingsTable } from "@/components/portfolio/HoldingsTable";
import {
  useDashboardData,
  useExchangeComparison,
  useExchangeHealth,
  useExchangeOrderBookSummary,
  useExchangePairs,
  useExchangeTicker,
  useTradingAssets,
} from "@/hooks/useTradingData";
import type { Asset, ExchangeId, ExchangeMarketSymbol, PortfolioAccountType } from "@/types/api";

const FALLBACK_PAIRS: ExchangeMarketSymbol[] = ["BTC-USD", "ETH-USD", "BTC-EUR", "ETH-EUR"];
const EXCHANGES: ExchangeId[] = ["kraken", "coinbase", "crypto.com"];
const DEFAULT_SYMBOL: ExchangeMarketSymbol = "BTC-USD";
const ORDER_BOOK_DEPTH = 10;

interface ExchangeIntelligencePageProps {
  accountType: PortfolioAccountType;
  embedded?: boolean;
}

export function ExchangeIntelligencePage({ accountType, embedded = false }: ExchangeIntelligencePageProps) {
  const [selectedSymbol, setSelectedSymbol] = useState<ExchangeMarketSymbol>(DEFAULT_SYMBOL);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

  const { data: healthData, isPending: loadingHealth, error: healthError } = useExchangeHealth();
  const { data: portfolioData, isPending: loadingPortfolio } = useDashboardData(accountType);
  const { data: pairsData } = useExchangePairs();
  const { data: tickerData, isPending: loadingTicker, error: tickerError } = useExchangeTicker(selectedSymbol);
  const { data: orderBookData, isPending: loadingOrderBook, error: orderBookError } = useExchangeOrderBookSummary(
    selectedSymbol,
    ORDER_BOOK_DEPTH,
  );
  const { data: comparisonData, isPending: loadingComparison, error: comparisonError } = useExchangeComparison(selectedSymbol);
  const { data: tradingAssetsData } = useTradingAssets(accountType);

  const pairs = pairsData?.pairs?.length ? pairsData.pairs : FALLBACK_PAIRS;
  const assets = portfolioData?.assets ?? [];
  const tradingAssets = tradingAssetsData?.assets ?? [];

  useEffect(() => {
    if (!pairs.includes(selectedSymbol)) {
      setSelectedSymbol(pairs[0] ?? DEFAULT_SYMBOL);
    }
  }, [pairs, selectedSymbol]);

  const comparisonRows = useMemo<ExchangeComparisonRow[]>(() => {
    const tickerMap = new Map((tickerData?.exchanges ?? []).map((entry) => [entry.exchange, entry]));
    const orderBookMap = new Map((orderBookData?.exchanges ?? []).map((entry) => [entry.exchange, entry]));

    return EXCHANGES.map((exchange) => {
      const ticker = tickerMap.get(exchange);
      const orderBook = orderBookMap.get(exchange);

      return {
        exchange,
        last: ticker?.last ?? null,
        bestBid: ticker?.bid ?? orderBook?.bestBid ?? null,
        bestAsk: ticker?.ask ?? orderBook?.bestAsk ?? null,
        spreadPercent: ticker?.spreadPercent ?? orderBook?.spreadPercent ?? null,
        topBidVolume: orderBook?.topBidVolume ?? null,
        topAskVolume: orderBook?.topAskVolume ?? null,
        totalBidVolumeTopN: orderBook?.totalBidVolumeTopN ?? null,
        totalAskVolumeTopN: orderBook?.totalAskVolumeTopN ?? null,
        timestamp: ticker?.timestamp ?? orderBook?.timestamp ?? null,
      };
    });
  }, [orderBookData?.exchanges, tickerData?.exchanges]);

  const activeError = comparisonError ?? orderBookError ?? tickerError ?? healthError;
  const loadingTable = loadingTicker || loadingOrderBook;

  return (
    <div className="space-y-6 p-4 md:p-6">
      {embedded ? null : (
        <div>
          <h2 className="text-lg md:text-xl font-mono font-semibold text-foreground">Exchange Intelligence</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Read-only venue comparison across Kraken, Coinbase, and Crypto.com with normalized pricing and liquidity snapshots.
          </p>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <PairSelector pairs={pairs} selectedSymbol={selectedSymbol} onChange={setSelectedSymbol} />
          <RecommendationBox
            symbol={selectedSymbol}
            bestBuy={comparisonData?.bestBuy ?? null}
            bestSell={comparisonData?.bestSell ?? null}
            isLoading={loadingComparison}
          />
        </div>

        <ExchangeHealthCard exchanges={healthData?.exchanges ?? []} isLoading={loadingHealth && !(healthData?.exchanges?.length ?? 0)} />
      </div>

      {activeError ? (
        <div className="rounded-lg border border-negative/40 bg-negative/10 p-4 text-sm text-negative animate-fade-up">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <div>{activeError instanceof Error ? activeError.message : "Exchange intelligence data could not be loaded."}</div>
          </div>
        </div>
      ) : null}

      <ComparisonTable symbol={selectedSymbol} depth={ORDER_BOOK_DEPTH} rows={comparisonRows} isLoading={loadingTable} />

      <HoldingsTable
        accountType={accountType}
        assets={assets}
        description="Portfolio holdings now live in the market tab so your venue comparison and current exposure stay in one place."
        isLoading={loadingPortfolio && !portfolioData}
        onSelectAsset={setSelectedAsset}
      />

      <div className="rounded-lg border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
        Public endpoints only. No API keys, no trading actions, and no exchange-specific payloads reach the frontend.
      </div>

      <AssetDetailsDialog
        asset={selectedAsset}
        open={Boolean(selectedAsset)}
        accountType={accountType}
        portfolioTotalValue={portfolioData?.totalPortfolioValue ?? 0}
        tradingAssets={tradingAssets}
        recentActivity={portfolioData?.recentActivity ?? []}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedAsset(null);
          }
        }}
      />
    </div>
  );
}

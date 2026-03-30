import { useEffect, useMemo, useState } from "react";
import { Bot, CircleDot, MoreHorizontal, PieChart as PieChartIcon, Wallet } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { AssetDetailsDialog } from "@/components/AssetDetailsDialog";
import { PortfolioConnectionsPanel } from "@/components/portfolio/PortfolioConnectionsPanel";
import { PortfolioTradeDialogs } from "@/components/portfolio/PortfolioTradeDialogs";
import { SpinnerValue } from "@/components/SpinnerValue";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBotProfiles, useDashboardData, useTradingAssets } from "@/hooks/useTradingData";
import { cn } from "@/lib/utils";
import type { Asset, BotProfile, PortfolioAccountType, TradingAssetAvailability } from "@/types/api";

interface PortfolioPageProps {
  accountType: PortfolioAccountType;
  onOpenExchangeConnections?: () => void;
  onOpenExchangeMarket?: () => void;
  onSelectAsset?: (asset: Asset) => void;
}

interface AllocationBucketAsset {
  asset: Asset | null;
  symbol: string;
  name: string;
  quantity: number;
  price: number;
  value: number;
  bucketAllocation: number;
  portfolioAllocation: number;
}

interface AllocationBucket {
  id: string;
  name: string;
  kind: "direct" | "bot";
  value: number;
  allocation: number;
  color: string;
  description: string;
  assets: AllocationBucketAsset[];
}

interface AllocationAssetSegment {
  id: string;
  bucketId: string;
  bucketName: string;
  bucketKind: AllocationBucket["kind"];
  asset: Asset | null;
  symbol: string;
  name: string;
  value: number;
  bucketAllocation: number;
  portfolioAllocation: number;
  color: string;
}

const EMPTY_ASSETS: Asset[] = [];
const EMPTY_BOT_PROFILES: BotProfile[] = [];
const EMPTY_TRADING_ASSETS: TradingAssetAvailability[] = [];
const STABLE_COINS = new Set(["USDC", "USDT", "BUSD", "FDUSD", "TUSD", "DAI"]);
const BUCKET_COLORS = [
  "hsl(168, 100%, 48%)",
  "hsl(340, 100%, 62%)",
  "hsl(230, 72%, 62%)",
  "hsl(42, 100%, 62%)",
  "hsl(196, 100%, 48%)",
  "hsl(280, 70%, 64%)",
  "hsl(120, 65%, 45%)",
];

function roundAmount(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatUsd(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatQuantity(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function assetColorFromSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  const hash = Array.from(normalized).reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0);
  const hue = hash % 360;
  const saturation = 68 + (hash % 16);
  const lightness = 54 + (hash % 8);
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function buildTradingAssetAvailabilityFallback(assets: Asset[]): TradingAssetAvailability[] {
  return assets.map((asset) => ({
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

function buildAllocationBuckets(
  accountType: PortfolioAccountType,
  assets: Asset[],
  profiles: BotProfile[]
): AllocationBucket[] {
  const totalValue = assets.reduce((sum, asset) => sum + asset.value, 0);
  const assetBySymbol = new Map(assets.map((asset) => [asset.symbol.toUpperCase(), asset]));

  if (totalValue <= 0) {
    return [];
  }

  if (accountType !== "demo") {
    const directAssets = assets
      .map<AllocationBucketAsset>((asset) => ({
        asset,
        symbol: asset.symbol,
        name: asset.name,
        quantity: asset.balance,
        price: asset.price,
        value: asset.value,
        bucketAllocation: asset.allocation,
        portfolioAllocation: asset.allocation,
      }))
      .sort((left, right) => right.value - left.value);

    return [
      {
        id: "live-overview",
        name: "Direct Holdings",
        kind: "direct",
        value: roundAmount(totalValue, 2),
        allocation: 100,
        color: BUCKET_COLORS[0],
        description: "All visible holdings are currently outside bot-managed demo buckets.",
        assets: directAssets,
      },
    ];
  }

  const activeProfiles = profiles.filter((profile) => profile.isEnabled);
  const botQuantityBySymbol = new Map<string, number>();

  const botBuckets = activeProfiles.map((profile, index) => {
    const rawAssets = profile.holdings
      .map((holding) => {
        const symbol = holding.symbol.trim().toUpperCase();
        if (!symbol || holding.quantity <= 0) return null;

        const linkedAsset = assetBySymbol.get(symbol) ?? null;
        const price = linkedAsset?.price ?? (STABLE_COINS.has(symbol) ? 1 : 0);
        const value = roundAmount(holding.quantity * price, 2);

        botQuantityBySymbol.set(symbol, roundAmount((botQuantityBySymbol.get(symbol) ?? 0) + holding.quantity, 10));

        return {
          asset: linkedAsset,
          symbol,
          name: linkedAsset?.name ?? symbol,
          quantity: roundAmount(holding.quantity, 10),
          price,
          value,
          bucketAllocation: 0,
          portfolioAllocation: totalValue > 0 ? roundAmount((value / totalValue) * 100, 2) : 0,
        } satisfies AllocationBucketAsset;
      })
      .filter((entry): entry is AllocationBucketAsset => entry !== null);

    const bucketValue = roundAmount(rawAssets.reduce((sum, entry) => sum + entry.value, 0), 2);
    const bucketAssets = rawAssets
      .map((entry) => ({
        ...entry,
        bucketAllocation: bucketValue > 0 ? roundAmount((entry.value / bucketValue) * 100, 2) : 0,
      }))
      .sort((left, right) => right.value - left.value);

    return {
      id: profile.id,
      name: profile.name,
      kind: "bot" as const,
      value: bucketValue,
      allocation: totalValue > 0 ? roundAmount((bucketValue / totalValue) * 100, 2) : 0,
      color: BUCKET_COLORS[index % BUCKET_COLORS.length],
      description:
        profile.description?.trim() ||
        `Managed by bot capital ${formatUsd(profile.allocatedCapital)} in ${profile.baseCurrency.toUpperCase()}.`,
      assets: bucketAssets,
    };
  });

  const directAssets = assets
    .map<AllocationBucketAsset | null>((asset) => {
      const symbol = asset.symbol.toUpperCase();
      const allocatedQuantity = botQuantityBySymbol.get(symbol) ?? 0;
      const freeQuantity = Math.max(0, roundAmount(asset.balance - allocatedQuantity, 10));
      const freeValue = roundAmount(freeQuantity * asset.price, 2);

      if (freeQuantity <= 0 && freeValue <= 0) {
        return null;
      }

      return {
        asset,
        symbol,
        name: asset.name,
        quantity: freeQuantity,
        price: asset.price,
        value: freeValue,
        bucketAllocation: 0,
        portfolioAllocation: totalValue > 0 ? roundAmount((freeValue / totalValue) * 100, 2) : 0,
      };
    })
    .filter((entry): entry is AllocationBucketAsset => entry !== null)
    .sort((left, right) => right.value - left.value);

  const directValue = roundAmount(directAssets.reduce((sum, entry) => sum + entry.value, 0), 2);
  const buckets = [...botBuckets];

  if (directValue > 0 || buckets.length === 0) {
    buckets.unshift({
      id: "direct-holdings",
      name: buckets.length > 0 ? "Available Capital" : "Direct Holdings",
      kind: "direct",
      value: directValue > 0 ? directValue : roundAmount(totalValue, 2),
      allocation: totalValue > 0 ? roundAmount(((directValue > 0 ? directValue : totalValue) / totalValue) * 100, 2) : 100,
      color: BUCKET_COLORS[botBuckets.length % BUCKET_COLORS.length],
      description:
        buckets.length > 0
          ? "Holdings currently outside active bots and available for manual use or future automation."
          : "No active bots are reserving capital yet.",
      assets:
        directValue > 0
          ? directAssets.map((entry) => ({
              ...entry,
              bucketAllocation: directValue > 0 ? roundAmount((entry.value / directValue) * 100, 2) : 0,
            }))
          : assets.map((asset) => ({
              asset,
              symbol: asset.symbol,
              name: asset.name,
              quantity: asset.balance,
              price: asset.price,
              value: asset.value,
              bucketAllocation: asset.allocation,
              portfolioAllocation: asset.allocation,
            })),
    });
  }

  return buckets.sort((left, right) => right.value - left.value);
}

function buildAllocationAssetSegments(buckets: AllocationBucket[]): AllocationAssetSegment[] {
  return buckets.flatMap((bucket) =>
    bucket.assets
      .filter((asset) => asset.value > 0)
      .map((asset) => ({
        id: `${bucket.id}-${asset.symbol}`,
        bucketId: bucket.id,
        bucketName: bucket.name,
        bucketKind: bucket.kind,
        asset: asset.asset,
        symbol: asset.symbol,
        name: asset.name,
        value: asset.value,
        bucketAllocation: asset.bucketAllocation,
        portfolioAllocation: asset.portfolioAllocation,
        color: assetColorFromSymbol(asset.symbol),
      }))
  );
}

function isAllocationAssetSegment(payload: AllocationBucket | AllocationAssetSegment): payload is AllocationAssetSegment {
  return "bucketId" in payload;
}

function AllocationTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: AllocationBucket | AllocationAssetSegment }>;
}) {
  const hoveredItem = payload?.[0]?.payload;
  if (!active || !hoveredItem) return null;

  if (isAllocationAssetSegment(hoveredItem)) {
    return (
      <div className="rounded-lg border border-border bg-card/95 px-3 py-2 shadow-xl backdrop-blur">
        <div className="flex items-center gap-2 text-xs font-mono text-foreground">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: hoveredItem.color }}
          />
          <span>{hoveredItem.symbol}</span>
          <span className="text-muted-foreground">inside {hoveredItem.bucketName}</span>
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {formatUsd(hoveredItem.value)} | {hoveredItem.bucketAllocation.toFixed(2)}% of slice
        </div>
        <div className="text-[11px] text-muted-foreground">
          {hoveredItem.portfolioAllocation.toFixed(2)}% of portfolio
        </div>
      </div>
    );
  }

  const bucket = hoveredItem;

  return (
    <div className="rounded-lg border border-border bg-card/95 px-3 py-2 shadow-xl backdrop-blur">
      <div className="text-xs font-mono text-foreground">{bucket.name}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {formatUsd(bucket.value)} • {bucket.allocation.toFixed(2)}%
      </div>
    </div>
  );
}

interface SliceAnalysisDialogProps {
  accountType: PortfolioAccountType;
  bucket: AllocationBucket;
  hasEnabledDemoBots: boolean;
  onClose: () => void;
  onSelectAsset: (asset: Asset) => void;
}

function SliceAnalysisDialog({
  accountType,
  bucket,
  hasEnabledDemoBots,
  onClose,
  onSelectAsset,
}: SliceAnalysisDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden border-border bg-card p-0">
        <div className="border-b border-border px-6 py-5">
          <DialogHeader className="space-y-3 text-left">
            <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
              <div>
                <DialogTitle className="font-mono text-xl text-foreground">Slice Analysis</DialogTitle>
                <DialogDescription className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  Drill into {bucket.name} to see which assets are sitting inside it right now.
                </DialogDescription>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/30 px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                {bucket.kind === "bot" ? <Bot className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}
                {bucket.kind === "bot" ? "Bot slice" : "Direct slice"}
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="space-y-4 overflow-y-auto px-6 py-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-secondary/20 p-4">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Slice Value</div>
              <div className="mt-2 text-lg font-mono font-semibold text-foreground">{formatUsd(bucket.value)}</div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/20 p-4">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Portfolio Share</div>
              <div className="mt-2 text-lg font-mono font-semibold text-foreground">{bucket.allocation.toFixed(2)}%</div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/20 p-4">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Assets In Slice</div>
              <div className="mt-2 text-lg font-mono font-semibold text-foreground">{bucket.assets.length}</div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-secondary/15 px-4 py-3 text-xs text-muted-foreground">
            {bucket.description}
          </div>

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-border">
                  {["Asset", "Quantity", "Value", "In Slice", "Of Portfolio"].map((heading) => (
                    <th
                      key={heading}
                      className="px-4 py-3 text-right text-[11px] font-mono uppercase tracking-wider text-muted-foreground first:text-left"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bucket.assets.map((bucketAsset) => (
                  <tr
                    key={`${bucket.id}-${bucketAsset.symbol}`}
                    onClick={() => {
                      if (!bucketAsset.asset) return;
                      onSelectAsset(bucketAsset.asset);
                      onClose();
                    }}
                    className={cn(
                      "border-b border-border last:border-b-0",
                      bucketAsset.asset ? "cursor-pointer hover:bg-secondary/20" : "cursor-default"
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary"
                          style={{ boxShadow: `inset 0 0 0 1px ${assetColorFromSymbol(bucketAsset.symbol)}` }}
                        >
                          <span className="text-xs font-mono font-semibold text-foreground">
                            {bucketAsset.symbol.slice(0, 2)}
                          </span>
                        </div>
                        <div>
                          <div className="text-sm font-mono font-medium text-foreground">{bucketAsset.symbol}</div>
                          <div className="text-[11px] text-muted-foreground">{bucketAsset.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-mono text-foreground">
                      {formatQuantity(bucketAsset.quantity)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-mono text-foreground">
                      {formatUsd(bucketAsset.value)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-mono text-foreground">
                      {bucketAsset.bucketAllocation.toFixed(2)}%
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-mono text-muted-foreground">
                      {bucketAsset.portfolioAllocation.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {bucket.assets.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-secondary/20 px-5 py-8 text-center text-sm text-muted-foreground">
              No assets are currently allocated inside this slice.
            </div>
          ) : null}

          {accountType === "demo" && bucket.kind === "direct" && !hasEnabledDemoBots ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/25 px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
              <CircleDot className="h-3.5 w-3.5" />
              Create a bot in Strategies to split this portfolio into managed buckets.
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PortfolioPage({
  accountType,
  onOpenExchangeConnections,
  onOpenExchangeMarket,
  onSelectAsset,
}: PortfolioPageProps) {
  const { data, isPending, error } = useDashboardData(accountType);
  const { data: botProfilesData } = useBotProfiles(accountType === "demo");
  const { data: tradingAssetsData } = useTradingAssets(accountType);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [selectedBucketId, setSelectedBucketId] = useState<string>("");
  const [sliceDetailsBucketId, setSliceDetailsBucketId] = useState<string>("");
  const isLoading = isPending && !data;
  const changeMetricLabel = accountType === "demo" ? "Net P&L" : "24h Change";

  const assets = data?.assets ?? EMPTY_ASSETS;
  const botProfiles = botProfilesData?.profiles ?? EMPTY_BOT_PROFILES;
  const tradingAssets = useMemo(
    () =>
      tradingAssetsData?.assets && tradingAssetsData.assets.length > 0
        ? tradingAssetsData.assets
        : assets.length > 0
          ? buildTradingAssetAvailabilityFallback(assets)
          : EMPTY_TRADING_ASSETS,
    [assets, tradingAssetsData?.assets]
  );

  const allocationBuckets = useMemo(
    () => buildAllocationBuckets(accountType, assets, botProfiles),
    [accountType, assets, botProfiles]
  );
  const allocationAssetSegments = useMemo(
    () => buildAllocationAssetSegments(allocationBuckets),
    [allocationBuckets]
  );
  const selectedBucket =
    allocationBuckets.find((bucket) => bucket.id === selectedBucketId) ?? allocationBuckets[0] ?? null;
  const sliceDetailsBucket =
    allocationBuckets.find((bucket) => bucket.id === sliceDetailsBucketId && bucket.kind === "bot") ?? null;
  const hasEnabledDemoBots = botProfiles.some((profile) => profile.isEnabled);

  const topPosition = [...assets].sort((a, b) => b.value - a.value)[0];

  useEffect(() => {
    if (!selectedAsset) return;
    const refreshedAsset = assets.find((asset) => asset.id === selectedAsset.id);
    if (refreshedAsset) {
      setSelectedAsset(refreshedAsset);
    }
  }, [assets, selectedAsset]);

  useEffect(() => {
    if (selectedBucket && allocationBuckets.some((bucket) => bucket.id === selectedBucket.id)) {
      return;
    }
    setSelectedBucketId(allocationBuckets[0]?.id ?? "");
  }, [allocationBuckets, selectedBucket]);

  useEffect(() => {
    if (!sliceDetailsBucketId) return;
    if (allocationBuckets.some((bucket) => bucket.id === sliceDetailsBucketId && bucket.kind === "bot")) {
      return;
    }
    setSliceDetailsBucketId("");
  }, [allocationBuckets, sliceDetailsBucketId]);

  const handleSelectAsset = (asset: Asset) => {
    setSelectedAsset(asset);
    onSelectAsset?.(asset);
  };

  const openSliceDetails = (bucketId: string) => {
    setSelectedBucketId(bucketId);
    setSliceDetailsBucketId(bucketId);
  };

  return (
    <>
      <div className="p-4 md:p-6 space-y-4">
        <div>
          <h2 className="text-lg md:text-xl font-mono font-semibold text-foreground">Portfolio</h2>
          <p className="text-sm text-muted-foreground mt-1">Core holdings overview.</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 stagger-children">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Total Value</div>
            <SpinnerValue
              loading={isLoading}
              value={data ? formatUsd(data.totalPortfolioValue) : undefined}
              className="mt-2 text-lg md:text-xl font-mono font-semibold text-foreground"
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{changeMetricLabel}</div>
            <SpinnerValue
              loading={isLoading}
              value={
                data
                  ? `${data.portfolioChange24hValue >= 0 ? "+" : ""}${formatUsd(data.portfolioChange24hValue)}`
                  : undefined
              }
              className={`mt-2 text-lg md:text-xl font-mono font-semibold ${data && data.portfolioChange24hValue < 0 ? "text-negative" : "text-positive"}`}
            />
            <SpinnerValue
              loading={isLoading}
              value={data ? `${data.portfolioChange24h >= 0 ? "+" : ""}${data.portfolioChange24h}%` : undefined}
              className={`text-xs font-mono ${data && data.portfolioChange24h < 0 ? "text-negative" : "text-positive"}`}
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Assets</div>
            <SpinnerValue
              loading={isLoading}
              value={data ? data.assets.length : undefined}
              className="mt-2 text-lg md:text-xl font-mono font-semibold text-foreground"
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Top Position</div>
            <SpinnerValue
              loading={isLoading}
              value={topPosition ? `${topPosition.symbol} ${formatUsd(topPosition.value)}` : undefined}
              className="mt-2 text-lg md:text-xl font-mono font-semibold text-foreground"
            />
          </div>
        </div>

        <div>
          <div className="rounded-xl border border-border bg-card p-5 animate-fade-up">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Allocation Destinations</div>
                <div className="mt-2 text-sm text-muted-foreground">
                  The inner ring shows the bucket split. The outer ring breaks each bucket into the exact assets sitting inside it.
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Use the 3-dot button on bot slices when you want the full slice breakdown.
                </div>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/30 px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                <PieChartIcon className="h-3.5 w-3.5" />
                Live split
              </div>
            </div>

            {isLoading ? (
              <div className="mt-6 grid min-h-[320px] place-items-center">
                <SpinnerValue loading value={undefined} />
              </div>
            ) : allocationBuckets.length === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-border bg-secondary/20 px-5 py-12 text-center text-sm text-muted-foreground">
                No allocation breakdown is available until holdings are present.
              </div>
            ) : (
              <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:items-center">
                <div className="relative h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={allocationAssetSegments}
                        dataKey="value"
                        nameKey="symbol"
                        innerRadius={122}
                        outerRadius={148}
                        paddingAngle={1}
                        stroke="hsl(var(--background))"
                        strokeWidth={2}
                        onClick={(entry) => {
                          const segment = entry as AllocationAssetSegment;
                          setSelectedBucketId(segment.bucketId);
                        }}
                      >
                        {allocationAssetSegments.map((segment) => (
                          <Cell
                            key={segment.id}
                            fill={segment.color}
                            fillOpacity={selectedBucket?.id === segment.bucketId ? 0.98 : 0.46}
                            style={{ cursor: "pointer" }}
                          />
                        ))}
                      </Pie>
                      <Pie
                        data={allocationBuckets}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={78}
                        outerRadius={112}
                        paddingAngle={3}
                        stroke="hsl(var(--background))"
                        strokeWidth={3}
                        onClick={(entry) => setSelectedBucketId(entry.id)}
                      >
                        {allocationBuckets.map((bucket) => (
                          <Cell
                            key={bucket.id}
                            fill={bucket.color}
                            fillOpacity={selectedBucket?.id === bucket.id ? 1 : 0.52}
                            style={{ cursor: "pointer" }}
                          />
                        ))}
                      </Pie>
                      <Tooltip content={<AllocationTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>

                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">Portfolio</div>
                    <div className="mt-2 text-2xl font-mono font-semibold text-foreground">
                      {formatUsd(data?.totalPortfolioValue ?? 0)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{allocationBuckets.length} slices</div>
                  </div>
                </div>

                <div className="space-y-3">
                  {allocationBuckets.map((bucket) => {
                    const selected = selectedBucket?.id === bucket.id;
                    return (
                      <div
                        key={bucket.id}
                        className={cn(
                          "rounded-xl border p-4 transition-all duration-300",
                          selected
                            ? "border-primary/35 bg-secondary/40 shadow-[0_0_0_1px_hsl(var(--primary)/0.12)]"
                            : "border-border bg-secondary/15 hover:border-primary/20 hover:bg-secondary/30"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => setSelectedBucketId(bucket.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex min-w-0 items-start gap-3">
                                <span
                                  className="mt-1 h-3 w-3 shrink-0 rounded-full"
                                  style={{ backgroundColor: bucket.color }}
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <div className="text-sm font-mono font-semibold text-foreground">{bucket.name}</div>
                                    <span className="rounded-full border border-border bg-background/40 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                                      {bucket.kind === "bot" ? "Bot" : "Direct"}
                                    </span>
                                  </div>
                                  <div className="mt-1 text-xs text-muted-foreground">{bucket.description}</div>
                                </div>
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-sm font-mono font-semibold text-foreground">{formatUsd(bucket.value)}</div>
                                <div className="mt-1 text-[11px] font-mono text-muted-foreground">{bucket.allocation.toFixed(2)}%</div>
                              </div>
                            </div>
                          </button>
                          {bucket.kind === "bot" ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => openSliceDetails(bucket.id)}
                              aria-label={`Open slice details for ${bucket.name}`}
                              className="h-8 w-8 shrink-0 rounded-full border border-border bg-background/40 text-muted-foreground hover:bg-secondary hover:text-foreground"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                  {selectedBucket ? (
                    <div className="rounded-xl border border-border bg-secondary/15 p-4">
                      <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-muted-foreground">
                        Asset Ring For {selectedBucket.name}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedBucket.assets.map((asset) => (
                          <div
                            key={`${selectedBucket.id}-legend-${asset.symbol}`}
                            className="inline-flex items-center gap-2 rounded-full border border-border bg-background/50 px-3 py-1.5"
                          >
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: assetColorFromSymbol(asset.symbol) }}
                            />
                            <span className="text-[11px] font-mono text-foreground">{asset.symbol}</span>
                            <span className="text-[11px] text-muted-foreground">{asset.bucketAllocation.toFixed(2)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>

        {accountType === "real" ? (
          <PortfolioConnectionsPanel
            onOpenConnections={onOpenExchangeConnections}
            onOpenMarketIntel={onOpenExchangeMarket}
          />
        ) : null}

        <PortfolioTradeDialogs
          accountType={accountType}
          portfolioAssets={assets}
          tradingAssets={tradingAssets}
        />

        {sliceDetailsBucket ? (
          <SliceAnalysisDialog
            accountType={accountType}
            bucket={sliceDetailsBucket}
            hasEnabledDemoBots={hasEnabledDemoBots}
            onClose={() => setSliceDetailsBucketId("")}
            onSelectAsset={handleSelectAsset}
          />
        ) : null}

        {error && !data ? (
          <div className="rounded-md border border-negative/30 bg-negative/10 px-4 py-3 text-xs text-negative">
            {error instanceof Error ? error.message : "Failed to load portfolio data."}
          </div>
        ) : null}
      </div>

      <AssetDetailsDialog
        asset={selectedAsset}
        open={Boolean(selectedAsset)}
        accountType={accountType}
        portfolioTotalValue={data?.totalPortfolioValue ?? 0}
        tradingAssets={tradingAssets}
        recentActivity={data?.recentActivity ?? []}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedAsset(null);
          }
        }}
      />
    </>
  );
}

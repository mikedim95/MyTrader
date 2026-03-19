import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ExchangeId, ExchangeMarketSymbol } from "@/types/api";

export interface ExchangeComparisonRow {
  exchange: ExchangeId;
  last: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spreadPercent: number | null;
  topBidVolume: number | null;
  topAskVolume: number | null;
  totalBidVolumeTopN: number | null;
  totalAskVolumeTopN: number | null;
  timestamp: string | null;
}

interface ComparisonTableProps {
  symbol: ExchangeMarketSymbol;
  depth: number;
  rows: ExchangeComparisonRow[];
  isLoading: boolean;
}

function getCurrencyCode(symbol: ExchangeMarketSymbol): "USD" | "EUR" {
  return symbol.endsWith("-EUR") ? "EUR" : "USD";
}

function getBaseAsset(symbol: ExchangeMarketSymbol): string {
  return symbol.split("-")[0] ?? "BTC";
}

function formatExchange(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatPrice(value: number | null | undefined, symbol: ExchangeMarketSymbol): string {
  if (value === null || value === undefined) return "--";

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: getCurrencyCode(symbol),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "--";
  return `${value.toFixed(4)}%`;
}

function formatVolume(value: number | null | undefined, symbol: ExchangeMarketSymbol): string {
  if (value === null || value === undefined) return "--";
  return `${value.toFixed(6)} ${getBaseAsset(symbol)}`;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString();
}

export function ComparisonTable({ symbol, depth, rows, isLoading }: ComparisonTableProps) {
  return (
    <Card className="animate-fade-up">
      <CardHeader className="pb-3">
        <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Comparison Table</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Live side-by-side pricing and top-of-book liquidity for {symbol}. Volumes sum the top {depth} levels.
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-mono text-[11px] uppercase tracking-wider">Exchange</TableHead>
              <TableHead className="text-right font-mono text-[11px] uppercase tracking-wider">Last Price</TableHead>
              <TableHead className="text-right font-mono text-[11px] uppercase tracking-wider">Best Bid</TableHead>
              <TableHead className="text-right font-mono text-[11px] uppercase tracking-wider">Best Ask</TableHead>
              <TableHead className="text-right font-mono text-[11px] uppercase tracking-wider">Spread %</TableHead>
              <TableHead className="text-right font-mono text-[11px] uppercase tracking-wider">Top Bid Volume</TableHead>
              <TableHead className="text-right font-mono text-[11px] uppercase tracking-wider">Top Ask Volume</TableHead>
              <TableHead className="text-right font-mono text-[11px] uppercase tracking-wider">Updated At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 2 }).map((_, rowIndex) => (
                  <TableRow key={`exchange-comparison-skeleton-${rowIndex}`}>
                    {Array.from({ length: 8 }).map((__, cellIndex) => (
                      <TableCell key={`exchange-comparison-skeleton-${rowIndex}-${cellIndex}`}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : rows.map((row) => (
                  <TableRow key={row.exchange}>
                    <TableCell className="font-mono text-sm font-semibold text-foreground">{formatExchange(row.exchange)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-foreground">{formatPrice(row.last, symbol)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-foreground">{formatPrice(row.bestBid, symbol)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-foreground">{formatPrice(row.bestAsk, symbol)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-foreground">{formatPercent(row.spreadPercent)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-foreground">
                      <div>{formatVolume(row.topBidVolume, symbol)}</div>
                      <div className="text-[11px] text-muted-foreground">Total {formatVolume(row.totalBidVolumeTopN, symbol)}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-foreground">
                      <div>{formatVolume(row.topAskVolume, symbol)}</div>
                      <div className="text-[11px] text-muted-foreground">Total {formatVolume(row.totalAskVolumeTopN, symbol)}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">{formatTimestamp(row.timestamp)}</TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
        {!isLoading && rows.length === 0 ? (
          <div className="py-6 text-sm text-muted-foreground">No normalized exchange data is available for this pair yet.</div>
        ) : null}
      </CardContent>
    </Card>
  );
}


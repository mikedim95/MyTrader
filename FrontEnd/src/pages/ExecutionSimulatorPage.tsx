import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock3, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { useExecutionHistory, useExecutionPerformance } from "@/hooks/useTradingData";
import { backendApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ExecutionHistoryItem, ExecutionSimulatorSymbol, ExecutionSimulationResponse, PaperTradeSignalAction } from "@/types/api";

const SYMBOL_OPTIONS: ExecutionSimulatorSymbol[] = ["BTC-USD"];

function formatCurrency(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }
  return `${value.toFixed(digits)}%`;
}

function formatNumber(value: number | null | undefined, digits = 8): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }
  return value.toFixed(digits);
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "--";
  }
  return date.toLocaleString();
}

function statusBadgeClass(status: "filled" | "blocked"): string {
  return status === "filled"
    ? "border-positive/30 bg-positive/10 text-positive"
    : "border-negative/30 bg-negative/10 text-negative";
}

function HistoryTable({ rows }: { rows: ExecutionHistoryItem[] }) {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="font-mono text-lg">Execution History</CardTitle>
        <CardDescription>Filled and blocked paper executions, with PnL once a scheduled outcome is evaluated.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>PnL</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  No simulated executions yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{formatTime(row.createdAt)}</TableCell>
                  <TableCell>
                    <div className="font-mono text-sm uppercase text-foreground">{row.action}</div>
                    <div className="text-xs text-muted-foreground">{row.symbol}</div>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-foreground">{formatCurrency(row.avgPrice ?? row.referencePrice)}</TableCell>
                  <TableCell className="font-mono text-sm text-foreground">{formatNumber(row.size, 6)}</TableCell>
                  <TableCell>
                    <div
                      className={cn(
                        "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider",
                        statusBadgeClass(row.status),
                      )}
                    >
                      {row.status}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {row.blockReason ?? row.latestOutcomeHorizon ?? row.method ?? "Pending outcome"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className={cn("font-mono text-sm", (row.pnl ?? 0) >= 0 ? "text-positive" : "text-negative")}>
                      {row.pnl === null ? "Pending" : formatCurrency(row.pnl)}
                    </div>
                    <div className="text-xs text-muted-foreground">{row.returnPercent === null ? "--" : formatPercent(row.returnPercent)}</div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ResultCard({ result }: { result: ExecutionSimulationResponse | null }) {
  if (!result) {
    return (
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="font-mono text-lg">Execution Result</CardTitle>
          <CardDescription>The latest simulated execution will appear here.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0 text-sm text-muted-foreground">
          Submit a manual BUY or SELL signal to inspect the guardrail decision and the split execution model.
        </CardContent>
      </Card>
    );
  }

  const Icon = result.allowed ? ShieldCheck : ShieldX;

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <div
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider",
              statusBadgeClass(result.execution.status),
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {result.execution.status}
          </div>
          <div className="rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            {result.execution.symbol} {result.execution.action}
          </div>
        </div>
        <CardTitle className="font-mono text-lg">Execution Result</CardTitle>
        <CardDescription>{result.execution.explanation}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-border bg-secondary/20 p-3">
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Avg Fill</div>
            <div className="mt-2 font-mono text-lg text-foreground">{formatCurrency(result.execution.avgFillPrice)}</div>
          </div>
          <div className="rounded-lg border border-border bg-secondary/20 p-3">
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Slippage</div>
            <div className="mt-2 font-mono text-lg text-foreground">{formatPercent(result.execution.slippage, 4)}</div>
          </div>
          <div className="rounded-lg border border-border bg-secondary/20 p-3">
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Method</div>
            <div className="mt-2 font-mono text-lg text-foreground">{result.execution.method ?? "blocked"}</div>
          </div>
          <div className="rounded-lg border border-border bg-secondary/20 p-3">
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Execution Time</div>
            <div className="mt-2 font-mono text-lg text-foreground">
              {result.execution.executionTimeMs === null ? "--" : `${result.execution.executionTimeMs} ms`}
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-lg border border-border bg-secondary/20 p-4">
            <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              <ShieldAlert className="h-4 w-4" />
              Guardrails
            </div>
            <div className="mt-3 space-y-2">
              {result.guardrails.reasons.length === 0 ? (
                <div className="rounded-md border border-positive/30 bg-positive/10 px-3 py-2 text-sm text-positive">
                  Guardrails allowed the paper trade.
                </div>
              ) : (
                result.guardrails.reasons.map((reason, index) => (
                  <div key={`${result.execution.id}-reason-${index}`} className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
                    {reason}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-secondary/20 p-4">
            <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              <Clock3 className="h-4 w-4" />
              Chunk Simulation
            </div>
            <div className="mt-3 space-y-2">
              {result.execution.chunks.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                  No chunks were simulated because the signal was blocked.
                </div>
              ) : (
                result.execution.chunks.map((chunk) => (
                  <div key={`${result.execution.id}-chunk-${chunk.index}`} className="rounded-md border border-border bg-background px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-mono text-sm text-foreground">Chunk {chunk.index}</div>
                      <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{chunk.outcome}</div>
                    </div>
                    <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                      <div>Size: <span className="font-mono text-foreground">{formatNumber(chunk.size, 6)}</span></div>
                      <div>Limit: <span className="font-mono text-foreground">{formatCurrency(chunk.limitPrice)}</span></div>
                      <div>Fill: <span className="font-mono text-foreground">{formatCurrency(chunk.fillPrice)}</span></div>
                      <div>Wait: <span className="font-mono text-foreground">{chunk.waitTimeMs} ms</span></div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ExecutionSimulatorPage() {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<PaperTradeSignalAction>("buy");
  const [symbol, setSymbol] = useState<ExecutionSimulatorSymbol>("BTC-USD");
  const [confidence, setConfidence] = useState("0.75");
  const [reason, setReason] = useState("manual momentum follow-through");
  const [latestResult, setLatestResult] = useState<ExecutionSimulationResponse | null>(null);

  const historyQuery = useExecutionHistory(20);
  const performanceQuery = useExecutionPerformance();

  const simulateMutation = useMutation({
    mutationFn: () =>
      backendApi.simulateExecution({
        id: crypto.randomUUID(),
        symbol,
        action,
        confidence: Number(confidence),
        reason: reason.trim(),
        timestamp: new Date().toISOString(),
      }),
    onSuccess: async (response) => {
      setLatestResult(response);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["execution-history"] }),
        queryClient.invalidateQueries({ queryKey: ["execution-performance"] }),
      ]);
      toast.success(response.allowed ? "Paper execution simulated." : "Signal blocked by guardrails.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Execution simulation failed.");
    },
  });

  const portfolio = latestResult?.portfolio ?? performanceQuery.data?.portfolio ?? historyQuery.data?.portfolio ?? null;

  const handleSubmit = () => {
    const parsedConfidence = Number(confidence);
    if (!Number.isFinite(parsedConfidence) || parsedConfidence < 0 || parsedConfidence > 1) {
      toast.error("Confidence must be between 0 and 1.");
      return;
    }
    if (!reason.trim()) {
      toast.error("Reason is required.");
      return;
    }
    simulateMutation.mutate();
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h2 className="text-lg md:text-xl font-mono font-semibold text-foreground">Execution Simulator</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Paper-only execution engine using the normalized exchange intelligence layer. Manual signals only, BTC-USD only, no live orders.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="font-mono text-lg">Signal Trigger</CardTitle>
            <CardDescription>Submit a manual signal. Size is derived from confidence and current paper portfolio state.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Action</div>
                <Select value={action} onValueChange={(value) => setAction(value as PaperTradeSignalAction)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose action" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="buy">BUY</SelectItem>
                    <SelectItem value="sell">SELL</SelectItem>
                  </SelectContent>
                </Select>
              </label>

              <label className="space-y-2">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Symbol</div>
                <Select value={symbol} onValueChange={(value) => setSymbol(value as ExecutionSimulatorSymbol)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose symbol" />
                  </SelectTrigger>
                  <SelectContent>
                    {SYMBOL_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>

            <label className="space-y-2">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Confidence</div>
              <Input value={confidence} onChange={(event) => setConfidence(event.target.value)} type="number" min="0" max="1" step="0.05" />
            </label>

            <label className="space-y-2">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Reason</div>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="min-h-28"
                placeholder="Explain why the signal exists."
              />
            </label>

            <div className="rounded-lg border border-border bg-secondary/20 p-3 text-sm text-muted-foreground">
              Confidence drives the simulated notional size. Guardrails still enforce the 20% asset cap, 5% daily loss limit, cooldown, and duplicate blocking.
            </div>

            <Button onClick={handleSubmit} disabled={simulateMutation.isPending} className="w-full font-mono">
              {simulateMutation.isPending ? "Simulating..." : "Simulate Execution"}
            </Button>
          </CardContent>
        </Card>

        <ResultCard result={latestResult} />
      </div>

      {performanceQuery.error ? (
        <div className="rounded-lg border border-negative/40 bg-negative/10 p-4 text-sm text-negative">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <div>{performanceQuery.error instanceof Error ? performanceQuery.error.message : "Execution performance could not be loaded."}</div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardDescription>Win Rate</CardDescription>
            <CardTitle className="font-mono text-2xl">{formatPercent(performanceQuery.data?.summary.winRate ? performanceQuery.data.summary.winRate * 100 : 0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardDescription>Avg Return</CardDescription>
            <CardTitle className="font-mono text-2xl">{formatPercent(performanceQuery.data?.summary.avgReturn ?? 0, 4)}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardDescription>Total Trades</CardDescription>
            <CardTitle className="font-mono text-2xl">{performanceQuery.data?.summary.totalTrades ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardDescription>Paper Equity</CardDescription>
            <CardTitle className="font-mono text-2xl">{formatCurrency(portfolio?.totalEquityUSD ?? null)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="font-mono text-lg">Paper Portfolio</CardTitle>
          <CardDescription>Live view of the execution simulator cash and position state.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 pt-0 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-secondary/20 p-3">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Cash</div>
              <div className="mt-2 font-mono text-lg text-foreground">{formatCurrency(portfolio?.balanceUSD ?? null)}</div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/20 p-3">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Total Equity</div>
              <div className="mt-2 font-mono text-lg text-foreground">{formatCurrency(portfolio?.totalEquityUSD ?? null)}</div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/20 p-3">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Realized PnL</div>
              <div className={cn("mt-2 font-mono text-lg", (performanceQuery.data?.summary.realizedPnl ?? 0) >= 0 ? "text-positive" : "text-negative")}>
                {formatCurrency(performanceQuery.data?.summary.realizedPnl ?? 0)}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-secondary/20 p-4">
            <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              <CheckCircle2 className="h-4 w-4" />
              Positions
            </div>
            <div className="mt-3 space-y-2">
              {(portfolio?.positions ?? []).length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                  No open paper positions yet.
                </div>
              ) : (
                portfolio?.positions.map((position) => (
                  <div key={position.symbol} className="rounded-md border border-border bg-background px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-mono text-sm text-foreground">{position.symbol}</div>
                      <div className="font-mono text-xs text-muted-foreground">{formatPercent(position.allocationPercent, 2)}</div>
                    </div>
                    <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                      <div>Size: <span className="font-mono text-foreground">{formatNumber(position.size, 6)}</span></div>
                      <div>Avg Entry: <span className="font-mono text-foreground">{formatCurrency(position.avgEntry)}</span></div>
                      <div>Market: <span className="font-mono text-foreground">{formatCurrency(position.marketPrice)}</span></div>
                      <div>Value: <span className="font-mono text-foreground">{formatCurrency(position.marketValue)}</span></div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {historyQuery.error ? (
        <div className="rounded-lg border border-negative/40 bg-negative/10 p-4 text-sm text-negative">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <div>{historyQuery.error instanceof Error ? historyQuery.error.message : "Execution history could not be loaded."}</div>
          </div>
        </div>
      ) : null}

      <HistoryTable rows={historyQuery.data?.executions ?? []} />
    </div>
  );
}

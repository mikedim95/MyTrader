import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, ChevronDown, KeyRound, Link2, ShieldCheck, Wallet, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { useCryptoComConnection, useCryptoComOverview, useExchangeHealth } from "@/hooks/useTradingData";
import { backendApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ExchangeHealth, ExchangeId } from "@/types/api";

const EXCHANGE_ORDER: ExchangeId[] = ["kraken", "coinbase", "crypto.com"];

function formatExchangeLabel(exchange: ExchangeId): string {
  return exchange === "crypto.com"
    ? "Crypto.com"
    : exchange.charAt(0).toUpperCase() + exchange.slice(1);
}

function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatToken(value: number | null | undefined, symbol: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return `-- ${symbol}`;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${symbol}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Request failed.";
}

function statusBadge(online: boolean): string {
  return online
    ? "border-positive/30 bg-positive/10 text-positive"
    : "border-negative/30 bg-negative/10 text-negative";
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleTimeString();
}

function SummaryMetric({
  label,
  value,
  helper,
}: {
  label: string;
  value: string | number;
  helper?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary/15 p-4">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 text-lg font-mono font-semibold text-foreground">{value}</div>
      {helper ? <div className="mt-2 text-xs text-muted-foreground">{helper}</div> : null}
    </div>
  );
}

function ExchangePanelHeader({
  eyebrow,
  title,
  description,
  badges,
  open,
}: {
  eyebrow: string;
  title: string;
  description: string;
  badges: React.ReactNode;
  open: boolean;
}) {
  return (
    <div className="flex flex-1 flex-wrap items-start justify-between gap-3 pr-4">
      <div>
        <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{eyebrow}</div>
        <div className="mt-2 text-xl font-mono font-semibold text-foreground">{title}</div>
        <div className="mt-2 text-sm text-muted-foreground">{description}</div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex flex-wrap justify-end gap-2">{badges}</div>
        <ChevronDown
          className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")}
        />
      </div>
    </div>
  );
}

export function ExchangeConnectionsPage() {
  const queryClient = useQueryClient();
  const { data: healthData, isPending: loadingHealth } = useExchangeHealth();
  const { data: cryptoComConnection } = useCryptoComConnection();
  const { data: cryptoComOverview } = useCryptoComOverview(cryptoComConnection?.connected ?? false);

  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [apiHost, setApiHost] = useState("https://api.crypto.com");
  const [cryptoComMessage, setCryptoComMessage] = useState<string | null>(null);
  const [expandedPanels, setExpandedPanels] = useState<string[]>([]);
  const [showCryptoComCredentialForm, setShowCryptoComCredentialForm] = useState(false);

  const healthByExchange = useMemo(
    () => new Map((healthData?.exchanges ?? []).map((entry) => [entry.exchange, entry])),
    [healthData?.exchanges]
  );

  const publicOnlineCount = (healthData?.exchanges ?? []).filter((exchange) => exchange.status === "online").length;
  const privateConnectedCount = cryptoComConnection?.connected ? 1 : 0;
  const cryptoComConnected = cryptoComConnection?.connected ?? false;
  const cryptoComSource = cryptoComConnection?.source?.toUpperCase() ?? "NONE";
  const cryptoComGeneratedAt = formatTimestamp(cryptoComOverview?.generatedAt);
  const topBalances = cryptoComOverview?.assets.slice(0, 8) ?? [];

  const isPanelOpen = (panel: string) => expandedPanels.includes(panel);

  const setPanelOpen = (panel: string, open: boolean) => {
    setExpandedPanels((current) => {
      if (open) {
        return current.includes(panel) ? current : [...current, panel];
      }
      return current.filter((entry) => entry !== panel);
    });
  };

  const openPanel = (panel: string) => setPanelOpen(panel, true);

  useEffect(() => {
    if (!cryptoComConnection?.message) return;
    setCryptoComMessage(cryptoComConnection.message);
  }, [cryptoComConnection?.message]);

  const refreshCryptoComData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["crypto-com-connection"] }),
      queryClient.invalidateQueries({ queryKey: ["crypto-com-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["exchange-health"] }),
    ]);
  };

  const connectCryptoComMutation = useMutation({
    mutationFn: async () =>
      backendApi.connectCryptoCom({
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim(),
        apiHost: apiHost.trim(),
      }),
    onSuccess: async (next) => {
      setApiKey("");
      setApiSecret("");
      setShowCryptoComCredentialForm(false);
      openPanel("crypto.com");
      setCryptoComMessage(next.connected ? "Crypto.com credentials saved for this user." : next.message ?? "Connection failed.");
      await refreshCryptoComData();
    },
    onError: (error) => {
      setShowCryptoComCredentialForm(true);
      openPanel("crypto.com");
      setCryptoComMessage(getErrorMessage(error));
    },
  });

  const disconnectCryptoComMutation = useMutation({
    mutationFn: backendApi.disconnectCryptoCom,
    onSuccess: async (next) => {
      setApiKey("");
      setApiSecret("");
      setShowCryptoComCredentialForm(false);
      openPanel("crypto.com");
      setCryptoComMessage(
        next.connected ? "Stored credentials removed. Environment credentials are still active." : "Stored Crypto.com credentials removed."
      );
      await refreshCryptoComData();
    },
    onError: (error) => {
      openPanel("crypto.com");
      setCryptoComMessage(getErrorMessage(error));
    },
  });

  const isCryptoComBusy = connectCryptoComMutation.isPending || disconnectCryptoComMutation.isPending;
  const shouldShowCryptoForm = !cryptoComConnected || showCryptoComCredentialForm;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="animate-fade-up">
          <CardHeader className="pb-3">
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Venues</div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-2xl font-mono font-semibold text-foreground">{EXCHANGE_ORDER.length}</div>
            <div className="text-sm text-muted-foreground">Kraken, Coinbase, and Crypto.com visible in one place.</div>
          </CardContent>
        </Card>

        <Card className="animate-fade-up" style={{ animationDelay: "80ms" }}>
          <CardHeader className="pb-3">
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Private Links</div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-2xl font-mono font-semibold text-foreground">{privateConnectedCount}</div>
            <div className="text-sm text-muted-foreground">Authenticated exchange connections active right now.</div>
          </CardContent>
        </Card>

        <Card className="animate-fade-up" style={{ animationDelay: "140ms" }}>
          <CardHeader className="pb-3">
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Public Feeds</div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-2xl font-mono font-semibold text-foreground">
              {loadingHealth ? "--" : `${publicOnlineCount}/${EXCHANGE_ORDER.length}`}
            </div>
            <div className="text-sm text-muted-foreground">Live public market adapters reporting healthy status.</div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Collapsible open={isPanelOpen("crypto.com")} onOpenChange={(open) => setPanelOpen("crypto.com", open)}>
          <Card className="animate-fade-up">
            <CardHeader className="pb-0">
              <CollapsibleTrigger asChild>
                <button type="button" className="flex w-full items-start py-5 text-left">
                  <ExchangePanelHeader
                    eyebrow="Private Connection"
                    title="Crypto.com"
                    description={
                      cryptoComConnected
                        ? "Expand for wallet details or to manage the stored Exchange API key."
                        : "Expand to connect a read-enabled Crypto.com Exchange API key."
                    }
                    open={isPanelOpen("crypto.com")}
                    badges={
                      <>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider",
                            statusBadge(cryptoComConnected)
                          )}
                        >
                          {cryptoComConnected ? "Connected" : "Disconnected"}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-border bg-secondary/20 px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                          Source {cryptoComSource}
                        </span>
                      </>
                    }
                  />
                </button>
              </CollapsibleTrigger>
            </CardHeader>

            <CollapsibleContent>
              <CardContent className="space-y-5 pb-5">
                <div className="rounded-xl border border-border bg-secondary/15 p-4 text-sm text-muted-foreground">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
                    <div>
                      Use a Crypto.com Exchange key with read permissions. If the key is IP-whitelisted, allow the backend server's
                      public egress IP, not the local browser or Tailscale address.
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-background/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Connection Summary</div>
                      <div className="mt-2 text-lg font-mono font-semibold text-foreground">
                        {cryptoComConnected ? "Authenticated" : "Needs setup"}
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        {cryptoComConnected
                          ? "Stored Crypto.com credentials are active. Expand the wallet view below or rotate the key if needed."
                          : "Paste a read-only Exchange API key below to connect this venue."}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      {cryptoComConnected ? (
                        <>
                          <Button type="button" variant="outline" onClick={() => setShowCryptoComCredentialForm((current) => !current)}>
                            <KeyRound className="h-4 w-4" />
                            {shouldShowCryptoForm ? "Hide key form" : "Replace key"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => disconnectCryptoComMutation.mutate()}
                            disabled={isCryptoComBusy}
                          >
                            <Link2 className="h-4 w-4" />
                            {disconnectCryptoComMutation.isPending ? "Disconnecting..." : "Disconnect"}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    {cryptoComConnected ? (
                      <>
                        <SummaryMetric label="Available" value={formatUsd(cryptoComOverview?.totalAvailableBalanceUsd)} />
                        <SummaryMetric label="Assets" value={cryptoComOverview?.assets.length ?? 0} />
                        <SummaryMetric label="Source" value={cryptoComSource} />
                        <SummaryMetric label="Synced" value={cryptoComGeneratedAt} helper="Last wallet refresh" />
                      </>
                    ) : (
                      <>
                        <SummaryMetric label="Status" value="Disconnected" />
                        <SummaryMetric label="API Host" value={apiHost} helper="Default production Exchange host" />
                        <SummaryMetric label="Access" value="Read only" helper="Only Can Read is needed" />
                        <SummaryMetric label="Whitelist" value="83.235.110.56" helper="Backend public egress IP" />
                      </>
                    )}
                  </div>
                </div>

                {cryptoComMessage ? (
                  <div className="rounded-lg border border-border bg-secondary/20 px-4 py-3 text-sm text-muted-foreground">
                    {cryptoComMessage}
                  </div>
                ) : null}

                {cryptoComConnected ? (
                  <div className="space-y-4 rounded-2xl border border-border bg-background/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Wallet Snapshot</div>
                        <div className="mt-2 text-sm text-muted-foreground">
                          High-level wallet balances returned by the authenticated Exchange API.
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                      <SummaryMetric label="Available" value={formatUsd(cryptoComOverview?.totalAvailableBalanceUsd)} />
                      <SummaryMetric label="Cash" value={formatUsd(cryptoComOverview?.totalCashBalanceUsd)} />
                      <SummaryMetric label="Collateral" value={formatUsd(cryptoComOverview?.totalCollateralValueUsd)} />
                      <SummaryMetric label="Initial Margin" value={formatUsd(cryptoComOverview?.totalInitialMarginUsd)} />
                      <SummaryMetric label="Maintenance" value={formatUsd(cryptoComOverview?.totalMaintenanceMarginUsd)} />
                    </div>

                    {topBalances.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border bg-secondary/20 px-4 py-8 text-center text-sm text-muted-foreground">
                        No non-zero Crypto.com balances were returned.
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-border">
                        <table className="w-full min-w-[620px]">
                          <thead>
                            <tr className="border-b border-border">
                              {["Asset", "Quantity", "Reserved", "Market Value", "Max Withdraw"].map((heading) => (
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
                            {topBalances.map((asset) => (
                              <tr key={asset.currency} className="border-b border-border last:border-b-0">
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-3">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-secondary/20">
                                      <Wallet className="h-4 w-4 text-primary" />
                                    </div>
                                    <div className="text-sm font-mono font-semibold text-foreground">{asset.currency}</div>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-right text-sm font-mono text-foreground">
                                  {formatToken(asset.quantity, asset.currency)}
                                </td>
                                <td className="px-4 py-3 text-right text-sm font-mono text-foreground">
                                  {formatToken(asset.reservedQuantity, asset.currency)}
                                </td>
                                <td className="px-4 py-3 text-right text-sm font-mono text-foreground">
                                  {formatUsd(asset.marketValueUsd)}
                                </td>
                                <td className="px-4 py-3 text-right text-sm font-mono text-muted-foreground">
                                  {formatToken(asset.maxWithdrawalBalance, asset.currency)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : null}

                {shouldShowCryptoForm ? (
                  <div className="space-y-4 rounded-2xl border border-border bg-background/40 p-4">
                    <div>
                      <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                        {cryptoComConnected ? "Replace Credentials" : "Connect Credentials"}
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        {cryptoComConnected
                          ? "Paste a new Exchange API key pair only when you want to rotate the stored credentials."
                          : "Paste the Crypto.com Exchange API key and one-time secret shown when the key was created."}
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">API Key</label>
                        <Input
                          value={apiKey}
                          onChange={(event) => setApiKey(event.target.value)}
                          className="mt-1 border-border bg-secondary/10 font-mono"
                          placeholder="Paste Crypto.com API key"
                          autoComplete="off"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">API Host</label>
                        <Input
                          value={apiHost}
                          onChange={(event) => setApiHost(event.target.value)}
                          className="mt-1 border-border bg-secondary/10 font-mono"
                          placeholder="https://api.crypto.com"
                          autoComplete="off"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Secret Key</label>
                      <Input
                        type="password"
                        value={apiSecret}
                        onChange={(event) => setApiSecret(event.target.value)}
                        className="mt-1 border-border bg-secondary/10 font-mono"
                        placeholder="Paste Crypto.com secret key"
                        autoComplete="off"
                      />
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <Button
                        type="button"
                        onClick={() => connectCryptoComMutation.mutate()}
                        disabled={isCryptoComBusy || !apiKey.trim() || !apiSecret.trim()}
                        className="bg-primary text-primary-foreground"
                      >
                        <Link2 className="h-4 w-4" />
                        {connectCryptoComMutation.isPending ? "Connecting..." : cryptoComConnected ? "Replace credentials" : "Connect Crypto.com"}
                      </Button>
                      {cryptoComConnected ? (
                        <Button type="button" variant="outline" onClick={() => setShowCryptoComCredentialForm(false)}>
                          Hide form
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {(["kraken", "coinbase"] as const).map((exchange) => {
          const health = healthByExchange.get(exchange);
          const online = health?.status === "online";

          return (
            <Collapsible key={exchange} open={isPanelOpen(exchange)} onOpenChange={(open) => setPanelOpen(exchange, open)}>
              <Card className="animate-fade-up">
                <CardHeader className="pb-0">
                  <CollapsibleTrigger asChild>
                    <button type="button" className="flex w-full items-start py-5 text-left">
                      <ExchangePanelHeader
                        eyebrow="Public Venue"
                        title={formatExchangeLabel(exchange)}
                        description="Expand for public feed health, last update time, and venue-specific market data notes."
                        open={isPanelOpen(exchange)}
                        badges={
                          <>
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider",
                                statusBadge(online)
                              )}
                            >
                              {online ? "Public feed online" : "Public feed offline"}
                            </span>
                            <span className="inline-flex items-center rounded-full border border-border bg-secondary/20 px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                              Updated {formatTimestamp(health?.timestamp)}
                            </span>
                          </>
                        }
                      />
                    </button>
                  </CollapsibleTrigger>
                </CardHeader>

                <CollapsibleContent>
                  <CardContent className="space-y-4 pb-5">
                    <div className="grid gap-3 md:grid-cols-3">
                      <SummaryMetric label="Feed" value={online ? "Online" : "Offline"} />
                      <SummaryMetric label="Updated" value={formatTimestamp(health?.timestamp)} />
                      <SummaryMetric label="Visibility" value="Market Intel" helper="Public market data only" />
                    </div>

                    <div className="rounded-xl border border-border bg-secondary/15 p-4 text-sm text-muted-foreground">
                      <div className="flex items-start gap-3">
                        {online ? <Activity className="mt-0.5 h-4 w-4 text-primary" /> : <WifiOff className="mt-0.5 h-4 w-4 text-negative" />}
                        <div>
                          {health?.message
                            ? health.message
                            : "Market data is available in the Market Intel tab for this venue."}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}

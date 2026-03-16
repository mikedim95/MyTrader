import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useBinanceConnection, useNicehashConnection } from "@/hooks/useTradingData";
import { backendApi } from "@/lib/api";

const otherExchanges = ["Coinbase", "Kraken"];

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Request failed.";
}

function formatSource(source: string): string {
  return source.trim().toUpperCase();
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const queryClient = useQueryClient();
  const { data: binanceConnection } = useBinanceConnection();
  const { data: nicehashConnection } = useNicehashConnection();
  const isBinanceConnected = binanceConnection?.connected ?? false;
  const binanceSource = binanceConnection?.source ?? "none";
  const isTestnet = binanceConnection?.testnet ?? false;
  const isNicehashConnected = nicehashConnection?.connected ?? false;
  const nicehashSource = nicehashConnection?.source ?? "none";

  const [binanceApiKey, setBinanceApiKey] = useState("");
  const [binanceApiSecret, setBinanceApiSecret] = useState("");
  const [testnet, setTestnet] = useState(false);
  const [binanceMessage, setBinanceMessage] = useState<string | null>(null);
  const [nicehashApiKey, setNicehashApiKey] = useState("");
  const [nicehashApiSecret, setNicehashApiSecret] = useState("");
  const [nicehashOrganizationId, setNicehashOrganizationId] = useState("");
  const [nicehashApiHost, setNicehashApiHost] = useState("https://api2.nicehash.com");
  const [nicehashMessage, setNicehashMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const refreshBinanceData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["binance-connection"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["orders"] }),
    ]);
  };

  const refreshNicehashData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["nicehash-connection"] }),
      queryClient.invalidateQueries({ queryKey: ["nicehash-overview"] }),
    ]);
  };

  const connectMutation = useMutation({
    mutationFn: async () => {
      const result = await backendApi.connectBinance({
        apiKey: binanceApiKey.trim(),
        apiSecret: binanceApiSecret.trim(),
        testnet,
      });
      return result;
    },
    onSuccess: async (next) => {
      setBinanceApiSecret("");
      setBinanceMessage(next.connected ? "Binance credentials saved for this user." : next.message ?? "Connection failed.");
      await refreshBinanceData();
    },
    onError: (error) => {
      setBinanceMessage(getErrorMessage(error));
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: backendApi.disconnectBinance,
    onSuccess: async (next) => {
      setBinanceMessage(
        next.connected ? "Stored credentials removed. Environment credentials are still active." : "Stored Binance credentials removed."
      );
      await refreshBinanceData();
    },
    onError: (error) => {
      setBinanceMessage(getErrorMessage(error));
    },
  });

  const connectNicehashMutation = useMutation({
    mutationFn: async () => {
      const result = await backendApi.connectNicehash({
        apiKey: nicehashApiKey.trim(),
        apiSecret: nicehashApiSecret.trim(),
        organizationId: nicehashOrganizationId.trim(),
        apiHost: nicehashApiHost.trim(),
      });
      return result;
    },
    onSuccess: async (next) => {
      setNicehashApiSecret("");
      setNicehashMessage(next.connected ? "NiceHash credentials saved for this user." : next.message ?? "Connection failed.");
      await refreshNicehashData();
    },
    onError: (error) => {
      setNicehashMessage(getErrorMessage(error));
    },
  });

  const disconnectNicehashMutation = useMutation({
    mutationFn: backendApi.disconnectNicehash,
    onSuccess: async (next) => {
      setNicehashMessage(
        next.connected ? "Stored credentials removed. Environment credentials are still active." : "Stored NiceHash credentials removed."
      );
      await refreshNicehashData();
    },
    onError: (error) => {
      setNicehashMessage(getErrorMessage(error));
    },
  });

  if (!open) return null;

  const isBinanceBusy = connectMutation.isPending || disconnectMutation.isPending;
  const isNicehashBusy = connectNicehashMutation.isPending || disconnectNicehashMutation.isPending;

  const cardClassName = "rounded-xl border border-border bg-card p-4 sm:p-5 space-y-4";
  const inputClassName =
    "mt-1 w-full rounded-md border border-border bg-secondary px-3 py-3 font-mono text-sm text-foreground outline-none transition-colors focus:border-primary";
  const buttonRowClassName = "flex flex-col gap-2 sm:flex-row";
  const primaryButtonClassName =
    "w-full sm:w-auto px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-mono font-semibold hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed";
  const secondaryButtonClassName =
    "w-full sm:w-auto px-4 py-2.5 rounded-md border border-border text-sm font-mono text-foreground hover:bg-secondary transition-colors disabled:opacity-60 disabled:cursor-not-allowed";

  return (
    <div className="fixed inset-0 z-[70] animate-overlay-fade" onClick={onClose}>
      <div className="absolute inset-0 bg-background/80 backdrop-blur-md" />
      <div className="relative flex h-full w-full items-end justify-center sm:items-center p-0 sm:p-4 md:p-6">
        <div
          className="flex h-full w-full flex-col overflow-hidden rounded-none border border-border bg-[linear-gradient(180deg,_hsl(var(--card))_0%,_hsl(var(--secondary)/0.4)_100%)] shadow-2xl animate-fade-scale-in sm:h-auto sm:max-h-[calc(100vh-3rem)] sm:max-w-4xl sm:rounded-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-card/95 px-4 py-4 backdrop-blur sm:px-6">
            <div className="min-w-0">
              <div className="text-[11px] font-mono uppercase tracking-[0.26em] text-muted-foreground">Settings</div>
              <h3 className="mt-2 text-lg sm:text-xl font-semibold text-foreground">User-scoped integrations</h3>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Manage exchange and mining credentials without leaving the current workspace.
              </p>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-lg border border-border bg-secondary/40 p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              aria-label="Close settings"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
            <div className="mx-auto w-full max-w-3xl space-y-4 sm:space-y-5">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">User-scoped connections</div>

              <div className={cardClassName}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-mono font-semibold text-foreground">Binance</div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Source: {formatSource(binanceSource)} {isTestnet ? "(Testnet)" : "(Mainnet)"}
                    </div>
                  </div>
                  <span
                    className={`inline-flex w-fit text-[11px] font-mono px-2.5 py-1 rounded ${
                      isBinanceConnected ? "bg-positive/10 text-positive" : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {isBinanceConnected ? "Connected" : "Disconnected"}
                  </span>
                </div>

                {binanceConnection?.message ? <div className="text-xs text-muted-foreground">{binanceConnection.message}</div> : null}

                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">API Key</label>
                    <input
                      value={binanceApiKey}
                      onChange={(event) => setBinanceApiKey(event.target.value)}
                      className={inputClassName}
                      placeholder="Enter Binance API key..."
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">API Secret</label>
                    <input
                      type="password"
                      value={binanceApiSecret}
                      onChange={(event) => setBinanceApiSecret(event.target.value)}
                      className={inputClassName}
                      placeholder="Enter Binance API secret..."
                      autoComplete="off"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input type="checkbox" checked={testnet} onChange={(event) => setTestnet(event.target.checked)} className="h-4 w-4 shrink-0" />
                    Use Binance testnet
                  </label>
                </div>

                <div className={buttonRowClassName}>
                  <button
                    onClick={() => connectMutation.mutate()}
                    disabled={isBinanceBusy || !binanceApiKey.trim() || !binanceApiSecret.trim()}
                    className={primaryButtonClassName}
                  >
                    {connectMutation.isPending ? "Connecting..." : "Connect"}
                  </button>
                  <button onClick={() => disconnectMutation.mutate()} disabled={isBinanceBusy} className={secondaryButtonClassName}>
                    {disconnectMutation.isPending ? "Disconnecting..." : "Disconnect"}
                  </button>
                </div>

                {binanceMessage ? <div className="text-xs text-muted-foreground">{binanceMessage}</div> : null}
              </div>

              <div className={cardClassName}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-mono font-semibold text-foreground">NiceHash</div>
                    <div className="mt-2 text-xs text-muted-foreground">Source: {formatSource(nicehashSource)}</div>
                  </div>
                  <span
                    className={`inline-flex w-fit text-[11px] font-mono px-2.5 py-1 rounded ${
                      isNicehashConnected ? "bg-positive/10 text-positive" : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {isNicehashConnected ? "Connected" : "Disconnected"}
                  </span>
                </div>

                {nicehashConnection?.message ? <div className="text-xs text-muted-foreground">{nicehashConnection.message}</div> : null}

                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">API Key</label>
                    <input
                      value={nicehashApiKey}
                      onChange={(event) => setNicehashApiKey(event.target.value)}
                      className={inputClassName}
                      placeholder="Enter NiceHash API key..."
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">API Secret</label>
                    <input
                      type="password"
                      value={nicehashApiSecret}
                      onChange={(event) => setNicehashApiSecret(event.target.value)}
                      className={inputClassName}
                      placeholder="Enter NiceHash API secret..."
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Organization ID</label>
                    <input
                      value={nicehashOrganizationId}
                      onChange={(event) => setNicehashOrganizationId(event.target.value)}
                      className={inputClassName}
                      placeholder="Enter NiceHash organization ID..."
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">API Host</label>
                    <input
                      value={nicehashApiHost}
                      onChange={(event) => setNicehashApiHost(event.target.value)}
                      className={inputClassName}
                      placeholder="https://api2.nicehash.com"
                      autoComplete="off"
                    />
                  </div>
                </div>

                <div className={buttonRowClassName}>
                  <button
                    onClick={() => connectNicehashMutation.mutate()}
                    disabled={
                      isNicehashBusy || !nicehashApiKey.trim() || !nicehashApiSecret.trim() || !nicehashOrganizationId.trim()
                    }
                    className={primaryButtonClassName}
                  >
                    {connectNicehashMutation.isPending ? "Connecting..." : "Connect"}
                  </button>
                  <button onClick={() => disconnectNicehashMutation.mutate()} disabled={isNicehashBusy} className={secondaryButtonClassName}>
                    {disconnectNicehashMutation.isPending ? "Disconnecting..." : "Disconnect"}
                  </button>
                </div>

                {nicehashMessage ? <div className="text-xs text-muted-foreground">{nicehashMessage}</div> : null}
              </div>

              {otherExchanges.map((exchange) => (
                <div key={exchange} className="rounded-xl border border-border bg-card p-4 sm:p-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm font-mono text-foreground">{exchange}</span>
                    <span className="inline-flex w-fit text-[11px] font-mono px-2.5 py-1 rounded bg-secondary text-muted-foreground">
                      Coming soon
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

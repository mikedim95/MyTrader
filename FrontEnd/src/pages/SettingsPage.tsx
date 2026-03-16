import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useBinanceConnection, useNicehashConnection } from "@/hooks/useTradingData";
import { backendApi } from "@/lib/api";

const otherExchanges = ["Coinbase", "Kraken"];

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Request failed.";
}

function formatSource(source: string): string {
  return source.trim().toUpperCase();
}

export function SettingsPage() {
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
      setBinanceMessage(next.connected ? "Stored credentials removed. Environment credentials are still active." : "Stored Binance credentials removed.");
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
      setNicehashMessage(next.connected ? "Stored credentials removed. Environment credentials are still active." : "Stored NiceHash credentials removed.");
      await refreshNicehashData();
    },
    onError: (error) => {
      setNicehashMessage(getErrorMessage(error));
    },
  });

  const isBinanceBusy = connectMutation.isPending || disconnectMutation.isPending;
  const isNicehashBusy = connectNicehashMutation.isPending || disconnectNicehashMutation.isPending;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h2 className="text-lg md:text-xl font-mono font-semibold text-foreground">Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">Manage per-user exchange and mining credentials.</p>
      </div>

      <div className="space-y-4 max-w-2xl stagger-children">
        <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">User-Scoped Connections</div>

        <div className="bg-card border border-border rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-mono font-semibold text-foreground">Binance</span>
            <span className={`text-[11px] font-mono px-2.5 py-1 rounded ${isBinanceConnected ? "bg-positive/10 text-positive" : "bg-secondary text-muted-foreground"}`}>
              {isBinanceConnected ? "Connected" : "Disconnected"}
            </span>
          </div>

          <div className="text-xs text-muted-foreground">
            Source: {formatSource(binanceSource)} {isTestnet ? "(Testnet)" : "(Mainnet)"}
          </div>

          {binanceConnection?.message ? (
            <div className="text-xs text-muted-foreground">{binanceConnection.message}</div>
          ) : null}

          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">API Key</label>
              <input
                value={binanceApiKey}
                onChange={(event) => setBinanceApiKey(event.target.value)}
                className="mt-1 w-full bg-secondary rounded-md px-3 py-3 font-mono text-sm text-foreground outline-none border border-border focus:border-primary transition-colors"
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
                className="mt-1 w-full bg-secondary rounded-md px-3 py-3 font-mono text-sm text-foreground outline-none border border-border focus:border-primary transition-colors"
                placeholder="Enter Binance API secret..."
                autoComplete="off"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={testnet}
                onChange={(event) => setTestnet(event.target.checked)}
                className="h-4 w-4"
              />
              Use Binance testnet
            </label>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => connectMutation.mutate()}
              disabled={isBinanceBusy || !binanceApiKey.trim() || !binanceApiSecret.trim()}
              className="px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-mono font-semibold hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {connectMutation.isPending ? "Connecting..." : "Connect"}
            </button>
            <button
              onClick={() => disconnectMutation.mutate()}
              disabled={isBinanceBusy}
              className="px-4 py-2.5 rounded-md border border-border text-sm font-mono text-foreground hover:bg-secondary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {disconnectMutation.isPending ? "Disconnecting..." : "Disconnect"}
            </button>
          </div>

          {binanceMessage ? <div className="text-xs text-muted-foreground">{binanceMessage}</div> : null}
        </div>

        <div className="bg-card border border-border rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-mono font-semibold text-foreground">NiceHash</span>
            <span className={`text-[11px] font-mono px-2.5 py-1 rounded ${isNicehashConnected ? "bg-positive/10 text-positive" : "bg-secondary text-muted-foreground"}`}>
              {isNicehashConnected ? "Connected" : "Disconnected"}
            </span>
          </div>

          <div className="text-xs text-muted-foreground">
            Source: {formatSource(nicehashSource)}
          </div>

          {nicehashConnection?.message ? (
            <div className="text-xs text-muted-foreground">{nicehashConnection.message}</div>
          ) : null}

          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">API Key</label>
              <input
                value={nicehashApiKey}
                onChange={(event) => setNicehashApiKey(event.target.value)}
                className="mt-1 w-full bg-secondary rounded-md px-3 py-3 font-mono text-sm text-foreground outline-none border border-border focus:border-primary transition-colors"
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
                className="mt-1 w-full bg-secondary rounded-md px-3 py-3 font-mono text-sm text-foreground outline-none border border-border focus:border-primary transition-colors"
                placeholder="Enter NiceHash API secret..."
                autoComplete="off"
              />
            </div>
            <div>
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Organization ID</label>
              <input
                value={nicehashOrganizationId}
                onChange={(event) => setNicehashOrganizationId(event.target.value)}
                className="mt-1 w-full bg-secondary rounded-md px-3 py-3 font-mono text-sm text-foreground outline-none border border-border focus:border-primary transition-colors"
                placeholder="Enter NiceHash organization ID..."
                autoComplete="off"
              />
            </div>
            <div>
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">API Host</label>
              <input
                value={nicehashApiHost}
                onChange={(event) => setNicehashApiHost(event.target.value)}
                className="mt-1 w-full bg-secondary rounded-md px-3 py-3 font-mono text-sm text-foreground outline-none border border-border focus:border-primary transition-colors"
                placeholder="https://api2.nicehash.com"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => connectNicehashMutation.mutate()}
              disabled={isNicehashBusy || !nicehashApiKey.trim() || !nicehashApiSecret.trim() || !nicehashOrganizationId.trim()}
              className="px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-mono font-semibold hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {connectNicehashMutation.isPending ? "Connecting..." : "Connect"}
            </button>
            <button
              onClick={() => disconnectNicehashMutation.mutate()}
              disabled={isNicehashBusy}
              className="px-4 py-2.5 rounded-md border border-border text-sm font-mono text-foreground hover:bg-secondary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {disconnectNicehashMutation.isPending ? "Disconnecting..." : "Disconnect"}
            </button>
          </div>

          {nicehashMessage ? <div className="text-xs text-muted-foreground">{nicehashMessage}</div> : null}
        </div>

        {otherExchanges.map((exchange) => (
          <div key={exchange} className="bg-card border border-border rounded-lg p-5 flex items-center justify-between">
            <span className="text-sm font-mono text-foreground">{exchange}</span>
            <span className="text-[11px] font-mono px-2.5 py-1 rounded bg-secondary text-muted-foreground">Coming soon</span>
          </div>
        ))}
      </div>
    </div>
  );
}

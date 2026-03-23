import crypto from "node:crypto";
import type { StrategyUserScope } from "./strategy/strategy-user-scope.js";
import type {
  ConnectionSource,
  CryptoComAssetBalance,
  CryptoComConnectionStatus,
  CryptoComCredentials,
  CryptoComOverviewResponse,
} from "./types.js";
import { userCredentialStore } from "./user-credentials/user-credential-store.js";

const DEFAULT_API_HOST = "https://api.crypto.com";
const MAX_SIGNATURE_DEPTH = 3;

interface CryptoComEnvelope<T> {
  id?: unknown;
  method?: unknown;
  code?: unknown;
  message?: unknown;
  result?: T;
}

interface CryptoComBalancePosition {
  instrument_name?: unknown;
  quantity?: unknown;
  market_value?: unknown;
  collateral_amount?: unknown;
  max_withdrawal_balance?: unknown;
  reserved_qty?: unknown;
}

interface CryptoComBalanceEntry {
  total_available_balance?: unknown;
  total_cash_balance?: unknown;
  total_collateral_value?: unknown;
  total_initial_margin?: unknown;
  total_maintenance_margin?: unknown;
  position_balances?: unknown;
}

interface UserBalanceResult {
  data?: unknown;
}

function parseString(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stringFromUnknown(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function round(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

function roundNullable(value: number | null, decimals: number): number | null {
  if (value === null) return null;
  return round(value, decimals);
}

function getObject(input: unknown): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

function normalizeApiHost(value: string | undefined): string {
  const trimmed = (value ?? DEFAULT_API_HOST).trim().replace(/\/+$/, "");
  return trimmed.endsWith("/exchange/v1") ? trimmed.slice(0, -"/exchange/v1".length) : trimmed;
}

function getCredentialsFromEnv(): CryptoComCredentials | null {
  const apiKey = parseString(process.env.CRYPTO_COM_API_KEY);
  const apiSecret = parseString(process.env.CRYPTO_COM_API_SECRET);
  const apiHost = normalizeApiHost(process.env.CRYPTO_COM_API_HOST);

  if (!apiKey || !apiSecret) return null;

  return {
    apiKey,
    apiSecret,
    apiHost,
  };
}

async function resolveCredentials(
  userScope?: StrategyUserScope
): Promise<{ credentials: CryptoComCredentials | null; source: ConnectionSource; message?: string }> {
  if (userScope) {
    const lookup = await userCredentialStore.getCryptoComCredentials(userScope);
    if (lookup.exists) {
      if (!lookup.value) {
        return {
          credentials: null,
          source: "stored",
          message: lookup.error ?? "Stored Crypto.com credentials are unavailable.",
        };
      }

      return {
        credentials: lookup.value,
        source: "stored",
      };
    }
  }

  const envCredentials = getCredentialsFromEnv();
  if (envCredentials) {
    return {
      credentials: envCredentials,
      source: "env",
    };
  }

  return {
    credentials: null,
    source: "none",
  };
}

function paramsToString(value: unknown, level = 0): string {
  if (level >= MAX_SIGNATURE_DEPTH) {
    return value == null ? "" : String(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => paramsToString(entry, level + 1)).join("");
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${key}${paramsToString((value as Record<string, unknown>)[key], level + 1)}`)
      .join("");
  }

  return value == null ? "" : String(value);
}

function signPayload(
  method: string,
  id: number,
  apiKey: string,
  params: Record<string, unknown>,
  nonce: number,
  secret: string
): string {
  const payload = `${method}${id}${apiKey}${paramsToString(params)}${nonce}`;
  return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

async function signedPost<T>(
  credentials: CryptoComCredentials,
  method: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const id = Date.now();
  const nonce = Date.now();
  const body = {
    id,
    method,
    api_key: credentials.apiKey,
    params,
    nonce,
    sig: signPayload(method, id, credentials.apiKey, params, nonce, credentials.apiSecret),
  };

  const response = await fetch(`${normalizeApiHost(credentials.apiHost)}/exchange/v1/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "MyTraderBackend",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as CryptoComEnvelope<T>;
  const code = parseNumber(payload.code);

  if (!response.ok) {
    throw new Error(stringFromUnknown(payload.message) ?? `Crypto.com request failed (${response.status}).`);
  }

  if (code !== 0) {
    throw new Error(stringFromUnknown(payload.message) ?? `Crypto.com returned code ${payload.code ?? "unknown"}.`);
  }

  if (payload.result === undefined) {
    throw new Error("Crypto.com returned an empty result.");
  }

  return payload.result;
}

function mapBalanceEntry(entry: unknown): CryptoComAssetBalance | null {
  const obj = getObject(entry);
  if (!obj) return null;

  const currency = stringFromUnknown(obj.instrument_name);
  if (!currency) return null;

  return {
    currency,
    quantity: roundNullable(parseNumber(obj.quantity), 8),
    marketValueUsd: roundNullable(parseNumber(obj.market_value), 8),
    collateralAmountUsd: roundNullable(parseNumber(obj.collateral_amount), 8),
    maxWithdrawalBalance: roundNullable(parseNumber(obj.max_withdrawal_balance), 8),
    reservedQuantity: roundNullable(parseNumber(obj.reserved_qty), 8),
  };
}

function sortBalances(balances: CryptoComAssetBalance[]): CryptoComAssetBalance[] {
  return [...balances].sort((left, right) => {
    const rightValue = right.marketValueUsd ?? 0;
    const leftValue = left.marketValueUsd ?? 0;
    if (rightValue !== leftValue) return rightValue - leftValue;
    return left.currency.localeCompare(right.currency);
  });
}

async function fetchUserBalance(credentials: CryptoComCredentials): Promise<CryptoComBalanceEntry> {
  const result = await signedPost<UserBalanceResult>(credentials, "private/user-balance", {});
  const data = Array.isArray(result.data) ? result.data : [];
  const entry = getObject(data[0]);
  if (!entry) {
    throw new Error("Crypto.com user-balance response did not include account data.");
  }
  return entry as CryptoComBalanceEntry;
}

export async function validateCryptoComCredentials(credentials: CryptoComCredentials): Promise<void> {
  await fetchUserBalance({
    ...credentials,
    apiHost: normalizeApiHost(credentials.apiHost),
  });
}

export async function getCryptoComConnectionStatus(userScope?: StrategyUserScope): Promise<CryptoComConnectionStatus> {
  const { credentials, source, message } = await resolveCredentials(userScope);
  if (!credentials) {
    return {
      connected: false,
      source,
      message: message ?? "No Crypto.com API credentials configured.",
    };
  }

  try {
    await validateCryptoComCredentials(credentials);
    return {
      connected: true,
      source,
    };
  } catch (error) {
    return {
      connected: false,
      source,
      message: error instanceof Error ? error.message : "Unable to connect to Crypto.com.",
    };
  }
}

export async function storeCryptoComCredentials(
  userScope: StrategyUserScope,
  credentials: CryptoComCredentials
): Promise<CryptoComConnectionStatus> {
  const normalized = {
    ...credentials,
    apiHost: normalizeApiHost(credentials.apiHost),
  };
  await userCredentialStore.storeCryptoComCredentials(normalized, userScope);
  return getCryptoComConnectionStatus(userScope);
}

export async function clearCryptoComCredentials(userScope: StrategyUserScope): Promise<CryptoComConnectionStatus> {
  await userCredentialStore.deleteCryptoComCredentials(userScope);
  return getCryptoComConnectionStatus(userScope);
}

export async function getCryptoComOverview(userScope?: StrategyUserScope): Promise<CryptoComOverviewResponse> {
  const { credentials, source, message } = await resolveCredentials(userScope);
  if (!credentials) {
    return {
      source,
      connected: false,
      message: message ?? "No Crypto.com API credentials configured.",
      totalAvailableBalanceUsd: null,
      totalCashBalanceUsd: null,
      totalCollateralValueUsd: null,
      totalInitialMarginUsd: null,
      totalMaintenanceMarginUsd: null,
      assets: [],
      generatedAt: new Date().toISOString(),
    };
  }

  try {
    const entry = await fetchUserBalance(credentials);
    const balances = sortBalances(
      (Array.isArray(entry.position_balances) ? entry.position_balances : [])
        .map((balance) => mapBalanceEntry(balance))
        .filter((balance): balance is CryptoComAssetBalance => balance !== null)
        .filter(
          (balance) =>
            (balance.quantity ?? 0) > 0 ||
            (balance.marketValueUsd ?? 0) > 0 ||
            (balance.reservedQuantity ?? 0) > 0
        )
    );

    return {
      source,
      connected: true,
      totalAvailableBalanceUsd: roundNullable(parseNumber(entry.total_available_balance), 8),
      totalCashBalanceUsd: roundNullable(parseNumber(entry.total_cash_balance), 8),
      totalCollateralValueUsd: roundNullable(parseNumber(entry.total_collateral_value), 8),
      totalInitialMarginUsd: roundNullable(parseNumber(entry.total_initial_margin), 8),
      totalMaintenanceMarginUsd: roundNullable(parseNumber(entry.total_maintenance_margin), 8),
      assets: balances,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      source,
      connected: false,
      message: error instanceof Error ? error.message : "Unable to load Crypto.com balances.",
      totalAvailableBalanceUsd: null,
      totalCashBalanceUsd: null,
      totalCollateralValueUsd: null,
      totalInitialMarginUsd: null,
      totalMaintenanceMarginUsd: null,
      assets: [],
      generatedAt: new Date().toISOString(),
    };
  }
}

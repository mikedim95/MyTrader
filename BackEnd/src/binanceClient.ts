import crypto from "node:crypto";
import { BinanceCredentials, ConnectionSource, ConnectionStatus } from "./types.js";
import type { StrategyUserScope } from "./strategy/strategy-user-scope.js";
import { userCredentialStore } from "./user-credentials/user-credential-store.js";

const BINANCE_PROD_BASE_URL = "https://api.binance.com";
const BINANCE_TESTNET_BASE_URL = "https://testnet.binance.vision";
const DEFAULT_RECV_WINDOW = 5000;
const DEFAULT_REQUEST_TIMEOUT_MS = Number.parseInt(process.env.BINANCE_REQUEST_TIMEOUT_MS ?? "", 10) > 0
  ? Number.parseInt(process.env.BINANCE_REQUEST_TIMEOUT_MS ?? "", 10)
  : 5000;

let sessionCredentials: BinanceCredentials | null = null;

function parseBoolean(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined) return defaultValue;
  return value.trim().toLowerCase() === "true";
}

function getEnvCredentials(): BinanceCredentials | null {
  const apiKey = process.env.BINANCE_API_KEY?.trim() ?? "";
  const apiSecret = process.env.BINANCE_API_SECRET?.trim() ?? "";

  if (!apiKey || !apiSecret) return null;

  return {
    apiKey,
    apiSecret,
    testnet: parseBoolean(process.env.BINANCE_TESTNET, false),
  };
}

export function setSessionCredentials(credentials: BinanceCredentials): void {
  sessionCredentials = credentials;
}

export function clearSessionCredentials(): void {
  sessionCredentials = null;
}

async function resolveStoredCredentials(
  userScope?: StrategyUserScope
): Promise<{ credentials: BinanceCredentials | null; source: ConnectionSource; message?: string }> {
  if (!userScope) {
    return { credentials: null, source: "none" };
  }

  const lookup = await userCredentialStore.getBinanceCredentials(userScope);
  if (!lookup.exists) {
    return { credentials: null, source: "none" };
  }

  if (!lookup.value) {
    return {
      credentials: null,
      source: "stored",
      message: lookup.error ?? "Stored Binance credentials are unavailable.",
    };
  }

  return {
    credentials: lookup.value,
    source: "stored",
  };
}

export async function getActiveCredentials(
  userScope?: StrategyUserScope
): Promise<{ credentials: BinanceCredentials | null; source: ConnectionSource; message?: string }> {
  const stored = await resolveStoredCredentials(userScope);
  if (stored.source === "stored") {
    return stored;
  }

  const envCredentials = getEnvCredentials();
  if (envCredentials) {
    return { credentials: envCredentials, source: "env" };
  }

  return { credentials: null, source: "none" };
}

function toUrlSearchParams(params: Record<string, string | number | boolean | undefined>): URLSearchParams {
  const urlParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined) return;
    urlParams.set(key, String(value));
  });

  return urlParams;
}

function getBaseUrl(credentials: BinanceCredentials | null): string {
  if (credentials?.testnet) return BINANCE_TESTNET_BASE_URL;
  return BINANCE_PROD_BASE_URL;
}

function parseJsonSafely(input: string): unknown {
  if (!input) return null;

  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

type RequestParams = Record<string, string | number | boolean | undefined>;

interface BinanceRequestOptions {
  path: string;
  params?: RequestParams;
  signed?: boolean;
  credentials?: BinanceCredentials | null;
}

async function requestBinance<T>(options: BinanceRequestOptions): Promise<T> {
  const { path, params = {}, signed = false, credentials = null } = options;

  if (signed && !credentials) {
    throw new Error("Binance credentials are not configured.");
  }

  const baseUrl = getBaseUrl(credentials ?? null);
  const url = new URL(path, baseUrl);
  const urlParams = toUrlSearchParams(params);

  if (signed && credentials) {
    urlParams.set("timestamp", Date.now().toString());
    urlParams.set("recvWindow", String(DEFAULT_RECV_WINDOW));

    const signature = crypto
      .createHmac("sha256", credentials.apiSecret)
      .update(urlParams.toString())
      .digest("hex");

    urlParams.set("signature", signature);
  }

  url.search = urlParams.toString();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (signed && credentials) {
    headers["X-MBX-APIKEY"] = credentials.apiKey;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);

  let response: Response;
  let bodyText = "";
  let parsed: unknown = null;

  try {
    response = await fetch(url, { method: "GET", headers, signal: controller.signal });
    bodyText = await response.text();
    parsed = parseJsonSafely(bodyText);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Binance request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const message =
      typeof parsed === "object" &&
      parsed !== null &&
      "msg" in parsed &&
      typeof (parsed as { msg: unknown }).msg === "string"
        ? (parsed as { msg: string }).msg
        : `Binance request failed (${response.status}).`;

    throw new Error(message);
  }

  return parsed as T;
}

export function publicGet<T>(
  path: string,
  params: RequestParams = {},
  credentials: BinanceCredentials | null = null
): Promise<T> {
  return requestBinance<T>({
    path,
    params,
    signed: false,
    credentials,
  });
}

export function signedGet<T>(
  path: string,
  params: RequestParams,
  credentials: BinanceCredentials
): Promise<T> {
  return requestBinance<T>({
    path,
    params,
    signed: true,
    credentials,
  });
}

export async function validateCredentials(credentials: BinanceCredentials): Promise<void> {
  await signedGet<{ makerCommission: number }>("/api/v3/account", {}, credentials);
}

export async function getConnectionStatus(userScope?: StrategyUserScope): Promise<ConnectionStatus> {
  const { credentials, source, message } = await getActiveCredentials(userScope);

  if (!credentials) {
    return {
      connected: false,
      source,
      testnet: false,
      message: message ?? "No Binance API credentials configured.",
    };
  }

  try {
    await validateCredentials(credentials);
    return {
      connected: true,
      source,
      testnet: credentials.testnet,
    };
  } catch (error) {
    return {
      connected: false,
      source,
      testnet: credentials.testnet,
      message: error instanceof Error ? error.message : "Unable to validate Binance credentials.",
    };
  }
}

export async function storeUserCredentials(
  userScope: StrategyUserScope,
  credentials: BinanceCredentials
): Promise<ConnectionStatus> {
  await userCredentialStore.storeBinanceCredentials(credentials, userScope);
  return getConnectionStatus(userScope);
}

export async function clearUserCredentials(userScope: StrategyUserScope): Promise<ConnectionStatus> {
  await userCredentialStore.deleteBinanceCredentials(userScope);
  return getConnectionStatus(userScope);
}

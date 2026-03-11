import crypto from "node:crypto";
import { MinerBasicInfo, NicehashAssetBalance } from "./types.js";

const DEFAULT_API_HOST = "https://api2.nicehash.com";
const TIME_OFFSET_CACHE_MS = 60_000;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_FETCH = 20;

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

interface NicehashCredentials {
  apiKey: string;
  apiSecret: string;
  organizationId: string;
  apiHost: string;
}

interface TimeResponse {
  serverTime?: unknown;
}

interface RawNicehashBalance {
  currency?: unknown;
  available?: unknown;
  pending?: unknown;
  totalBalance?: unknown;
  btcRate?: unknown;
}

interface AccountsResponse {
  total?: RawNicehashBalance;
  currencies?: unknown;
  message?: unknown;
  error?: unknown;
}

interface AlgorithmsResponse {
  miningAlgorithms?: unknown;
}

interface RigsResponse {
  totalRigs?: unknown;
  totalProfitability?: unknown;
  totalProfitabilityLocal?: unknown;
  unpaidAmount?: unknown;
  devicesStatuses?: unknown;
  btcAddress?: unknown;
  miningRigs?: unknown;
  pagination?: unknown;
}

interface ActiveWorkersResponse {
  workers?: unknown;
  pagination?: unknown;
}

interface MiningAddressResponse {
  address?: unknown;
}

interface ParsedRigsData {
  rigs: Record<string, unknown>[];
  totalRigs: number | null;
  activeMiners: number | null;
  totalProfitabilityBTC: number | null;
  totalProfitabilityLocal: number | null;
  unpaidAmountBTC: number | null;
  miningAddress: string | null;
}

interface AlgorithmMeta {
  label: string | null;
  unit: string | null;
}

export interface NicehashAccountSnapshot {
  source: "none" | "env";
  connected: boolean;
  message?: string;
  totalBtc: number | null;
  assets: NicehashAssetBalance[];
}

export interface NicehashMiningSnapshot {
  source: "none" | "env";
  connected: boolean;
  message?: string;
  miningAddress: string | null;
  assignedMiners: number | null;
  activeMiners: number | null;
  hashrateTH: number | null;
  totalProfitabilityBTC: number | null;
  totalProfitabilityLocal: number | null;
  unpaidAmountBTC: number | null;
  algorithm: string | null;
  miners: MinerBasicInfo[];
}

let timeOffsetCache: { apiHost: string; offsetMs: number; expiresAt: number } | null = null;

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

function parseInteger(value: unknown): number | null {
  const parsed = parseNumber(value);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed)) return null;
  return parsed;
}

function round(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

function roundNullable(value: number | null, decimals: number): number | null {
  if (value === null) return null;
  return round(value, decimals);
}

function sumNullableNumbers(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0);
}

function parseJsonSafely(input: string): unknown {
  if (!input) return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function getObject(input: unknown): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

function getErrorMessage(payload: unknown): string | null {
  const obj = getObject(payload);
  if (!obj) return null;

  if (typeof obj.message === "string" && obj.message.trim().length > 0) {
    return obj.message.trim();
  }

  if (typeof obj.error === "string" && obj.error.trim().length > 0) {
    return obj.error.trim();
  }

  if (Array.isArray(obj.errors)) {
    for (const entry of obj.errors) {
      if (typeof entry === "string" && entry.trim().length > 0) {
        return entry.trim();
      }

      const errorObj = getObject(entry);
      if (!errorObj) continue;

      if (typeof errorObj.message === "string" && errorObj.message.trim().length > 0) {
        return errorObj.message.trim();
      }

      if (typeof errorObj.error === "string" && errorObj.error.trim().length > 0) {
        return errorObj.error.trim();
      }
    }
  }

  return null;
}

function getCredentialsFromEnv(): NicehashCredentials | null {
  const apiKey = parseString(process.env.NICEHASH_API_KEY);
  const apiSecret = parseString(process.env.NICEHASH_API_SECRET);
  const organizationId =
    parseString(process.env.NICEHASH_ORG_ID) ?? parseString(process.env.NICEHASH_ORGANIZATION_ID);
  const configuredHost = parseString(process.env.NICEHASH_API_HOST) ?? DEFAULT_API_HOST;

  if (!apiKey || !apiSecret || !organizationId) return null;

  return {
    apiKey,
    apiSecret,
    organizationId,
    apiHost: configuredHost.replace(/\/+$/, ""),
  };
}

function buildQueryString(query: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  const entries = Object.entries(query).filter(([, value]) => value !== undefined);
  entries.sort(([left], [right]) => left.localeCompare(right));

  entries.forEach(([key, value]) => {
    params.set(key, String(value));
  });

  return params.toString();
}

function createAuthHeader(
  credentials: NicehashCredentials,
  method: HttpMethod,
  path: string,
  queryString: string,
  timestamp: string,
  nonce: string,
  body: string | null = null
): string {
  const hmac = crypto.createHmac("sha256", credentials.apiSecret);

  hmac.update(credentials.apiKey);
  hmac.update("\0");
  hmac.update(timestamp);
  hmac.update("\0");
  hmac.update(nonce);
  hmac.update("\0");
  hmac.update("\0");
  hmac.update(credentials.organizationId);
  hmac.update("\0");
  hmac.update("\0");
  hmac.update(method);
  hmac.update("\0");
  hmac.update(path);
  hmac.update("\0");

  if (queryString) {
    hmac.update(queryString);
  }

  if (body) {
    hmac.update("\0");
    hmac.update(body);
  }

  return `${credentials.apiKey}:${hmac.digest("hex")}`;
}

async function getTimeOffsetMs(apiHost: string): Promise<number> {
  const now = Date.now();
  if (timeOffsetCache && timeOffsetCache.apiHost === apiHost && timeOffsetCache.expiresAt > now) {
    return timeOffsetCache.offsetMs;
  }

  const response = await fetch(`${apiHost}/api/v2/time`);
  const bodyText = await response.text();
  const payload = parseJsonSafely(bodyText) as TimeResponse;

  if (!response.ok) {
    const message = getErrorMessage(payload) ?? `NiceHash time request failed (${response.status}).`;
    throw new Error(message);
  }

  const serverTime = parseNumber(payload.serverTime);
  if (serverTime === null) {
    throw new Error("NiceHash time response did not include serverTime.");
  }

  const offsetMs = serverTime - now;
  timeOffsetCache = {
    apiHost,
    offsetMs,
    expiresAt: now + TIME_OFFSET_CACHE_MS,
  };

  return offsetMs;
}

async function signedGet<T>(
  credentials: NicehashCredentials,
  path: string,
  query: Record<string, string | number | boolean | undefined> = {}
): Promise<T> {
  const queryString = buildQueryString(query);
  const offsetMs = await getTimeOffsetMs(credentials.apiHost);
  const timestamp = String(Date.now() + offsetMs);
  const nonce = crypto.randomBytes(16).toString("hex");
  const authHeader = createAuthHeader(credentials, "GET", path, queryString, timestamp, nonce);

  const requestUrl = new URL(`${credentials.apiHost}${path}`);
  if (queryString) {
    requestUrl.search = queryString;
  }

  const response = await fetch(requestUrl, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": nonce,
      "X-Time": timestamp,
      "X-Nonce": nonce,
      "X-User-Agent": "MyTraderBackend",
      "X-Organization-Id": credentials.organizationId,
      "X-Auth": authHeader,
    },
  });

  const bodyText = await response.text();
  const payload = parseJsonSafely(bodyText);

  if (!response.ok) {
    const message = getErrorMessage(payload) ?? `NiceHash request failed (${response.status}).`;
    throw new Error(message);
  }

  return payload as T;
}

function toAssetBalance(input: unknown): NicehashAssetBalance | null {
  const obj = getObject(input);
  if (!obj) return null;

  const currency = typeof obj.currency === "string" ? obj.currency.trim() : "";
  if (!currency) return null;

  return {
    currency,
    available: parseNumber(obj.available),
    pending: parseNumber(obj.pending),
    totalBalance: parseNumber(obj.totalBalance),
    btcRate: parseNumber(obj.btcRate),
  };
}

function pickNonZeroAssets(assets: NicehashAssetBalance[]): NicehashAssetBalance[] {
  return assets
    .filter((asset) => {
      const total = asset.totalBalance ?? 0;
      const available = asset.available ?? 0;
      const pending = asset.pending ?? 0;
      return total > 0 || available > 0 || pending > 0;
    })
    .sort((left, right) => (right.totalBalance ?? 0) - (left.totalBalance ?? 0))
    .slice(0, 30)
    .map((asset) => ({
      ...asset,
      available: roundNullable(asset.available, 8),
      pending: roundNullable(asset.pending, 8),
      totalBalance: roundNullable(asset.totalBalance, 8),
      btcRate: roundNullable(asset.btcRate, 12),
    }));
}

function getTotalBtcBalance(
  total: RawNicehashBalance | undefined,
  assets: NicehashAssetBalance[]
): number | null {
  if (total) {
    const totalBalance = parseNumber(total.totalBalance);
    const totalCurrency = typeof total.currency === "string" ? total.currency.toUpperCase() : null;
    const totalBtcRate = parseNumber(total.btcRate);

    if (totalBalance !== null) {
      if (totalCurrency === "BTC" || totalCurrency === "TBTC") {
        return round(totalBalance, 8);
      }

      if (totalBtcRate !== null) {
        return round(totalBalance * totalBtcRate, 8);
      }
    }
  }

  let computed = 0;
  let usedAtLeastOneAsset = false;

  assets.forEach((asset) => {
    const totalBalance = asset.totalBalance;
    if (totalBalance === null || totalBalance <= 0) return;

    const currency = asset.currency.toUpperCase();
    if (currency === "BTC" || currency === "TBTC") {
      computed += totalBalance;
      usedAtLeastOneAsset = true;
      return;
    }

    if (asset.btcRate !== null) {
      computed += totalBalance * asset.btcRate;
      usedAtLeastOneAsset = true;
    }
  });

  if (!usedAtLeastOneAsset) return null;
  return round(computed, 8);
}

function normalizeUnitToken(unit: string | null): string | null {
  if (!unit) return null;
  return unit.trim().toUpperCase().replace("/S", "");
}

function toSpeedUnit(unit: string | null): string | null {
  const normalized = normalizeUnitToken(unit);
  if (!normalized) return null;
  return `${normalized}/s`;
}

function toHashrateTH(
  speed: number | null,
  unit: string | null,
  algorithmCode: string | null
): number | null {
  if (speed === null) return null;
  const normalized = normalizeUnitToken(unit);

  if (normalized === "EH") return speed * 1_000_000;
  if (normalized === "PH") return speed * 1_000;
  if (normalized === "TH") return speed;
  if (normalized === "GH") return speed / 1_000;
  if (normalized === "MH") return speed / 1_000_000;
  if (normalized === "KH") return speed / 1_000_000_000;
  if (normalized === "H") return speed / 1_000_000_000_000;

  if (algorithmCode && algorithmCode.includes("SHA256")) {
    return speed;
  }

  return null;
}

function parseAlgorithmMeta(response: AlgorithmsResponse): Map<string, AlgorithmMeta> {
  const map = new Map<string, AlgorithmMeta>();
  const items = Array.isArray(response.miningAlgorithms) ? response.miningAlgorithms : [];

  items.forEach((entry) => {
    const obj = getObject(entry);
    if (!obj) return;

    const code = stringFromUnknown(obj.algorithm)?.toUpperCase();
    if (!code) return;

    map.set(code, {
      label: stringFromUnknown(obj.title),
      unit: stringFromUnknown(obj.displayMiningFactor),
    });
  });

  return map;
}

function pickBestStat(rawStats: unknown): Record<string, unknown> | null {
  const stats = Array.isArray(rawStats) ? rawStats : [];
  const candidates = stats.map((entry) => getObject(entry)).filter((entry): entry is Record<string, unknown> => entry !== null);
  if (candidates.length === 0) return null;

  let best = candidates[0];
  let bestSpeed = parseNumber(best.speedAccepted) ?? Number.NEGATIVE_INFINITY;

  for (const stat of candidates.slice(1)) {
    const speed = parseNumber(stat.speedAccepted) ?? Number.NEGATIVE_INFINITY;
    if (speed > bestSpeed) {
      best = stat;
      bestSpeed = speed;
    }
  }

  return best;
}

function mapWorkersByRigName(rawWorkers: unknown): Map<string, Record<string, unknown>> {
  const workers = Array.isArray(rawWorkers) ? rawWorkers : [];
  const map = new Map<string, Record<string, unknown>>();

  workers.forEach((entry) => {
    const worker = getObject(entry);
    if (!worker) return;

    const rigName = stringFromUnknown(worker.rigName);
    if (!rigName) return;

    const existing = map.get(rigName);
    if (!existing) {
      map.set(rigName, worker);
      return;
    }

    const nextSpeed = parseNumber(worker.speedAccepted) ?? Number.NEGATIVE_INFINITY;
    const existingSpeed = parseNumber(existing.speedAccepted) ?? Number.NEGATIVE_INFINITY;
    if (nextSpeed > existingSpeed) {
      map.set(rigName, worker);
    }
  });

  return map;
}

function extractAlgorithmDetails(input: unknown): { code: string | null; label: string | null } {
  if (typeof input === "string") {
    const value = input.trim();
    if (!value) return { code: null, label: null };
    return { code: value.toUpperCase(), label: value };
  }

  const obj = getObject(input);
  if (!obj) return { code: null, label: null };

  const enumName = stringFromUnknown(obj.enumName)?.toUpperCase() ?? null;
  const description = stringFromUnknown(obj.description);

  return {
    code: enumName,
    label: description ?? enumName,
  };
}

function getIsoTimestamp(value: unknown): string | null {
  const timestamp = parseNumber(value);
  if (timestamp === null) return null;
  return new Date(timestamp).toISOString();
}

function mapRigToMiner(
  rig: Record<string, unknown>,
  workersByRigName: Map<string, Record<string, unknown>>,
  algorithmMeta: Map<string, AlgorithmMeta>
): MinerBasicInfo | null {
  const rigId = stringFromUnknown(rig.rigId);
  if (!rigId) return null;

  const rigName = stringFromUnknown(rig.name) ?? rigId;
  const status = stringFromUnknown(rig.minerStatus) ?? "UNKNOWN";
  const model = stringFromUnknown(rig.type) ?? "NiceHash Rig";
  const statusStat = pickBestStat(rig.stats);
  const workerStat = workersByRigName.get(rigName) ?? workersByRigName.get(rigId) ?? null;
  const stat = statusStat ?? workerStat;

  const algorithmDetails = extractAlgorithmDetails(stat?.algorithm);
  const algorithmInfo = algorithmDetails.code ? algorithmMeta.get(algorithmDetails.code) : undefined;
  const acceptedSpeed = parseNumber(stat?.speedAccepted);
  const rejectedSpeed = parseNumber(stat?.speedRejectedTotal);
  const profitabilityBTC = parseNumber(rig.profitability) ?? parseNumber(stat?.profitability);
  const unpaidAmountBTC = parseNumber(rig.unpaidAmount) ?? parseNumber(stat?.unpaidAmount);

  const unit = algorithmInfo?.unit ?? null;
  const hashrateTH = toHashrateTH(acceptedSpeed, unit, algorithmDetails.code);
  const algorithmLabel = algorithmDetails.label ?? algorithmInfo?.label ?? algorithmDetails.code;

  return {
    id: rigId,
    name: rigName,
    model,
    status,
    hashrateTH: roundNullable(hashrateTH, 6),
    powerW: null,
    pool: "NiceHash",
    lastSeen: getIsoTimestamp(rig.statusTime) ?? getIsoTimestamp(stat?.statsTime),
    estimatedDailyRevenueUSD: null,
    algorithm: algorithmLabel ?? null,
    market: stringFromUnknown(stat?.market),
    profitabilityBTC: roundNullable(profitabilityBTC, 12),
    unpaidAmountBTC: roundNullable(unpaidAmountBTC, 8),
    acceptedSpeed: roundNullable(acceptedSpeed, 6),
    acceptedSpeedUnit: toSpeedUnit(unit),
    rejectedSpeed: roundNullable(rejectedSpeed, 6),
  };
}

function deriveAlgorithm(miners: MinerBasicInfo[]): string | null {
  const values = Array.from(new Set(miners.map((miner) => miner.algorithm).filter((value): value is string => !!value)));
  if (values.length === 1) return values[0];
  return null;
}

function getActiveMinersFromStatuses(
  devicesStatuses: unknown,
  rigs: Record<string, unknown>[]
): number | null {
  const statuses = getObject(devicesStatuses);
  if (statuses) {
    let active = 0;

    Object.entries(statuses).forEach(([key, value]) => {
      const normalized = key.trim().toUpperCase();
      const count = parseInteger(value);
      if (count === null) return;
      if (normalized === "MINING" || normalized === "ONLINE" || normalized === "ACTIVE") {
        active += count;
      }
    });

    if (active > 0) return active;
  }

  if (rigs.length === 0) return null;

  return rigs.filter((rig) => {
    const status = stringFromUnknown(rig.minerStatus)?.toLowerCase() ?? "";
    return status === "mining" || status === "online" || status === "active";
  }).length;
}

function getTotalPages(pagination: unknown): number {
  const obj = getObject(pagination);
  if (!obj) return 1;

  const totalPageCount = parseInteger(obj.totalPageCount);
  if (totalPageCount === null || totalPageCount < 1) return 1;
  return Math.min(totalPageCount, MAX_PAGE_FETCH);
}

async function fetchPagedRigs(credentials: NicehashCredentials): Promise<ParsedRigsData> {
  const rigs: Record<string, unknown>[] = [];
  let page = 0;
  let totalPages = 1;
  let firstPage: RigsResponse | null = null;

  while (page < totalPages && page < MAX_PAGE_FETCH) {
    const response = await signedGet<RigsResponse>(credentials, "/main/api/v2/mining/rigs2", {
      page,
      size: DEFAULT_PAGE_SIZE,
    });

    if (!firstPage) {
      firstPage = response;
    }

    const pageRigs = Array.isArray(response.miningRigs) ? response.miningRigs : [];
    pageRigs.forEach((entry) => {
      const rig = getObject(entry);
      if (rig) rigs.push(rig);
    });

    totalPages = getTotalPages(response.pagination);
    page += 1;
  }

  if (!firstPage) {
    throw new Error("NiceHash rigs endpoint returned no data.");
  }

  const assignedMinersFromPayload = parseInteger(firstPage.totalRigs);
  const totalProfitabilityBTC = parseNumber(firstPage.totalProfitability);
  const totalProfitabilityLocal = parseNumber(firstPage.totalProfitabilityLocal);
  const unpaidAmountBTC = parseNumber(firstPage.unpaidAmount);

  return {
    rigs,
    totalRigs: assignedMinersFromPayload ?? (rigs.length > 0 ? rigs.length : null),
    activeMiners: getActiveMinersFromStatuses(firstPage.devicesStatuses, rigs),
    totalProfitabilityBTC,
    totalProfitabilityLocal,
    unpaidAmountBTC,
    miningAddress: stringFromUnknown(firstPage.btcAddress),
  };
}

async function fetchPagedWorkers(credentials: NicehashCredentials): Promise<Map<string, Record<string, unknown>>> {
  const workers: unknown[] = [];
  let page = 0;
  let totalPages = 1;

  while (page < totalPages && page < MAX_PAGE_FETCH) {
    const response = await signedGet<ActiveWorkersResponse>(credentials, "/main/api/v2/mining/rigs/activeWorkers", {
      page,
      size: DEFAULT_PAGE_SIZE,
    });

    const pageWorkers = Array.isArray(response.workers) ? response.workers : [];
    workers.push(...pageWorkers);
    totalPages = getTotalPages(response.pagination);
    page += 1;
  }

  return mapWorkersByRigName(workers);
}

async function fetchAlgorithms(credentials: NicehashCredentials): Promise<Map<string, AlgorithmMeta>> {
  const response = await signedGet<AlgorithmsResponse>(credentials, "/main/api/v2/mining/algorithms");
  return parseAlgorithmMeta(response);
}

async function fetchMiningAddress(credentials: NicehashCredentials): Promise<string | null> {
  const response = await signedGet<MiningAddressResponse>(credentials, "/rigmanagement/api/v2/mining/miningAddress");
  return stringFromUnknown(response.address);
}

export async function getNicehashAccountSnapshot(): Promise<NicehashAccountSnapshot> {
  const credentials = getCredentialsFromEnv();
  if (!credentials) {
    return {
      source: "none",
      connected: false,
      totalBtc: null,
      assets: [],
    };
  }

  try {
    const response = await signedGet<AccountsResponse>(credentials, "/main/api/v2/accounting/accounts2");
    const currencies = Array.isArray(response.currencies) ? response.currencies : [];
    const balances = currencies
      .map((entry) => toAssetBalance(entry))
      .filter((asset): asset is NicehashAssetBalance => asset !== null);
    const assets = pickNonZeroAssets(balances);
    const totalBtc = getTotalBtcBalance(response.total, assets);

    return {
      source: "env",
      connected: true,
      totalBtc,
      assets,
    };
  } catch (error) {
    return {
      source: "env",
      connected: false,
      message: error instanceof Error ? error.message : "Unable to connect to NiceHash.",
      totalBtc: null,
      assets: [],
    };
  }
}

export async function getNicehashMiningSnapshot(): Promise<NicehashMiningSnapshot> {
  const credentials = getCredentialsFromEnv();
  if (!credentials) {
    return {
      source: "none",
      connected: false,
      miningAddress: null,
      assignedMiners: null,
      activeMiners: null,
      hashrateTH: null,
      totalProfitabilityBTC: null,
      totalProfitabilityLocal: null,
      unpaidAmountBTC: null,
      algorithm: null,
      miners: [],
    };
  }

  try {
    const [rigsResult, workersResult, algorithmsResult, miningAddressResult] = await Promise.allSettled([
      fetchPagedRigs(credentials),
      fetchPagedWorkers(credentials),
      fetchAlgorithms(credentials),
      fetchMiningAddress(credentials),
    ]);

    if (rigsResult.status === "rejected") {
      throw rigsResult.reason;
    }

    const rigsData = rigsResult.value;
    const workersByRigName = workersResult.status === "fulfilled" ? workersResult.value : new Map<string, Record<string, unknown>>();
    const algorithmMeta = algorithmsResult.status === "fulfilled" ? algorithmsResult.value : new Map<string, AlgorithmMeta>();

    const miners = rigsData.rigs
      .map((rig) => mapRigToMiner(rig, workersByRigName, algorithmMeta))
      .filter((miner): miner is MinerBasicInfo => miner !== null);

    const miningAddress =
      rigsData.miningAddress ?? (miningAddressResult.status === "fulfilled" ? miningAddressResult.value : null);

    const hashrateTH = sumNullableNumbers(miners.map((miner) => miner.hashrateTH));
    const totalProfitabilityBTC =
      rigsData.totalProfitabilityBTC ?? sumNullableNumbers(miners.map((miner) => miner.profitabilityBTC));
    const unpaidAmountBTC =
      rigsData.unpaidAmountBTC ?? sumNullableNumbers(miners.map((miner) => miner.unpaidAmountBTC));

    return {
      source: "env",
      connected: true,
      miningAddress,
      assignedMiners: rigsData.totalRigs,
      activeMiners: rigsData.activeMiners,
      hashrateTH: roundNullable(hashrateTH, 6),
      totalProfitabilityBTC: roundNullable(totalProfitabilityBTC, 12),
      totalProfitabilityLocal: roundNullable(rigsData.totalProfitabilityLocal, 6),
      unpaidAmountBTC: roundNullable(unpaidAmountBTC, 8),
      algorithm: deriveAlgorithm(miners),
      miners,
    };
  } catch (error) {
    return {
      source: "env",
      connected: false,
      message: error instanceof Error ? error.message : "Unable to fetch NiceHash mining data.",
      miningAddress: null,
      assignedMiners: null,
      activeMiners: null,
      hashrateTH: null,
      totalProfitabilityBTC: null,
      totalProfitabilityLocal: null,
      unpaidAmountBTC: null,
      algorithm: null,
      miners: [],
    };
  }
}


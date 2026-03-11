import { MinerBasicInfo, MiningOverviewResponse, NicehashOverviewResponse } from "./types.js";
import { getNicehashAccountSnapshot, getNicehashMiningSnapshot } from "./nicehashClient.js";

const INACTIVE_STATUSES = new Set(["offline", "rebooting"]);

function parseString(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function parseBoolean(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return null;
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stringFromUnknown(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toHashrateTH(rawValue: unknown, unitValue: unknown): number | null {
  const numeric = numberFromUnknown(rawValue);
  if (numeric === null) return null;

  const unit = stringFromUnknown(unitValue)?.toLowerCase();
  if (unit === "gh/s" || unit === "gh") return numeric / 1000;
  if (unit === "mh/s" || unit === "mh") return numeric / 1_000_000;
  return numeric;
}

function parseMinersFromEnv(): MinerBasicInfo[] {
  const raw = parseString(process.env.MINERS_BASIC_JSON);
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((entry, index): MinerBasicInfo | null => {
      if (typeof entry !== "object" || entry === null) return null;
      const obj = entry as Record<string, unknown>;

      const id =
        stringFromUnknown(obj.id) ??
        stringFromUnknown(obj.minerId) ??
        stringFromUnknown(obj.miner_id) ??
        `miner-${index + 1}`;

      const name =
        stringFromUnknown(obj.name) ??
        stringFromUnknown(obj.minerName) ??
        stringFromUnknown(obj.miner_name) ??
        `Miner ${index + 1}`;

      const model = stringFromUnknown(obj.model) ?? stringFromUnknown(obj.hardware) ?? "Unknown";
      const status = stringFromUnknown(obj.status) ?? "Unknown";

      const hashrateTH =
        toHashrateTH(obj.hashrateTH, obj.hashrateUnit) ??
        toHashrateTH(obj.hashrate_th, obj.hashrateUnit) ??
        toHashrateTH(obj.hashrate, obj.hashrateUnit) ??
        toHashrateTH(obj.hashrate, obj.unit);

      const powerW =
        numberFromUnknown(obj.powerW) ?? numberFromUnknown(obj.power_w) ?? numberFromUnknown(obj.power);

      const pool = stringFromUnknown(obj.pool) ?? stringFromUnknown(obj.poolName) ?? stringFromUnknown(obj.pool_name);
      const lastSeen =
        stringFromUnknown(obj.lastSeen) ?? stringFromUnknown(obj.last_seen) ?? stringFromUnknown(obj.timestamp);

      const estimatedDailyRevenueUSD =
        numberFromUnknown(obj.estimatedDailyRevenueUSD) ??
        numberFromUnknown(obj.estimated_daily_revenue_usd) ??
        numberFromUnknown(obj.earningsEstimate) ??
        null;

      const algorithm = stringFromUnknown(obj.algorithm);
      const market = stringFromUnknown(obj.market);
      const profitabilityBTC =
        numberFromUnknown(obj.profitabilityBTC) ??
        numberFromUnknown(obj.profitability_btc) ??
        numberFromUnknown(obj.estimatedDailyRevenueBTC) ??
        null;
      const unpaidAmountBTC =
        numberFromUnknown(obj.unpaidAmountBTC) ??
        numberFromUnknown(obj.unpaid_amount_btc) ??
        numberFromUnknown(obj.unpaidAmount) ??
        null;
      const acceptedSpeed =
        numberFromUnknown(obj.acceptedSpeed) ??
        numberFromUnknown(obj.accepted_speed) ??
        numberFromUnknown(obj.hashrate) ??
        null;
      const acceptedSpeedUnit = stringFromUnknown(obj.acceptedSpeedUnit) ?? stringFromUnknown(obj.hashrateUnit);
      const rejectedSpeed = numberFromUnknown(obj.rejectedSpeed) ?? numberFromUnknown(obj.rejected_speed) ?? null;

      return {
        id,
        name,
        model,
        status,
        hashrateTH,
        powerW,
        pool,
        lastSeen,
        estimatedDailyRevenueUSD,
        algorithm,
        market,
        profitabilityBTC,
        unpaidAmountBTC,
        acceptedSpeed,
        acceptedSpeedUnit,
        rejectedSpeed,
      };
    })
    .filter((miner): miner is MinerBasicInfo => miner !== null);
}

function sumNumbers(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0);
}

function activeCountFromMiners(miners: MinerBasicInfo[]): number | null {
  if (miners.length === 0) return null;
  return miners.filter((miner) => !INACTIVE_STATUSES.has(miner.status.trim().toLowerCase())).length;
}

function deriveSingleAlgorithm(miners: MinerBasicInfo[]): string | null {
  const algorithms = Array.from(new Set(miners.map((miner) => miner.algorithm).filter((value): value is string => !!value)));
  if (algorithms.length === 1) return algorithms[0];
  return null;
}

function hasMiningEnvInput(): boolean {
  const relevantKeys = [
    "MINERS_BASIC_JSON",
    "MINING_TOTAL_MINERS",
    "MINING_ACTIVE_MINERS",
    "MINING_TOTAL_HASHRATE_TH",
    "MINING_TOTAL_POWER_W",
    "MINING_AVG_CHIP_TEMP_C",
    "MINING_EST_DAILY_REVENUE_USD",
    "NICEHASH_CONNECTED",
    "NICEHASH_POOL_STATUS",
    "NICEHASH_POOL_NAME",
    "NICEHASH_POOL_URL",
    "NICEHASH_ALGORITHM",
    "NICEHASH_ASSIGNED_MINERS",
    "NICEHASH_HASHRATE_TH",
    "NICEHASH_POWER_W",
    "NICEHASH_EST_DAILY_REVENUE_USD",
  ];

  return relevantKeys.some((key) => parseString(process.env[key]) !== null);
}

export function getMiningOverviewData(): MiningOverviewResponse {
  const miners = parseMinersFromEnv();

  const totalMiners = parseNumber(process.env.MINING_TOTAL_MINERS) ?? (miners.length > 0 ? miners.length : null);

  const activeFromMinerList =
    miners.length > 0
      ? miners.filter((miner) => !INACTIVE_STATUSES.has(miner.status.trim().toLowerCase())).length
      : null;

  const activeMiners = parseNumber(process.env.MINING_ACTIVE_MINERS) ?? activeFromMinerList;

  const totalHashrateTH =
    parseNumber(process.env.MINING_TOTAL_HASHRATE_TH) ?? sumNumbers(miners.map((miner) => miner.hashrateTH));

  const totalPowerW =
    parseNumber(process.env.MINING_TOTAL_POWER_W) ?? sumNumbers(miners.map((miner) => miner.powerW));

  const estimatedDailyRevenueUSD =
    parseNumber(process.env.MINING_EST_DAILY_REVENUE_USD) ??
    sumNumbers(miners.map((miner) => miner.estimatedDailyRevenueUSD));

  const averageChipTempC = parseNumber(process.env.MINING_AVG_CHIP_TEMP_C);

  const hasSource = miners.length > 0 || hasMiningEnvInput();

  return {
    source: hasSource ? "env" : "none",
    connected: hasSource,
    message: hasSource ? undefined : "No mining data source configured.",
    totalMiners,
    activeMiners,
    totalHashrateTH,
    totalPowerW,
    averageChipTempC,
    estimatedDailyRevenueUSD,
    miners,
    generatedAt: new Date().toISOString(),
  };
}

export async function getNicehashOverviewData(): Promise<NicehashOverviewResponse> {
  const envMiners = parseMinersFromEnv().filter((miner) => miner.pool?.toLowerCase().includes("nicehash"));
  const [account, mining] = await Promise.all([getNicehashAccountSnapshot(), getNicehashMiningSnapshot()]);
  const miners = mining.miners.length > 0 ? mining.miners : envMiners;

  const connectedOverride = parseBoolean(process.env.NICEHASH_CONNECTED);
  const poolStatus = parseString(process.env.NICEHASH_POOL_STATUS);

  const assignedMiners =
    parseNumber(process.env.NICEHASH_ASSIGNED_MINERS) ??
    mining.assignedMiners ??
    (miners.length > 0 ? miners.length : null);

  const activeMiners = mining.activeMiners ?? activeCountFromMiners(miners);

  const hashrateTH =
    parseNumber(process.env.NICEHASH_HASHRATE_TH) ??
    mining.hashrateTH ??
    sumNumbers(miners.map((miner) => miner.hashrateTH));

  const powerW = parseNumber(process.env.NICEHASH_POWER_W) ?? sumNumbers(miners.map((miner) => miner.powerW));

  const estimatedDailyRevenueUSD =
    parseNumber(process.env.NICEHASH_EST_DAILY_REVENUE_USD) ??
    sumNumbers(miners.map((miner) => miner.estimatedDailyRevenueUSD));

  const estimatedDailyRevenueBTC =
    mining.totalProfitabilityBTC ?? sumNumbers(miners.map((miner) => miner.profitabilityBTC));

  const unpaidAmountBTC = mining.unpaidAmountBTC ?? sumNumbers(miners.map((miner) => miner.unpaidAmountBTC));

  const hasSource =
    connectedOverride !== null ||
    poolStatus !== null ||
    parseString(process.env.NICEHASH_POOL_URL) !== null ||
    parseString(process.env.NICEHASH_ALGORITHM) !== null ||
    miners.length > 0 ||
    account.source === "env" ||
    mining.source === "env";

  const connected =
    connectedOverride ??
    (poolStatus
      ? poolStatus.trim().toLowerCase() === "connected"
      : mining.connected || account.connected || miners.length > 0);

  const message = !hasSource
    ? "No NiceHash data source configured."
    : mining.source === "env" && !mining.connected
      ? mining.message
      : account.source === "env" && !account.connected && !mining.connected
        ? account.message
        : undefined;

  const algorithm =
    parseString(process.env.NICEHASH_ALGORITHM) ??
    mining.algorithm ??
    deriveSingleAlgorithm(miners);

  const miningAddress = mining.miningAddress;
  const poolUrl = parseString(process.env.NICEHASH_POOL_URL);

  return {
    source: hasSource ? "env" : "none",
    connected,
    message,
    poolStatus: poolStatus ?? (hasSource ? (connected ? "Connected" : "Disconnected") : null),
    poolName: parseString(process.env.NICEHASH_POOL_NAME) ?? (hasSource ? "NiceHash" : null),
    poolUrl,
    algorithm,
    miningAddress,
    assignedMiners,
    activeMiners,
    hashrateTH,
    powerW,
    estimatedDailyRevenueUSD,
    estimatedDailyRevenueBTC,
    unpaidAmountBTC,
    accountTotalBTC: account.totalBtc,
    assets: account.assets,
    miners,
    generatedAt: new Date().toISOString(),
  };
}

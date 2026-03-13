import {
  MinerEntity,
  MinerLiveData,
  MinerPerfSummaryPayload,
  MinerPoolEntity,
  MinerPoolLive,
  MinerSnapshotEntity,
} from "./types.js";
import { cleanInteger, cleanNumber, cleanString, listFromUnknown, parseJsonObject } from "./miner-utils.js";

function arrayOfNumbers(input: Array<number | null | undefined>): number[] {
  return input.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function stringOrFallback(value: unknown, fallback = "unknown"): string {
  return cleanString(value) ?? fallback;
}

function readField(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }
  return undefined;
}

export function normalizePoolsFromCgminer(poolRows: unknown[], storedPools: MinerPoolEntity[] = []): { pools: MinerPoolLive[]; activePoolIndex: number | null } {
  let activePoolIndex: number | null = null;

  const pools = poolRows
    .map((entry, index) => {
      const record = parseJsonObject(entry);
      if (!record) return null;

      const poolIndex = cleanInteger(readField(record, "POOL", "pool", "idx")) ?? index;
      const url = cleanString(readField(record, "URL", "Stratum URL", "url")) ?? storedPools[index]?.url ?? "";
      const user = cleanString(readField(record, "User", "USER", "user")) ?? storedPools[index]?.username ?? "";
      const status = cleanString(readField(record, "Status", "STATUS", "status")) ?? "unknown";
      const isActive =
        cleanString(readField(record, "Stratum Active", "Active", "active"))?.toLowerCase() === "true" ||
        cleanInteger(readField(record, "Active", "active")) === 1 ||
        cleanInteger(readField(record, "POOL_ACTIVE")) === 1;

      if (isActive) {
        activePoolIndex = poolIndex;
      }

      const pool: MinerPoolLive = {
        id: storedPools.find((pool) => pool.poolIndex === poolIndex)?.id ?? poolIndex,
        url,
        user,
        status,
      };

      const accepted = cleanNumber(readField(record, "Accepted", "accepted"));
      const rejected = cleanNumber(readField(record, "Rejected", "rejected"));
      const stale = cleanNumber(readField(record, "Stale", "stale"));
      if (accepted !== null) pool.accepted = accepted;
      if (rejected !== null) pool.rejected = rejected;
      if (stale !== null) pool.stale = stale;

      return pool;
    })
    .filter((pool): pool is MinerPoolLive => pool !== null);

  if (activePoolIndex === null) {
    const activeStored = storedPools.find((pool) => pool.isActive);
    activePoolIndex = activeStored?.poolIndex ?? null;
  }

  return { pools, activePoolIndex };
}

export function normalizePoolsForStorage(poolRows: unknown[]): Array<{
  poolIndex: number;
  url: string;
  username: string;
  status: string | null;
  isActive: boolean;
}> {
  return poolRows
    .map((entry, index) => {
      const record = parseJsonObject(entry);
      if (!record) return null;
      return {
        poolIndex: cleanInteger(readField(record, "POOL", "pool", "idx")) ?? index,
        url: cleanString(readField(record, "URL", "Stratum URL", "url")) ?? "",
        username: cleanString(readField(record, "User", "USER", "user")) ?? "",
        status: cleanString(readField(record, "Status", "STATUS", "status")),
        isActive:
          cleanString(readField(record, "Stratum Active", "Active", "active"))?.toLowerCase() === "true" ||
          cleanInteger(readField(record, "Active", "active")) === 1 ||
          cleanInteger(readField(record, "POOL_ACTIVE")) === 1,
      };
    })
    .filter(
      (
        pool
      ): pool is {
        poolIndex: number;
        url: string;
        username: string;
        status: string | null;
        isActive: boolean;
      } => pool !== null
    );
}

export function normalizeMinerLiveData(params: {
  miner: MinerEntity;
  statusPayload: Record<string, unknown> | null;
  perfSummaryPayload: MinerPerfSummaryPayload | null;
  cgminerStats: Record<string, unknown> | null;
  cgminerSummary: Record<string, unknown> | null;
  cgminerPools: unknown[];
  storedPools?: MinerPoolEntity[];
}): MinerLiveData {
  const { miner, statusPayload, perfSummaryPayload, cgminerStats, cgminerSummary, cgminerPools, storedPools = [] } = params;

  const totalRateThs =
    cleanNumber(cgminerStats ? readField(cgminerStats, "total_rate", "Total Rate") : undefined) ??
    cleanNumber(cgminerSummary ? readField(cgminerSummary, "MHS av", "GHS av", "KHS av") : undefined) ??
    cleanNumber(cgminerSummary ? readField(cgminerSummary, "SUMMARY", "total_rate") : undefined);

  const boardTemps = arrayOfNumbers([
    cleanInteger(cgminerStats ? readField(cgminerStats, "temp2_1") : undefined),
    cleanInteger(cgminerStats ? readField(cgminerStats, "temp2_2") : undefined),
    cleanInteger(cgminerStats ? readField(cgminerStats, "temp2_3") : undefined),
  ]);

  const hotspotTemps = arrayOfNumbers([
    cleanInteger(cgminerStats ? readField(cgminerStats, "temp3_1") : undefined),
    cleanInteger(cgminerStats ? readField(cgminerStats, "temp3_2") : undefined),
    cleanInteger(cgminerStats ? readField(cgminerStats, "temp3_3") : undefined),
  ]);

  const chipTempStrings = [1, 2, 3]
    .map((index) => cleanNumber(cgminerStats ? readField(cgminerStats, `temp_chip${index}`) : undefined))
    .filter((value): value is number => value !== null)
    .map((value, index) => `Chip ${index + 1}: ${value}C`);

  const pcbTempStrings = [1, 2, 3]
    .map((index) => cleanNumber(cgminerStats ? readField(cgminerStats, `temp_pcb${index}`) : undefined))
    .filter((value): value is number => value !== null)
    .map((value, index) => `PCB ${index + 1}: ${value}C`);

  const fanRpm = arrayOfNumbers([
    cleanInteger(cgminerStats ? readField(cgminerStats, "fan1") : undefined),
    cleanInteger(cgminerStats ? readField(cgminerStats, "fan2") : undefined),
    cleanInteger(cgminerStats ? readField(cgminerStats, "fan3") : undefined),
    cleanInteger(cgminerStats ? readField(cgminerStats, "fan4") : undefined),
  ]);

  const chainRates = arrayOfNumbers([
    cleanNumber(cgminerStats ? readField(cgminerStats, "chain_rate1") : undefined),
    cleanNumber(cgminerStats ? readField(cgminerStats, "chain_rate2") : undefined),
    cleanNumber(cgminerStats ? readField(cgminerStats, "chain_rate3") : undefined),
  ]);

  const chainStates = [1, 2, 3]
    .map((index) => cleanString(cgminerStats ? readField(cgminerStats, `chain_state${index}`) : undefined))
    .filter((value): value is string => value !== null);

  const powerFromChains = [1, 2, 3]
    .map((index) => cleanNumber(cgminerStats ? readField(cgminerStats, `chain_consumption${index}`) : undefined))
    .filter((value): value is number => value !== null)
    .reduce((sum, value) => sum + value, 0);

  const { pools, activePoolIndex } = normalizePoolsFromCgminer(cgminerPools, storedPools);

  return {
    minerId: miner.id,
    name: miner.name,
    ip: miner.ip,
    online: Boolean(statusPayload || cgminerStats || cgminerSummary),
    minerState: cleanString(statusPayload ? readField(statusPayload, "state", "miner_state") : undefined),
    unlocked:
      Boolean(statusPayload && readField(statusPayload, "unlocked")) ||
      cleanString(statusPayload ? readField(statusPayload, "auth", "auth_state") : undefined)?.toLowerCase() === "unlocked",
    presetName:
      cleanString(perfSummaryPayload ? readField(perfSummaryPayload, "preset_name", "presetName") : undefined) ??
      miner.currentPreset,
    presetPretty: cleanString(perfSummaryPayload ? readField(perfSummaryPayload, "preset_pretty", "presetPretty") : undefined),
    presetStatus: cleanString(perfSummaryPayload ? readField(perfSummaryPayload, "preset_status", "presetStatus") : undefined),
    totalRateThs,
    boardTemps,
    hotspotTemps,
    chipTempStrings,
    pcbTempStrings,
    fanPwm: cleanInteger(cgminerStats ? readField(cgminerStats, "fan_pwm") : undefined),
    fanRpm,
    chainRates,
    chainStates,
    powerWatts: powerFromChains > 0 ? Math.round(powerFromChains) : null,
    poolActiveIndex: activePoolIndex,
    pools,
    lastSeenAt: miner.lastSeenAt,
    raw: {
      statusPayload,
      perfSummaryPayload,
      cgminerSummary,
      cgminerStats,
      cgminerPools,
    },
  };
}

export function liveDataToSnapshotRaw(liveData: MinerLiveData): Record<string, unknown> {
  return {
    unlocked: liveData.unlocked,
    chipTempStrings: liveData.chipTempStrings,
    pcbTempStrings: liveData.pcbTempStrings,
    chainRates: liveData.chainRates,
    chainStates: liveData.chainStates,
    poolActiveIndex: liveData.poolActiveIndex,
    pools: liveData.pools,
    raw: liveData.raw ?? null,
  };
}

export function buildMinerLiveDataFromSnapshot(
  miner: MinerEntity,
  snapshot: MinerSnapshotEntity | null,
  pools: MinerPoolEntity[]
): MinerLiveData {
  const raw = parseJsonObject(snapshot?.raw);
  const storedPools = pools.map((pool) => ({
    id: pool.id,
    url: pool.url,
    user: pool.username,
    status: stringOrFallback(pool.status),
  }));

  return {
    minerId: miner.id,
    name: miner.name,
    ip: miner.ip,
    online: snapshot?.online ?? false,
    minerState: snapshot?.minerState ?? null,
    unlocked: Boolean(raw?.unlocked),
    presetName: snapshot?.presetName ?? miner.currentPreset ?? null,
    presetPretty: snapshot?.presetPretty ?? null,
    presetStatus: snapshot?.presetStatus ?? null,
    totalRateThs: snapshot?.totalRateThs ?? null,
    boardTemps: arrayOfNumbers(snapshot?.boardTemps ?? []),
    hotspotTemps: arrayOfNumbers(snapshot?.hotspotTemps ?? []),
    chipTempStrings: listFromUnknown(raw?.chipTempStrings).map((entry) => String(entry)),
    pcbTempStrings: listFromUnknown(raw?.pcbTempStrings).map((entry) => String(entry)),
    fanPwm: snapshot?.fanPwm ?? null,
    fanRpm: arrayOfNumbers(snapshot?.fanRpm ?? []),
    chainRates: listFromUnknown(raw?.chainRates).map((entry) => cleanNumber(entry)).filter((value): value is number => value !== null),
    chainStates: listFromUnknown(raw?.chainStates).map((entry) => String(entry)),
    powerWatts: snapshot?.powerWatts ?? null,
    poolActiveIndex: cleanInteger(raw?.poolActiveIndex),
    pools: listFromUnknown(raw?.pools).length > 0 ? (listFromUnknown(raw?.pools) as MinerPoolLive[]) : storedPools,
    lastSeenAt: miner.lastSeenAt ?? snapshot?.createdAt ?? null,
    raw: raw?.raw ?? snapshot?.raw ?? null,
  };
}

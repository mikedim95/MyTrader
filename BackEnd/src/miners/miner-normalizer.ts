import {
  MinerEntity,
  MinerLiveData,
  MinerPerfSummaryPayload,
  MinerPresetOption,
  MinerPoolEntity,
  MinerPoolLive,
  MinerSnapshotEntity,
} from "./types.js";
import { cleanInteger, cleanNumber, cleanString, listFromUnknown, parseJsonObject } from "./miner-utils.js";

const EMPTY_RECORD: Record<string, unknown> = {};

function arrayOfNumbers(input: Array<number | null | undefined>): number[] {
  return input.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function normalizeHashrateToThs(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  if (value <= 400) return value;
  if (value <= 400_000) return value / 1000;
  if (value <= 400_000_000) return value / 1_000_000;
  if (value <= 400_000_000_000) return value / 1_000_000_000;
  return null;
}

function cleanTemperature(value: unknown): number | null {
  const parsed = cleanNumber(value);
  if (parsed === null || !Number.isFinite(parsed)) return null;
  if (parsed <= 0 || parsed > 150) return null;
  return Math.round(parsed);
}

function stringOrFallback(value: unknown, fallback = "unknown"): string {
  return cleanString(value) ?? fallback;
}

function readField(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const path = key.split(".");
    let current: unknown = record;

    for (const segment of path) {
      const currentRecord = parseJsonObject(current);
      if (!currentRecord || !(segment in currentRecord)) {
        current = undefined;
        break;
      }
      current = currentRecord[segment];
    }

    if (current !== undefined) {
      return current;
    }
  }
  return undefined;
}

function cleanBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on", "alive"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  }
  return null;
}

function recordsFromUnknown(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.map((entry) => parseJsonObject(entry)).filter((entry): entry is Record<string, unknown> => entry !== null);
  }

  const record = parseJsonObject(value);
  return record ? [record] : [];
}

function parseCgminerTypeDescriptor(value: unknown): { model: string | null; firmware: string | null } {
  const label = cleanString(value);
  if (!label) {
    return { model: null, firmware: null };
  }

  const descriptorMatch = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(label);
  if (!descriptorMatch) {
    return { model: label, firmware: null };
  }

  return {
    model: cleanString(descriptorMatch[1]) ?? label,
    firmware: cleanString(descriptorMatch[2]),
  };
}

function parsePowerWattsFromPresetPretty(value: string | null): number | null {
  if (!value) return null;
  const match = /(\d+(?:\.\d+)?)\s*watt/i.exec(value);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function firstNumber(record: Record<string, unknown> | null | undefined, ...keys: string[]): number | null {
  if (!record) return null;
  return cleanNumber(readField(record, ...keys));
}

function firstInteger(record: Record<string, unknown> | null | undefined, ...keys: string[]): number | null {
  if (!record) return null;
  return cleanInteger(readField(record, ...keys));
}

function firstTemperature(record: Record<string, unknown> | null | undefined, ...keys: string[]): number | null {
  if (!record) return null;
  return cleanTemperature(readField(record, ...keys));
}

function firstString(record: Record<string, unknown> | null | undefined, ...keys: string[]): string | null {
  if (!record) return null;
  return cleanString(readField(record, ...keys));
}

function readHashrateAsThs(record: Record<string, unknown>): number | null {
  const directThs =
    firstNumber(record, "hashrate_ths", "rate_ths", "THS 5s", "THS av", "ths", "ths_5s", "ths_avg") ??
    firstNumber(record, "hashrate", "rate");
  if (directThs !== null && directThs <= 250) {
    return directThs;
  }

  const ghs =
    firstNumber(record, "GHS 5s", "GHS av", "ghs_5s", "ghs_avg", "ghs", "hashrate_ghs", "rate_ghs") ??
    null;
  if (ghs !== null) return ghs / 1000;

  const mhs =
    firstNumber(record, "MHS 5s", "MHS av", "mhs_5s", "mhs_avg", "mhs", "hashrate_mhs", "rate_mhs") ??
    null;
  if (mhs !== null) return mhs / 1_000_000;

  const khs =
    firstNumber(record, "KHS 5s", "KHS av", "khs_5s", "khs_avg", "khs", "hashrate_khs", "rate_khs") ??
    null;
  if (khs !== null) return khs / 1_000_000_000;

  const hashrateLabel = firstString(record, "hashrateLabel", "hashrate_label", "Hashrate", "hashrate");
  if (!hashrateLabel) return null;

  const match = /(\d+(?:\.\d+)?)\s*(T|G|M|K)H\/?s/i.exec(hashrateLabel);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2].toUpperCase();
  if (unit === "T") return amount;
  if (unit === "G") return amount / 1000;
  if (unit === "M") return amount / 1_000_000;
  if (unit === "K") return amount / 1_000_000_000;
  return null;
}

function collectNumbers(records: Record<string, unknown>[], keys: string[]): number[] {
  return records
    .map((record) => cleanNumber(readField(record, ...keys)))
    .filter((value): value is number => value !== null);
}

function collectIntegers(records: Record<string, unknown>[], keys: string[]): number[] {
  return records
    .map((record) => cleanInteger(readField(record, ...keys)))
    .filter((value): value is number => value !== null);
}

function collectTemperatures(records: Record<string, unknown>[], keys: string[]): number[] {
  return records
    .map((record) => cleanTemperature(readField(record, ...keys)))
    .filter((value): value is number => value !== null);
}

function collectStrings(records: Record<string, unknown>[], keys: string[]): string[] {
  return records
    .map((record) => cleanString(readField(record, ...keys)))
    .filter((value): value is string => value !== null);
}

export function extractPresetDetails(perfSummaryPayload: MinerPerfSummaryPayload | null): {
  name: string | null;
  pretty: string | null;
  status: string | null;
  powerWattsHint: number | null;
} {
  const currentPreset = parseJsonObject(readField(perfSummaryPayload ?? {}, "current_preset"));
  const name =
    firstString(perfSummaryPayload ?? null, "preset_name", "presetName") ?? firstString(currentPreset, "name");
  const pretty =
    firstString(perfSummaryPayload ?? null, "preset_pretty", "presetPretty") ?? firstString(currentPreset, "pretty");
  const status =
    firstString(perfSummaryPayload ?? null, "preset_status", "presetStatus") ?? firstString(currentPreset, "status");

  return {
    name,
    pretty,
    status,
    powerWattsHint: parsePowerWattsFromPresetPretty(pretty),
  };
}

export function extractMinerIdentity(params: {
  statusPayload: Record<string, unknown> | null;
  summaryPayload?: Record<string, unknown> | null;
  infoPayload?: Record<string, unknown> | null;
  cgminerStats?: Record<string, unknown> | null;
}): { model: string | null; firmware: string | null } {
  const { statusPayload, summaryPayload = null, infoPayload = null, cgminerStats = null } = params;
  const summaryMiner = parseJsonObject(readField(summaryPayload ?? {}, "miner"));
  const infoSystem = parseJsonObject(readField(infoPayload ?? {}, "system"));
  const typeDescriptor = parseCgminerTypeDescriptor(readField(cgminerStats ?? {}, "Type"));

  return {
    model:
      firstString(statusPayload, "model", "miner", "miner_model") ??
      firstString(summaryMiner, "miner_type", "type", "model") ??
      firstString(infoSystem, "model", "miner_type", "type") ??
      typeDescriptor.model,
    firmware:
      firstString(statusPayload, "firmware", "fw_name", "version") ??
      firstString(summaryMiner, "firmware", "fw_name", "version", "build") ??
      firstString(infoSystem, "firmware", "fw_name", "version") ??
      typeDescriptor.firmware ??
      firstString(cgminerStats, "Cgminer"),
  };
}

export function normalizePresetOptions(presets: unknown[] | null | undefined): MinerPresetOption[] {
  if (!Array.isArray(presets)) return [];

  const seen = new Set<string>();

  return presets
    .map((entry) => {
      const record = parseJsonObject(entry);
      if (!record) return null;

      const name = cleanString(record.name) ?? cleanString(record.preset_name);
      if (!name) return null;

      return {
        name,
        pretty: cleanString(record.pretty) ?? cleanString(record.preset_pretty),
        status: cleanString(record.status) ?? cleanString(record.preset_status),
      };
    })
    .filter((preset): preset is MinerPresetOption => {
      if (!preset) return false;
      const key = preset.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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
        cleanBoolean(readField(record, "Stratum Active", "Active", "active")) === true ||
        cleanInteger(readField(record, "POOL_ACTIVE")) === 1;

      if (isActive) {
        activePoolIndex = index;
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
    const activeStoredIndex = storedPools.findIndex((pool) => pool.isActive);
    activePoolIndex = activeStoredIndex >= 0 ? activeStoredIndex : null;
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
          cleanBoolean(readField(record, "Stratum Active", "Active", "active")) === true ||
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
  summaryPayload: Record<string, unknown> | null;
  infoPayload: Record<string, unknown> | null;
  chipsPayload: unknown | null;
  cgminerStats: Record<string, unknown> | null;
  cgminerSummary: Record<string, unknown> | null;
  cgminerDevs: unknown[];
  cgminerPools: unknown[];
  storedPools?: MinerPoolEntity[];
}): MinerLiveData {
  const {
    miner,
    statusPayload,
    perfSummaryPayload,
    summaryPayload,
    infoPayload,
    chipsPayload,
    cgminerStats,
    cgminerSummary,
    cgminerDevs,
    cgminerPools,
    storedPools = [],
  } = params;

  const presetDetails = extractPresetDetails(perfSummaryPayload);
  const summaryRecord = summaryPayload ?? EMPTY_RECORD;
  const infoRecord = infoPayload ?? EMPTY_RECORD;
  const chipsRecord = parseJsonObject(chipsPayload) ?? EMPTY_RECORD;
  const summaryMiner = parseJsonObject(readField(summaryRecord, "miner")) ?? summaryPayload;
  const summaryChains = recordsFromUnknown(readField(summaryRecord, "miner.chains", "chains"));
  const chipsChains = recordsFromUnknown(readField(chipsRecord, "miner.chains", "chains", "chips"));
  const devRecords = recordsFromUnknown(cgminerDevs);
  const fanRecords = [
    ...recordsFromUnknown(readField(summaryRecord, "miner.fans", "fans")),
    ...recordsFromUnknown(readField(infoRecord, "miner.fans", "fans")),
  ];
  const thermalRecords = [...summaryChains, ...chipsChains, ...devRecords];

  const totalRateThs =
    normalizeHashrateToThs(cleanNumber(cgminerStats ? readField(cgminerStats, "total_rate", "Total Rate") : undefined)) ??
    (cgminerSummary ? readHashrateAsThs(cgminerSummary) : null) ??
    normalizeHashrateToThs(cleanNumber(cgminerSummary ? readField(cgminerSummary, "SUMMARY", "total_rate") : undefined)) ??
    normalizeHashrateToThs(firstNumber(summaryMiner, "hashrate_ths", "total_hashrate_ths")) ??
    (summaryMiner ? readHashrateAsThs(summaryMiner) : null);

  const boardTemps = arrayOfNumbers([
    cleanTemperature(cgminerStats ? readField(cgminerStats, "temp2_1") : undefined),
    cleanTemperature(cgminerStats ? readField(cgminerStats, "temp2_2") : undefined),
    cleanTemperature(cgminerStats ? readField(cgminerStats, "temp2_3") : undefined),
    ...collectTemperatures(thermalRecords, [
      "board_temp",
      "boardTemp",
      "temp_board",
      "pcb_temp",
      "temp_pcb",
      "Temperature",
      "Temp",
      "temperature",
      "temperature.board",
    ]),
  ]);

  const hotspotTemps = arrayOfNumbers([
    cleanTemperature(cgminerStats ? readField(cgminerStats, "temp3_1") : undefined),
    cleanTemperature(cgminerStats ? readField(cgminerStats, "temp3_2") : undefined),
    cleanTemperature(cgminerStats ? readField(cgminerStats, "temp3_3") : undefined),
    ...collectTemperatures(thermalRecords, [
      "hotspot_temp",
      "hotspotTemp",
      "chip_temp_max",
      "max_chip_temp",
      "Chip Temp Max",
      "temperature.max",
      "temp_max",
    ]),
  ]);

  const chipTempStrings = [
    ...[1, 2, 3]
      .map((index) => cleanTemperature(cgminerStats ? readField(cgminerStats, `temp_chip${index}`) : undefined))
      .filter((value): value is number => value !== null)
      .map((value, index) => `Chip ${index + 1}: ${value}C`),
    ...collectTemperatures(thermalRecords, ["chip_temp_avg", "chipTempAvg", "Chip Temp Avg"]).map(
      (value, index) => `Chip ${index + 1} avg: ${value}C`
    ),
    ...collectTemperatures(thermalRecords, ["chip_temp_max", "chipTempMax", "Chip Temp Max"]).map(
      (value, index) => `Chip ${index + 1} max: ${value}C`
    ),
  ];

  const pcbTempStrings = [
    ...[1, 2, 3]
      .map((index) => cleanTemperature(cgminerStats ? readField(cgminerStats, `temp_pcb${index}`) : undefined))
      .filter((value): value is number => value !== null)
      .map((value, index) => `PCB ${index + 1}: ${value}C`),
    ...collectTemperatures(thermalRecords, ["pcb_temp", "pcbTemp", "board_temp", "boardTemp"]).map(
      (value, index) => `PCB ${index + 1}: ${value}C`
    ),
  ];

  const fanRpm = arrayOfNumbers([
    cleanInteger(cgminerStats ? readField(cgminerStats, "fan1") : undefined),
    cleanInteger(cgminerStats ? readField(cgminerStats, "fan2") : undefined),
    cleanInteger(cgminerStats ? readField(cgminerStats, "fan3") : undefined),
    cleanInteger(cgminerStats ? readField(cgminerStats, "fan4") : undefined),
    ...collectIntegers(fanRecords, ["rpm", "fan_rpm", "speed", "value"]),
    ...collectIntegers(thermalRecords, ["fan_rpm", "fanRpm", "Fan Speed In", "Fan Speed Out"]),
  ]);

  const chainRates = arrayOfNumbers([
    cleanNumber(cgminerStats ? readField(cgminerStats, "chain_rate1") : undefined),
    cleanNumber(cgminerStats ? readField(cgminerStats, "chain_rate2") : undefined),
    cleanNumber(cgminerStats ? readField(cgminerStats, "chain_rate3") : undefined),
    ...thermalRecords
      .map((record) => readHashrateAsThs(record))
      .filter((value): value is number => value !== null),
  ]);

  const chainStates = [
    ...[1, 2, 3]
    .map((index) => cleanString(cgminerStats ? readField(cgminerStats, `chain_state${index}`) : undefined))
    .filter((value): value is string => value !== null),
    ...collectStrings(thermalRecords, ["chain_state", "chainState", "state", "status"]),
  ];

  const powerFromChains = [1, 2, 3]
    .map((index) => cleanNumber(cgminerStats ? readField(cgminerStats, `chain_consumption${index}`) : undefined))
    .filter((value): value is number => value !== null)
    .reduce((sum, value) => sum + value, 0);

  const powerFromThermals = collectNumbers(thermalRecords, [
    "power",
    "power_usage",
    "power_watts",
    "powerConsumption",
    "consumption",
    "Power",
    "Power Consumption",
  ]).reduce((sum, value) => sum + value, 0);

  const { pools, activePoolIndex } = normalizePoolsFromCgminer(cgminerPools, storedPools);

  return {
    minerId: miner.id,
    name: miner.name,
    ip: miner.ip,
    online: Boolean(
      statusPayload || perfSummaryPayload || summaryPayload || infoPayload || chipsPayload || cgminerStats || cgminerSummary || cgminerDevs.length > 0
    ),
    minerState:
      firstString(statusPayload, "state", "miner_state", "status") ??
      firstString(summaryMiner, "miner_status.miner_state", "miner_state", "state"),
    unlocked:
      Boolean(statusPayload && readField(statusPayload, "unlocked")) ||
      cleanString(statusPayload ? readField(statusPayload, "auth", "auth_state") : undefined)?.toLowerCase() === "unlocked",
    presetName: presetDetails.name ?? miner.currentPreset,
    presetPretty: presetDetails.pretty,
    presetStatus: presetDetails.status,
    totalRateThs,
    boardTemps,
    hotspotTemps,
    chipTempStrings,
    pcbTempStrings,
    fanPwm:
      cleanInteger(cgminerStats ? readField(cgminerStats, "fan_pwm") : undefined) ??
      firstInteger(summaryMiner, "fan_pwm", "fan_percent") ??
      collectIntegers(fanRecords, ["pwm", "fan_pwm", "percent", "duty"])[0] ??
      collectIntegers(thermalRecords, ["fan_pwm", "fanPwm", "fan_percent", "Fan Percent"])[0] ??
      null,
    fanRpm,
    chainRates,
    chainStates,
    powerWatts:
      (powerFromChains > 0 ? Math.round(powerFromChains) : null) ??
      (powerFromThermals > 0 ? Math.round(powerFromThermals) : null) ??
      firstInteger(summaryMiner, "power_usage", "power", "power_watts", "consumption") ??
      presetDetails.powerWattsHint,
    poolActiveIndex: activePoolIndex,
    pools,
    lastSeenAt: miner.lastSeenAt,
    raw: {
      statusPayload,
      perfSummaryPayload,
      summaryPayload,
      infoPayload,
      chipsPayload,
      cgminerSummary,
      cgminerStats,
      cgminerDevs,
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
    poolActiveIndex: cleanInteger(raw?.poolActiveIndex) ?? (() => {
      const activeStoredIndex = pools.findIndex((pool) => pool.isActive);
      return activeStoredIndex >= 0 ? activeStoredIndex : null;
    })(),
    pools: listFromUnknown(raw?.pools).length > 0 ? (listFromUnknown(raw?.pools) as MinerPoolLive[]) : storedPools,
    lastSeenAt: miner.lastSeenAt ?? snapshot?.createdAt ?? null,
    raw: raw?.raw ?? snapshot?.raw ?? null,
  };
}

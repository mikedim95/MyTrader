import {
  MinerCapabilities,
  MinerCommandEntity,
  MinerCommandRecord,
  MinerEntity,
  MinerPoolEntity,
  MinerPoolRecord,
  MinerSnapshotEntity,
  MinerSnapshotRecord,
  MinerRecord,
} from "./types.js";

export function buildApiBaseUrl(ip: string): string {
  return `http://${ip.trim()}/api/v1`;
}

export function toBoolean(value: boolean | number): boolean {
  return value === true || value === 1;
}

export function parseCapabilities(value: unknown): MinerCapabilities | null {
  if (!value) return null;

  if (typeof value === "string") {
    try {
      return parseCapabilities(JSON.parse(value));
    } catch {
      return null;
    }
  }

  if (typeof value !== "object") return null;
  const input = value as Partial<MinerCapabilities>;

  return {
    canReadHttp: Boolean(input.canReadHttp),
    canReadCgminer: Boolean(input.canReadCgminer),
    canUnlock: Boolean(input.canUnlock),
    canRestart: Boolean(input.canRestart),
    canReboot: Boolean(input.canReboot),
    canSwitchPool: Boolean(input.canSwitchPool),
    canReadPresets: Boolean(input.canReadPresets),
  };
}

export function mapMinerRecord(record: MinerRecord): MinerEntity {
  return {
    id: record.id,
    name: record.name,
    ip: record.ip,
    apiBaseUrl: record.api_base_url,
    passwordEnc: record.password_enc,
    model: record.model,
    firmware: record.firmware,
    currentPreset: record.current_preset,
    isEnabled: toBoolean(record.is_enabled),
    verificationStatus: record.verification_status,
    lastSeenAt: record.last_seen_at,
    lastError: record.last_error,
    capabilities: parseCapabilities(record.capabilities_json),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

export function mapSnapshotRecord(record: MinerSnapshotRecord): MinerSnapshotEntity {
  return {
    id: record.id,
    minerId: record.miner_id,
    online: toBoolean(record.online),
    minerState: record.miner_state,
    presetName: record.preset_name,
    presetPretty: record.preset_pretty,
    presetStatus: record.preset_status,
    totalRateThs: typeof record.total_rate_ths === "number" ? record.total_rate_ths : null,
    boardTemps: [record.board_temp_1, record.board_temp_2, record.board_temp_3],
    hotspotTemps: [record.hotspot_temp_1, record.hotspot_temp_2, record.hotspot_temp_3],
    fanPwm: record.fan_pwm,
    fanRpm: [record.fan_rpm_1, record.fan_rpm_2, record.fan_rpm_3, record.fan_rpm_4],
    powerWatts: record.power_watts,
    raw: record.raw_json,
    createdAt: record.created_at,
  };
}

export function mapPoolRecord(record: MinerPoolRecord): MinerPoolEntity {
  return {
    id: record.id,
    minerId: record.miner_id,
    poolIndex: record.pool_index,
    url: record.url,
    username: record.username,
    status: record.status,
    isActive: toBoolean(record.is_active),
    updatedAt: record.updated_at,
  };
}

export function mapCommandRecord(record: MinerCommandRecord): MinerCommandEntity {
  return {
    id: record.id,
    minerId: record.miner_id,
    commandType: record.command_type,
    request: record.request_json,
    response: record.response_json,
    status: record.status,
    errorText: record.error_text,
    createdBy: record.created_by,
    createdAt: record.created_at,
  };
}

export function cleanNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function cleanInteger(value: unknown): number | null {
  const parsed = cleanNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

export function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function listFromUnknown(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return [];
}

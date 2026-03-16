import type { RowDataPacket } from "mysql2/promise";

export type MinerVerificationStatus = "pending" | "verified" | "failed";
export type MinerCommandStatus = "pending" | "completed" | "failed";
export type MinerStorageStatus = "online" | "offline";

export interface MinerCapabilities {
  canReadHttp: boolean;
  canReadCgminer: boolean;
  canUnlock: boolean;
  canRestart: boolean;
  canReboot: boolean;
  canSwitchPool: boolean;
  canReadPresets: boolean;
}

export interface MinerRecord extends RowDataPacket {
  id: number;
  name: string;
  ip: string;
  api_base_url: string;
  password_enc: string;
  model: string | null;
  firmware: string | null;
  current_preset: string | null;
  is_enabled: number | boolean;
  verification_status: MinerVerificationStatus;
  last_seen_at: string | null;
  last_error: string | null;
  capabilities_json: unknown;
  created_at: string;
  updated_at: string;
}

export interface MinerEntity {
  id: number;
  name: string;
  ip: string;
  apiBaseUrl: string;
  passwordEnc: string;
  model: string | null;
  firmware: string | null;
  currentPreset: string | null;
  isEnabled: boolean;
  verificationStatus: MinerVerificationStatus;
  lastSeenAt: string | null;
  lastError: string | null;
  capabilities: MinerCapabilities | null;
  createdAt: string;
  updatedAt: string;
}

export interface MinerPoolRecord extends RowDataPacket {
  id: number;
  miner_id: number;
  pool_index: number;
  url: string;
  username: string;
  status: string | null;
  is_active: number | boolean;
  updated_at: string;
}

export interface MinerPoolEntity {
  id: number;
  minerId: number;
  poolIndex: number;
  url: string;
  username: string;
  status: string | null;
  isActive: boolean;
  updatedAt: string;
}

export interface MinerSnapshotRecord extends RowDataPacket {
  id: number;
  miner_id: number;
  online: number | boolean;
  miner_state: string | null;
  preset_name: string | null;
  preset_pretty: string | null;
  preset_status: string | null;
  total_rate_ths: number | null;
  board_temp_1: number | null;
  board_temp_2: number | null;
  board_temp_3: number | null;
  hotspot_temp_1: number | null;
  hotspot_temp_2: number | null;
  hotspot_temp_3: number | null;
  fan_pwm: number | null;
  fan_rpm_1: number | null;
  fan_rpm_2: number | null;
  fan_rpm_3: number | null;
  fan_rpm_4: number | null;
  power_watts: number | null;
  raw_json: unknown;
  created_at: string;
}

export interface MinerSnapshotEntity {
  id: number;
  minerId: number;
  online: boolean;
  minerState: string | null;
  presetName: string | null;
  presetPretty: string | null;
  presetStatus: string | null;
  totalRateThs: number | null;
  boardTemps: Array<number | null>;
  hotspotTemps: Array<number | null>;
  fanPwm: number | null;
  fanRpm: Array<number | null>;
  powerWatts: number | null;
  raw: unknown;
  createdAt: string;
}

export interface MinerCommandRecord extends RowDataPacket {
  id: number;
  miner_id: number;
  command_type: string;
  request_json: unknown;
  response_json: unknown;
  status: MinerCommandStatus;
  error_text: string | null;
  created_by: string | null;
  created_at: string;
}

export interface MinerCommandEntity {
  id: number;
  minerId: number;
  commandType: string;
  request: unknown;
  response: unknown;
  status: MinerCommandStatus;
  errorText: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface MinerOverview {
  totalMiners: number;
  onlineMiners: number;
  enabledMiners: number;
  totalRateThs: number;
  totalPowerWatts: number;
  hottestBoardTemp: number | null;
  hottestHotspotTemp: number | null;
  generatedAt: string;
}

export interface MinerVerificationResult {
  reachable: boolean;
  httpOk: boolean;
  cgminerOk: boolean;
  unlockOk: boolean;
  minerState: string | null;
  currentPreset: string | null;
  model: string | null;
  firmware: string | null;
  capabilities: MinerCapabilities;
  presets: Array<{
    name: string;
    pretty: string | null;
    status: string | null;
  }>;
  error: string | null;
}

export interface MinerPresetOption {
  name: string;
  pretty: string | null;
  status: string | null;
}

export interface MinerPoolLive {
  id: number;
  url: string;
  user: string;
  status: string;
  accepted?: number;
  rejected?: number;
  stale?: number;
}

export interface MinerLiveData {
  minerId: number;
  name: string;
  ip: string;
  online: boolean;
  minerState: string | null;
  unlocked: boolean;
  presetName: string | null;
  presetPretty: string | null;
  presetStatus: string | null;
  totalRateThs: number | null;
  boardTemps: number[];
  hotspotTemps: number[];
  chipTempStrings: string[];
  pcbTempStrings: string[];
  fanPwm: number | null;
  fanRpm: number[];
  chainRates: number[];
  chainStates: string[];
  powerWatts: number | null;
  poolActiveIndex: number | null;
  pools: MinerPoolLive[];
  lastSeenAt: string | null;
  raw?: unknown;
}

export interface MinerHistoryPoint {
  id: number;
  createdAt: string;
  online: boolean;
  totalRateThs: number | null;
  powerWatts: number | null;
  boardTemps: number[];
  hotspotTemps: number[];
  fanPwm: number | null;
}

export interface FleetHistoryPoint {
  timestamp: string;
  online: boolean;
  totalRateThs: number | null;
  maxBoardTemp: number | null;
  maxHotspotTemp: number | null;
  maxTemp: number | null;
  powerWatts: number | null;
}

export interface FleetHistorySeries {
  minerId: number;
  minerName: string;
  minerIp: string;
  points: FleetHistoryPoint[];
}

export interface FleetHistoryBucketRecord extends RowDataPacket {
  bucket_index: number;
  online: number | boolean;
  avg_total_rate_ths: number | null;
  avg_power_watts: number | null;
  max_board_temp: number | null;
  max_hotspot_temp: number | null;
}

export interface MinerCreateInput {
  name: string;
  ip: string;
  password: string;
}

export interface MinerUpdateInput {
  name?: string;
  ip?: string;
  password?: string;
  isEnabled?: boolean;
}

export interface MinerVerifyDraftInput {
  name: string;
  ip: string;
  password: string;
}

export interface MinerPersistInput {
  name: string;
  ip: string;
  apiBaseUrl: string;
  passwordEnc: string;
  model?: string | null;
  firmware?: string | null;
  currentPreset?: string | null;
  verificationStatus: MinerVerificationStatus;
  capabilities?: MinerCapabilities | null;
  lastSeenAt?: string | null;
  lastError?: string | null;
  isEnabled?: boolean;
}

export interface MinerPoolPersistInput {
  poolIndex: number;
  url: string;
  username: string;
  status: string | null;
  isActive: boolean;
}

export interface MinerCommandLogInput {
  minerId: number;
  commandType: string;
  request?: unknown;
  response?: unknown;
  status: MinerCommandStatus;
  errorText?: string | null;
  createdBy?: string | null;
}

export interface MinerSnapshotPersistInput {
  minerId: number;
  online: boolean;
  minerState: string | null;
  presetName: string | null;
  presetPretty: string | null;
  presetStatus: string | null;
  totalRateThs: number | null;
  boardTemps: Array<number | null>;
  hotspotTemps: Array<number | null>;
  fanPwm: number | null;
  fanRpm: Array<number | null>;
  powerWatts: number | null;
  raw: unknown;
}

export interface MinerHttpStatusPayload {
  state?: string;
  unlocked?: boolean;
  model?: string;
  firmware?: string;
  restart_required?: boolean;
  reboot_required?: boolean;
  [key: string]: unknown;
}

export interface MinerPerfSummaryPayload {
  preset_name?: string;
  preset_pretty?: string;
  preset_status?: string;
  current_preset?: {
    name?: string;
    pretty?: string;
    status?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface MinerReadResult {
  liveData: MinerLiveData;
  httpOk: boolean;
  cgminerOk: boolean;
  statusPayload: MinerHttpStatusPayload | null;
  perfSummaryPayload: MinerPerfSummaryPayload | null;
  summaryPayload: Record<string, unknown> | null;
  infoPayload: Record<string, unknown> | null;
  chipsPayload: unknown | null;
  layoutPayload: unknown | null;
  settingsPayload: unknown | null;
  cgminerSummary: Record<string, unknown> | null;
  cgminerStats: Record<string, unknown> | null;
  cgminerDevs: unknown[];
  cgminerPools: unknown[];
  presets: unknown[] | null;
}

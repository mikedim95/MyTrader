import { MinerAuthService } from "./miner-auth-service.js";
import { MinerCgminerClient } from "./miner-cgminer-client.js";
import { MinerHttpClient } from "./miner-http-client.js";
import { normalizeMinerLiveData } from "./miner-normalizer.js";
import { MinerRepository } from "./miner-repository.js";
import { MinerEntity, MinerPerfSummaryPayload, MinerReadResult } from "./types.js";
import { cleanString, parseJsonObject } from "./miner-utils.js";

export class MinerReadService {
  constructor(
    private readonly repository: MinerRepository,
    private readonly httpClient: MinerHttpClient,
    private readonly cgminerClient: MinerCgminerClient,
    private readonly authService: MinerAuthService
  ) {}

  private async tryHttpGet<T>(miner: MinerEntity, path: string): Promise<T | null> {
    try {
      return await this.httpClient.get<T>(miner.apiBaseUrl, path);
    } catch {
      return null;
    }
  }

  private async tryAuthedGet<T>(miner: MinerEntity, path: string): Promise<T | null> {
    try {
      const token = await this.authService.getValidToken(miner);
      return await this.httpClient.get<T>(
        miner.apiBaseUrl,
        path,
        token,
        () => this.authService.retryWithFreshToken(miner)
      );
    } catch {
      return null;
    }
  }

  async readMiner(miner: MinerEntity): Promise<MinerReadResult> {
    const [statusResult, perfResult, summaryResult, statsResult, poolsResult, presetsResult] = await Promise.allSettled([
      this.tryHttpGet<Record<string, unknown>>(miner, "/status"),
      this.tryHttpGet<MinerPerfSummaryPayload>(miner, "/perf-summary"),
      this.cgminerClient.summary(miner.ip),
      this.cgminerClient.stats(miner.ip),
      this.cgminerClient.pools(miner.ip),
      this.tryAuthedGet<unknown[]>(miner, "/autotune/presets"),
    ]);

    const statusPayload = statusResult.status === "fulfilled" ? statusResult.value : null;
    const perfSummaryPayload = perfResult.status === "fulfilled" ? perfResult.value : null;
    const cgminerSummary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
    const cgminerStats = statsResult.status === "fulfilled" ? statsResult.value : null;
    const cgminerPools = poolsResult.status === "fulfilled" ? poolsResult.value : [];
    const presets = presetsResult.status === "fulfilled" ? presetsResult.value : null;
    const storedPools = await this.repository.listPools(miner.id);

    const liveData = normalizeMinerLiveData({
      miner,
      statusPayload,
      perfSummaryPayload,
      cgminerStats,
      cgminerSummary,
      cgminerPools,
      storedPools,
    });

    const nowIso = liveData.online ? new Date().toISOString() : miner.lastSeenAt;
    const nextModel =
      cleanString(statusPayload ? statusPayload.model : undefined) ??
      cleanString(parseJsonObject(statusPayload)?.model) ??
      miner.model;
    const nextFirmware =
      cleanString(statusPayload ? statusPayload.firmware : undefined) ??
      cleanString(parseJsonObject(statusPayload)?.fw_name) ??
      miner.firmware;

    await this.repository.updateMiner(miner.id, {
      model: nextModel,
      firmware: nextFirmware,
      currentPreset: liveData.presetName,
      lastSeenAt: nowIso,
      lastError: liveData.online ? null : miner.lastError,
    });

    const refreshedMiner = await this.repository.getMinerById(miner.id);
    if (refreshedMiner) {
      liveData.lastSeenAt = refreshedMiner.lastSeenAt;
    }

    return {
      liveData,
      httpOk: Boolean(statusPayload || perfSummaryPayload),
      cgminerOk: Boolean(cgminerSummary || cgminerStats || cgminerPools.length > 0),
      statusPayload,
      perfSummaryPayload,
      cgminerSummary,
      cgminerStats,
      cgminerPools,
      presets,
    };
  }

  async setPreset(_minerId: number, _presetName: string): Promise<void> {
    // TODO: implement VNish preset writes after confirming /settings write schema from a target miner.
    throw new Error("Preset writes are not implemented yet.");
  }
}

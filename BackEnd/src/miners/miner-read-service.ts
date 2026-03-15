import { MinerAuthService } from "./miner-auth-service.js";
import { MinerCgminerClient } from "./miner-cgminer-client.js";
import { MinerHttpClient } from "./miner-http-client.js";
import { extractMinerIdentity, normalizeMinerLiveData } from "./miner-normalizer.js";
import { MinerRepository } from "./miner-repository.js";
import { MinerEntity, MinerPerfSummaryPayload, MinerReadResult } from "./types.js";

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

  async readPayload<T>(miner: MinerEntity, path: string, options?: { authenticated?: boolean }): Promise<T> {
    if (options?.authenticated) {
      const token = await this.authService.getValidToken(miner);
      return this.httpClient.get<T>(
        miner.apiBaseUrl,
        path,
        token,
        () => this.authService.retryWithFreshToken(miner)
      );
    }

    return this.httpClient.get<T>(miner.apiBaseUrl, path);
  }

  async readMiner(miner: MinerEntity): Promise<MinerReadResult> {
    const [statusResult, perfResult, summaryHttpResult, infoResult, chipsResult, summaryResult, statsResult, devsResult, poolsResult, presetsResult] =
      await Promise.allSettled([
      this.tryHttpGet<Record<string, unknown>>(miner, "/status"),
      this.tryHttpGet<MinerPerfSummaryPayload>(miner, "/perf-summary"),
      this.tryHttpGet<Record<string, unknown>>(miner, "/summary"),
      this.tryHttpGet<Record<string, unknown>>(miner, "/info"),
      this.tryHttpGet<unknown>(miner, "/chips"),
      this.cgminerClient.summary(miner.ip),
      this.cgminerClient.stats(miner.ip),
      this.cgminerClient.devs(miner.ip),
      this.cgminerClient.pools(miner.ip),
      this.tryAuthedGet<unknown[]>(miner, "/autotune/presets"),
    ]);

    const statusPayload = statusResult.status === "fulfilled" ? statusResult.value : null;
    const perfSummaryPayload = perfResult.status === "fulfilled" ? perfResult.value : null;
    const summaryPayload = summaryHttpResult.status === "fulfilled" ? summaryHttpResult.value : null;
    const infoPayload = infoResult.status === "fulfilled" ? infoResult.value : null;
    const chipsPayload = chipsResult.status === "fulfilled" ? chipsResult.value : null;
    const cgminerSummary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
    const cgminerStats = statsResult.status === "fulfilled" ? statsResult.value : null;
    const cgminerDevs = devsResult.status === "fulfilled" ? devsResult.value : [];
    const cgminerPools = poolsResult.status === "fulfilled" ? poolsResult.value : [];
    const presets = presetsResult.status === "fulfilled" ? presetsResult.value : null;
    const storedPools = await this.repository.listPools(miner.id);

    const liveData = normalizeMinerLiveData({
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
      storedPools,
    });

    const nowIso = liveData.online ? new Date().toISOString() : miner.lastSeenAt;
    const nextIdentity = extractMinerIdentity({
      statusPayload,
      summaryPayload,
      infoPayload,
      cgminerStats,
    });

    await this.repository.updateMiner(miner.id, {
      model: nextIdentity.model ?? miner.model,
      firmware: nextIdentity.firmware ?? miner.firmware,
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
      httpOk: Boolean(statusPayload || perfSummaryPayload || summaryPayload || infoPayload || chipsPayload),
      cgminerOk: Boolean(cgminerSummary || cgminerStats || cgminerDevs.length > 0 || cgminerPools.length > 0),
      statusPayload,
      perfSummaryPayload,
      summaryPayload,
      infoPayload,
      chipsPayload,
      layoutPayload: null,
      settingsPayload: null,
      cgminerSummary,
      cgminerStats,
      cgminerDevs,
      cgminerPools,
      presets,
    };
  }

  async setPreset(_minerId: number, _presetName: string): Promise<void> {
    // TODO: implement VNish preset writes after confirming /settings write schema from a target miner.
    throw new Error("Preset writes are not implemented yet.");
  }
}

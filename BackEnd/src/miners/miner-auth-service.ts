import { MinerCryptoService } from "./miner-crypto-service.js";
import { MinerEntity } from "./types.js";
import { MinerHttpClient } from "./miner-http-client.js";
import { cleanString } from "./miner-utils.js";

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class MinerAuthService {
  private readonly tokenCache = new Map<number, CachedToken>();

  constructor(
    private readonly httpClient: MinerHttpClient,
    private readonly cryptoService: MinerCryptoService,
    private readonly tokenTtlMs = 15 * 60 * 1000
  ) {}

  invalidate(minerId: number): void {
    this.tokenCache.delete(minerId);
  }

  async getValidToken(miner: MinerEntity): Promise<string> {
    const cached = this.tokenCache.get(miner.id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    const token = await this.unlock(miner);
    this.tokenCache.set(miner.id, {
      token,
      expiresAt: Date.now() + this.tokenTtlMs,
    });
    return token;
  }

  async retryWithFreshToken(miner: MinerEntity): Promise<string | null> {
    this.invalidate(miner.id);
    return this.getValidToken(miner);
  }

  private extractToken(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") return null;
    const record = payload as Record<string, unknown>;
    return (
      cleanString(record.token) ??
      cleanString(record.access_token) ??
      cleanString(record.bearer) ??
      cleanString(record.jwt)
    );
  }

  async unlock(miner: MinerEntity): Promise<string> {
    const password = this.cryptoService.decrypt(miner.passwordEnc);
    const payload = await this.httpClient.post<unknown>(miner.apiBaseUrl, "/unlock", {
      pw: password,
    });
    const token = this.extractToken(payload);
    if (!token) {
      throw new Error(`VNish unlock succeeded but no bearer token was returned for miner ${miner.name}.`);
    }
    return token;
  }
}

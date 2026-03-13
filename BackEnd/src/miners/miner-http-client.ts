interface MinerHttpRequestOptions {
  baseUrl: string;
  path: string;
  method?: "GET" | "POST" | "PATCH";
  token?: string;
  body?: unknown;
  retryOnUnauthorized?: () => Promise<string | null>;
}

export class MinerHttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly payload?: unknown
  ) {
    super(message);
    this.name = "MinerHttpError";
  }
}

function parseJsonSafely(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export class MinerHttpClient {
  constructor(private readonly timeoutMs = 5_000) {}

  async request<T>(options: MinerHttpRequestOptions): Promise<T> {
    const { baseUrl, path, method = "GET", body } = options;
    let token = options.token;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const headers = new Headers();
      headers.set("Accept", "application/json");
      if (body !== undefined) {
        headers.set("Content-Type", "application/json");
      }
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }

      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const rawText = await response.text();
      const payload = parseJsonSafely(rawText);

      if (response.status === 401 && attempt === 0 && options.retryOnUnauthorized) {
        token = (await options.retryOnUnauthorized()) ?? undefined;
        if (token) {
          continue;
        }
      }

      if (!response.ok) {
        const message =
          payload && typeof payload === "object" && "message" in payload && typeof (payload as { message?: unknown }).message === "string"
            ? String((payload as { message: string }).message)
            : `Miner HTTP request failed with status ${response.status}.`;
        throw new MinerHttpError(message, response.status, payload);
      }

      return payload as T;
    }

    throw new MinerHttpError("Miner HTTP request failed after re-authentication.", 401);
  }

  get<T>(baseUrl: string, path: string, token?: string, retryOnUnauthorized?: () => Promise<string | null>): Promise<T> {
    return this.request<T>({
      baseUrl,
      path,
      method: "GET",
      token,
      retryOnUnauthorized,
    });
  }

  post<T>(
    baseUrl: string,
    path: string,
    body?: unknown,
    token?: string,
    retryOnUnauthorized?: () => Promise<string | null>
  ): Promise<T> {
    return this.request<T>({
      baseUrl,
      path,
      method: "POST",
      body,
      token,
      retryOnUnauthorized,
    });
  }
}

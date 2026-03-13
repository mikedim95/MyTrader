import net from "node:net";

interface CgminerRawResponse {
  [key: string]: unknown;
}

function parseJsonWithNullTerminator(raw: string): CgminerRawResponse {
  const sanitized = raw.replace(/\u0000+$/g, "").trim();
  if (!sanitized) {
    throw new Error("CGMiner returned an empty response.");
  }
  return JSON.parse(sanitized) as CgminerRawResponse;
}

function normalizeCgminerPayload(command: string, payload: CgminerRawResponse): Record<string, unknown> | unknown[] {
  const upperCommand = command.toUpperCase();
  const keyedValue = payload[upperCommand];
  if (Array.isArray(keyedValue) && keyedValue.length > 0) {
    if (command === "pools" || command === "devs") {
      return keyedValue as unknown[];
    }
    const first = keyedValue[0];
    return typeof first === "object" && first !== null ? (first as Record<string, unknown>) : payload;
  }

  const fallbackKeys = ["SUMMARY", "STATS", "POOLS", "DEVS"];
  for (const key of fallbackKeys) {
    const value = payload[key];
    if (Array.isArray(value) && value.length > 0) {
      if (key === "POOLS" || key === "DEVS") {
        return value as unknown[];
      }
      const first = value[0];
      return typeof first === "object" && first !== null ? (first as Record<string, unknown>) : payload;
    }
  }

  return payload;
}

export class MinerCgminerClient {
  constructor(private readonly timeoutMs = 5_000) {}

  async command(command: "summary" | "stats" | "pools" | "devs", host: string, port = 4028): Promise<Record<string, unknown> | unknown[]> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const chunks: Buffer[] = [];

      const handleFailure = (error: Error) => {
        socket.destroy();
        reject(error);
      };

      socket.setTimeout(this.timeoutMs, () => {
        handleFailure(new Error(`CGMiner ${command} timed out after ${this.timeoutMs}ms.`));
      });

      socket.once("error", handleFailure);

      socket.on("data", (chunk) => {
        chunks.push(Buffer.from(chunk));
      });

      socket.on("end", () => {
        try {
          const payload = parseJsonWithNullTerminator(Buffer.concat(chunks).toString("utf8"));
          resolve(normalizeCgminerPayload(command, payload));
        } catch (error) {
          reject(error);
        }
      });

      socket.on("connect", () => {
        socket.write(JSON.stringify({ command }) + "\u0000");
      });
    });
  }

  summary(host: string): Promise<Record<string, unknown>> {
    return this.command("summary", host) as Promise<Record<string, unknown>>;
  }

  stats(host: string): Promise<Record<string, unknown>> {
    return this.command("stats", host) as Promise<Record<string, unknown>>;
  }

  pools(host: string): Promise<unknown[]> {
    return this.command("pools", host) as Promise<unknown[]>;
  }

  devs(host: string): Promise<unknown[]> {
    return this.command("devs", host) as Promise<unknown[]>;
  }
}

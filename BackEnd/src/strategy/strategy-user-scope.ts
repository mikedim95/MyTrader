import type { Request } from "express";

export interface StrategyUserScope {
  userId?: number;
  username?: string;
}

function parsePositiveInteger(value: unknown): number | undefined {
  const raw = typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseUsername(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  return normalized;
}

function extractBodyValue(req: Request, key: string): unknown {
  if (!req.body || typeof req.body !== "object") return undefined;
  return (req.body as Record<string, unknown>)[key];
}

export function resolveStrategyUserScope(req: Request): StrategyUserScope | undefined {
  const idFromHeader = parsePositiveInteger(req.header("x-user-id"));
  const idFromQuery = parsePositiveInteger(req.query?.userId);
  const idFromBody = parsePositiveInteger(extractBodyValue(req, "userId"));
  const userId = idFromHeader ?? idFromQuery ?? idFromBody;

  const nameFromHeader = parseUsername(req.header("x-user") ?? req.header("x-username"));
  const nameFromQuery = parseUsername(req.query?.user ?? req.query?.username);
  const nameFromBody = parseUsername(extractBodyValue(req, "user") ?? extractBodyValue(req, "username"));
  const username = nameFromHeader ?? nameFromQuery ?? nameFromBody;

  if (!userId && !username) return undefined;
  return { userId, username };
}

export function strategyUserScopeKey(scope?: StrategyUserScope): string {
  if (!scope) return "default";
  if (typeof scope.userId === "number" && Number.isInteger(scope.userId) && scope.userId > 0) {
    return `id:${scope.userId}`;
  }
  if (scope.username) return `user:${scope.username.trim().toLowerCase()}`;
  return "default";
}

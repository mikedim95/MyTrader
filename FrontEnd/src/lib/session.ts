import type { AppSession } from "@/types/api";

const SESSION_STORAGE_KEY = "mytrader_session";

function canUseSessionStorage(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

export function getStoredSession(): AppSession | null {
  if (!canUseSessionStorage()) return null;

  const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<AppSession>;
    if (!parsed || typeof parsed.username !== "string" || parsed.username.trim().length === 0) {
      return null;
    }

    return {
      userId: typeof parsed.userId === "number" ? parsed.userId : undefined,
      username: parsed.username.trim().toLowerCase(),
      storageMode: parsed.storageMode === "offline" ? "offline" : "database",
      databaseAvailable: parsed.databaseAvailable !== false,
    };
  } catch {
    return null;
  }
}

export function setStoredSession(session: AppSession): void {
  if (!canUseSessionStorage()) return;
  window.sessionStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({
      ...session,
      username: session.username.trim().toLowerCase(),
    })
  );
}

export function clearStoredSession(): void {
  if (!canUseSessionStorage()) return;
  window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

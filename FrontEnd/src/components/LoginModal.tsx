import { FormEvent, useEffect, useState } from "react";
import { Database, ShieldAlert, UserRound } from "lucide-react";
import type { SessionStatusResponse } from "@/types/api";

interface LoginModalProps {
  status?: SessionStatusResponse;
  statusError?: string;
  loginError?: string;
  defaultUsername?: string;
  isSubmitting: boolean;
  onSubmit: (credentials: { username: string; password: string }) => void;
}

export function LoginModal({
  status,
  statusError,
  loginError,
  defaultUsername,
  isSubmitting,
  onSubmit,
}: LoginModalProps) {
  const [username, setUsername] = useState(defaultUsername ?? "");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!defaultUsername) return;
    setUsername(defaultUsername);
  }, [defaultUsername]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit({
      username: username.trim(),
      password: password.trim(),
    });
  };

  const offlineMode = status?.databaseAvailable === false;
  const offlineHint = status?.dummyCredentials?.[0];
  const helperMessage =
    statusError ??
    status?.message ??
    "Checking backend session options. If the database is down, dummy credentials will appear below.";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.16),_transparent_35%),linear-gradient(180deg,_#060816_0%,_#0b1220_48%,_#111827_100%)] px-4 py-10 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-3xl border border-white/10 bg-slate-950/80 shadow-[0_40px_120px_rgba(15,23,42,0.55)] backdrop-blur-xl lg:grid-cols-[1.1fr_0.9fr]">
          <div className="border-b border-white/10 p-8 lg:border-b-0 lg:border-r lg:p-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-300/10 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.28em] text-amber-200">
              <Database className="h-3.5 w-3.5" />
              Secure Session
            </div>

            <h1 className="mt-6 max-w-md text-3xl font-semibold tracking-tight text-white">
              Sign in before the trading workspace loads.
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-6 text-slate-300">
              Every session is scoped to a user. When the database is offline, the app switches to dummy-user mode and
              shows the fallback credentials under the form.
            </p>

            <div
              className={`mt-8 rounded-2xl border px-4 py-4 text-sm ${
                offlineMode
                  ? "border-amber-400/30 bg-amber-300/10 text-amber-100"
                  : "border-emerald-400/25 bg-emerald-300/10 text-emerald-100"
              }`}
            >
              <div className="flex items-start gap-3">
                {offlineMode ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <Database className="mt-0.5 h-4 w-4 shrink-0" />}
                <div>{helperMessage}</div>
              </div>
            </div>

          </div>

          <div className="p-8 lg:p-12">
            <div className="mb-6 flex items-center gap-3 text-slate-300">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                <UserRound className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[11px] font-mono uppercase tracking-[0.24em] text-slate-400">User Session</div>
                <div className="mt-1 text-sm text-slate-200">
                  {offlineMode ? "Offline dummy access" : "Database-backed access"}
                </div>
              </div>
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              <div>
                <label className="text-[11px] font-mono uppercase tracking-[0.22em] text-slate-400">Username</label>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-300/40 focus:bg-white/10"
                  autoComplete="username"
                  placeholder={offlineHint?.username ?? "mike"}
                  disabled={isSubmitting}
                />
              </div>

              <div>
                <label className="text-[11px] font-mono uppercase tracking-[0.22em] text-slate-400">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-300/40 focus:bg-white/10"
                  autoComplete="current-password"
                  placeholder={offlineHint?.password ?? "password"}
                  disabled={isSubmitting}
                />
              </div>

              {offlineHint ? (
                <div className="rounded-2xl border border-sky-400/25 bg-sky-300/10 px-4 py-3 text-sm text-sky-100">
                  <div className="text-[11px] font-mono uppercase tracking-[0.24em] text-sky-200">Dummy Credentials</div>
                  <div className="mt-2 space-y-1 font-mono text-xs">
                    <div>Username: {offlineHint.username}</div>
                    <div>Password: {offlineHint.password}</div>
                  </div>
                </div>
              ) : null}

              {loginError ? <div className="rounded-2xl border border-rose-400/30 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">{loginError}</div> : null}

              <button
                type="submit"
                disabled={isSubmitting || username.trim().length === 0 || password.trim().length === 0}
                className="w-full rounded-2xl bg-amber-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {isSubmitting ? "Signing in..." : "Open Workspace"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

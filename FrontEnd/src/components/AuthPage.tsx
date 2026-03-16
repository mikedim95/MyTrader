import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Database, ShieldAlert, UserRound } from "lucide-react";
import type { SessionStatusResponse } from "@/types/api";

interface AuthPageProps {
  mode: "login" | "signup";
  status?: SessionStatusResponse;
  statusError?: string;
  authError?: string;
  defaultUsername?: string;
  isSubmitting: boolean;
  onSubmit: (credentials: { username: string; password: string }) => void;
}

export function AuthPage({
  mode,
  status,
  statusError,
  authError,
  defaultUsername,
  isSubmitting,
  onSubmit,
}: AuthPageProps) {
  const [username, setUsername] = useState(defaultUsername ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | undefined>();

  useEffect(() => {
    if (mode !== "login" || !defaultUsername) return;
    setUsername(defaultUsername);
  }, [defaultUsername, mode]);

  const offlineMode = status?.databaseAvailable === false;
  const offlineHint = status?.dummyCredentials?.[0];
  const helperMessage =
    statusError ??
    status?.message ??
    "Checking backend session options. If the database is down, dummy credentials will appear below.";

  const content = useMemo(
    () =>
      mode === "login"
        ? {
            eyebrow: "Secure Session",
            title: "Sign in before the trading workspace loads.",
            body:
              "Every session is scoped to a user. Use the dedicated signup page to create a new account. When the database is offline, the app switches to dummy-user mode.",
            panelTitle: offlineMode ? "Offline dummy access" : "Database-backed access",
            submitLabel: isSubmitting ? "Signing in..." : "Open Workspace",
            switchLabel: "Need an account?",
            switchAction: "Create one",
            switchHref: "/signup",
          }
        : {
            eyebrow: "Create Account",
            title: "Create a workspace account before you sign in.",
            body:
              "Signup is separate from login now. New users must be created here first, then future access uses the login page only.",
            panelTitle: offlineMode ? "Signup unavailable offline" : "Create database-backed access",
            submitLabel: isSubmitting ? "Creating account..." : "Create Account",
            switchLabel: "Already registered?",
            switchAction: "Sign in",
            switchHref: "/login",
          },
    [isSubmitting, mode, offlineMode]
  );

  const resolvedError = formError ?? authError;
  const submitDisabled =
    isSubmitting ||
    username.trim().length === 0 ||
    password.trim().length === 0 ||
    (mode === "signup" && (confirmPassword.trim().length === 0 || offlineMode));

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(undefined);

    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    if (mode === "signup" && trimmedPassword !== confirmPassword.trim()) {
      setFormError("Passwords do not match.");
      return;
    }

    onSubmit({
      username: trimmedUsername,
      password: trimmedPassword,
    });
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.16),_transparent_35%),linear-gradient(180deg,_#060816_0%,_#0b1220_48%,_#111827_100%)] px-4 py-6 text-white sm:px-6 sm:py-10">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl items-center justify-center sm:min-h-[calc(100vh-5rem)]">
        <div className="grid w-full overflow-hidden rounded-3xl border border-white/10 bg-slate-950/80 shadow-[0_40px_120px_rgba(15,23,42,0.55)] backdrop-blur-xl lg:grid-cols-[1.1fr_0.9fr]">
          <div className="border-b border-white/10 p-6 sm:p-8 lg:border-b-0 lg:border-r lg:p-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-300/10 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.28em] text-amber-200">
              <Database className="h-3.5 w-3.5" />
              {content.eyebrow}
            </div>

            <h1 className="mt-6 max-w-md text-3xl font-semibold tracking-tight text-white">{content.title}</h1>
            <p className="mt-4 max-w-lg text-sm leading-6 text-slate-300">{content.body}</p>

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

          <div className="p-6 sm:p-8 lg:p-12">
            <div className="mb-6 flex items-center gap-3 text-slate-300">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                <UserRound className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[11px] font-mono uppercase tracking-[0.24em] text-slate-400">User Session</div>
                <div className="mt-1 text-sm text-slate-200">{content.panelTitle}</div>
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
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  placeholder={offlineHint?.password ?? "password"}
                  disabled={isSubmitting}
                />
              </div>

              {mode === "signup" ? (
                <div>
                  <label className="text-[11px] font-mono uppercase tracking-[0.22em] text-slate-400">Confirm Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-300/40 focus:bg-white/10"
                    autoComplete="new-password"
                    placeholder="Repeat password"
                    disabled={isSubmitting || offlineMode}
                  />
                </div>
              ) : null}

              {mode === "login" && offlineHint ? (
                <div className="rounded-2xl border border-sky-400/25 bg-sky-300/10 px-4 py-3 text-sm text-sky-100">
                  <div className="text-[11px] font-mono uppercase tracking-[0.24em] text-sky-200">Dummy Credentials</div>
                  <div className="mt-2 space-y-1 font-mono text-xs">
                    <div>Username: {offlineHint.username}</div>
                    <div>Password: {offlineHint.password}</div>
                  </div>
                </div>
              ) : null}

              {mode === "signup" && offlineMode ? (
                <div className="rounded-2xl border border-amber-400/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
                  Signup is disabled while the database is offline. Use the login page with the dummy credentials instead.
                </div>
              ) : null}

              {resolvedError ? (
                <div className="rounded-2xl border border-rose-400/30 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">{resolvedError}</div>
              ) : null}

              <button
                type="submit"
                disabled={submitDisabled}
                className="w-full rounded-2xl bg-amber-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {content.submitLabel}
              </button>

              <div className="text-center text-sm text-slate-300">
                {content.switchLabel}{" "}
                <Link className="font-semibold text-amber-200 hover:text-amber-100" to={content.switchHref}>
                  {content.switchAction}
                </Link>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthPage } from "@/components/AuthPage";
import { backendApi } from "@/lib/api";
import { clearStoredSession, getStoredSession, setStoredSession } from "@/lib/session";
import type { AppSession, SessionStatusResponse } from "@/types/api";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

function resolveStatusFromError(error: unknown): SessionStatusResponse | undefined {
  if (!error || typeof error !== "object") return undefined;
  const responsePayload = (error as { responsePayload?: unknown }).responsePayload;
  if (!responsePayload || typeof responsePayload !== "object") return undefined;
  const status = (responsePayload as { status?: unknown }).status;
  if (!status || typeof status !== "object") return undefined;
  return status as SessionStatusResponse;
}

function AppRoutes() {
  const reactQueryClient = useQueryClient();
  const [session, setSession] = useState<AppSession | null>(() => getStoredSession());
  const [authError, setAuthError] = useState<string | undefined>();
  const [statusOverride, setStatusOverride] = useState<SessionStatusResponse | undefined>();

  const sessionStatusQuery = useQuery({
    queryKey: ["session-status"],
    queryFn: backendApi.getSessionStatus,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: false,
  });

  useEffect(() => {
    if (!session) return;
    setStoredSession(session);
  }, [session]);

  const loginMutation = useMutation({
    mutationFn: backendApi.loginSession,
    onSuccess: async (result) => {
      setStoredSession(result.session);
      setSession(result.session);
      setAuthError(undefined);
      setStatusOverride(result.status);
      reactQueryClient.clear();
    },
    onError: (error) => {
      setAuthError(error instanceof Error ? error.message : "Unable to sign in.");
      const nextStatus = resolveStatusFromError(error);
      if (nextStatus) {
        setStatusOverride(nextStatus);
      }
    },
  });

  const signupMutation = useMutation({
    mutationFn: backendApi.signupSession,
    onSuccess: async (result) => {
      setStoredSession(result.session);
      setSession(result.session);
      setAuthError(undefined);
      setStatusOverride(result.status);
      reactQueryClient.clear();
    },
    onError: (error) => {
      setAuthError(error instanceof Error ? error.message : "Unable to sign up.");
      const nextStatus = resolveStatusFromError(error);
      if (nextStatus) {
        setStatusOverride(nextStatus);
      }
    },
  });

  const sessionStatus = statusOverride ?? sessionStatusQuery.data;
  const sessionStatusError = sessionStatusQuery.isError && sessionStatusQuery.error instanceof Error
    ? sessionStatusQuery.error.message
    : undefined;

  const handleLogout = () => {
    clearStoredSession();
    setSession(null);
    setAuthError(undefined);
    setStatusOverride(undefined);
    reactQueryClient.clear();
  };

  if (!session) {
    return (
      <Routes>
        <Route
          path="/login"
          element={
            <AuthPage
              mode="login"
              status={sessionStatus}
              statusError={sessionStatusError}
              authError={authError}
              defaultUsername={sessionStatus?.dummyCredentials?.[0]?.username}
              isSubmitting={loginMutation.isPending}
              onSubmit={(credentials) => {
                setAuthError(undefined);
                loginMutation.mutate(credentials);
              }}
            />
          }
        />
        <Route
          path="/signup"
          element={
            <AuthPage
              mode="signup"
              status={sessionStatus}
              statusError={sessionStatusError}
              authError={authError}
              isSubmitting={signupMutation.isPending}
              onSubmit={(credentials) => {
                setAuthError(undefined);
                signupMutation.mutate(credentials);
              }}
            />
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Index session={session} onLogout={handleLogout} />} />
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/signup" element={<Navigate to="/" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppRoutes />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

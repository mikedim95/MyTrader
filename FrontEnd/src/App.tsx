import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LoginModal } from "@/components/LoginModal";
import { backendApi } from "@/lib/api";
import { clearStoredSession, setStoredSession } from "@/lib/session";
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
  const [session, setSession] = useState<AppSession | null>(null);
  const [loginError, setLoginError] = useState<string | undefined>();
  const [statusOverride, setStatusOverride] = useState<SessionStatusResponse | undefined>();

  useEffect(() => {
    clearStoredSession();
  }, []);

  const sessionStatusQuery = useQuery({
    queryKey: ["session-status"],
    queryFn: backendApi.getSessionStatus,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: backendApi.loginSession,
    onSuccess: async (result) => {
      setStoredSession(result.session);
      setSession(result.session);
      setLoginError(undefined);
      setStatusOverride(result.status);
      reactQueryClient.clear();
    },
    onError: (error) => {
      setLoginError(error instanceof Error ? error.message : "Unable to sign in.");
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
    setLoginError(undefined);
    setStatusOverride(undefined);
    reactQueryClient.clear();
  };

  if (!session) {
    return (
      <LoginModal
        status={sessionStatus}
        statusError={sessionStatusError}
        loginError={loginError}
        defaultUsername={sessionStatus?.dummyCredentials?.[0]?.username}
        isSubmitting={loginMutation.isPending}
        onSubmit={(credentials) => {
          setLoginError(undefined);
          loginMutation.mutate(credentials);
        }}
      />
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Index session={session} onLogout={handleLogout} />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

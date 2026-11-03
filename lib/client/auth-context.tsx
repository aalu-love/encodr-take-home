"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { LoginResponse, User } from "@/lib/types";
import { api, AUTH_LOGOUT_EVENT } from "@/lib/client/api";
import {
  clearTokens,
  getStoredUser,
  hydrateTokens,
  setStoredUser,
  setTokens,
} from "@/lib/client/token-store";

interface AuthContextValue {
  user: User | null;
  /** Hydration finished — safe to make auth decisions (avoids first-paint flicker). */
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    hydrateTokens();
    setUser(getStoredUser<User>());
    setReady(true);
  }, []);

  const logout = useCallback(() => {
    clearTokens();
    // Drop cached server data so the next user on this browser never sees the previous user's jobs.
    queryClient.clear();
    setUser(null);
    router.replace("/signin");
  }, [router, queryClient]);

  // If the API client can't recover the session it dispatches AUTH_LOGOUT_EVENT — react globally.
  useEffect(() => {
    const handler = () => logout();
    window.addEventListener(AUTH_LOGOUT_EVENT, handler);
    return () => window.removeEventListener(AUTH_LOGOUT_EVENT, handler);
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    // Throws ApiError with the server's message (e.g. "Invalid email or password") on failure.
    const data = await api.postPublic<LoginResponse>("/api/auth/login", { email, password });
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    setStoredUser(data.user);
    setUser(data.user);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, ready, login, logout }),
    [user, ready, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

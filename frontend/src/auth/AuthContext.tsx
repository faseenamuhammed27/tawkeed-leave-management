import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { configureClient } from "../api/client";
import { authApi } from "../api/endpoints";
import type { Role, User } from "../api/types";

const STORAGE_KEY = "tawkeed.session";

interface Session {
  token: string;
  user: User;
  expiresAt: number; // epoch ms
}

interface AuthContextValue {
  user: User | null;
  login: (email: string, password: string) => Promise<User>;
  logout: (reason?: string) => void;
  hasRole: (...roles: Role[]) => boolean;
  notice: string | null;
  clearNotice: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    return session.expiresAt > Date.now() ? session : null;
  } catch {
    return null;
  }
}

function saveSession(session: Session | null) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode): session lives in memory only */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(loadSession);
  const [notice, setNotice] = useState<string | null>(null);

  const logout = useCallback(
    (reason?: string) => {
      saveSession(null);
      setSession(null);
      queryClient.clear();
      setNotice(reason ?? null);
    },
    [queryClient],
  );

  // Keep the API client in sync with the current token. A 401 on any call ends the session.
  configureClient({
    getToken: () => session?.token ?? null,
    onUnauthorized: () => logout("Your session has expired. Please sign in again."),
  });

  // Log out automatically when the token expires.
  useEffect(() => {
    if (!session) return;
    const ms = session.expiresAt - Date.now();
    const timer = window.setTimeout(() => logout("Your session has expired. Please sign in again."), Math.max(ms, 0));
    return () => window.clearTimeout(timer);
  }, [session, logout]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    const next: Session = {
      token: res.access_token,
      user: res.user,
      // Expire slightly early so we never send a token the server is about to reject.
      expiresAt: Date.now() + (res.expires_in - 30) * 1000,
    };
    saveSession(next);
    setSession(next);
    setNotice(null);
    return res.user;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      login,
      logout,
      hasRole: (...roles) => !!session && roles.includes(session.user.role),
      notice,
      clearNotice: () => setNotice(null),
    }),
    [session, login, logout, notice],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

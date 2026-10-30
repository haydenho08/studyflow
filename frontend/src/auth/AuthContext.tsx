import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { refreshAccessToken } from "../api/client";
import { authApi } from "../api/endpoints";
import { queryKeys } from "../api/queries";
import type { User } from "../api/types";
import { IDLE, saveTimer } from "../lib/pomodoro";
import { browserTimeZone } from "../lib/week";
import { getSession, setSession, subscribe } from "./session";

interface AuthState {
  user: User | undefined;
  isAuthenticated: boolean;
  /** True while restoring a login on page load, or loading /me for it. */
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** Log in as the shared demo account (the server refreshes its data if it's stale). */
  loginDemo: () => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** End every login this account has, on every device (this one included). */
  logoutEverywhere: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Drop every cached response that belongs to a user, so the next person to log in on this
 * browser can never see the last one's data. The server's feature flags stay: they're the same
 * for everyone, and removing a query cancels its fetch, which would leave a page that's waiting
 * for them (the login page's "Forgot password?") waiting forever.
 */
function forgetUserData(queryClient: QueryClient) {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.config[0] });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { status } = useSyncExternalStore(subscribe, getSession);
  const queryClient = useQueryClient();

  // A login from an earlier visit (or another tab): trade the refresh cookie for an access token.
  useEffect(() => {
    if (status === "restoring") void refreshAccessToken();
  }, [status]);

  const me = useQuery({
    queryKey: queryKeys.me,
    queryFn: authApi.me,
    enabled: status === "in",
    staleTime: Infinity,
    retry: false,
  });

  // Whenever we end up logged out (button, login ended, another tab), forget every cached
  // response, so the next person to log in on this browser can never see the last user's data.
  // (A running timer is kept when a login just ends: it's tagged with its owner's id, so only
  // that same user gets it back after logging in again. See lib/pomodoro.ts loadTimer.)
  useEffect(() => {
    if (status === "out") forgetUserData(queryClient);
  }, [status, queryClient]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { access_token } = await authApi.login(email, password);
      forgetUserData(queryClient);
      setSession(access_token);
    },
    [queryClient],
  );

  const loginDemo = useCallback(async () => {
    const { access_token } = await authApi.demo(browserTimeZone());
    forgetUserData(queryClient);
    setSession(access_token);
  }, [queryClient]);

  const register = useCallback(
    async (email: string, password: string) => {
      await authApi.register(email, password);
      await login(email, password);
    },
    [login],
  );

  // Pressing "Log out" is deliberate, so it also stops any running timer. The server ends the
  // session first, so its tokens stop working at once; offline, this device logs out anyway.
  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    saveTimer(IDLE);
    setSession(null);
  }, []);

  // Unlike logout, a failure here is reported: the user needs to know other devices are still in.
  const logoutEverywhere = useCallback(async () => {
    await authApi.logoutEverywhere();
    saveTimer(IDLE);
    setSession(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user: me.data,
      isAuthenticated: status === "in",
      isLoading: status === "restoring" || (status === "in" && me.isPending),
      login,
      loginDemo,
      register,
      logout,
      logoutEverywhere,
    }),
    [me.data, me.isPending, status, login, loginDemo, register, logout, logoutEverywhere],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}

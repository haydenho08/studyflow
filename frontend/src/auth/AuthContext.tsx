import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { authApi } from "../api/endpoints";
import { queryKeys } from "../api/queries";
import type { User } from "../api/types";
import { IDLE, saveTimer } from "../lib/pomodoro";
import { browserTimeZone } from "../lib/week";
import { getToken, setToken, subscribe } from "./token";

interface AuthState {
  user: User | undefined;
  isAuthenticated: boolean;
  /** True while we have a token but haven't loaded /me yet. */
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** Log in as the shared demo account (the server refreshes its data if it's stale). */
  loginDemo: () => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const token = useSyncExternalStore(subscribe, getToken);
  const queryClient = useQueryClient();

  const me = useQuery({
    queryKey: queryKeys.me,
    queryFn: authApi.me,
    enabled: token !== null,
    staleTime: Infinity,
    retry: false,
  });

  // Whenever we end up logged out (button, expired token, another tab), forget every cached
  // response, so the next person to log in on this browser can never see the last user's data.
  // (A running timer is kept on expiry: it's tagged with its owner's id, so only that same
  // user gets it back after logging in again. See lib/pomodoro.ts loadTimer.)
  useEffect(() => {
    if (token === null) queryClient.clear();
  }, [token, queryClient]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { access_token } = await authApi.login(email, password);
      queryClient.clear();
      setToken(access_token);
    },
    [queryClient],
  );

  const loginDemo = useCallback(async () => {
    const { access_token } = await authApi.demo(browserTimeZone());
    queryClient.clear();
    setToken(access_token);
  }, [queryClient]);

  const register = useCallback(
    async (email: string, password: string) => {
      await authApi.register(email, password);
      await login(email, password);
    },
    [login],
  );

  // Pressing "Log out" is deliberate, so it also stops any running timer.
  const logout = useCallback(() => {
    saveTimer(IDLE);
    setToken(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user: me.data,
      isAuthenticated: token !== null,
      isLoading: token !== null && me.isPending,
      login,
      loginDemo,
      register,
      logout,
    }),
    [me.data, me.isPending, token, login, loginDemo, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}

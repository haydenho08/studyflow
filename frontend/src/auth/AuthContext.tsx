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
import { getToken, setToken, subscribe } from "./token";

interface AuthState {
  user: User | undefined;
  isAuthenticated: boolean;
  /** True while we have a token but haven't loaded /me yet. */
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
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

  const register = useCallback(
    async (email: string, password: string) => {
      await authApi.register(email, password);
      await login(email, password);
    },
    [login],
  );

  const logout = useCallback(() => setToken(null), []);

  const value = useMemo<AuthState>(
    () => ({
      user: me.data,
      isAuthenticated: token !== null,
      isLoading: token !== null && me.isPending,
      login,
      register,
      logout,
    }),
    [me.data, me.isPending, token, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}

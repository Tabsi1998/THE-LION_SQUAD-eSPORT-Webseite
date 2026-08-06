import * as SecureStore from "expo-secure-store";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, configureAuthBridge } from "../lib/api";
import { clearAllCache } from "../lib/cache";
import { isGuestUser, liveGuestUser } from "../live";
import { unregisterPushToken } from "../notifications/PushService";
import type { AuthResponse, User } from "../types";

const ACCESS_KEY = "tls.mobile.accessToken";
const REFRESH_KEY = "tls.mobile.refreshToken";
const REMEMBER_KEY = "tls.mobile.rememberSession";

type RegisterPayload = {
  username: string;
  email: string;
  password: string;
  accept_privacy: boolean;
  accept_terms: boolean;
  newsletter_consent?: boolean;
};

type AuthContextValue = {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  rememberSession: boolean;
  loading: boolean;
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  continueAsGuest: () => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [rememberSession, setRememberSession] = useState(true);
  const rememberSessionRef = useRef(true);
  const activeUserIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);

  const persistSession = useCallback(async (session: AuthResponse, remember?: boolean) => {
    const shouldRemember = remember ?? rememberSessionRef.current;
    if (activeUserIdRef.current && activeUserIdRef.current !== session.user.id) {
      await clearAllCache();
    }
    activeUserIdRef.current = session.user.id;
    setUser(session.user);
    setAccessToken(session.access_token);
    setRefreshToken(session.refresh_token);
    setRememberSession(shouldRemember);
    rememberSessionRef.current = shouldRemember;
    if (shouldRemember) {
      await Promise.all([
        SecureStore.setItemAsync(ACCESS_KEY, session.access_token),
        SecureStore.setItemAsync(REFRESH_KEY, session.refresh_token),
        SecureStore.setItemAsync(REMEMBER_KEY, "true"),
      ]);
    } else {
      await Promise.all([
        SecureStore.deleteItemAsync(ACCESS_KEY),
        SecureStore.deleteItemAsync(REFRESH_KEY),
        SecureStore.setItemAsync(REMEMBER_KEY, "false"),
      ]);
    }
  }, []);

  const clearSession = useCallback(async () => {
    setUser(null);
    activeUserIdRef.current = null;
    setAccessToken(null);
    setRefreshToken(null);
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
      clearAllCache(),
    ]);
  }, []);

  useEffect(() => {
    configureAuthBridge({
      readTokens: () => ({ accessToken, refreshToken, userId: user?.id || null }),
      persistSession,
      clearSession,
    });
  }, [accessToken, clearSession, persistSession, refreshToken, user?.id]);

  const refreshMe = useCallback(async () => {
    const { data } = await api.get<User>("/auth/me");
    setUser(data);
  }, []);

  useEffect(() => {
    let mounted = true;
    async function boot() {
      try {
        const [storedAccess, storedRefresh, storedRemember] = await Promise.all([
          SecureStore.getItemAsync(ACCESS_KEY),
          SecureStore.getItemAsync(REFRESH_KEY),
          SecureStore.getItemAsync(REMEMBER_KEY),
        ]);
        if (!mounted) return;

        const shouldRestore = storedRemember !== "false";
        setRememberSession(shouldRestore);
        rememberSessionRef.current = shouldRestore;
        if (!shouldRestore) {
          await clearSession();
          return;
        }

        if (storedAccess) {
          try {
            setAccessToken(storedAccess);
            setRefreshToken(storedRefresh);
            const { data } = await api.get<User>("/auth/me", {
              headers: { Authorization: `Bearer ${storedAccess}` },
            });
            if (mounted) setUser(data);
            return;
          } catch {
            // Fall through to refresh-token restore if the access token expired.
          }
        }

        if (storedRefresh) {
          setRefreshToken(storedRefresh);
          const { data } = await api.post<AuthResponse>("/auth/mobile/refresh", {
            refresh_token: storedRefresh,
          });
          if (mounted) await persistSession(data, true);
        }
      } catch {
        if (mounted) await clearSession();
      } finally {
        if (mounted) setLoading(false);
      }
    }
    boot();
    return () => {
      mounted = false;
    };
  }, [clearSession, persistSession]);

  const login = useCallback(
    async (email: string, password: string, remember = true) => {
      const { data } = await api.post<AuthResponse>("/auth/mobile/login", { email, password });
      await persistSession(data, remember);
    },
    [persistSession]
  );

  const continueAsGuest = useCallback(async () => {
    setUser(liveGuestUser);
    activeUserIdRef.current = liveGuestUser.id;
    setAccessToken(null);
    setRefreshToken(null);
    setRememberSession(false);
    rememberSessionRef.current = false;
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
      SecureStore.setItemAsync(REMEMBER_KEY, "false"),
      clearAllCache(),
    ]);
  }, []);

  const register = useCallback(
    async (payload: RegisterPayload) => {
      const { data } = await api.post<AuthResponse>("/auth/mobile/register", payload);
      await persistSession(data);
    },
    [persistSession]
  );

  const logout = useCallback(async () => {
    try {
      if (!isGuestUser(user) && refreshToken) {
        await unregisterPushToken().catch(() => {});
        await api.post("/auth/mobile/logout", { refresh_token: refreshToken });
      }
    } finally {
      await clearSession();
    }
  }, [clearSession, refreshToken, user]);

  const value = useMemo(
    () => ({ user, accessToken, refreshToken, rememberSession, loading, login, continueAsGuest, register, logout, refreshMe }),
    [accessToken, continueAsGuest, loading, login, logout, refreshMe, refreshToken, register, rememberSession, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

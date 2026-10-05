import * as SecureStore from "expo-secure-store";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, configureAuthBridge } from "../lib/api";
import { clearAllCache } from "../lib/cache";
import { signInWithPasskey } from "../lib/passkeys";
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

type RegistrationResponse = {
  verification_required: boolean;
  email: string;
};

type LoginResult = { mfaRequired: boolean; ticket?: string };

/**
 * Nach einer Passwort-Anmeldung (#919): die App darf mit diesem Ticket ohne neue Passworteingabe einen Passkey anlegen.
 * `deviceWithout` (#939): die stille Abfrage beim Öffnen von „Anmelden“ fand auf diesem Gerät keinen Passkey.
 */
export type PasskeyOffer = { ticket: string; userId: string; deviceWithout?: boolean };

type AuthContextValue = {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  rememberSession: boolean;
  loading: boolean;
  /** `noDevicePasskey` (#939): auf diesem Gerät gab es keinen Passkey - die Einladung gilt dann auch bei Passkeys anderswo. */
  login: (email: string, password: string, remember?: boolean, noDevicePasskey?: boolean) => Promise<LoginResult>;
  completeMfa: (ticket: string, code: string, remember?: boolean, noDevicePasskey?: boolean) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<RegistrationResponse>;
  /** `silent`: beim Öffnen der Anmeldung nur sofort verfügbare Passkeys, ohne Auswahl von Android (#919). */
  loginWithPasskey: (remember?: boolean, silent?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  /** Einladung zum Passkey (#919) - nur direkt nach einer Passwort-Anmeldung, sonst null. */
  passkeyOffer: PasskeyOffer | null;
  clearPasskeyOffer: () => void;
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
  const [passkeyOffer, setPasskeyOffer] = useState<PasskeyOffer | null>(null);

  // Gast zuerst (#918): ohne Sitzung bleibt die App offen - mit allem Öffentlichen, ohne Anmeldebildschirm vorweg.
  const enterGuest = useCallback(() => {
    setUser(liveGuestUser);
    activeUserIdRef.current = liveGuestUser.id;
  }, []);

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
    // Abgemeldet oder Sitzung abgelaufen (#918): zurück in den Gastmodus statt auf den Anmeldebildschirm.
    enterGuest();
    setPasskeyOffer(null);
    setAccessToken(null);
    setRefreshToken(null);
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
      clearAllCache(),
    ]);
  }, [enterGuest]);

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
          return;
        }
        // Nichts gespeichert (erster Start oder abgemeldet): Gastmodus (#918).
        if (mounted) enterGuest();
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
  }, [clearSession, enterGuest, persistSession]);

  const offerPasskey = useCallback((session: AuthResponse & { passkey_ticket?: string | null }, deviceWithout = false) => {
    setPasskeyOffer(session.passkey_ticket ? { ticket: session.passkey_ticket, userId: session.user.id, deviceWithout } : null);
  }, []);

  const login = useCallback(
    async (email: string, password: string, remember = true, noDevicePasskey = false) => {
      const { data } = await api.post<AuthResponse>("/auth/mobile/login", { email, password });
      const challenge = data as AuthResponse & { mfa_required?: boolean; mfa_ticket?: string };
      if (challenge.mfa_required) return { mfaRequired: true, ticket: challenge.mfa_ticket };
      await persistSession(data, remember);
      offerPasskey(data, noDevicePasskey);
      return { mfaRequired: false };
    },
    [offerPasskey, persistSession]
  );

  // Passkey-Anmeldung (#217 Stufe 2): derselbe Passkey wie auf der Website, Gerätesperre statt Passwort.
  const loginWithPasskey = useCallback(async (remember = true, silent = false) => {
    const session = await signInWithPasskey(remember, silent);
    await persistSession(session, remember);
    setPasskeyOffer(null);
  }, [persistSession]);

  const register = useCallback(
    async (payload: RegisterPayload) => {
      const { data } = await api.post<RegistrationResponse>("/auth/mobile/register", payload);
      return data;
    },
    []
  );

  const completeMfa = useCallback(async (ticket: string, code: string, remember = true, noDevicePasskey = false) => {
    const { data } = await api.post<AuthResponse>("/auth/mfa/complete", { ticket, code, client: "mobile" });
    await persistSession(data, remember);
    offerPasskey(data, noDevicePasskey);
  }, [offerPasskey, persistSession]);

  const clearPasskeyOffer = useCallback(() => setPasskeyOffer(null), []);

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
    () => ({ user, accessToken, refreshToken, rememberSession, loading, login, loginWithPasskey, completeMfa, register, logout, refreshMe,
      passkeyOffer, clearPasskeyOffer }),
    [accessToken, clearPasskeyOffer, completeMfa, loading, login, loginWithPasskey, logout, passkeyOffer, refreshMe, refreshToken, register,
      rememberSession, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

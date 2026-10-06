import * as SecureStore from "expo-secure-store";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, configureAuthBridge, refreshSession } from "../lib/api";
import { clearAllCache } from "../lib/cache";
import { signInWithPasskey } from "../lib/passkeys";
import { accessTokenExpired, isNetworkError, isSessionRejected } from "../lib/session";
import { isGuestUser, liveGuestUser } from "../live";
import { unregisterPushToken } from "../notifications/PushService";
import type { AuthResponse, User } from "../types";

const ACCESS_KEY = "tls.mobile.accessToken";
const REFRESH_KEY = "tls.mobile.refreshToken";
const REMEMBER_KEY = "tls.mobile.rememberSession";
// Das Konto der Sitzung (#942): damit die App offline mit der gemerkten Sitzung startet statt sich abzumelden.
const USER_KEY = "tls.mobile.user";

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
        SecureStore.setItemAsync(USER_KEY, JSON.stringify(session.user)),
      ]);
    } else {
      await Promise.all([
        SecureStore.deleteItemAsync(ACCESS_KEY),
        SecureStore.deleteItemAsync(REFRESH_KEY),
        SecureStore.deleteItemAsync(USER_KEY),
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
      SecureStore.deleteItemAsync(USER_KEY),
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
    // Sitzung beim Start (#942): ein Weg. Gilt das Zugangs-Token noch, reicht /auth/me; sonst genau eine Erneuerung
    // über den gemeinsamen Weg (den auch der 401-Nachschlag nutzt). Ein Netzfehler meldet nicht ab: die Sitzung und
    // das gemerkte Konto bleiben, bis der Server antwortet. Nur eine abgelehnte Erneuerung (401/403) beendet sie.
    async function boot() {
      let storedAccess: string | null = null;
      let storedRefresh: string | null = null;
      let storedUser: User | null = null;
      try {
        const [access, refresh, storedRemember, userJson] = await Promise.all([
          SecureStore.getItemAsync(ACCESS_KEY),
          SecureStore.getItemAsync(REFRESH_KEY),
          SecureStore.getItemAsync(REMEMBER_KEY),
          SecureStore.getItemAsync(USER_KEY),
        ]);
        if (!mounted) return;
        storedAccess = access;
        storedRefresh = refresh;
        try {
          storedUser = userJson ? (JSON.parse(userJson) as User) : null;
        } catch {
          storedUser = null;
        }

        const shouldRestore = storedRemember !== "false";
        setRememberSession(shouldRestore);
        rememberSessionRef.current = shouldRestore;
        if (!shouldRestore) {
          await clearSession();
          return;
        }
        if (!storedAccess && !storedRefresh) {
          // Nichts gespeichert (erster Start oder abgemeldet): Gastmodus (#918).
          enterGuest();
          return;
        }

        setAccessToken(storedAccess);
        setRefreshToken(storedRefresh);
        if (storedAccess && !accessTokenExpired(storedAccess)) {
          try {
            const { data } = await api.get<User>("/auth/me", { headers: { Authorization: `Bearer ${storedAccess}` } });
            if (mounted) {
              setUser(data);
              activeUserIdRef.current = data.id;
              await SecureStore.setItemAsync(USER_KEY, JSON.stringify(data));
            }
            return;
          } catch (error) {
            if (isNetworkError(error)) throw error;
            // Vom Server abgelehnt oder gestört: einmal erneuern, das entscheidet.
          }
        }
        if (!storedRefresh) throw Object.assign(new Error("Kein Erneuerungs-Token"), { response: { status: 401 } });
        const session = await refreshSession(storedRefresh);
        if (mounted) await persistSession(session, true);
      } catch (error) {
        if (!mounted) return;
        if (isSessionRejected(error) || (!isNetworkError(error) && !storedUser)) {
          await clearSession();
          return;
        }
        // Offline oder Server gestört: angemeldet bleiben, mit dem gemerkten Konto - der nächste Aufruf erneuert.
        if (storedUser) {
          setUser(storedUser);
          activeUserIdRef.current = storedUser.id;
        } else {
          enterGuest();
        }
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
      // „Angemeldet bleiben“ (#942) geht mit: ohne Haken endet die Sitzung am Server nach 24 Stunden statt 90 Tagen.
      const { data } = await api.post<AuthResponse>("/auth/mobile/login", { email, password, remember });
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

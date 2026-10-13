import * as SecureStore from "expo-secure-store";
import { clearRecentSearches } from "../lib/recentSearches";
import { clearOfflineCard } from "../lib/memberCardOffline";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { api, configureAuthBridge, refreshSession } from "../lib/api";
import { clearAllCache } from "../lib/cache";
import { signInWithPasskey } from "../lib/passkeys";
import { accessTokenExpired, isNetworkError, isSessionRejected } from "../lib/session";
import { isGuestUser, liveGuestUser } from "../live";
import { dismissAllNotifications, setPushAccount, unregisterPushToken } from "../notifications/PushService";
import type { AuthResponse, User } from "../types";

const ACCESS_KEY = "tls.mobile.accessToken";
const REFRESH_KEY = "tls.mobile.refreshToken";
const REMEMBER_KEY = "tls.mobile.rememberSession";
// Das Konto der Sitzung (#942): damit die App offline mit der gemerkten Sitzung startet statt sich abzumelden.
const USER_KEY = "tls.mobile.user";
// Wann das Zugangs-Token ankam (Geräteuhr, #1519): seine Laufzeit zählt ab hier, nicht gegen die Uhr des Geräts.
const RECEIVED_KEY = "tls.mobile.accessReceivedAt";

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

/** Was am Konto hängt und beim Abmelden wie beim Kontowechsel (#1053) gehen muss. */
function forgetAccountData() {
  return Promise.all([
    clearAllCache(),
    // Die letzten Suchen (#1145) gehen mit dem Konto.
    clearRecentSearches(),
    // Die gespeicherte Mitgliedskarte (#1256) gehört dem Konto, das geht.
    clearOfflineCard(),
  ]);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  // Die Tokens für den API-Client (#1519): sofort gültig, nicht erst nach dem nächsten Rendern. Sonst trug der Aufruf,
  // der nach dem Erneuern wiederholt wird, noch das alte Token, fiel erneut mit 401 durch - und die App meldete ab.
  const tokensRef = useRef<{ accessToken: string | null; refreshToken: string | null; accessReceivedAt: number | null }>(
    { accessToken: null, refreshToken: null, accessReceivedAt: null },
  );
  // Sitzungs-Generation (#1519): Anmelden, Kontowechsel und Abmelden zählen weiter. Eine Erneuerung, die noch für die
  // vorige Sitzung lief, darf danach weder Tokens ablegen noch abmelden.
  const generationRef = useRef(0);
  const applyTokens = useCallback((access: string | null, refresh: string | null, receivedAt: number | null = null) => {
    tokensRef.current = { accessToken: access, refreshToken: refresh, accessReceivedAt: access ? receivedAt : null };
    setAccessToken(access);
    setRefreshToken(refresh);
  }, []);
  const [rememberSession, setRememberSession] = useState(true);
  const rememberSessionRef = useRef(true);
  const activeUserIdRef = useRef<string | null>(null);
  // Das Konto der Sitzung - auch für die Pushes (#1053): ab hier gelten nur noch Pushes dieses Kontos.
  const rememberActiveUser = useCallback((id: string) => {
    activeUserIdRef.current = id;
    setPushAccount(id === liveGuestUser.id ? null : id);
  }, []);
  const [loading, setLoading] = useState(true);
  const [passkeyOffer, setPasskeyOffer] = useState<PasskeyOffer | null>(null);

  // Gast zuerst (#918): ohne Sitzung bleibt die App offen - mit allem Öffentlichen, ohne Anmeldebildschirm vorweg.
  const enterGuest = useCallback(() => {
    setUser(liveGuestUser);
    rememberActiveUser(liveGuestUser.id);
  }, [rememberActiveUser]);

  const persistSession = useCallback(async (session: AuthResponse, remember?: boolean) => {
    const receivedAt = Date.now();
    const shouldRemember = remember ?? rememberSessionRef.current;
    const previousId = activeUserIdRef.current;
    if (previousId && previousId !== session.user.id) {
      if (previousId !== liveGuestUser.id) {
        // Kontowechsel A→B (#1053): so gründlich wie beim Abmelden. Das Gerät wird für A abgemeldet, solange A noch die
        // Sitzung ist; die Hinweise im System und alles Gemerkte von A gehen mit. Für B meldet es die Glocke neu an - und
        // der Server nimmt das Gerät dabei jedem anderen Konto weg, auch wenn das Abmelden hier nicht durchkam.
        setPasskeyOffer(null);
        await unregisterPushToken().catch(() => {});
        await Promise.all([forgetAccountData(), dismissAllNotifications().catch(() => {})]);
      } else {
        await clearAllCache();
      }
    }
    rememberActiveUser(session.user.id);
    setUser(session.user);
    applyTokens(session.access_token, session.refresh_token, receivedAt);
    setRememberSession(shouldRemember);
    rememberSessionRef.current = shouldRemember;
    if (shouldRemember) {
      await Promise.all([
        SecureStore.setItemAsync(ACCESS_KEY, session.access_token),
        SecureStore.setItemAsync(REFRESH_KEY, session.refresh_token),
        SecureStore.setItemAsync(REMEMBER_KEY, "true"),
        SecureStore.setItemAsync(USER_KEY, JSON.stringify(session.user)),
        SecureStore.setItemAsync(RECEIVED_KEY, String(receivedAt)),
      ]);
    } else {
      await Promise.all([
        SecureStore.deleteItemAsync(ACCESS_KEY),
        SecureStore.deleteItemAsync(REFRESH_KEY),
        SecureStore.deleteItemAsync(USER_KEY),
        SecureStore.deleteItemAsync(RECEIVED_KEY),
        SecureStore.setItemAsync(REMEMBER_KEY, "false"),
      ]);
    }
  }, [applyTokens, rememberActiveUser]);

  // Eine neue Anmeldung (#1519): zuerst die Generation weiterzählen - eine noch laufende Erneuerung der vorigen Sitzung
  // überschreibt sie dann nicht, auch wenn sie während des Kontowechsels ankommt.
  const startSession = useCallback(async (session: AuthResponse, remember: boolean) => {
    generationRef.current += 1;
    await persistSession(session, remember);
  }, [persistSession]);

  const clearSession = useCallback(async () => {
    // Abgemeldet oder Sitzung abgelaufen (#918): zurück in den Gastmodus statt auf den Anmeldebildschirm.
    generationRef.current += 1;
    enterGuest();
    setPasskeyOffer(null);
    applyTokens(null, null);
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
      SecureStore.deleteItemAsync(RECEIVED_KEY),
      forgetAccountData(),
    ]);
  }, [applyTokens, enterGuest]);

  // Der Server hat die Sitzung beendet (#1519): abmelden und es sagen - einmal, auch wenn mehrere Aufrufe es merken.
  const endSession = useCallback(async () => {
    const hadSession = Boolean(tokensRef.current.refreshToken);
    await clearSession();
    if (hadSession) {
      Alert.alert("Abgemeldet", "Deine Anmeldung ist abgelaufen oder wurde beendet. Bitte melde dich neu an.");
    }
  }, [clearSession]);

  useEffect(() => {
    configureAuthBridge({
      readTokens: () => ({ ...tokensRef.current, userId: activeUserIdRef.current, generation: generationRef.current }),
      persistSession,
      clearSession: endSession,
    });
  }, [endSession, persistSession]);

  const refreshMe = useCallback(async () => {
    const { data } = await api.get<User | null>("/auth/me");
    if (data?.id) {
      setUser(data);
      return;
    }
    // Kein Konto zurück, obwohl eine Sitzung da ist (#1519): erneuern statt still zum Gast zu werden.
    const token = tokensRef.current.refreshToken;
    if (!token) return;
    const generation = generationRef.current;
    try {
      const session = await refreshSession(token);
      if (generationRef.current === generation) await persistSession(session);
    } catch (error) {
      if (generationRef.current !== generation) return;
      if (isSessionRejected(error)) await endSession();
      else throw error;
    }
  }, [endSession, persistSession]);

  useEffect(() => {
    let mounted = true;
    // Sitzung beim Start (#942): ein Weg. Gilt das Zugangs-Token noch, reicht /auth/me; sonst genau eine Erneuerung
    // über den gemeinsamen Weg (den auch der 401-Nachschlag nutzt). Ein Netzfehler meldet nicht ab: die Sitzung und
    // das gemerkte Konto bleiben, bis der Server antwortet. Nur eine abgelehnte Erneuerung (401/403) beendet sie.
    async function boot() {
      let storedAccess: string | null = null;
      let storedRefresh: string | null = null;
      let storedUser: User | null = null;
      let stored: Array<string | null>;
      try {
        stored = await Promise.all([
          SecureStore.getItemAsync(ACCESS_KEY),
          SecureStore.getItemAsync(REFRESH_KEY),
          SecureStore.getItemAsync(REMEMBER_KEY),
          SecureStore.getItemAsync(USER_KEY),
          SecureStore.getItemAsync(RECEIVED_KEY),
        ]);
      } catch {
        // Der sichere Speicher war nicht lesbar (#1519): nichts löschen - der nächste Start stellt die Sitzung wieder her.
        if (mounted) {
          enterGuest();
          setLoading(false);
        }
        return;
      }
      try {
        const [access, refresh, storedRemember, userJson, receivedJson] = stored;
        const receivedAt = receivedJson && Number.isFinite(Number(receivedJson)) ? Number(receivedJson) : null;
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

        applyTokens(storedAccess, storedRefresh, receivedAt);
        if (storedAccess && !accessTokenExpired(storedAccess, Date.now(), 30, receivedAt)) {
          try {
            const { data } = await api.get<User | null>("/auth/me", { headers: { Authorization: `Bearer ${storedAccess}` } });
            // Ohne Konto (#1519) kennt der Server das Token nicht mehr: erneuern statt als angemeldet ohne Konto zu starten.
            if (data?.id) {
              if (mounted) {
                setUser(data);
                rememberActiveUser(data.id);
                await SecureStore.setItemAsync(USER_KEY, JSON.stringify(data));
              }
              return;
            }
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
        // Nur eine vom Server abgelehnte Sitzung endet (#1519) - mit Hinweis, wenn eine gespeichert war.
        if (isSessionRejected(error)) {
          await endSession();
          return;
        }
        // Offline oder Server gestört: angemeldet bleiben, mit dem gemerkten Konto - der nächste Aufruf erneuert.
        if (storedUser) {
          setUser(storedUser);
          rememberActiveUser(storedUser.id);
        } else {
          // Ohne gemerktes Konto vorerst als Gast - die gespeicherte Sitzung bleibt für den nächsten Start.
          applyTokens(null, null);
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
  }, [applyTokens, clearSession, endSession, enterGuest, persistSession, rememberActiveUser]);

  const offerPasskey = useCallback((session: AuthResponse & { passkey_ticket?: string | null }, deviceWithout = false) => {
    setPasskeyOffer(session.passkey_ticket ? { ticket: session.passkey_ticket, userId: session.user.id, deviceWithout } : null);
  }, []);

  const login = useCallback(
    async (email: string, password: string, remember = true, noDevicePasskey = false) => {
      // „Angemeldet bleiben“ (#942) geht mit: ohne Haken endet die Sitzung am Server nach 24 Stunden statt 90 Tagen.
      const { data } = await api.post<AuthResponse>("/auth/mobile/login", { email, password, remember });
      const challenge = data as AuthResponse & { mfa_required?: boolean; mfa_ticket?: string };
      if (challenge.mfa_required) return { mfaRequired: true, ticket: challenge.mfa_ticket };
      await startSession(data, remember);
      offerPasskey(data, noDevicePasskey);
      return { mfaRequired: false };
    },
    [offerPasskey, startSession]
  );

  // Passkey-Anmeldung (#217 Stufe 2): derselbe Passkey wie auf der Website, Gerätesperre statt Passwort.
  const loginWithPasskey = useCallback(async (remember = true, silent = false) => {
    const session = await signInWithPasskey(remember, silent);
    await startSession(session, remember);
    setPasskeyOffer(null);
  }, [startSession]);

  const register = useCallback(
    async (payload: RegisterPayload) => {
      const { data } = await api.post<RegistrationResponse>("/auth/mobile/register", payload);
      return data;
    },
    []
  );

  const completeMfa = useCallback(async (ticket: string, code: string, remember = true, noDevicePasskey = false) => {
    const { data } = await api.post<AuthResponse>("/auth/mfa/complete", { ticket, code, client: "mobile" });
    await startSession(data, remember);
    offerPasskey(data, noDevicePasskey);
  }, [offerPasskey, startSession]);

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

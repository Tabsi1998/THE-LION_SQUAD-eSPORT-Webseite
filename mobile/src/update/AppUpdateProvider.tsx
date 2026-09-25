import * as SecureStore from "expo-secure-store";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { AppUpdateBanner } from "../components/AppUpdateBanner";
import { WhatsNewCard } from "../components/WhatsNewCard";
import { api } from "../lib/api";
import { decideUpdate, ownBuild, shouldCheck, SNOOZE_KEY, type AppVersionInfo } from "../lib/appUpdate";
import { detectInstallSource, startPlayUpdate, type PlayUpdateState } from "../lib/installSource";
import { currentWhatsNew, SEEN_BUILD_KEY, shouldShowWhatsNew } from "../lib/whatsnew";
import { isGuestUser } from "../live";

// Updates und „Was ist neu“ (#249, #250) an einer Stelle: beim Start und beim
// Zurückkehren in den Vordergrund höchstens einmal pro Stunde nachfragen; die
// Karte mit den Neuerungen genau einmal nach einem Update, sonst über Mehr.

type AppUpdateValue = {
  info: AppVersionInfo | null;
  check: (force?: boolean) => Promise<void>;
  openWhatsNew: () => void;
};

const AppUpdateContext = createContext<AppUpdateValue | null>(null);

async function readNumber(key: string): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    const value = raw === null ? null : Number(raw);
    return value !== null && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

async function writeNumber(key: string, value: number) {
  try {
    await SecureStore.setItemAsync(key, String(value));
  } catch {
    // Ohne Speicher zeigt die App die Karte beim nächsten Start noch einmal - kein Drama.
  }
}

export function AppUpdateProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [info, setInfo] = useState<AppVersionInfo | null>(null);
  const [snoozed, setSnoozed] = useState<number | null>(null);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  // Installationsquelle (#421, #593): Play-Installationen bekommen Googles Dialog, alle anderen den Store-Link.
  const [play, setPlay] = useState<PlayUpdateState | null>(null);
  const playDialogShown = useRef(false);
  const lastCheck = useRef<number | null>(null);
  const build = ownBuild();
  const entry = useMemo(() => currentWhatsNew(), []);
  const enabled = Boolean(user && !isGuestUser(user));

  useEffect(() => {
    if (!enabled || __DEV__) return undefined;
    let cancelled = false;
    detectInstallSource().then((state) => {
      if (!cancelled) setPlay(state);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // „Was ist neu“ genau einmal nach einem Update; danach den eigenen Build merken.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const seen = await readNumber(SEEN_BUILD_KEY);
      if (cancelled) return;
      if (shouldShowWhatsNew(seen, build, entry.items)) setWhatsNewOpen(true);
      if (build && seen !== build) await writeNumber(SEEN_BUILD_KEY, build);
    })();
    return () => {
      cancelled = true;
    };
  }, [build, entry.items]);

  const check = useCallback(async (force = false) => {
    if (!enabled || !build) return;
    if (!force && !shouldCheck(lastCheck.current)) return;
    lastCheck.current = Date.now();
    try {
      const { data } = await api.get<AppVersionInfo>(`/mobile/app-version?build=${build}`);
      setInfo(data || null);
    } catch {
      // Kein Netz oder Server ohne Release-Endpunkt: nichts zeigen, beim nächsten Mal wieder fragen.
      lastCheck.current = null;
    }
  }, [build, enabled]);

  useEffect(() => {
    if (!enabled) {
      setInfo(null);
      return undefined;
    }
    check();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => subscription.remove();
  }, [check, enabled]);

  const decision = decideUpdate(info, snoozed);

  // Play kennt schon ein Update: Googles Dialog einmal je Sitzung von selbst öffnen - bei Pflicht
  // „sofort“, sonst im Hintergrund. Der Banner bleibt als zweiter Weg.
  useEffect(() => {
    if (!play || play.source !== "play" || !play.updateAvailable || playDialogShown.current) return;
    playDialogShown.current = true;
    void startPlayUpdate(decision.mandatory && play.immediateAllowed);
  }, [decision.mandatory, play]);

  const value = useMemo<AppUpdateValue>(() => ({ info, check, openWhatsNew: () => setWhatsNewOpen(true) }), [check, info]);

  return (
    <AppUpdateContext.Provider value={value}>
      {children}
      <WhatsNewCard entry={entry} visible={whatsNewOpen} onClose={() => setWhatsNewOpen(false)} />
      {decision.show && decision.release && !whatsNewOpen ? (
        <AppUpdateBanner
          release={decision.release}
          mandatory={decision.mandatory}
          onStartPlayUpdate={play?.source === "play" ? (immediate) => startPlayUpdate(immediate && Boolean(play?.immediateAllowed)) : undefined}
          onLater={() => {
            setSnoozed(decision.release?.build ?? null);
            void writeNumber(SNOOZE_KEY, decision.release?.build ?? 0);
          }}
          onWhatsNew={() => setWhatsNewOpen(true)}
        />
      ) : null}
    </AppUpdateContext.Provider>
  );
}

export function useAppUpdate() {
  const context = useContext(AppUpdateContext);
  if (!context) throw new Error("useAppUpdate must be used inside AppUpdateProvider");
  return context;
}

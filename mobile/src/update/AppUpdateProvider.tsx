import * as SecureStore from "expo-secure-store";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { AppUpdateBanner } from "../components/AppUpdateBanner";
import { WhatsNewCard } from "../components/WhatsNewCard";
import { api } from "../lib/api";
import { activeSnoozeBuild, decideUpdate, ownBuild, parseSnooze, shouldCheck, showOwnUpdateHint, SNOOZE_KEY, type AppVersionInfo, type UpdateSnooze } from "../lib/appUpdate";
import { detectInstallSource, startPlayUpdate, type PlayUpdateState } from "../lib/installSource";
import { currentWhatsNew, SEEN_BUILD_KEY, shouldShowWhatsNew } from "../lib/whatsnew";

// Updates und „Was ist neu“ (#249, #250) an einer Stelle: beim Start und beim
// Zurückkehren in den Vordergrund höchstens einmal pro Stunde nachfragen; die
// Karte mit den Neuerungen genau einmal nach einem Update, sonst über Mehr.
// Die Prüfung gilt für die Installation, nicht für ein Konto (#1002): Gäste und
// Abgemeldete bekommen sie genauso, An- und Abmelden fragt nicht erneut.

type AppUpdateValue = {
  info: AppVersionInfo | null;
  check: (force?: boolean) => Promise<void>;
  openWhatsNew: () => void;
  /** Ob „Was ist neu“ gerade offen ist - der Hinweis für Gäste (#918) wartet dann, bis die Karte zu ist. */
  whatsNewOpen: boolean;
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

async function readSnooze(): Promise<UpdateSnooze | null> {
  try {
    return parseSnooze(await SecureStore.getItemAsync(SNOOZE_KEY));
  } catch {
    return null;
  }
}

async function writeText(key: string, value: string) {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // Ohne Speicher zeigt die App Karte oder Hinweis beim nächsten Start noch einmal - kein Drama.
  }
}

export function AppUpdateProvider({ children }: { children: React.ReactNode }) {
  const [info, setInfo] = useState<AppVersionInfo | null>(null);
  const [snooze, setSnooze] = useState<UpdateSnooze | null>(null);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  // Installationsquelle (#421, #593): Play-Installationen bekommen Googles Dialog, alle anderen den Store-Link.
  const [play, setPlay] = useState<PlayUpdateState | null>(null);
  const playDialogShown = useRef(false);
  const lastCheck = useRef<number | null>(null);
  const build = ownBuild();
  const entry = useMemo(() => currentWhatsNew(), []);

  useEffect(() => {
    if (__DEV__) return undefined;
    let cancelled = false;
    detectInstallSource().then((state) => {
      if (!cancelled) setPlay(state);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // „Später“ aus einer früheren Sitzung (#1003) - unabhängig von „Was ist neu gesehen“.
  useEffect(() => {
    let cancelled = false;
    void readSnooze().then((stored) => {
      if (!cancelled && stored) setSnooze((current) => current ?? stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // „Was ist neu“ genau einmal nach einem Update; danach den eigenen Build merken.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const seen = await readNumber(SEEN_BUILD_KEY);
      if (cancelled) return;
      if (shouldShowWhatsNew(seen, build, entry.items)) setWhatsNewOpen(true);
      if (build && seen !== build) await writeText(SEEN_BUILD_KEY, String(build));
    })();
    return () => {
      cancelled = true;
    };
  }, [build, entry.items]);

  const check = useCallback(async (force = false) => {
    if (!build) return;
    if (!force && !shouldCheck(lastCheck.current)) return;
    lastCheck.current = Date.now();
    try {
      const { data } = await api.get<AppVersionInfo>(`/mobile/app-version?build=${build}`);
      setInfo(data || null);
    } catch {
      // Kein Netz oder Server ohne Release-Endpunkt: nichts zeigen, beim nächsten Mal wieder fragen.
      lastCheck.current = null;
    }
  }, [build]);

  useEffect(() => {
    check();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => subscription.remove();
  }, [check]);

  const decision = decideUpdate(info, activeSnoozeBuild(snooze));

  // Play kennt schon ein Update: Googles Dialog einmal je Sitzung von selbst öffnen - bei Pflicht
  // „sofort“, sonst im Hintergrund. Eine App aus Google Play bekommt keinen eigenen Hinweis (#926).
  useEffect(() => {
    if (!play || play.source !== "play" || !play.updateAvailable || playDialogShown.current) return;
    playDialogShown.current = true;
    void startPlayUpdate(decision.mandatory && play.immediateAllowed);
  }, [decision.mandatory, play]);

  const value = useMemo<AppUpdateValue>(() => ({ info, check, openWhatsNew: () => setWhatsNewOpen(true), whatsNewOpen }), [check, info, whatsNewOpen]);

  return (
    <AppUpdateContext.Provider value={value}>
      {children}
      <WhatsNewCard entry={entry} visible={whatsNewOpen} onClose={() => setWhatsNewOpen(false)} />
      {/* Eigener Hinweis nur für die Server-APK und Geräte ohne Play (#926) - aus Google Play kommt nur Googles Dialog. */}
      {decision.release && showOwnUpdateHint(decision, play?.source, whatsNewOpen) ? (
        <AppUpdateBanner
          release={decision.release}
          mandatory={decision.mandatory}
          onLater={() => {
            if (!decision.release) return;
            const next = { build: decision.release.build, at: Date.now() };
            setSnooze(next);
            void writeText(SNOOZE_KEY, JSON.stringify(next));
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

/** Wie useAppUpdate, aber ohne Provider null - für „Über die App“ in den Einstellungen, auch in Tests einzelner Screens. */
export function useOptionalAppUpdate() {
  return useContext(AppUpdateContext);
}

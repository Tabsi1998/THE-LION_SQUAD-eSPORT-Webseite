import { Ionicons } from "@expo/vector-icons";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, PanResponder, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../auth/AuthContext";
import { Body, Muted } from "../components/Text";
import { api } from "../lib/api";
import { isGuestUser } from "../live";
import { navigateToNotification, navigationRef, openDetail } from "../navigation/rootNavigation";
import { POPUP_AUTO_HIDE_MS, mergePopup, popupBody, popupTitle, suppressedByOpenChat, type PopupState } from "../lib/popups";
import { announceAchievementUnlocked } from "../lib/achievements";
import { useAppLock } from "../lock/AppLockProvider";

/**
 * Erfolge, Level-Aufstiege und Prestige feiert die Zeremonie - sie kommen nicht zusätzlich als Banner. (Prestige legt
 * einen Postfach-Eintrag an; wer es in der App auslöst, sieht schon die Zeremonie.)
 */
export function isCeremonyKind(kind?: string): boolean {
  return kind === "achievement" || kind === "level" || kind === "prestige";
}
import { useLiveRefresh } from "../realtime/LiveChangesProvider";
import { colors } from "../theme";
import type { UserNotification } from "../types";
import {
  addPushNotificationReceivedListener,
  addPushNotificationResponseListener,
  configurePushNotifications,
  consumeInitialPushNotification,
  isContentHiddenPush,
  registerPushToken,
  setBadgeCount,
  setForegroundPushHidden,
} from "./PushService";

/** Ein späterer Versuch (#1053), wenn das Anmelden des Geräts nicht durchkam - etwa ohne Netz direkt nach dem Wechsel. */
export const PUSH_RETRY_MS = 30_000;

type NotificationContextValue = {
  items: UserNotification[];
  unread: number;
  load: () => Promise<void>;
  markRead: (item: UserNotification) => Promise<void>;
  markAllRead: () => Promise<void>;
  openNotification: (item: UserNotification) => Promise<void>;
};

const NOTIFICATION_LIVE_RESOURCES = ["notifications"];

const NotificationContext = createContext<NotificationContextValue | null>(null);

// Push-Notifications beim App-Start konfigurieren (einmalig)
configurePushNotifications();

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const appLock = useAppLock();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<UserNotification[]>([]);
  // In-App-Banner (#251): höchstens einer, gebündelt, nach fünf Sekunden weg.
  const [popup, setPopup] = useState<PopupState | null>(null);
  const knownIds = useRef(new Set<string>());
  const primed = useRef(false);
  const initialPushHandled = useRef(false);
  const enabled = Boolean(user && !isGuestUser(user));
  const userId = enabled && user ? user.id : null;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  // Kontowechsel (#1053): schon im ersten Bild des neuen Kontos keine Liste, kein Zähler, kein Banner des vorigen.
  const [shownFor, setShownFor] = useState(userId);
  if (shownFor !== userId) {
    setShownFor(userId);
    setItems([]);
    setPopup(null);
  }
  // App-Sperre (#1052): solange gesperrt - oder noch nicht klar ist, ob gesperrt wird - kein Banner und kein Sprung zum
  // Inhalt. Ein angetippter Push wartet in `pendingOpen` auf das Entsperren.
  const locked = enabled && (!appLock.ready || appLock.locked);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const pendingOpen = useRef<UserNotification | null>(null);
  // Für wen und wie das Gerät angemeldet ist (#1053, #1052): ein anderes Konto oder die App-Sperre an/aus meldet neu an -
  // mit Sperre bekommt das Gerät nur Pushes ohne Inhalt.
  const privatePush = appLock.enabled;
  const registration = userId && appLock.ready ? `${userId}:${privatePush ? "privat" : "offen"}` : null;
  const registrationRef = useRef(registration);
  registrationRef.current = registration;
  const registeredAs = useRef<string | null>(null);
  // Ein alter Server übernimmt „ohne Inhalt“ nicht (#1052): beim nächsten Öffnen der App fragt sie noch einmal. Bis dahin
  // zeigt sie gesperrt trotzdem nichts an (setForegroundPushHidden).
  const privateUnconfirmed = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retriedFor = useRef<string | null>(null);
  const ensureRef = useRef<() => Promise<void>>(async () => {});

  const ensurePushRegistered = useCallback(async () => {
    if (!registration || registeredAs.current === registration) return;
    const result = await registerPushToken({ private: privatePush }).catch(() => null);
    if (registrationRef.current !== registration) return;
    if (!result) {
      // Nicht durchgekommen (#1053): einmal später nachholen - erst die Anmeldung für das neue Konto nimmt das Gerät
      // am Server jedem anderen Konto weg.
      if (retriedFor.current !== registration && !retryTimer.current) {
        retriedFor.current = registration;
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          void ensureRef.current();
        }, PUSH_RETRY_MS);
      }
      return;
    }
    registeredAs.current = registration;
    privateUnconfirmed.current = privatePush && !result.privateConfirmed;
  }, [privatePush, registration]);
  ensureRef.current = ensurePushRegistered;

  useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
  }, []);

  // Kontowechsel (#1053): auch die Merker des vorigen Kontos gehen - bekannte Hinweise und ein wartender Push.
  const resetFor = useRef(userId);
  useEffect(() => {
    if (resetFor.current === userId) return;
    resetFor.current = userId;
    knownIds.current = new Set();
    primed.current = false;
    pendingOpen.current = null;
    registeredAs.current = null;
    privateUnconfirmed.current = false;
  }, [userId]);

  // Gesperrt oder Sperrzustand unbekannt (#1052): Pushes im Vordergrund ganz ohne Anzeige.
  useEffect(() => {
    setForegroundPushHidden(locked);
  }, [locked]);

  const mergeIncomingNotification = useCallback((item: UserNotification) => {
    knownIds.current.add(item.id);
    setItems((rows) => {
      const existing = rows.find((row) => row.id === item.id);
      if (existing) return rows.map((row) => row.id === item.id ? { ...row, ...item, read: row.read } : row);
      return [item, ...rows].slice(0, 80);
    });
    // Ein Erfolg oder ein neues Level bekommt seinen eigenen Moment (#218, Zeremonie E13 #623), keinen Banner obendrauf.
    if (isCeremonyKind(item.kind)) {
      announceAchievementUnlocked();
      return;
    }
    if (suppressedByOpenChat(item, navigationRef.isReady() ? navigationRef.getCurrentRoute() : null)) return;
    if (lockedRef.current) return;
    setPopup((current) => mergePopup(current, item));
  }, []);

  const fetchItems = useCallback(async (): Promise<UserNotification[] | null> => {
    if (!userId) {
      setItems([]);
      setPopup(null);
      knownIds.current = new Set();
      primed.current = false;
      return null;
    }
    try {
      const { data } = await api.get<UserNotification[]>("/mobile/notifications");
      // Eine späte Antwort für das vorige Konto (#1053) ändert die Liste des neuen nicht.
      if (userIdRef.current !== userId) return null;
      const rows = Array.isArray(data) ? data : [];
      setItems(rows);
      const nextUnread = rows.filter((item) => !item.read && item.id && !knownIds.current.has(item.id)).slice(0, 3);
      if (primed.current && nextUnread.length && !lockedRef.current) {
        const route = navigationRef.isReady() ? navigationRef.getCurrentRoute() : null;
        if (nextUnread.some((item) => isCeremonyKind(item.kind))) announceAchievementUnlocked();
        const fresh = nextUnread.filter((item) => !isCeremonyKind(item.kind) && !suppressedByOpenChat(item, route));
        if (fresh.length) setPopup((current) => fresh.reduceRight((state, item) => mergePopup(state, item), current));
      }
      knownIds.current = new Set(rows.map((item) => item.id).filter(Boolean));
      primed.current = true;
      return rows;
    } catch {
      // Keep the last known list visible when the network is temporarily unavailable.
      return null;
    }
  }, [userId]);

  const load = useCallback(async () => {
    await fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    ensurePushRegistered();
    load();
  }, [ensurePushRegistered, load]);

  const refreshFromLive = useCallback(() => {
    ensurePushRegistered();
    return load();
  }, [ensurePushRegistered, load]);
  useLiveRefresh(refreshFromLive, NOTIFICATION_LIVE_RESOURCES, { enabled, fallbackMs: 5000 });

  useEffect(() => {
    if (!enabled) return undefined;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        if (privateUnconfirmed.current) registeredAs.current = null;
        ensurePushRegistered();
        load();
      }
    });
    return () => subscription.remove();
  }, [enabled, ensurePushRegistered, load]);

  useEffect(() => {
    if (locked) setPopup(null);
  }, [locked]);

  useEffect(() => {
    if (!popup) return undefined;
    const timer = setTimeout(() => setPopup(null), POPUP_AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [popup]);

  // Nach oben wischen schließt den Banner sofort.
  const swipeUp = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy < -8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy < -24) setPopup(null);
    },
  }), []);

  const markRead = useCallback(async (item: UserNotification) => {
    if (!item.read) {
      setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, read: true } : row));
      await api.post(`/mobile/notifications/${item.id}/read`).catch(() => {});
    }
  }, []);

  const markAllRead = useCallback(async () => {
    setItems((rows) => rows.map((row) => ({ ...row, read: true })));
    await api.post("/mobile/notifications/read-all").catch(() => {});
  }, []);

  const openNotification = useCallback(async (item: UserNotification) => {
    await markRead(item);
    setPopup(null);
    navigateToNotification(item);
  }, [markRead]);

  const openFromSystemNotification = useCallback((item: UserNotification) => {
    if (lockedRef.current) {
      pendingOpen.current = item;
      return;
    }
    pendingOpen.current = null;
    setTimeout(() => {
      void (async () => {
        // Ohne Inhalt (#1052): erst jetzt, entsperrt, den echten Eintrag vom Server holen.
        const target = isContentHiddenPush(item) ? (await fetchItems())?.find((row) => row.id === item.id) || item : item;
        await openNotification(target);
        await load();
      })().catch(() => {});
    }, 250);
  }, [fetchItems, load, openNotification]);

  const openPopup = useCallback((state: PopupState) => {
    setPopup(null);
    if (state.items.length > 1) {
      // Mehrere auf einmal: die Liste der Glocke (#1145) über dem Tab, in dem man gerade ist.
      openDetail("Notifications");
      return;
    }
    if (state.items[0]) void openNotification(state.items[0]);
  }, [openNotification]);

  useEffect(() => {
    if (!enabled) {
      initialPushHandled.current = false;
      return undefined;
    }

    const removeListener = addPushNotificationResponseListener(openFromSystemNotification);
    const removeReceivedListener = addPushNotificationReceivedListener((item) => {
      // Gesperrt (#1052): nichts in Liste und Banner - nach dem Entsperren lädt die Glocke neu.
      if (lockedRef.current) return;
      // Ein Push ohne Inhalt (#1052) kommt nicht als Platzhalter in die Liste - die Liste vom Server bringt den Eintrag.
      if (!isContentHiddenPush(item)) mergeIncomingNotification(item);
      load();
    });

    if (!initialPushHandled.current) {
      initialPushHandled.current = true;
      consumeInitialPushNotification()
        .then((item) => {
          if (item) openFromSystemNotification(item);
        })
        .catch(() => {});
    }

    return () => {
      removeListener?.();
      removeReceivedListener?.();
    };
  }, [enabled, load, mergeIncomingNotification, openFromSystemNotification]);

  // Nach dem Entsperren (#1052) öffnet sich der Push, der davor angetippt wurde - sonst lädt die Glocke neu.
  const wasLocked = useRef(locked);
  useEffect(() => {
    const unlocked = wasLocked.current && !locked;
    wasLocked.current = locked;
    if (locked) return;
    if (pendingOpen.current) openFromSystemNotification(pendingOpen.current);
    else if (unlocked) void load();
  }, [load, locked, openFromSystemNotification]);

  const unread = useMemo(() => items.filter((item) => !item.read).length, [items]);

  // App-Badge-Zähler aktualisieren wenn sich unread ändert
  useEffect(() => {
    setBadgeCount(unread).catch(() => {});
  }, [unread]);

  const value = useMemo(() => ({
    items,
    unread,
    load,
    markRead,
    markAllRead,
    openNotification,
  }), [items, unread, load, markAllRead, markRead, openNotification]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <View
        pointerEvents="box-none"
        style={[
          styles.popupLayer,
          {
            left: Math.max(insets.left + 14, 14),
            right: Math.max(insets.right + 14, 14),
            top: Math.max(insets.top + 58, 66),
          },
        ]}
      >
        {popup && !locked ? (
          <Pressable
            key={popup.shownAt}
            onPress={() => openPopup(popup)}
            style={styles.popup}
            testID="notification-popup"
            accessibilityRole="button"
            accessibilityLabel={popupTitle(popup)}
            accessibilityHint="Nach oben wischen schließt"
            {...swipeUp.panHandlers}
          >
            <Ionicons name="notifications" color={colors.cyan} size={18} />
            <View style={styles.popupText}>
              <Body style={styles.popupTitle} numberOfLines={2}>{popupTitle(popup)}</Body>
              {popupBody(popup) ? <Muted numberOfLines={2}>{popupBody(popup)}</Muted> : null}
            </View>
          </Pressable>
        ) : null}
      </View>
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error("useNotifications must be used inside NotificationProvider");
  return context;
}

/** Wie useNotifications, aber ohne Provider (Gast in Tests einzelner Screens) einfach null - für die Glocke im Kopf. */
export function useOptionalNotifications() {
  return useContext(NotificationContext);
}

const styles = StyleSheet.create({
  popupLayer: {
    pointerEvents: "box-none",
    position: "absolute",
    zIndex: 50,
    gap: 8,
  },
  popup: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "rgba(41,182,232,0.45)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 12,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 14,
  },
  popupText: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  popupTitle: {
    fontWeight: "900",
  },
});

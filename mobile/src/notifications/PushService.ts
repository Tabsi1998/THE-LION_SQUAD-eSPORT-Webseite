/**
 * PushService.ts — Expo Push Notifications Integration für LionsAPP
 *
 * Funktionsweise:
 * 1. Beim Login: Push-Permission anfragen + Expo-Push-Token beim Backend registrieren
 * 2. Beim Logout: Push-Token beim Backend deregistrieren
 * 3. Foreground-Notifications: Werden als System-Banner plus In-App-Popup angezeigt
 * 4. Background/Tap: App öffnet die richtige Seite (Deep-Link via navigateToNotification)
 *
 * WICHTIG: expo-notifications muss installiert sein:
 *   npx expo install expo-notifications
 *   npx expo install expo-device
 *
 * Ohne diese Packages degradiert der Service graceful (kein Crash).
 */

import { Platform } from "react-native";
import Constants from "expo-constants";
import { api } from "../lib/api";
import type { UserNotification } from "../types";

// Graceful import – falls expo-notifications nicht installiert ist
// Installieren mit: npx expo install expo-notifications expo-device
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Notifications: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Device: any = null;

function getExpoProjectId() {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ||
    // easConfig is present in EAS builds, but older expo-constants typings do not expose it everywhere.
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId ||
    "3eaaebbc-883e-469c-a135-09f3459e2c46"
  );
}

try {
  // @ts-ignore – optionales Package
  Notifications = require("expo-notifications");
  // @ts-ignore – optionales Package
  Device = require("expo-device");
} catch {
  console.info("[PushService] expo-notifications nicht installiert – Push-Notifications deaktiviert.");
}

/** Konfiguriert wie Notifications im Foreground angezeigt werden */
export function configurePushNotifications() {
  if (!Notifications) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

export function addPushNotificationResponseListener(onOpen: (item: UserNotification) => void) {
  if (!Notifications) return undefined;
  const subscription = Notifications.addNotificationResponseReceivedListener((response: unknown) => {
    const item = notificationFromResponse(response);
    if (item) onOpen(item);
  });
  return () => {
    subscription?.remove?.();
  };
}

export async function consumeInitialPushNotification(): Promise<UserNotification | null> {
  if (!Notifications) return null;
  try {
    const response = await Notifications.getLastNotificationResponseAsync?.();
    const item = notificationFromResponse(response);
    await Notifications.clearLastNotificationResponseAsync?.();
    return item;
  } catch {
    return null;
  }
}

/** Fragt Push-Permission an und registriert den Token beim Backend */
export async function registerPushToken(): Promise<string | null> {
  if (!Notifications || !Device) return null;

  // Nur auf echten Geräten (nicht im Simulator/Emulator)
  if (!Device.isDevice) {
    console.info("[PushService] Simulator erkannt – Push-Token übersprungen.");
    return null;
  }

  try {
    // Permission anfragen
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.info("[PushService] Push-Permission verweigert.");
      return null;
    }

    // Android: Notification Channel erstellen
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "THE LION SQUAD",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#29B6E8",
        sound: "default",
      });

      await Notifications.setNotificationChannelAsync("tournaments", {
        name: "Turniere & Events",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#FFD700",
        sound: "default",
      });
    }

    // Expo Push Token holen
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: getExpoProjectId(),
    });

    const token = tokenData.data;
    console.info(`[PushService] Push-Token: ${token.slice(0, 30)}...`);

    // Token beim Backend registrieren
    await api.post("/mobile/push-token", {
      token,
      platform: Platform.OS,
    }).catch((err) => {
      console.warn("[PushService] Token-Registrierung fehlgeschlagen:", err?.message);
    });

    return token;
  } catch (err) {
    console.warn("[PushService] Fehler bei Token-Registrierung:", err);
    return null;
  }
}

function notificationFromResponse(response: unknown): UserNotification | null {
  const content = (response as {
    notification?: { request?: { content?: { title?: string | null; body?: string | null; data?: Record<string, unknown> } } };
  } | null)?.notification?.request?.content;
  const data = content?.data || {};
  const notificationId = stringValue(data.notification_id || data.id);
  const kind = stringValue(data.kind);
  const url = stringValue(data.url);
  const meta = objectValue(data.meta);
  if (!notificationId && !kind && !url) return null;
  return {
    id: notificationId || `${kind || "push"}:${Date.now()}`,
    kind,
    title: stringValue(content?.title) || "Benachrichtigung",
    body: stringValue(content?.body),
    url,
    read: false,
    meta,
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Deregistriert den Push-Token beim Backend (beim Logout) */
export async function unregisterPushToken(): Promise<void> {
  if (!Notifications || !Device) return;
  if (!Device.isDevice) return;

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: getExpoProjectId(),
    }).catch(() => null);

    if (tokenData?.data) {
      await api.delete("/mobile/push-token", {
        data: { token: tokenData.data },
      }).catch(() => {});
    }
  } catch {
    // Fehler beim Deregistrieren ignorieren
  }
}

/** Setzt den App-Badge-Zähler */
export async function setBadgeCount(count: number): Promise<void> {
  if (!Notifications) return;
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, count));
  } catch {}
}

/** Löscht alle angezeigten Notifications */
export async function dismissAllNotifications(): Promise<void> {
  if (!Notifications) return;
  try {
    await Notifications.dismissAllNotificationsAsync();
  } catch {}
}

/** Gibt true zurück wenn Push-Notifications verfügbar und erlaubt sind */
export async function isPushEnabled(): Promise<boolean> {
  if (!Notifications || !Device) return false;
  if (!Device.isDevice) return false;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

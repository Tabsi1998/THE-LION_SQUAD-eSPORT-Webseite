/**
 * PushService.ts — Expo Push Notifications Integration für LionsAPP
 *
 * Funktionsweise:
 * 1. Beim Login: Push-Permission anfragen + Expo-Push-Token beim Backend registrieren
 * 2. Beim Logout: Push-Token beim Backend deregistrieren
 * 3. Foreground-Notifications: Werden als In-App-Popup angezeigt (via NotificationContext)
 * 4. Background/Tap: App öffnet die richtige Seite (Deep-Link via navigateToNotification)
 *
 * WICHTIG: expo-notifications muss installiert sein:
 *   npx expo install expo-notifications
 *   npx expo install expo-device
 *
 * Ohne diese Packages degradiert der Service graceful (kein Crash).
 */

import { Platform } from "react-native";
import { api } from "../lib/api";

// Graceful import – falls expo-notifications nicht installiert ist
// Installieren mit: npx expo install expo-notifications expo-device
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Notifications: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Device: any = null;

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
      shouldShowAlert: false, // Wir zeigen eigene In-App-Popups via NotificationContext
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
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
      projectId: "lionsapp", // Muss mit app.json extra.eas.projectId übereinstimmen
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

/** Deregistriert den Push-Token beim Backend (beim Logout) */
export async function unregisterPushToken(): Promise<void> {
  if (!Notifications || !Device) return;
  if (!Device.isDevice) return;

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: "lionsapp",
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

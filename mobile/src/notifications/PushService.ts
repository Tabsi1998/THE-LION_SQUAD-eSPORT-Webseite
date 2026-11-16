/**
 * PushService.ts — Expo Push Notifications Integration für LionsAPP
 *
 * Funktionsweise:
 * 1. Mit Konto und Erlaubnis: Expo-Push-Token beim Backend registrieren. Nach der Erlaubnis fragt die App erst nach der
 *    ersten Turnier- oder Event-Anmeldung, mit eigener Erklärung davor (#1208, PushPromptHost) - nie beim Login.
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
import { sha256Hex } from "../lib/sha256";
import type { UserNotification } from "../types";
import { PUSH_CHANNELS, PUSH_CHANNEL_SET, RETIRED_CHANNEL_IDS } from "./channels";
import { getInstallationId } from "./installationId";

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

/**
 * Konto-Kennung an Pushes (#1053): ein kurzer, nicht umkehrbarer Hash der Nutzer-ID. Der Server rechnet dieselbe
 * (backend/services/push_notifications.py, push_account_tag); so verwirft die App Pushes, die nicht zum Konto gehören.
 */
export function pushAccountTag(userId: string): string {
  return sha256Hex(`lsw-push-account:${userId}`).slice(0, 16);
}

// Wem die App gerade gehört und ob sie gesperrt ist. Bis die Glocke es weiß, gilt: verborgen (#1052).
let currentAccountTag: string | null = null;
let foregroundHidden = true;

/** Das angemeldete Konto (#1053) - setzt die Anmeldung, sobald es wechselt; null für Gäste. */
export function setPushAccount(userId: string | null) {
  currentAccountTag = userId ? pushAccountTag(userId) : null;
}

/** Gesperrt oder Sperrzustand noch unbekannt (#1052): Pushes im Vordergrund ohne Banner, Ton, Zähler und Eintrag. */
export function setForegroundPushHidden(hidden: boolean) {
  foregroundHidden = hidden;
}

/** Ein Push mit Konto-Kennung, die nicht zum angemeldeten Konto passt (#1053). Alte Server schicken keine Kennung. */
function foreignAccount(data: Record<string, unknown>): boolean {
  const account = stringValue(data.account);
  return Boolean(account) && account !== currentAccountTag;
}

const SHOW = { shouldShowAlert: true, shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true };
const SILENT = { shouldShowAlert: false, shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };

/** Wie ein Push im Vordergrund erscheint: gesperrt oder fürs falsche Konto gar nicht - auch ein voller Push alter Server. */
export function foregroundPresentation(notification: unknown) {
  const data = (notification as { request?: { content?: { data?: Record<string, unknown> } } } | null)?.request?.content?.data || {};
  return foregroundHidden || foreignAccount(data) ? SILENT : SHOW;
}

/** Konfiguriert wie Notifications im Foreground angezeigt werden */
export function configurePushNotifications() {
  if (!Notifications) return;
  Notifications.setNotificationHandler({
    handleNotification: async (notification: unknown) => foregroundPresentation(notification),
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

export function addPushNotificationReceivedListener(onReceive: (item: UserNotification) => void) {
  if (!Notifications) return undefined;
  const subscription = Notifications.addNotificationReceivedListener((notification: unknown) => {
    const item = notificationFromNotification(notification);
    if (item) onReceive(item);
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

/**
 * Android-Kanäle (#1138): legt jeden Kanal aus PUSH_CHANNELS an und löscht die alten. Android ändert Ton und
 * Wichtigkeit eines bestehenden Kanals nicht - die Werte gelten also genau beim ersten Anlegen.
 */
export async function setupAndroidChannels(): Promise<void> {
  if (!Notifications || Platform.OS !== "android") return;
  for (const channel of PUSH_CHANNELS) {
    await Notifications.setNotificationChannelAsync(channel.id, {
      name: channel.name,
      description: channel.description,
      importance: Notifications.AndroidImportance[channel.importance],
      vibrationPattern: channel.vibrationPattern,
      lightColor: channel.lightColor,
      sound: channel.sound,
    });
  }
  for (const id of RETIRED_CHANNEL_IDS) {
    try {
      await Notifications.deleteNotificationChannelAsync?.(id);
    } catch {
      // Ein Kanal, den es nicht gibt, ist auch gelöscht.
    }
  }
}

/** `privateConfirmed` (#1052): der Server hat die Wahl „ohne Inhalt“ ausdrücklich übernommen - ein alter Server nicht. */
export type PushRegistration = { token: string; privateConfirmed: boolean };

/**
 * Die Erlaubnis des Systems (#1208). `unavailable`: ohne expo-notifications oder im Emulator - dann fragt die App nie
 * und zeigt auch keinen Hinweis. `canAskAgain`: Android zeigt seine Frage noch einmal (nach dem zweiten Nein nicht mehr).
 */
export type PushPermissionStatus = "granted" | "denied" | "undetermined" | "unavailable";
export type PushPermission = { status: PushPermissionStatus; canAskAgain: boolean };

const UNAVAILABLE: PushPermission = { status: "unavailable", canAskAgain: false };

function permissionFrom(value: unknown): PushPermission {
  const raw = value as { status?: string; canAskAgain?: boolean } | null;
  const status: PushPermissionStatus = raw?.status === "granted" || raw?.status === "denied" ? raw.status : "undetermined";
  return { status, canAskAgain: raw?.canAskAgain !== false };
}

type PermissionListener = (permission: PushPermission) => void;
const permissionListeners = new Set<PermissionListener>();

/** Ändert sich die Erlaubnis aus der App heraus (Frage beantwortet), erfahren es Glocke und Hinweise sofort. */
export function onPushPermissionChange(listener: PermissionListener): () => void {
  permissionListeners.add(listener);
  return () => {
    permissionListeners.delete(listener);
  };
}

/** Liest die Erlaubnis, ohne zu fragen. */
export async function getPushPermission(): Promise<PushPermission> {
  if (!Notifications || !Device || !Device.isDevice) return UNAVAILABLE;
  try {
    return permissionFrom(await Notifications.getPermissionsAsync());
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * Die Frage des Systems (#1208) - nur nach „Ja, rufen“ oder aus dem Hinweis „einschalten“, nie von selbst. Vorher legt
 * die App die Android-Kanäle an (#1014): Android 13 und neuer fragt erst, wenn es einen Kanal gibt.
 */
export async function askPushPermission(): Promise<PushPermission> {
  const before = await getPushPermission();
  if (before.status === "unavailable" || before.status === "granted") return before;
  try {
    await setupAndroidChannels();
  } catch {
    // Ohne Kanäle fragt Android 13 nicht - die Frage kommt dann beim nächsten Versuch.
  }
  let after = before;
  try {
    after = permissionFrom(await Notifications.requestPermissionsAsync());
  } catch {
    after = await getPushPermission();
  }
  for (const listener of [...permissionListeners]) listener(after);
  return after;
}

/**
 * Registriert den Token beim Backend - nur mit Erlaubnis; gefragt wird hier nicht mehr (#1208).
 * `private` (#1052): mit App-Sperre schickt der Server nur Pushes ohne Inhalt - die Details lädt die App nach dem Entsperren.
 */
export async function registerPushToken(options: { private?: boolean } = {}): Promise<PushRegistration | null> {
  if (!Notifications || !Device) return null;

  // Nur auf echten Geräten (nicht im Simulator/Emulator)
  if (!Device.isDevice) {
    console.info("[PushService] Simulator erkannt – Push-Token übersprungen.");
    return null;
  }

  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") {
      console.info("[PushService] Keine Push-Erlaubnis - kein Token.");
      return null;
    }

    // Android: die Kanäle anlegen (#1138) - je Thema einer, die alten zwei weg.
    if (Platform.OS === "android") {
      await setupAndroidChannels();
    }

    // Expo Push Token holen
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: getExpoProjectId(),
    });

    const token = tokenData.data;
    console.info(`[PushService] Push-Token: ${token.slice(0, 30)}...`);

    // Token beim Backend registrieren - mit dem Stand der Kanäle, damit der Server die neuen Kennungen schickt.
    // Mit der Installations-Kennung (#2470) ersetzt der Server den alten Eintrag dieses Handys; ein älterer Server
    // ignoriert das Feld. Ohne sicheren Speicher geht der Token wie bisher ohne Kennung.
    const installationId = await getInstallationId();
    const { data } = await api.post<{ private_content?: boolean }>("/mobile/push-token", {
      token,
      platform: Platform.OS,
      channels: PUSH_CHANNEL_SET,
      private: Boolean(options.private),
      ...(installationId ? { installation_id: installationId } : {}),
    });

    return { token, privateConfirmed: data?.private_content === Boolean(options.private) };
  } catch (err) {
    // Nur die Art des Fehlers: Das Fehlerobjekt trägt die gesendeten Daten samt Installations-Kennung (#2470).
    const status = (err as { response?: { status?: number } } | null)?.response?.status;
    console.warn(`[PushService] Fehler bei Token-Registrierung${status ? ` (HTTP ${status})` : ""}.`);
    return null;
  }
}

function notificationFromNotification(notification: unknown): UserNotification | null {
  const content = (notification as {
    request?: { content?: { title?: string | null; body?: string | null; data?: Record<string, unknown> } };
  } | null)?.request?.content;
  return notificationFromContent(content);
}

function notificationFromResponse(response: unknown): UserNotification | null {
  const content = (response as {
    notification?: { request?: { content?: { title?: string | null; body?: string | null; data?: Record<string, unknown> } } };
  } | null)?.notification?.request?.content;
  return notificationFromContent(content);
}

function notificationFromContent(content?: { title?: string | null; body?: string | null; data?: Record<string, unknown> } | null): UserNotification | null {
  const data = content?.data || {};
  // Fürs falsche Konto (#1053): weder Liste noch Banner noch Sprung beim Antippen.
  if (foreignAccount(data)) return null;
  const notificationId = stringValue(data.notification_id || data.id);
  const kind = stringValue(data.kind);
  const url = stringValue(data.url);
  // Ein privater Push (#1052) trägt nur die Kennung - der Inhalt kommt erst nach dem Entsperren vom Server.
  const meta = data.private === true ? { content_hidden: true } : objectValue(data.meta);
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

/** Ein Push ohne Inhalt (#1052): Titel und Text sind Platzhalter, der echte Eintrag steht in der Liste vom Server. */
export function isContentHiddenPush(item: UserNotification): boolean {
  return item.meta?.content_hidden === true;
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
  return (await getPushPermission()).status === "granted";
}

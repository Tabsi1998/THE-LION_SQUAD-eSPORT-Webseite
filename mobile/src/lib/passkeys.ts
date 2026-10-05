import * as Device from "expo-device";
import { Passkey, type PasskeyCreateRequest, type PasskeyGetRequest, type PasskeyGetResult } from "react-native-passkey";
import { api } from "./api";
import type { AuthResponse } from "../types";

// Passkey-Anmeldung in der App (#217 Stufe 2): derselbe Passkey wie auf der Website. Der Server gibt
// Aufgabe und Ticket, das Gerät (Android Credential Manager) unterschreibt nach Fingerabdruck oder
// Gesicht, der Server prüft die App-Herkunft (Signaturschlüssel) und gibt die App-Sitzung zurück.

export type PasskeyStart = { ticket: string; options: PasskeyGetRequest };

export function passkeysSupported(): boolean {
  try {
    return Passkey.isSupported();
  } catch {
    return false;
  }
}

/** Das Gerät meldet Fehler als Kennwort; hier werden sie zu einem Satz. */
export function passkeyError(error: unknown, fallback = "Passkey-Anmeldung fehlgeschlagen. Bitte erneut versuchen."): string {
  const raised = error as { error?: string; message?: string; response?: { data?: { detail?: unknown } } } | null;
  const code = String(raised?.error || raised?.message || "");
  if (/UserCancelled|cancel/i.test(code)) return "Passkey-Vorgang abgebrochen.";
  if (/NoCredentials|no credential/i.test(code)) {
    return "Auf diesem Gerät ist kein Passkey für lionsquad.at gespeichert – melde dich mit Passwort an, dann bietet dir die App einen an.";
  }
  if (/NotSupported|not supported/i.test(code)) return "Passkeys werden auf diesem Gerät nicht unterstützt.";
  if (/Timeout/i.test(code)) return "Zeit abgelaufen – bitte erneut versuchen.";
  const detail = raised?.response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  return fallback;
}

/** Was der Server erwartet: die Antwort des Geräts in der Form der Web-API. */
export function credentialPayload(result: PasskeyGetResult) {
  return {
    id: result.id,
    rawId: result.rawId || result.id,
    type: result.type || "public-key",
    response: result.response,
    clientExtensionResults: result.clientExtensionResults || {},
  };
}

export async function signInWithPasskey(remember: boolean, silent = false): Promise<AuthResponse> {
  const { data: start } = await api.post<PasskeyStart>("/auth/passkeys/mobile/login/options", {});
  // Still beim Öffnen der Anmeldung (#919): nur ein Passkey, der sofort da ist. Ohne ihn zeigt Android sonst eine eigene
  // Leiste („Sign in another way“) und hält die Anfrage offen; so kommt gleich „NoCredentials“ und das Formular bleibt.
  const result = silent ? await Passkey.getImmediate(start.options) : await Passkey.get(start.options);
  const { data } = await api.post<AuthResponse>("/auth/passkeys/mobile/login/verify", {
    ticket: start.ticket,
    credential: credentialPayload(result),
    remember,
  });
  return data;
}

// Passkeys in der App anlegen und verwalten (#919) - dieselben Passkeys wie auf der Website. Nachweis ist das Ticket
// direkt nach einer Passwort-Anmeldung oder das aktuelle Passwort; das Gerät legt den Passkey nach Fingerabdruck oder
// Gesicht an, der Server prüft die App-Herkunft.

export type PasskeyRow = { id: string; name: string; created_at?: string | null; last_used_at?: string | null };

export type PasskeyProof = { enrollTicket?: string; password?: string };

/** Ein Name für den neuen Passkey mit dem Gerät (#939) - in der Liste sieht man, welches Handy welcher ist. */
export function passkeyName(model: string | null | undefined = Device.modelName): string {
  const device = String(model || "").replace(/\s+/g, " ").trim().slice(0, 60);
  return `LionsAPP · ${device || "Android"}`;
}

/** Ob es Passkeys in der App gibt: das Gerät kann sie und der Server bietet sie für die App an (sonst 503). */
export async function passkeysAvailable(): Promise<boolean> {
  try {
    const { data } = await api.get<{ app?: boolean }>("/auth/passkeys/status");
    return data?.app === true;
  } catch {
    return false;
  }
}

export async function listPasskeys(): Promise<PasskeyRow[]> {
  const { data } = await api.get<PasskeyRow[]>("/auth/passkeys");
  return Array.isArray(data) ? data : [];
}

export async function createPasskey(proof: PasskeyProof, name = passkeyName()): Promise<void> {
  const { data: start } = await api.post<{ ticket: string; options: PasskeyCreateRequest }>("/auth/passkeys/mobile/register/options", {
    enroll_ticket: proof.enrollTicket || "",
    current_password: proof.password || "",
    name,
  });
  const result = await Passkey.create(start.options);
  await api.post("/auth/passkeys/mobile/register/verify", {
    ticket: start.ticket,
    credential: {
      id: result.id,
      rawId: result.rawId || result.id,
      type: result.type || "public-key",
      response: result.response,
      clientExtensionResults: result.clientExtensionResults || {},
    },
  });
}

export async function removePasskey(id: string, password: string): Promise<void> {
  await api.post(`/auth/passkeys/mobile/${encodeURIComponent(id)}/remove`, { current_password: password });
}

/** Fehler beim Anlegen als Satz - abgebrochen ist kein Fehler, sondern ein „später“. */
export function passkeyCreateError(error: unknown): string {
  const raised = error as { error?: string; message?: string; response?: { status?: number; data?: { detail?: unknown } } } | null;
  const code = String(raised?.error || raised?.message || "");
  if (/UserCancelled|cancel/i.test(code)) return "Abgebrochen – anlegen kannst du den Passkey jederzeit im Profil unter „Einstellungen“.";
  if (/NotSupported|not supported/i.test(code)) return "Passkeys werden auf diesem Gerät nicht unterstützt.";
  const detail = raised?.response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  return "Der Passkey konnte nicht angelegt werden. Bitte erneut versuchen.";
}

/** Ob die Anmeldung still bleiben soll: kein Passkey auf dem Gerät oder abgebrochen - dann einfach das Formular. */
export function silentPasskeyMiss(error: unknown): "none" | "cancelled" | "failed" {
  const raised = error as { error?: string; message?: string; response?: { status?: number } } | null;
  // Der Server bietet (noch) keine Passkeys für die App an: dann gibt es auch nichts anzubieten.
  if (raised?.response?.status === 503) return "none";
  const code = String(raised?.error || raised?.message || "");
  if (/NoCredentials|no credential/i.test(code)) return "none";
  if (/UserCancelled|cancel/i.test(code)) return "cancelled";
  return "failed";
}

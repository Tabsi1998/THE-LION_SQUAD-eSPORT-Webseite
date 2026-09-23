import { Passkey, type PasskeyGetRequest, type PasskeyGetResult } from "react-native-passkey";
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
    return "Auf diesem Gerät ist kein Passkey für lionsquad.at gespeichert – lege ihn zuerst auf der Website im Profil unter „Sicherheit“ an.";
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

export async function signInWithPasskey(remember: boolean): Promise<AuthResponse> {
  const { data: start } = await api.post<PasskeyStart>("/auth/passkeys/mobile/login/options", {});
  const result = await Passkey.get(start.options);
  const { data } = await api.post<AuthResponse>("/auth/passkeys/mobile/login/verify", {
    ticket: start.ticket,
    credential: credentialPayload(result),
    remember,
  });
  return data;
}

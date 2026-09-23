import { api } from "./api";
import type { ChatMessage } from "../types";

// Melden und Blockieren in der App (#414): dieselben Aufrufe wie die Website
// (frontend/src/pages/user/MessagesPage.jsx, PrivacyAccountPage.jsx). Google verlangt beides in
// der App, sobald Nutzer miteinander schreiben können.

export const REPORT_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "harassment", label: "Belästigung" },
  { key: "spam", label: "Spam" },
  { key: "hate", label: "Hass oder Hetze" },
  { key: "impersonation", label: "Falsche Identität" },
  { key: "privacy", label: "Privatsphäre" },
  { key: "cheating", label: "Cheating" },
  { key: "other", label: "Sonstiges" },
];

export const MIN_DETAILS = 5;

export type ReportDraft = {
  targetUserId: string;
  category: string;
  details: string;
  /** Nur eine Direktnachricht darf als message_id mitgehen - der Server prüft das Gespräch. */
  message?: ChatMessage | null;
  direct?: boolean;
};

export type ReportPayload = { target_user_id: string; category: string; details: string; message_id: string | null };

export function detailsValid(details: string): boolean {
  return details.trim().length >= MIN_DETAILS;
}

/** Aus dem Entwurf der Aufruf: im Gruppenchat wandert der Nachrichtentext in die Beschreibung. */
export function reportPayload(draft: ReportDraft): ReportPayload {
  const details = draft.details.trim();
  const message = draft.message || null;
  if (message && !draft.direct) {
    const quoted = (message.message || "").trim();
    const suffix = quoted ? `\n\nGemeldete Nachricht (${message.id}): „${quoted.slice(0, 300)}“` : `\n\nGemeldete Nachricht: ${message.id}`;
    return { target_user_id: draft.targetUserId, category: draft.category, details: `${details}${suffix}`, message_id: null };
  }
  return { target_user_id: draft.targetUserId, category: draft.category, details, message_id: message?.id || null };
}

export async function sendReport(draft: ReportDraft): Promise<void> {
  await api.post("/moderation/reports", reportPayload(draft));
}

export async function blockUser(userId: string): Promise<void> {
  await api.post(`/moderation/blocks/${userId}`);
}

export async function unblockUser(userId: string): Promise<void> {
  await api.delete(`/moderation/blocks/${userId}`);
}

export type BlockedEntry = { id?: string; blocked_id?: string; created_at?: string; user?: { id: string; username?: string; display_name?: string | null; avatar_url?: string | null } | null };

export async function listBlocked(): Promise<BlockedEntry[]> {
  const { data } = await api.get<BlockedEntry[]>("/moderation/blocks");
  return Array.isArray(data) ? data : [];
}

/** Wer in einer Nachricht der Absender ist - Direktnachrichten tragen sender_id, Chats user_id. */
export function senderOf(message: ChatMessage): { id: string; name: string } | null {
  const id = message.sender_id || message.user_id || message.author?.id || message.sender?.id;
  if (!id) return null;
  const author = message.author || message.sender;
  return { id, name: author?.display_name || author?.username || "Spieler" };
}

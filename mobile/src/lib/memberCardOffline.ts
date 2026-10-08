import * as SecureStore from "expo-secure-store";
import { formatDateTime } from "./format";
import type { MemberCard } from "./memberCard";

// Die Mitgliedskarte ohne Netz (#1256), wie auf der Website: die zuletzt geladene Karte bleibt auf dem Gerät und erscheint
// ohne Netz mit „Stand“. Gespeichert wird nur, was auf der Karte steht - nie der Prüfcode oder der Prüflink - und nur für
// das eigene Konto: Abmelden löscht sie (AuthContext.clearSession), ein anderes Konto sieht sie nie.

const KEY = "tls.member-card";

export type CardFace = {
  club_name: string;
  name: string;
  member_number?: string | null;
  type_label: string;
  member_since?: string | null;
  valid_until?: string | null;
};

export type OfflineCard = { user_id: string; saved_at: string; card: CardFace };

/** Was auf der Karte steht - ohne Prüfcode und Prüflink. Nur eine gültige Karte hat eine Vorderseite. */
export function cardFace(card: MemberCard | null | undefined): CardFace | null {
  if (!card || card.status !== "valid") return null;
  return {
    club_name: card.club_name,
    name: card.name,
    member_number: card.member_number ?? null,
    type_label: card.type_label,
    member_since: card.member_since ?? null,
    valid_until: card.valid_until ?? null,
  };
}

export async function saveOfflineCard(userId: string | null | undefined, card: MemberCard, now: Date = new Date()): Promise<void> {
  const face = cardFace(card);
  if (!userId || !face) return;
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify({ user_id: userId, saved_at: now.toISOString(), card: face }));
  } catch {
    // Ohne Speicher gibt es die Karte offline eben nicht - mit Netz bleibt alles, wie es ist.
  }
}

export async function loadOfflineCard(userId: string | null | undefined): Promise<OfflineCard | null> {
  if (!userId) return null;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || parsed.user_id !== userId || typeof parsed.card?.name !== "string") return null;
    return parsed as OfflineCard;
  } catch {
    return null;
  }
}

export async function clearOfflineCard(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // nichts gespeichert
  }
}

/** „Stand: 07.10.2026, 18:05“ - wann die Karte zuletzt mit Netz geladen wurde. */
export function standLine(savedAt?: string | null): string {
  return savedAt ? `Stand: ${formatDateTime(savedAt)}` : "";
}

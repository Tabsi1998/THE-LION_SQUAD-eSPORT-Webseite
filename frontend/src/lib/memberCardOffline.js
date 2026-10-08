// Die Mitgliedskarte ohne Netz (#1256, Wahl des Betreibers: Variante B - als Bild und offline). Gespeichert wird nur, was
// auf der Karte steht (Name, Nummer, Art, seit, gültig bis) samt Zeitpunkt - nie der Prüfcode: der gilt fünf Minuten,
// offline steht deshalb „Prüfcode braucht Netz“. Ohne Browser-Speicher (privates Fenster, gesperrt) gilt die Karte nur
// für diesen Besuch. Abmelden löscht alles (AuthContext.logout), ebenso eine Karte eines anderen Kontos.
// Das Bild der Karte liegt zusätzlich im Cache des Service Workers - die installierte Website zeigt es ohne Netz auf der
// Seite „Keine Verbindung“ (public/service-worker.js).

import { asInstant, viennaDateTime } from "@/lib/vienna";

export const STORAGE_KEY = "tls-member-card-v1";
export const CARD_CACHE = "tls-member-card";
export const CARD_IMAGE_URL = "/__tls/member-card.png";
export const CARD_META_URL = "/__tls/member-card.json";
const FIELDS = ["name", "member_number", "type_label", "member_since", "valid_until", "club_name"];
let memory = null;

function storage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Nur die sichtbaren Felder der Karte - kein Prüfcode, keine Prüfadresse. */
export function cardSnapshot(card, userId, now = new Date()) {
  const snapshot = { user_id: String(userId || ""), saved_at: now.toISOString() };
  for (const field of FIELDS) snapshot[field] = card?.[field] ?? null;
  return snapshot;
}

export function saveOfflineCard(userId, card, now = new Date()) {
  if (!userId || card?.status !== "valid") return null;
  const snapshot = cardSnapshot(card, userId, now);
  memory = snapshot;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // ohne Speicher bleibt die Karte nur für diesen Besuch
  }
  return snapshot;
}

export function loadOfflineCard(userId) {
  let snapshot = memory;
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (raw) snapshot = JSON.parse(raw);
  } catch {
    // kaputter oder gesperrter Speicher: die Karte aus diesem Besuch, sonst keine
  }
  if (!snapshot || !userId || String(snapshot.user_id) !== String(userId)) return null;
  return snapshot;
}

/** Das Konto der gespeicherten Karte - um beim Kontowechsel aufzuräumen. */
export function offlineCardOwner() {
  return loadOfflineCardRaw()?.user_id || "";
}

function loadOfflineCardRaw() {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : memory;
  } catch {
    return memory;
  }
}

/** Abmelden: Karte, Bild und Angaben fürs Offline-Bild weg. */
export async function clearOfflineCard() {
  memory = null;
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // nichts zu löschen
  }
  try {
    if (globalThis.caches) await globalThis.caches.delete(CARD_CACHE);
  } catch {
    // ohne Cache-Speicher gibt es auch kein Bild
  }
}

/** Das Bild der Karte (ohne Prüfcode) für die installierte Website ohne Netz. */
export async function storeOfflineCardImage(blob, snapshot) {
  if (!blob || !globalThis.caches) return false;
  try {
    const cache = await globalThis.caches.open(CARD_CACHE);
    await cache.put(CARD_IMAGE_URL, new Response(blob, { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } }));
    await cache.put(CARD_META_URL, new Response(JSON.stringify({ saved_at: snapshot?.saved_at || new Date().toISOString() }), { headers: { "Content-Type": "application/json" } }));
    return true;
  } catch {
    return false;
  }
}

/** Hat sich auf der Karte etwas geändert (Name, Nummer, Art …)? Dann gibt es ein neues Bild - sonst nicht bei jedem Code. */
export function cardChanged(previous, card) {
  if (!previous) return true;
  return FIELDS.some((field) => (previous[field] ?? null) !== (card?.[field] ?? null));
}

/** „Stand: 7.10.2026, 18:05“ */
export function standLine(snapshot) {
  if (!snapshot?.saved_at || Number.isNaN(asInstant(snapshot.saved_at).getTime())) return "";
  // Wiener Uhr über die gemeinsame Hilfe (vienna.test.js wacht darüber).
  return `Stand: ${viennaDateTime(snapshot.saved_at, { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;
}

/** Als Bild speichern: am Handy das Teilen-Menü (Fotos), sonst ein Download. */
export async function shareOrDownload(blob, filename = "mitgliedskarte.png") {
  if (!blob) return "none";
  const file = typeof File === "function" ? new File([blob], filename, { type: "image/png" }) : null;
  try {
    if (file && navigator.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: "Mitgliedskarte" });
      return "shared";
    }
  } catch (error) {
    if (error?.name === "AbortError") return "cancelled";
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}

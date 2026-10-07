import { api } from "@/lib/api";
import { asInstant, dayBefore, viennaDate, viennaDay, viennaTime } from "@/lib/vienna";

// Alle Chats an einem Ort (#1148): Direktnachrichten, Team-, Turnier- und Match-Chats aus `/api/chats`, das Neueste oben,
// mit der Zahl der Ungelesenen. Der Server merkt sich je Unterhaltung „gelesen bis“; Web und App setzen die Marke beim
// Öffnen eines Chats - die Zahl ist überall gleich.

export const CHAT_KIND_LABELS = { direct: "Nachricht", team: "Team-Chat", tournament: "Turnier-Chat", match: "Match-Chat" };

const listeners = new Set();

/** Wer wissen will, dass sich Ungelesenes geändert hat (Handy-Leiste, Menü, Liste). */
export function onChatsChanged(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // ein Zuhörer darf die anderen nicht aufhalten
    }
  });
}

export function normalizeChatList(data) {
  const items = Array.isArray(data?.items) ? data.items.filter((item) => item && item.key && item.kind) : [];
  const unread = items.reduce((sum, item) => sum + Math.max(0, Number(item.unread_count || 0)), 0);
  return { items, unread_total: unread };
}

export async function loadChats() {
  const { data } = await api.get("/chats");
  return normalizeChatList(data);
}

/** „Gelesen bis jetzt“ für eine Unterhaltung - beim Öffnen eines Chats. Fehler bleiben still. */
export async function markChatRead(kind, targetId) {
  if (!kind || !targetId) return;
  try {
    await api.post(`/chats/${kind}/${encodeURIComponent(targetId)}/read`);
  } catch {
    // bleibt ungelesen bis zum nächsten Öffnen
  }
  announce();
}

/** Die Zahl als Text für Abzeichen: ab 100 „99+“. */
export function badgeText(count) {
  return count > 99 ? "99+" : String(count);
}

/** Uhrzeit für heute, „gestern“, sonst der Tag - wie in der Vorschau. Tage zählen in Wien. */
export function chatTime(value, now = new Date()) {
  if (!value) return "";
  const date = asInstant(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = viennaDay(now);
  if (viennaDay(date) === today) return viennaTime(date, { hour: "2-digit", minute: "2-digit" });
  if (viennaDay(date) === dayBefore(today)) return "gestern";
  return viennaDate(date, { day: "2-digit", month: "2-digit" });
}

/** Die Vorschauzeile eines Eintrags: Art, bei Gruppen der Name, dann der Text. */
export function chatPreview(item) {
  const label = item.subtitle || CHAT_KIND_LABELS[item.kind] || "Chat";
  const last = item.last_message;
  if (!last?.text) return `${label} · Noch keine Nachricht`;
  return `${label}${last.author && item.kind !== "direct" ? ` · ${last.author}` : ""}: ${last.text}`;
}

/** Wohin ein Eintrag führt: Direktnachrichten in die Unterhaltung, Gruppen-Chats auf ihre Seite zum Chat. */
export function chatHref(item) {
  if (item.kind === "direct") return `/messages/${item.target_id}`;
  if (item.kind === "team") return `/teams/${item.target_id}#chat`;
  if (item.kind === "tournament") return `/tournaments/${item.slug || item.target_id}#chat`;
  return `/matches/${item.target_id}#chat`;
}

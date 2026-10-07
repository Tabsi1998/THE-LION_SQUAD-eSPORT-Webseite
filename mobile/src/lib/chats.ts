import { api } from "./api";
import { dayBefore, viennaDate, viennaDay, viennaTime } from "./vienna";

// Alle Chats an einem Ort (#1148): Direktnachrichten, Team-, Turnier- und Match-Chats aus `/api/chats`, das Neueste oben.
// Der Server kennt je Unterhaltung „gelesen bis“ - Web und App setzen die Marke beim Öffnen, die Zahl ist überall gleich.

export type ChatKind = "direct" | "team" | "tournament" | "match";

export type ChatItem = {
  key: string;
  kind: ChatKind;
  target_id: string;
  title: string;
  subtitle?: string;
  image?: string | null;
  username?: string | null;
  slug?: string | null;
  tag?: string | null;
  context?: string | null;
  url?: string;
  last_message?: { text?: string; author?: string; author_id?: string; created_at?: string } | null;
  unread_count?: number;
  updated_at?: string;
};

export type ChatList = { items: ChatItem[]; unread_total: number };

type ReadListener = (key: string) => void;
const readListeners = new Set<ReadListener>();

/** Wer wissen will, dass eine Unterhaltung gelesen ist (die Liste und die Zahl am Tab). */
export function onChatRead(listener: ReadListener): () => void {
  readListeners.add(listener);
  return () => {
    readListeners.delete(listener);
  };
}

export function chatKey(kind: ChatKind, targetId: string) {
  return `${kind}:${targetId}`;
}

/** „Gelesen bis jetzt“ für eine Unterhaltung - beim Öffnen des Chats. Fehler sind still: die Zahl kommt beim nächsten Laden. */
export async function markChatRead(kind: ChatKind, targetId: string): Promise<void> {
  if (!targetId) return;
  readListeners.forEach((listener) => listener(chatKey(kind, targetId)));
  try {
    await api.post(`/chats/${kind}/${encodeURIComponent(targetId)}/read`);
  } catch {
    // bleibt ungelesen bis zum nächsten Öffnen
  }
}

export function normalizeChatList(data: unknown): ChatList {
  const payload = (data || {}) as Partial<ChatList>;
  const items = Array.isArray(payload.items) ? payload.items.filter((item) => item && item.key && item.kind) : [];
  const unread = items.reduce((sum, item) => sum + Math.max(0, Number(item.unread_count || 0)), 0);
  return { items, unread_total: unread };
}

/** Die Liste nach dem Lesen einer Unterhaltung: deren Zahl ist weg, die Summe passt. */
export function withChatRead(list: ChatList, key: string): ChatList {
  if (!list.items.some((item) => item.key === key && Number(item.unread_count || 0) > 0)) return list;
  return normalizeChatList({ items: list.items.map((item) => (item.key === key ? { ...item, unread_count: 0 } : item)) });
}

/** Die Zahl als Text für Abzeichen: ab 100 „99+“. */
export function badgeText(count: number) {
  return count > 99 ? "99+" : String(count);
}

/** Uhrzeit für heute, „gestern“, sonst der Tag - wie in der Vorschau der Chat-Liste. Tage zählen in Wien. */
export function chatTime(value?: string | null, now: Date = new Date()) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = viennaDay(now);
  if (viennaDay(date) === today) return viennaTime(date, { hour: "2-digit", minute: "2-digit" });
  if (viennaDay(date) === dayBefore(today)) return "gestern";
  return viennaDate(date, { day: "2-digit", month: "2-digit" });
}

/** Wohin ein Eintrag der Liste führt - der Chat selbst, über dem aktuellen Tab. */
export function chatTarget(item: ChatItem): { screen: "DirectThread"; params: { userId: string; title?: string } } | { screen: "TeamChat" | "TournamentChat"; params: { id: string; title?: string } } | { screen: "MatchDetail"; params: { id: string } } {
  switch (item.kind) {
    case "direct":
      return { screen: "DirectThread", params: { userId: item.target_id, title: item.title } };
    case "team":
      return { screen: "TeamChat", params: { id: item.target_id, title: `${item.tag || item.title} Chat` } };
    case "tournament":
      // Die Kennung, nicht die Adresse: so erkennt die App den offenen Chat (keine Banner für ihn) wie bei Benachrichtigungen.
      return { screen: "TournamentChat", params: { id: item.target_id, title: `${item.title} Chat` } };
    default:
      return { screen: "MatchDetail", params: { id: item.target_id } };
  }
}

export async function loadChatList(): Promise<ChatList> {
  const { data } = await api.get<ChatList>("/chats");
  return normalizeChatList(data);
}

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { loadChats, markChatRead, normalizeChatList, onChatsChanged } from "@/lib/chats";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

// Chats (#1148) im Web: die Liste unter /messages und die Zahl am Eintrag „Community“ (Handy-Leiste, Menü am PC).
// Chats sind privat und stehen nicht im öffentlichen Live-Strom: neu geladen wird bei Benachrichtigungen, beim Lesen
// eines Chats und sonst jede Minute.

const RESOURCES = ["notifications", "admin/notifications", "messages", "teams", "tournaments", "matches"];

/** Die Zahl der ungelesenen Chats - 0 ohne Konto. */
export function useUnreadChats(userId) {
  const [count, setCount] = useState(0);
  const load = useCallback(async () => {
    if (!userId) {
      setCount(0);
      return;
    }
    try {
      const { data } = await api.get("/chats/unread");
      setCount(Math.max(0, Number(data?.unread_total || 0)));
    } catch {
      // bleibt beim letzten Stand
    }
  }, [userId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => onChatsChanged(() => { void load(); }), [load]);
  useLiveRefresh(load, RESOURCES, { pollMs: 60000, enabled: Boolean(userId) });
  return count;
}

/** Die ganze Liste für /messages. */
export function useChatList(enabled = true) {
  const [list, setList] = useState(() => normalizeChatList(null));
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      setList(await loadChats());
      setError("");
    } catch {
      setError("Chats konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [enabled]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => onChatsChanged(() => { void load(); }), [load]);
  useLiveRefresh(load, RESOURCES, { pollMs: 30000, enabled });
  return { list, loading, error, reload: load };
}

/** Ein offener Chat gilt als gelesen - beim Öffnen und bei jeder neuen Nachricht (#1148). */
export function useChatRead(kind, targetId, messages, enabled = true) {
  const rows = Array.isArray(messages) ? messages : [];
  const newest = rows.length ? String(rows[rows.length - 1]?.id || rows.length) : "";
  const last = useRef(null);
  useEffect(() => {
    if (!enabled || !kind || !targetId) return;
    const key = `${kind}:${targetId}:${newest}`;
    if (last.current === key) return;
    last.current = key;
    void markChatRead(kind, targetId);
  }, [enabled, kind, newest, targetId]);
}

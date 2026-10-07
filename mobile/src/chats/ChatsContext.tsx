import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../lib/api";
import { loadChatList, onChatRead, withChatRead, type ChatList } from "../lib/chats";
import { isGuestUser } from "../live";
import { useOptionalNotifications } from "../notifications/NotificationContext";
import { useLiveRefresh } from "../realtime/LiveChangesProvider";

// Die Chats (#1148) für die ganze App: die Liste unter Community → Chats und die Zahl am Tab „Community“ kommen aus
// derselben Antwort. Neu geladen wird beim Start, wenn die App wieder nach vorne kommt, wenn eine Benachrichtigung
// eintrifft (neue Nachricht) und sonst alle 45 Sekunden - Chats sind privat und stehen nicht im öffentlichen Live-Strom.

type ChatsValue = {
  list: ChatList;
  loading: boolean;
  error: string;
  enabled: boolean;
  reload: () => Promise<void>;
};

const EMPTY: ChatList = { items: [], unread_total: 0 };
const ChatsContext = createContext<ChatsValue | null>(null);
const CHAT_LIVE_RESOURCES = ["notifications", "messages", "teams", "tournaments", "matches"];

export function ChatsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const enabled = Boolean(user && !isGuestUser(user));
  const [list, setList] = useState<ChatList>(EMPTY);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const userId = user?.id || "";
  const userRef = useRef(userId);
  userRef.current = userId;

  const reload = useCallback(async () => {
    if (!enabled) {
      setList(EMPTY);
      setLoading(false);
      return;
    }
    const requestedFor = userRef.current;
    try {
      const next = await loadChatList();
      if (userRef.current === requestedFor) {
        setList(next);
        setError("");
      }
    } catch (err) {
      if (userRef.current === requestedFor) setError(errorMessage(err, "Chats konnten nicht geladen werden."));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    setList(EMPTY);
    setLoading(enabled);
    void reload();
  }, [enabled, reload, userId]);

  useEffect(() => onChatRead((key) => setList((current) => withChatRead(current, key))), []);

  useEffect(() => {
    if (!enabled) return undefined;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void reload();
    });
    return () => subscription.remove();
  }, [enabled, reload]);

  // Eine neue Benachrichtigung ist meist eine neue Nachricht: die Zahl am Tab gleich mitziehen.
  const notifications = useOptionalNotifications();
  const unreadNotifications = notifications?.unread ?? 0;
  const lastNotificationCount = useRef(unreadNotifications);
  useEffect(() => {
    if (unreadNotifications > lastNotificationCount.current) void reload();
    lastNotificationCount.current = unreadNotifications;
  }, [reload, unreadNotifications]);

  useLiveRefresh(reload, CHAT_LIVE_RESOURCES, { enabled, fallbackMs: 45000 });

  const value = useMemo(() => ({ list, loading, error, enabled, reload }), [enabled, error, list, loading, reload]);
  return <ChatsContext.Provider value={value}>{children}</ChatsContext.Provider>;
}

/** Die Chats - ohne Provider (Tests einzelner Screens) eine leere Liste, die selbst lädt, wenn man `reload` ruft. */
export function useChats(): ChatsValue {
  const context = useContext(ChatsContext);
  const [fallback, setFallback] = useState<ChatList>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setFallback(await loadChatList());
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Chats konnten nicht geladen werden."));
    } finally {
      setLoading(false);
    }
  }, []);
  if (context) return context;
  return { list: fallback, loading, error, enabled: true, reload };
}

/** Nur die Zahl für den Tab „Community“. */
export function useUnreadChats(): number {
  return useContext(ChatsContext)?.list.unread_total ?? 0;
}

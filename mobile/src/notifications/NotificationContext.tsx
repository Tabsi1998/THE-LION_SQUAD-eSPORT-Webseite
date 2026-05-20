import { Ionicons } from "@expo/vector-icons";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { Body, Muted } from "../components/Text";
import { api } from "../lib/api";
import { isGuestUser } from "../live";
import { navigateToNotification } from "../navigation/rootNavigation";
import { colors } from "../theme";
import type { UserNotification } from "../types";

type NotificationContextValue = {
  items: UserNotification[];
  unread: number;
  load: () => Promise<void>;
  markRead: (item: UserNotification) => Promise<void>;
  markAllRead: () => Promise<void>;
  openNotification: (item: UserNotification) => Promise<void>;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [items, setItems] = useState<UserNotification[]>([]);
  const [popups, setPopups] = useState<UserNotification[]>([]);
  const knownIds = useRef(new Set<string>());
  const primed = useRef(false);
  const enabled = Boolean(user && !isGuestUser(user));

  const load = useCallback(async () => {
    if (!enabled) {
      setItems([]);
      setPopups([]);
      knownIds.current = new Set();
      primed.current = false;
      return;
    }
    try {
      const { data } = await api.get<UserNotification[]>("/admin/notifications");
      const rows = Array.isArray(data) ? data : [];
      setItems(rows);
      const nextUnread = rows.filter((item) => !item.read && item.id && !knownIds.current.has(item.id)).slice(0, 3);
      if (primed.current && nextUnread.length) {
        setPopups((current) => [...nextUnread, ...current].slice(0, 3));
      }
      knownIds.current = new Set(rows.map((item) => item.id).filter(Boolean));
      primed.current = true;
    } catch {
      setItems([]);
    }
  }, [enabled]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [enabled, load]);

  useEffect(() => {
    if (!popups.length) return undefined;
    const timer = setTimeout(() => setPopups((current) => current.slice(0, -1)), 6500);
    return () => clearTimeout(timer);
  }, [popups]);

  const markRead = useCallback(async (item: UserNotification) => {
    if (!item.read) {
      setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, read: true } : row));
      await api.post(`/admin/notifications/${item.id}/read`).catch(() => {});
    }
  }, []);

  const markAllRead = useCallback(async () => {
    setItems((rows) => rows.map((row) => ({ ...row, read: true })));
    await api.post("/admin/notifications/read-all").catch(() => {});
  }, []);

  const openNotification = useCallback(async (item: UserNotification) => {
    await markRead(item);
    setPopups((rows) => rows.filter((row) => row.id !== item.id));
    navigateToNotification(item);
  }, [markRead]);

  const value = useMemo(() => ({
    items,
    unread: items.filter((item) => !item.read).length,
    load,
    markRead,
    markAllRead,
    openNotification,
  }), [items, load, markAllRead, markRead, openNotification]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <View pointerEvents="box-none" style={styles.popupLayer}>
        {popups.map((item) => (
          <Pressable key={item.id} onPress={() => { openNotification(item); }} style={styles.popup}>
            <Ionicons name="notifications" color={colors.cyan} size={18} />
            <View style={styles.popupText}>
              <Body style={styles.popupTitle} numberOfLines={1}>{item.title || "Benachrichtigung"}</Body>
              {item.body ? <Muted numberOfLines={2}>{item.body}</Muted> : null}
            </View>
          </Pressable>
        ))}
      </View>
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error("useNotifications must be used inside NotificationProvider");
  return context;
}

const styles = StyleSheet.create({
  popupLayer: {
    left: 14,
    pointerEvents: "box-none",
    position: "absolute",
    right: 14,
    top: 54,
    zIndex: 50,
    gap: 8,
  },
  popup: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "rgba(41,182,232,0.45)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 12,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 14,
  },
  popupText: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  popupTitle: {
    fontWeight: "900",
  },
});

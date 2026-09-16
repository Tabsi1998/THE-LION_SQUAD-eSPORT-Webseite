import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { bundleNotifications } from "@/lib/notifications";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

const RESOURCES = ["admin/notifications", "notifications", "messages", "teams", "tournaments", "matches", "prizes"];

// Die Benachrichtigungen des angemeldeten Nutzers, gebündelt (#255). Glocke
// und Benachrichtigungsseite teilen Laden, Live-Aktualisierung und die
// Aktionen; „geöffnet“ markiert alle Teile eines Bündels als gelesen.
export function useNotificationFeed({ enabled = true, onFresh } = {}) {
  const [items, setItems] = useState([]);
  const knownIdsRef = useRef(new Set());
  const didPrimeRef = useRef(false);
  const onFreshRef = useRef(onFresh);
  useEffect(() => {
    onFreshRef.current = onFresh;
  }, [onFresh]);

  const load = useCallback(async () => {
    if (!enabled) {
      setItems([]);
      knownIdsRef.current = new Set();
      didPrimeRef.current = false;
      return;
    }
    try {
      const { data } = await api.get("/admin/notifications");
      const rows = Array.isArray(data) ? data : [];
      setItems(rows);
      if (didPrimeRef.current && onFreshRef.current) {
        const fresh = rows.filter((item) => !item.read && item.id && !knownIdsRef.current.has(item.id));
        if (fresh.length) onFreshRef.current(fresh, rows);
      }
      knownIdsRef.current = new Set(rows.map((item) => item.id).filter(Boolean));
      didPrimeRef.current = true;
    } catch {
      setItems([]);
    }
  }, [enabled]);

  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, RESOURCES, { fallbackMs: 30000, enabled });

  const bundles = useMemo(() => bundleNotifications(items), [items]);
  const unread = useMemo(() => items.filter((item) => !item.read).length, [items]);

  const markRead = useCallback(async (bundle) => {
    const ids = (bundle?.ids || []).filter((id) => items.some((item) => item.id === id && !item.read));
    if (!ids.length) return;
    setItems((rows) => rows.map((row) => (ids.includes(row.id) ? { ...row, read: true } : row)));
    await Promise.allSettled(ids.map((id) => api.post(`/admin/notifications/${id}/read`)));
  }, [items]);

  const markAllRead = useCallback(async () => {
    setItems((rows) => rows.map((row) => ({ ...row, read: true })));
    try { await api.post("/admin/notifications/read-all"); } catch {}
  }, []);

  const deleteBundle = useCallback(async (bundle) => {
    const ids = bundle?.ids || [];
    setItems((rows) => rows.filter((row) => !ids.includes(row.id)));
    const results = await Promise.allSettled(ids.map((id) => api.delete(`/admin/notifications/${id}`)));
    if (results.some((result) => result.status === "rejected")) load();
  }, [load]);

  const deleteRead = useCallback(async () => {
    setItems((rows) => rows.filter((row) => !row.read));
    try { await api.delete("/admin/notifications/read"); } catch { load(); }
  }, [load]);

  return { items, bundles, unread, read: items.length - unread, load, markRead, markAllRead, deleteBundle, deleteRead };
}

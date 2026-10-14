import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { bundleNotifications } from "@/lib/notifications";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useLoad } from "@/hooks/useLoad";

const RESOURCES = ["admin/notifications", "notifications", "messages", "teams", "tournaments", "matches", "prizes"];
const NO_ITEMS = [];

function notReadMessage(count, total) {
  if (count === total && count === 1) return "Die Benachrichtigung konnte nicht als gelesen markiert werden.";
  if (count === total) return "Die Benachrichtigungen konnten nicht als gelesen markiert werden.";
  return `${count} ${count === 1 ? "Benachrichtigung konnte" : "Benachrichtigungen konnten"} nicht als gelesen markiert werden.`;
}

// Die Benachrichtigungen des angemeldeten Nutzers, gebündelt (#255). Glocke und Benachrichtigungsseite teilen Laden,
// Live-Aktualisierung und die Aktionen; „geöffnet“ markiert alle Teile eines Bündels als gelesen.
// Laden über useLoad (#984): ein Ladefehler ist kein „Keine Benachrichtigungen“, ein gescheitertes Nachladen lässt den
// letzten Stand stehen. Gelesen markieren (#987): sofort sichtbar, ausstehende Einträge stehen in `pendingIds` (ein
// zweiter Klick schickt nichts doppelt); was der Server ablehnt, wird wieder ungelesen und steht in `actionError` mit
// `retry` - was geklappt hat, bleibt gelesen.
export function useNotificationFeed({ enabled = true, onFresh } = {}) {
  const knownIdsRef = useRef(new Set());
  const didPrimeRef = useRef(false);
  const onFreshRef = useRef(onFresh);
  const pendingRef = useRef(new Set());
  const retryRef = useRef({ ids: () => {}, all: () => {} });
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const [actionError, setActionError] = useState(null);
  useEffect(() => {
    onFreshRef.current = onFresh;
  }, [onFresh]);

  useEffect(() => {
    if (enabled) return;
    knownIdsRef.current = new Set();
    didPrimeRef.current = false;
    setActionError(null);
  }, [enabled]);

  const fetchFeed = useCallback(async ({ signal }) => {
    const { data } = await api.get("/admin/notifications", { signal });
    const rows = Array.isArray(data) ? data : [];
    if (didPrimeRef.current && onFreshRef.current) {
      const fresh = rows.filter((item) => !item.read && item.id && !knownIdsRef.current.has(item.id));
      if (fresh.length) onFreshRef.current(fresh, rows);
    }
    knownIdsRef.current = new Set(rows.map((item) => item.id).filter(Boolean));
    didPrimeRef.current = true;
    return rows;
  }, []);

  const feed = useLoad(enabled ? "notifications" : null, fetchFeed);
  const { reload: load, mutate } = feed;
  useLiveRefresh(load, RESOURCES, { fallbackMs: 30000, enabled });

  // Ausstehende „gelesen“ liegen über dem Stand vom Server: ein Nachladen, während der POST unterwegs ist, bringt sie
  // nicht wieder als ungelesen zurück.
  const raw = feed.data || NO_ITEMS;
  const items = useMemo(() => (pendingIds.size ? raw.map((row) => (pendingIds.has(row.id) && !row.read ? { ...row, read: true } : row)) : raw), [raw, pendingIds]);
  const bundles = useMemo(() => bundleNotifications(items), [items]);
  const unread = useMemo(() => items.filter((item) => !item.read).length, [items]);

  const setRead = useCallback((ids, read) => {
    if (!ids.length) return;
    mutate((rows) => rows.map((row) => (ids.includes(row.id) ? { ...row, read } : row)));
  }, [mutate]);

  const setPending = useCallback((ids, on) => {
    ids.forEach((id) => (on ? pendingRef.current.add(id) : pendingRef.current.delete(id)));
    setPendingIds(new Set(pendingRef.current));
  }, []);

  const markIds = useCallback(async (ids) => {
    const todo = ids.filter((id) => !pendingRef.current.has(id));
    if (!todo.length) return;
    setActionError(null);
    setPending(todo, true);
    setRead(todo, true);
    const results = await Promise.allSettled(todo.map((id) => api.post(`/admin/notifications/${id}/read`)));
    const failed = todo.filter((_, index) => results[index].status === "rejected");
    // Erst den Stand setzen, dann das Overlay abnehmen - sonst blitzt ein zwischendurch geladener alter Stand auf.
    setRead(todo.filter((id) => !failed.includes(id)), true);
    setPending(todo, false);
    if (failed.length) {
      setRead(failed, false);
      setActionError({ message: notReadMessage(failed.length, todo.length), retry: () => retryRef.current.ids(failed) });
    }
  }, [setPending, setRead]);

  const markRead = useCallback(async (bundle) => {
    const ids = (bundle?.ids || []).filter((id) => items.some((item) => item.id === id && !item.read));
    await markIds(ids);
  }, [items, markIds]);

  const markAllRead = useCallback(async () => {
    const ids = items.filter((item) => !item.read && !pendingRef.current.has(item.id)).map((item) => item.id);
    if (!ids.length) return;
    setActionError(null);
    setPending(ids, true);
    setRead(ids, true);
    try {
      await api.post("/admin/notifications/read-all");
      setRead(ids, true);
      setPending(ids, false);
    } catch {
      setPending(ids, false);
      setRead(ids, false);
      setActionError({ message: notReadMessage(ids.length, ids.length), retry: () => retryRef.current.all() });
      // Was der Server vielleicht doch geschafft hat, zeigt der nächste Stand.
      load();
    }
  }, [items, load, setPending, setRead]);

  useEffect(() => {
    retryRef.current = { ids: markIds, all: markAllRead };
  }, [markIds, markAllRead]);

  const deleteBundle = useCallback(async (bundle) => {
    const ids = bundle?.ids || [];
    mutate((rows) => rows.filter((row) => !ids.includes(row.id)));
    const results = await Promise.allSettled(ids.map((id) => api.delete(`/admin/notifications/${id}`)));
    if (results.some((result) => result.status === "rejected")) load();
  }, [load, mutate]);

  const deleteRead = useCallback(async () => {
    mutate((rows) => rows.filter((row) => !row.read));
    try { await api.delete("/admin/notifications/read"); } catch { load(); }
  }, [load, mutate]);

  const clearActionError = useCallback(() => setActionError(null), []);

  return {
    items,
    bundles,
    unread,
    read: items.length - unread,
    status: feed.status,
    problem: feed.problem,
    stale: feed.stale,
    feed,
    load,
    markRead,
    markAllRead,
    deleteBundle,
    deleteRead,
    pendingIds,
    actionError,
    clearActionError,
  };
}

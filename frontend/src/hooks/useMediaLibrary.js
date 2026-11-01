// Bildauswahl aus den Medien (#2122): seitenweise, die Suche rechnet der Server - auch über die ältesten Dateien.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

export const MEDIA_PAGE_SIZE = 60;
const SEARCH_DELAY_MS = 300;

/** Die Antwort als `{ items, total, totalSize }` - eine Liste ohne Rahmen gilt als vollständig. */
export function mediaPageFrom(data) {
  if (Array.isArray(data)) return { items: data, total: data.length, totalSize: null };
  const items = Array.isArray(data?.items) ? data.items : [];
  return { items, total: Number(data?.total ?? items.length), totalSize: data?.total_size ?? null };
}

/** Die Adresse einer Seite: Endpunkt mit seinen Filtern, dazu Seite und Suche. */
export function mediaPageUrl(endpoint, { limit = MEDIA_PAGE_SIZE, offset = 0, q = "" } = {}) {
  const params = new URLSearchParams({ paged: "true", limit: String(limit), offset: String(offset) });
  const needle = String(q || "").trim();
  if (needle) params.set("q", needle);
  return `${endpoint}${endpoint.includes("?") ? "&" : "?"}${params.toString()}`;
}

export function useMediaLibrary(endpoint, open) {
  const [search, setSearch] = useState("");
  const [needle, setNeedle] = useState("");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setNeedle(search.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const { data } = await api.get(mediaPageUrl(endpoint, { q: needle }));
      if (request !== requestRef.current) return;
      const page = mediaPageFrom(data);
      setItems(page.items);
      setTotal(page.total);
    } catch {
      if (request === requestRef.current) toast.error("Medienbibliothek konnte nicht geladen werden.");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [endpoint, needle]);

  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  useApiInvalidation(() => (open ? reload() : undefined), ["media", "uploads"]);

  const loadMore = useCallback(async () => {
    const request = ++requestRef.current;
    setLoadingMore(true);
    try {
      const { data } = await api.get(mediaPageUrl(endpoint, { q: needle, offset: items.length }));
      if (request !== requestRef.current) return;
      const page = mediaPageFrom(data);
      setItems((rows) => [...rows, ...page.items]);
      setTotal(page.total);
    } catch {
      if (request === requestRef.current) toast.error("Medienbibliothek konnte nicht geladen werden.");
    } finally {
      if (request === requestRef.current) setLoadingMore(false);
    }
  }, [endpoint, needle, items.length]);

  return { items, total, loading, loadingMore, search, setSearch, loadMore, hasMore: items.length < total };
}

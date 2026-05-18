import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, Check, Inbox, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

const TABS = [
  ["unread", "Ungelesen"],
  ["all", "Alle"],
  ["read", "Gelesen"],
];

function notificationDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "";
  }
}

export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("unread");
  const [items, setItems] = useState([]);
  const boxRef = useRef(null);
  const knownIdsRef = useRef(new Set());
  const didPrimeRef = useRef(false);

  const load = useCallback(async () => {
    if (!user) {
      setItems([]);
      knownIdsRef.current = new Set();
      didPrimeRef.current = false;
      return;
    }
    try {
      const { data } = await api.get("/admin/notifications");
      const rows = Array.isArray(data) ? data : [];
      setItems(rows);
      if (didPrimeRef.current) {
        rows
          .filter((item) => item.kind === "match_reminder" && !item.read && item.id && !knownIdsRef.current.has(item.id))
          .slice(0, 3)
          .forEach((item) => {
            toast.info(item.title || "Match-Erinnerung", {
              description: item.body || "Dein Match startet bald.",
              duration: 15000,
              action: item.url ? {
                label: "Oeffnen",
                onClick: async () => {
                  try { await api.post(`/admin/notifications/${item.id}/read`); } catch {}
                  navigate(item.url);
                },
              } : undefined,
            });
          });
      }
      knownIdsRef.current = new Set(rows.map((item) => item.id).filter(Boolean));
      didPrimeRef.current = true;
    } catch {
      setItems([]);
    }
  }, [navigate, user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!user) return undefined;
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load, user]);
  useApiInvalidation(load, ["admin/notifications", "notifications", "messages", "teams", "tournaments", "matches", "prizes"]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!boxRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const unread = useMemo(() => items.filter((item) => !item.read).length, [items]);
  const read = items.length - unread;
  const visibleItems = useMemo(() => {
    if (tab === "unread") return items.filter((item) => !item.read);
    if (tab === "read") return items.filter((item) => item.read);
    return items;
  }, [items, tab]);

  if (!user) return null;

  const markRead = async (item) => {
    if (!item || item.read) return;
    setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, read: true } : row));
    try { await api.post(`/admin/notifications/${item.id}/read`); } catch {}
  };

  const markAllRead = async () => {
    setItems((rows) => rows.map((row) => ({ ...row, read: true })));
    setTab("all");
    try { await api.post("/admin/notifications/read-all"); } catch {}
  };

  const deleteItem = async (item) => {
    setItems((rows) => rows.filter((row) => row.id !== item.id));
    try { await api.delete(`/admin/notifications/${item.id}`); } catch { load(); }
  };

  const deleteRead = async () => {
    setItems((rows) => rows.filter((row) => !row.read));
    setTab("unread");
    try { await api.delete("/admin/notifications/read"); } catch { load(); }
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        data-testid="notification-bell"
        className={`relative w-10 h-10 inline-flex items-center justify-center border rounded-sm transition ${
          unread ? "border-[#29B6E8]/50 text-[#29B6E8] bg-[#29B6E8]/10" : "border-white/10 text-white/70 hover:text-white hover:border-white/25"
        }`}
        aria-label="Benachrichtigungen"
        aria-expanded={open}
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-sm bg-[#FF3B30] text-white text-[10px] font-black inline-flex items-center justify-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-x-2 top-16 z-[70] sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[24rem] max-h-[calc(100vh-5rem)] border border-white/10 bg-[#0F0F10] rounded-sm shadow-2xl shadow-black/70 overflow-hidden flex flex-col">
          <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">Inbox</div>
              <div className="font-heading font-black uppercase text-sm truncate">Benachrichtigungen</div>
              <div className="mt-0.5 text-[11px] text-white/40">{unread} ungelesen · {read} gelesen</div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {unread > 0 && (
                <button type="button" onClick={markAllRead} className="p-2 text-white/45 hover:text-[#29B6E8]" title="Alle als gelesen markieren">
                  <Check className="w-4 h-4" />
                </button>
              )}
              {read > 0 && (
                <button type="button" onClick={deleteRead} className="p-2 text-white/45 hover:text-[#FF3B30]" title="Gelesene löschen">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} className="p-2 text-white/45 hover:text-white" title="Schließen">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="shrink-0 grid grid-cols-3 gap-1 p-2 border-b border-white/10">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`px-2 py-2 rounded-sm text-[10px] font-bold uppercase tracking-wider transition ${
                  tab === key ? "bg-[#29B6E8] text-black" : "border border-white/10 text-white/55 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {visibleItems.length === 0 ? (
              <div className="px-4 py-10 text-center text-white/40">
                <Inbox className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <div className="text-sm">{tab === "unread" ? "Keine ungelesenen Benachrichtigungen." : "Keine Benachrichtigungen."}</div>
              </div>
            ) : (
              visibleItems.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  onRead={markRead}
                  onDelete={deleteItem}
                  onClose={() => setOpen(false)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationRow({ item, onRead, onDelete, onClose }) {
  const content = (
    <div className="flex items-start gap-2 min-w-0">
      {!item.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-[#29B6E8] shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="font-bold text-sm text-white line-clamp-2">{item.title || "Benachrichtigung"}</div>
        {item.body && <div className="mt-0.5 text-xs text-white/55 line-clamp-3">{item.body}</div>}
        <div className="mt-1 text-[10px] uppercase tracking-widest text-white/30">{notificationDate(item.created_at)}</div>
      </div>
    </div>
  );
  const className = `block flex-1 min-w-0 px-4 py-3 text-left transition ${item.read ? "hover:bg-white/[0.03]" : "bg-[#29B6E8]/5 hover:bg-[#29B6E8]/10"}`;
  return (
    <div className="group border-b border-white/5 flex items-stretch">
      {item.url ? (
        <Link to={item.url} onClick={() => { onRead(item); onClose(); }} className={className}>
          {content}
        </Link>
      ) : (
        <button type="button" onClick={() => onRead(item)} className={`w-full ${className}`}>
          {content}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDelete(item)}
        className="w-11 shrink-0 inline-flex items-center justify-center text-white/25 hover:text-[#FF3B30] hover:bg-[#FF3B30]/10 border-l border-white/5"
        title="Benachrichtigung löschen"
        aria-label="Benachrichtigung löschen"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

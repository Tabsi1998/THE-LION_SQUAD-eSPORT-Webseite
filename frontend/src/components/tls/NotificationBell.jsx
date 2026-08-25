import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, Check, Inbox, Trash2, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { refreshCrowns } from "@/components/tls/LevelAvatarFrame";
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

function isExternalUrl(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

const CROWN_KINDS = new Set(["crown_gained", "crown_lost", "crown_changed"]);

function handleCrownNotifications(rows, userId) {
  const crownRows = rows.filter((item) => !item.read && CROWN_KINDS.has(item.kind));
  if (!crownRows.length) return;
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem("tls-crowns-celebrated") || "[]"); } catch {}
  const fresh = crownRows.filter((item) => item.kind === "crown_gained" && item.id && !seen.includes(item.id));
  refreshCrowns().then((crowns) => {
    if (!fresh.length) return;
    const current = userId ? (crowns || {})[userId] : null;
    fresh.forEach((item) => {
      seen.push(item.id);
      // only celebrate if the user still holds a crown right now (skip stale wins)
      if (!current) return;
      const variant = ["gold", "silver", "bronze"].includes(current) ? current : (item.meta?.variant || "gold");
      window.dispatchEvent(new CustomEvent("tls-crown-celebration", {
        detail: { id: item.id, variant, title: item.title, body: item.body },
      }));
    });
    try { localStorage.setItem("tls-crowns-celebrated", JSON.stringify(seen.slice(-50))); } catch {}
  });
}

export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("unread");
  const [items, setItems] = useState([]);
  const [shake, setShake] = useState(false);
  const boxRef = useRef(null);
  const knownIdsRef = useRef(new Set());
  const didPrimeRef = useRef(false);

  const openUrl = useCallback((url) => {
    if (!url) return;
    if (isExternalUrl(url)) {
      window.location.href = url;
      return;
    }
    navigate(url);
  }, [navigate]);

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
      handleCrownNotifications(rows, user?.id);
      if (didPrimeRef.current) {
        const freshRows = rows.filter((item) => !item.read && item.id && !knownIdsRef.current.has(item.id));
        if (freshRows.length) {
          setShake(true);
          setTimeout(() => setShake(false), 1900);
        }
        freshRows
          .slice(0, 4)
          .forEach((item) => {
            toast.info(item.title || "Benachrichtigung", {
              description: item.body || "Neue Benachrichtigung.",
              duration: 15000,
              action: item.url ? {
                label: "Öffnen",
                onClick: async () => {
                  try { await api.post(`/admin/notifications/${item.id}/read`); } catch {}
                  openUrl(item.url);
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
  }, [openUrl, user]);

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
        <Bell className={`w-4 h-4 ${shake ? "tls-bell-shake" : ""}`} />
        <AnimatePresence>
          {unread > 0 && (
            <motion.span
              key={unread}
              data-testid="notification-unread-badge"
              className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-sm bg-[#FF3B30] text-white text-[10px] font-black inline-flex items-center justify-center"
              aria-label={`${unread > 99 ? "99+" : unread} ungelesene Benachrichtigungen`}
              initial={{ scale: 0, rotate: -18 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 16 }}
            >
              {unread > 99 ? "99+" : unread}
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-x-2 top-16 z-[70] sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[24rem] max-h-[calc(100vh-5rem)] border border-white/10 bg-[#0F0F10] rounded-sm shadow-2xl shadow-black/70 overflow-hidden flex flex-col"
            initial={{ opacity: 0, y: -10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
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

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" aria-live="polite" aria-label="Benachrichtigungsliste">
            {visibleItems.length === 0 ? (
              <div className="px-4 py-10 text-center text-white/40">
                <Inbox className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <div className="text-sm">{tab === "unread" ? "Keine ungelesenen Benachrichtigungen." : "Keine Benachrichtigungen."}</div>
              </div>
            ) : (
              visibleItems.map((item, index) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  index={index}
                  onRead={markRead}
                  onDelete={deleteItem}
                  onClose={() => setOpen(false)}
                />
              ))
            )}
          </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NotificationRow({ item, index = 0, onRead, onDelete, onClose }) {
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
  const handleOpen = () => {
    onRead(item);
    onClose();
  };
  return (
    <motion.div
      data-testid={`notification-row-${item.id}`}
      className="group border-b border-white/5 flex items-stretch"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.045, 0.4), duration: 0.2, ease: "easeOut" }}
    >
      {item.url && isExternalUrl(item.url) ? (
        <a href={item.url} onClick={handleOpen} className={className}>
          {content}
        </a>
      ) : item.url ? (
        <Link to={item.url} onClick={handleOpen} className={className}>
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
    </motion.div>
  );
}

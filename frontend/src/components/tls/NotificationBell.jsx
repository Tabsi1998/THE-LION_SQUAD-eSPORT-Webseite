import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Check, Inbox, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

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
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const boxRef = useRef(null);

  const load = useCallback(async () => {
    if (!user) {
      setItems([]);
      return;
    }
    try {
      const { data } = await api.get("/admin/notifications");
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setItems([]);
    }
  }, [user]);

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
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const unread = useMemo(() => items.filter((item) => !item.read).length, [items]);
  if (!user) return null;

  const markRead = async (item) => {
    if (!item || item.read) return;
    setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, read: true } : row));
    try { await api.post(`/admin/notifications/${item.id}/read`); } catch {}
  };

  const markAllRead = async () => {
    setItems((rows) => rows.map((row) => ({ ...row, read: true })));
    try { await api.post("/admin/notifications/read-all"); } catch {}
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
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-[70] w-[min(22rem,calc(100vw-1rem))] border border-white/10 bg-[#0F0F10] rounded-sm shadow-2xl shadow-black/60 overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">Inbox</div>
              <div className="font-heading font-black uppercase text-sm">Benachrichtigungen</div>
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button type="button" onClick={markAllRead} className="p-2 text-white/45 hover:text-[#29B6E8]" title="Alle als gelesen markieren">
                  <Check className="w-4 h-4" />
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} className="p-2 text-white/45 hover:text-white" title="Schließen">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-white/40">
                <Inbox className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <div className="text-sm">Keine Benachrichtigungen.</div>
              </div>
            ) : (
              items.slice(0, 12).map((item) => {
                const content = (
                  <>
                    <div className="flex items-start gap-2">
                      {!item.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-[#29B6E8] shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-sm text-white truncate">{item.title || "Benachrichtigung"}</div>
                        {item.body && <div className="mt-0.5 text-xs text-white/55 line-clamp-2">{item.body}</div>}
                        <div className="mt-1 text-[10px] uppercase tracking-widest text-white/30">{notificationDate(item.created_at)}</div>
                      </div>
                    </div>
                  </>
                );
                const className = `block px-4 py-3 border-b border-white/5 text-left transition ${item.read ? "hover:bg-white/[0.03]" : "bg-[#29B6E8]/5 hover:bg-[#29B6E8]/10"}`;
                return item.url ? (
                  <Link key={item.id} to={item.url} onClick={() => { markRead(item); setOpen(false); }} className={className}>
                    {content}
                  </Link>
                ) : (
                  <button key={item.id} type="button" onClick={() => markRead(item)} className={`w-full ${className}`}>
                    {content}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { Bell, Check, Inbox, Trash2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { NotificationRow } from "@/components/tls/NotificationRow";
import { useNotificationFeed } from "@/hooks/useNotificationFeed";

const TABS = [
  ["unread", "Ungelesen"],
  ["all", "Alle"],
  ["read", "Gelesen"],
];

// Die Benachrichtigungsseite (#255): dieselben Bündel wie in der Glocke, nur
// mit Platz. Das Dashboard verlinkt hierher („Alle N anzeigen“).
export default function NotificationsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState("all");
  const feed = useNotificationFeed({ enabled: Boolean(user) });
  const { bundles, unread, read } = feed;

  const visible = useMemo(() => {
    if (tab === "unread") return bundles.filter((bundle) => !bundle.read);
    if (tab === "read") return bundles.filter((bundle) => bundle.read);
    return bundles;
  }, [bundles, tab]);

  return (
    <PublicLayout>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12" data-testid="notifications-page">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Mein Bereich</span>
            <h1 className="mt-2 font-heading text-3xl md:text-4xl font-black uppercase flex items-center gap-3"><Bell className="w-6 h-6 text-[#29B6E8]" /> Benachrichtigungen</h1>
            <p className="mt-1 text-sm text-white/50">{unread} ungelesen · {read} gelesen. Ein Klick öffnet das Ziel und markiert als gelesen.</p>
          </div>
          <div className="flex items-center gap-2">
            {unread > 0 ? (
              <button type="button" onClick={feed.markAllRead} data-testid="notifications-mark-all-read" className="inline-flex items-center gap-1.5 px-3 py-2 border border-[#29B6E8]/40 text-[#29B6E8] rounded-sm text-[11px] font-bold uppercase tracking-wider hover:bg-[#29B6E8]/10">
                <Check className="w-3.5 h-3.5" /> Alle als gelesen markieren
              </button>
            ) : null}
            {read > 0 ? (
              <button type="button" onClick={feed.deleteRead} className="inline-flex items-center gap-1.5 px-3 py-2 border border-white/15 text-white/60 rounded-sm text-[11px] font-bold uppercase tracking-wider hover:text-[#FF3B30] hover:border-[#FF3B30]/40">
                <Trash2 className="w-3.5 h-3.5" /> Gelesene löschen
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-1 max-w-sm">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-2 py-2 rounded-sm text-[10px] font-bold uppercase tracking-wider transition ${tab === key ? "bg-[#29B6E8] text-black" : "border border-white/10 text-white/55 hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4 border border-white/10 rounded-sm bg-[#0F0F10] overflow-hidden">
          {visible.length === 0 ? (
            <div className="px-4 py-14 text-center text-white/40">
              <Inbox className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <div className="text-sm">{tab === "unread" ? "Keine ungelesenen Benachrichtigungen." : "Keine Benachrichtigungen."}</div>
            </div>
          ) : (
            visible.map((bundle) => (
              <NotificationRow key={bundle.id} bundle={bundle} onOpen={feed.markRead} onDelete={feed.deleteBundle} testIdPrefix="notifications-row" />
            ))
          )}
        </div>
      </div>
    </PublicLayout>
  );
}

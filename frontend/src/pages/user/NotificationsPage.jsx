import { useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Check, Inbox, Settings, Trash2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { NotificationGroupedList } from "@/components/tls/NotificationGroupedList";
import { useNotificationFeed } from "@/hooks/useNotificationFeed";
import { LoadNotice, LoadState } from "@/components/tls/LoadState";
import { SkeletonList } from "@/components/tls/Skeleton";
import { ShortCaps } from "@/components/tls/ShortCaps";

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
  const { items, unread, read } = feed;

  return (
    <PublicLayout>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12" data-testid="notifications-page">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <span className="tls-type-label text-[#29B6E8]">Mein Bereich</span>
            <h1 className="mt-2 tls-type-title flex items-center gap-3"><Bell className="w-6 h-6 text-[#29B6E8] shrink-0" /> <span className="min-w-0"><ShortCaps>Benachrichti&shy;gungen</ShortCaps></span></h1>
            <p className="mt-1 tls-type-small text-white/50">{unread} ungelesen · {read} gelesen. Ein Klick öffnet das Ziel und markiert als gelesen.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/mein-bereich/benachrichtigungen" data-testid="notifications-settings-link" className="tls-btn tls-btn--quiet inline-flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-sm tls-type-label">
              <Settings className="w-3.5 h-3.5" /> Einstellen
            </Link>
            {unread > 0 ? (
              <button type="button" onClick={feed.markAllRead} data-testid="notifications-mark-all-read" className="inline-flex items-center gap-1.5 px-3 py-2 border border-[#29B6E8]/40 text-[#29B6E8] rounded-sm tls-type-label hover:bg-[#29B6E8]/10">
                <Check className="w-3.5 h-3.5" /> Alle als gelesen markieren
              </button>
            ) : null}
            {read > 0 ? (
              <button type="button" onClick={feed.deleteRead} className="inline-flex items-center gap-1.5 px-3 py-2 border border-white/15 text-white/60 rounded-sm tls-type-label hover:text-[#FF3B30] hover:border-[#FF3B30]/40">
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
              className={`px-2 py-2 rounded-sm tls-type-label transition ${tab === key ? "bg-[#29B6E8] text-black" : "border border-white/10 text-white/55 hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {feed.actionError && (
          <LoadNotice testId="notifications-action-error" className="mt-4" message={feed.actionError.message} onRetry={feed.actionError.retry} />
        )}

        {/* Ein Ladefehler ist kein „Keine Benachrichtigungen.“ (#984). */}
        <div className="mt-4">
          <LoadState
            load={feed.feed}
            loading={<SkeletonList rows={4} label="Lade Benachrichtigungen" />}
            errorTitle="Benachrichtigungen konnten nicht geladen werden"
            empty={<NoNotifications tab={tab} />}
          >
            {() => (
              <div className="border border-white/10 rounded-sm bg-[#0F0F10] overflow-hidden">
                {/* Nach Tagen und Themen, Gleichartiges gebündelt (#1205). */}
                <NotificationGroupedList
                  rows={items}
                  tab={tab}
                  onOpen={feed.markRead}
                  onDelete={feed.deleteBundle}
                  pendingIds={feed.pendingIds}
                  testIdPrefix="notifications-row"
                  emptyText={tab === "unread" ? "Keine ungelesenen Benachrichtigungen." : "Keine Benachrichtigungen."}
                  testId="notifications-groups"
                />
              </div>
            )}
          </LoadState>
        </div>
      </div>
    </PublicLayout>
  );
}

function NoNotifications({ tab }) {
  return (
    <div className="px-4 py-14 text-center text-white/40">
      <Inbox className="w-8 h-8 mx-auto mb-2 opacity-50" />
      <div className="tls-type-small">{tab === "unread" ? "Keine ungelesenen Benachrichtigungen." : "Keine Benachrichtigungen."}</div>
    </div>
  );
}

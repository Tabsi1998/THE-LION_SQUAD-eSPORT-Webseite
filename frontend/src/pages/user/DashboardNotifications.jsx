import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { NotificationRow } from "@/components/tls/NotificationRow";
import { LoadNotice, LoadStaleNotice } from "@/components/tls/LoadState";
import { useNotificationFeed } from "@/hooks/useNotificationFeed";

// Der Kasten „Benachrichtigungen“ im Dashboard (#255): die fünf neuesten Bündel, anklickbar; „Alle N anzeigen“ führt
// auf die Benachrichtigungsseite. Seit dem Rest aus #1543 über denselben Baustein wie Glocke und Seite: ein Ladefehler
// ist ein Fehler mit „Nochmal versuchen“, kein „Keine Benachrichtigungen.“ (#984); „gelesen“ setzt sofort, was der
// Server ablehnt, wird wieder ungelesen und steht mit „Nochmal versuchen“ da (#987).
export function DashboardNotifications() {
  const feed = useNotificationFeed();
  const { items, bundles, status, problem, pendingIds, actionError } = feed;
  const shown = useMemo(() => bundles.slice(0, 5), [bundles]);

  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] p-5 min-w-0" data-testid="dashboard-notifications">
      <h2 className="font-heading text-xl font-bold uppercase mb-4 flex items-center gap-2"><Bell className="w-4 h-4 text-[#29B6E8]" /> Benachrichtigungen</h2>
      {actionError ? (
        <LoadNotice testId="dashboard-notifications-action-error" className="mb-3" message={actionError.message} onRetry={actionError.retry} />
      ) : null}
      <LoadStaleNotice load={feed.feed} className="mb-3" />
      {status === "error" ? (
        <LoadNotice
          testId="dashboard-notifications-error"
          message={problem === "offline" ? "Ohne Netz. Die Benachrichtigungen laden, sobald das Netz wieder da ist." : "Die Benachrichtigungen konnten nicht geladen werden."}
          onRetry={feed.load}
        />
      ) : (
        <div id="dashboard-notification-list" className="-mx-2 border border-white/5 rounded-sm bg-[#0F0F10] overflow-hidden" aria-busy={status === "loading" || undefined}>
          {status === "loading" || status === "idle" ? <div className="p-3 text-sm text-white/40" role="status">Lade Benachrichtigungen …</div> : null}
          {status === "empty" ? <div className="p-3 text-sm text-white/40">Keine Benachrichtigungen.</div> : null}
          {shown.map((bundle) => (
            <NotificationRow
              key={bundle.id}
              bundle={bundle}
              onOpen={feed.markRead}
              compact
              testIdPrefix="dashboard-notification"
              pending={bundle.ids.some((id) => pendingIds.has(id))}
            />
          ))}
        </div>
      )}
      {items.length > shown.length && (
        <Link to="/notifications" data-testid="dashboard-notifications-all" className="mt-4 min-h-11 w-full inline-flex items-center justify-center border border-[#29B6E8]/40 rounded-sm px-3 py-2 text-sm font-bold text-[#29B6E8] hover:bg-[#29B6E8]/10">
          {`Alle ${items.length} anzeigen`}
        </Link>
      )}
    </div>
  );
}

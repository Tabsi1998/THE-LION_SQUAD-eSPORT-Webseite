import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Badge } from "@/components/achievements/Badge";
import { isExternalUrl, previewText } from "@/lib/notifications";
import { viennaDateTime } from "@/lib/vienna";

// Eine Benachrichtigung (oder ein Bündel) als anklickbare Zeile (#255):
// Titel, eine Zeile Vorschau, Zeit. Der Klick führt ans Ziel und meldet
// „geöffnet“, damit der Aufrufer sie als gelesen markiert. Glocke, Dashboard
// und Benachrichtigungsseite nutzen dieselbe Zeile.
export function notificationDate(value) {
  if (!value) return "";
  try {
    return viennaDateTime(value, { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "";
  }
}

/** Das Abzeichen eines Erfolgs-Pakets (#622): das wertvollste Material mit seinem Motiv - sonst nichts. */
export function notificationBadge(bundle) {
  const top = bundle?.kind === "achievement" ? bundle?.meta?.top : null;
  return top?.material ? top : null;
}

/**
 * „Stimmt“ direkt in der Glocke (#1159): die Gegenseite hat ein Ergebnis gemeldet - ein Klick schickt dieselbe Meldung
 * noch einmal, der Server entscheidet wie bei zwei gleichen Meldungen. „Stimmt nicht“ geht über die Matchseite.
 */
function ConfirmResultButton({ bundle, onDone, testId }) {
  const [busy, setBusy] = useState(false);
  const results = bundle?.meta?.confirm_results;
  const matchId = bundle?.meta?.match_id;
  if (bundle?.kind !== "match_report" || bundle.read || !Array.isArray(results) || !results.length || !matchId) return null;
  const confirm = async () => {
    setBusy(true);
    try {
      await api.post(`/matches/${matchId}/report`, { results, screenshot_url: null, note: null });
      toast.success("Bestätigt – das Ergebnis gilt.");
      onDone?.(bundle);
    } catch (error) {
      toast.error(formatApiError(error?.response?.data?.detail) || "Bestätigen hat nicht geklappt – bitte auf der Matchseite.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" disabled={busy} onClick={confirm} className="tls-btn tls-btn--primary shrink-0 self-center mx-2 inline-flex min-h-[36px] items-center gap-1 px-3 py-1 rounded-sm text-[10px] uppercase tracking-wider font-bold disabled:opacity-50" data-testid={testId}>
      <Check className="w-3 h-3" /> Stimmt
    </button>
  );
}

// `pending` (#987): „gelesen“ ist unterwegs - die Zeile ist kenntlich, bis der Server es bestätigt oder ablehnt.
export function NotificationRow({ bundle, onOpen, onDelete, compact = false, testIdPrefix = "notification-row", pending = false }) {
  const badge = notificationBadge(bundle);
  const content = (
    <div className="flex items-start gap-2 min-w-0">
      {!bundle.read ? <span className="mt-1.5 w-2 h-2 rounded-full bg-[#29B6E8] shrink-0" aria-hidden="true" /> : null}
      {badge ? <Badge material={badge.material} level={badge.level} rank={badge.rank} art={badge.art} icon={badge.icon} size={compact ? "xs" : "sm"} className="shrink-0" title={badge.name} testId={`${testIdPrefix}-badge-${bundle.id}`} /> : null}
      <div className="min-w-0 flex-1">
        <div className={`font-bold text-sm text-white ${compact ? "line-clamp-1" : "line-clamp-2"}`}>{bundle.title}</div>
        {bundle.body ? (
          <div className="mt-0.5 text-xs text-white/55 truncate" data-testid={`${testIdPrefix}-preview-${bundle.id}`}>{previewText(bundle.body)}</div>
        ) : null}
        <div className="mt-1 text-[10px] uppercase tracking-widest text-white/30">
          {notificationDate(bundle.created_at)}
          {bundle.count > 1 ? ` · ${bundle.count} gebündelt` : ""}
        </div>
      </div>
    </div>
  );
  const className = `block flex-1 min-w-0 ${compact ? "px-3 py-2" : "px-4 py-3"} text-left transition ${bundle.read ? "hover:bg-white/[0.03]" : "bg-[#29B6E8]/5 hover:bg-[#29B6E8]/10"}`;
  const handleOpen = () => onOpen?.(bundle);
  const target = bundle.target;
  let link;
  if (target && isExternalUrl(target)) {
    link = <a href={target} onClick={handleOpen} className={className}>{content}</a>;
  } else if (target) {
    link = <Link to={target} onClick={handleOpen} className={className}>{content}</Link>;
  } else {
    link = <button type="button" onClick={handleOpen} className={`w-full ${className}`}>{content}</button>;
  }
  return (
    <div data-testid={`${testIdPrefix}-${bundle.id}`} aria-busy={pending || undefined} data-pending={pending ? "true" : undefined} className={`group border-b border-white/5 flex items-stretch transition-opacity ${pending ? "opacity-60" : ""}`}>
      {link}
      <ConfirmResultButton bundle={bundle} onDone={onOpen} testId={`${testIdPrefix}-confirm-${bundle.id}`} />
      {onDelete ? (
        <button
          type="button"
          onClick={() => onDelete(bundle)}
          className="w-11 shrink-0 inline-flex items-center justify-center text-white/25 hover:text-[#FF3B30] hover:bg-[#FF3B30]/10 border-l border-white/5"
          title="Benachrichtigung löschen"
          aria-label="Benachrichtigung löschen"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      ) : null}
    </div>
  );
}

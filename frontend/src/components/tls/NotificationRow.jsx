import { Link } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { isExternalUrl, previewText } from "@/lib/notifications";

// Eine Benachrichtigung (oder ein Bündel) als anklickbare Zeile (#255):
// Titel, eine Zeile Vorschau, Zeit. Der Klick führt ans Ziel und meldet
// „geöffnet“, damit der Aufrufer sie als gelesen markiert. Glocke, Dashboard
// und Benachrichtigungsseite nutzen dieselbe Zeile.
export function notificationDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "";
  }
}

export function NotificationRow({ bundle, onOpen, onDelete, compact = false, testIdPrefix = "notification-row" }) {
  const content = (
    <div className="flex items-start gap-2 min-w-0">
      {!bundle.read ? <span className="mt-1.5 w-2 h-2 rounded-full bg-[#29B6E8] shrink-0" aria-hidden="true" /> : null}
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
    <div data-testid={`${testIdPrefix}-${bundle.id}`} className="group border-b border-white/5 flex items-stretch">
      {link}
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

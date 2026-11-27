import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BellOff } from "lucide-react";
import { loadWebPushConfig, webPushBlocked } from "@/lib/webPush";

// Der leise Hinweis (#1208): Hat der Browser Benachrichtigungen für diese Website abgelehnt, steht auf Turnier- und
// Event-Seiten eine ruhige Zeile „Aufrufe sind aus – einschalten“ statt einer Frage bei jedem Öffnen. Sie führt zu
// Einstellungen → Benachrichtigungen; dort steht, wie man es in den Website-Einstellungen des Browsers erlaubt. Nur mit
// Konto und nur, wenn der Server Web-Push anbietet. Kommt man mit erlaubtem Browser zurück, ist die Zeile weg.
export const WEB_PUSH_OFF_TEXT = "Aufrufe sind aus";
export const WEB_PUSH_OFF_ACTION = "einschalten";
/** Der Link führt direkt zur Karte „Dieser Browser“ (BrowserPushCard), die erklärt, wie man es im Browser erlaubt. */
export const WEB_PUSH_OFF_LINK = "/mein-bereich/benachrichtigungen#dieser-browser";

// Die Einstellung des Servers ändert sich selten: einmal je Sitzung laden, nicht bei jedem Fokuswechsel.
let sessionConfig = null;
function webPushConfigOnce() {
  if (!sessionConfig) sessionConfig = loadWebPushConfig();
  return sessionConfig;
}

/** Nur für Tests: die gemerkte Einstellung vergessen. */
export function resetWebPushOffHintCache() {
  sessionConfig = null;
}

export function WebPushOffHint({ user, show = true, className = "", testId = "web-push-off" }) {
  const signedIn = Boolean(user?.id);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!signedIn || !show) {
      setVisible(false);
      return undefined;
    }
    let active = true;
    const check = () => {
      if (!webPushBlocked()) {
        if (active) setVisible(false);
        return;
      }
      void webPushConfigOnce().then((config) => { if (active) setVisible(Boolean(config?.enabled)); });
    };
    check();
    const onVisible = () => { if (!document.hidden) check(); };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [signedIn, show]);

  if (!visible) return null;
  return (
    <Link
      to={WEB_PUSH_OFF_LINK}
      data-testid={testId}
      aria-label={`${WEB_PUSH_OFF_TEXT} – ${WEB_PUSH_OFF_ACTION}`}
      className={`inline-flex items-center gap-2 min-h-[44px] px-3 py-2 border border-white/10 rounded-sm tls-type-small text-white/55 hover:text-white hover:border-white/25 ${className}`.trim()}
    >
      <BellOff className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>{WEB_PUSH_OFF_TEXT} – <span className="font-bold text-[#29B6E8]">{WEB_PUSH_OFF_ACTION}</span></span>
    </Link>
  );
}

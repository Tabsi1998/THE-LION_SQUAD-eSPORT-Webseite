import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, Share, X } from "lucide-react";
import { toast } from "sonner";
import { useOptionalAuth } from "@/context/AuthContext";
import { CALENDAR_HINT_CLOSED_EVENT, CALENDAR_HINT_EVENT } from "@/lib/calendarHint";
import { WEB_PUSH_EVENT, askState, enableWebPush, markVisit, offerWebPush, rememberAsk, syncWebPush } from "@/lib/webPush";

// Die Frage nach Browser-Benachrichtigungen (#1163): ein ruhiger Kasten unten wie der Abo-Hinweis (am Handy über der Leiste),
// erst nach einer Turnier- oder Event-Anmeldung und nie beim ersten Besuch (lib/webPush). Erst „Benachrichtigen“ ruft die
// Frage des Browsers auf - nie ohne Klick. Steht gerade der Abo-Hinweis da, wartet die Frage, bis er zu ist. Am iPhone ohne
// Home-Bildschirm steht statt der Frage, wie es geht. Mit „Bewegung reduzieren“ ohne Bewegung (index.css, .tls-push-hint).
export function WebPushHost() {
  const auth = useOptionalAuth();
  const user = auth?.user || null;
  const [request, setRequest] = useState(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const firstVisit = useRef(null);

  if (firstVisit.current === null) firstVisit.current = markVisit();

  useEffect(() => {
    const onCalendar = () => setCalendarOpen(true);
    const onCalendarClosed = () => setCalendarOpen(false);
    const onAsk = (event) => setRequest(event.detail || { mode: "ask" });
    window.addEventListener(CALENDAR_HINT_EVENT, onCalendar);
    window.addEventListener(CALENDAR_HINT_CLOSED_EVENT, onCalendarClosed);
    window.addEventListener(WEB_PUSH_EVENT, onAsk);
    return () => {
      window.removeEventListener(CALENDAR_HINT_EVENT, onCalendar);
      window.removeEventListener(CALENDAR_HINT_CLOSED_EVENT, onCalendarClosed);
      window.removeEventListener(WEB_PUSH_EVENT, onAsk);
    };
  }, []);

  // Mit Konto: die Anmeldung dieses Browsers auffrischen und eine aufgeschobene Frage beim nächsten Besuch stellen.
  const userId = user?.id || null;
  useEffect(() => {
    if (!userId) return;
    void syncWebPush({ id: userId }).catch(() => null);
    if (askState() === "pending" && !firstVisit.current) void offerWebPush(window, { firstVisit: false });
  }, [userId]);

  const open = Boolean(request && user && !calendarOpen);
  const mode = request?.mode;

  // Schließen ohne Zustimmung merkt sich die Seite - die Frage kommt nicht wieder (Einstellungen bleiben offen).
  const decline = useCallback(() => {
    rememberAsk(mode === "ios-hint" ? "asked" : "declined");
    setRequest(null);
  }, [mode]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (ev) => { if (ev.key === "Escape") decline(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, decline]);

  async function allow() {
    setBusy(true);
    const result = await enableWebPush(user, request?.config);
    setBusy(false);
    setRequest(null);
    if (result.ok) {
      toast.success("Browser-Benachrichtigungen sind an.", { description: "Was genau kommt, stellst du unter Einstellungen → Benachrichtigungen ein." });
    } else if (result.reason === "denied") {
      toast("Dein Browser hat abgelehnt.", { description: "Erlauben kannst du es in den Website-Einstellungen des Browsers und dann unter Einstellungen → Benachrichtigungen." });
    } else if (result.reason === "error" || result.reason === "no-worker") {
      toast.error("Das hat nicht geklappt. Versuch es unter Einstellungen → Benachrichtigungen noch einmal.");
    }
  }

  if (!open) return null;
  const ios = request.mode === "ios-hint";
  return (
    <section
      aria-labelledby="web-push-hint-title"
      data-testid="web-push-hint"
      className="tls-push-hint fixed z-[70] left-4 right-4 bottom-20 lg:bottom-6 lg:left-auto lg:right-6 lg:w-[380px] border border-[#29B6E8]/40 bg-[#121212]/95 backdrop-blur rounded-sm p-4 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.8)]"
    >
      <button type="button" onClick={decline} aria-label="Hinweis schließen" data-testid="web-push-hint-close" className="absolute top-2 right-2 w-9 h-9 inline-flex items-center justify-center text-white/45 hover:text-white rounded-sm">
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-start gap-3 pr-8">
        <span className="tls-push-hint__icon mt-0.5 shrink-0 text-[#29B6E8]" aria-hidden="true">
          {ios ? <Share className="w-5 h-5" /> : <BellRing className="w-5 h-5" />}
        </span>
        <div className="min-w-0">
          {ios ? (
            <>
              <h2 id="web-push-hint-title" className="text-sm font-bold">Aufrufe auch aufs iPhone?</h2>
              <p className="mt-1 text-xs text-white/60">
                Tippe in Safari auf <strong className="text-white/80">Teilen</strong> und dann auf <strong className="text-white/80">„Zum Home-Bildschirm“</strong>.
                Öffne die Website von dort – dann kann sie dir Aufrufe, Check-in und Turnier-Meldungen schicken.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <button type="button" onClick={decline} data-testid="web-push-hint-ok" className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm font-bold uppercase tracking-wider">
                  Verstanden
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 id="web-push-hint-title" className="text-sm font-bold">Bescheid sagen, wenn es losgeht?</h2>
              <p className="mt-1 text-xs text-white/60">
                Check-in offen, du bist dran, Ergebnis bestätigt – wir melden uns im Browser, auch wenn die Website zu ist.
                Was genau kommt, stellst du unter Einstellungen → Benachrichtigungen ein.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <button type="button" onClick={allow} disabled={busy} data-testid="web-push-hint-allow" className="tls-btn tls-btn--primary px-3 py-2 rounded-sm font-bold uppercase tracking-wider disabled:opacity-60">
                  {busy ? "Einen Moment …" : "Benachrichtigen"}
                </button>
                <button type="button" onClick={decline} disabled={busy} data-testid="web-push-hint-later" className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm font-bold uppercase tracking-wider">
                  Nicht jetzt
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

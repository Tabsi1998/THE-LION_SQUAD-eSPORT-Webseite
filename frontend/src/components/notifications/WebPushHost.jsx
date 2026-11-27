import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, CheckCircle2, Megaphone, Share, Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { useOptionalAuth } from "@/context/AuthContext";
import { StaggerIn } from "@/components/tls/motion";
import { CALENDAR_HINT_CLOSED_EVENT, CALENDAR_HINT_EVENT } from "@/lib/calendarHint";
import { WEB_PUSH_EVENT, askState, enableWebPush, markVisit, offerWebPush, rememberAsk, syncWebPush } from "@/lib/webPush";

// Die Frage nach Browser-Benachrichtigungen (#1163, #1208): ein ruhiger Kasten unten wie der Abo-Hinweis (am Handy über der
// Leiste), erst nach einer Turnier- oder Event-Anmeldung und nie beim ersten Besuch (lib/webPush). Zuerst die eigene
// Erklärung „Sollen wir dich rufen, wenn du dran bist?“ mit Aufruf, Check-in und Ergebnis; erst „Ja, rufen“ ruft die Frage
// des Browsers auf - nie ohne Klick. „Später“ fragt frühestens bei der nächsten Anmeldung wieder. Steht gerade der
// Abo-Hinweis da, wartet die Frage, bis er zu ist. Am iPhone ohne Home-Bildschirm steht statt der Frage einmal, wie es geht.
// Bewegung: der Kasten steigt auf, die Glocke schwingt einmal, die drei Zeilen staffeln - mit „Bewegung reduzieren“ nichts
// davon (index.css, .tls-push-hint; StaggerIn).
export const WEB_PUSH_TITLE = "Sollen wir dich rufen, wenn du dran bist?";
export const WEB_PUSH_LINES = [
  { icon: Megaphone, title: "Aufruf", text: "Du bist dran, dein Match geht los." },
  { icon: CheckCircle2, title: "Check-in", text: "Der Check-in ist offen." },
  { icon: Trophy, title: "Ergebnis", text: "Dein Ergebnis steht fest." },
];

/** Die Zeile über der Frage, je nach Anlass (#1208). */
export const WEB_PUSH_EYEBROW = { own: "Nach deiner Anmeldung", team: "Dein Team ist angemeldet" };

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
    // Kontowechsel oder Abmelden (#1208): eine offene Frage gehört dem vorigen Konto.
    setRequest(null);
    if (!userId) return;
    void syncWebPush({ id: userId }).catch(() => null);
    if (askState() === "pending" && !firstVisit.current) void offerWebPush(window, { firstVisit: false });
  }, [userId]);

  const open = Boolean(request && user && !calendarOpen);
  const mode = request?.mode;

  // „Später“ (oder Schließen): erst die nächste Anmeldung fragt wieder (#1208). Den Hinweis fürs iPhone gibt es nur einmal.
  const decline = useCallback(() => {
    rememberAsk(mode === "ios-hint" ? "ios-seen" : "later");
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
      <button type="button" onClick={decline} aria-label={ios ? "Hinweis schließen" : "Später"} data-testid="web-push-hint-close" className="absolute top-1 right-1 w-11 h-11 inline-flex items-center justify-center text-white/45 hover:text-white rounded-sm">
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-start gap-3 pr-9">
        <span className="tls-push-hint__icon mt-0.5 shrink-0 text-[#29B6E8]" aria-hidden="true">
          {ios ? <Share className="w-5 h-5" /> : <BellRing className="w-5 h-5" />}
        </span>
        <div className="min-w-0 flex-1">
          {ios ? (
            <>
              <h2 id="web-push-hint-title" className="tls-type-small font-bold">Aufrufe auch aufs iPhone?</h2>
              <p className="mt-1 tls-type-small text-white/60">
                Tippe in Safari auf <strong className="text-white/80">Teilen</strong> und dann auf <strong className="text-white/80">„Zum Home-Bildschirm“</strong>.
                Öffne die Website von dort – dann kann sie dir Aufrufe, Check-in und Turnier-Meldungen schicken.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 tls-type-small">
                <button type="button" onClick={decline} data-testid="web-push-hint-ok" className="tls-btn tls-btn--quiet min-h-[44px] px-4 py-2 rounded-sm font-bold uppercase tracking-wider">
                  Verstanden
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="tls-type-label text-brand" data-testid="web-push-hint-eyebrow">{WEB_PUSH_EYEBROW[request.reason] || WEB_PUSH_EYEBROW.own}</p>
              <h2 id="web-push-hint-title" className="mt-0.5 tls-type-small font-bold">{WEB_PUSH_TITLE}</h2>
              <StaggerIn as="ul" className="mt-2 space-y-1.5 tls-type-small" data-testid="web-push-hint-lines">
                {WEB_PUSH_LINES.map(({ icon: Icon, title, text }) => (
                  <li key={title} className="flex items-center gap-2 text-white/70" data-testid={`web-push-hint-line-${title}`}>
                    <Icon className="w-4 h-4 shrink-0 text-brand" aria-hidden="true" />
                    <span><strong className="text-white">{title}:</strong> {text}</span>
                  </li>
                ))}
              </StaggerIn>
              <p className="mt-2 tls-type-small text-white/50">
                Bei „Ja“ fragt dein Browser einmal nach der Erlaubnis. Was genau kommt, stellst du unter Einstellungen → Benachrichtigungen ein.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 tls-type-small">
                <button type="button" onClick={allow} disabled={busy} data-testid="web-push-hint-allow" className="tls-btn tls-btn--primary min-h-[44px] px-4 py-2 rounded-sm font-bold uppercase tracking-wider disabled:opacity-60">
                  {busy ? "Einen Moment …" : "Ja, rufen"}
                </button>
                <button type="button" onClick={decline} disabled={busy} data-testid="web-push-hint-later" className="tls-btn tls-btn--quiet min-h-[44px] px-4 py-2 rounded-sm font-bold uppercase tracking-wider">
                  Später
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

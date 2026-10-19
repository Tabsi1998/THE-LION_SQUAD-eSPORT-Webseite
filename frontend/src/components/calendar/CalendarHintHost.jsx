import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarPlus, X } from "lucide-react";
import { CALENDAR_HINT_EVENT, markCalendarHintSeen } from "@/lib/calendarHint";
import { MY_CALENDAR_PATH, SUBSCRIBE_ANCHOR } from "@/lib/myCalendar";

// Der Abo-Hinweis nach einer Anmeldung (#1788): ein ruhiger Kasten unten (am Handy über der Leiste), der sich leicht
// anhebt - mit „Bewegung reduzieren“ ohne Bewegung (index.css, .tls-cal-hint). Er bleibt, bis man ihn schließt oder dem
// Weg zum Abo folgt; beim Erscheinen merkt ihn der Server, damit er nur einmal kommt. Oben rechts bleiben die Meldungen.
export function CalendarHintHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => {
      setOpen(true);
      void markCalendarHintSeen();
    };
    window.addEventListener(CALENDAR_HINT_EVENT, show);
    return () => window.removeEventListener(CALENDAR_HINT_EVENT, show);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (ev) => { if (ev.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return (
    <section
      aria-labelledby="calendar-hint-title"
      data-testid="calendar-hint"
      className="tls-cal-hint fixed z-[70] left-4 right-4 bottom-20 lg:bottom-6 lg:left-auto lg:right-6 lg:w-[380px] border border-[#FFD700]/40 bg-[#121212]/95 backdrop-blur rounded-sm p-4 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.8)]"
    >
      <button type="button" onClick={() => setOpen(false)} aria-label="Hinweis schließen" data-testid="calendar-hint-close" className="absolute top-2 right-2 w-9 h-9 inline-flex items-center justify-center text-white/45 hover:text-white rounded-sm">
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-start gap-3 pr-8">
        <CalendarPlus className="mt-0.5 w-5 h-5 shrink-0 text-[#FFD700]" aria-hidden="true" />
        <div className="min-w-0">
          <h2 id="calendar-hint-title" className="text-sm font-bold">Deine Termine automatisch im Kalender?</h2>
          <p className="mt-1 text-xs text-white/60">Einmal abonnieren – danach erscheint jede Anmeldung von selbst in Google, Apple oder Outlook.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Link to={`${MY_CALENDAR_PATH}#${SUBSCRIBE_ANCHOR}`} onClick={() => setOpen(false)} data-testid="calendar-hint-go" className="tls-btn tls-btn--honor px-3 py-2 rounded-sm font-bold uppercase tracking-wider">
              Einmal abonnieren
            </Link>
            <button type="button" onClick={() => setOpen(false)} data-testid="calendar-hint-later" className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm font-bold uppercase tracking-wider">
              Nicht jetzt
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

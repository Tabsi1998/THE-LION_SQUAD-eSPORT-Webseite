import { useEffect, useRef, useState } from "react";
import { CalendarPlus, ChevronDown, Download, ExternalLink, X } from "lucide-react";
import { downloadIcs, googleCalendarUrl, outlookCalendarUrl, serverIcsPath } from "@/lib/calendarLinks";

// Ein Knopf „In den Kalender“ (#1272, vorher bis zu neun Links): ein Tipp öffnet ein kleines Menü - oben die
// Kalender-Datei (ICS vom Server; am Handy die richtige Wahl für den Handy-Kalender, mit Erinnerung eine Stunde
// vorher), darunter Google und Outlook. Bei mehreren Tagen wählt man „Alle Tage“ oder einen Tag; Google und Outlook
// nehmen je einen Termin, deshalb stehen sie nur bei einem Tag. Am Handy ist das Menü ein Blatt von unten, ab 640 px
// klappt es unter dem Knopf auf. Esc und ein Tipp daneben schließen es. Derselbe Knopf steht an Events, Turnieren,
// Fast Laps, Versammlungen und den eigenen Helferschichten.

export function dayCalendarItem(item, day, count) {
  return { ...item, title: `${item.title} – Tag ${day.index}/${count}${day.title ? ` · ${day.title}` : ""}`, start: day.start_at, end: day.end_at };
}

const DEVICES = "Handy-Kalender, Apple, Outlook-App, Thunderbird";

export function AddToCalendar({ item, days = null, className = "", block = false, testId = "add-to-calendar" }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState("all");
  const rootRef = useRef(null);
  const multi = Array.isArray(days) && days.length > 1;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setOpen(false); };
    const onDown = (event) => { if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  if (!item?.start) return null;
  const chosen = multi && scope !== "all" ? days.find((day) => day.index === scope) : null;
  const target = chosen ? dayCalendarItem(item, chosen, days.length) : item;
  const single = !multi || Boolean(chosen);
  const ics = serverIcsPath(item, chosen ? { day: chosen.index } : {});
  const icsLabel = multi && !chosen ? `Kalender-Datei mit allen ${days.length} Tagen` : "Kalender-Datei";
  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className={`relative ${block ? "w-full" : "inline-block"} ${className}`} data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid={`${testId}-button`}
        className={`tls-btn tls-btn--secondary inline-flex items-center justify-center gap-2 px-4 py-2 text-xs uppercase tracking-wider font-bold rounded-sm ${block ? "w-full" : ""}`}
      >
        <CalendarPlus className="w-4 h-4" /> In den Kalender <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60 sm:hidden" aria-hidden="true" onClick={close} />
          <div
            role="dialog"
            aria-label="In den Kalender"
            data-testid={`${testId}-menu`}
            className="fixed inset-x-0 bottom-0 z-50 sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 w-full sm:w-80 bg-[#0F0F10] border-t sm:border border-white/10 rounded-t-md sm:rounded-sm shadow-2xl shadow-black/60 p-4 pb-6 sm:pb-4 text-left normal-case tracking-normal"
          >
            <div className="flex items-center justify-between gap-3 sm:hidden mb-3">
              <span className="font-heading font-black uppercase">In den Kalender</span>
              <button type="button" onClick={close} aria-label="Schließen" className="p-2 text-white/60 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            {multi && (
              <div className="mb-3" role="group" aria-label="Welche Tage">
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 mb-1.5">Welche Tage</div>
                <div className="flex flex-wrap gap-1.5">
                  <ScopeChip active={scope === "all"} onClick={() => setScope("all")} testId={`${testId}-scope-all`}>Alle {days.length} Tage</ScopeChip>
                  {days.map((day) => (
                    <ScopeChip key={day.index} active={scope === day.index} onClick={() => setScope(day.index)} testId={`${testId}-scope-${day.index}`}>{day.label || `Tag ${day.index}`}</ScopeChip>
                  ))}
                </div>
              </div>
            )}
            <ul className="space-y-1">
              <li>
                {ics ? (
                  <a href={ics} download onClick={close} className="flex items-start gap-3 rounded-sm p-2 hover:bg-white/[0.06]" data-testid={`${testId}-ics`}>
                    <Download className="w-4 h-4 mt-0.5 text-[#29B6E8] shrink-0" />
                    <span><span className="block text-sm font-bold text-white">{icsLabel}</span><span className="block text-xs text-white/50">{DEVICES}</span></span>
                  </a>
                ) : (
                  <button type="button" onClick={() => { downloadIcs(target); close(); }} className="w-full text-left flex items-start gap-3 rounded-sm p-2 hover:bg-white/[0.06]" data-testid={`${testId}-ics`}>
                    <Download className="w-4 h-4 mt-0.5 text-[#29B6E8] shrink-0" />
                    <span><span className="block text-sm font-bold text-white">{icsLabel}</span><span className="block text-xs text-white/50">{DEVICES}</span></span>
                  </button>
                )}
              </li>
              {single ? (
                <>
                  <li>
                    <a href={googleCalendarUrl(target)} target="_blank" rel="noreferrer" onClick={close} className="flex items-center gap-3 rounded-sm p-2 text-sm text-white/85 hover:bg-white/[0.06]" data-testid={`${testId}-google`}>
                      <ExternalLink className="w-4 h-4 text-white/45 shrink-0" /> Google Kalender
                    </a>
                  </li>
                  <li>
                    <a href={outlookCalendarUrl(target)} target="_blank" rel="noreferrer" onClick={close} className="flex items-center gap-3 rounded-sm p-2 text-sm text-white/85 hover:bg-white/[0.06]" data-testid={`${testId}-outlook`}>
                      <ExternalLink className="w-4 h-4 text-white/45 shrink-0" /> Outlook
                    </a>
                  </li>
                </>
              ) : (
                <li className="px-2 pt-1 text-xs text-white/45" data-testid={`${testId}-pick-day`}>Google und Outlook nehmen je einen Termin – wähle oben einen Tag.</li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function ScopeChip({ active, onClick, testId, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={`rounded-sm px-2.5 py-1 text-xs font-bold transition ${active ? "bg-[#29B6E8] text-black" : "bg-white/[0.06] text-white/75 hover:text-white"}`}
    >
      {children}
    </button>
  );
}

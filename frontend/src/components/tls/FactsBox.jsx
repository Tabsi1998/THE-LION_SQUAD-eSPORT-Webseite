import { Backpack, CalendarDays, Info, MapPin, Navigation, Ticket } from "lucide-react";

// Fakten-Kasten (#1346): Wann, Wo, Eintritt, Mitbringen - je eine Zeile mit Symbol, darunter die Knöpfe („Anmelden“
// bzw. der eigene Stand und „In den Kalender“). Eine ruhige Fläche ohne Kästen darin. Wo er steht, regelt die Seite:
// am Handy direkt unter dem Titel, am PC rechts und beim Scrollen stehend. Derselbe Baustein ist für die Turnierseite
// („Vor Ort“) und Versammlungen gedacht - die Zeilen kommen fertig vom Aufrufer (lib/eventPage.js → eventFacts).

const ICONS = { when: CalendarDays, where: MapPin, entry: Ticket, bring: Backpack };

export function FactsBox({ rows = [], children = null, className = "", testId = "facts-box" }) {
  if (!rows.length && !children) return null;
  return (
    <section aria-label="Auf einen Blick" className={`rounded-sm border border-white/10 bg-[#121214] ${className}`} data-testid={testId}>
      <dl>
        {rows.map((row, index) => {
          const Icon = row.icon || ICONS[row.key] || Info;
          return (
            <div key={row.key} className={`flex gap-3 px-4 py-3 ${index ? "border-t border-white/[0.07]" : ""}`} data-testid={`${testId}-${row.key}`}>
              <Icon className="w-4 h-4 mt-1 text-[#9F7AEA] shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <dt className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">{row.label}</dt>
                <dd className={`mt-0.5 text-sm font-bold break-words ${row.free ? "text-[#1FD08E]" : "text-white"}`}>{row.title}</dd>
                {(row.lines || []).map((line) => <dd key={line} className="text-xs text-white/60 break-words">{line}</dd>)}
                {row.hybrid ? <dd className="text-xs text-white/60">auch online</dd> : null}
                {row.route ? (
                  <dd className="mt-1">
                    <a href={row.route} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-[#29B6E8] hover:underline underline-offset-4" data-testid={`${testId}-route`}>
                      <Navigation className="w-3.5 h-3.5" aria-hidden="true" /> Route planen
                    </a>
                  </dd>
                ) : null}
              </div>
            </div>
          );
        })}
      </dl>
      {children ? <div className="border-t border-white/10 p-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1" data-testid={`${testId}-actions`}>{children}</div> : null}
    </section>
  );
}

import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useSeason } from "@/seasons/SeasonContext";
import { DoorGlyph, calendarEntry } from "@/seasons/adventCalendar";

// Hinweis auf den Adventkalender (#641) im Dashboard: nur solange der Kalender läuft und Türchen angelegt sind.
// Was die Person schon geöffnet hat, steht auf der Seite selbst - hier geht es nur um den Weg dorthin.

export function hintText(entry) {
  if (!entry) return "";
  if (entry.waiting) return `Das erste Türchen geht heute um ${entry.hour || 6} Uhr auf.`;
  if (entry.catchUp) return "Alle 24 Türchen sind offen – nachholen kannst du bis 6. Jänner.";
  return `Türchen ${entry.door} ist offen – schau hinein.`;
}

export function AdventHint() {
  const { byKey } = useSeason();
  const season = byKey?.advent_calendar;
  const entry = season && season.effective !== "off" ? calendarEntry(season) : null;
  if (!entry) return null;
  return (
    <div className="mb-8 flex flex-wrap items-center gap-4 rounded-sm border border-[#e9c46a]/30 bg-gradient-to-r from-[#e9c46a]/10 via-transparent to-transparent p-4 sm:p-5" data-testid="advent-hint" data-season-anchor="card">
      <span className={`tls-advcal tls-advcal--subtle shrink-0${entry.waiting ? " tls-advcal--waiting" : ""}`} aria-hidden="true"><DoorGlyph door={entry.door} /></span>
      <div className="min-w-[11rem] flex-1">
        <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#e9c46a]">Adventkalender</div>
        <div className="mt-0.5 text-sm text-white/80">{hintText(entry)}</div>
      </div>
      <Link to="/advent" className="inline-flex items-center gap-1.5 rounded-sm border border-[#e9c46a]/50 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[#e9c46a] transition hover:bg-[#e9c46a]/10" data-testid="advent-hint-link">
        Zum Kalender <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

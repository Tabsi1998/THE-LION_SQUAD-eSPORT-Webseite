// Was die Leitung entscheiden muss (#2194): Turniere nach ihrem Ende noch auf „Live“ und überfällige Liga-Spiele (nie
// gemeldet, Termin lange vorbei). Steht auf „Mein Dienst“ und oben auf der Startseite der Verwaltung, mit direktem Weg.
import { Link } from "react-router-dom";
import { AlarmClock, ArrowRight, Flag } from "lucide-react";
import { endedLiveText } from "@/lib/endedLive";
import { shortWhen } from "@/lib/leagueSchedule";

export function hasDutyAttention(duty) {
  return Boolean((duty?.ended_live || []).length || (duty?.overdue_matches || []).length);
}

export function DutyAttention({ duty, testId = "duty-attention" }) {
  const ended = duty?.ended_live || [];
  const overdue = duty?.overdue_matches || [];
  if (!ended.length && !overdue.length) return null;
  return (
    <ul className="space-y-2" data-testid={testId}>
      {ended.map((row) => (
        <li key={`ended-${row.id}`} className="rounded-sm border border-warn/40 bg-[#121212] p-4 md:flex md:items-center md:gap-4" data-testid={`duty-ended-${row.id}`}>
          <Flag className="hidden h-5 w-5 shrink-0 text-warn md:block" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="font-heading font-bold text-white [overflow-wrap:anywhere]">{row.title}</div>
            <div className="mt-1 text-sm text-white/70">{endedLiveText(row)}</div>
          </div>
          <Link to={row.admin_url} data-testid={`duty-ended-open-${row.id}`}
            className="tls-btn tls-btn--secondary mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider md:mt-0 md:w-auto">
            {Number(row.open_matches || 0) > 0 ? "Turnier öffnen" : "Beenden"} <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </li>
      ))}
      {overdue.map((row) => (
        <li key={`overdue-${row.match_id}`} className="rounded-sm border border-[#FF3B30]/40 bg-[#121212] p-4 md:flex md:items-center md:gap-4" data-testid={`duty-overdue-${row.match_id}`}>
          <AlarmClock className="hidden h-5 w-5 shrink-0 text-[#FF3B30] md:block" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="font-heading font-bold text-white [overflow-wrap:anywhere]">Überfällig: {row.label}</div>
            <div className="mt-1 text-sm text-white/70 [overflow-wrap:anywhere]">
              {row.title} · angesetzt {shortWhen(row.scheduled_at)}, nie gemeldet. Ergebnis eintragen, kampflos werten oder neuen Termin setzen.
            </div>
          </div>
          <Link to={row.url} data-testid={`duty-overdue-open-${row.match_id}`}
            className="tls-btn tls-btn--secondary mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider md:mt-0 md:w-auto">
            Spiel öffnen <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

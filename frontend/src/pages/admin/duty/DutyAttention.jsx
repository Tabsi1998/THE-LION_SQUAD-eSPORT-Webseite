// Was die Leitung entscheiden muss (#2194, #1652): Turniere nach ihrem Ende noch auf „Live“, überfällige Liga-Spiele (nie
// gemeldet, Termin lange vorbei) und abgelaufene Check-ins (eine Seite fehlt - gewertet wird nie von selbst). Steht auf „Mein
// Dienst“ und oben auf der Startseite der Verwaltung, mit direktem Weg.
import { Link } from "react-router-dom";
import { AlarmClock, ArrowRight, ClipboardX, Flag } from "lucide-react";
import { endedLiveText } from "@/lib/endedLive";
import { shortWhen } from "@/lib/leagueSchedule";

export function hasDutyAttention(duty) {
  return Boolean((duty?.ended_live || []).length || (duty?.overdue_matches || []).length || (duty?.checkin_proposals || []).length);
}

export function DutyAttention({ duty, testId = "duty-attention" }) {
  const ended = duty?.ended_live || [];
  const overdue = duty?.overdue_matches || [];
  const proposals = duty?.checkin_proposals || [];
  if (!ended.length && !overdue.length && !proposals.length) return null;
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
      {proposals.map((row) => (
        <li key={`checkin-${row.match_id}`} className="rounded-sm border border-honor/45 bg-[#121212] p-4 md:flex md:items-center md:gap-4" data-testid={`duty-checkin-${row.match_id}`}>
          <ClipboardX className="hidden h-5 w-5 shrink-0 text-honor md:block" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="font-heading font-bold text-white [overflow-wrap:anywhere]">Check-in abgelaufen: {row.label}</div>
            <div className="mt-1 text-sm text-white/70 [overflow-wrap:anywhere]">
              {row.title} · {(row.missing || []).join(" und ") || "eine Seite"} nicht eingecheckt, Fenster bis {shortWhen(row.due_at)}.
              {" "}Kampflos werten, Seite nachtragen oder verlängern – gewertet wird nichts von selbst.
            </div>
          </div>
          <Link to={row.lead_url || row.url} data-testid={`duty-checkin-open-${row.match_id}`}
            className="tls-btn tls-btn--secondary mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider md:mt-0 md:w-auto">
            Entscheiden <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
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

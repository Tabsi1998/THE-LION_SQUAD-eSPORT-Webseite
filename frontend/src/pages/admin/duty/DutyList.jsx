// „Mein Dienst“ (#1352): die eigenen Einsätze als Liste - heute zuerst, je Turnier oder Fast Lap mit der eigenen Rolle
// und einem Knopf dorthin, wo die Arbeit passiert (Turnierleitung am Handy, #1156; Fast Lap in der Verwaltung). Am Handy
// Karten, ab Tablet Zeilen. Dieselbe Liste steht auf „Mein Dienst“ und - für Admins mit Einsatz - oben auf der Startseite.
import { Link } from "react-router-dom";
import { ArrowRight, Flag, MessageCircleWarning, Trophy } from "lucide-react";
import { STAFF_ROLE_LABELS } from "@/lib/tournamentLabels";
import { viennaDate, viennaTime } from "@/lib/vienna";

const KIND = {
  tournament: { label: "Turnier", icon: Trophy, open: "Turnierleitung öffnen" },
  fastlap: { label: "Fast Lap", icon: Flag, open: "Fast Lap öffnen" },
};

export function dutyWhen(row) {
  if (!row.starts_at) return row.today ? "Heute" : "Ohne Termin";
  const time = viennaTime(row.starts_at, { hour: "2-digit", minute: "2-digit" });
  if (row.today) return `Heute · ${time}`;
  return `${viennaDate(row.starts_at, { weekday: "short", day: "2-digit", month: "2-digit" })} · ${time}`;
}

export function dutyRoles(row) {
  return (row.roles || []).map((role) => STAFF_ROLE_LABELS[role] || role).join(", ");
}

export function DutyList({ rows, testId = "duty-list" }) {
  return (
    <ul className="space-y-2" data-testid={testId}>
      {rows.map((row) => {
        const kind = KIND[row.kind] || KIND.tournament;
        const Icon = kind.icon;
        const roles = dutyRoles(row);
        return (
          <li key={`${row.kind}-${row.id}`} data-testid={`duty-row-${row.id}`} className={`rounded-sm border bg-[#121212] p-4 md:flex md:items-center md:gap-4 ${row.today ? "border-[#29B6E8]/40" : "border-white/10"}`}>
            <div className={`text-xs font-bold uppercase tracking-wider tabular-nums md:w-40 md:shrink-0 ${row.today ? "text-[#29B6E8]" : "text-white/55"}`} data-testid={`duty-when-${row.id}`}>
              {dutyWhen(row)}
            </div>
            <div className="mt-1 min-w-0 flex-1 md:mt-0">
              <div className="flex items-center gap-2 min-w-0">
                <Icon className="w-4 h-4 shrink-0 text-white/45" aria-hidden="true" />
                <span className="font-heading font-bold text-white truncate">{row.title}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-widest text-white/40">{kind.label}</span>
              </div>
              {roles && <div className="mt-1 text-sm text-white/60" data-testid={`duty-roles-${row.id}`}>Deine Rolle: {roles}</div>}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 md:mt-0 md:shrink-0">
              <Link to={row.url} data-testid={`duty-open-${row.id}`} className="tls-btn tls-btn--primary inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider md:w-auto">
                {kind.open} <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
              {row.kind === "tournament" && row.admin_url && (
                <Link to={row.admin_url} data-testid={`duty-admin-${row.id}`} className="tls-hit text-xs font-semibold text-white/55 hover:text-white">Vorbereiten</Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ModerationDuty({ moderation }) {
  const open = Number(moderation?.open_reports || 0);
  return (
    <div className={`rounded-sm border bg-[#121212] p-4 md:flex md:items-center md:gap-4 ${open ? "border-[#FF3B30]/40" : "border-white/10"}`} data-testid="duty-moderation">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <MessageCircleWarning className="w-5 h-5 shrink-0" style={{ color: open ? "#FF3B30" : "#00FF88" }} aria-hidden="true" />
        <div className="min-w-0">
          <div className="font-heading font-bold text-white">Moderation</div>
          <div className="text-sm text-white/60" data-testid="duty-moderation-count">
            {open === 0 ? "Keine offene Meldung." : open === 1 ? "1 offene Meldung" : `${open} offene Meldungen`}
          </div>
        </div>
      </div>
      <Link to="/admin/moderation" data-testid="duty-moderation-open" className="tls-btn tls-btn--secondary mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider md:mt-0 md:w-auto">
        Meldungen öffnen <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

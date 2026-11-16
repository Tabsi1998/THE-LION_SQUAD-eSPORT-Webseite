// Reiter „Überblick“ der Staffel-Seite (#2262, Entwurf 2.2): Liga-Ablauf, was fehlt, die Hauptaktion („Liga starten“ bzw. Status),
// Kurzzahlen und die Wege zu Leitstand, Season und Ligaseite. Gesteuert wird mit denselben Bausteinen wie in der Turnierverwaltung -
// der Status geht über `useTournamentStatus` mit denselben Rückfragen. Den Status ändert nur „Liga verwalten“ (`can_edit_staffel`),
// so verlangt es der Server (`tournament_lifecycle_routes.py`).
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, ExternalLink, Zap } from "lucide-react";
import { TournamentFlowStepper } from "@/components/tls/TournamentFlowStepper";
import { countsAsMatch } from "@/lib/bracketGraph";
import { seasonAnchorUrl, staffelNeeds } from "@/lib/seasonTabs";
import { staffelManageUrl } from "@/lib/staffelTabs";
import { StaffelNeedsHint, STAFFEL_STATUS_VALUES, staffelBeforeStart } from "@/pages/admin/tournament/StaffelParts";
import { TOURNAMENT_STATUS_OPTIONS, primaryTournamentAction } from "@/pages/admin/tournament/shared";
import { PauseUntilControl } from "@/pages/admin/tournament/TvTournamentPanel";
import { ACTIVE_STAFFEL_REGISTRATION, needsUrl } from "./staffelPage";

const DONE = new Set(["completed", "forfeit"]);
const STATUS_OPTIONS = TOURNAMENT_STATUS_OPTIONS.filter(([value]) => STAFFEL_STATUS_VALUES.has(value));
const statusLabel = (value) => TOURNAMENT_STATUS_OPTIONS.find(([key]) => key === value)?.[1] || value;
const CARD = "min-w-0 rounded-sm border border-white/10 bg-[#121212] p-4";
const EYEBROW = "text-[11px] font-bold uppercase tracking-[0.25em] text-[#29B6E8]";

/** Teams x von y und Spiele gespielt/gesamt - vor dem Start zählt nur die Vorschau. */
export function staffelNumbers(tournament, registrations = [], matches = []) {
  const teams = registrations.filter((row) => ACTIVE_STAFFEL_REGISTRATION.has(row.status)).length;
  const real = (matches || []).filter(countsAsMatch);
  const played = real.filter((match) => DONE.has(match.status)).length;
  const preview = (matches || []).filter((match) => match?.is_preview).length;
  return { teams, max: Number(tournament?.max_participants) || 0, total: real.length, played, open: real.length - played, preview };
}

function Numbers({ tournament, registrations, matches }) {
  const numbers = staffelNumbers(tournament, registrations, matches);
  const before = staffelBeforeStart(tournament);
  return (
    <section className={CARD} aria-labelledby="staffel-numbers-title" data-testid="staffel-numbers">
      <h2 id="staffel-numbers-title" className={EYEBROW}>Zahlen</h2>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <dt className="text-[11px] font-bold uppercase tracking-wider text-white/50">Teams</dt>
          <dd className="mt-0.5 font-heading text-2xl font-black tabular-nums" data-testid="staffel-numbers-teams">
            {numbers.teams}{numbers.max ? <span className="text-base text-white/45"> von {numbers.max}</span> : null}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] font-bold uppercase tracking-wider text-white/50">Spiele</dt>
          <dd className="mt-0.5 font-heading text-2xl font-black tabular-nums" data-testid="staffel-numbers-matches">
            {before ? <span className="text-base font-bold text-white/55">noch keine</span> : (
              <>{numbers.played}<span className="text-base text-white/45"> von {numbers.total}</span></>
            )}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-white/55" data-testid="staffel-numbers-note">
        {before
          ? numbers.preview ? `Vorschau mit ${numbers.preview} Spielen – fest wird der Spielplan mit „Liga starten“.` : "Der Spielplan entsteht mit den zugeteilten Teams."
          : numbers.open ? `${numbers.open} ${numbers.open === 1 ? "Spiel" : "Spiele"} noch offen.` : numbers.total ? "Alle Spiele gespielt." : "Noch kein festes Spiel."}
      </p>
    </section>
  );
}

function StatusCard({ tournament, onStatus, onReload }) {
  const manage = Boolean(tournament.can_edit_staffel);
  const primary = primaryTournamentAction(tournament.status, tournament);
  const current = STATUS_OPTIONS.some(([value]) => value === tournament.status) ? STATUS_OPTIONS : [[tournament.status, statusLabel(tournament.status)], ...STATUS_OPTIONS];
  return (
    <section className={CARD} aria-labelledby="staffel-status-title" data-testid="staffel-status">
      <h2 id="staffel-status-title" className={EYEBROW}>Status</h2>
      {manage ? (
        <div className="mt-3 space-y-3">
          {primary ? (
            <button type="button" onClick={() => onStatus(primary.status)} data-testid="staffel-primary-action"
              className="tls-btn tls-btn--primary inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-sm px-4 text-sm font-bold uppercase tracking-wider">
              <Zap className="h-4 w-4" aria-hidden="true" /> {primary.label}
            </button>
          ) : null}
          {primary?.label === "Liga starten" ? (
            <p className="text-xs text-white/55" data-testid="staffel-start-note">Macht den Spielplan fest und schaltet die Staffel live. Danach kommen Teams nur noch als Nachmeldung dazu.</p>
          ) : null}
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/50">Status ändern</span>
            <select value={tournament.status} onChange={(event) => onStatus(event.target.value)} data-testid="staffel-status-select"
              className="min-h-[44px] w-full rounded-sm border border-white/10 bg-[#0A0A0A] px-3 text-sm text-white focus:border-[#29B6E8]/60 focus:outline-none">
              {current.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {/* „Pause bis“ (#1123): nur beim Status „Pausiert“. */}
          <PauseUntilControl tournament={tournament} onSaved={onReload} />
        </div>
      ) : (
        <p className="mt-3 text-sm text-white/70" data-testid="staffel-status-readonly">
          {statusLabel(tournament.status)}. <span className="text-white/50">Den Status ändert, wer in dieser Liga „Liga verwalten“ hat.</span>
        </p>
      )}
    </section>
  );
}

// ``teams``: zugeteilte Co-Teams aus der Liste dieser Seite - frischer als der Zähler am Turnier.
function Needs({ tournament: base, teams }) {
  const tournament = { ...base, participant_count: teams };
  const manageUrl = needsUrl(tournament.id);
  const empty = staffelNeeds(tournament, { manageUrl }).length === 0;
  return (
    <section className={CARD} aria-labelledby="staffel-needs-title" data-testid="staffel-needs-card">
      <h2 id="staffel-needs-title" className={EYEBROW}>Was fehlt</h2>
      {empty ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-white/65" data-testid="staffel-needs-none">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-hidden="true" /> Gerade fehlt nichts.
        </p>
      ) : (
        <StaffelNeedsHint tournament={tournament} manageUrl={manageUrl} testId="staffel-needs" className="mt-2 [&_a]:min-h-[44px] [&_a]:text-sm" />
      )}
    </section>
  );
}

function Ways({ tournament }) {
  const links = tournament.league_links || {};
  const seasonId = tournament.league_context?.season_id;
  const seasonPath = links.season_admin_path || seasonAnchorUrl(seasonId);
  const row = "flex min-h-[44px] min-w-0 items-center justify-between gap-3 px-3 text-sm font-semibold text-white/85 hover:bg-white/5 hover:text-white";
  return (
    <nav className={`${CARD} p-0`} aria-label="Wege von dieser Staffel" data-testid="staffel-ways">
      <ul className="divide-y divide-white/5">
        <li>
          <Link to={seasonAnchorUrl(seasonId, "leitstand")} className={row} data-testid="staffel-desk-link">
            <span className="min-w-0">Offen in dieser Staffel <span className="block text-xs font-normal text-white/50">im Leitstand der Season</span></span>
            <ArrowRight className="h-4 w-4 shrink-0 text-[#29B6E8]" aria-hidden="true" />
          </Link>
        </li>
        <li>
          <Link to={seasonPath} className={row} data-testid="staffel-season-open">
            <span className="min-w-0 [overflow-wrap:anywhere]">Season öffnen <span className="block text-xs font-normal text-white/50">Vorgaben, Anmeldung, Strafen</span></span>
            <ArrowRight className="h-4 w-4 shrink-0 text-[#29B6E8]" aria-hidden="true" />
          </Link>
        </li>
        {links.public_path ? (
          <li>
            <Link to={links.public_path} target="_blank" className={row} data-testid="staffel-public-open">
              <span className="min-w-0">Ligaseite <span className="block text-xs font-normal text-white/50">so sehen es die Teams</span></span>
              <ExternalLink className="h-4 w-4 shrink-0 text-[#29B6E8]" aria-hidden="true" />
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

export function StaffelOverviewTab({ tournament, registrations, matches, onStatus, onReload }) {
  const navigate = useNavigate();
  return (
    <div className="space-y-5">
      {/* Liga-Ablauf: ein Schritt führt an seine Stelle - auf diese Seite, solange es den Reiter hier schon gibt. */}
      <TournamentFlowStepper tournament={tournament} registrations={registrations} matchesV2={matches} stack
        onNavigate={(key) => navigate(staffelManageUrl(tournament.id, key, key === "participants" ? "zuteilen" : ""))} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <StatusCard tournament={tournament} onStatus={onStatus} onReload={onReload} />
        <Needs tournament={tournament} teams={staffelNumbers(tournament, registrations, matches).teams} />
        <Numbers tournament={tournament} registrations={registrations} matches={matches} />
      </div>
      <Ways tournament={tournament} />
    </div>
  );
}

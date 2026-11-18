// Reiter „Überblick“ der Staffel-Seite (#2262, Entwurf 2.2): Liga-Ablauf, was fehlt, die Hauptaktion („Liga starten“ bzw. Status),
// Kurzzahlen und die Wege zu Leitstand, Season und Ligaseite. Gesteuert wird mit denselben Bausteinen wie in der Turnierverwaltung -
// der Status geht über `useTournamentStatus` mit denselben Rückfragen. Den Status ändert nur „Liga verwalten“ (`can_edit_staffel`),
// so verlangt es der Server (`tournament_lifecycle_routes.py`).
//
// Liga-Wörter statt Turnier-Status (Fabian zu #2262): Vor dem Start gibt es nur „Liga starten“ und „Staffel absagen“, kein
// Auswahlfeld und kein „Entwurf“; danach bietet die Auswahl nur, was eine laufende Staffel braucht. „Liga starten“ steht nur einmal da.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, ExternalLink, Zap } from "lucide-react";
import { TournamentFlowStepper } from "@/components/tls/TournamentFlowStepper";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { api } from "@/lib/api";
import { countsAsMatch } from "@/lib/bracketGraph";
import { seasonDeskUrl, staffelOpenCount } from "@/lib/leagueDesk";
import { seasonAnchorUrl, staffelNeeds } from "@/lib/seasonTabs";
import { staffelAdminUrl, staffelManageUrl } from "@/lib/staffelTabs";
import { staffelBeforeStart } from "@/pages/admin/tournament/StaffelParts";
import { primaryTournamentAction } from "@/pages/admin/tournament/shared";
import { FeedbackReport } from "@/pages/admin/feedback/FeedbackReport";
import { PauseUntilControl } from "@/pages/admin/tournament/TvTournamentPanel";
import { ACTIVE_STAFFEL_REGISTRATION, STAFFEL_RUNNING_STATUSES, STAFFEL_STATUS_WORDS, staffelStandText } from "./staffelPage";

const DONE = new Set(["completed", "forfeit"]);
const CARD = "min-w-0 rounded-sm border border-white/10 bg-[#121212] p-4";
const EYEBROW = "text-[11px] font-bold uppercase tracking-[0.25em] text-[#29B6E8]";
const LABEL = "text-[11px] font-bold uppercase tracking-wider text-white/60";
const SUBTLE = "text-base text-white/60";

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
          <dt className={LABEL}>Teams</dt>
          <dd className="mt-0.5 font-heading text-2xl font-black tabular-nums" data-testid="staffel-numbers-teams">
            {numbers.teams}{numbers.max ? <span className={SUBTLE}> von {numbers.max}</span> : null}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className={LABEL}>Spiele</dt>
          <dd className="mt-0.5 font-heading text-2xl font-black tabular-nums" data-testid="staffel-numbers-matches">
            {before ? <span className="text-base font-bold text-white/60">noch keine</span> : (
              <>{numbers.played}<span className={SUBTLE}> von {numbers.total}</span></>
            )}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-white/60" data-testid="staffel-numbers-note">
        {before
          ? numbers.preview ? `Vorschau mit ${numbers.preview} Spielen – fest wird der Spielplan mit „Liga starten“.` : "Der Spielplan entsteht mit den zugeteilten Teams."
          : numbers.open ? `${numbers.open} ${numbers.open === 1 ? "Spiel" : "Spiele"} noch offen.` : numbers.total ? "Alle Spiele gespielt." : "Noch kein festes Spiel."}
      </p>
    </section>
  );
}

const ACTION = "inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-sm px-4 text-sm font-bold uppercase tracking-wider";

function StatusCard({ tournament, onStatus, onReload, primaryRef }) {
  const manage = Boolean(tournament.can_edit_staffel);
  const before = staffelBeforeStart(tournament);
  const primary = primaryTournamentAction(tournament.status, tournament);
  const options = STAFFEL_RUNNING_STATUSES.includes(tournament.status) ? STAFFEL_RUNNING_STATUSES : [tournament.status, ...STAFFEL_RUNNING_STATUSES];
  return (
    <section id="staffel-status" className={`${CARD} scroll-mt-24`} aria-labelledby="staffel-status-title" data-testid="staffel-status">
      <h2 id="staffel-status-title" className={EYEBROW}>Status</h2>
      {manage ? (
        <div className="mt-3 space-y-3">
          {primary ? (
            <button ref={primaryRef} type="button" onClick={() => onStatus(primary.status)} data-testid="staffel-primary-action" className={`tls-btn tls-btn--primary ${ACTION}`}>
              <Zap className="h-4 w-4" aria-hidden="true" /> {primary.label}
            </button>
          ) : null}
          {before ? (
            <>
              <p className="text-xs text-white/60" data-testid="staffel-start-note">Macht den Spielplan fest und schaltet die Staffel live. Danach kommen Teams nur noch als Nachmeldung dazu.</p>
              {/* Vor dem Start kein Auswahlfeld: starten oder absagen. */}
              <button type="button" onClick={() => onStatus("cancelled")} data-testid="staffel-cancel" className={`tls-btn tls-btn--quiet ${ACTION} text-xs`}>
                Staffel absagen
              </button>
            </>
          ) : (
            <label className="block">
              <span className={`mb-1 block ${LABEL}`}>Status ändern</span>
              <select value={tournament.status} onChange={(event) => onStatus(event.target.value)} data-testid="staffel-status-select"
                className="min-h-[44px] w-full rounded-sm border border-white/10 bg-[#0A0A0A] px-3 text-sm text-white focus:border-[#29B6E8]/60 focus:outline-none">
                {options.map((value) => <option key={value} value={value}>{STAFFEL_STATUS_WORDS[value] || staffelStandText(tournament)}</option>)}
              </select>
            </label>
          )}
          {/* „Pause bis“ (#1123): nur beim Status „Pausiert“. */}
          <PauseUntilControl tournament={tournament} onSaved={onReload} />
        </div>
      ) : (
        // Der Stand steht schon im Abzeichen oben - hier nur, wer ihn ändert.
        <p className="mt-3 text-sm text-white/70" data-testid="staffel-status-readonly">Den Status ändert, wer in dieser Liga „Liga verwalten“ hat.</p>
      )}
    </section>
  );
}

/** Was fehlt - ohne „Liga starten“, solange die Status-Kachel den Knopf zeigt. Ein Ziel auf genau diesen Reiter wird kein Link. */
function Needs({ tournament: base, teams }) {
  // ``teams``: zugeteilte Co-Teams aus der Liste dieser Seite - frischer als der Zähler am Turnier.
  const tournament = { ...base, participant_count: teams };
  const here = staffelAdminUrl(tournament.id);
  const needs = staffelNeeds(tournament)
    .filter((need) => !(need.code === "start" && tournament.can_edit_staffel));
  return (
    <section className={CARD} aria-labelledby="staffel-needs-title" data-testid="staffel-needs-card">
      <h2 id="staffel-needs-title" className={EYEBROW}>Was fehlt</h2>
      {needs.length ? (
        <ul className="mt-2" data-testid="staffel-needs">
          {needs.map((need) => (
            <li key={need.code}>
              {need.to === here ? (
                <span className="inline-flex min-h-[44px] items-center text-sm font-semibold text-warn" data-testid={`staffel-needs-${need.code}`}>{need.text}</span>
              ) : (
                <Link to={need.to} data-testid={`staffel-needs-${need.code}`} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-warn hover:text-white">
                  {need.text} <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </Link>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 flex items-center gap-2 text-sm text-white/70" data-testid="staffel-needs-none">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-hidden="true" /> Gerade fehlt nichts.
        </p>
      )}
    </section>
  );
}

/**
 * „Offen in dieser Staffel“: die Aufgaben des Leitstands mit dieser Staffel (`staffel_id`, #2262) - eine Zahl, keine Kopie der Liste.
 * Lesen darf jede Zuständigkeit der Liga (wie der Leitstand selbst). `null` beim Laden, `{ failed }` nach einem Fehler.
 */
const DESK_RESOURCES = ["leagues", "matches", "tournaments"];
const DESK_REFRESH = { debounceMs: 5000 };

function useDeskCount(tournament) {
  const seasonId = tournament.league_context?.season_id;
  const [count, setCount] = useState(null);
  const load = useCallback(() => {
    if (!seasonId) return;
    api.get(`/admin/leagues/seasons/${seasonId}/desk`)
      .then(({ data }) => setCount(staffelOpenCount(data, tournament.id)))
      .catch(() => setCount({ failed: true }));
  }, [seasonId, tournament.id]);
  useEffect(() => { load(); }, [load]);
  // Der Leitstand rechnet alle Quellen der Season - nachgezählt wird höchstens alle 5 s, nicht bei jeder Meldung im Spielbetrieb.
  useApiInvalidation(load, DESK_RESOURCES, DESK_REFRESH);
  return count;
}

function deskLine(count) {
  if (!count) return "wird gezählt …";
  if (count.failed) return "Zahl gerade nicht geladen – im Leitstand nachsehen";
  if (!count.total) return "gerade nichts – im Leitstand der Season";
  const own = count.mine === count.total ? "" : `, ${count.mine} davon für dich`;
  return `${count.total === 1 ? "1 Aufgabe" : `${count.total} Aufgaben`}${own} – im Leitstand der Season`;
}

function Ways({ tournament }) {
  const links = tournament.league_links || {};
  const seasonId = tournament.league_context?.season_id;
  const seasonPath = links.season_admin_path || seasonAnchorUrl(seasonId);
  const count = useDeskCount(tournament);
  const row = "flex min-h-[44px] min-w-0 items-center justify-between gap-3 px-3 py-1.5 text-sm font-semibold text-white/85 hover:bg-white/5 hover:text-white";
  const sub = "block text-xs font-normal text-white/60";
  return (
    <nav className={`${CARD} p-0`} aria-label="Wege von dieser Staffel" data-testid="staffel-ways">
      <ul className="divide-y divide-white/5">
        <li>
          <Link to={seasonDeskUrl(seasonId, tournament.id)} className={row} data-testid="staffel-desk-link">
            <span className="min-w-0">
              Offen in dieser Staffel
              <span className={`${sub} ${count?.failed ? "text-warn" : ""}`} data-testid="staffel-desk-count" aria-live="polite">{deskLine(count)}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {count && !count.failed ? (
                <span className={`inline-flex min-w-[1.75rem] justify-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${count.total ? "bg-warn/15 text-warn" : "bg-white/5 text-white/60"}`}
                  data-testid="staffel-desk-total">{count.total}</span>
              ) : null}
              <ArrowRight className="h-4 w-4 text-[#29B6E8]" aria-hidden="true" />
            </span>
          </Link>
        </li>
        <li>
          <Link to={seasonPath} className={row} data-testid="staffel-season-open">
            <span className="min-w-0 [overflow-wrap:anywhere]">Season öffnen <span className={sub}>Vorgaben, Anmeldung, Strafen</span></span>
            <ArrowRight className="h-4 w-4 shrink-0 text-[#29B6E8]" aria-hidden="true" />
          </Link>
        </li>
        {links.public_path ? (
          <li>
            <Link to={links.public_path} target="_blank" className={row} data-testid="staffel-public-open">
              <span className="min-w-0">Ligaseite <span className={sub}>so sehen es die Teams</span></span>
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
  const primaryRef = useRef(null);
  // Ein Schritt des Liga-Ablaufs führt an seine Stelle: „Liga starten“ vor dem Start zum Knopf auf dieser Seite (danach zum Spielplan),
  // Zuteilen zum Reiter Teilnehmer, Spieltage zu Spiele und Ergebnisse, Tabelle zur Tabelle.
  const onStep = (key) => {
    if (key === "matchplan" && staffelBeforeStart(tournament)) {
      document.getElementById("staffel-status")?.scrollIntoView?.({ block: "center" });
      primaryRef.current?.focus();
      return;
    }
    navigate(staffelManageUrl(tournament.id, key, key === "participants" ? "zuteilen" : ""));
  };
  return (
    <div className="space-y-5">
      <TournamentFlowStepper tournament={tournament} registrations={registrations} matchesV2={matches} stack onNavigate={onStep} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <StatusCard tournament={tournament} onStatus={onStatus} onReload={onReload} primaryRef={primaryRef} />
        <Needs tournament={tournament} teams={staffelNumbers(tournament, registrations, matches).teams} />
        <Numbers tournament={tournament} registrations={registrations} matches={matches} />
      </div>
      <Ways tournament={tournament} />
      <Feedback tournament={tournament} />
    </div>
  );
}

// Rückmeldungen (Nr. 192): Staffeln bekommen nach dem Ende dieselbe Umfrage wie Turniere (`services/feedback.py` schließt sie nicht
// aus). Die Auswertung liest „Liga verwalten“ (`GET /admin/feedback/tournament/{id}`) - ohne das Recht fragt die Seite gar nicht erst.
const FEEDBACK_STATUSES = new Set(["completed", "results_published", "archived"]);

function Feedback({ tournament }) {
  if (!tournament.can_edit_staffel || !FEEDBACK_STATUSES.has(tournament.status)) return null;
  return (
    <section className={CARD} aria-labelledby="staffel-feedback-title" data-testid="staffel-feedback">
      <h2 id="staffel-feedback-title" className={EYEBROW}>Rückmeldungen der Teams</h2>
      <div className="mt-3"><FeedbackReport kind="tournament" targetId={tournament.id} /></div>
    </section>
  );
}

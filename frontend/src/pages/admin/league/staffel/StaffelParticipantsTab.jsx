// Reiter „Teilnehmer“ der Staffel-Seite (#2262, Entwurf 2.2): die Co-Teams der Staffel mit Kader-Hinweis, „Nachgemeldet ab Woche X“
// und aktiven Strafen. Bedient wird mit denselben Bausteinen wie in der Turnierverwaltung: Co-Team zuteilen (`SquadAssignDialog`),
// Entfernen vor dem festen Spielplan, Austritt und Disqualifizieren (`ParticipantRemovalActions`), Kader (`SquadKaderSheet`).
// Alles davon mit „Teams freigeben“ (`can_manage_participants`) - so prüft es der Server. Anmeldungen und Warteliste stehen nur im
// Eingang der Season. Ab 768 px eine Tabelle, darunter Karten.
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, FileDown, Search, Users } from "lucide-react";
import { API } from "@/lib/api";
import { seasonAnchorUrl } from "@/lib/seasonTabs";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { LineupMark } from "@/components/tls/tournament/LineupMark";
import { SquadAssignDialog, canAssignSquads } from "@/components/tls/league/SquadAssignDialog";
import { PersonAssignDialog } from "@/components/tls/league/PersonAssignDialog";
import { SOLO_APPLICATIONS_FOLLOW, entrantWords, isSoloStaffel } from "@/lib/leagueParticipants";
import { ParticipantRemovalActions } from "@/pages/admin/tournament/ParticipantRemovalActions";
import { fixedRegistrationIds, normalizeSearch } from "@/pages/admin/tournament/shared";
import { SquadKaderSheet } from "../SquadKaderSheet";
import { ACTIVE_STAFFEL_REGISTRATION, kaderLine, registrationLateText } from "./staffelPage";

const nameOf = (registration) => registration.display_name || registration.squad_name || registration.user?.display_name || registration.ingame_name || "Co-Team";
const SMALL_BUTTON = "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-sm px-3 tls-type-label";

/** Kader-Hinweis aus der Kaderübersicht der Season („6 im Kader · alle IDs gültig“) - nur, wenn sie geladen ist („Kader prüfen“). */
function KaderHint({ registration, squad }) {
  const line = kaderLine(squad);
  if (!line) return null;
  return (
    <div className={`mt-1 tls-type-small ${line.warn ? "text-warn" : "text-white/60"}`} data-testid={`staffel-reg-kaderline-${registration.id}`}>{line.text}</div>
  );
}

/**
 * Was an einem Co-Team abweicht: ausgetreten oder disqualifiziert, nachgemeldet, aktive Strafen (mit Link in den Strafen-Reiter der
 * Season). Wer ganz normal zugeteilt ist, trägt kein Kennzeichen - „Zugeteilt“ in jeder Zeile wäre nur Rauschen.
 */
function Marks({ registration, sanctions = [], seasonId }) {
  const late = registrationLateText(registration);
  const left = !ACTIVE_STAFFEL_REGISTRATION.has(registration.status);
  if (!late && !left && !sanctions.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5">
      {left ? <span className="inline-flex min-h-[24px] items-center" data-testid={`staffel-reg-status-${registration.id}`}><StatusBadge status={registration.status} /></span> : null}
      {late ? (
        <span className="inline-flex items-center rounded-sm border border-brand/40 bg-brand/10 px-1.5 py-0.5 tls-type-small font-semibold text-brand" data-testid={`staffel-reg-late-${registration.id}`}>{late}</span>
      ) : null}
      {sanctions.map((row) => (
        // Das Etikett bleibt klein, die Tippfläche hat 44 px Höhe.
        <Link key={row.id} to={seasonAnchorUrl(seasonId, "strafen")} data-testid={`staffel-reg-sanction-${row.id}`}
          className="group inline-flex min-h-[44px] max-w-full items-center">
          <span className="inline-flex max-w-full items-center gap-1 rounded-sm border border-warn/40 bg-warn/10 px-1.5 py-0.5 tls-type-small font-semibold text-warn group-hover:text-white">
            <span className="[overflow-wrap:anywhere]">
              {row.kind_label}{row.target_type === "player" && row.target_name ? ` · ${row.target_name}` : ""}{row.status === "provisional" ? " (vorläufig)" : ""}
            </span>
            <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
          </span>
        </Link>
      ))}
    </div>
  );
}

function Actions({ tournament, registration, fixed, squad, onKader, onRemove, onDone }) {
  const canParticipants = Boolean(tournament.can_manage_participants);
  // Zugeteilt ist ein Co-Team - in einer Solo-Staffel (#1629) die Person.
  const assigned = Boolean(registration.squad_id || (isSoloStaffel(tournament) && registration.user_id));
  return (
    <div className="flex flex-wrap gap-2 md:justify-end">
      {squad ? (
        <button type="button" onClick={() => onKader(squad)} data-testid={`staffel-reg-kader-${registration.id}`} className={`${SMALL_BUTTON} tls-btn tls-btn--quiet`}>
          <Users className="h-3.5 w-3.5" aria-hidden="true" /> Kader
        </button>
      ) : null}
      <ParticipantRemovalActions tournament={tournament} registration={registration} onDone={onDone} allowed={canParticipants} touch />
      {/* Entfernen nimmt nur eine Zuteilung ohne festes Spiel zurück - ausgetretene oder disqualifizierte Co-Teams bleiben stehen. */}
      {canParticipants && assigned && !fixed && ACTIVE_STAFFEL_REGISTRATION.has(registration.status) ? (
        <button type="button" onClick={() => onRemove(registration)} data-testid={`staffel-reg-remove-${registration.id}`}
          className={`${SMALL_BUTTON} border border-live/40 text-live hover:bg-live/10`}>
          Entfernen
        </button>
      ) : null}
    </div>
  );
}

export function StaffelParticipantsTab({ tournament, registrations, matches, lineups = {}, sanctions = {}, squads = {}, onReload, onRemove }) {
  const [query, setQuery] = useState("");
  const [kader, setKader] = useState(null);
  const seasonId = tournament.league_context?.season_id;
  const fixed = fixedRegistrationIds(matches);
  const needle = normalizeSearch(query);
  const shown = registrations.filter((row) => !needle || normalizeSearch([nameOf(row), row.team?.name, row.squad_name].filter(Boolean).join(" ")).includes(needle));
  const active = registrations.filter((row) => ACTIVE_STAFFEL_REGISTRATION.has(row.status)).length;
  const max = Number(tournament.max_participants) || 0;
  // Solo-Staffel (#1629, P1): Teilnehmer sind Personen - „Spieler zuteilen“ statt „Co-Team zuteilen“, dieselbe Liste darunter.
  const solo = isSoloStaffel(tournament);
  const words = entrantWords(tournament);
  const canManage = Boolean(tournament.can_manage_participants);
  const canAssign = canManage && canAssignSquads(tournament);
  const rowProps = (registration) => ({
    tournament, registration, fixed: fixed.has(registration.id), squad: squads[registration.id], onKader: setKader, onRemove, onDone: onReload,
  });
  const empty = registrations.length === 0 ? words.none : `Kein ${words.one} passt zur Suche.`;
  const assignButton = "tls-btn tls-btn--primary inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-sm px-4 tls-type-label sm:w-auto";

  return (
    <div className="space-y-4">
      <div id="zuteilen" className="scroll-mt-24 flex flex-col gap-3 rounded-sm border border-white/10 bg-[#121212] p-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h2 className="tls-type-section" data-testid="staffel-teams-count">
            {words.many} <span className="tabular-nums text-white/60">{active}{max ? ` von ${max}` : ""}</span>
          </h2>
          <p className="mt-1 tls-type-body text-white/60" data-testid="staffel-entrants-note">
            {solo ? "Teilnehmer dieser Liga sind Spieler – jede Person spielt für sich, 1 gegen 1."
              : "Teilnehmer dieser Liga sind Co-Teams. Captain und Vertreter vergibt die Teamleitung im Profil."}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap md:shrink-0">
          {solo && canManage ? <PersonAssignDialog tournament={tournament} onAssigned={onReload} triggerClassName={assignButton} /> : null}
          {canAssign ? <SquadAssignDialog tournament={tournament} onAssigned={onReload} triggerClassName={assignButton} /> : null}
          <a href={`${API}/exports/tournaments/${tournament.id}/participants.pdf`} target="_blank" rel="noreferrer" data-testid="staffel-pdf-participants"
            className="tls-btn tls-btn--quiet inline-flex min-h-[44px] items-center justify-center gap-2 rounded-sm px-4 tls-type-label">
            <FileDown className="h-4 w-4" aria-hidden="true" /> PDF Teilnehmer
          </a>
        </div>
      </div>

      {solo ? (
        <p className="tls-type-small text-white/60" data-testid="staffel-entry-hint">{SOLO_APPLICATIONS_FOLLOW}</p>
      ) : (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 tls-type-small text-white/60" data-testid="staffel-entry-hint">
          Anmeldungen und Warteliste stehen im Eingang der Season.
          <Link to={seasonAnchorUrl(seasonId, "anmeldungen")} className="inline-flex min-h-[44px] items-center gap-1 font-bold text-[#29B6E8] hover:text-white" data-testid="staffel-entry-link">
            Zum Eingang <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </p>
      )}

      {registrations.length > 6 ? (
        <label className="relative block">
          <span className="sr-only">{words.search}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} data-testid="staffel-reg-search" placeholder={words.search}
            className="min-h-[44px] w-full rounded-sm border border-white/10 bg-[#0A0A0A] pl-10 pr-3 text-base text-white placeholder:text-white/55 focus:border-[#29B6E8]/60 focus:outline-none md:text-sm" />
        </label>
      ) : null}

      <div id="austritt" className="scroll-mt-24 min-w-0 overflow-hidden rounded-sm border border-white/10 bg-[#121212]" data-testid="staffel-reg-list">
        {/* Bis 768 px Karten - ohne seitliches Scrollen. */}
        <ul className="divide-y divide-white/5 md:hidden">
          {shown.map((registration, index) => (
            <li key={registration.id} className="space-y-3 p-4" data-testid={`staffel-reg-card-${registration.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="tls-type-label text-white/60">#{index + 1}</div>
                  <div className="mt-0.5 font-bold uppercase [overflow-wrap:anywhere]">{nameOf(registration)}</div>
                  <KaderHint registration={registration} squad={squads[registration.id]} />
                  <LineupMark info={lineups[registration.id]} />
                  <Marks registration={registration} sanctions={sanctions[registration.id]} seasonId={seasonId} />
                </div>
              </div>
              <Actions {...rowProps(registration)} />
            </li>
          ))}
          {shown.length === 0 ? <li className="px-4 py-10 text-center tls-type-small text-white/60" data-testid="staffel-reg-empty">{empty}</li> : null}
        </ul>
        <table className="hidden w-full table-fixed tls-type-small md:table">
          <thead className="bg-[#0A0A0A] tls-type-label text-white/60">
            <tr>
              <th scope="col" className="w-12 px-4 py-3 text-left">#</th>
              <th scope="col" className="px-4 py-3 text-left">{words.one}</th>
              <th scope="col" className="w-[22rem] px-4 py-3 text-right xl:w-[29rem]">Aktion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {shown.map((registration, index) => (
              <tr key={registration.id} data-testid={`staffel-reg-row-${registration.id}`}>
                <td className="px-4 py-3 align-top text-white/60 tabular-nums">{index + 1}</td>
                <td className="min-w-0 px-4 py-3 align-top">
                  <div className="font-semibold text-white [overflow-wrap:anywhere]">{nameOf(registration)}</div>
                  <KaderHint registration={registration} squad={squads[registration.id]} />
                  <LineupMark info={lineups[registration.id]} />
                  <Marks registration={registration} sanctions={sanctions[registration.id]} seasonId={seasonId} />
                </td>
                <td className="px-4 py-3 align-top"><Actions {...rowProps(registration)} /></td>
              </tr>
            ))}
            {shown.length === 0 ? <tr><td colSpan={3} className="px-4 py-10 text-center text-white/60">{empty}</td></tr> : null}
          </tbody>
        </table>
      </div>

      {kader ? <SquadKaderSheet squad={kader} onClose={() => setKader(null)} onSaved={() => { setKader(null); onReload(); }} /> : null}
    </div>
  );
}

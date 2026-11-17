// Reiter „Einstellungen“ der Staffel-Seite (#2262, Entwurf 2.2, Paket C). Jede Angabe an einer Stelle:
// - Darstellung (`#darstellung`): Titel, Beschreibung, Banner, Partner, Stream - das Turnierformular im Staffel-Modus, nur mit
//   „Liga verwalten“ (`PATCH /tournaments/{id}` verlangt in der Staffel `manage`).
// - Aus der Season: die Vorgaben der Season nur lesend, dazu der Map-Pool (ersetzt den alten Reiter Maps). Lesen jede Zuständigkeit.
// - Zugangslinks zum Ansehen und Sponsor je Spielwoche (Nr. 191): mit „Liga verwalten“.
// - TV-Ansicht: der Direktlink auf die Anzeige (Spieltage, Tabelle, Live-Spiele, Sieger) - lesen jede Zuständigkeit (Nr. 194).
// - Helfer (`#helfer`): keine neuen Helfer in Staffeln (Nr. 189), alte Einsätze nur lesend.
// - Werkzeuge: Sperren und Entsperren nach dem Ende („Liga verwalten“), Löschen vor dem Start („Season konfigurieren“, mit Grund).
// Jeder Abruf nur mit dem passenden Recht - keine 403 in der Konsole; ein Ladefehler steht sichtbar da.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, ExternalLink, Lock, LockOpen, Map as MapIcon, Monitor, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError, formatRequestError } from "@/lib/api";
import { AccessLinksPanel } from "@/components/tls/AccessLinksPanel";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { MapPoolView } from "@/components/tls/maps/MapPoolView";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { poolSections } from "@/lib/mapPools";
import { seasonAnchorUrl } from "@/lib/seasonTabs";
import { STAFF_ROLE_LABELS, STAFF_SCOPE_LABELS } from "@/lib/tournamentLabels";
import { StaffelSeasonValues, staffelBeforeStart, staffelLabel } from "@/pages/admin/tournament/StaffelParts";
import { TournamentEditForm } from "@/pages/admin/tournament/TournamentEditForm";
import { RoundSponsorsPanel } from "@/pages/admin/tournament/TvTournamentPanel";
import { LeagueDeleteSheet } from "../LeagueDeleteSheet";
import { hasCapability } from "./staffelPage";

const CARD = "min-w-0 rounded-sm border border-white/10 bg-[#121212] p-4";
const EYEBROW = "text-[11px] font-bold uppercase tracking-[0.25em] text-[#29B6E8]";
const NOTE = "mt-2 text-sm text-white/70";
const BUTTON = "tls-btn inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-sm px-4 text-xs font-bold uppercase tracking-wider sm:w-auto";
// Gesperrt werden kann eine Staffel erst, wenn sie vorbei ist - wie in der Turnierverwaltung.
const LOCKABLE = new Set(["completed", "results_published", "archived", "cancelled"]);

/** Titel eines Abschnitts mit Sprungmarke - `scroll-mt` hält ihn unter der Kopfzeile. */
function Section({ id, title, hint, testId, children, className = "" }) {
  return (
    <section id={id} className={`${CARD} scroll-mt-24 ${className}`} aria-labelledby={`${testId}-title`} data-testid={testId}>
      <h2 id={`${testId}-title`} className={EYEBROW}>{title}</h2>
      {hint ? <p className="mt-1 text-xs text-white/60">{hint}</p> : null}
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  );
}

/** Wer etwas nicht ändern darf, liest, wer es darf - statt eines toten Knopfs. */
function RightNote({ children, testId }) {
  return <p className={NOTE} data-testid={testId}>{children}</p>;
}

function LoadProblem({ text, onRetry, testId }) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-sm border border-warn/40 bg-warn/10 p-3 sm:flex-row sm:items-center sm:justify-between" data-testid={testId}>
      <p className="min-w-0 text-sm text-white/85 [overflow-wrap:anywhere]">{text}</p>
      <button type="button" onClick={onRetry} className={`${BUTTON} tls-btn--secondary shrink-0`} data-testid={`${testId}-retry`}>Nochmal versuchen</button>
    </div>
  );
}

/** Der Map-Pool der Staffel, wie ihn die Season überträgt - nur lesend (öffentlicher Lesepfad, keine Verwaltungsrechte nötig). */
function SeasonMapPool({ tournament }) {
  const [state, setState] = useState({ status: "loading", overview: null });
  const load = useCallback(() => {
    if (!tournament.game_id) {
      setState({ status: "ready", overview: null });
      return;
    }
    api.get(`/map-pools/tournaments/${tournament.id}`)
      .then(({ data }) => setState({ status: "ready", overview: data || null }))
      .catch((failure) => setState({ status: "error", overview: null, error: formatApiError(failure.response?.data?.detail) }));
  }, [tournament.id, tournament.game_id]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["map-pools"]);
  const sections = poolSections(state.overview);
  return (
    <Section title="Map-Pool aus der Season" testId="staffel-map-pool"
      hint="Den Pool pflegt die Season – jedes „Vorgaben übertragen“ ersetzt ihn hier. Darum nur zum Ansehen.">
      {state.status === "loading" ? <p className="text-sm text-white/60">Lade Maps …</p> : null}
      {state.status === "error" ? <LoadProblem text={state.error || "Der Map-Pool ließ sich nicht laden."} onRetry={load} testId="staffel-map-pool-error" /> : null}
      {state.status === "ready" && !sections.length ? (
        <p className="text-sm text-white/70" data-testid="staffel-map-pool-empty">Noch kein Map-Pool – die Season legt ihn fest und überträgt ihn.</p>
      ) : null}
      {sections.length ? (
        <div className="space-y-6">
          {sections.map((section) => (
            <MapPoolView key={section.key} pool={section.pool} title={section.title} className="" headingId={`staffel-map-pool-${section.key}`}
              headingClass="font-heading text-lg font-bold uppercase flex items-center gap-2" icon={MapIcon} testId={`staffel-map-pool-${section.key}`} />
          ))}
        </div>
      ) : null}
      <Link to={seasonAnchorUrl(tournament.league_context?.season_id, "modi")} data-testid="staffel-map-pool-season"
        className="mt-3 inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-[#29B6E8] hover:text-white">
        Modi und Maps der Season öffnen <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </Section>
  );
}

/** Alte Helfer-Einsätze (Nr. 189): keine neuen in Staffeln - die vorhandenen nur zum Nachlesen. */
function Helpers({ tournament }) {
  const [state, setState] = useState({ status: "loading", rows: [] });
  const load = useCallback(() => {
    api.get(`/tournaments/${tournament.id}/staff`)
      .then(({ data }) => setState({ status: "ready", rows: Array.isArray(data) ? data : [] }))
      .catch((failure) => setState({ status: "error", rows: [], error: formatApiError(failure.response?.data?.detail) }));
  }, [tournament.id]);
  useEffect(() => { load(); }, [load]);
  const active = state.rows.filter((row) => row.is_active !== false);
  return (
    <Section id="helfer" title="Helfer" testId="staffel-helpers"
      hint="Staffeln bekommen keine neuen Helfer – Aufgaben verteilt die Liga über ihre Zuständigkeiten.">
      {state.status === "loading" ? <p className="text-sm text-white/60">Lade Helfer …</p> : null}
      {state.status === "error" ? <LoadProblem text={state.error || "Die Helfer ließen sich nicht laden."} onRetry={load} testId="staffel-helpers-error" /> : null}
      {state.status === "ready" && !state.rows.length ? <p className="text-sm text-white/70" data-testid="staffel-helpers-none">Keine Helfer-Einsätze.</p> : null}
      {state.rows.length ? (
        <>
          <p className="text-xs text-white/60" data-testid="staffel-helpers-note">
            {active.length === 1 ? "1 älterer Einsatz" : `${active.length} ältere Einsätze`} aus der Turnierverwaltung – nur zum Nachlesen.
          </p>
          <ul className="mt-2 divide-y divide-white/5 rounded-sm border border-white/10" data-testid="staffel-helpers-list">
            {state.rows.map((row) => (
              <li key={row.id} className="flex min-w-0 flex-col gap-0.5 px-3 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-3" data-testid={`staffel-helper-${row.id}`}>
                <span className="min-w-0 font-semibold text-white [overflow-wrap:anywhere]">{row.user?.display_name || row.user?.username || "Mitglied"}</span>
                <span className="text-xs text-white/60">
                  {STAFF_ROLE_LABELS[row.role] || row.role || "Helfer"} · {STAFF_SCOPE_LABELS[row.scope || "tournament"] || "Ganzes Turnier"}
                  {row.is_active === false ? " · beendet" : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Section>
  );
}

function TvView({ tournament }) {
  const href = `/display/bracket/${encodeURIComponent(tournament.id)}`;
  return (
    <Section title="TV-Ansicht" testId="staffel-tv"
      hint="Spieltage, Tabelle, Live-Spiele und am Ende der Meister – für Bildschirm oder Beamer, angemeldet mit deinem Konto.">
      <a href={href} target="_blank" rel="noreferrer" className={`${BUTTON} tls-btn--secondary`} data-testid="staffel-tv-open">
        <Monitor className="h-4 w-4" aria-hidden="true" /> TV-Ansicht öffnen <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    </Section>
  );
}

function Tools({ tournament, onReload }) {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const manage = Boolean(tournament.can_edit_staffel);
  const season = hasCapability(tournament, "season");
  const lockable = LOCKABLE.has(tournament.status);
  const before = staffelBeforeStart(tournament);
  const locked = Boolean(tournament.locked_at);
  const label = staffelLabel(tournament);

  const setLock = async (lock) => {
    const ok = await confirm({
      title: lock ? "Staffel sperren?" : "Staffel entsperren?",
      description: lock
        ? `Danach sind Ergebnisse, Co-Teams und Termine von ${label} nur noch lesbar. Entsperren geht jederzeit wieder.`
        : `Danach lässt sich ${label} wieder ändern – etwa für eine späte Korrektur.`,
      confirmLabel: lock ? "Sperren" : "Entsperren",
      tone: lock ? "danger" : "info",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.post(`/tournaments/${tournament.id}/${lock ? "lock" : "unlock"}`);
      toast.success(lock ? "Staffel gesperrt." : "Staffel entsperrt.");
      onReload?.();
    } catch (failure) {
      toast.error(formatRequestError(failure, lock ? "Die Staffel ließ sich nicht sperren." : "Die Staffel ließ sich nicht entsperren."));
    } finally {
      setBusy(false);
    }
  };

  const context = tournament.league_context || {};
  return (
    <Section title="Werkzeuge" testId="staffel-tools">
      <div className="space-y-4">
        <div data-testid="staffel-tools-lock">
          <div className="text-sm font-semibold text-white">{locked ? "Gesperrt" : "Sperren"}</div>
          {!manage ? <RightNote testId="staffel-tools-lock-right">Sperren und Entsperren darf, wer in dieser Liga „Liga verwalten“ hat.</RightNote>
            : !lockable ? <RightNote testId="staffel-tools-lock-later">Sperren geht, sobald die Staffel beendet ist.</RightNote> : (
              <>
                <p className="mt-1 text-xs text-white/60">{locked ? "Ergebnisse, Co-Teams und Termine sind nur noch lesbar." : "Nach dem Ende lässt sich die Staffel gegen Änderungen sperren."}</p>
                <button type="button" onClick={() => setLock(!locked)} disabled={busy} data-testid="staffel-lock"
                  className={`${BUTTON} mt-2 ${locked ? "tls-btn--secondary" : "tls-btn--quiet"} disabled:opacity-50`}>
                  {locked ? <LockOpen className="h-4 w-4" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
                  {locked ? "Entsperren" : "Staffel sperren"}
                </button>
              </>
            )}
        </div>
        <div className="border-t border-white/5 pt-4" data-testid="staffel-tools-delete">
          <div className="text-sm font-semibold text-white">Löschen</div>
          {!season ? <RightNote testId="staffel-tools-delete-right">Löschen darf, wer in dieser Liga „Season konfigurieren“ hat.</RightNote>
            : !before ? <RightNote testId="staffel-tools-delete-later">Nach dem Start bleibt die Staffel – daran hängen Spiele und Tabelle. Absagen geht im Überblick.</RightNote> : (
              <>
                <p className="mt-1 text-xs text-white/60">Nur vor dem Start. Zugeteilte Co-Teams werden dabei aus der Staffel genommen, der Grund steht im Protokoll.</p>
                <button type="button" onClick={() => setDeleting(true)} data-testid="staffel-delete"
                  className={`${BUTTON} mt-2 border border-[#FF3B30]/40 text-[#FF6B60] hover:bg-[#FF3B30]/10`}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" /> Staffel löschen
                </button>
              </>
            )}
        </div>
      </div>
      {deleting ? (
        <LeagueDeleteSheet kind="staffel" name={label}
          target={{ tournament_id: tournament.id, staffel: context.staffel, title: tournament.title, participant_count: tournament.participant_count }}
          onClose={() => setDeleting(false)}
          onDeleted={() => navigate(seasonAnchorUrl(context.season_id, "staffeln"), { replace: true })} />
      ) : null}
    </Section>
  );
}

export function StaffelSettingsTab({ tournament, matches = [], onReload }) {
  const manage = Boolean(tournament.can_edit_staffel);
  // Sponsor je Spielwoche nur an festen Spielen: Eine Vorschau mischt sich neu, ihre Runden gibt es nach „Liga starten“ so nicht mehr.
  const fixed = (matches || []).filter((match) => match && !match.is_preview);
  return (
    <div className="space-y-5" data-testid="staffel-settings">
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
        <Section id="darstellung" title="Darstellung" testId="staffel-look" className="xl:p-5"
          hint="Titel, Beschreibung, Banner, Partner und Stream dieser Staffel. Alles Weitere gibt die Season vor.">
          {manage ? (
            <TournamentEditForm key={tournament.updated_at || tournament.id} tournament={tournament} onSaved={onReload} seasonValues={false} remix={false} />
          ) : (
            <RightNote testId="staffel-look-right">Die Darstellung ändert, wer in dieser Liga „Liga verwalten“ hat.</RightNote>
          )}
        </Section>
        <aside className="min-w-0" data-testid="staffel-season-values">
          <StaffelSeasonValues tournament={tournament} games={tournament.game ? [tournament.game] : []} />
        </aside>
      </div>
      <SeasonMapPool tournament={tournament} />
      {manage ? (
        <Section title="Zugangslinks" testId="staffel-access-links" hint="Links zum Ansehen der Staffel, etwa für Presse oder Partner, solange sie nicht öffentlich ist.">
          <AccessLinksPanel targetType="tournament" targetId={tournament.id} allowRegister={false} />
        </Section>
      ) : null}
      {manage ? (
        <Section title="Sponsor je Spielwoche" testId="staffel-round-sponsors">
          {fixed.length ? (
            <RoundSponsorsPanel tournament={tournament} matches={fixed} stages={[]} onSaved={onReload} league />
          ) : (
            <p className="text-sm text-white/70" data-testid="staffel-round-sponsors-later">Sobald die Liga gestartet ist, wählst du hier je Spielwoche einen Sponsor für die TV-Ansicht.</p>
          )}
        </Section>
      ) : null}
      <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
        <TvView tournament={tournament} />
        <Helpers tournament={tournament} />
        <Tools tournament={tournament} onReload={onReload} />
      </div>
      {!manage ? (
        <p className="flex items-start gap-2 text-xs text-white/60" data-testid="staffel-settings-read-only">
          <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Zugangslinks und Sponsor je Spielwoche pflegt, wer in dieser Liga „Liga verwalten“ hat.
        </p>
      ) : null}
    </div>
  );
}

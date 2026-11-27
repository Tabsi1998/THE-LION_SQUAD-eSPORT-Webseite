// Reiter „Einstellungen“ der Staffel-Seite (#2262, Entwurf 2.2, Paket C). Unterreiter statt einer langen Seite (#2249, #2267), je
// Unterreiter ein Thema und höchstens ein Speichern-Weg; jeder ist per Sprungmarke erreichbar (`lib/staffelTabs.js`):
// - Auftritt (`#darstellung`): Titel, Beschreibung, Banner, Partner, Stream - das Turnierformular im Staffel-Modus, nur mit
//   „Liga verwalten“ (`PATCH /tournaments/{id}` verlangt in der Staffel `manage`).
// - Aus der Season (`#vorgaben`): die Vorgaben der Season nur lesend, dazu der Map-Pool (zuklappbar, ersetzt den alten Reiter Maps).
// - Links und Sponsor (`#links`): Zugangslinks zum Ansehen und Sponsor je Spielwoche (Nr. 191), nur mit „Liga verwalten“.
// - TV und Helfer (`#helfer`): der Direktlink auf die TV-Ansicht (Nr. 194); keine neuen Helfer (Nr. 189), alte Einsätze nur lesend.
// - Werkzeuge (`#werkzeuge`): Sperren und Entsperren nach dem Ende („Liga verwalten“), Löschen vor dem Start („Season konfigurieren“).
// Die Unterreiter sind eine Wischleiste wie die Reiter oben (AdminTabBar) - dasselbe Muster wie die Season-Seite, die ihre Themen
// auch als Reiter führt; eine Abschnittsliste wäre am Handy wieder eine lange Seite. Jeder Abruf nur mit dem passenden Recht und erst
// im eigenen Unterreiter - keine 403 in der Konsole; ein Ladefehler steht sichtbar da.
import { useCallback, useEffect, useId, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, ChevronRight, ExternalLink, Lock, LockOpen, Map as MapIcon, Monitor, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError, formatRequestError } from "@/lib/api";
import { AccessLinksPanel, accessLinksHint } from "@/components/tls/AccessLinksPanel";
import { AdminTabBar } from "@/components/tls/AdminTabBar";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { MapPoolView } from "@/components/tls/maps/MapPoolView";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { poolSections } from "@/lib/mapPools";
import { seasonAnchorUrl } from "@/lib/seasonTabs";
import { STAFFEL_SETTINGS_TABS, staffelSettingsTab } from "@/lib/staffelTabs";
import { STAFF_ROLE_LABELS, STAFF_SCOPE_LABELS } from "@/lib/tournamentLabels";
import { StaffelSeasonValues, staffelBeforeStart, staffelLabel } from "@/pages/admin/tournament/StaffelParts";
import { TournamentEditForm } from "@/pages/admin/tournament/TournamentEditForm";
import { RoundSponsorsPanel } from "@/pages/admin/tournament/TvTournamentPanel";
import { LeagueDeleteSheet } from "../LeagueDeleteSheet";
import { hasCapability } from "./staffelPage";

const CARD = "min-w-0 rounded-sm border border-white/10 bg-[#121212] p-4";
const EYEBROW = "tls-type-label text-[#29B6E8]";
const NOTE = "mt-2 tls-type-small text-white/70";
const BUTTON = "tls-btn inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-sm px-4 tls-type-label sm:w-auto";
// Gesperrt werden kann eine Staffel erst, wenn sie vorbei ist - wie in der Turnierverwaltung.
const LOCKABLE = new Set(["completed", "results_published", "archived", "cancelled"]);

/** Titel eines Abschnitts mit Sprungmarke - `scroll-mt` hält ihn unter der Kopfzeile. */
function Section({ id, title, hint, testId, children, className = "" }) {
  return (
    <section id={id} className={`${CARD} scroll-mt-24 ${className}`} aria-labelledby={`${testId}-title`} data-testid={testId}>
      <h2 id={`${testId}-title`} className={EYEBROW}>{title}</h2>
      {hint ? <p className="mt-1 tls-type-small text-white/60">{hint}</p> : null}
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
      <p className="min-w-0 tls-type-body text-white/85 [overflow-wrap:anywhere]">{text}</p>
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
  const maps = sections.reduce((sum, section) => sum + (section.pool?.modes || []).reduce((count, mode) => count + (mode.maps?.length || 0), 0), 0);
  return (
    <details open className={`${CARD} group`} data-testid="staffel-map-pool">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3" data-testid="staffel-map-pool-toggle">
        <span className="min-w-0">
          <span className={`block ${EYEBROW}`}>Map-Pool aus der Season</span>
          <span className="mt-1 block tls-type-small text-white/60">
            {sections.length ? `${maps === 1 ? "1 Map" : `${maps} Maps`} – ` : ""}den Pool pflegt die Season, jedes „Vorgaben übertragen“ ersetzt ihn hier.
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-[#29B6E8] transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <div className="mt-3 min-w-0">
      {state.status === "loading" ? <p className="tls-type-small text-white/60">Lade Maps …</p> : null}
      {state.status === "error" ? <LoadProblem text={state.error || "Der Map-Pool ließ sich nicht laden."} onRetry={load} testId="staffel-map-pool-error" /> : null}
      {state.status === "ready" && !sections.length ? (
        <p className="tls-type-small text-white/70" data-testid="staffel-map-pool-empty">Noch kein Map-Pool – die Season legt ihn fest und überträgt ihn.</p>
      ) : null}
      {sections.length ? (
        <div className="space-y-6">
          {sections.map((section) => (
            <MapPoolView key={section.key} pool={section.pool} title={section.title} className="" headingId={`staffel-map-pool-${section.key}`}
              headingClass="tls-type-card flex items-center gap-2" icon={MapIcon} testId={`staffel-map-pool-${section.key}`} />
          ))}
        </div>
      ) : null}
      <Link to={seasonAnchorUrl(tournament.league_context?.season_id, "modi")} data-testid="staffel-map-pool-season"
        className="mt-3 inline-flex min-h-[44px] items-center gap-1 tls-type-small font-semibold text-[#29B6E8] hover:text-white">
        Modi und Maps der Season öffnen <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
      </div>
    </details>
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
    <Section title="Helfer" testId="staffel-helpers"
      hint="Staffeln bekommen keine neuen Helfer – Aufgaben verteilt die Liga über ihre Zuständigkeiten.">
      {state.status === "loading" ? <p className="tls-type-small text-white/60">Lade Helfer …</p> : null}
      {state.status === "error" ? <LoadProblem text={state.error || "Die Helfer ließen sich nicht laden."} onRetry={load} testId="staffel-helpers-error" /> : null}
      {state.status === "ready" && !state.rows.length ? <p className="tls-type-small text-white/70" data-testid="staffel-helpers-none">Keine Helfer-Einsätze.</p> : null}
      {state.rows.length ? (
        <>
          <p className="tls-type-small text-white/60" data-testid="staffel-helpers-note">
            {active.length === 1 ? "1 älterer Einsatz" : `${active.length} ältere Einsätze`} aus der Turnierverwaltung – nur zum Nachlesen.
          </p>
          <ul className="mt-2 divide-y divide-white/5 rounded-sm border border-white/10" data-testid="staffel-helpers-list">
            {state.rows.map((row) => (
              <li key={row.id} className="flex min-w-0 flex-col gap-0.5 px-3 py-2 tls-type-small sm:flex-row sm:items-baseline sm:justify-between sm:gap-3" data-testid={`staffel-helper-${row.id}`}>
                <span className="min-w-0 font-semibold text-white [overflow-wrap:anywhere]">{row.user?.display_name || row.user?.username || "Mitglied"}</span>
                <span className="tls-type-small text-white/60">
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
          <div className="tls-type-small font-semibold text-white">{locked ? "Gesperrt" : "Sperren"}</div>
          {!manage ? <RightNote testId="staffel-tools-lock-right">Sperren und Entsperren darf, wer in dieser Liga „Liga verwalten“ hat.</RightNote>
            : !lockable ? <RightNote testId="staffel-tools-lock-later">Sperren geht, sobald die Staffel beendet ist.</RightNote> : (
              <>
                <p className="mt-1 tls-type-small text-white/60">{locked ? "Ergebnisse, Co-Teams und Termine sind nur noch lesbar." : "Nach dem Ende lässt sich die Staffel gegen Änderungen sperren."}</p>
                <button type="button" onClick={() => setLock(!locked)} disabled={busy} data-testid="staffel-lock"
                  className={`${BUTTON} mt-2 ${locked ? "tls-btn--secondary" : "tls-btn--quiet"} disabled:opacity-50`}>
                  {locked ? <LockOpen className="h-4 w-4" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
                  {locked ? "Entsperren" : "Staffel sperren"}
                </button>
              </>
            )}
        </div>
        <div className="border-t border-white/5 pt-4" data-testid="staffel-tools-delete">
          <div className="tls-type-small font-semibold text-white">Löschen</div>
          {!season ? <RightNote testId="staffel-tools-delete-right">Löschen darf, wer in dieser Liga „Season konfigurieren“ hat.</RightNote>
            : !before ? <RightNote testId="staffel-tools-delete-later">Nach dem Start bleibt die Staffel – daran hängen Spiele und Tabelle. Absagen geht im Überblick.</RightNote> : (
              <>
                <p className="mt-1 tls-type-small text-white/60">Nur vor dem Start. Zugeteilte Co-Teams werden dabei aus der Staffel genommen, der Grund steht im Protokoll.</p>
                <button type="button" onClick={() => setDeleting(true)} data-testid="staffel-delete"
                  className={`${BUTTON} mt-2 border border-live/40 text-[#FF6B60] hover:bg-live/10`}>
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

/**
 * Auftritt: das Formular hält ungespeicherte Eingaben, auch wenn die Staffel zwischendurch neu lädt (Live-Strom, andere Person).
 * Unverändert übernimmt es den neuen Stand von selbst; nach dem eigenen Speichern auch. Sonst steht ein Hinweis mit „Neuen Stand
 * laden“ da - nichts geht verloren, ohne dass jemand es will.
 */
function Look({ tournament, onReload }) {
  const [shown, setShown] = useState(tournament);
  const [dirty, setDirty] = useState(false);
  const [savedPending, setSavedPending] = useState(false);
  const changed = (tournament.updated_at || "") !== (shown.updated_at || "");
  // Neuer Stand ohne eigene Eingaben (oder nach dem eigenen Speichern): gleich übernehmen - Zustand beim Zeichnen angleichen.
  if (changed && (!dirty || savedPending)) {
    setShown(tournament);
    setSavedPending(false);
  }
  const stale = changed && dirty && !savedPending;
  return (
    <Section title="Titel und Auftritt" testId="staffel-look" className="xl:p-5"
      hint="Titel, Beschreibung, Banner, Partner und Stream dieser Staffel. Alles Weitere gibt die Season vor (Aus der Season).">
      {stale ? (
        <div role="status" className="mb-4 flex flex-col gap-3 rounded-sm border border-warn/40 bg-warn/10 p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="staffel-look-stale">
          <p className="min-w-0 tls-type-body text-white/85">Die Staffel wurde zwischendurch geändert. Deine Eingaben bleiben stehen – speichern überschreibt, „Neuen Stand laden“ verwirft sie.</p>
          <button type="button" onClick={() => { setShown(tournament); setDirty(false); }} data-testid="staffel-look-reload"
            className={`${BUTTON} tls-btn--secondary shrink-0`}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Neuen Stand laden
          </button>
        </div>
      ) : null}
      <TournamentEditForm key={shown.updated_at || shown.id} tournament={shown} onDirtyChange={setDirty}
        onSaved={() => { setSavedPending(true); onReload?.(); }} />
    </Section>
  );
}

function SettingsPanel({ tab, tournament, matches, onReload }) {
  const manage = Boolean(tournament.can_edit_staffel);
  if (tab === "darstellung") {
    return manage ? <Look tournament={tournament} onReload={onReload} /> : (
      <Section title="Titel und Auftritt" testId="staffel-look">
        <RightNote testId="staffel-look-right">Titel und Auftritt ändert, wer in dieser Liga „Liga verwalten“ hat. Die Vorgaben der Season stehen unter „Aus der Season“.</RightNote>
      </Section>
    );
  }
  if (tab === "vorgaben") {
    return (
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)]">
        <div className="min-w-0" data-testid="staffel-season-values">
          <StaffelSeasonValues tournament={tournament} games={tournament.game ? [tournament.game] : []} />
        </div>
        <SeasonMapPool tournament={tournament} />
      </div>
    );
  }
  if (tab === "links") {
    // Sponsor je Spielwoche nur an festen Spielen: Eine Vorschau mischt sich neu, ihre Runden gibt es nach „Liga starten“ so nicht mehr.
    const fixed = (matches || []).filter((match) => match && !match.is_preview);
    return (
      <div className="space-y-5">
        <Section title="Zugangslinks" testId="staffel-access-links" hint={`${accessLinksHint("staffel")} Etwa für Presse oder Partner.`}>
          <AccessLinksPanel targetType="tournament" targetId={tournament.id} allowRegister={false} bare kind="staffel" />
        </Section>
        <Section title="Sponsor je Spielwoche" testId="staffel-round-sponsors">
          {fixed.length ? (
            <RoundSponsorsPanel tournament={tournament} matches={fixed} stages={[]} onSaved={onReload} league />
          ) : (
            <p className="tls-type-body text-white/70" data-testid="staffel-round-sponsors-later">Sobald die Liga gestartet ist, wählst du hier je Spielwoche einen Sponsor für die TV-Ansicht.</p>
          )}
        </Section>
      </div>
    );
  }
  if (tab === "helfer") {
    return (
      <div className="grid items-start gap-5 md:grid-cols-2">
        <TvView tournament={tournament} />
        <Helpers tournament={tournament} />
      </div>
    );
  }
  return <div className="max-w-2xl"><Tools tournament={tournament} onReload={onReload} /></div>;
}

/**
 * ``section``: die Sprungmarke der Adresse (`#vorgaben`, `#helfer` …) - sie wählt den Unterreiter, unbekannt oder leer der erste.
 * ``onSection``: setzt die Sprungmarke beim Wechsel. Links und Sponsor gibt es nur mit „Liga verwalten“.
 */
export function StaffelSettingsTab({ tournament, matches = [], onReload, section = "", onSection }) {
  const idBase = useId().replace(/:/g, "");
  const manage = Boolean(tournament.can_edit_staffel);
  const tabs = STAFFEL_SETTINGS_TABS.filter((row) => manage || !row.manage);
  const wanted = staffelSettingsTab(section);
  const active = tabs.some((row) => row.key === wanted) ? wanted : tabs[0].key;
  return (
    <div id={active} className="scroll-mt-24 min-w-0" data-testid="staffel-settings">
      <AdminTabBar tabs={tabs} active={active} onSelect={(key) => onSection?.(key)} idBase={idBase} label="Einstellungen der Staffel" testPrefix="staffel-settings" />
      <div role="tabpanel" id={`${idBase}-panel-${active}`} aria-labelledby={`${idBase}-tab-${active}`} className="min-w-0" data-testid={`staffel-settings-panel-${active}`}>
        <SettingsPanel key={active} tab={active} tournament={tournament} matches={matches} onReload={onReload} />
      </div>
      {!manage ? (
        <p className="mt-5 tls-type-small text-white/60" data-testid="staffel-settings-read-only">
          Zugangslinks und Sponsor je Spielwoche pflegt, wer in dieser Liga „Liga verwalten“ hat.
        </p>
      ) : null}
    </div>
  );
}

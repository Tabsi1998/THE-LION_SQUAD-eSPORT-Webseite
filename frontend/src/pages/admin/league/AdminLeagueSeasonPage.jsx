// Eine Season verwalten (docs/LIGA.md, #1622) unter /admin/leagues/seasons/<id> - seit #2267 in Reitern nach dem Muster der Spielseite
// (#2249): Überblick · Leitstand (E.4) · Spielbetrieb · Termine · Anmeldung und Kader · Tabelle · Regelwerk und Sperrliste · Ligen und Staffeln, per
// Sprungmarke ansteuerbar (#termine, Abschnitte wie #kader oder #anmeldungen führen in ihren Reiter, lib/seasonTabs.js). Jede Angabe steht
// an genau einer Stelle; welcher Reiter welche Felder trägt, steht in TAB_FIELDS.
//
// Speichern je Reiter: Jeder Reiter mit Formular schickt nur seine Felder. Ungespeichertes bleibt beim Reiterwechsel (Punkt am Reiter,
// Rückfrage mit „Jetzt speichern“), beim Verlassen der Seite fragt die Seite nach. Bausteine mit eigenem Speichern (Map-Pool,
// Ergebnisregeln, Terminregeln, Sperrliste, Anmeldungen, Kader) bleiben nach dem ersten Besuch ihres Reiters geladen - ein Wechsel
// verliert auch dort nichts.
//
// Eine Staffel ist ein Turnier - angelegt wird es hier, die Co-Teams teilt die Turnierverwaltung der Staffel zu. Änderungen an der Season
// gelten für bestehende Staffeln erst nach „Vorgaben auf Staffeln übertragen“.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Trash2, X } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminTabBar } from "@/components/tls/AdminTabBar";
import { FormSection } from "@/components/tls/AdminForm";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useNavigationGuard } from "@/lib/navigationGuard";
import { accentStyle } from "@/lib/leagueLook";
import { selectableModes } from "@/lib/gameMatchData";
import { LeagueEmblem } from "@/components/tls/league/public/LeagueLook";
import { viennaDate } from "@/lib/vienna";
import {
  VISIBILITY_SHORT, longestSeries, modeOrderProblem, orderLengthNote, sameOrder, seasonToForm, settingsLine,
} from "@/lib/league";
import { SEASON_TABS, TAB_FIELDS, dirtyTabs, rebaseForm, rulesNotice as noticeOf, seasonTarget, tabPayload } from "@/lib/seasonTabs";
import { LeagueDeleteSheet } from "./LeagueDeleteSheet";
import { SeasonDatesTab } from "./SeasonDatesTab";
import { SeasonDeskTab } from "./SeasonDeskTab";
import { DivisionSheet, SeasonDivisionsTab, SyncResults } from "./SeasonDivisionsTab";
import { SeasonEntryTab } from "./SeasonEntryTab";
import { SeasonOverviewTab } from "./SeasonOverviewTab";
import { SeasonPlayTab } from "./SeasonPlayTab";
import { useSeasonReadiness } from "./SeasonReadinessPanel";
import { SeasonProtestsTab } from "./SeasonProtestsTab";
import { SeasonRulesTab } from "./SeasonRulesTab";
import { SeasonSanctionsTab } from "./SeasonSanctionsTab";
import { SeasonTablePanel } from "./SeasonTablePanel";
import { SeasonPointsFields, SeasonTableRules } from "./SeasonTableRules";
import { SeasonTabForm } from "./SeasonTabForm";
import { toast } from "sonner";

const LONG_DAY = { day: "2-digit", month: "2-digit", year: "numeric" };
const SAVE_LABELS = {
  ueberblick: "Überblick speichern", spielbetrieb: "Spielbetrieb speichern", termine: "Termine speichern", anmeldung: "Anmeldung und Kader speichern",
  tabelle: "Tabelle speichern", ligen: "Staffelgröße speichern",
};
const SAVED_TEXT = {
  ueberblick: "Überblick gespeichert.", spielbetrieb: "Spielbetrieb gespeichert.", termine: "Termine gespeichert.", anmeldung: "Anmeldung und Kader gespeichert.",
  tabelle: "Tabelle gespeichert.", ligen: "Staffelgröße gespeichert.",
};
const labelOf = (key) => SEASON_TABS.find((row) => row.key === key)?.label || key;

/** Rollt zu einem Abschnitt, sobald er da ist - manche Bausteine laden ihre Daten erst. */
function useScrollToSection(section, tab, ready) {
  useEffect(() => {
    if (!section || !ready) return undefined;
    let tries = 0;
    const timer = window.setInterval(() => {
      const node = document.getElementById(section);
      tries += 1;
      if (node) {
        node.scrollIntoView?.({ block: "start" });
        window.clearInterval(timer);
      } else if (tries > 40) {
        window.clearInterval(timer);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [section, tab, ready]);
}

export default function AdminLeagueSeasonPage() {
  const { seasonId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const idBase = useId().replace(/:/g, "");
  const target = seasonTarget(location.hash);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState("");
  const [pendingSync, setPendingSync] = useState(0);
  const [syncRows, setSyncRows] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [divisionSheet, setDivisionSheet] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [seasonModes, setSeasonModes] = useState(null);
  const [poolDirty, setPoolDirty] = useState(false);
  const [rulesView, setRulesView] = useState(null);
  const [visited, setVisited] = useState(() => [target.tab]);
  const savedRef = useRef(null);

  const load = useCallback(async (reset = []) => {
    try {
      const { data: body } = await api.get(`/admin/leagues/seasons/${seasonId}`);
      const fresh = seasonToForm(body.season);
      const old = savedRef.current;
      savedRef.current = fresh;
      setData(body);
      setError("");
      setForm((current) => rebaseForm(current, old, fresh, reset));
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail));
    }
  }, [seasonId]);
  useEffect(() => { load(); }, [load]);
  const reload = useCallback(() => load(), [load]);
  useApiInvalidation(reload, ["leagues", "map-pools"]);

  // Zuständigkeiten (#2203): Der Server schickt, was diese Person hier darf - und prüft selbst noch einmal.
  const can = (capability) => !data?.capabilities || data.capabilities.includes(capability);
  const canSeason = can("season");
  const canRules = can("rules");
  const season = data?.season;
  const saved = useMemo(() => (season ? seasonToForm(season) : null), [season]);
  const staffelCount = (data?.divisions || []).reduce((sum, division) => sum + division.staffeln.length, 0);
  const readinessVersion = data ? `${season.updated_at}-${data.map_pool?.version ?? 0}-${data.divisions.length}-${staffelCount}` : "";
  const readiness = useSeasonReadiness(seasonId, readinessVersion);

  // Stand des Regelwerks (B.2) für Überblick und Reiter Regelwerk - lesen darf es nur „Regeln veröffentlichen“.
  useEffect(() => {
    if (!data || !canRules) return undefined;
    let alive = true;
    api.get(`/admin/league-rules/league_season/${seasonId}`).then(({ data: body }) => alive && setRulesView(body || null)).catch(() => alive && setRulesView(null));
    return () => { alive = false; };
  }, [data, canRules, seasonId]);
  const notice = noticeOf(rulesView, readiness.result);
  const rulesLink = canRules ? `/admin/leagues/rules/league_season/${seasonId}` : "";

  // Welche Reiter diese Person sieht: Termine nur mit „Season konfigurieren“, Anmeldung und Kader mit einer der passenden Zuständigkeiten.
  const tabs = SEASON_TABS.filter((row) => (row.key === "termine" ? canSeason : row.key === "anmeldung" ? canSeason || can("applications") || can("roster")
    : row.key === "strafen" ? can("sanctions") : true));
  const tab = tabs.some((row) => row.key === target.tab) ? target.tab : tabs[0].key;
  useEffect(() => { setVisited((current) => (current.includes(tab) ? current : [...current, tab])); }, [tab]);
  useScrollToSection(target.section, tab, Boolean(data));

  const formDirty = useMemo(() => dirtyTabs(form, saved), [form, saved]);
  const dirty = { ...formDirty, spielbetrieb: formDirty.spielbetrieb || poolDirty };
  const dirtyLabels = tabs.filter((row) => dirty[row.key]).map((row) => row.label);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const discard = (key) => setForm((current) => ({ ...current, ...Object.fromEntries(TAB_FIELDS[key].map((field) => [field, saved[field]])) }));

  // Seite verlassen mit Ungespeichertem: nachfragen. Ein anderer Reiter ist kein Verlassen (gleiche Adresse, andere Sprungmarke).
  const asking = useRef(false);
  useNavigationGuard({
    blocks: (nextPathname) => nextPathname !== location.pathname && dirtyLabels.length > 0,
    onBlocked: (proceed) => {
      if (asking.current) return;
      asking.current = true;
      confirm({
        title: "Nicht gespeicherte Änderungen",
        description: `In ${dirtyLabels.join(", ")} ist noch etwas nicht gespeichert. Verlässt du die Seite, geht es verloren.`,
        confirmLabel: "Verwerfen und weiter",
        cancelLabel: "Zurück zur Seite",
        tone: "danger",
      }).then((leave) => {
        asking.current = false;
        if (leave) proceed();
      });
    },
  });
  useEffect(() => {
    if (!dirtyLabels.length) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyLabels.length]);

  // Modus je Map (#2206): inaktive und archivierte Modi nur, wo die Season sie schon hat.
  const modes = useMemo(() => selectableModes(data?.game?.modes, data?.season?.game_mode_order), [data]);
  // „Modus je Map“ ist so lang wie die längste Serie (#2207): Best of der Season oder einer Liga N.
  const longest = longestSeries(form?.best_of, data?.divisions);
  // Altbestand (#2207): Eine gespeicherte Reihenfolge, die nicht zur Serie passt, bleibt unverändert speicherbar.
  const savedOrder = season?.game_mode_order || [];
  const orderEdited = form ? !sameOrder(form.game_mode_order, savedOrder) : false;
  const bestOfEdited = form ? String(form.best_of) !== String(season?.best_of) : false;
  const draft = (season?.status || "draft") === "draft";
  const orderNote = form && !orderEdited ? orderLengthNote(savedOrder, longest) : "";

  const save = async (key) => {
    if (!form || saving) return false;
    if (key === "spielbetrieb") {
      const problem = orderEdited || (draft && bestOfEdited) ? modeOrderProblem(form.game_mode_order, longest) : "";
      if (problem) {
        toast.error(problem);
        return false;
      }
    }
    const body = tabPayload(key, form, saved, { maps: longest, savedOrder });
    // Notausnahme des Superadmins beim Veröffentlichen trotz Problemen (#2207) - der Server prüft selbst.
    if (key === "ueberblick" && overrideReason.trim()) body.readiness_override_reason = overrideReason.trim();
    setSaving(key);
    let ok = false;
    try {
      const { data: answer } = await api.patch(`/admin/leagues/seasons/${seasonId}`, body);
      toast.success(answer.changed?.length ? SAVED_TEXT[key] : "Keine Änderung.");
      (answer.warnings || []).forEach((text) => toast.warning(text));
      if (key === "ueberblick") setOverrideReason("");
      if (answer.visibility_applied) toast.success(`Sichtbarkeit für ${answer.visibility_applied === 1 ? "1 Staffel" : `${answer.visibility_applied} Staffeln`} geändert.`);
      setPendingSync(answer.staffeln_to_sync || 0);
      await load([key]);
      ok = true;
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    setSaving("");
    return ok;
  };

  // Reiter wechseln: Ungespeichertes bleibt, die Seite fragt aber einmal, ob jetzt gespeichert werden soll.
  const go = async (anchor) => {
    const next = seasonTarget(`#${anchor}`).tab;
    // Der Map-Pool speichert für sich („Modi und Maps speichern“): Er bleibt beim Wechsel erhalten, die Seite sagt es aber.
    if (next !== tab && tab === "spielbetrieb" && poolDirty && !formDirty[tab]) {
      const stay = await confirm({
        title: "Modi und Maps sind nicht gespeichert",
        description: "Der Map-Pool bleibt erhalten, solange die Seite offen ist – der Reiter trägt dann einen Punkt. Gespeichert wird er mit „Modi und Maps speichern“.",
        confirmLabel: "Zurück zum Map-Pool",
        cancelLabel: "Später speichern",
        tone: "info",
      });
      if (stay) return;
    }
    if (next !== tab && formDirty[tab] && SAVE_LABELS[tab]) {
      const now = await confirm({
        title: `„${labelOf(tab)}“ ist nicht gespeichert`,
        description: "Deine Änderungen bleiben erhalten, solange die Seite offen ist – der Reiter trägt dann einen Punkt. Jetzt speichern?",
        confirmLabel: "Jetzt speichern",
        cancelLabel: "Später speichern",
        tone: "info",
      });
      if (now && !await save(tab)) return;
    }
    navigate({ pathname: location.pathname, search: location.search, hash: anchor === SEASON_TABS[0].key ? "" : `#${anchor}` }, { replace: true });
  };

  // Das Ergebnis je Staffel steht dort, wo übertragen wurde: oben unter dem Hinweis (aus jedem Reiter) oder im Reiter Ligen und Staffeln.
  const sync = async (from = "ligen") => {
    setSyncing(true);
    try {
      const { data: body } = await api.post(`/admin/leagues/seasons/${seasonId}/sync`);
      setSyncRows({ from, rows: body.staffeln || [] });
      setPendingSync(0);
      toast.success("Vorgaben übertragen.");
      await reload();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    setSyncing(false);
  };

  const createStaffel = async (division) => {
    const ok = await confirm({
      title: `Staffel in ${division.label} anlegen?`,
      description: `Ein Liga-Turnier als Entwurf mit allen Vorgaben der Season (${settingsLine(division.settings)}). Danach teilst du in der Turnierverwaltung der Staffel die Co-Teams zu.`,
      confirmLabel: "Staffel anlegen",
    });
    if (!ok) return;
    try {
      const { data: created } = await api.post(`/admin/leagues/divisions/${division.id}/staffeln`, {});
      toast.success(`Staffel ${created.staffel} angelegt.`);
      await reload();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  // Löschen und „Archivieren statt löschen“ (#2106): eine gelöschte Season führt zurück zur Übersicht.
  const afterDelete = (kind) => {
    setDeleting(null);
    if (kind === "season") navigate("/admin/leagues");
    else reload();
  };
  const archive = async ({ kind, target: item, name }) => {
    try {
      if (kind === "season") await api.patch(`/admin/leagues/seasons/${item.id}`, { status: "archived" });
      else await api.patch(`/admin/leagues/divisions/${item.id}`, { status: "archived" });
      toast.success(`${name} archiviert.`);
      setDeleting(null);
      await load(kind === "season" ? ["ueberblick"] : []);
      return true;
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      return false;
    }
  };

  const savePool = async (body) => {
    try {
      const response = await api.put(`/admin/leagues/seasons/${seasonId}/map-pool`, body);
      toast.success("Map-Pool gespeichert.");
      (response?.data?.warnings || []).forEach((text) => toast.warning(text));
      await reload();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };
  const clearPool = async () => {
    if (!await confirm({ title: "Map-Pool entfernen?", description: "Ohne Pool kann in der Liga niemand mit Maps melden. Bestehende Staffeln verlieren ihre Kopie erst beim nächsten Übertragen – und nur, solange sie noch kein Ergebnis haben.", confirmLabel: "Entfernen" })) return false;
    try {
      await api.delete(`/admin/leagues/seasons/${seasonId}/map-pool`);
      toast.success("Map-Pool entfernt.");
      await reload();
      return true;
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      return false;
    }
  };

  const formProps = (key) => ({ tab: key, submitLabel: SAVE_LABELS[key], dirty: formDirty[key], saving: saving === key, onSave: save, onDiscard: discard });
  const panels = data && form ? {
    ueberblick: () => (
      <SeasonOverviewTab data={data} form={form} set={set} setForm={setForm} saved={saved} canSeason={canSeason} readiness={readiness}
        overrideReason={overrideReason} onOverrideReason={setOverrideReason} onJump={go} rulesNotice={notice} rulesLink={rulesLink}
        formProps={formProps("ueberblick")} now={new Date()} />
    ),
    // Leitstand (E.4, Nr. 152): offene Aufgaben, Protokoll und Rundnachricht - lesen darf jede Zuständigkeit, der Server filtert.
    leitstand: () => <SeasonDeskTab seasonId={seasonId} divisions={data.divisions} />,
    spielbetrieb: () => (
      <SeasonPlayTab seasonId={seasonId} data={data} form={form} set={set} canSeason={canSeason} readiness={readiness} formProps={formProps("spielbetrieb")}
        modes={modes} longest={longest} orderNote={orderNote} seasonModes={seasonModes} onSeasonModes={setSeasonModes} onPoolDirty={setPoolDirty}
        onSavePool={savePool} onClearPool={clearPool} onPendingSync={setPendingSync} reload={reload} />
    ),
    termine: () => <SeasonDatesTab seasonId={seasonId} data={data} form={form} set={set} canSeason={canSeason} formProps={formProps("termine")} />,
    anmeldung: () => (
      <SeasonEntryTab seasonId={seasonId} season={season} form={form} set={set} canSeason={canSeason} canApplications={can("applications")} canRoster={can("roster")}
        formProps={formProps("anmeldung")} onJump={go} applicationsWaiting={data.applications_waiting || 0} />
    ),
    tabelle: () => (
      <div className="space-y-6">
        {canSeason ? (
          <SeasonTabForm {...formProps("tabelle")}>
            <FormSection title="Punkte und Gleichstand" id="punkte" className="scroll-mt-24" testId="season-points"
              hint="Wie die Tabelle rechnet. Liga N kann die Punkte abweichend festlegen.">
              <SeasonPointsFields form={form} set={set} />
              <SeasonTableRules form={form} set={set} />
            </FormSection>
          </SeasonTabForm>
        ) : null}
        {/* Tabelle (E.1, #1625): Gleichstände je Staffel, Entscheid der Leitung - lesen darf jede Zuständigkeit. */}
        <div id="gleichstand" className="scroll-mt-24"><SeasonTablePanel divisions={data.divisions} canDecide={can("results")} /></div>
      </div>
    ),
    // Proteste (E.2, #1619): Eingang für „Proteste“, Einstellungen für „Season konfigurieren“ (lesen darf jede Zuständigkeit).
    proteste: () => <SeasonProtestsTab seasonId={seasonId} canSeason={canSeason} canDisputes={can("disputes")} />,
    // Strafen (E.3): eigener Reiter - Formular oben, darunter die Strafen der Season.
    strafen: () => <SeasonSanctionsTab seasonId={seasonId} />,
    regelwerk: () => (
      <SeasonRulesTab seasonId={seasonId} season={season} canSeason={canSeason} canRules={canRules} rulesView={rulesView} rulesNotice={notice}
        rulesLink={rulesLink} onPendingSync={setPendingSync} />
    ),
    ligen: () => (
      <SeasonDivisionsTab data={data} form={form} set={set} canSeason={canSeason} formProps={formProps("ligen")} staffelCount={staffelCount} syncing={syncing}
        syncRows={syncRows?.from === "ligen" ? syncRows.rows : null} onSync={() => sync("ligen")} onAddDivision={() => setDivisionSheet({})} onEditDivision={setDivisionSheet} onDelete={setDeleting}
        onCreateStaffel={createStaffel} />
    ),
  } : {};

  return (
    <AdminLayout>
      <Link to="/admin/leagues" data-testid="season-back" className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white/50 hover:text-[#29B6E8]">
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Liga
      </Link>
      {error ? <p className="mt-6 text-sm text-warn" role="alert" data-testid="season-error">{error}</p> : null}
      {data && form ? (
        <>
          <div className="mt-3 mb-5 flex flex-wrap items-end justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3" style={accentStyle(data.league.accent_color)}>
              <LeagueEmblem src={data.look?.emblem_url} size={48} testId="season-head-emblem" />
              <div className="min-w-0">
                <h1 className="font-heading text-3xl md:text-4xl font-black uppercase break-words">{data.league.name} · {season.name}</h1>
                <p className="mt-1 text-sm text-white/60" data-testid="season-head">
                  {data.game?.name || "Spiel fehlt"} · ab {viennaDate(season.start_date, LONG_DAY)} · Sichtbarkeit: {VISIBILITY_SHORT[season.visibility]}
                </p>
              </div>
            </div>
            {/* Löschen (#2106): nur als Entwurf ohne Staffel mit Co-Teams oder Spielen - sonst bietet das Blatt Archivieren an.
                Platz für F.2: „Season aus Vorgänger übernehmen“ kommt als Knopf daneben. */}
            {can("manage") ? (
              <button type="button" onClick={() => setDeleting({ kind: "season", target: season, name: season.name })} data-testid="season-delete"
                className="tls-btn tls-btn--danger px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Season löschen
              </button>
            ) : null}
          </div>

          {pendingSync > 0 ? (
            <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn" data-testid="season-sync-hint">
              <span>Gespeichert. Die {pendingSync === 1 ? "bestehende Staffel trägt" : `${pendingSync} bestehenden Staffeln tragen`} noch die alten Werte.</span>
              <button type="button" onClick={() => sync("oben")} disabled={syncing} data-testid="season-sync-now"
                className="tls-btn tls-btn--primary px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">Jetzt übertragen</button>
            </div>
          ) : null}
          {syncRows?.from === "oben" ? (
            <div className="mb-5 rounded-sm border border-white/10 bg-[#121212] p-4" data-testid="season-sync-top">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Übertragen</span>
                <button type="button" onClick={() => setSyncRows(null)} aria-label="Ergebnis schließen" data-testid="season-sync-top-close"
                  className="rounded-sm p-1.5 text-white/50 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <SyncResults rows={syncRows.rows} />
            </div>
          ) : null}

          <AdminTabBar tabs={tabs} active={tab} dirty={dirty} onSelect={go} idBase={idBase} label="Bereiche der Season" testPrefix="season" />
          {tabs.filter((row) => visited.includes(row.key) || row.key === tab).map((row) => (
            <div key={row.key} role="tabpanel" id={`${idBase}-panel-${row.key}`} aria-labelledby={`${idBase}-tab-${row.key}`} hidden={row.key !== tab}
              data-testid={`season-panel-${row.key}`} className="min-w-0">
              {panels[row.key]()}
            </div>
          ))}

          {divisionSheet ? (
            <DivisionSheet division={divisionSheet.id ? divisionSheet : null} season={season} nextLevel={(data.divisions.at(-1)?.level || 0) + 1}
              onClose={() => setDivisionSheet(null)} onSaved={() => { setDivisionSheet(null); reload(); }} />
          ) : null}
          {deleting ? (
            <LeagueDeleteSheet kind={deleting.kind} target={deleting.target} name={deleting.name} onClose={() => setDeleting(null)}
              onDeleted={() => afterDelete(deleting.kind)} onArchive={deleting.kind === "staffel" ? undefined : () => archive(deleting)} />
          ) : null}
        </>
      ) : null}
    </AdminLayout>
  );
}

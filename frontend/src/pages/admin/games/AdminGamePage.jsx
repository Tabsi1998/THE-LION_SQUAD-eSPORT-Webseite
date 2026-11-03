// Spielseite der Verwaltung (#2249) unter /admin/games/<Spiel>: alles zu einem Spiel an einem Ort, in Reitern Allgemein,
// Spiel-IDs, Modi, Maps und Ausrüstung (per Adresse ansteuerbar: #allgemein, #ids, #modi, #maps, #ausruestung). Vorher verteilt auf
// die Seitenleiste „Spiel bearbeiten“ und eigene Seiten (die alten Adressen …/maps und …/equipment leiten hierher weiter).
//
// Speichern je Reiter: jeder Reiter mit Formular hält seinen Entwurf, solange die Seite offen ist - ein Reiterwechsel verliert
// nichts, der Reiter trägt dann einen Punkt. Wer die Seite mit Ungespeichertem verlässt, wird gefragt. Maps und Ausrüstung speichern
// sofort.
// Ein weiterer Reiter (etwa „Ausrüstung“ mit C.4) braucht einen Eintrag in GAME_TABS (lib/gameForm.js) und eines in PANELS unten.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api, formatApiError, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { FormActions } from "@/components/tls/AdminForm";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useNavigationGuard } from "@/lib/navigationGuard";
import { gameLabel, isArchivedGame } from "@/lib/gameLabels";
import {
  GAME_TABS, gameKindLabel, generalPayload, generalToForm, idFieldsProblem, idsPayload, idsToForm, sameForm, tabFromHash,
} from "@/lib/gameForm";
import {
  gameMatchDataPayload, gameMatchDataProblem, gameMatchDataToForm, gameSavedText, modeRemovalQuestion, removedModes,
} from "@/lib/gameMatchData";
import { GameGeneralTab } from "./GameGeneralTab";
import { GameIdsTab } from "./GameIdsTab";
import { GameModesTab } from "./GameModesTab";
import { GameMapsTab } from "./GameMapsTab";
import { EquipmentLibrary } from "./equipment/EquipmentLibrary";
import { toast } from "sonner";

const SAVE_LABELS = { allgemein: "Allgemein speichern", ids: "Spiel-IDs speichern", modi: "Modi speichern" };
const FORMS = {
  allgemein: generalToForm,
  ids: idsToForm,
  modi: gameMatchDataToForm,
};

// Reiter als Wischleiste: am Handy seitlich wischbar, mit Hinweis, sobald nicht alle Platz haben. Pfeiltasten wechseln den Reiter.
function GameTabBar({ tabs, active, dirty, onSelect, idBase }) {
  const ref = useRef(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () => setOverflow(node.scrollWidth - node.clientWidth > 1);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [tabs.length]);
  const onKeyDown = (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    const edge = { Home: 0, End: tabs.length - 1 }[event.key];
    if (step === undefined && edge === undefined) return;
    event.preventDefault();
    const at = tabs.findIndex((tab) => tab.key === active);
    const next = tabs[edge ?? (at + step + tabs.length) % tabs.length];
    onSelect(next.key);
    ref.current?.querySelector(`[data-tab="${next.key}"]`)?.focus();
  };
  return (
    <div className="mb-6">
      <div ref={ref} role="tablist" aria-label="Bereiche des Spiels" className="flex gap-1 border-b border-white/10 tls-swipe pb-0" data-testid="game-tabs">
        {tabs.map((tab) => {
          const selected = tab.key === active;
          return (
            <button key={tab.key} type="button" role="tab" id={`${idBase}-tab-${tab.key}`} aria-selected={selected} aria-controls={`${idBase}-panel`}
              tabIndex={selected ? 0 : -1} data-tab={tab.key} onKeyDown={onKeyDown} onClick={() => onSelect(tab.key)} data-testid={`game-tab-${tab.key}`}
              className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 sm:px-3 text-xs font-bold uppercase tracking-wider focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-t-sm ${selected ? "border-[#29B6E8] text-white" : "border-transparent text-white/50 hover:text-white"}`}>
              {tab.label}
              {dirty[tab.key] ? (
                <span className="h-1.5 w-1.5 rounded-full bg-warn" data-testid={`game-tab-dirty-${tab.key}`}>
                  <span className="sr-only">(nicht gespeichert)</span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {overflow ? <p className="mt-1.5 text-[11px] text-white/45" data-testid="game-tabs-hint">Seitlich wischen: weitere Reiter liegen rechts.</p> : null}
    </div>
  );
}

export default function AdminGamePage() {
  const { gameId: ref } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const idBase = useId().replace(/:/g, "");
  const tab = tabFromHash(location.hash);
  const [game, setGame] = useState(null);
  const [missing, setMissing] = useState("");
  const [games, setGames] = useState([]);
  const [servers, setServers] = useState([]);
  // Wo die Modi verwendet werden (#2206): Entfernen nur bei unbenutzten. undefined = lädt, null = unbekannt.
  const [usage, setUsage] = useState(undefined);
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState("");
  const [mapsKey, setMapsKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/games/${encodeURIComponent(ref)}`);
      setGame(data);
      setMissing("");
      return data;
    } catch (err) {
      setMissing(err.response?.status === 404 ? "Dieses Spiel gibt es nicht (mehr)." : formatApiError(err.response?.data?.detail));
      return null;
    }
  }, [ref]);
  const loadGames = useCallback(async () => {
    const { data } = await api.get("/games").catch(() => ({ data: [] }));
    setGames(Array.isArray(data) ? data : []);
  }, []);
  const loadUsage = useCallback(async (id) => {
    if (!id) return;
    setUsage(undefined);
    const { data } = await api.get(`/games/${id}/usage`).catch(() => ({ data: null }));
    setUsage(data || null);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadGames(); }, [loadGames]);
  useEffect(() => {
    api.get("/games/discord-servers").then(({ data }) => setServers(Array.isArray(data) ? data : [])).catch(() => setServers([]));
  }, []);
  useEffect(() => { loadUsage(game?.id); }, [game?.id, loadUsage]);
  useApiInvalidation(load, ["games"]);

  const saved = useMemo(() => (game ? Object.fromEntries(Object.entries(FORMS).map(([key, toForm]) => [key, toForm(game)])) : {}), [game]);
  const formOf = (key) => drafts[key] ?? saved[key];
  const setForm = (key) => (next) => setDrafts((current) => ({ ...current, [key]: next }));
  const dirty = Object.fromEntries(Object.keys(FORMS).map((key) => [key, Boolean(drafts[key] && saved[key] && !sameForm(drafts[key], saved[key]))]));
  const dirtyLabels = GAME_TABS.filter((entry) => dirty[entry.key]).map((entry) => entry.label);
  const discard = (key) => setDrafts((current) => {
    const rest = { ...current };
    delete rest[key];
    return rest;
  });

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

  const selectTab = (key) => navigate({ pathname: location.pathname, search: location.search, hash: key === GAME_TABS[0].key ? "" : `#${key}` }, { replace: true });

  const finish = async (key, text) => {
    await load();
    discard(key);
    toast.success(text);
  };

  const save = async (key) => {
    if (!game || saving) return;
    const form = formOf(key);
    let payload;
    if (key === "allgemein") {
      if (!String(form.name || "").trim()) { toast.error("Bitte einen Namen eintragen."); return; }
      payload = generalPayload(form);
    } else if (key === "ids") {
      const problem = idFieldsProblem(form.player_id_fields);
      if (problem) { toast.error(problem); return; }
      payload = idsPayload(form, game.kind);
    } else {
      const problem = gameMatchDataProblem(form);
      if (problem) { toast.error(problem); return; }
      payload = gameMatchDataPayload(form);
      // Modus entfernt (#2129, SP2): vor dem Speichern fragen, mit der Zahl der betroffenen Maps - auf dem Server verschwindet
      // er dann auch aus den Maps.
      const removed = removedModes(game.match_modes, payload);
      if (removed.length) {
        const counts = await api.get(`/games/${game.id}/usage`).then(({ data }) => data).catch(() => null);
        const question = modeRemovalQuestion(removed, counts);
        if (question && !await confirm({ ...question, confirmLabel: "Entfernen" })) return;
      }
    }
    setSaving(key);
    try {
      const { data } = await api.patch(`/games/${game.id}`, payload);
      if (key === "modi") {
        await finish(key, gameSavedText(data));
        loadUsage(game.id);
        setMapsKey((value) => value + 1);
      } else {
        await finish(key, key === "allgemein" ? "Allgemein gespeichert." : "Spiel-IDs gespeichert.");
        if (key === "ids") loadUsage(game.id);
        if (key === "allgemein") loadGames();
      }
    } catch (err) {
      toast.error(formatRequestError(err, "Spiel konnte nicht gespeichert werden.", { slug: form.slug, name: form.name }));
    }
    setSaving("");
  };

  const PANELS = game ? {
    allgemein: () => <GameGeneralTab gameId={game.id} form={formOf("allgemein")} onChange={setForm("allgemein")} games={games} servers={servers} />,
    ids: () => <GameIdsTab gameId={game.id} kind={game.kind} form={formOf("ids")} onChange={setForm("ids")} games={games} usage={usage} />,
    modi: () => <GameModesTab form={formOf("modi")} onChange={setForm("modi")} usage={usage} />,
    maps: () => <GameMapsTab gameId={game.id} reloadKey={mapsKey} onOpenModes={() => selectTab("modi")} />,
    // Ausrüstung (C.4, #2218): speichert je Eintrag sofort wie die Maps - kein Entwurf, also kein Punkt und keine Rückfrage beim Verlassen.
    ausruestung: () => <EquipmentLibrary gameId={game.id} />,
  } : {};
  const hasForm = Boolean(FORMS[tab]);

  return (
    <AdminLayout>
      <Link to="/admin/games" data-testid="game-page-back" className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white/50 hover:text-[#29B6E8]">
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Spiele
      </Link>
      {missing ? <p className="mt-6 text-white/60" data-testid="game-page-missing">{missing}</p> : null}
      {game ? (
        <>
          <div className="mt-3 mb-5 min-w-0">
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Spiele</span>
            <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 [overflow-wrap:anywhere]" data-testid="game-page-title">{gameLabel(game)}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/55">
              <span>{gameKindLabel(game.kind)}</span>
              {isArchivedGame(game) ? <span className="text-[11px] font-bold uppercase tracking-widest text-warn" data-testid="game-page-archived">Archiviert – beim Anlegen nicht zur Wahl</span> : null}
            </p>
          </div>
          <GameTabBar tabs={GAME_TABS} active={tab} dirty={dirty} onSelect={selectTab} idBase={idBase} />
          <div role="tabpanel" id={`${idBase}-panel`} aria-labelledby={`${idBase}-tab-${tab}`} data-testid={`game-panel-${tab}`} className="min-w-0">
            {hasForm ? (
              <form onSubmit={(event) => { event.preventDefault(); save(tab); }} noValidate data-testid={`game-form-${tab}`}>
                {PANELS[tab]()}
                <FormActions
                  submitLabel={SAVE_LABELS[tab]}
                  saving={saving === tab}
                  submitTestId={`game-save-${tab}`}
                  onCancel={dirty[tab] ? () => discard(tab) : undefined}
                  cancelLabel="Verwerfen"
                  hint={dirty[tab]
                    ? <span className="text-warn" data-testid="game-unsaved">Nicht gespeichert – bleibt beim Reiterwechsel erhalten.</span>
                    : <span data-testid="game-saved-state">Alles gespeichert.</span>}
                />
              </form>
            ) : PANELS[tab]?.()}
          </div>
        </>
      ) : null}
    </AdminLayout>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Download, Egg, Eye, ExternalLink, Shuffle, Trophy } from "lucide-react";
import { API, api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { INPUT_CLASS } from "@/components/tls/FormFields";
import { rememberPreview } from "@/pages/admin/settings/SeasonsSettings";
import { EggShape, PATTERN_LABELS } from "@/seasons/easterHunt/EggShape";

// Ostereiersuche pflegen (#646, #757): je Jahr ein Vorschlag mit Saat aus dem Jahr (jedes Jahr andere Seiten, Kanten
// und Muster), danach jedes Ei von Hand: Seite, Kante, Ecke, Muster, Hinweis. Dazu Preise, Freigabe, die Zahlen und
// nach Ostermontag die Auswertung (Verlosung unter allen mit vollem Korb und die drei Schnellsten). Ein- und
// ausgeschaltet wird die Saison unter Auftritt → Jahreszeiten.

const PLACE_LABELS = { "top-left": "oben links", "top-right": "oben rechts", "bottom-left": "unten links", "bottom-right": "unten rechts" };
const KIND_LABELS = { card: "Karte", image: "Bild", hero: "Löwe", header: "Kopfzeile", footer: "Fußzeile" };
const STATUS_LABELS = { draft: "Entwurf", live: "Freigegeben", drawn: "Ausgewertet", drawing: "Wird ausgewertet" };
const PHASE_LABELS = { none: "nicht angelegt", draft: "Entwurf", upcoming: "freigegeben, beginnt bald", running: "läuft", ended: "vorbei – auswerten", drawn: "ausgewertet" };
const PRIZE_ORDER = ["raffle_all", "fastest_1", "fastest_2", "fastest_3"];

function errorText(failure, fallback) {
  return formatApiError(failure?.response?.data?.detail) || fallback;
}

/** Ostern liegt im Frühling - ab Mai geht es um das nächste Jahr. */
export function easterYear(now = new Date()) {
  return now.getMonth() >= 4 ? now.getFullYear() + 1 : now.getFullYear();
}

function dateText(iso) {
  const day = new Date(iso || "");
  return Number.isNaN(day.getTime()) ? "" : day.toLocaleDateString("de-AT", { weekday: "short", day: "numeric", month: "numeric", timeZone: "Europe/Vienna" });
}

function Tile({ label, value, tone = "text-white", testId }) {
  return (
    <div className="rounded-sm border border-white/10 bg-[#121212] p-4" data-testid={testId}>
      <div className="text-[10px] font-bold uppercase tracking-widest text-white/45">{label}</div>
      <div className={`mt-1.5 font-heading text-2xl font-black tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

const FIELD_LABEL = "mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/45";
const FIELD_INPUT = `${INPUT_CLASS} !py-1.5 !text-xs`;

/** Eine Karte je Ei - bearbeitbar, solange niemand gefunden hat. Am Handy untereinander, am PC zwei nebeneinander. */
function EggCard({ egg, index, view, locked, onChange, onPreview }) {
  const routes = view.routes?.[egg.channel] || {};
  const kinds = view.spot_kinds?.[egg.channel] || [];
  const set = (patch) => onChange(index, { ...egg, ...patch });
  const setSpot = (patch) => set({ spot: { ...egg.spot, ...patch } });
  const numbered = egg.spot?.kind === "card" || egg.spot?.kind === "image";
  return (
    <li className="rounded-sm border border-white/10 bg-[#0b0b0b] p-3" data-testid={`easter-admin-egg-${egg.egg_no ?? index + 1}`}>
      <div className="mb-3 flex items-center gap-3">
        <EggShape pattern={egg.pattern} size={22} />
        <span className="font-bold">Ei {egg.egg_no ?? index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-white/50">{egg.channel === "app" ? "App" : "Website"} · {routes[egg.route] || egg.route}</span>
        <span className="text-xs tabular-nums text-white/60">{egg.found ? `${egg.found}× gefunden` : "noch nicht gefunden"}</span>
        {egg.channel === "web" && onPreview ? (
          <button type="button" onClick={() => onPreview(egg)} className="inline-flex items-center gap-1 rounded-sm border border-white/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white/75 hover:border-white/30" title="Das Ei auf der Seite ansehen (Vorschau, zählt nicht)" data-testid={`easter-admin-view-${egg.egg_no ?? index + 1}`}>
            <Eye className="h-3 w-3" /> Ansehen
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="block min-w-0">
          <span className={FIELD_LABEL}>Muster</span>
          <select value={egg.pattern} disabled={locked} onChange={(e) => set({ pattern: e.target.value })} className={FIELD_INPUT}>
            {(view.patterns || []).map((pattern) => <option key={pattern} value={pattern}>{PATTERN_LABELS[pattern] || pattern}</option>)}
          </select>
        </label>
        <label className="block min-w-0">
          <span className={FIELD_LABEL}>Wo</span>
          <select value={egg.channel} disabled={locked} onChange={(e) => set({ channel: e.target.value, route: Object.keys(view.routes?.[e.target.value] || {})[0], spot: { ...egg.spot, kind: "card" } })} className={FIELD_INPUT}>
            <option value="web">Website</option>
            <option value="app">App</option>
          </select>
        </label>
        <label className="block min-w-0">
          <span className={FIELD_LABEL}>Seite</span>
          <select value={egg.route} disabled={locked} onChange={(e) => set({ route: e.target.value })} className={FIELD_INPUT}>
            {Object.entries(routes).map(([route, label]) => <option key={route} value={route}>{label}</option>)}
          </select>
        </label>
        <label className="block min-w-0">
          <span className={FIELD_LABEL}>Kante</span>
          <select value={egg.spot?.kind} disabled={locked} onChange={(e) => setSpot({ kind: e.target.value })} className={FIELD_INPUT}>
            {kinds.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind] || kind}</option>)}
          </select>
        </label>
        {numbered ? (
          <label className="block min-w-0">
            <span className={FIELD_LABEL}>Welche (Nr.)</span>
            <input type="number" min={1} max={16} value={(egg.spot?.index || 0) + 1} disabled={locked} onChange={(e) => setSpot({ index: Math.max(0, Number(e.target.value) - 1) })} className={FIELD_INPUT} />
          </label>
        ) : null}
        <label className="block min-w-0">
          <span className={FIELD_LABEL}>Ecke</span>
          <select value={egg.spot?.place} disabled={locked} onChange={(e) => setSpot({ place: e.target.value })} className={FIELD_INPUT}>
            {(view.places || []).map((place) => <option key={place} value={place}>{PLACE_LABELS[place] || place}</option>)}
          </select>
        </label>
        <label className="col-span-2 block min-w-0 sm:col-span-3">
          <span className={FIELD_LABEL}>Hinweis</span>
          <input type="text" value={egg.hint || ""} maxLength={200} disabled={locked} onChange={(e) => set({ hint: e.target.value })} className={FIELD_INPUT} />
        </label>
      </div>
    </li>
  );
}

export default function AdminEasterHuntPage() {
  const confirm = useConfirm();
  const [year, setYear] = useState(easterYear());
  const [view, setView] = useState(null);
  const [failed, setFailed] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [prizes, setPrizes] = useState({});
  const [counts, setCounts] = useState({ web: 8, app: 4 });
  const years = useMemo(() => [easterYear(), easterYear() + 1, easterYear() + 2], []);

  const load = useCallback(async () => {
    setFailed("");
    try {
      const { data } = await api.get(`/seasonal/easter/admin/${year}`);
      setView(data);
      setDraft(null);
      setPrizes(Object.fromEntries((data.prizes || []).map((prize) => [prize.kind, prize])));
    } catch (err) {
      setFailed(errorText(err, "Die Eiersuche lässt sich gerade nicht laden."));
    }
  }, [year]);
  useEffect(() => { void load(); }, [load]);

  const run = async (action, success) => {
    setBusy(true);
    try {
      const data = await action();
      if (data) {
        setView(data);
        setPrizes(Object.fromEntries((data.prizes || []).map((prize) => [prize.kind, prize])));
      }
      if (success) toast.success(success);
      return true;
    } catch (err) {
      toast.error(errorText(err, "Das hat nicht geklappt."));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const propose = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/seasonal/easter/admin/${year}/propose`, counts);
      setDraft(data.eggs);
      toast.success("Vorschlag erstellt – prüfen und übernehmen.");
    } catch (err) {
      toast.error(errorText(err, "Der Vorschlag hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  };
  const saveEggs = async () => {
    const eggs = draft || view?.eggs || [];
    const ok = await run(async () => (await api.put(`/seasonal/easter/admin/${year}/eggs`, { eggs })).data, "Verstecke gespeichert.");
    if (ok) setDraft(null);
  };
  const saveHunt = (patch, success) => run(async () => (await api.put(`/seasonal/easter/admin/${year}`, {
    prizes: PRIZE_ORDER.filter((kind) => prizes[kind]?.enabled !== false && prizes[kind]?.label).map((kind) => ({ kind, label: prizes[kind].label, value: prizes[kind].value || "", winners: prizes[kind].winners || 1 })),
    ...patch,
  })).data, success);
  const draw = async () => {
    if (!await confirm({ title: `Eiersuche ${year} auswerten?`, description: "Die Verlosung unter allen mit vollem Korb wird gezogen und die drei Schnellsten bekommen ihre Preise. Alle Gewinner werden privat benachrichtigt. Das lässt sich nicht rückgängig machen.", confirmLabel: "Auswerten" })) return;
    await run(async () => (await api.post(`/seasonal/easter/admin/${year}/draw`)).data, "Ausgewertet – die Gewinner sind benachrichtigt.");
  };

  const locked = Boolean(view && view.eggs?.some((egg) => egg.found > 0));
  const rows = draft || view?.eggs || [];
  const changeRow = (index, egg) => {
    const base = draft || view?.eggs || [];
    setDraft(base.map((row, i) => (i === index ? egg : row)));
  };
  const setPrize = (kind, patch) => setPrizes((current) => ({ ...current, [kind]: { ...(current[kind] || { kind }), ...patch } }));
  // Vorschau (#757): die Eier dieses Jahres auf der echten Seite ansehen - auch im Entwurf, gezählt wird nichts.
  const navigate = useNavigate();
  const previewEgg = async (egg) => {
    try {
      const { data } = await api.post(`/seasonal/easter/admin/${year}/preview`);
      rememberPreview(data.token, data.seconds || 60);
      toast.success(`Vorschau ${data.seconds || 60} Sekunden – die Eier liegen auf den Seiten, antippen zeigt Nummer und Hinweis.`);
      navigate(egg.route);
    } catch (err) {
      toast.error(errorText(err, "Die Vorschau hat nicht geklappt."));
    }
  };

  return (
    <AdminLayout>
      <div className="mx-auto w-full max-w-6xl" data-testid="easter-admin">
        <div className="mb-6 flex flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.3em] text-[#e9c46a]"><Egg className="h-4 w-4" /> Content</span>
            <h1 className="mt-1 font-heading text-3xl font-black uppercase md:text-4xl">Ostereiersuche</h1>
            <p className="mt-2 max-w-3xl text-sm text-white/60">
              Versteckte Eier auf der Website und in der App, von Karfreitag bis Ostermontag. Jedes Jahr ein neuer Vorschlag, danach von Hand prüfen. Sobald jemand ein Ei gefunden hat, bleiben die Verstecke. Ein- und ausschalten lässt sich die Suche unter <Link to="/admin/settings/jahreszeiten" className="text-[#29B6E8] hover:underline">Auftritt → Jahreszeiten</Link>.
            </p>
          </div>
          <label className="block w-32">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/60">Jahr</span>
            <select value={year} onChange={(event) => setYear(Number(event.target.value))} className={INPUT_CLASS} data-testid="easter-admin-year">
              {years.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
          </label>
        </div>

        {failed && <div className="mb-6 rounded-sm border border-[#FF3B30]/40 bg-[#FF3B30]/10 px-4 py-3 text-sm text-[#ffb4ae]" role="alert">{failed}</div>}
        {!view && !failed && <div className="py-16 text-center text-sm text-white/45" role="status">Lade Eiersuche …</div>}

        {view && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="Stand" value={PHASE_LABELS[view.phase] || view.phase} tone={view.phase === "running" ? "text-[#5fd38d]" : "text-white"} testId="easter-admin-phase" />
              <Tile label="Eier" value={rows.length} testId="easter-admin-count" />
              <Tile label="Angefangen" value={view.started} testId="easter-admin-started" />
              <Tile label="Voller Korb" value={view.completed} tone={view.completed ? "text-[#ffd700]" : "text-white/60"} testId="easter-admin-completed" />
            </div>
            <p className="mb-6 text-sm text-white/60">
              Suche von {dateText(view.starts_at)} bis {dateText(view.ends_at)} · Hinweise ab {dateText(view.hints_open_at)} · Status: {STATUS_LABELS[view.status] || view.status}
            </p>

            <section className="mb-6 rounded-sm border border-white/10 bg-[#121212] p-5" data-testid="easter-admin-eggs">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h2 className="font-heading text-xl font-black uppercase flex-1">Verstecke</h2>
                {!locked && (
                  <>
                    <label className="text-xs text-white/60">Website <input type="number" min={0} max={30} value={counts.web} onChange={(e) => setCounts((c) => ({ ...c, web: Number(e.target.value) }))} className={`${INPUT_CLASS} !inline-block !w-16 !py-1`} aria-label="Eier auf der Website" /></label>
                    <label className="text-xs text-white/60">App <input type="number" min={0} max={30} value={counts.app} onChange={(e) => setCounts((c) => ({ ...c, app: Number(e.target.value) }))} className={`${INPUT_CLASS} !inline-block !w-16 !py-1`} aria-label="Eier in der App" /></label>
                    <button type="button" onClick={propose} disabled={busy} data-testid="easter-admin-propose" className="inline-flex items-center gap-2 rounded-sm border border-white/15 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-white/80 hover:border-white/30 disabled:opacity-40">
                      <Shuffle className="h-3.5 w-3.5" /> Vorschlag für {year}
                    </button>
                  </>
                )}
                {draft && (
                  <button type="button" onClick={saveEggs} disabled={busy} data-testid="easter-admin-save-eggs" className="inline-flex items-center gap-2 rounded-sm bg-[#e9c46a] px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-black hover:opacity-90 disabled:opacity-40">
                    Verstecke speichern
                  </button>
                )}
              </div>
              {locked && <p className="mb-3 text-xs text-[#ffd98a]" data-testid="easter-admin-locked">Es wurden schon Eier gefunden – die Verstecke bleiben jetzt, wie sie sind.</p>}
              {draft && <p className="mb-3 text-xs text-white/55">Noch nicht gespeichert.</p>}
              {rows.length ? (
                <ul className="grid gap-3 lg:grid-cols-2">
                  {rows.map((egg, index) => <EggCard key={`${egg.egg_no ?? "n"}-${index}`} egg={egg} index={index} view={view} locked={locked} onChange={changeRow} onPreview={draft ? null : previewEgg} />)}
                </ul>
              ) : (
                <p className="text-sm text-white/55">Noch keine Verstecke – „Vorschlag“ verteilt die Eier für {year}.</p>
              )}
            </section>

            <section className="mb-6 rounded-sm border border-white/10 bg-[#121212] p-5" data-testid="easter-admin-prizes">
              <h2 className="mb-3 font-heading text-xl font-black uppercase">Preise und Freigabe</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {PRIZE_ORDER.map((kind) => (
                  <div key={kind} className="rounded-sm border border-white/10 bg-[#0b0b0b] p-3">
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#e9c46a]">{view.prize_kinds?.[kind]}</div>
                    <input type="text" placeholder="Preis (leer = keiner)" value={prizes[kind]?.label || ""} disabled={view.status === "drawn"} onChange={(e) => setPrize(kind, { label: e.target.value })} className={INPUT_CLASS} data-testid={`easter-admin-prize-${kind}`} />
                    <div className="mt-2 flex gap-2">
                      <input type="text" placeholder="Wert" value={prizes[kind]?.value || ""} disabled={view.status === "drawn"} onChange={(e) => setPrize(kind, { value: e.target.value })} className={INPUT_CLASS} />
                      {kind === "raffle_all" && <input type="number" min={1} max={20} value={prizes[kind]?.winners || 1} disabled={view.status === "drawn"} onChange={(e) => setPrize(kind, { winners: Number(e.target.value) })} className={`${INPUT_CLASS} !w-20`} aria-label="Zahl der Gewinner" />}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => saveHunt({}, "Gespeichert.")} disabled={busy || view.status === "drawn"} data-testid="easter-admin-save" className="rounded-sm border border-white/15 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-white/80 hover:border-white/30 disabled:opacity-40">Speichern</button>
                {view.status !== "live" && view.status !== "drawn" && (
                  <button type="button" onClick={() => saveHunt({ status: "live" }, "Freigegeben – die Suche startet am Karfreitag.")} disabled={busy || !(view.eggs || []).length} data-testid="easter-admin-release" className="rounded-sm bg-[#5fd38d] px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-black hover:opacity-90 disabled:opacity-40">Freigeben</button>
                )}
                {view.status === "live" && !locked && (
                  <button type="button" onClick={() => saveHunt({ status: "draft" }, "Zurück auf Entwurf.")} disabled={busy} data-testid="easter-admin-draft" className="rounded-sm border border-white/15 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-white/70 hover:border-white/30 disabled:opacity-40">Zurück auf Entwurf</button>
                )}
                <Link to="/ostern" className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#29B6E8] hover:underline"><ExternalLink className="h-3.5 w-3.5" /> Zur Seite</Link>
              </div>
            </section>

            <section className="rounded-sm border border-white/10 bg-[#121212] p-5" data-testid="easter-admin-draw">
              <h2 className="mb-3 flex items-center gap-2 font-heading text-xl font-black uppercase"><Trophy className="h-4 w-4 text-[#ffd700]" /> Auswertung</h2>
              {view.status === "drawn" ? (
                <div className="space-y-2 text-sm">
                  {(view.fastest_awarded || []).map((row) => <p key={row.user_id}><span className="text-[#e9c46a]">{row.title}:</span> {row.name}</p>)}
                  {view.raffle?.protocol?.length ? view.raffle.protocol.map((record) => <p key={record.id}>Verlosung: {record.winners.map((winner) => winner.name).join(", ")} ({record.eligible} von {record.entries} Losen)</p>) : null}
                  {view.raffle_note && <p className="text-[#ffd98a]">Verlosung: {view.raffle_note}</p>}
                </div>
              ) : (
                <>
                  <p className="text-sm text-white/60">Nach Ostermontag: die Verlosung unter allen mit vollem Korb und die Preise für die Schnellsten. Vorstand und Verwaltung gewinnen nicht.</p>
                  <button type="button" onClick={draw} disabled={busy || !view.can_draw} data-testid="easter-admin-run-draw" className="mt-3 rounded-sm bg-[#ffd700] px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-black hover:opacity-90 disabled:opacity-40">Auswerten</button>
                </>
              )}
              <a href={`${API}/seasonal/easter/admin/${year}/participants.csv`} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/70 hover:text-white" data-testid="easter-admin-csv">
                <Download className="h-3.5 w-3.5" /> Teilnehmende als CSV (nur Vereinsleitung)
              </a>
            </section>
          </>
        )}
      </div>
    </AdminLayout>
  );
}

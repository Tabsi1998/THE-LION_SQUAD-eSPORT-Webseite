import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { PartnerPicker } from "@/components/tls/PartnerPicker";
import { CheckField, FieldLabel, INPUT_CLASS, SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { GermanDateField } from "@/components/tls/GermanDateField";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { gameOptionLabel } from "@/lib/gameLabels";
import { checkKey, warningSummary, warningsByField } from "@/lib/referenceChecks";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { ExternalLink, Flag, History, Medal, Pencil, Plus, Save, Trash2, User, Users } from "lucide-react";
import { viennaDate, viennaDay } from "@/lib/vienna";
import { podiumItems, yearOf } from "@/lib/referencesOverview";
import { bestPlacement } from "@/components/tls/references/referenceParts";
import { seasonOf, seasonOptions } from "@/lib/seasonClose";
import { anyPlacement, countKey, hasMoreDetails, lastReference, likeLastTime, quickDate, quickStatus } from "@/lib/referenceQuickEntry";

// Referenzen (#409): eine Referenz ist eine Turnierteilnahme des Vereins mit Einträgen - entweder
// ein Team (Spieler treten gemeinsam an, eine Platzierung) oder mehrere Einzelstarter mit je
// eigener Platzierung. Plattform, Format, Liga und Saison sind Felder, nicht mehr Teil des Titels
// (`[PS] HC | Liga X | Cup`); alte Einträge zeigt der Server mit aus dem Titel abgeleiteten
// Feldern, beim ersten Speichern werden sie fest.
// Saisons (#1750): Einzelne Turniere und Cups stehen hier; Ligen und Saisons laufen unter „Serien“, ihre Referenz
// entsteht beim Abschluss der Saison. „Gehört zur Saison“ verknüpft eine (alte) Referenz mit ihrer Saison - dann zeigt
// die Liste „aus Saison …“, und die Karte auf der Website führt zur Saison-Seite.

const VISIBILITY_OPTIONS = [["public", "Öffentlich"], ["community", "Community"], ["members", "Vereinsmitglieder"], ["internal", "Intern"]];
const MODE_OPTIONS = [["online", "Online"], ["offline", "Vor Ort"], ["hybrid", "Hybrid"]];
const STATUS_OPTIONS = [["active", "Laufend"], ["planned", "Geplant"], ["completed", "Abgeschlossen"], ["archived", "Archiviert"]];
const KIND_OPTIONS = [["team", "Team"], ["solo", "Einzelstarter"]];
const medalLabel = { gold: "Gold", silver: "Silber", bronze: "Bronze" };
const visibilityLabel = Object.fromEntries(VISIBILITY_OPTIONS);
const statusLabel = Object.fromEntries(STATUS_OPTIONS);

const emptyReference = {
  title: "",
  organizer: "",
  partner_ids: [],
  league: "",
  season: "",
  format: "",
  platforms: [],
  game_id: "",
  game_name: "",
  entries: [],
  start_date: "",
  end_date: "",
  location: "",
  mode: "online",
  external_url: "",
  bracket_url: "",
  match_url: "",
  result_url: "",
  description: "",
  highlights: "",
  visibility: "public",
  status: "completed",
  is_active: true,
  order_index: 0,
  series_id: "",
};

let entryCounter = 0;
export function emptyEntry(kind = "team") {
  entryCounter += 1;
  return {
    id: "",
    key: `new-${entryCounter}`,
    kind,
    team_name: kind === "team" ? "THE LION SQUAD" : "",
    member_profile_ids: [],
    lineup_text: "",
    lineup_members: [],
    placement: "",
    placement_label: "",
    participant_count: "",
    team_count: "",
  };
}

function entryToForm(entry) {
  return {
    id: entry.id || "",
    key: entry.id || `new-${(entryCounter += 1)}`,
    kind: entry.kind === "solo" ? "solo" : "team",
    team_name: entry.team_name || "",
    member_profile_ids: entry.member_profile_ids || [],
    lineup_text: (entry.lineup || []).join(", "),
    lineup_members: entry.lineup_members || [],
    placement: entry.placement ?? "",
    placement_label: entry.placement_label || "",
    participant_count: entry.participant_count ?? "",
    team_count: entry.team_count ?? "",
  };
}

// Aus der angereicherten Referenz (Server liefert `display_title`, `platforms`, `entries`) wird das
// Formular - so wandern alte Titel-Muster beim ersten Speichern in die Felder.
export function referenceToForm(item) {
  if (!item || !item.id) return { ...emptyReference, ...(item || {}), entries: (item?.entries || []).map(entryToForm) };
  return {
    ...emptyReference,
    ...item,
    title: item.display_title || item.title || "",
    organizer: item.organizer || "",
    partner_ids: item.partner_ids || [],
    league: item.league || "",
    season: item.season || "",
    format: item.format || "",
    platforms: item.platforms || [],
    game_id: item.game_id || "",
    game_name: item.game_name || "",
    entries: (item.entries || []).map(entryToForm),
    start_date: item.start_date || "",
    end_date: item.end_date || "",
    location: item.location || "",
    description: item.description || "",
    highlights: item.highlights || "",
    series_id: item.series_id || "",
  };
}

export function positiveNumberOrNull(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? number : null;
}

export function entryPayload(entry) {
  return {
    id: entry.id || undefined,
    kind: entry.kind === "solo" ? "solo" : "team",
    team_name: entry.kind === "team" ? (entry.team_name || "").trim() || null : null,
    member_profile_ids: entry.member_profile_ids || [],
    lineup: String(entry.lineup_text || "").split(",").map((name) => name.trim()).filter(Boolean),
    placement: positiveNumberOrNull(entry.placement),
    placement_label: (entry.placement_label || "").trim() || null,
    participant_count: positiveNumberOrNull(entry.participant_count),
    team_count: positiveNumberOrNull(entry.team_count),
  };
}

function cleanSuggestion(value) {
  return String(value || "").trim();
}

function uniqueSuggestions(values, limit = 80) {
  const seen = new Map();
  values.map(cleanSuggestion).filter(Boolean).forEach((value) => {
    const key = value.toLocaleLowerCase("de-AT");
    if (!seen.has(key)) seen.set(key, value);
  });
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "de-AT")).slice(0, limit);
}

function helperList(helpers, key) {
  return Array.isArray(helpers?.[key]) ? helpers[key] : [];
}

function buildReferenceSuggestions(items, helpers) {
  const auto = helpers?.auto || {};
  const entries = (items || []).flatMap((item) => item.entries || []);
  const platformRows = [...helperList(helpers, "platforms"), ...helperList(auto, "platforms")];
  const platforms = new Map();
  platformRows.forEach((row) => {
    const key = cleanSuggestion(row?.key || row);
    if (key && !platforms.has(key.toLocaleLowerCase("de-AT"))) platforms.set(key.toLocaleLowerCase("de-AT"), { key, label: cleanSuggestion(row?.label) || key });
  });
  (items || []).forEach((item) => (item.platforms || []).forEach((key) => {
    if (key && !platforms.has(String(key).toLocaleLowerCase("de-AT"))) platforms.set(String(key).toLocaleLowerCase("de-AT"), { key, label: key });
  }));
  return {
    titles: uniqueSuggestions((items || []).map((item) => item.display_title || item.title), 160),
    platforms: [...platforms.values()],
    formats: uniqueSuggestions([...helperList(helpers, "formats"), ...helperList(auto, "formats"), ...(items || []).map((item) => item.format)]),
    leagues: uniqueSuggestions([...helperList(helpers, "leagues"), ...helperList(auto, "leagues"), ...(items || []).map((item) => item.league)]),
    seasons: uniqueSuggestions([...helperList(helpers, "seasons"), ...helperList(auto, "seasons"), ...(items || []).map((item) => item.season)]),
    organizers: uniqueSuggestions([...helperList(helpers, "organizers"), ...helperList(auto, "organizers"), ...(items || []).map((item) => item.organizer)]),
    gameNames: uniqueSuggestions([...helperList(helpers, "game_names"), ...helperList(auto, "game_names"), ...(items || []).map((item) => item.game_name)]),
    teamNames: uniqueSuggestions([...helperList(helpers, "team_names"), ...helperList(auto, "team_names"), ...entries.map((entry) => entry.team_name)]),
    placementLabels: uniqueSuggestions([...helperList(helpers, "placement_labels"), ...helperList(auto, "placement_labels"), ...entries.map((entry) => entry.placement_label)]),
    locations: uniqueSuggestions([...helperList(helpers, "locations"), ...helperList(auto, "locations"), ...(items || []).map((item) => item.location)]),
  };
}

function formatDate(value) {
  if (!value) return "—";
  return viennaDate(value, { dateStyle: "medium" });
}

function entryPeople(entry) {
  const members = (entry.lineup_members || []).map((member) => member.display_name).filter(Boolean);
  return [...members, ...(entry.lineup || [])];
}

function entrySummary(entry) {
  const who = entry.kind === "solo" ? (entryPeople(entry)[0] || "Einzelstarter") : (entry.team_name || "Team");
  const place = entry.placement ? `Platz ${entry.placement}${entry.participant_count ? ` von ${entry.participant_count}` : ""}` : "Teilnahme";
  const people = entry.kind === "team" && entryPeople(entry).length ? ` (${entryPeople(entry).join(", ")})` : "";
  return `${entry.kind === "solo" ? "Einzel" : "Team"} ${who} · ${place}${people}`;
}

export default function AdminReferencesPage() {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({});
  const [games, setGames] = useState([]);
  const [partners, setPartners] = useState([]);
  const [memberProfiles, setMemberProfiles] = useState([]);
  const [helperSettings, setHelperSettings] = useState(null);
  const [lineages, setLineages] = useState([]);
  const [editing, setEditing] = useState(null);
  const confirm = useConfirm();
  const suggestions = useMemo(() => buildReferenceSuggestions(items, helperSettings), [items, helperSettings]);

  const load = useCallback(async () => {
    const [{ data: refs }, { data: gameRows }, { data: profileRows }, { data: helpers }, partnerRows, seasonRows] = await Promise.all([
      api.get("/references/admin"),
      api.get("/games"),
      api.get("/membership/profiles/admin/all"),
      api.get("/references/admin/helpers"),
      // Partner II (#469): Haken je Partner an der Referenz; ohne Partner bleibt das Feld weg.
      api.get("/partners").then((result) => (Array.isArray(result?.data) ? result.data : [])).catch(() => []),
      // Saisons (#1750) für „aus Saison …“ und „Gehört zur Saison“; ohne Serien bleibt beides weg.
      api.get("/reference-series/admin").then((result) => (Array.isArray(result?.data?.lineages) ? result.data.lineages : [])).catch(() => []),
    ]);
    setPartners(partnerRows || []);
    setLineages(seasonRows || []);
    setItems(refs.items || []);
    setSummary(refs.summary || {});
    setGames(gameRows || []);
    setMemberProfiles(profileRows || []);
    setHelperSettings(helpers || null);
  }, []);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["references", "games"]);

  // Direkt in die Bearbeitung (#1751, etwa aus „Referenzen bündeln“): ``?edit=<id>`` öffnet die Referenz, sobald sie
  // geladen ist, und verschwindet dann aus der Adresse.
  const [searchParams, setSearchParams] = useSearchParams();
  const editId = searchParams.get("edit");
  useEffect(() => {
    if (!editId) return;
    const found = items.find((item) => item.id === editId);
    if (!found) return;
    setEditing(found);
    setSearchParams((params) => { params.delete("edit"); return params; }, { replace: true });
  }, [editId, items, setSearchParams]);

  const remove = async (id) => {
    if (!await confirm({ title: "Referenz löschen?", description: "Die Turnierteilnahme wird mit allen Einträgen dauerhaft entfernt.", confirmLabel: "Löschen" })) return;
    await api.delete(`/references/${id}`);
    toast.success("Referenz gelöscht.");
    load();
  };

  return (
    <AdminLayout>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Verein</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Referenzen</h1>
          <p className="mt-2 text-white/60 text-sm max-w-xl">Turnierteilnahmen des Vereins: je Teilnahme ein Team oder mehrere Einzelstarter mit eigener Platzierung. Plattform, Format, Liga und Saison sind Felder – nicht mehr Teil des Titels.</p>
          <p className="mt-3 border border-[#29B6E8]/30 bg-[#29B6E8]/5 rounded-sm px-4 py-3 text-sm text-white/75 max-w-xl" data-testid="reference-hint">
            Einzelne Turniere und Cups hier – Ligen und Saisons unter <Link to="/admin/reference-series" className="text-[#29B6E8] font-semibold underline-offset-2 hover:underline">Serien</Link>, deren Referenz entsteht beim Abschluss automatisch.
          </p>
        </div>
        <button onClick={() => setEditing({})} data-testid="reference-new" className="px-5 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> Neue Referenz
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <Stat label="Teilnahmen" value={summary.total || 0} />
        <Stat label="Einträge" value={summary.entries || 0} />
        <Stat label="Podest" value={summary.podiums || 0} />
        <Stat label="Gold" value={summary.gold || 0} tone="gold" />
        <Stat label="Silber" value={summary.silver || 0} />
        <Stat label="Bronze" value={summary.bronze || 0} tone="bronze" />
      </div>

      <ShowcaseAdmin items={items} />
      <ReferenceHelperAdmin helpers={helperSettings} onSaved={(helpers) => { setHelperSettings(helpers); load(); }} />
      <ReferenceCheckAdmin items={items} onEdit={(id) => setEditing(items.find((item) => item.id === id) || null)} />

      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid={`reference-row-${item.id}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/45 font-bold flex-wrap">
                  <span>{item.game_name || item.game?.display_name || item.game?.name || "Spiel offen"}</span>
                  <span className={(item.status || "completed") === "active" ? "text-[#00D26A]" : (item.status || "completed") === "planned" ? "text-[#29B6E8]" : "text-white/45"}>{statusLabel[item.status || "completed"]}</span>
                  {item.medal && <span className="text-[#FFD700]">{medalLabel[item.medal]}</span>}
                  <span>{formatDate(item.start_date)}</span>
                  {item.visibility !== "public" && <span className="text-[#29B6E8]">{visibilityLabel[item.visibility] || item.visibility}</span>}
                  {item.is_active === false && <span className="text-[#FF3B30]">Inaktiv</span>}
                </div>
                <h2 className="mt-1 font-heading text-xl font-black uppercase leading-tight">{item.display_title || item.title}</h2>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {(item.platforms || []).map((platform) => <Chip key={platform}>{platform}</Chip>)}
                  {item.format && <Chip>{item.format}</Chip>}
                  {item.league && <Chip>{item.league}</Chip>}
                  {item.season && <Chip>{item.season}</Chip>}
                  {item.organizer && <Chip muted>{item.organizer}</Chip>}
                  <SeasonBadge item={item} lineages={lineages} />
                </div>
                <ul className="mt-2 space-y-1 text-sm text-white/65">
                  {(item.entries || []).map((entry) => (
                    <li key={entry.id} className="flex items-center gap-2">
                      {entry.kind === "solo" ? <User className="w-3.5 h-3.5 text-[#29B6E8] shrink-0" /> : <Users className="w-3.5 h-3.5 text-[#29B6E8] shrink-0" />}
                      <span>{entrySummary(entry)}</span>
                      {entry.medal && <Medal className={`w-3.5 h-3.5 ${entry.medal === "gold" ? "text-[#FFD700]" : entry.medal === "silver" ? "text-white/80" : "text-[#CD7F32]"}`} />}
                    </li>
                  ))}
                </ul>
                {(item.external_url || item.bracket_url || item.match_url || item.result_url) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <RefLink href={item.external_url} label="Turnier" />
                    <RefLink href={item.bracket_url} label="Bracket" />
                    <RefLink href={item.match_url} label="Match" />
                    <RefLink href={item.result_url} label="Ergebnis" />
                  </div>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => setEditing(item)} data-testid={`reference-edit-${item.id}`} className="p-1.5 text-white/40 hover:text-[#29B6E8]"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => remove(item.id)} className="p-1.5 text-white/40 hover:text-[#FF3B30]"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="text-center py-16 border border-dashed border-white/15 rounded-sm text-white/40 font-display tracking-widest">NOCH KEINE REFERENZEN</div>}
      </div>

      {editing && <ReferenceForm reference={editing} games={games} memberProfiles={memberProfiles} partners={partners} lineages={lineages} suggestions={suggestions} items={items} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </AdminLayout>
  );
}

function Stat({ label, value, tone }) {
  const color = tone === "gold" ? "text-[#FFD700]" : tone === "bronze" ? "text-[#CD7F32]" : "text-[#29B6E8]";
  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] p-4">
      <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold">{label}</div>
      <div className={`mt-1 font-display text-3xl font-black ${color}`}>{value}</div>
    </div>
  );
}

// „aus Saison …“ (#1750): die Referenz gehört zu einer Saison - der Link führt zu ihr in der Verwaltung.
function SeasonBadge({ item, lineages }) {
  const season = seasonOf(item, lineages);
  if (!season) return null;
  return (
    <Link to={`/admin/reference-series/${season.seriesId}`} data-testid={`reference-season-${item.id}`} className="inline-flex items-center gap-1 px-2 py-0.5 border border-[#29B6E8]/30 bg-[#29B6E8]/10 hover:bg-[#29B6E8]/20 rounded-sm text-[10px] uppercase tracking-widest font-bold text-[#29B6E8]">
      <Flag className="w-3 h-3" aria-hidden="true" /> aus Saison {season.label}
    </Link>
  );
}

function Chip({ children, muted = false }) {
  return <span className={`px-2 py-0.5 border rounded-sm text-[10px] uppercase tracking-widest font-bold ${muted ? "border-white/10 text-white/40" : "border-[#29B6E8]/30 bg-[#29B6E8]/10 text-[#29B6E8]"}`}>{children}</span>;
}

function helpersToForm(helpers) {
  return {
    platforms: (helpers?.platforms || []).map((item) => `${item.key} = ${item.label}`).join("\n"),
    formats: (helpers?.formats || []).join("\n"),
    leagues: (helpers?.leagues || []).join("\n"),
    seasons: (helpers?.seasons || []).join("\n"),
    organizers: (helpers?.organizers || []).join("\n"),
    game_names: (helpers?.game_names || []).join("\n"),
    team_names: (helpers?.team_names || []).join("\n"),
    placement_labels: (helpers?.placement_labels || []).join("\n"),
    locations: (helpers?.locations || []).join("\n"),
  };
}

function parseLines(value) {
  return uniqueSuggestions(String(value || "").split(/\r?\n/), 160);
}

function parsePlatformLines(value) {
  return String(value || "").split(/\r?\n/).map((line) => {
    const raw = line.trim();
    if (!raw) return null;
    const match = raw.match(/^(.+?)(?:\s*[=:]\s*(.+))?$/);
    const key = cleanSuggestion(match?.[1]);
    const label = cleanSuggestion(match?.[2]) || key;
    return key ? { key, label } : null;
  }).filter(Boolean);
}

function ReferenceHelperAdmin({ helpers, onSaved }) {
  const [form, setForm] = useState(helpersToForm(helpers));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(helpersToForm(helpers));
  }, [helpers]);

  if (!helpers) return null;

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        platforms: parsePlatformLines(form.platforms),
        formats: parseLines(form.formats),
        leagues: parseLines(form.leagues),
        seasons: parseLines(form.seasons),
        organizers: parseLines(form.organizers),
        game_names: parseLines(form.game_names),
        team_names: parseLines(form.team_names),
        placement_labels: parseLines(form.placement_labels),
        locations: parseLines(form.locations),
      };
      const { data } = await api.patch("/references/admin/helpers", payload);
      toast.success("Referenz-Helfer gespeichert.");
      onSaved(data);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className="mb-6 border border-white/10 bg-[#121212] rounded-sm">
      <summary className="cursor-pointer px-4 py-3 text-sm font-bold uppercase tracking-wider text-white/75 hover:text-[#29B6E8]">
        Vorschlagslisten verwalten
      </summary>
      <div className="border-t border-white/10 p-4 space-y-4">
        <p className="text-sm text-white/55 max-w-3xl">
          Was hier steht, erscheint als Vorschlag im Formular. Automatisch erkannte Werte aus gespeicherten Referenzen kommen dazu. Plattformen im Format <span className="font-mono text-white/80">Kürzel = Anzeige</span>, z.B. <span className="font-mono text-white/80">XBO = Xbox</span>.
        </p>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          <HelperTextArea label="Plattformen" value={form.platforms} onChange={(v) => set("platforms", v)} rows={7} />
          <HelperTextArea label="Formate (HC, CORE …)" value={form.formats} onChange={(v) => set("formats", v)} />
          <HelperTextArea label="Ligen" value={form.leagues} onChange={(v) => set("leagues", v)} />
          <HelperTextArea label="Saisons" value={form.seasons} onChange={(v) => set("seasons", v)} />
          <HelperTextArea label="Veranstalter" value={form.organizers} onChange={(v) => set("organizers", v)} rows={7} />
          <HelperTextArea label="Freie Spielnamen" value={form.game_names} onChange={(v) => set("game_names", v)} />
          <HelperTextArea label="Team-Namen" value={form.team_names} onChange={(v) => set("team_names", v)} />
          <HelperTextArea label="Platzierungslabels" value={form.placement_labels} onChange={(v) => set("placement_labels", v)} />
          <HelperTextArea label="Orte" value={form.locations} onChange={(v) => set("locations", v)} />
        </div>
        <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? "Speichere..." : "Vorschläge speichern"}
        </button>
      </div>
    </details>
  );
}

// Vitrine der Übersicht (#1878): welcher Erfolg die Hauptkarte bekommt. Vorgabe automatisch - höchster Platz in der
// höchsten Stufe, bei Gleichstand der neueste -, sonst eine der Podest-Referenzen.
const SHOWCASE_AUTO_LABEL = "Automatisch: höchster Platz in der höchsten Stufe, bei Gleichstand der neueste";

function ShowcaseAdmin({ items }) {
  const [choice, setChoice] = useState("auto");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    api.get("/references/admin/showcase").then(({ data }) => {
      if (alive) setChoice(data?.mode === "pinned" && data.reference_id ? data.reference_id : "auto");
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const podium = podiumItems(items);
  const options = [
    ["auto", SHOWCASE_AUTO_LABEL],
    ...podium.map((item) => [item.id, [`${bestPlacement(item)}. Platz`, item.display_title || item.title, yearOf(item)].filter(Boolean).join(" · ")]),
  ];
  // Eine gewählte Referenz, die nicht mehr auf dem Podest steht, bleibt sichtbar, bis jemand neu wählt.
  if (choice !== "auto" && !podium.some((item) => item.id === choice)) options.push([choice, "Gewählte Referenz (nicht mehr auf dem Podest)"]);
  const save = async () => {
    setSaving(true);
    try {
      const payload = choice === "auto" ? { mode: "auto", reference_id: null } : { mode: "pinned", reference_id: choice };
      const { data } = await api.patch("/references/admin/showcase", payload);
      setChoice(data?.mode === "pinned" && data.reference_id ? data.reference_id : "auto");
      toast.success("Hauptkarte der Vitrine gespeichert.");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="mb-4 border border-white/10 bg-surface-1 rounded-sm p-4 flex flex-wrap items-end gap-3" data-testid="reference-showcase">
      <div className="flex-1 min-w-[16rem]">
        <SelectField label="Vitrine: Hauptkarte" value={choice} onChange={setChoice} options={options} testId="reference-showcase-select" hint="Welcher Erfolg auf der Übersicht groß erscheint. Die übrigen Podestplätze stehen daneben." />
      </div>
      <button type="button" onClick={save} disabled={saving} data-testid="reference-showcase-save" className="inline-flex items-center gap-2 px-4 py-2 bg-brand text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">
        <Save className="w-4 h-4" /> {saving ? "Speichere..." : "Speichern"}
      </button>
    </div>
  );
}

function HelperTextArea({ label, value, onChange, rows = 5 }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <textarea rows={rows} value={value || ""} onChange={(e) => onChange(e.target.value)} className={`${INPUT_CLASS} text-sm font-mono leading-relaxed`} />
    </label>
  );
}

// Prüfung (#1755): Auffälligkeiten in allen gespeicherten Referenzen, auch den alten, und die Grenzen der Prüfung.
function ReferenceCheckAdmin({ items, onEdit }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ max_duration_days: "", warn_future_end: true });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: result } = await api.get("/references/admin/checks");
      setData(result || null);
      setForm({ max_duration_days: String(result?.settings?.max_duration_days ?? ""), warn_future_end: result?.settings?.warn_future_end !== false });
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => { load(); }, [load, items]);

  if (!data) return null;
  const findings = data.items || [];

  const save = async () => {
    setSaving(true);
    try {
      await api.patch("/references/admin/checks", {
        max_duration_days: Number(form.max_duration_days) || null,
        warn_future_end: Boolean(form.warn_future_end),
      });
      toast.success("Prüfung gespeichert.");
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className="mb-6 border border-white/10 bg-[#121212] rounded-sm" data-testid="reference-checks">
      <summary className="cursor-pointer px-4 py-3 text-sm font-bold uppercase tracking-wider text-white/75 hover:text-[#29B6E8]">
        Auffälligkeiten <span className={findings.length ? "text-warn" : "text-white/40"} data-testid="reference-checks-count">({findings.length})</span>
      </summary>
      <div className="border-t border-white/10 p-4 space-y-4">
        <p className="text-sm text-white/55 max-w-3xl">
          Beim Speichern wird geprüft, ob Datum und Platzierung zusammenpassen. Gespeichert wird trotzdem – hier stehen alle Referenzen mit Hinweis, auch alte. Geprüft: {data.checked ?? 0}.
        </p>
        {findings.length === 0 && <div className="text-sm text-white/45" data-testid="reference-checks-empty">Keine Auffälligkeiten.</div>}
        <ul className="space-y-2">
          {findings.map((item) => (
            <li key={item.id} className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3 flex items-start justify-between gap-3" data-testid={`reference-check-${item.id}`}>
              <div className="min-w-0">
                <div className="font-semibold text-sm">{item.title || "Ohne Titel"}{item.start_date && <span className="ml-2 text-xs text-white/45">{formatDate(item.start_date)}</span>}</div>
                <FieldWarnings messages={(item.warnings || []).map((warning) => warning.message)} />
              </div>
              <button type="button" onClick={() => onEdit(item.id)} data-testid={`reference-check-edit-${item.id}`} className="p-1.5 text-white/40 hover:text-[#29B6E8] shrink-0" aria-label="Referenz bearbeiten"><Pencil className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
        <FormGrid cols={3}>
          <TextField label="Längste Dauer (Tage)" type="number" min="1" max="3650" value={form.max_duration_days} onChange={(v) => setForm((current) => ({ ...current, max_duration_days: v }))} hint="Liegt das Ende weiter nach dem Start, kommt ein Hinweis." testId="reference-checks-days" />
          <CheckField label="Abgeschlossen, aber Ende in der Zukunft melden" checked={form.warn_future_end} onChange={(v) => setForm((current) => ({ ...current, warn_future_end: v }))} testId="reference-checks-future" className="self-center md:col-span-2" />
        </FormGrid>
        <button type="button" onClick={save} disabled={saving} data-testid="reference-checks-save" className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? "Speichere..." : "Prüfung speichern"}
        </button>
      </div>
    </details>
  );
}

function RefLink({ href, label }) {
  if (!href) return null;
  return <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-[#29B6E8] hover:underline">{label}<ExternalLink className="w-3 h-3" /></a>;
}

function formToPayload(form) {
  return {
    title: form.title.trim(),
    organizer: form.organizer.trim() || null,
    partner_ids: form.partner_ids || [],
    league: form.league.trim() || null,
    season: form.season.trim() || null,
    format: form.format.trim() || null,
    platforms: form.platforms,
    game_id: form.game_id || null,
    game_name: form.game_name.trim() || null,
    entries: form.entries.map(entryPayload),
    start_date: form.start_date || null,
    end_date: form.end_date || null,
    location: form.location.trim() || null,
    mode: form.mode,
    external_url: form.external_url.trim() || null,
    bracket_url: form.bracket_url.trim() || null,
    match_url: form.match_url.trim() || null,
    result_url: form.result_url.trim() || null,
    description: form.description.trim() || null,
    highlights: form.highlights.trim() || null,
    visibility: form.visibility,
    status: form.status,
    is_active: form.is_active !== false,
    order_index: Number(form.order_index) || 0,
    series_id: form.series_id || null,
  };
}

// Prüfung (#1755): die Formularwerte gehen kurz nach jeder Änderung an Datum, Status, Platz oder Teilnehmerzahl an
// den Server; die Warnungen erscheinen am Feld. Speichern bleibt immer möglich.
const CHECK_DELAY_MS = 400;

function useReferenceWarnings(payload) {
  const [warnings, setWarnings] = useState({});
  const key = checkKey(payload);
  const latest = useRef(payload);
  latest.current = payload;
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.post("/references/admin/checks/preview", latest.current);
        if (alive) setWarnings(warningsByField(data?.warnings));
      } catch {
        if (alive) setWarnings({});
      }
    }, CHECK_DELAY_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [key]);
  return warnings;
}

function FieldWarnings({ messages, testId }) {
  if (!messages?.length) return null;
  return (
    <div className="mt-1 space-y-0.5" role="status" data-testid={testId}>
      {messages.map((message) => (
        <div key={message} className="flex items-start gap-1.5 text-xs text-warn">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
          <span>{message}</span>
        </div>
      ))}
    </div>
  );
}

// Schnell-Eintrag (#1936): Oben steht nur, was ein Tagesturnier braucht - Turniername, Spiel, Datum, wer angetreten ist,
// „Platz von N“ und ein Link. Alles andere liegt unter „Weitere Angaben“; beim Bearbeiten ist der Bereich offen, wenn dort
// etwas steht. Neue Referenzen bekommen den Status nach dem Datum, bis jemand ihn selbst wählt.
function ReferenceForm({ reference, games, memberProfiles, partners = [], lineages = [], suggestions, items = [], onClose, onSaved }) {
  const isNew = !reference.id;
  const today = viennaDay(new Date());
  // Eine Referenz des Saisonabschlusses kennt ihre Saison auch ohne eigenes `series_id` (#1750).
  const [form, setForm] = useState(() => {
    const initial = { ...referenceToForm(reference), series_id: reference.series_id || seasonOf(reference, lineages)?.seriesId || "" };
    return isNew && initial.entries.length === 0 ? { ...initial, entries: [emptyEntry("team")] } : initial;
  });
  const [moreOpen] = useState(() => !isNew && hasMoreDetails(form, today));
  const [statusTouched, setStatusTouched] = useState(!isNew);
  const season = seasonOf({ id: reference.id, series_id: form.series_id }, lineages);
  const last = useMemo(() => (isNew ? lastReference(items) : null), [isNew, items]);
  const [saving, setSaving] = useState(false);
  const [platformInput, setPlatformInput] = useState("");
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const setDay = (value) => setForm((current) => ({ ...current, ...quickDate(current, value) }));
  const setEntry = (key, patch) => setForm((current) => ({
    ...current,
    entries: current.entries.map((entry) => (entry.key === key ? { ...entry, ...(typeof patch === "function" ? patch(entry) : patch) } : entry)),
  }));
  const addEntry = (kind) => setForm((current) => ({ ...current, entries: [...current.entries, emptyEntry(kind)] }));
  const removeEntry = (key) => setForm((current) => ({ ...current, entries: current.entries.filter((entry) => entry.key !== key) }));
  const togglePlatform = (key) => setForm((current) => ({
    ...current,
    platforms: current.platforms.includes(key) ? current.platforms.filter((item) => item !== key) : [...current.platforms, key],
  }));
  const addPlatform = () => {
    const key = platformInput.trim();
    if (!key) return;
    if (!form.platforms.includes(key)) set("platforms", [...form.platforms, key]);
    setPlatformInput("");
  };

  // Vorgabe: Status nach dem Datum (#1936) - nur bei neuen Referenzen und nur, bis jemand ihn selbst wählt.
  // Steht irgendein Eintrag schon mit Platz, gilt ein Turnier von heute als abgeschlossen.
  const autoStatus = (day) => quickStatus(form.start_date, anyPlacement(form.entries), day);
  const status = statusTouched ? (form.status || "completed") : autoStatus(today);
  const payload = useMemo(() => formToPayload({ ...form, status }), [form, status]);
  const warnings = useReferenceWarnings(payload);
  const warningsAt = (field) => warnings[field] || [];

  const save = async (e) => {
    e.preventDefault();
    if (form.entries.length === 0) {
      toast.error("Bitte mindestens einen Eintrag anlegen: ein Team oder einen Einzelstarter.");
      return;
    }
    setSaving(true);
    try {
      // Stand beim Öffnen (#1750): hat inzwischen etwa der Abschluss der Saison die Referenz geändert, sagt der Server 409.
      const url = `/references/${reference.id}`;
      // Der Wiener Tag gilt beim Speichern - ein über Mitternacht offenes Formular nimmt den neuen Tag (#1936).
      const body = statusTouched ? payload : { ...payload, status: autoStatus(viennaDay(new Date())) };
      const request = isNew ? api.post("/references", body)
        : reference.updated_at ? api.patch(url, body, { params: { expected_updated_at: reference.updated_at } }) : api.patch(url, body);
      const { data } = await request;
      // Prüfung (#1755): gespeichert ist trotzdem - die Hinweise stehen danach unter „Auffälligkeiten“.
      const summary = warningSummary(data?.check_warnings);
      if (summary) toast.warning(summary);
      else toast.success("Referenz gespeichert.");
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  const platformChoices = useMemo(() => {
    const rows = [...suggestions.platforms];
    form.platforms.forEach((key) => {
      if (!rows.some((row) => row.key === key)) rows.push({ key, label: key });
    });
    return rows;
  }, [form.platforms, suggestions.platforms]);

  return (
    <AdminSheet title={isNew ? "Neue Referenz" : "Referenz bearbeiten"} eyebrow="Verein" size="xl" onClose={onClose} onSubmit={save} saving={saving} submitTestId="reference-save" testId="reference-sheet">
      {season?.seasonEnd && (
        <p className="border border-[#29B6E8]/30 bg-[#29B6E8]/5 rounded-sm px-3 py-2 text-sm text-white/75" data-testid="reference-season-end">
          Referenz des Saisonabschlusses: Ihr Endplatz wird in der Saison gepflegt – <Link to={`/admin/reference-series/${season.seriesId}`} className="text-[#29B6E8] font-semibold underline-offset-2 hover:underline">zur Saison</Link>, dort „Saison abschließen“.
        </p>
      )}

      <FormSection title="Turnier" hint="Für ein Tagesturnier reicht, was hier steht. Veranstalter, Liga, Format und mehr unter „Weitere Angaben“.">
        {last && (
          <button type="button" onClick={() => setForm((current) => likeLastTime(current, last))} data-testid="reference-like-last" className="w-full sm:w-auto inline-flex items-center gap-2 px-3 py-2 border border-[#29B6E8]/45 rounded-sm text-left text-xs font-bold text-[#29B6E8] hover:bg-[#29B6E8]/10">
            <History className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0"><span className="uppercase tracking-wider">Wie letztes Mal</span> <span className="font-normal text-white/55 normal-case tracking-normal">– Spiel, Veranstalter und Team von „{last.display_title || last.title}“</span></span>
          </button>
        )}
        <TextField label="Turniername" value={form.title} onChange={(v) => set("title", v)} suggestions={suggestions.titles} required testId="reference-title" placeholder="z.B. Autumn Cup 2026" />
        <FormGrid>
          <SelectField label="Spiel" value={form.game_id || ""} onChange={(v) => set("game_id", v)} options={[["", "— Spiel wählen —"], ...games.map((game) => [game.id, gameOptionLabel(game)])]} testId="reference-game" />
          <GermanDateField id="reference-start-date" label="Datum" value={(form.start_date || "").slice(0, 10)} onChange={setDay} testId="reference-start-date" allowFuture />
        </FormGrid>
        <TextField label="Link (optional)" value={form.external_url} onChange={(v) => set("external_url", v)} placeholder="https://..." testId="reference-link" hint="Turnierseite oder Ergebnis. Weitere Links unter „Weitere Angaben“." />
      </FormSection>

      <FormSection title="Wer und Platz" hint="Ein Team oder ein Spieler aus den Vereinsprofilen. Beides ist in derselben Teilnahme möglich.">
        {form.entries.length === 0 && (
          <div className="border border-dashed border-white/15 rounded-sm p-4 text-sm text-white/45" data-testid="reference-entries-empty">Noch kein Eintrag – lege ein Team oder einen Einzelstarter an.</div>
        )}
        {form.entries.map((entry, index) => (
          <QuickEntry
            key={entry.key}
            entry={entry}
            index={index}
            profiles={memberProfiles}
            suggestions={suggestions}
            onChange={(patch) => setEntry(entry.key, patch)}
            onRemove={() => removeEntry(entry.key)}
            warnings={warningsAt(`entries.${index}.placement`)}
          />
        ))}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => addEntry("team")} data-testid="reference-add-team" className="inline-flex items-center gap-2 px-3 py-2 border border-[#29B6E8]/45 rounded-sm text-xs uppercase tracking-wider font-bold text-[#29B6E8] hover:bg-[#29B6E8]/10"><Users className="w-3.5 h-3.5" /> Team hinzufügen</button>
          <button type="button" onClick={() => addEntry("solo")} data-testid="reference-add-solo" className="inline-flex items-center gap-2 px-3 py-2 border border-[#29B6E8]/45 rounded-sm text-xs uppercase tracking-wider font-bold text-[#29B6E8] hover:bg-[#29B6E8]/10"><User className="w-3.5 h-3.5" /> Einzelstarter hinzufügen</button>
        </div>
      </FormSection>

      <FormSection collapsible defaultOpen={moreOpen} title="Weitere Angaben" hint="Veranstalter, Partner, Liga und Saison, Format, Plattformen, Ort, Modus, weitere Links, Texte und Anzeige." testId="reference-more">
        <FormSection plain title="Veranstalter und Liga" hint="Plattform, Format, Liga und Saison sind eigene Felder – der Titel ist nur noch der Turniername.">
          <FormGrid cols={3}>
            <TextField label="Veranstalter" value={form.organizer} onChange={(v) => set("organizer", v)} suggestions={suggestions.organizers} testId="reference-organizer" />
            <TextField label="Liga" value={form.league} onChange={(v) => set("league", v)} suggestions={suggestions.leagues} testId="reference-league" placeholder="z.B. Liga A" />
            <TextField label="Saison" value={form.season} onChange={(v) => set("season", v)} suggestions={suggestions.seasons} testId="reference-season" placeholder="z.B. Season 3 oder 2026" />
          </FormGrid>
          <SelectField label="Gehört zur Saison" value={form.series_id} onChange={(v) => set("series_id", v)} options={seasonOptions(lineages, form.series_id)} testId="reference-series"
            hint="Für eine Liga oder Serie: Die Karte führt dann zur Saison-Seite, und beim Abschluss der Saison wird diese Referenz aktualisiert statt doppelt angelegt. Sichtbar ist sie höchstens so offen wie die Saison." />
          <PartnerPicker partners={partners} value={form.partner_ids} onChange={(v) => set("partner_ids", v)} testPrefix="reference-partner" hint="Der Partner zeigt die Referenz auf seiner Seite unter „Gemeinsam“. Steht ein Partner als Veranstalter, gehört sie ihm auch ohne Haken." />
        </FormSection>

        <FormSection plain title="Format und Plattformen">
          <FormGrid>
            <TextField label="Format" value={form.format} onChange={(v) => set("format", v)} suggestions={suggestions.formats} testId="reference-format" placeholder="z.B. HC, CORE, S&D 4vs4" />
            <TextField label="Spielname falls nicht vorhanden" value={form.game_name} onChange={(v) => set("game_name", v)} suggestions={suggestions.gameNames} testId="reference-game-name" />
          </FormGrid>
          <FieldLabel label="Plattformen" hint="Mehrfachauswahl; eigene mit Enter hinzufügen.">
            <div className="flex flex-wrap gap-1.5" data-testid="reference-platforms">
              {platformChoices.map((platform) => (
                <button
                  key={platform.key}
                  type="button"
                  onClick={() => togglePlatform(platform.key)}
                  data-testid={`reference-platform-${platform.key}`}
                  className={`px-2.5 py-1 border rounded-sm text-[11px] font-bold uppercase tracking-wider ${form.platforms.includes(platform.key) ? "border-[#29B6E8] bg-[#29B6E8]/15 text-[#29B6E8]" : "border-white/10 bg-[#121212] text-white/60 hover:border-white/30"}`}
                >
                  {platform.label}
                </button>
              ))}
              <input
                value={platformInput}
                onChange={(e) => setPlatformInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPlatform(); } }}
                onBlur={addPlatform}
                placeholder="Weitere …"
                data-testid="reference-platform-input"
                className="bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-2.5 py-1 rounded-sm text-[11px] text-white focus:outline-none w-28"
              />
            </div>
          </FieldLabel>
        </FormSection>

        <FormSection plain title="Ablauf" hint="Das Ende nur bei mehreren Tagen – sonst gilt das Datum oben.">
          <FormGrid cols={3}>
            <GermanDateField id="reference-end-date" label="Ende" value={(form.end_date || "").slice(0, 10)} onChange={(v) => set("end_date", v)} testId="reference-end-date" allowFuture />
            <TextField label="Ort" value={form.location} onChange={(v) => set("location", v)} suggestions={suggestions.locations} testId="reference-location" />
            <SelectField label="Modus" value={form.mode} onChange={(v) => set("mode", v)} options={MODE_OPTIONS} testId="reference-mode" />
          </FormGrid>
          <FieldWarnings messages={warningsAt("end_date")} testId="reference-end-date-warnings" />
          <FormGrid cols={3}>
            <TextField label="Bracket / Tabelle" value={form.bracket_url} onChange={(v) => set("bracket_url", v)} placeholder="https://..." testId="reference-bracket-url" />
            <TextField label="Match-Webseite" value={form.match_url} onChange={(v) => set("match_url", v)} placeholder="https://..." testId="reference-match-url" />
            <TextField label="Ergebnis-Link" value={form.result_url} onChange={(v) => set("result_url", v)} placeholder="https://..." testId="reference-result-url" />
          </FormGrid>
        </FormSection>

        {form.entries.length > 0 && (
          <FormSection plain title="Zu den Einträgen" hint="Label der Platzierung, externe Spieler ohne Vereinsprofil und die zweite Feldgröße.">
            {form.entries.map((entry, index) => (
              <EntryDetails key={entry.key} entry={entry} index={index} suggestions={suggestions} onChange={(patch) => setEntry(entry.key, patch)} />
            ))}
          </FormSection>
        )}

        <FormSection plain title="Anzeige">
          <FormGrid cols={4}>
            <SelectField label="Status" value={status} onChange={(v) => { setStatusTouched(true); set("status", v); }} options={STATUS_OPTIONS} testId="reference-status" hint={statusTouched ? undefined : "Automatisch nach dem Datum."} />
            <SelectField label="Sichtbarkeit" value={form.visibility} onChange={(v) => set("visibility", v)} options={VISIBILITY_OPTIONS} testId="reference-visibility" />
            <TextField label="Reihenfolge" type="number" value={form.order_index} onChange={(v) => set("order_index", v)} testId="reference-order" hint="0 = automatisch nach Datum." />
            <CheckField label="Aktiv" checked={form.is_active !== false} onChange={(v) => set("is_active", v)} testId="reference-active" className="self-end pb-2" />
          </FormGrid>
        </FormSection>

        <FormSection plain title="Texte">
          <TextAreaField label="Beschreibung" value={form.description} onChange={(v) => set("description", v)} testId="reference-description" />
          <TextAreaField label="Highlights / Notizen" value={form.highlights} onChange={(v) => set("highlights", v)} testId="reference-highlights" />
        </FormSection>
      </FormSection>
    </AdminSheet>
  );
}

// Ein Eintrag im Schnell-Eintrag (#1936): Team oder Einzelstarter, wer aus den Vereinsprofilen, „Platz von N“.
function QuickEntry({ entry, index, profiles, suggestions, onChange, onRemove, warnings = [] }) {
  const isSolo = entry.kind === "solo";
  const count = countKey(entry);
  const toggleMember = (profileId) => onChange((current) => {
    const ids = current.member_profile_ids || [];
    if (current.kind === "solo") return { ...current, member_profile_ids: ids.includes(profileId) ? [] : [profileId] };
    return { ...current, member_profile_ids: ids.includes(profileId) ? ids.filter((id) => id !== profileId) : [...ids, profileId] };
  });
  const setKind = (kind) => onChange((current) => ({
    ...current,
    kind,
    team_name: kind === "team" ? (current.team_name || "THE LION SQUAD") : "",
    member_profile_ids: kind === "solo" ? (current.member_profile_ids || []).slice(0, 1) : current.member_profile_ids,
  }));
  return (
    <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-4 space-y-3" data-testid={`reference-entry-${index}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">
          {isSolo ? <User className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />} Eintrag {index + 1} · {isSolo ? "Einzelstarter" : "Team"}
        </div>
        <button type="button" onClick={onRemove} aria-label="Eintrag entfernen" data-testid={`reference-entry-${index}-remove`} className="p-1 text-white/40 hover:text-[#FF3B30]"><Trash2 className="w-4 h-4" /></button>
      </div>
      <FormGrid cols={3}>
        <SelectField label="Art" value={entry.kind} onChange={setKind} options={KIND_OPTIONS} testId={`reference-entry-${index}-kind`} />
        {!isSolo && <TextField label="Teamname" value={entry.team_name} onChange={(v) => onChange({ team_name: v })} suggestions={suggestions.teamNames} testId={`reference-entry-${index}-team`} className="md:col-span-2" />}
      </FormGrid>
      <MemberPicker
        profiles={profiles}
        selectedIds={entry.member_profile_ids || []}
        frozenMembers={entry.lineup_members || []}
        onToggle={toggleMember}
        single={isSolo}
        testIdPrefix={`reference-entry-${index}`}
      />
      {/* Platz und „von N“ auch am Handy nebeneinander (#1936): zwei kurze Zahlen, eine Zeile. */}
      <FormGrid className="grid-cols-2 items-end">
        <TextField label="Platz" type="number" min="1" value={entry.placement} onChange={(v) => onChange({ placement: v })} testId={`reference-entry-${index}-placement`} />
        <TextField label={count === "team_count" ? "von … Teams" : "von … Teilnehmern"} type="number" min="1" value={entry[count]} onChange={(v) => onChange({ [count]: v })} testId={`reference-entry-${index}-count`} />
      </FormGrid>
      <FieldWarnings messages={warnings} testId={`reference-entry-${index}-warnings`} />
    </div>
  );
}

// Was zu einem Eintrag sonst noch gehört (#1936) - unter „Weitere Angaben“: Label, externe Spieler, die zweite Feldgröße.
function EntryDetails({ entry, index, suggestions, onChange }) {
  const isSolo = entry.kind === "solo";
  const other = countKey(entry) === "team_count" ? "participant_count" : "team_count";
  const who = isSolo ? "Einzelstarter" : (entry.team_name || "Team");
  return (
    <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3 space-y-3" data-testid={`reference-entry-${index}-details`}>
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/55">Eintrag {index + 1} · {who}</div>
      <TextField label={isSolo ? "Externer Spieler (falls kein Vereinsprofil)" : "Weitere externe Spieler"} value={entry.lineup_text} onChange={(v) => onChange({ lineup_text: v })} placeholder={isSolo ? "Name" : "Name 1, Name 2, Name 3"} testId={`reference-entry-${index}-lineup`} />
      <FormGrid>
        <TextField label="Label" value={entry.placement_label} onChange={(v) => onChange({ placement_label: v })} placeholder="z.B. Podium" suggestions={suggestions.placementLabels} testId={`reference-entry-${index}-label`} />
        {other === "participant_count"
          ? <TextField label="Teilnehmer" type="number" min="1" value={entry.participant_count} onChange={(v) => onChange({ participant_count: v })} testId={`reference-entry-${index}-participants`} />
          : <TextField label="Teams" type="number" min="1" value={entry.team_count} onChange={(v) => onChange({ team_count: v })} testId={`reference-entry-${index}-teams`} />}
      </FormGrid>
    </div>
  );
}

function MemberPicker({ profiles, selectedIds, frozenMembers, onToggle, single = false, testIdPrefix = "reference" }) {
  const selected = new Set(selectedIds || []);
  const sorted = [...(profiles || [])].sort((a, b) => memberName(a).localeCompare(memberName(b)));
  const missing = (frozenMembers || []).filter((member) => member.profile_id && !sorted.some((profile) => profile.id === member.profile_id));
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-3">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Vereinsspieler</div>
          <div className="text-xs text-white/45 mt-1">{single ? "Eine Person." : "Mehrfachauswahl."} Namen werden beim Speichern eingefroren, damit alte Referenzen erhalten bleiben.</div>
        </div>
        <div className="text-xs text-[#29B6E8] font-bold">{selected.size} ausgewählt</div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
        {sorted.map((profile) => (
          <label key={profile.id} className={`flex items-center gap-2 border rounded-sm px-3 py-2 text-sm cursor-pointer ${selected.has(profile.id) ? "border-[#29B6E8]/60 bg-[#29B6E8]/10 text-white" : "border-white/10 bg-[#0A0A0A] text-white/65 hover:border-white/25"}`}>
            <input type={single ? "radio" : "checkbox"} checked={selected.has(profile.id)} onChange={() => onToggle(profile.id)} onClick={single && selected.has(profile.id) ? () => onToggle(profile.id) : undefined} data-testid={`${testIdPrefix}-member-${profile.id}`} className="accent-[#29B6E8]" />
            <span className="min-w-0">
              <span className="block truncate font-semibold">{memberName(profile)}</span>
              {profile.is_active === false && <span className="block text-[10px] uppercase tracking-widest text-[#FFD700]">inaktiv</span>}
            </span>
          </label>
        ))}
        {sorted.length === 0 && <div className="text-sm text-white/40">Keine Vereinsprofile vorhanden.</div>}
      </div>
      {missing.length > 0 && (
        <div className="mt-3 text-xs text-white/45">
          Gespeicherte ehemalige Profile: {missing.map((member) => member.display_name || member.profile_id).join(", ")}
        </div>
      )}
    </div>
  );
}

function memberName(profile) {
  return profile?.gamertag || profile?.display_name || profile?.real_name || profile?.linked_account?.display_name || profile?.linked_account?.username || "Unbekannt";
}

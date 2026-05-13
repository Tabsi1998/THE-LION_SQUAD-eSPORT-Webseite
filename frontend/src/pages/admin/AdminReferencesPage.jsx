import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { gameOptionLabel } from "@/lib/gameLabels";
import { toast } from "sonner";
import { ExternalLink, Pencil, Plus, Save, Trash2, X } from "lucide-react";

const emptyReference = {
  title: "",
  organizer: "",
  game_id: "",
  game_name: "",
  team_name: "THE LION SQUAD",
  lineup: [],
  member_profile_ids: [],
  lineup_members: [],
  placement: "",
  placement_label: "",
  participant_count: "",
  team_count: "",
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
};

const VISIBILITY_OPTIONS = [["public", "Öffentlich"], ["community", "Community"], ["members", "Vereinsmitglieder"], ["internal", "Intern"]];
const MODE_OPTIONS = [["online", "Online"], ["offline", "Vor Ort"], ["hybrid", "Hybrid"]];
const STATUS_OPTIONS = [["active", "Laufend"], ["planned", "Geplant"], ["completed", "Abgeschlossen"], ["archived", "Archiviert"]];
const medalLabel = { gold: "Gold", silver: "Silber", bronze: "Bronze" };
const visibilityLabel = Object.fromEntries(VISIBILITY_OPTIONS);
const statusLabel = Object.fromEntries(STATUS_OPTIONS);
const DEFAULT_PLATFORM_TAGS = ["ALL", "Xbox", "PlayStation", "PC", "XBO+PS", "PS", "XBO"];
const DEFAULT_TITLE_SEGMENTS = ["HC", "CORE", "S&D 4vs4", "S&D 2vs2", "S&Z 4vs4", "S&Z 2vs2", "LIGA A", "NEWCOMER LIGA"];

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

function titleParts(title) {
  const raw = cleanSuggestion(title);
  const platforms = [...raw.matchAll(/\[([^\]]+)\]/g)].flatMap((match) => match[1].split(/[+/,&]/).map(cleanSuggestion));
  const withoutTags = raw.replace(/\[[^\]]+\]\s*/g, " ");
  const segments = withoutTags
    .split(/\s+\|\s+|[-–—]/)
    .map((part) => part.replace(/season\s*#?\d+/ig, "").trim())
    .filter((part) => part.length >= 2 && part.length <= 24 && !/^\d+$/.test(part));
  const modeTokens = [...withoutTags.matchAll(/\b(HC|CORE|S&D\s*\d+vs\d+|S&Z\s*\d+vs\d+|SEARCH\s*&\s*DESTROY)\b/ig)]
    .map((match) => match[1].replace(/\s+/g, " ").toUpperCase());
  return { platforms, segments: [...segments, ...modeTokens] };
}

function helperList(helpers, key) {
  return Array.isArray(helpers?.[key]) ? helpers[key] : [];
}

function helperPlatformKeys(helpers) {
  return helperList(helpers, "platforms").map((item) => item?.key || item).filter(Boolean);
}

function buildReferenceSuggestions(items, helpers) {
  const parsedTitles = (items || []).map((item) => titleParts(item.title));
  const auto = helpers?.auto || {};
  return {
    titles: uniqueSuggestions((items || []).map((item) => item.title), 160),
    organizers: uniqueSuggestions([...helperList(helpers, "organizers"), ...helperList(auto, "organizers"), ...(items || []).map((item) => item.organizer)]),
    gameNames: uniqueSuggestions([...helperList(helpers, "game_names"), ...helperList(auto, "game_names"), ...(items || []).map((item) => item.game_name)]),
    teamNames: uniqueSuggestions([...helperList(helpers, "team_names"), ...helperList(auto, "team_names"), ...(items || []).map((item) => item.team_name)]),
    placementLabels: uniqueSuggestions([...helperList(helpers, "placement_labels"), ...helperList(auto, "placement_labels"), ...(items || []).map((item) => item.placement_label)]),
    locations: uniqueSuggestions([...helperList(helpers, "locations"), ...helperList(auto, "locations"), ...(items || []).map((item) => item.location)]),
    platformTags: uniqueSuggestions([...helperPlatformKeys(helpers), ...helperPlatformKeys(auto), ...DEFAULT_PLATFORM_TAGS, ...parsedTitles.flatMap((part) => part.platforms)], 30),
    titleSegments: uniqueSuggestions([...helperList(helpers, "title_segments"), ...helperList(auto, "title_segments"), ...DEFAULT_TITLE_SEGMENTS, ...parsedTitles.flatMap((part) => part.segments)], 40),
  };
}

function upsertLeadingTag(title, tag) {
  const value = cleanSuggestion(title);
  const nextTag = `[${tag}]`;
  if (!value) return `${nextTag} `;
  if (/^\[[^\]]+\]/.test(value)) return value.replace(/^\[[^\]]+\]/, nextTag);
  return `${nextTag} ${value}`;
}

function appendTitleSegment(title, segment) {
  const value = cleanSuggestion(title);
  if (!value) return segment;
  if (value.toLocaleLowerCase("de-AT").includes(segment.toLocaleLowerCase("de-AT"))) return value;
  return `${value} | ${segment}`;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("de-DE", { dateStyle: "medium" });
}

export default function AdminReferencesPage() {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({});
  const [games, setGames] = useState([]);
  const [memberProfiles, setMemberProfiles] = useState([]);
  const [helperSettings, setHelperSettings] = useState(null);
  const [editing, setEditing] = useState(null);
  const confirm = useConfirm();
  const suggestions = useMemo(() => buildReferenceSuggestions(items, helperSettings), [items, helperSettings]);

  const load = useCallback(async () => {
    const [{ data: refs }, { data: gameRows }, { data: profileRows }, { data: helpers }] = await Promise.all([
      api.get("/references/admin"),
      api.get("/games"),
      api.get("/membership/profiles/admin/all"),
      api.get("/references/admin/helpers"),
    ]);
    setItems(refs.items || []);
    setSummary(refs.summary || {});
    setGames(gameRows || []);
    setMemberProfiles(profileRows || []);
    setHelperSettings(helpers || null);
  }, []);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["references", "games"]);

  const remove = async (id) => {
    if (!await confirm({ title: "Referenz löschen?", description: "Der externe Turniereintrag wird dauerhaft entfernt.", confirmLabel: "Löschen" })) return;
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
          <p className="mt-2 text-white/60 text-sm max-w-xl">Externe Turniere, Ligen und Matches, bei denen THE LION SQUAD teilnimmt oder teilgenommen hat.</p>
        </div>
        <button onClick={() => setEditing(emptyReference)} className="px-5 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> Neue Referenz
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-6">
        <Stat label="Turniere" value={summary.total || 0} />
        <Stat label="Laufend" value={summary.active || 0} />
        <Stat label="Geplant" value={summary.planned || 0} />
        <Stat label="Podest" value={summary.podiums || 0} />
        <Stat label="Gold" value={summary.gold || 0} tone="gold" />
        <Stat label="Silber" value={summary.silver || 0} />
        <Stat label="Bronze" value={summary.bronze || 0} tone="bronze" />
        <Stat label="Spiele" value={summary.games || 0} />
      </div>

      <ReferenceHelperAdmin helpers={helperSettings} onSaved={(helpers) => { setHelperSettings(helpers); load(); }} />

      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="border border-white/10 rounded-sm bg-[#121212] p-4">
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
                <h2 className="mt-1 font-heading text-xl font-black uppercase leading-tight">{item.title}</h2>
                <div className="mt-1 text-sm text-white/60">
                  {item.organizer || "Veranstalter offen"} · {item.team_name || "THE LION SQUAD"}
                  {item.placement && ` · Platz ${item.placement}${item.participant_count ? ` von ${item.participant_count}` : ""}`}
                </div>
                {referenceLineup(item).length > 0 && (
                  <div className="mt-2 text-xs text-white/45">Lineup: {referenceLineup(item).join(", ")}</div>
                )}
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
                <button onClick={() => setEditing(item)} className="p-1.5 text-white/40 hover:text-[#29B6E8]"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => remove(item.id)} className="p-1.5 text-white/40 hover:text-[#FF3B30]"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="text-center py-16 border border-dashed border-white/15 rounded-sm text-white/40 font-display tracking-widest">NOCH KEINE REFERENZEN</div>}
      </div>

      {editing && <ReferenceForm reference={editing} games={games} memberProfiles={memberProfiles} suggestions={suggestions} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
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

function helpersToForm(helpers) {
  return {
    platforms: (helpers?.platforms || []).map((item) => `${item.key} = ${item.label}`).join("\n"),
    organizers: (helpers?.organizers || []).join("\n"),
    title_segments: (helpers?.title_segments || []).join("\n"),
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
        organizers: parseLines(form.organizers),
        title_segments: parseLines(form.title_segments),
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
        Referenz-Helfer verwalten
      </summary>
      <div className="border-t border-white/10 p-4 space-y-4">
        <p className="text-sm text-white/55 max-w-3xl">
          Manuelle Helfer bleiben gespeichert. Automatisch erkannte Werte aus Referenzen kommen zusätzlich dazu. Plattformen im Format <span className="font-mono text-white/80">Tag = Anzeige</span>, z.B. <span className="font-mono text-white/80">XBO = Xbox</span>.
        </p>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          <HelperTextArea label="Plattformen" value={form.platforms} onChange={(v) => set("platforms", v)} rows={7} />
          <HelperTextArea label="Veranstalter / Ligen" value={form.organizers} onChange={(v) => set("organizers", v)} rows={7} />
          <HelperTextArea label="Modus-/Titel-Bausteine" value={form.title_segments} onChange={(v) => set("title_segments", v)} rows={7} />
          <HelperTextArea label="Freie Spielnamen" value={form.game_names} onChange={(v) => set("game_names", v)} />
          <HelperTextArea label="Team-/Lineup-Namen" value={form.team_names} onChange={(v) => set("team_names", v)} />
          <HelperTextArea label="Platzierungslabels" value={form.placement_labels} onChange={(v) => set("placement_labels", v)} />
          <HelperTextArea label="Orte" value={form.locations} onChange={(v) => set("locations", v)} />
        </div>
        <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? "Speichere..." : "Helfer speichern"}
        </button>
      </div>
    </details>
  );
}

function HelperTextArea({ label, value, onChange, rows = 5 }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <textarea rows={rows} value={value || ""} onChange={(e) => onChange(e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono leading-relaxed" />
    </label>
  );
}

function RefLink({ href, label }) {
  if (!href) return null;
  return <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-[#29B6E8] hover:underline">{label}<ExternalLink className="w-3 h-3" /></a>;
}

function referenceLineup(item) {
  const memberNames = (item.lineup_members || []).map((member) => member.display_name).filter(Boolean);
  return [...memberNames, ...(item.lineup || [])];
}

function ReferenceForm({ reference, games, memberProfiles, suggestions, onClose, onSaved }) {
  const isNew = !reference.id;
  const [form, setForm] = useState({
    ...emptyReference,
    ...reference,
    lineup: reference.lineup || [],
    member_profile_ids: reference.member_profile_ids || [],
    lineup_members: reference.lineup_members || [],
  });
  const [saving, setSaving] = useState(false);
  const [lineupText, setLineupText] = useState((reference.lineup || []).join(", "));
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const toggleMember = (profileId) => setForm((current) => {
    const ids = current.member_profile_ids || [];
    return {
      ...current,
      member_profile_ids: ids.includes(profileId)
        ? ids.filter((id) => id !== profileId)
        : [...ids, profileId],
    };
  });

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      ...form,
      lineup: lineupText.split(",").map((name) => name.trim()).filter(Boolean),
      member_profile_ids: form.member_profile_ids || [],
      placement: positiveNumberOrNull(form.placement),
      participant_count: positiveNumberOrNull(form.participant_count),
      team_count: positiveNumberOrNull(form.team_count),
      order_index: Number(form.order_index) || 0,
      game_id: form.game_id || null,
    };
    try {
      if (isNew) await api.post("/references", payload);
      else await api.patch(`/references/${reference.id}`, payload);
      toast.success("Referenz gespeichert.");
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={save} className="bg-[#121212] border border-white/10 rounded-sm max-w-3xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-xl font-bold uppercase">{isNew ? "Neue Referenz" : "Referenz bearbeiten"}</h3>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <Field label="Titel" value={form.title} onChange={(v) => set("title", v)} suggestions={suggestions.titles} required />
        <TitleHelper
          platforms={suggestions.platformTags}
          segments={suggestions.titleSegments}
          onPlatform={(tag) => set("title", upsertLeadingTag(form.title, tag))}
          onSegment={(segment) => set("title", appendTitleSegment(form.title, segment))}
        />
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Veranstalter / Liga" value={form.organizer} onChange={(v) => set("organizer", v)} suggestions={suggestions.organizers} />
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Spiel</div>
            <select value={form.game_id || ""} onChange={(e) => set("game_id", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              <option value="">— Spiel wählen —</option>
              {games.map((game) => <option key={game.id} value={game.id}>{gameOptionLabel(game)}</option>)}
            </select>
          </label>
          <Field label="Spielname falls nicht vorhanden" value={form.game_name} onChange={(v) => set("game_name", v)} suggestions={suggestions.gameNames} />
          <Field label="Team / Lineup-Name" value={form.team_name} onChange={(v) => set("team_name", v)} suggestions={suggestions.teamNames} />
        </div>
        <MemberPicker
          profiles={memberProfiles}
          selectedIds={form.member_profile_ids || []}
          frozenMembers={form.lineup_members || []}
          onToggle={toggleMember}
        />
        <Field label="Weitere externe Spieler / alter Lineup-Text" value={lineupText} onChange={setLineupText} placeholder="Name 1, Name 2, Name 3" />
        <div className="grid md:grid-cols-4 gap-3">
          <Field label="Platz" type="number" value={form.placement} onChange={(v) => set("placement", v)} />
          <Field label="Label" value={form.placement_label} onChange={(v) => set("placement_label", v)} placeholder="z.B. Podium" suggestions={suggestions.placementLabels} />
          <Field label="Teilnehmer" type="number" value={form.participant_count} onChange={(v) => set("participant_count", v)} />
          <Field label="Teams" type="number" value={form.team_count} onChange={(v) => set("team_count", v)} />
        </div>
        <div className="grid md:grid-cols-4 gap-3">
          <Field label="Start" type="date" value={form.start_date} onChange={(v) => set("start_date", v)} />
          <Field label="Ende" type="date" value={form.end_date} onChange={(v) => set("end_date", v)} />
          <Field label="Ort" value={form.location} onChange={(v) => set("location", v)} suggestions={suggestions.locations} />
          <Select label="Modus" value={form.mode} onChange={(v) => set("mode", v)} options={MODE_OPTIONS} />
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Turnier-Webseite" value={form.external_url} onChange={(v) => set("external_url", v)} placeholder="https://..." />
          <Field label="Bracket / Tabelle" value={form.bracket_url} onChange={(v) => set("bracket_url", v)} placeholder="https://..." />
          <Field label="Match-Webseite" value={form.match_url} onChange={(v) => set("match_url", v)} placeholder="https://..." />
          <Field label="Ergebnis-Link" value={form.result_url} onChange={(v) => set("result_url", v)} placeholder="https://..." />
        </div>
        <div className="grid md:grid-cols-4 gap-3">
          <Select label="Status" value={form.status || "completed"} onChange={(v) => set("status", v)} options={STATUS_OPTIONS} />
          <Select label="Sichtbarkeit" value={form.visibility} onChange={(v) => set("visibility", v)} options={VISIBILITY_OPTIONS} />
          <Field label="Reihenfolge" type="number" value={form.order_index} onChange={(v) => set("order_index", v)} />
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={form.is_active !== false} onChange={(e) => set("is_active", e.target.checked)} className="accent-[#29B6E8]" /> Aktiv</label>
        </div>
        <TextArea label="Beschreibung" value={form.description} onChange={(v) => set("description", v)} />
        <TextArea label="Highlights / Notizen" value={form.highlights} onChange={(v) => set("highlights", v)} />
        <div className="flex gap-2 pt-2">
          <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">{saving ? "Speichere..." : "Speichern"}</button>
          <button type="button" onClick={onClose} className="px-4 py-2 border border-white/20 text-white font-bold uppercase tracking-wider rounded-sm">Abbrechen</button>
        </div>
      </form>
    </div>
  );
}

function MemberPicker({ profiles, selectedIds, frozenMembers, onToggle }) {
  const selected = new Set(selectedIds || []);
  const sorted = [...(profiles || [])].sort((a, b) => memberName(a).localeCompare(memberName(b)));
  const missing = (frozenMembers || []).filter((member) => member.profile_id && !sorted.some((profile) => profile.id === member.profile_id));
  return (
    <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Vereinsspieler</div>
          <div className="text-xs text-white/45 mt-1">Mehrfachauswahl. Namen werden beim Speichern eingefroren, damit alte Referenzen erhalten bleiben.</div>
        </div>
        <div className="text-xs text-[#29B6E8] font-bold">{selected.size} ausgewählt</div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
        {sorted.map((profile) => (
          <label key={profile.id} className={`flex items-center gap-2 border rounded-sm px-3 py-2 text-sm cursor-pointer ${selected.has(profile.id) ? "border-[#29B6E8]/60 bg-[#29B6E8]/10 text-white" : "border-white/10 bg-[#121212] text-white/65 hover:border-white/25"}`}>
            <input type="checkbox" checked={selected.has(profile.id)} onChange={() => onToggle(profile.id)} className="accent-[#29B6E8]" />
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

function positiveNumberOrNull(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? number : null;
}

function TitleHelper({ platforms, segments, onPlatform, onSegment }) {
  return (
    <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3">
      <div className="flex flex-wrap items-start gap-4">
        <ChipGroup label="Plattform-Tag" values={platforms} onPick={onPlatform} />
        <ChipGroup label="Titel-Baustein" values={segments} onPick={onSegment} />
      </div>
      <div className="mt-2 text-[11px] text-white/40">
        Vorschläge werden aus gespeicherten Referenzen gebildet. Neue Veranstalter, Labels oder Titel-Bausteine erscheinen nach dem Speichern automatisch wieder.
      </div>
    </div>
  );
}

function ChipGroup({ label, values, onPick }) {
  const visible = (values || []).slice(0, 10);
  if (visible.length === 0) return null;
  return (
    <div className="min-w-0 flex-1">
      <div className="text-[10px] font-bold uppercase tracking-widest text-white/45 mb-2">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((value) => (
          <button key={value} type="button" onClick={() => onPick(value)} className="px-2.5 py-1 border border-white/10 bg-[#121212] text-white/70 hover:border-[#29B6E8]/70 hover:text-[#29B6E8] rounded-sm text-[11px] font-bold uppercase tracking-wider">
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, required, placeholder, type = "text", suggestions = [] }) {
  const datalistId = suggestions.length > 0 ? `ref-field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : undefined;
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input list={datalistId} type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={required} placeholder={placeholder} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
      {datalistId && (
        <datalist id={datalistId}>
          {suggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
        </datalist>
      )}
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <select value={value || ""} onChange={(e) => onChange(e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function TextArea({ label, value, onChange }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <textarea rows={3} value={value || ""} onChange={(e) => onChange(e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
    </label>
  );
}

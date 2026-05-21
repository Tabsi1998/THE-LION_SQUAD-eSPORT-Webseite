import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatRequestError, resolveMediaUrl } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { BarChart3, Calculator, Info, ListChecks, Pencil, Plus, Save, Search, Trash2, X } from "lucide-react";

const DEFAULT_POINTS = "25,18,15,12,10,8,6,4,2,1";
const STATUS_OPTIONS = ["draft", "active", "completed", "archived"];

const STATUS_LABELS = {
  draft: "Entwurf",
  active: "Aktiv",
  completed: "Abgeschlossen",
  archived: "Archiv",
  scheduled: "Geplant",
  check_in: "Check-in",
  live: "Live",
  results_published: "Ergebnisse online",
  cancelled: "Abgesagt",
};

const KIND_LABELS = {
  season: "Jahreswertung",
  circuit: "Circuit",
};

const V2_BASE_POINTS = [
  ["1. Platz", 100],
  ["2. Platz", 80],
  ["3. Platz", 65],
  ["4. Platz", 50],
  ["5.-8. Platz", 35],
  ["9.-16. Platz", 20],
  ["Teilnahme", 10],
];

const PARTICIPANT_FACTORS = [
  ["1-7", "x0.75"],
  ["8-15", "x1.00"],
  ["16-31", "x1.15"],
  ["32-63", "x1.30"],
  ["64+", "x1.50"],
];

const WEIGHT_HELP = [
  ["Major", "x3.00"],
  ["Normal", "x2.00"],
  ["Mini", "x1.25"],
  ["Fast Lap", "x1.00"],
  ["Fun", "x0.75"],
  ["Event", "x0.50"],
];

const emptyForm = {
  name: "",
  slug: "",
  kind: "season",
  status: "draft",
  description: "",
  banner_url: "",
  start_date: "",
  end_date: "",
  tournament_ids: [],
  f1_challenge_ids: [],
  drop_worst: 0,
  points_per_position: DEFAULT_POINTS,
};

function slugFrom(txt) {
  return (txt || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00df/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function dateValue(v) {
  return v ? String(v).slice(0, 10) : "";
}

function pointsToString(points) {
  return Array.isArray(points) && points.length ? points.join(",") : DEFAULT_POINTS;
}

function parsePointsString(value) {
  const parsed = String(value || "")
    .split(",")
    .map((x) => parseInt(x.trim(), 10))
    .filter((x) => x > 0);
  return parsed.length ? parsed : DEFAULT_POINTS.split(",").map(Number);
}

function toForm(season = {}) {
  return {
    ...emptyForm,
    ...season,
    description: season.description || "",
    banner_url: season.banner_url || "",
    start_date: dateValue(season.start_date),
    end_date: dateValue(season.end_date),
    tournament_ids: season.tournament_ids || [],
    f1_challenge_ids: season.f1_challenge_ids || [],
    points_per_position: pointsToString(season.points_per_position),
  };
}

function toPayload(form) {
  const payload = {
    ...form,
    slug: slugFrom(form.slug || form.name),
    description: form.description || null,
    banner_url: form.banner_url || null,
    start_date: form.start_date ? `${form.start_date}T00:00:00` : null,
    end_date: form.end_date ? `${form.end_date}T23:59:59` : null,
    points_per_position: parsePointsString(form.points_per_position),
    drop_worst: parseInt(form.drop_worst, 10) || 0,
  };
  return payload;
}

function labelStatus(status) {
  return STATUS_LABELS[status] || status || "Unbekannt";
}

function labelKind(kind) {
  return KIND_LABELS[kind] || kind || "Jahreswertung";
}

function formatDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function formatDateRange(start, end) {
  const a = formatDate(start);
  const b = formatDate(end);
  if (a && b) return `${a} - ${b}`;
  if (a) return `ab ${a}`;
  if (b) return `bis ${b}`;
  return "kein Zeitraum";
}

function numericWeight(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function weightLabel(item, fallback = 1) {
  const weight = numericWeight(item?.season_weight, fallback);
  if (weight >= 2.5) return "Major";
  if (weight >= 1.5) return "Normal";
  if (weight >= 1.0) return fallback === 1 ? "Fast Lap" : "Mini";
  if (weight >= 0.75) return "Fun";
  return "Event";
}

function participantFactor(maxParticipants) {
  const n = Number(maxParticipants || 0);
  if (n <= 7) return 0.75;
  if (n <= 15) return 1;
  if (n <= 31) return 1.15;
  if (n <= 63) return 1.3;
  return 1.5;
}

function sourceMeta(item, fallbackWeight) {
  const weight = numericWeight(item?.season_weight, fallbackWeight);
  const participants = item?.max_participants || item?.max_entries || item?.participants_count || 0;
  const factor = participantFactor(participants);
  const date = item?.start_date || item?.created_at;
  const bits = [
    labelStatus(item?.status),
    `${weightLabel(item, fallbackWeight)} x${weight.toFixed(2)}`,
  ];
  if (participants) bits.push(`${participants} Plaetze -> Teilnehmerfaktor x${factor.toFixed(2)}`);
  if (date) bits.push(formatDateRange(date, null));
  return bits.join(" - ");
}

function selectionText(ids) {
  return ids?.length ? `${ids.length} manuell gewaehlt` : "Auto nach Zeitraum/Status";
}

export default function AdminSeasonsPage() {
  const [list, setList] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const [s, t, c] = await Promise.all([
      api.get("/seasons"),
      api.get("/tournaments?include_drafts=true"),
      api.get("/f1/challenges?include_drafts=true"),
    ]);
    setList(s.data || []);
    setTournaments(t.data || []);
    setChallenges(c.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["seasons", "tournaments", "f1"]);

  const del = async (season) => {
    if (!await confirm({
      title: "Jahreswertung loeschen?",
      description: `Jahreswertung "${season.name}" wirklich loeschen?`,
      confirmLabel: "Loeschen",
    })) return;
    try {
      await api.delete(`/seasons/${season.id}`);
      toast.success("Jahreswertung geloescht.");
      load();
    } catch (err) {
      toast.error(formatRequestError(err, "Jahreswertung konnte nicht geloescht werden."));
    }
  };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Circuit</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Jahreswertung</h1>
          <p className="text-sm text-white/45 mt-2 max-w-3xl">
            Saison erstellen, Quellen festlegen und nachvollziehen, welche Punkte durch Platzierung, Teilnahme, Gewichtung und Teilnehmerfeld entstehen.
          </p>
        </div>
        <button onClick={() => setCreating(true)} data-testid="season-new" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 text-xs">
          <Plus className="w-4 h-4" /> Neue Jahreswertung
        </button>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {list.map((s) => (
          <SeasonCard key={s.id} season={s} onEdit={() => setEditing(s)} onDelete={() => del(s)} />
        ))}
        {list.length === 0 && (
          <div className="md:col-span-2 xl:col-span-3 text-center py-12 border border-dashed border-white/15 rounded-sm text-white/40 font-display tracking-widest">
            KEINE JAHRESWERTUNGEN
          </div>
        )}
      </div>

      {(creating || editing) && (
        <SeasonModal
          season={editing}
          tournaments={tournaments}
          challenges={challenges}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={load}
        />
      )}
    </AdminLayout>
  );
}

function SeasonCard({ season, onEdit, onDelete }) {
  const fallbackPoints = pointsToString(season.points_per_position);
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
      <div className="aspect-[16/9] bg-[#0A0A0A] overflow-hidden">
        {season.banner_url ? (
          <img src={resolveMediaUrl(season.banner_url)} alt="" className="w-full h-full object-cover opacity-80" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/20 font-heading font-black uppercase">{labelKind(season.kind)}</div>
        )}
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{labelKind(season.kind)}</div>
          <span className="text-[10px] uppercase tracking-widest px-2 py-1 border border-white/10 bg-white/5 text-white/60">{labelStatus(season.status)}</span>
        </div>
        <div>
          <h3 className="font-heading text-lg font-bold">{season.name}</h3>
          <div className="text-xs text-white/45 mt-1">{formatDateRange(season.start_date, season.end_date)}</div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <InfoPill label="Turniere" value={selectionText(season.tournament_ids)} />
          <InfoPill label="Fast Laps" value={selectionText(season.f1_challenge_ids)} />
          <InfoPill label="Streichresultate" value={Number(season.drop_worst || 0)} />
          <InfoPill label="Fallback" value={fallbackPoints} compact />
        </div>
        <div className="rounded-sm border border-[#29B6E8]/20 bg-[#29B6E8]/5 p-3 text-xs text-white/60">
          Aktive Punkte: Basis nach Platzierung/Teilnahme x Gewicht x Teilnehmerfaktor + Bonus. Leere Quellenlisten bedeuten Auto-Auswahl nach Zeitraum und Status.
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={onEdit} data-testid={`season-edit-${season.id}`} className="px-3 py-1.5 border border-[#29B6E8]/50 text-[#29B6E8] text-xs uppercase font-bold rounded-sm inline-flex items-center gap-1">
            <Pencil className="w-3 h-3" /> Bearbeiten
          </button>
          <Link to={`/seasons/${season.slug}`} target="_blank" className="px-3 py-1.5 border border-white/15 text-white/70 text-xs uppercase font-bold rounded-sm hover:text-white">Public</Link>
          <button onClick={onDelete} className="px-3 py-1.5 border border-[#FF3B30]/40 text-[#FF3B30] text-xs uppercase font-bold rounded-sm inline-flex items-center gap-1">
            <Trash2 className="w-3 h-3" /> Loeschen
          </button>
        </div>
      </div>
    </div>
  );
}

function SeasonModal({ season, tournaments, challenges, onClose, onSaved }) {
  const isNew = !season?.id;
  const [form, setForm] = useState(toForm(season || {}));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const selectedTournaments = useMemo(
    () => tournaments.filter((item) => form.tournament_ids.includes(item.id)),
    [form.tournament_ids, tournaments],
  );
  const selectedChallenges = useMemo(
    () => challenges.filter((item) => form.f1_challenge_ids.includes(item.id)),
    [form.f1_challenge_ids, challenges],
  );
  const fallbackPoints = useMemo(() => parsePointsString(form.points_per_position), [form.points_per_position]);

  const toggle = (field, id) => {
    setForm((f) => ({
      ...f,
      [field]: f[field].includes(id) ? f[field].filter((x) => x !== id) : [...f[field], id],
    }));
  };
  const setMany = (field, ids) => {
    setForm((f) => ({ ...f, [field]: Array.from(new Set(ids)) }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = toPayload(form);
      if (isNew) {
        const { status, ...createPayload } = payload;
        await api.post("/seasons", createPayload);
      } else {
        await api.patch(`/seasons/${season.id}`, payload);
      }
      toast.success("Jahreswertung gespeichert.");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(formatRequestError(err, "Jahreswertung konnte nicht gespeichert werden.", { slug: form.slug, name: form.name }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <form onSubmit={submit} className="bg-[#121212] border border-white/10 rounded-sm w-full max-w-6xl mx-auto my-6">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div>
            <h2 className="font-heading text-2xl font-black uppercase">{isNew ? "Neue Jahreswertung" : "Jahreswertung bearbeiten"}</h2>
            <p className="text-xs text-white/45 mt-1">Alles, was die spaetere Punktetabelle beeinflusst, ist hier sichtbar gebuendelt.</p>
          </div>
          <button type="button" onClick={onClose} className="text-white/50 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
          <div className="grid lg:grid-cols-[1fr_360px] gap-5">
            <div className="space-y-5">
              <div className="grid md:grid-cols-2 gap-4">
                <Field label="Name"><Input value={form.name} onChange={(v) => set("name", v)} required testId="season-name" /></Field>
                <Field label="Slug">
                  <Input value={form.slug} onChange={(v) => set("slug", slugFrom(v))} required testId="season-slug" placeholder="jahreswertung-2026" />
                </Field>
                <Field label="Typ">
                  <select value={form.kind} onChange={(e) => set("kind", e.target.value)} data-testid="season-kind" className="input">
                    <option value="season">Jahreswertung</option>
                    <option value="circuit">Circuit</option>
                  </select>
                </Field>
                {!isNew && (
                  <Field label="Status">
                    <select value={form.status} onChange={(e) => set("status", e.target.value)} data-testid="season-status" className="input">
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{labelStatus(s)}</option>)}
                    </select>
                  </Field>
                )}
              </div>

              <ImageUpload value={form.banner_url} onChange={(v) => set("banner_url", v)} label="Banner" testId="season-banner" variant="wide" allowLibrary />

              <div className="grid md:grid-cols-2 gap-4">
                <Field label="Start"><Input type="date" value={form.start_date} onChange={(v) => set("start_date", v)} /></Field>
                <Field label="Ende"><Input type="date" value={form.end_date} onChange={(v) => set("end_date", v)} /></Field>
              </div>

              <Field label="Beschreibung">
                <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} data-testid="season-desc" className="input" />
              </Field>

              <div className="grid md:grid-cols-2 gap-4">
                <Field label="Fallback-Punktetabelle">
                  <Input value={form.points_per_position} onChange={(v) => set("points_per_position", v)} testId="season-points" placeholder={DEFAULT_POINTS} />
                  <div className="text-[11px] text-white/35 mt-1.5">
                    Wird fuer alte Fallback-Standings und Championship-Logik genutzt. Neue V2-Eintraege nutzen die feste Formel rechts.
                  </div>
                </Field>
                <Field label="Streichresultate">
                  <Input type="number" value={form.drop_worst} onChange={(v) => set("drop_worst", v)} testId="season-drop" />
                  <div className="text-[11px] text-white/35 mt-1.5">
                    Die niedrigsten Wertungen pro Person werden aus dem Gesamtergebnis gestrichen.
                  </div>
                </Field>
              </div>
            </div>

            <RuleSummary
              form={form}
              fallbackPoints={fallbackPoints}
              selectedTournaments={selectedTournaments}
              selectedChallenges={selectedChallenges}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <SourcePicker
              label="Turniere einbeziehen"
              helper="Leer lassen = passende Turniere automatisch nach Zeitraum und Status einbeziehen."
              items={tournaments}
              selected={form.tournament_ids}
              onToggle={(id) => toggle("tournament_ids", id)}
              onSetSelected={(ids) => setMany("tournament_ids", ids)}
              getLabel={(t) => t.title}
              getMeta={(t) => sourceMeta(t, 2)}
            />
            <SourcePicker
              label="Fast-Lap Challenges einbeziehen"
              helper="Leer lassen = passende Fast-Lap Challenges automatisch nach Zeitraum und Status einbeziehen."
              items={challenges}
              selected={form.f1_challenge_ids}
              onToggle={(id) => toggle("f1_challenge_ids", id)}
              onSetSelected={(ids) => setMany("f1_challenge_ids", ids)}
              getLabel={(c) => c.title}
              getMeta={(c) => sourceMeta(c, 1)}
            />
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t border-white/10">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-white/10 text-white/60 hover:text-white text-xs uppercase tracking-wider font-bold rounded-sm">Abbrechen</button>
          <button type="submit" disabled={saving} data-testid="season-submit" className="ml-auto inline-flex items-center gap-2 px-5 py-2 bg-[#29B6E8] text-black text-xs uppercase tracking-wider font-bold rounded-sm hover:bg-[#1E95C2] disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> {saving ? "Speichere..." : "Speichern"}
          </button>
        </div>
        <style>{`.input{ width:100%; background:#0A0A0A; border:1px solid rgba(255,255,255,0.1); padding:0.5rem 0.75rem; border-radius:2px; font-size:13px; color:#fff; }`}</style>
      </form>
    </div>
  );
}

function RuleSummary({ form, fallbackPoints, selectedTournaments, selectedChallenges }) {
  const selectedSources = selectedTournaments.length + selectedChallenges.length;
  const selectedText = selectedSources
    ? `${selectedTournaments.length} Turniere, ${selectedChallenges.length} Fast Laps`
    : "Auto-Auswahl nach Zeitraum/Status";

  return (
    <aside className="border border-[#29B6E8]/25 bg-[#06131A] rounded-sm p-4 space-y-4">
      <div>
        <div className="flex items-center gap-2 text-[#29B6E8] text-[11px] uppercase tracking-widest font-bold">
          <Calculator className="w-4 h-4" /> Punktevergabe
        </div>
        <h3 className="font-heading text-xl font-black uppercase mt-1">So wird gewertet</h3>
        <p className="text-xs text-white/55 mt-2">
          Neue Wertungen entstehen mit: Basispunkte x Quellen-Gewicht x Teilnehmerfaktor + Bonuspunkte.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {V2_BASE_POINTS.map(([label, points]) => (
          <InfoPill key={label} label={label} value={`${points} P`} />
        ))}
      </div>

      <div className="space-y-2">
        <MiniTable icon={BarChart3} title="Teilnehmerfaktor" rows={PARTICIPANT_FACTORS} />
        <MiniTable icon={ListChecks} title="Gewichtung" rows={WEIGHT_HELP} />
      </div>

      <div className="rounded-sm border border-white/10 bg-black/20 p-3 space-y-2 text-xs text-white/55">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-[#FFD700] shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-white/75">Aktuelle Auswahl</div>
            <div>{selectedText}</div>
          </div>
        </div>
        <div>Streichresultate: {Number(form.drop_worst || 0)}</div>
        <div>Fallback-Tabelle: {fallbackPoints.join(", ")}</div>
      </div>
    </aside>
  );
}

function MiniTable({ icon: Icon, title, rows }) {
  return (
    <div className="rounded-sm border border-white/10 bg-black/20 p-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-white/50 font-bold mb-2">
        <Icon className="w-3.5 h-3.5" /> {title}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {rows.map(([label, value]) => (
          <div key={`${label}-${value}`} className="flex items-center justify-between gap-2">
            <span className="text-white/55">{label}</span>
            <span className="text-white font-mono">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourcePicker({ label, helper, items, selected, onToggle, onSetSelected, getLabel, getMeta }) {
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const haystack = `${getLabel(item)} ${getMeta(item)} ${item.slug || ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [getLabel, getMeta, items, query]);
  const selectedVisible = filtered.filter((item) => selectedSet.has(item.id)).length;

  return (
    <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/70">{label}</div>
          <div className="text-[11px] text-white/35 mt-1">{helper}</div>
        </div>
        <span className="text-[10px] uppercase tracking-widest px-2 py-1 border border-white/10 bg-white/5 text-white/60 shrink-0">
          {selected.length ? `${selected.length} aktiv` : "Auto"}
        </span>
      </div>

      <label className="flex items-center gap-2 bg-[#121212] border border-white/10 rounded-sm px-2 py-1.5">
        <Search className="w-3.5 h-3.5 text-white/35" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Suchen..." className="bg-transparent outline-none text-sm flex-1 text-white placeholder:text-white/25" />
      </label>

      <div className="flex gap-2 flex-wrap">
        <button type="button" onClick={() => onSetSelected(Array.from(new Set([...selected, ...filtered.map((item) => item.id)])))} className="px-2 py-1 border border-white/10 text-white/60 hover:text-white text-[10px] uppercase tracking-widest rounded-sm">
          Sichtbare waehlen
        </button>
        <button type="button" onClick={() => onSetSelected(selected.filter((id) => !filtered.some((item) => item.id === id)))} className="px-2 py-1 border border-white/10 text-white/60 hover:text-white text-[10px] uppercase tracking-widest rounded-sm">
          Sichtbare loesen
        </button>
        {selectedVisible > 0 && <span className="text-[10px] uppercase tracking-widest text-[#29B6E8] self-center">{selectedVisible} sichtbar gewaehlt</span>}
      </div>

      <div className="max-h-72 overflow-y-auto border border-white/10 rounded-sm p-2 space-y-1 bg-black/20">
        {filtered.map((item) => (
          <label key={item.id} className="flex items-start gap-2 text-sm hover:bg-white/5 px-2 py-2 rounded-sm">
            <input type="checkbox" checked={selectedSet.has(item.id)} onChange={() => onToggle(item.id)} className="accent-[#29B6E8] mt-1" />
            <span className="min-w-0">
              <span className="block truncate text-white/85">{getLabel(item)}</span>
              <span className="block text-[11px] text-white/40 mt-0.5">{getMeta(item)}</span>
            </span>
          </label>
        ))}
        {filtered.length === 0 && <div className="text-xs text-white/35 p-2">Keine passenden Eintraege vorhanden.</div>}
      </div>
    </div>
  );
}

function InfoPill({ label, value, compact = false }) {
  return (
    <div className="rounded-sm border border-white/10 bg-black/20 px-3 py-2 min-w-0">
      <div className="text-[10px] uppercase tracking-widest text-white/35">{label}</div>
      <div className={`text-white/75 mt-0.5 ${compact ? "text-[11px] truncate" : "text-xs"}`}>{value}</div>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="block"><div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>{children}</label>;
}

function Input({ value, onChange, placeholder, testId, required, type = "text" }) {
  return <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-testid={testId} required={required} className="input" />;
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatRequestError, resolveMediaUrl } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { GermanDateField } from "@/components/tls/GermanDateField";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { BarChart3, Calculator, Flag, Info, ListChecks, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { PersonPicker } from "@/components/tls/PersonPicker";
import { asInstant, viennaDate } from "@/lib/vienna";

const DEFAULT_POINTS = "25,18,15,12,10,8,6,4,2,1";
// „Abgeschlossen“ setzt nur der Knopf „Abschließen“ mit Vorschau und Rückfrage (#2123, ER8).
const STATUS_OPTIONS = ["draft", "active", "archived"];

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

// „Circuit“ (#2123, ER13): rechnet wie die Jahreswertung, zählt aber nicht für den Jahresrückblick „Dein Jahr“.
const KIND_LABELS = {
  season: "Jahreswertung",
  circuit: "Turnierserie",
};
const KIND_HINT = "Eine Turnierserie (früher „Circuit“) rechnet genauso, heißt öffentlich „Lions Circuit“ und erscheint nicht im Jahresrückblick „Dein Jahr“. Aktiv ist immer nur eine Wertung – solange eine Turnierserie aktiv ist, landen die Punkte dort.";

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
  const d = asInstant(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return viennaDate(d, { day: "2-digit", month: "2-digit", year: "2-digit" });
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
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback; // 0 = keine Jahreswertung (#2095)
}

function weightLabel(item, fallback = 1) {
  const weight = numericWeight(item?.season_weight, fallback);
  if (weight === 0) return "Keine Wertung";
  if (weight >= 2.5) return "Major";
  if (weight >= 1.5) return "Normal";
  if (weight >= 1.0) return fallback === 1 ? "Fast Lap" : "Mini";
  if (weight >= 0.75) return "Fun";
  return "Event";
}

// Der Teilnehmerfaktor richtet sich nach den tatsächlichen Teilnehmern beim Veröffentlichen (#2123, ER12) - nicht
// nach den Plätzen. Darum nennt die Auswahl nur Status, Gewicht und Datum.
function sourceMeta(item, fallbackWeight) {
  const weight = numericWeight(item?.season_weight, fallbackWeight);
  const date = item?.start_date || item?.created_at;
  const bits = [
    labelStatus(item?.status),
    `${weightLabel(item, fallbackWeight)} ×${weight.toFixed(2).replace(".", ",")}`,
  ];
  if (date) bits.push(formatDateRange(date, null));
  return bits.join(" · ");
}

function fullSeasonText(season) {
  const count = (season.tournament_ids?.length || 0) + (season.f1_challenge_ids?.length || 0);
  return count ? `${count} Pflichttermin${count === 1 ? "" : "e"}` : "keine";
}

export default function AdminSeasonsPage() {
  const [list, setList] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [completing, setCompleting] = useState(null);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const [s, t, c] = await Promise.all([
      api.get("/seasons"),
      // Liga-Staffeln zählen nie für die Jahreswertung (docs/LIGA.md) - der Picker bietet sie gar nicht an.
      api.get("/tournaments?include_drafts=true&league=exclude"),
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
      title: "Jahreswertung löschen?",
      description: `Den Entwurf „${season.name}“ wirklich löschen? Das lässt sich nicht rückgängig machen.`,
      confirmLabel: "Löschen",
    })) return;
    try {
      await api.delete(`/seasons/${season.id}`);
      toast.success("Jahreswertung gelöscht.");
      load();
    } catch (err) {
      toast.error(formatRequestError(err, "Jahreswertung konnte nicht gelöscht werden."));
    }
  };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">eSports</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Jahreswertung</h1>
          <p className="text-sm text-white/45 mt-2 max-w-3xl">
            Saison anlegen, aktivieren und abschließen. Punkte entstehen von selbst aus Turnieren, Fast Laps und Event-Teilnahmen –
            immer in der einen aktiven Jahreswertung. Korrekturen tragt ihr mit Grund von Hand ein.
          </p>
        </div>
        <button onClick={() => setCreating(true)} data-testid="season-new" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 text-xs">
          <Plus className="w-4 h-4" /> Neue Jahreswertung
        </button>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {list.map((s) => (
          <SeasonCard key={s.id} season={s} onEdit={() => setEditing(s)} onDelete={() => del(s)} onComplete={() => setCompleting(s)} />
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
      {completing && (
        <CompleteSheet season={completing} onClose={() => setCompleting(null)} onDone={load} />
      )}
    </AdminLayout>
  );
}

// Abschließen (#2123, ER8): Vorschau aus der Erfolge-Rechnung (wer was bekommt), dann Bestätigung.
function CompleteSheet({ season, onClose, onDone }) {
  const [preview, setPreview] = useState(null);
  const [failed, setFailed] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    api.get(`/seasons/${season.id}/completion-preview`)
      .then(({ data }) => { if (alive) setPreview(data); })
      .catch((err) => { if (alive) setFailed(formatRequestError(err, "Vorschau konnte nicht geladen werden.")); });
    return () => { alive = false; };
  }, [season.id]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/seasons/${season.id}/complete`);
      toast.success(`„${season.name}“ ist abgeschlossen.`);
      onDone();
      onClose();
    } catch (err) {
      toast.error(formatRequestError(err, "Jahreswertung konnte nicht abgeschlossen werden."));
    } finally {
      setSaving(false);
    }
  };

  const rows = preview?.standings || [];
  return (
    <AdminSheet title={`„${season.name}“ abschließen`} eyebrow="Jahreswertung" size="lg" onClose={onClose} onSubmit={submit} saving={saving}
      submitLabel="Endgültig abschließen" savingLabel="Schließe ab …" submitDisabled={!preview} submitTestId="season-complete-submit" testId="season-complete-sheet">
      <div className="rounded-sm border border-honor/30 bg-honor/5 p-4 text-sm text-white/75 space-y-2">
        <p className="font-bold text-honor">Das passiert einmalig und lässt sich nicht zurücknehmen:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Die Rangliste wird festgeschrieben.</li>
          <li>Jede platzierte Person bekommt XP („Saison abgeschlossen“).</li>
          <li>Die Saison-Erfolge werden vergeben – so wie unten aufgelistet.</li>
          <li>Neue Ergebnisse bekommen danach keine Jahrespunkte mehr, bis eine neue Jahreswertung aktiv ist.</li>
        </ul>
      </div>
      {failed && <p className="text-sm text-live" role="alert">{failed}</p>}
      {!preview && !failed && <p className="text-sm text-white/40">Lade Vorschau …</p>}
      {preview && (
        <div data-testid="season-complete-preview" className="space-y-3">
          <p className="text-sm text-white/60">
            {preview.ranked} {preview.ranked === 1 ? "Platz" : "Plätze"} · {preview.awards_total} {preview.awards_total === 1 ? "Erfolg" : "Erfolge"} beim Abschluss
          </p>
          <ol className="divide-y divide-white/5 border border-white/10 rounded-sm">
            {rows.slice(0, 10).map((row) => (
              <li key={row.user_id || row.rank} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="font-heading font-black w-6 tabular-nums">{row.rank}</span>
                <span className="min-w-0 flex-1 truncate">{row.display_name || row.username || "—"}</span>
                <span className="tabular-nums text-[#29B6E8]">{Number(row.points || 0).toLocaleString("de-DE")} P</span>
                {row.awards?.length > 0 && <span className="w-full pl-9 text-[11px] text-white/45">{row.awards.map((a) => a.name).join(", ")}</span>}
              </li>
            ))}
            {rows.length === 0 && <li className="px-3 py-4 text-sm text-white/40">Noch keine Punkte in dieser Jahreswertung.</li>}
          </ol>
          {rows.length > 10 && <p className="text-xs text-white/40">… und {rows.length - 10} weitere Plätze.</p>}
        </div>
      )}
    </AdminSheet>
  );
}

function SeasonCard({ season, onEdit, onDelete, onComplete }) {
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
          <InfoPill label="Streichresultate" value={Number(season.drop_worst || 0)} />
          <InfoPill label="Volle Saison" value={fullSeasonText(season)} />
        </div>
        <div className="rounded-sm border border-[#29B6E8]/20 bg-[#29B6E8]/5 p-3 text-xs text-white/60">
          {season.status === "active"
            ? "Aktiv: neue Ergebnisse aus Turnieren, Fast Laps und Event-Teilnahmen bekommen hier ihre Punkte."
            : season.status === "draft"
              ? "Entwurf: bekommt noch keine Punkte. Aktiv kann immer nur eine Jahreswertung sein."
              : "Bekommt keine neuen Punkte mehr."}
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={onEdit} data-testid={`season-edit-${season.id}`} className="px-3 py-1.5 border border-[#29B6E8]/50 text-[#29B6E8] text-xs uppercase font-bold rounded-sm inline-flex items-center gap-1">
            <Pencil className="w-3 h-3" /> Bearbeiten
          </button>
          <Link to={`/seasons/${season.slug}`} target="_blank" className="px-3 py-1.5 border border-white/15 text-white/70 text-xs uppercase font-bold rounded-sm hover:text-white">Öffentliche Seite</Link>
          {season.status === "active" && (
            <button onClick={onComplete} data-testid={`season-complete-${season.id}`} className="px-3 py-1.5 border border-honor/50 text-honor text-xs uppercase font-bold rounded-sm inline-flex items-center gap-1">
              <Flag className="w-3 h-3" /> Abschließen
            </button>
          )}
          {/* Löschen nur als Entwurf ohne Punkte (#2123, ER9) - sonst archivieren. */}
          {season.status === "draft" && (
            <button onClick={onDelete} data-testid={`season-delete-${season.id}`} className="px-3 py-1.5 border border-live/40 text-live text-xs uppercase font-bold rounded-sm inline-flex items-center gap-1">
              <Trash2 className="w-3 h-3" /> Löschen
            </button>
          )}
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
  const statusOptions = (form.status === "completed" ? ["completed", ...STATUS_OPTIONS] : STATUS_OPTIONS).map((s) => [s, labelStatus(s)]);

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
        // Der Status geht nur mit, wenn er sich geändert hat - „Abgeschlossen“ setzt nur der eigene Knopf (#2123, ER8).
        const { status, ...rest } = payload;
        await api.patch(`/seasons/${season.id}`, status !== season.status ? { ...rest, status } : rest);
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

  // Seitenblatt statt 1152-px-Fenster (#435): Jahreswertung, Punkte mit der Regelübersicht,
  // Quellen als Abschnitte; die Karten der Liste bleiben daneben sichtbar.
  return (
    <AdminSheet title={isNew ? "Neue Jahreswertung" : "Jahreswertung bearbeiten"} eyebrow="eSports" size="xl" onClose={onClose} onSubmit={submit} saving={saving} submitTestId="season-submit" testId="season-sheet">
      <FormSection title="Jahreswertung" hint="Alles, was die spätere Punktetabelle beeinflusst, ist hier gebündelt.">
        <FormGrid>
          <TextField label="Name" value={form.name} onChange={(v) => set("name", v)} required testId="season-name" />
          <TextField label="Slug" value={form.slug} onChange={(v) => set("slug", slugFrom(v))} required testId="season-slug" placeholder="jahreswertung-2026" />
          <SelectField label="Typ" value={form.kind} onChange={(v) => set("kind", v)} options={[["season", "Jahreswertung"], ["circuit", "Turnierserie (Circuit)"]]} hint={KIND_HINT} testId="season-kind" />
          {!isNew && (
            <SelectField label="Status" value={form.status} onChange={(v) => set("status", v)} options={statusOptions} disabled={form.status === "completed"}
              hint="Aktiv kann nur eine Jahreswertung sein. Abschließen geht über den Knopf „Abschließen“ auf der Karte – mit Vorschau." testId="season-status" />
          )}
        </FormGrid>
        <ImageUpload value={form.banner_url} onChange={(v) => set("banner_url", v)} label="Banner" testId="season-banner" variant="wide" allowLibrary />
        <FormGrid>
          <GermanDateField id="season-start-date" label="Start" value={(form.start_date || "").slice(0, 10)} onChange={(v) => set("start_date", v)} testId="season-start-date" allowFuture />
          <GermanDateField id="season-end-date" label="Ende" value={(form.end_date || "").slice(0, 10)} onChange={(v) => set("end_date", v)} testId="season-end-date" allowFuture />
        </FormGrid>
        <TextAreaField label="Beschreibung" value={form.description} onChange={(v) => set("description", v)} testId="season-desc" />
      </FormSection>

      <FormSection title="Punkte">
        {/* Die frühere „Fallback-Punktetabelle“ und die Quellenauswahl wirkten nicht auf die Punkte (#2123, ER6) - sie
            sind weg bzw. heißen jetzt, was sie tun („Volle Saison“). Ausschließen: Gewicht „Keine Jahreswertung“. */}
        <FormGrid>
          <TextField label="Streichresultate" type="number" value={form.drop_worst} onChange={(v) => set("drop_worst", v)} testId="season-drop" hint="Die niedrigsten Wertungen pro Person werden aus dem Gesamtergebnis gestrichen." />
        </FormGrid>
        <RuleSummary form={form} />
      </FormSection>

      {!isNew && ["draft", "active"].includes(season.status) && <AdjustmentsSection season={season} />}

      <FormSection title="Volle Saison (Pflichttermine)" collapsible
        hint="Zählt nicht für die Punkte. Wer bei allen hier gewählten Turnieren und Fast-Lap-Challenges Punkte geholt hat, bekommt beim Abschluss den Erfolg „Volle Saison“. Leer = niemand bekommt ihn.">
        <SourcePicker
          label="Turniere"
          helper={selectedTournaments.length ? `${selectedTournaments.length} gewählt` : "Noch keine gewählt."}
          items={tournaments}
          selected={form.tournament_ids}
          onToggle={(id) => toggle("tournament_ids", id)}
          onSetSelected={(ids) => setMany("tournament_ids", ids)}
          getLabel={(t) => t.title}
          getMeta={(t) => sourceMeta(t, 2)}
        />
        <SourcePicker
          label="Fast-Lap-Challenges"
          helper={selectedChallenges.length ? `${selectedChallenges.length} gewählt` : "Noch keine gewählt."}
          items={challenges}
          selected={form.f1_challenge_ids}
          onToggle={(id) => toggle("f1_challenge_ids", id)}
          onSetSelected={(ids) => setMany("f1_challenge_ids", ids)}
          getLabel={(c) => c.title}
          getMeta={(c) => sourceMeta(c, 1)}
        />
      </FormSection>
    </AdminSheet>
  );
}

// Korrekturen (#2123, ER10): Bonus oder Abzug von Hand, immer mit Grund - eigener Eintrag „Korrektur“ in der Wertung.
function AdjustmentsSection({ season }) {
  const [rows, setRows] = useState([]);
  const [person, setPerson] = useState(null);
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const load = useCallback(() => {
    api.get(`/seasons/${season.id}/adjustments`).then(({ data }) => setRows(Array.isArray(data) ? data : [])).catch(() => setRows([]));
  }, [season.id]);
  useEffect(() => { load(); }, [load]);

  const value = Number(String(points).replace(",", "."));
  const ready = Boolean(person) && Number.isFinite(value) && value !== 0 && reason.trim().length >= 3;
  const add = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      await api.post(`/seasons/${season.id}/adjustments`, { user_id: person.id, points: value, reason: reason.trim() });
      toast.success(`${value > 0 ? "+" : ""}${formatPoints(value)} Punkte für ${person.name} eingetragen.`);
      setPerson(null);
      setPoints("");
      setReason("");
      load();
    } catch (err) {
      toast.error(formatRequestError(err, "Korrektur konnte nicht eingetragen werden."));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (row) => {
    if (!await confirm({ title: "Korrektur entfernen?", description: `${formatPoints(row.total_points)} Punkte für ${row.recipient_label} („${row.bonus_reason}“) fallen weg.`, confirmLabel: "Entfernen" })) return;
    try {
      await api.delete(`/seasons/${season.id}/adjustments/${row.id}`);
      toast.success("Korrektur entfernt.");
      load();
    } catch (err) {
      toast.error(formatRequestError(err, "Korrektur konnte nicht entfernt werden."));
    }
  };

  return (
    <FormSection title="Punkte korrigieren" hint="Bonus oder Abzug von Hand – etwa für Fair Play oder einen Regelverstoß. Der Grund steht in der Wertung und im Protokoll; ein erneutes Veröffentlichen eines Turniers ändert daran nichts.">
      <div className="space-y-3" data-testid="season-adjustments">
        <PersonPicker purpose="season" value={person} onChange={setPerson} label="Person" testId="season-adjust-person" />
        <FormGrid>
          <TextField label="Punkte (minus für Abzug)" type="number" step="0.5" value={points} onChange={setPoints} placeholder="z. B. 10 oder -15" testId="season-adjust-points" />
          <TextField label="Grund" value={reason} onChange={setReason} maxLength={200} placeholder="z. B. Fair-Play-Bonus Herbst-Cup" testId="season-adjust-reason" />
        </FormGrid>
        <button type="button" onClick={add} disabled={!ready || busy} data-testid="season-adjust-submit" className="px-3 py-2 border border-[#29B6E8]/50 text-[#29B6E8] text-xs uppercase font-bold rounded-sm disabled:opacity-40">
          Korrektur eintragen
        </button>
        {rows.length > 0 && (
          <ul className="divide-y divide-white/5 border border-white/10 rounded-sm" data-testid="season-adjust-list">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className={`tabular-nums font-bold ${row.total_points < 0 ? "text-live" : "text-ok"}`}>{row.total_points > 0 ? "+" : ""}{formatPoints(row.total_points)}</span>
                <span className="min-w-0 flex-1 truncate">{row.recipient_label}</span>
                <span className="w-full sm:w-auto text-xs text-white/50 break-words">{row.bonus_reason}</span>
                <button type="button" onClick={() => remove(row)} aria-label={`Korrektur für ${row.recipient_label} entfernen`} className="p-1 text-live/80 hover:text-live">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </FormSection>
  );
}

function formatPoints(value) {
  return Number(value || 0).toLocaleString("de-DE", { maximumFractionDigits: 1 });
}

function RuleSummary({ form }) {
  return (
    <aside className="border border-[#29B6E8]/25 bg-[#06131A] rounded-sm p-4 space-y-4">
      <div>
        <div className="flex items-center gap-2 text-[#29B6E8] text-[11px] uppercase tracking-widest font-bold">
          <Calculator className="w-4 h-4" /> Punktevergabe
        </div>
        <h3 className="font-heading text-xl font-black uppercase mt-1">So wird gewertet</h3>
        <p className="text-xs text-white/55 mt-2">
          Wertungen entstehen mit: Basispunkte × Gewicht × Teilnehmerfaktor + Bonuspunkte – beim Veröffentlichen der Ergebnisse,
          immer in der aktiven Jahreswertung. Nach einer Korrektur und erneutem Veröffentlichen werden sie angeglichen.
        </p>
        <p className="text-xs text-white/45 mt-2">
          Major, Normal, Mini usw. stellst du beim jeweiligen Turnier oder bei der Fast-Lap-Challenge ein. Es zählt alles mit einem
          Gewicht über 0 – ausschließen heißt dort „Keine Jahreswertung“. Der Teilnehmerfaktor richtet sich nach den tatsächlich
          bestätigten bzw. eingecheckten Teilnehmern, nicht nach den Plätzen. Bonuspunkte gibt es derzeit für die Event-Teilnahme (+5).
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
          <div>Streichresultate: {Number(form.drop_worst || 0)}</div>
        </div>
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
          {selected.length ? `${selected.length} gewählt` : "keine"}
        </span>
      </div>

      <label className="flex items-center gap-2 bg-[#121212] border border-white/10 rounded-sm px-2 py-1.5">
        <Search className="w-3.5 h-3.5 text-white/35" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Suchen..." className="bg-transparent outline-none text-sm flex-1 text-white placeholder:text-white/25" />
      </label>

      <div className="flex gap-2 flex-wrap">
        <button type="button" onClick={() => onSetSelected(Array.from(new Set([...selected, ...filtered.map((item) => item.id)])))} className="px-2 py-1 border border-white/10 text-white/60 hover:text-white text-[10px] uppercase tracking-widest rounded-sm">
          Sichtbare wählen
        </button>
        <button type="button" onClick={() => onSetSelected(selected.filter((id) => !filtered.some((item) => item.id === id)))} className="px-2 py-1 border border-white/10 text-white/60 hover:text-white text-[10px] uppercase tracking-widest rounded-sm">
          Sichtbare lösen
        </button>
        {selectedVisible > 0 && <span className="text-[10px] uppercase tracking-widest text-[#29B6E8] self-center">{selectedVisible} sichtbar gewählt</span>}
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
        {filtered.length === 0 && <div className="text-xs text-white/35 p-2">Keine passenden Einträge vorhanden.</div>}
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


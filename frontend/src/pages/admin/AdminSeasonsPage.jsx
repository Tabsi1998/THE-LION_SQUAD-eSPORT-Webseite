import { useCallback, useEffect, useState } from "react";
import { api, formatRequestError, resolveMediaUrl } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, X, Save } from "lucide-react";

const DEFAULT_POINTS = "25,18,15,12,10,8,6,4,2,1";
const STATUS_OPTIONS = ["draft", "active", "completed", "archived"];

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
    .replace(/ß/g, "ss")
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
    points_per_position: form.points_per_position
      .split(",")
      .map((x) => parseInt(x.trim(), 10))
      .filter((x) => x > 0),
    drop_worst: parseInt(form.drop_worst, 10) || 0,
  };
  if (!payload.points_per_position.length) payload.points_per_position = DEFAULT_POINTS.split(",").map(Number);
  return payload;
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
      api.get("/tournaments"),
      api.get("/f1/challenges"),
    ]);
    setList(s.data);
    setTournaments(t.data);
    setChallenges(c.data);
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["seasons", "tournaments", "f1"]);

  const del = async (season) => {
    if (!await confirm({
      title: "Saison löschen?",
      description: `Saison "${season.name}" wirklich löschen?`,
      confirmLabel: "Löschen",
    })) return;
    try {
      await api.delete(`/seasons/${season.id}`);
      toast.success("Saison geloescht.");
      load();
    } catch (err) {
      toast.error(formatRequestError(err, "Saison konnte nicht geloescht werden."));
    }
  };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Circuit</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Saisons / Circuits</h1>
        </div>
        <button onClick={() => setCreating(true)} data-testid="season-new" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 text-xs">
          <Plus className="w-4 h-4" /> Neue Saison
        </button>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {list.map((s) => (
          <div key={s.id} className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
            <div className="aspect-[16/9] bg-[#0A0A0A] overflow-hidden">
              {s.banner_url ? (
                <img src={resolveMediaUrl(s.banner_url)} alt="" className="w-full h-full object-cover opacity-80" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white/20 font-heading font-black uppercase">{s.kind}</div>
              )}
            </div>
            <div className="p-4">
              <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{s.kind} · {s.status}</div>
              <h3 className="font-heading text-lg font-bold mt-1">{s.name}</h3>
              <div className="text-xs text-white/50 mt-1">
                Turniere: {s.tournament_ids?.length || 0} · F1: {s.f1_challenge_ids?.length || 0}
              </div>
              <div className="mt-4 flex gap-2 flex-wrap">
                <button onClick={() => setEditing(s)} data-testid={`season-edit-${s.id}`} className="px-3 py-1.5 border border-[#29B6E8]/50 text-[#29B6E8] text-xs uppercase font-bold rounded-sm inline-flex items-center gap-1">
                  <Pencil className="w-3 h-3" /> Bearbeiten
                </button>
                <Link to={`/seasons/${s.slug}`} target="_blank" className="px-3 py-1.5 border border-white/15 text-white/70 text-xs uppercase font-bold rounded-sm hover:text-white">Public</Link>
                <button onClick={() => del(s)} className="px-3 py-1.5 border border-[#FF3B30]/40 text-[#FF3B30] text-xs uppercase font-bold rounded-sm inline-flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> Löschen
                </button>
              </div>
            </div>
          </div>
        ))}
        {list.length === 0 && (
          <div className="md:col-span-2 xl:col-span-3 text-center py-12 border border-dashed border-white/15 rounded-sm text-white/40 font-display tracking-widest">
            KEINE SAISONS
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

function SeasonModal({ season, tournaments, challenges, onClose, onSaved }) {
  const isNew = !season?.id;
  const [form, setForm] = useState(toForm(season || {}));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const toggle = (field, id) => {
    setForm((f) => ({
      ...f,
      [field]: f[field].includes(id) ? f[field].filter((x) => x !== id) : [...f[field], id],
    }));
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
      toast.success("Saison gespeichert.");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(formatRequestError(err, "Saison konnte nicht gespeichert werden.", { slug: form.slug, name: form.name }));
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <form onSubmit={submit} className="bg-[#121212] border border-white/10 rounded-sm w-full max-w-5xl mx-auto my-6">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="font-heading text-2xl font-black uppercase">{isNew ? "Neue Saison" : "Saison bearbeiten"}</h2>
          <button type="button" onClick={onClose} className="text-white/50 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Name"><Input value={form.name} onChange={(v) => set("name", v)} required testId="season-name" /></Field>
            <Field label="Slug">
              <Input value={form.slug} onChange={(v) => set("slug", slugFrom(v))} required testId="season-slug" placeholder="season-2026" />
            </Field>
            <Field label="Typ">
              <select value={form.kind} onChange={(e) => set("kind", e.target.value)} data-testid="season-kind" className="input">
                <option value="season">Saison</option>
                <option value="circuit">Circuit</option>
              </select>
            </Field>
            {!isNew && (
              <Field label="Status">
                <select value={form.status} onChange={(e) => set("status", e.target.value)} data-testid="season-status" className="input">
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
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
            <Field label="Punkteformel">
              <Input value={form.points_per_position} onChange={(v) => set("points_per_position", v)} testId="season-points" placeholder={DEFAULT_POINTS} />
            </Field>
            <Field label="Streichresultate">
              <Input type="number" value={form.drop_worst} onChange={(v) => set("drop_worst", v)} testId="season-drop" />
            </Field>
          </div>

          <SourcePicker
            label="Turniere einbeziehen"
            items={tournaments}
            selected={form.tournament_ids}
            onToggle={(id) => toggle("tournament_ids", id)}
            getLabel={(t) => t.title}
          />
          <SourcePicker
            label="Fast-Lap Challenges einbeziehen"
            items={challenges}
            selected={form.f1_challenge_ids}
            onToggle={(id) => toggle("f1_challenge_ids", id)}
            getLabel={(c) => c.title}
          />
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

function SourcePicker({ label, items, selected, onToggle, getLabel }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <div className="max-h-48 overflow-y-auto border border-white/10 rounded-sm p-2 space-y-1 bg-[#0A0A0A]">
        {items.map((item) => (
          <label key={item.id} className="flex items-center gap-2 text-sm hover:bg-white/5 px-2 py-1 rounded-sm">
            <input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} className="accent-[#29B6E8]" />
            <span className="truncate">{getLabel(item)}</span>
          </label>
        ))}
        {items.length === 0 && <div className="text-xs text-white/35 p-2">Keine Einträge vorhanden.</div>}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="block"><div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>{children}</label>;
}

function Input({ value, onChange, placeholder, testId, required, type = "text" }) {
  return <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-testid={testId} required={required} className="input" />;
}

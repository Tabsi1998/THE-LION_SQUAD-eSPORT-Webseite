import { useCallback, useEffect, useState } from "react";
import { api, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { toast } from "sonner";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";

const slugFrom = (txt) => (txt || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/ß/g, "ss")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "")
    .slice(0, 80);

const fieldKeyFrom = (txt) => slugFrom(txt).replace(/-/g, "_");

export default function AdminGamesPage() {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ name: "", slug: "", short_name: "", genre: "", platforms: "", cover_url: "", logo_url: "", player_id_fields: [] });
  const [editing, setEditing] = useState(null);
  const confirm = useConfirm();
  const load = useCallback(async () => { const { data } = await api.get("/games"); setList(data); }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["games"]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/games", {
        ...form,
        platforms: form.platforms ? form.platforms.split(",").map((s) => s.trim()) : [],
        player_id_fields: normalizePlayerIdFields(form.player_id_fields),
      });
      toast.success("Spiel erstellt.");
      setForm({ name: "", slug: "", short_name: "", genre: "", platforms: "", cover_url: "", logo_url: "", player_id_fields: [] });
      load();
    } catch (err) { toast.error(formatRequestError(err, "Spiel konnte nicht erstellt werden.", { slug: form.slug, name: form.name })); }
  };

  const del = async (id) => {
    if (!await confirm({
      title: "Spiel löschen?",
      description: "Das Spiel wird dauerhaft entfernt. Bestehende Verknüpfungen können danach unvollständig sein.",
      confirmLabel: "Löschen",
    })) return;
    try {
      await api.delete(`/games/${id}`);
      toast.success("Spiel geloescht.");
      load();
    } catch (err) {
      toast.error(formatRequestError(err, "Spiel konnte nicht geloescht werden."));
    }
  };

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Games</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6">Spiele</h1>

      <div className="grid lg:grid-cols-3 gap-6">
        <form onSubmit={submit} className="lg:col-span-1 border border-white/10 rounded-sm bg-[#121212] p-5 space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Neues Spiel</div>
          <Input placeholder="Name" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v, slug: f.slug || slugFrom(v) }))} required testId="game-name" />
          <Input placeholder="Slug" value={form.slug} onChange={(v) => set("slug", slugFrom(v))} required testId="game-slug" />
          <Input placeholder="Kurzname (z.B. MK8DX)" value={form.short_name} onChange={(v) => set("short_name", v)} testId="game-short" />
          <Input placeholder="Genre" value={form.genre} onChange={(v) => set("genre", v)} testId="game-genre" />
          <Input placeholder="Plattformen (komma-getrennt)" value={form.platforms} onChange={(v) => set("platforms", v)} testId="game-platforms" />
          <ImageUpload value={form.logo_url} onChange={(v) => set("logo_url", v)} label="Logo" testId="game-logo" variant="square" allowLibrary />
          <ImageUpload value={form.cover_url} onChange={(v) => set("cover_url", v)} label="Cover" testId="game-cover" variant="wide" allowLibrary />
          <PlayerIdFieldsEditor value={form.player_id_fields} onChange={(v) => set("player_id_fields", v)} />
          <button data-testid="game-submit" className="w-full px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] inline-flex items-center justify-center gap-2">
            <Plus className="w-4 h-4" /> Anlegen
          </button>
        </form>
        <div className="lg:col-span-2 border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr><th className="text-left px-4 py-3">Name</th><th className="text-left px-4 py-3">Slug</th><th className="text-left px-4 py-3">Genre</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {list.map((g) => (
                <tr key={g.id}>
                  <td className="px-4 py-3">{g.name}</td>
                  <td className="px-4 py-3 text-white/60">{g.slug}</td>
                  <td className="px-4 py-3 text-white/60">{g.genre || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button onClick={() => setEditing(toForm(g))} className="p-1 text-white/40 hover:text-[#29B6E8]" title="Spiel bearbeiten" data-testid={`game-edit-${g.slug}`}>
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => del(g.id)} className="p-1 text-white/40 hover:text-[#FF3B30]" title="Spiel loeschen" data-testid={`game-delete-${g.slug}`}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editing && <EditGameModal game={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </AdminLayout>
  );
}

function Input({ value, onChange, placeholder, required, testId }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} required={required} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white focus:outline-none text-sm" />;
}

function toForm(game) {
  return {
    id: game.id,
    name: game.name || "",
    slug: game.slug || "",
    short_name: game.short_name || "",
    genre: game.genre || "",
    platforms: (game.platforms || []).join(", "),
    cover_url: game.cover_url || "",
    logo_url: game.logo_url || "",
    supports_solo: game.supports_solo ?? true,
    supports_teams: game.supports_teams ?? true,
    supports_ffa: game.supports_ffa ?? false,
    supports_time_trial: game.supports_time_trial ?? false,
    supports_grand_prix: game.supports_grand_prix ?? false,
    default_team_size: game.default_team_size ?? 1,
    default_format: game.default_format || "single_elim",
    player_id_fields: game.player_id_fields || [],
  };
}

function normalizePlayerIdFields(fields = []) {
  return (fields || [])
    .map((field) => ({
      key: fieldKeyFrom(field.key || field.label || ""),
      label: field.label || field.key || "",
      help_text: field.help_text || "",
      required: field.required !== false,
    }))
    .filter((field) => field.key && field.label);
}

function gamePayload(form) {
  return {
    ...form,
    slug: slugFrom(form.slug),
    platforms: form.platforms ? form.platforms.split(",").map((s) => s.trim()).filter(Boolean) : [],
    default_team_size: Number(form.default_team_size) || 1,
    player_id_fields: normalizePlayerIdFields(form.player_id_fields),
  };
}

function EditGameModal({ game, onClose, onSaved }) {
  const [form, setForm] = useState(game);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/games/${form.id}`, gamePayload(form));
      toast.success("Spiel gespeichert.");
      onSaved();
    } catch (err) {
      toast.error(formatRequestError(err, "Spiel konnte nicht gespeichert werden.", { slug: form.slug, name: form.name }));
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-2xl bg-[#121212] border border-white/10 rounded-sm">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="font-heading font-black uppercase">Spiel bearbeiten</h2>
          <button type="button" onClick={onClose} className="text-white/50 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          <div className="grid md:grid-cols-2 gap-3">
            <Input placeholder="Name" value={form.name} onChange={(v) => { set("name", v); if (!form.slug) set("slug", slugFrom(v)); }} required testId="game-edit-name" />
            <Input placeholder="Slug" value={form.slug} onChange={(v) => set("slug", slugFrom(v))} required testId="game-edit-slug" />
            <Input placeholder="Kurzname" value={form.short_name} onChange={(v) => set("short_name", v)} testId="game-edit-short" />
            <Input placeholder="Genre" value={form.genre} onChange={(v) => set("genre", v)} testId="game-edit-genre" />
          </div>
          <Input placeholder="Plattformen (komma-getrennt)" value={form.platforms} onChange={(v) => set("platforms", v)} testId="game-edit-platforms" />
          <ImageUpload value={form.logo_url} onChange={(v) => set("logo_url", v)} label="Logo" testId="game-edit-logo" variant="square" allowLibrary />
          <ImageUpload value={form.cover_url} onChange={(v) => set("cover_url", v)} label="Cover" testId="game-edit-cover" variant="wide" allowLibrary />
          <PlayerIdFieldsEditor value={form.player_id_fields} onChange={(v) => set("player_id_fields", v)} />
          <div className="grid md:grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.supports_solo} onChange={(e) => set("supports_solo", e.target.checked)} className="accent-[#29B6E8]" /> Solo</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.supports_teams} onChange={(e) => set("supports_teams", e.target.checked)} className="accent-[#29B6E8]" /> Teams</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.supports_ffa} onChange={(e) => set("supports_ffa", e.target.checked)} className="accent-[#29B6E8]" /> Free-for-all</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.supports_time_trial} onChange={(e) => set("supports_time_trial", e.target.checked)} className="accent-[#29B6E8]" /> Time Trial</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.supports_grand_prix} onChange={(e) => set("supports_grand_prix", e.target.checked)} className="accent-[#29B6E8]" /> Grand Prix</label>
            <Input placeholder="Teamgroesse Standard" value={form.default_team_size} onChange={(v) => set("default_team_size", v)} testId="game-edit-team-size" />
          </div>
          <select value={form.default_format} onChange={(e) => set("default_format", e.target.value)} data-testid="game-edit-format" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
            {["single_elim", "double_elim", "round_robin", "swiss", "groups", "time_trial", "grand_prix"].map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-white/10">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-white/10 text-white/60 rounded-sm text-xs uppercase tracking-wider font-bold">Abbrechen</button>
          <button disabled={saving} data-testid="game-edit-save" className="inline-flex items-center gap-2 px-5 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> {saving ? "Speichere..." : "Speichern"}
          </button>
        </div>
      </form>
    </div>
  );
}

function PlayerIdFieldsEditor({ value = [], onChange }) {
  const fields = value || [];
  const update = (idx, patch) => {
    const next = [...fields];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  return (
    <div className="border border-white/10 rounded-sm bg-[#0A0A0A] p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Spieler-IDs</div>
          <div className="text-[10px] text-white/45 mt-0.5">Pflichtfelder werden bei Turnieranmeldungen geprüft.</div>
        </div>
        <button type="button" onClick={() => onChange([...fields, { key: "", label: "", help_text: "", required: true }])} className="text-xs font-bold uppercase tracking-wider text-[#29B6E8]">+ Feld</button>
      </div>
      {fields.map((field, idx) => (
        <div key={idx} className="grid grid-cols-12 gap-2 items-center">
          <input value={field.label || ""} onChange={(e) => update(idx, { label: e.target.value, key: field.key || fieldKeyFrom(e.target.value) })} placeholder="Label, z.B. Activision ID" className="col-span-5 bg-[#121212] border border-white/10 px-2 py-2 rounded-sm text-xs" />
          <input value={field.key || ""} onChange={(e) => update(idx, { key: fieldKeyFrom(e.target.value) })} placeholder="key" className="col-span-3 bg-[#121212] border border-white/10 px-2 py-2 rounded-sm text-xs" />
          <input value={field.help_text || ""} onChange={(e) => update(idx, { help_text: e.target.value })} placeholder="Hinweis" className="col-span-3 bg-[#121212] border border-white/10 px-2 py-2 rounded-sm text-xs" />
          <button type="button" onClick={() => onChange(fields.filter((_, i) => i !== idx))} className="col-span-1 text-white/40 hover:text-[#FF3B30]"><Trash2 className="w-4 h-4" /></button>
          <label className="col-span-12 inline-flex items-center gap-2 text-xs text-white/65">
            <input type="checkbox" checked={field.required !== false} onChange={(e) => update(idx, { required: e.target.checked })} className="accent-[#29B6E8]" />
            Pflichtfeld für Turnieranmeldung
          </label>
        </div>
      ))}
    </div>
  );
}

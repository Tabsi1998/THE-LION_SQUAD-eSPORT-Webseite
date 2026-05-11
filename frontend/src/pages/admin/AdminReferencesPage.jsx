import { useCallback, useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { gameOptionLabel } from "@/lib/gameLabels";
import { toast } from "sonner";
import { ExternalLink, Pencil, Plus, Trash2, X } from "lucide-react";

const emptyReference = {
  title: "",
  organizer: "",
  game_id: "",
  game_name: "",
  team_name: "THE LION SQUAD",
  lineup: [],
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

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("de-DE", { dateStyle: "medium" });
}

export default function AdminReferencesPage() {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({});
  const [games, setGames] = useState([]);
  const [editing, setEditing] = useState(null);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const [{ data: refs }, { data: gameRows }] = await Promise.all([
      api.get("/references/admin"),
      api.get("/games"),
    ]);
    setItems(refs.items || []);
    setSummary(refs.summary || {});
    setGames(gameRows || []);
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

      {editing && <ReferenceForm reference={editing} games={games} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
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

function RefLink({ href, label }) {
  if (!href) return null;
  return <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-[#29B6E8] hover:underline">{label}<ExternalLink className="w-3 h-3" /></a>;
}

function ReferenceForm({ reference, games, onClose, onSaved }) {
  const isNew = !reference.id;
  const [form, setForm] = useState({ ...emptyReference, ...reference, lineup: reference.lineup || [] });
  const [saving, setSaving] = useState(false);
  const [lineupText, setLineupText] = useState((reference.lineup || []).join(", "));
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      ...form,
      lineup: lineupText.split(",").map((name) => name.trim()).filter(Boolean),
      placement: form.placement === "" ? null : Number(form.placement),
      participant_count: form.participant_count === "" ? null : Number(form.participant_count),
      team_count: form.team_count === "" ? null : Number(form.team_count),
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
        <Field label="Titel" value={form.title} onChange={(v) => set("title", v)} required />
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Veranstalter / Liga" value={form.organizer} onChange={(v) => set("organizer", v)} />
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Spiel</div>
            <select value={form.game_id || ""} onChange={(e) => set("game_id", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              <option value="">— Spiel wählen —</option>
              {games.map((game) => <option key={game.id} value={game.id}>{gameOptionLabel(game)}</option>)}
            </select>
          </label>
          <Field label="Spielname falls nicht vorhanden" value={form.game_name} onChange={(v) => set("game_name", v)} />
          <Field label="Team / Lineup-Name" value={form.team_name} onChange={(v) => set("team_name", v)} />
        </div>
        <Field label="Lineup / Fahrer / Spieler (Komma getrennt)" value={lineupText} onChange={setLineupText} placeholder="Name 1, Name 2, Name 3" />
        <div className="grid md:grid-cols-4 gap-3">
          <Field label="Platz" type="number" value={form.placement} onChange={(v) => set("placement", v)} />
          <Field label="Label" value={form.placement_label} onChange={(v) => set("placement_label", v)} placeholder="z.B. Podium" />
          <Field label="Teilnehmer" type="number" value={form.participant_count} onChange={(v) => set("participant_count", v)} />
          <Field label="Teams" type="number" value={form.team_count} onChange={(v) => set("team_count", v)} />
        </div>
        <div className="grid md:grid-cols-4 gap-3">
          <Field label="Start" type="date" value={form.start_date} onChange={(v) => set("start_date", v)} />
          <Field label="Ende" type="date" value={form.end_date} onChange={(v) => set("end_date", v)} />
          <Field label="Ort" value={form.location} onChange={(v) => set("location", v)} />
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

function Field({ label, value, onChange, required, placeholder, type = "text" }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={required} placeholder={placeholder} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
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

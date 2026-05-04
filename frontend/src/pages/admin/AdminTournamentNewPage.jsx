import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { toast } from "sonner";

const FORMATS = [
  ["single_elim", "Single Elimination"],
  ["double_elim", "Double Elimination"],
  ["round_robin", "Round Robin"],
  ["swiss", "Swiss (Struktur, Matches manuell)"],
  ["groups", "Group Stage"],
  ["ffa", "Free For All"],
  ["battle_royale", "Battle Royale"],
  ["league", "Liga"],
  ["time_trial", "Time Trial"],
  ["grand_prix", "Grand Prix"],
];

export default function AdminTournamentNewPage() {
  const nav = useNavigate();
  const [games, setGames] = useState([]);
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState({
    title: "", slug: "", description: "", game_id: "",
    platform: "", event_id: "", format: "single_elim",
    team_mode: "solo", team_size: 1,
    max_participants: 16, min_participants: 2,
    best_of: 1, bronze_match: false, seeding_mode: "random",
    is_public: true, rules: "", prize_pool: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/games").then(({ data }) => setGames(data));
    api.get("/events").then(({ data }) => setEvents(data));
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.event_id) delete payload.event_id;
      const { data } = await api.post("/tournaments", payload);
      toast.success("Turnier erstellt.");
      nav(`/admin/tournaments/${data.id}`);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally { setSaving(false); }
  };

  const autoSlug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  return (
    <AdminLayout>
      <div className="mb-6">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Wizard</span>
        <h1 className="font-heading text-3xl md:text-4xl font-black uppercase">Neues Turnier</h1>
      </div>
      <form onSubmit={submit} className="max-w-3xl space-y-5">
        <Row>
          <Field label="Titel" value={form.title} onChange={(v) => { set("title", v); if (!form.slug) set("slug", autoSlug(v)); }} required testId="new-tr-title" />
          <Field label="Slug (URL)" value={form.slug} onChange={(v) => set("slug", v)} required testId="new-tr-slug" />
        </Row>
        <Textarea label="Beschreibung" value={form.description} onChange={(v) => set("description", v)} testId="new-tr-description" />
        <Row>
          <Select label="Spiel *" value={form.game_id} onChange={(v) => set("game_id", v)} options={[["", "— auswählen —"], ...games.map((g) => [g.id, g.name])]} required testId="new-tr-game" />
          <Select label="Format" value={form.format} onChange={(v) => set("format", v)} options={FORMATS} testId="new-tr-format" />
        </Row>
        <Row>
          <Field label="Plattform" value={form.platform} onChange={(v) => set("platform", v)} placeholder="z.B. Nintendo Switch" testId="new-tr-platform" />
          <Select label="Event" value={form.event_id || ""} onChange={(v) => set("event_id", v)} options={[["", "— keins —"], ...events.map((e) => [e.id, e.name])]} testId="new-tr-event" />
        </Row>
        <Row>
          <Select label="Modus" value={form.team_mode} onChange={(v) => set("team_mode", v)} options={[["solo", "Solo"], ["duo", "Duo"], ["team", "Team"], ["squad", "Squad"]]} testId="new-tr-mode" />
          <Field label="Teamgröße" type="number" value={form.team_size} onChange={(v) => set("team_size", Number(v))} testId="new-tr-team-size" />
        </Row>
        <Row>
          <Field label="Max Teilnehmer" type="number" value={form.max_participants} onChange={(v) => set("max_participants", Number(v))} testId="new-tr-max" />
          <Field label="Min Teilnehmer" type="number" value={form.min_participants} onChange={(v) => set("min_participants", Number(v))} testId="new-tr-min" />
        </Row>
        <Row>
          <Field label="Best of" type="number" value={form.best_of} onChange={(v) => set("best_of", Number(v))} testId="new-tr-bestof" />
          <Select label="Seeding" value={form.seeding_mode} onChange={(v) => set("seeding_mode", v)} options={[["random", "Zufall"], ["manual", "Manuell"], ["ranking", "Ranking"]]} testId="new-tr-seeding" />
        </Row>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.bronze_match} onChange={(e) => set("bronze_match", e.target.checked)} data-testid="new-tr-bronze" className="accent-[#29B6E8]" />
          <span>Bronze Match (Platz 3 ermitteln)</span>
        </label>
        <Textarea label="Regeln" value={form.rules} onChange={(v) => set("rules", v)} testId="new-tr-rules" />
        <Textarea label="Preise" value={form.prize_pool} onChange={(v) => set("prize_pool", v)} testId="new-tr-prizes" />
        <button disabled={saving} data-testid="new-tr-submit" className="px-6 py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] disabled:opacity-50">
          {saving ? "Erstelle …" : "Turnier erstellen"}
        </button>
      </form>
    </AdminLayout>
  );
}

function Row({ children }) { return <div className="grid md:grid-cols-2 gap-4">{children}</div>; }
function Field({ label, value, onChange, type = "text", required, placeholder, testId }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={required} placeholder={placeholder} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white focus:outline-none" />
    </label>
  );
}
function Select({ label, value, onChange, options, required, testId }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} required={required} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white focus:outline-none">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
function Textarea({ label, value, onChange, testId }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={3} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white focus:outline-none" />
    </label>
  );
}

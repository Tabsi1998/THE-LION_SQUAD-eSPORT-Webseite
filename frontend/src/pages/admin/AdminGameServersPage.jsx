import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { api, formatApiError } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useConfirm } from "@/components/tls/ConfirmDialog";

const emptyForm = {
  name: "",
  slug: "",
  game_id: "",
  game_name: "",
  description: "",
  status: "offline",
  visibility: "community",
  address: "",
  connect_url: "",
  password_hint: "",
  rules_url: "",
  map_name: "",
  version: "",
  player_count: 0,
  max_players: "",
  player_names_text: "",
  amp_instance_name: "",
  amp_module: "",
  amp_url: "",
  is_active: true,
  sort_order: 100,
};

const statusLabels = { online: "Online", offline: "Offline", maintenance: "Wartung", planned: "Geplant" };
const visibilityLabels = { public: "Öffentlich", community: "Nur eingeloggte Community", members: "Nur Vereinsmitglieder", internal: "Intern / versteckt" };

function toForm(server) {
  return {
    ...emptyForm,
    ...server,
    game_id: server.game_id || "",
    max_players: server.max_players ?? "",
    player_names_text: (server.player_names || []).join(", "),
  };
}

function toPayload(form) {
  return {
    name: form.name,
    slug: form.slug || null,
    game_id: form.game_id || null,
    game_name: form.game_name || null,
    description: form.description || "",
    status: form.status,
    visibility: form.visibility,
    address: form.address || null,
    connect_url: form.connect_url || null,
    password_hint: form.password_hint || null,
    rules_url: form.rules_url || null,
    map_name: form.map_name || null,
    version: form.version || null,
    player_count: Number(form.player_count || 0),
    max_players: form.max_players === "" ? null : Number(form.max_players || 0),
    player_names: String(form.player_names_text || "").split(",").map((x) => x.trim()).filter(Boolean),
    amp_instance_name: form.amp_instance_name || null,
    amp_module: form.amp_module || null,
    amp_url: form.amp_url || null,
    is_active: !!form.is_active,
    sort_order: Number(form.sort_order || 0),
  };
}

export default function AdminGameServersPage() {
  const [servers, setServers] = useState([]);
  const [games, setGames] = useState([]);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  const load = useCallback(() => {
    api.get("/game-servers/admin").then(({ data }) => setServers(data || [])).catch(() => setServers([]));
    api.get("/games").then(({ data }) => setGames(data || [])).catch(() => setGames([]));
  }, []);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["game-servers", "games"]);

  const stats = useMemo(() => ({
    total: servers.length,
    active: servers.filter((s) => s.is_active !== false).length,
    online: servers.filter((s) => s.status === "online").length,
    hidden: servers.filter((s) => s.visibility === "internal" || s.is_active === false).length,
  }), [servers]);

  const startCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setCreating(true);
  };

  const startEdit = (server) => {
    setCreating(false);
    setEditing(server);
    setForm(toForm(server));
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = toPayload(form);
      if (editing) {
        await api.patch(`/game-servers/${editing.id}`, payload);
        toast.success("Server gespeichert.");
      } else {
        await api.post("/game-servers", payload);
        toast.success("Server erstellt.");
      }
      closeForm();
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (server) => {
    if (!await confirm({ title: "Server löschen?", description: `${server.name} wird dauerhaft entfernt.`, confirmLabel: "Löschen" })) return;
    await api.delete(`/game-servers/${server.id}`);
    toast.success("Server gelöscht.");
    load();
  };

  const touch = async (server) => {
    await api.post(`/game-servers/${server.id}/touch`);
    toast.success("Sync-Zeit aktualisiert.");
    load();
  };

  return (
    <AdminLayout>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Community</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Game-Server</h1>
          <p className="mt-2 text-white/60 text-sm max-w-2xl">
            Server sichtbar pflegen, Zugriff steuern und Live-Werte hinterlegen. AMP-Felder sind vorbereitet, damit ein späterer Sync die Spielerzahlen automatisch aktualisieren kann.
          </p>
        </div>
        <button onClick={startCreate} className="px-5 py-2.5 bg-[#29B6E8] text-black rounded-sm font-bold uppercase tracking-wider inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> Server anlegen
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Server" value={stats.total} />
        <Stat label="Aktiv" value={stats.active} tone="green" />
        <Stat label="Online" value={stats.online} tone="cyan" />
        <Stat label="Versteckt" value={stats.hidden} tone="gold" />
      </div>

      {(creating || editing) && (
        <form onSubmit={save} className="mb-8 border border-[#29B6E8]/25 bg-[#101416] rounded-sm p-5">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <div className="font-heading text-xl font-black uppercase">{editing ? "Server bearbeiten" : "Neuer Server"}</div>
              <div className="text-xs text-white/45 mt-1">Alle Texte im öffentlichen Bereich bleiben bewusst kurz und klar.</div>
            </div>
            <button type="button" onClick={closeForm} className="p-2 text-white/50 hover:text-white"><X className="w-5 h-5" /></button>
          </div>

          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
            <Field label="Name" value={form.name} onChange={(v) => set("name", v)} required />
            <Field label="Slug" value={form.slug} onChange={(v) => set("slug", v)} placeholder="automatisch wenn leer" />
            <label className="block">
              <span className="text-[11px] uppercase tracking-widest text-white/45 font-bold">Spiel-Verknüpfung</span>
              <select value={form.game_id} onChange={(e) => set("game_id", e.target.value)} className="mt-1 w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-2 text-sm">
                <option value="">Keine Verknüpfung</option>
                {games.map((game) => <option key={game.id} value={game.id}>{game.short_name || game.name}</option>)}
              </select>
            </label>
            <Field label="Spielname fallback" value={form.game_name} onChange={(v) => set("game_name", v)} placeholder="z.B. Rust" />
            <label className="block">
              <span className="text-[11px] uppercase tracking-widest text-white/45 font-bold">Status</span>
              <select value={form.status} onChange={(e) => set("status", e.target.value)} className="mt-1 w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-2 text-sm">
                {Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-widest text-white/45 font-bold">Sichtbarkeit</span>
              <select value={form.visibility} onChange={(e) => set("visibility", e.target.value)} className="mt-1 w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-2 text-sm">
                {Object.entries(visibilityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <Field label="Adresse" value={form.address} onChange={(v) => set("address", v)} placeholder="gameserver.lionsquad.at:25565" />
            <Field label="Connect-Link" value={form.connect_url} onChange={(v) => set("connect_url", v)} placeholder="steam://connect/..." />
            <Field label="Spieler online" type="number" value={form.player_count} onChange={(v) => set("player_count", v)} />
            <Field label="Max. Spieler" type="number" value={form.max_players} onChange={(v) => set("max_players", v)} />
            <Field label="Map" value={form.map_name} onChange={(v) => set("map_name", v)} />
            <Field label="Version" value={form.version} onChange={(v) => set("version", v)} />
            <Field label="Sortierung" type="number" value={form.sort_order} onChange={(v) => set("sort_order", v)} />
            <Field label="Regel-Link" value={form.rules_url} onChange={(v) => set("rules_url", v)} />
            <Field label="Passwort-Hinweis" value={form.password_hint} onChange={(v) => set("password_hint", v)} placeholder="z.B. im Discord #server-info" />
            <Field label="AMP Instanzname" value={form.amp_instance_name} onChange={(v) => set("amp_instance_name", v)} />
            <Field label="AMP Modul" value={form.amp_module} onChange={(v) => set("amp_module", v)} placeholder="Minecraft, Generic, Rust..." />
            <Field label="AMP URL intern" value={form.amp_url} onChange={(v) => set("amp_url", v)} placeholder="nur Admin" />
            <label className="md:col-span-2 xl:col-span-4 block">
              <span className="text-[11px] uppercase tracking-widest text-white/45 font-bold">Beschreibung</span>
              <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} className="mt-1 w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-2 text-sm" />
            </label>
            <label className="md:col-span-2 block">
              <span className="text-[11px] uppercase tracking-widest text-white/45 font-bold">Spieler-Namen</span>
              <input value={form.player_names_text} onChange={(e) => set("player_names_text", e.target.value)} className="mt-1 w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-2 text-sm" placeholder="Name1, Name2, Name3" />
            </label>
            <label className="flex items-center gap-2 mt-6 text-sm text-white/75">
              <input type="checkbox" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} className="accent-[#29B6E8]" />
              Server aktiv anzeigen
            </label>
          </div>

          <div className="mt-5 flex gap-2">
            <button disabled={saving} className="px-5 py-2.5 bg-[#29B6E8] text-black rounded-sm font-bold uppercase tracking-wider disabled:opacity-50">
              {saving ? "Speichere…" : "Speichern"}
            </button>
            <button type="button" onClick={closeForm} className="px-5 py-2.5 border border-white/15 text-white/70 rounded-sm font-bold uppercase tracking-wider">
              Abbrechen
            </button>
          </div>
        </form>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {servers.map((server) => (
          <article key={server.id} className="border border-white/10 bg-[#121212] rounded-sm p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{server.game?.short_name || server.game?.name || server.game_name || "Server"}</div>
                <h2 className="font-heading text-xl font-black uppercase truncate">{server.name}</h2>
                <div className="mt-2 flex gap-1 flex-wrap">
                  <Badge label={statusLabels[server.status] || server.status} tone={server.status === "online" ? "green" : server.status === "maintenance" ? "gold" : "muted"} />
                  <Badge label={visibilityLabels[server.visibility] || server.visibility} tone={server.visibility === "members" ? "gold" : server.visibility === "public" ? "cyan" : "muted"} />
                  {server.is_active === false && <Badge label="Inaktiv" tone="red" />}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => touch(server)} title="Sync-Zeit aktualisieren" className="p-2 text-white/45 hover:text-[#29B6E8]"><RefreshCw className="w-4 h-4" /></button>
                <button onClick={() => startEdit(server)} title="Bearbeiten" className="p-2 text-white/45 hover:text-[#29B6E8]"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => remove(server)} title="Löschen" className="p-2 text-white/45 hover:text-[#FF3B30]"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <Info label="Adresse" value={server.address || "-"} />
              <Info label="Spieler" value={`${server.player_count || 0}${server.max_players != null ? `/${server.max_players}` : ""}`} />
              <Info label="AMP" value={server.amp_instance_name || "-"} />
              <Info label="Sync" value={server.last_sync_at ? new Date(server.last_sync_at).toLocaleString("de-DE") : "manuell"} />
            </div>
            {server.description && <p className="mt-3 text-sm text-white/55 line-clamp-2">{server.description}</p>}
          </article>
        ))}
      </div>
    </AdminLayout>
  );
}

function Stat({ label, value, tone }) {
  const color = tone === "green" ? "text-[#00FF88]" : tone === "gold" ? "text-[#FFD700]" : "text-[#29B6E8]";
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
      <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold">{label}</div>
      <div className={`mt-1 font-display text-3xl font-black ${color}`}>{value}</div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder = "", required = false }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-widest text-white/45 font-bold">{label}</span>
      <input required={required} type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1 w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-2 text-sm" />
    </label>
  );
}

function Badge({ label, tone }) {
  const classes = {
    green: "bg-[#00FF88]/10 text-[#00FF88]",
    cyan: "bg-[#29B6E8]/10 text-[#29B6E8]",
    gold: "bg-[#FFD700]/10 text-[#FFD700]",
    red: "bg-[#FF3B30]/10 text-[#FF3B30]",
    muted: "bg-white/10 text-white/55",
  };
  return <span className={`px-2 py-1 rounded-sm text-[10px] font-black uppercase tracking-widest ${classes[tone] || classes.muted}`}>{label}</span>;
}

function Info({ label, value }) {
  return (
    <div className="border border-white/10 bg-black/20 rounded-sm px-3 py-2 min-w-0">
      <div className="text-[10px] uppercase tracking-widest text-white/35 font-bold">{label}</div>
      <div className="mt-1 text-white/75 truncate">{value}</div>
    </div>
  );
}

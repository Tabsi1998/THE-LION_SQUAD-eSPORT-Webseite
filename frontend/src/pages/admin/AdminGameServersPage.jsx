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
  access_secret_kind: "none",
  access_secret: "",
  access_label: "",
  server_icon_url: "",
  map_url: "",
  external_status_url: "",
  password_hint: "",
  rules_url: "",
  map_name: "",
  version: "",
  maintenance_note: "",
  maintenance_until: "",
  player_count: 0,
  max_players: "",
  player_names_text: "",
  sync_provider: "auto_public",
  query_host: "",
  query_port: "",
  rcon_port: "",
  is_active: true,
  sort_order: 100,
};

const statusLabels = { online: "Online", offline: "Offline", maintenance: "Wartung", planned: "Geplant" };
const visibilityLabels = { public: "Öffentlich", community: "Nur eingeloggte Community", members: "Nur Vereinsmitglieder", internal: "Intern / versteckt" };
const syncLabels = { auto_public: "Automatisch erkennen", minecraft: "Minecraft Query", steam_a2s: "Steam/A2S Query", rcon: "TCP / RCON erreichbar", manual: "Manuelle Pflege" };
const secretLabels = { none: "Kein Kennwort", password: "Passwort", invite_code: "Invite-Code", whitelist: "Whitelist / Freischaltung", discord: "Im Discord" };
const modeLabels = { auto: "Automatisch", maintenance: "Wartung", planned: "Geplant" };

function syncText(server) {
  const configured = syncLabels[server.sync_provider || "auto_public"] || "Automatisch erkennen";
  return server.detected_sync_provider && (server.sync_provider || "auto_public") === "auto_public"
    ? `${configured}: ${server.detected_sync_provider}`
    : configured;
}

function datetimeInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toForm(server) {
  return {
    ...emptyForm,
    ...server,
    game_id: server.game_id || "",
    max_players: server.max_players ?? "",
    query_host: server.query_host || "",
    query_port: server.query_port ?? "",
    rcon_port: server.rcon_port ?? "",
    sync_provider: syncLabels[server.sync_provider] ? server.sync_provider : "auto_public",
    access_secret: "",
    maintenance_until: datetimeInputValue(server.maintenance_until),
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
    access_secret_kind: form.access_secret_kind || "none",
    access_secret: form.access_secret || undefined,
    access_label: form.access_label || null,
    server_icon_url: form.server_icon_url || null,
    map_url: form.map_url || null,
    external_status_url: form.external_status_url || null,
    password_hint: form.password_hint || null,
    rules_url: form.rules_url || null,
    map_name: form.map_name || null,
    version: form.version || null,
    maintenance_note: form.maintenance_note || null,
    maintenance_until: form.maintenance_until || null,
    player_count: Number(form.player_count || 0),
    max_players: form.max_players === "" ? null : Number(form.max_players || 0),
    player_names: String(form.player_names_text || "").split(",").map((x) => x.trim()).filter(Boolean),
    sync_provider: form.sync_provider || "auto_public",
    query_host: form.query_host || null,
    query_port: form.query_port === "" ? null : Number(form.query_port || 0),
    rcon_port: form.rcon_port === "" ? null : Number(form.rcon_port || 0),
    is_active: !!form.is_active,
    sort_order: Number(form.sort_order || 0),
  };
}

function operatingMode(status) {
  if (status === "maintenance") return "maintenance";
  if (status === "planned") return "planned";
  return "auto";
}

export default function AdminGameServersPage() {
  const [servers, setServers] = useState([]);
  const [games, setGames] = useState([]);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(null);
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
      if (!payload.access_secret) delete payload.access_secret;
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

  const syncOne = async (server) => {
    setSyncing(server.id);
    try {
      const { data } = await api.post(`/game-servers/${server.id}/sync`);
      if (data.ok) toast.success("Serverdaten synchronisiert.");
      else toast("Sync geprüft. Hinweis wurde am Server gespeichert.");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Sync fehlgeschlagen.");
    } finally {
      setSyncing(null);
    }
  };

  const syncAll = async () => {
    setSyncing("all");
    try {
      const { data } = await api.post("/game-servers/sync");
      if (data.failed) toast(`${data.failed} von ${data.processed} Servern haben einen Sync-Hinweis bekommen.`);
      else toast.success(`${data.processed} Server synchronisiert.`);
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Sync fehlgeschlagen.");
    } finally {
      setSyncing(null);
    }
  };

  const setServerMode = async (server, mode) => {
    const status = mode === "maintenance" ? "maintenance" : mode === "planned" ? "planned" : "offline";
    setSyncing(`${server.id}:mode`);
    try {
      await api.patch(`/game-servers/${server.id}`, { status });
      if (mode === "auto" && server.sync_provider !== "manual") {
        await api.post(`/game-servers/${server.id}/sync`);
      }
      toast.success(`Betrieb auf ${modeLabels[mode]} gestellt.`);
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Betrieb konnte nicht geändert werden.");
    } finally {
      setSyncing(null);
    }
  };

  const removeSeededDefaults = async () => {
    if (!await confirm({
      title: "Demo-Startliste entfernen?",
      description: "Entfernt nur automatisch angelegte Startserver ohne Ersteller. Selbst angelegte Server bleiben erhalten.",
      confirmLabel: "Startliste entfernen",
    })) return;
    try {
      const { data } = await api.delete("/game-servers/seeded-defaults");
      toast.success(`${data.deleted || 0} Demo-Server entfernt.`);
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Startliste konnte nicht entfernt werden.");
    }
  };

  return (
    <AdminLayout>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Community</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Game-Server</h1>
          <p className="mt-2 text-white/60 text-sm max-w-2xl">
            Server sichtbar pflegen, Zugriff steuern und Live-Werte automatisch über öffentliche Game-Server-Abfragen synchronisieren.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={removeSeededDefaults} className="w-full sm:w-auto px-4 py-2.5 border border-[#FFD700]/45 text-[#FFD700] rounded-sm font-bold uppercase tracking-wider">
            Demo-Startliste entfernen
          </button>
          <button onClick={syncAll} disabled={syncing === "all"} className="w-full sm:w-auto px-4 py-2.5 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm font-bold uppercase tracking-wider inline-flex items-center justify-center gap-2 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${syncing === "all" ? "animate-spin" : ""}`} /> Alle syncen
          </button>
          <button onClick={startCreate} className="w-full sm:w-auto px-5 py-2.5 bg-[#29B6E8] text-black rounded-sm font-bold uppercase tracking-wider inline-flex items-center justify-center gap-2">
            <Plus className="w-4 h-4" /> Server anlegen
          </button>
        </div>
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
              <span className="text-[11px] uppercase tracking-widest text-white/45 font-bold">Betrieb</span>
              <div className="mt-1 grid grid-cols-3 gap-1 rounded-sm border border-white/10 bg-[#0A0A0A] p-1">
                {Object.entries(modeLabels).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => set("status", key === "maintenance" ? "maintenance" : key === "planned" ? "planned" : "offline")}
                    className={`px-2 py-2 text-[11px] font-black uppercase tracking-wider rounded-sm ${operatingMode(form.status) === key ? "bg-[#29B6E8] text-black" : "text-white/55 hover:text-white"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-widest text-white/45 font-bold">Sichtbarkeit</span>
              <select value={form.visibility} onChange={(e) => set("visibility", e.target.value)} className="mt-1 w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-2 text-sm">
                {Object.entries(visibilityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <Field label="Adresse" value={form.address} onChange={(v) => set("address", v)} placeholder="gameserver.lionsquad.at:25565" />
            <Field label="Connect-Link" value={form.connect_url} onChange={(v) => set("connect_url", v)} placeholder="steam://connect/..." />
            <label className="block">
              <span className="text-[11px] uppercase tracking-widest text-white/45 font-bold">Zugang</span>
              <select value={form.access_secret_kind} onChange={(e) => set("access_secret_kind", e.target.value)} className="mt-1 w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-2 text-sm">
                {Object.entries(secretLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            {form.access_secret_kind !== "none" && form.access_secret_kind !== "whitelist" && form.access_secret_kind !== "discord" && (
              <Field label={form.access_secret_kind === "invite_code" ? "Invite-Code / neuer Code" : "Passwort / neues Passwort"} type="password" value={form.access_secret} onChange={(v) => set("access_secret", v)} placeholder={editing?.has_access_secret ? "gespeichert, leer lassen" : ""} />
            )}
            {form.access_secret_kind !== "none" && (
              <Field label="Zugangs-Hinweis" value={form.access_label} onChange={(v) => set("access_label", v)} placeholder="z.B. Code im Discord, Passwort kopieren" />
            )}
            <Field label="Server-Icon / Logo" value={form.server_icon_url} onChange={(v) => set("server_icon_url", v)} placeholder="/api/static/uploads/... oder https://..." />
            <Field label="Karten-Link" value={form.map_url} onChange={(v) => set("map_url", v)} placeholder="Dynmap, BattleMetrics, Karte..." />
            <Field label="Externe Statusseite" value={form.external_status_url} onChange={(v) => set("external_status_url", v)} placeholder="z.B. BattleMetrics/Serverliste" />
            <label className="block">
              <span className="text-[11px] uppercase tracking-widest text-white/45 font-bold">Sync-Quelle</span>
              <select value={form.sync_provider} onChange={(e) => set("sync_provider", e.target.value)} className="mt-1 w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-2 text-sm">
                {Object.entries(syncLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            {form.sync_provider !== "manual" && (
              <>
                <Field label="Interne Sync-Adresse" value={form.query_host} onChange={(v) => set("query_host", v)} placeholder="leer = öffentliche Adresse, z.B. host.docker.internal" />
                <Field label="Sync-Port" type="number" value={form.query_port} onChange={(v) => set("query_port", v)} placeholder="z.B. 25565" />
              </>
            )}
            {form.sync_provider === "rcon" && (
              <Field label="RCON-Port" type="number" value={form.rcon_port} onChange={(v) => set("rcon_port", v)} />
            )}
            {form.sync_provider === "manual" && (
              <>
                <div className="block">
                  <span className="text-[11px] uppercase tracking-widest text-white/45 font-bold">Manueller Live-Status</span>
                  <div className="mt-1 grid grid-cols-2 gap-1 rounded-sm border border-white/10 bg-[#0A0A0A] p-1">
                    {["online", "offline"].map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => set("status", value)}
                        className={`px-2 py-2 text-[11px] font-black uppercase tracking-wider rounded-sm ${form.status === value ? "bg-[#29B6E8] text-black" : "text-white/55 hover:text-white"}`}
                      >
                        {statusLabels[value]}
                      </button>
                    ))}
                  </div>
                </div>
                <Field label="Spieler online" type="number" value={form.player_count} onChange={(v) => set("player_count", v)} />
                <Field label="Max. Spieler" type="number" value={form.max_players} onChange={(v) => set("max_players", v)} />
                <Field label="Map" value={form.map_name} onChange={(v) => set("map_name", v)} />
                <Field label="Version" value={form.version} onChange={(v) => set("version", v)} />
                <label className="md:col-span-2 block">
                  <span className="text-[11px] uppercase tracking-widest text-white/45 font-bold">Spieler-Namen</span>
                  <input value={form.player_names_text} onChange={(e) => set("player_names_text", e.target.value)} className="mt-1 w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-2 text-sm" placeholder="Name1, Name2, Name3" />
                </label>
              </>
            )}
            <Field label="Wartungsnotiz" value={form.maintenance_note} onChange={(v) => set("maintenance_note", v)} placeholder="z.B. Mod-Update, neue Map..." />
            <Field label="Wartung bis" type="datetime-local" value={form.maintenance_until} onChange={(v) => set("maintenance_until", v)} />
            <Field label="Sortierung" type="number" value={form.sort_order} onChange={(v) => set("sort_order", v)} />
            <Field label="Regel-Link" value={form.rules_url} onChange={(v) => set("rules_url", v)} />
            <Field label="Allgemeiner Hinweis" value={form.password_hint} onChange={(v) => set("password_hint", v)} placeholder="z.B. Modpack vorher installieren" />
            <label className="md:col-span-2 xl:col-span-4 block">
              <span className="text-[11px] uppercase tracking-widest text-white/45 font-bold">Beschreibung</span>
              <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} className="mt-1 w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-2 text-sm" />
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
                  {server.access_secret_kind && server.access_secret_kind !== "none" && <Badge label={secretLabels[server.access_secret_kind] || "Zugang"} tone="gold" />}
                  {server.is_active === false && <Badge label="Inaktiv" tone="red" />}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => syncOne(server)} disabled={syncing === server.id || server.sync_provider === "manual"} title="Live-Daten synchronisieren" className="p-2 text-white/45 hover:text-[#29B6E8] disabled:opacity-30"><RefreshCw className={`w-4 h-4 ${syncing === server.id ? "animate-spin" : ""}`} /></button>
                <button onClick={() => startEdit(server)} title="Bearbeiten" className="p-2 text-white/45 hover:text-[#29B6E8]"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => remove(server)} title="Löschen" className="p-2 text-white/45 hover:text-[#FF3B30]"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <Info label="Adresse" value={server.address || "-"} />
              <Info label="Spieler" value={`${server.player_count || 0}${server.max_players != null ? `/${server.max_players}` : ""}`} />
              <Info label="Sync" value={syncText(server)} />
              <Info label="Letzter Sync" value={server.last_sync_at ? new Date(server.last_sync_at).toLocaleString("de-DE") : "noch nie"} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(modeLabels).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  disabled={syncing === `${server.id}:mode`}
                  onClick={() => setServerMode(server, mode)}
                  className={`px-3 py-1.5 border rounded-sm text-[10px] font-black uppercase tracking-widest disabled:opacity-50 ${operatingMode(server.status) === mode ? "border-[#29B6E8] text-[#29B6E8] bg-[#29B6E8]/10" : "border-white/10 text-white/50 hover:text-white"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {server.last_sync_note && <div className="mt-3 border border-[#FFD700]/25 bg-[#FFD700]/10 text-[#FFD700] rounded-sm px-3 py-2 text-xs">{server.last_sync_note}</div>}
            {server.last_sync_error && <div className="mt-3 border border-[#FF3B30]/30 bg-[#FF3B30]/10 text-[#FF8A80] rounded-sm px-3 py-2 text-xs">{server.last_sync_error}</div>}
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

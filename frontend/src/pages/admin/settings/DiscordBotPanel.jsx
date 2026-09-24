import { useCallback, useEffect, useState } from "react";
import { Bot, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";

// Discord-Bot (#302): Token, Schalter, Server-ID und Rollennamen - alles hier, nichts in der .env.
// Der Token verlässt den Server nie; „gespeichert“ ist alles, was die Seite davon sieht.

const ROLE_FIELDS = [
  { key: "member", label: "Rolle für aktive Mitglieder", hint: "aktive Mitgliedschaft laut Mitgliederverwaltung" },
  { key: "board", label: "Rolle für den Vorstand", hint: "Bereich „Vereinsverwaltung“" },
  { key: "tournament", label: "Rolle für die Turnierleitung", hint: "Bereich „Turniere“" },
];

export function DiscordBotPanel({ canSystem = false }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({ bot_token: "", bot_guild_id: "", bot_roles: {}, bot_count_messages: true });
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await api.get("/settings/discord");
      const bot = result.data?.bot || {};
      setData(bot);
      setDraft({ bot_token: "", bot_guild_id: bot.guild_id || "", bot_roles: { ...(bot.roles || {}) }, bot_count_messages: bot.count_messages !== false });
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (key, action, message) => {
    if (busy) return;
    setBusy(key);
    try {
      const result = await action();
      if (message) toast.success(typeof message === "function" ? message(result) : message);
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy("");
    }
  };

  const save = () => run("save", () => api.put("/settings/discord", {
    ...(draft.bot_token ? { bot_token: draft.bot_token } : {}),
    bot_guild_id: draft.bot_guild_id,
    bot_roles: draft.bot_roles,
    bot_count_messages: draft.bot_count_messages,
  }), "Bot-Einstellungen gespeichert.");
  const toggle = (enabled) => run("toggle", () => api.put("/settings/discord", { bot_enabled: enabled }), enabled ? "Bot verbindet sich." : "Bot angehalten.");

  if (!data) return null;
  const online = Boolean(data.connected);
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4" data-testid="discord-bot">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-heading font-bold uppercase inline-flex items-center gap-2"><Bot className="w-4 h-4 text-[#5865F2]" /> Discord-Bot</div>
          <p className="mt-1 text-xs text-white/50 max-w-2xl">Zählt Nachrichten verknüpfter Konten (nur die Zahl, nie den Inhalt – für die Discord-Erfolge), gleicht die Rollen Mitglied/Vorstand/Turnierleitung alle zehn Minuten ab und beantwortet <code>/naechstes-event</code>, <code>/turniere</code>, <code>/meine-erfolge</code>, <code>/status</code>. Gezählt und eingeordnet wird nur, wer sein Discord-Konto im Profil verknüpft hat.</p>
        </div>
        <div className="text-right text-[10px] font-bold uppercase tracking-wider space-y-1">
          <div className={online ? "text-[#00FF88]" : data.enabled ? "text-[#FFD700]" : "text-white/45"} data-testid="discord-bot-state">
            {online ? `online · ${data.guild_name || "Server"}` : data.enabled ? "eingeschaltet, nicht verbunden" : "aus"}
          </div>
          <div className="text-white/45 normal-case tracking-normal">{data.linked_count ?? 0} verknüpfte Konten</div>
        </div>
      </div>

      {!data.configured && (
        <div className="border border-[#5865F2]/30 bg-[#5865F2]/10 rounded-sm p-3 text-xs text-white/70 space-y-1" data-testid="discord-bot-setup">
          <div className="font-bold text-[#5865F2] uppercase tracking-wider">So richtest du den Bot ein</div>
          <div>1. discord.com/developers → deine App (dieselbe wie fürs Konto-Verknüpfen) → <strong>Bot</strong> → „Reset Token“ → Token hier eintragen.</div>
          <div>2. Dort unter „Privileged Gateway Intents“ den <strong>Server Members Intent</strong> anschalten (für den Rollenabgleich). Message Content bleibt aus – der Bot liest keine Inhalte.</div>
          <div>3. Unter OAuth2 → URL Generator: Scopes <code>bot</code> + <code>applications.commands</code>, Rechte „Manage Roles“ – mit der Adresse den Bot auf den Server holen. Die Bot-Rolle muss in der Rollenliste <strong>über</strong> Mitglied/Vorstand/Turnierleitung stehen.</div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        <label className="block">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Bot-Token {data.configured && <span className="text-white/40 normal-case">(gespeichert – leer lassen, um ihn zu behalten)</span>}</div>
          <input type="password" value={draft.bot_token} onChange={(e) => setDraft((d) => ({ ...d, bot_token: e.target.value }))} autoComplete="off" placeholder={data.configured ? "••••••" : "Token aus dem Developer Portal"} data-testid="discord-bot-token" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
          {data.configured && canSystem && <button type="button" onClick={() => run("clear", () => api.put("/settings/discord", { clear_bot_token: true, bot_enabled: false }), "Token entfernt, Bot angehalten.")} className="mt-2 text-[10px] uppercase font-bold text-[#FF6B6B]">Gespeicherten Token entfernen</button>}
        </label>
        <label className="block">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Server-ID (optional)</div>
          <input value={draft.bot_guild_id} onChange={(e) => setDraft((d) => ({ ...d, bot_guild_id: e.target.value.replace(/\D/g, "") }))} inputMode="numeric" placeholder="leer = der Server, auf dem der Bot ist" data-testid="discord-bot-guild" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
          <p className="mt-1 text-xs text-white/40">Nur nötig, wenn der Bot auf mehreren Servern ist. Discord → Einstellungen → Erweitert → Entwicklermodus, dann Rechtsklick auf den Server → „ID kopieren“.</p>
        </label>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        {ROLE_FIELDS.map((role) => (
          <label key={role.key} className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{role.label}</div>
            <input value={draft.bot_roles?.[role.key] || ""} onChange={(e) => setDraft((d) => ({ ...d, bot_roles: { ...d.bot_roles, [role.key]: e.target.value } }))} placeholder={data.roles?.[role.key] || ""} data-testid={`discord-bot-role-${role.key}`} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
            <p className="mt-1 text-xs text-white/40">{role.hint} – Rollenname genau wie im Discord.</p>
          </label>
        ))}
      </div>
      {Array.isArray(data.missing_roles) && data.missing_roles.length > 0 && (
        <div className="text-xs text-[#FFD700]" data-testid="discord-bot-missing-roles">Im Discord fehlen diese Rollen: {data.missing_roles.join(", ")} – anlegen oder hier den Namen anpassen.</div>
      )}
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.bot_count_messages} onChange={(e) => setDraft((d) => ({ ...d, bot_count_messages: e.target.checked }))} className="accent-[#29B6E8]" data-testid="discord-bot-count" />
        Nachrichten verknüpfter Konten zählen (nur die Zahl – für die Erfolge „Discord-Aktiv“)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={!!busy} data-testid="discord-bot-save" className="px-5 py-2 bg-[#5865F2] text-white font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-50">{busy === "save" ? "Speichere..." : "Speichern"}</button>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={Boolean(data.enabled)} disabled={!!busy || (!data.configured && !data.enabled)} onChange={(e) => toggle(e.target.checked)} className="accent-[#00FF88]" data-testid="discord-bot-enabled" />
          Bot verbinden
        </label>
        <button type="button" onClick={() => run("sync", () => api.post("/settings/discord/bot/sync"), ({ data: res }) => (res?.ok ? `Rollen abgeglichen: ${res.changes} Änderungen bei ${res.linked} verknüpften Konten.` : `Nicht abgeglichen: ${res?.reason || "Bot offline"}`))} disabled={!!busy || !online} data-testid="discord-bot-sync" className="px-4 py-2 border border-white/20 text-white/80 font-bold uppercase tracking-wider rounded-sm text-xs inline-flex items-center gap-2 disabled:opacity-40">
          <RefreshCw className={`w-3.5 h-3.5 ${busy === "sync" ? "animate-spin" : ""}`} /> Rollen jetzt abgleichen
        </button>
      </div>
      {(data.last_action || data.last_error || data.last_sync_at) && (
        <div className={`border rounded-sm p-3 text-xs ${data.last_error ? "border-[#FF3B30]/25 bg-[#FF3B30]/5" : "border-white/10"} text-white/60`} data-testid="discord-bot-log">
          {data.last_action && <div>Letzte Aktion: {data.last_action}</div>}
          {data.last_sync_at && <div>Letzter Rollenabgleich: {new Date(data.last_sync_at).toLocaleString("de-DE")} · {data.last_sync_changes || 0} Änderungen{data.last_sync_errors ? ` · ${data.last_sync_errors} Fehler` : ""}</div>}
          {data.last_error && <div className="text-[#FF3B30] break-words">Letzter Fehler: {data.last_error}</div>}
          {data.enabled && !online && <div className="text-white/45" data-testid="discord-bot-retry">Der Bot versucht es alle fünf Minuten von selbst wieder – nach dem Speichern hier sofort.</div>}
        </div>
      )}
    </div>
  );
}

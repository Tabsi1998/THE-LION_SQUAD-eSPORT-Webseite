import { useCallback, useEffect, useState } from "react";
import { Pin, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { channelOptionLabel } from "./DiscordTargets";
import { viennaDateTime } from "@/lib/vienna";

// Live-Einbettungen (#569): je Einbettung ein Kanal und ein Schalter; der Bot postet eine Nachricht,
// pinnt sie und bearbeitet sie danach (höchstens einmal pro Minute, ein Sammler alle zehn Minuten).
// Hier steht je Einbettung der Stand: gepostet, zuletzt aktualisiert, Fehler im Klartext.
// Seit #628 je Spielserver: Rangliste und nächste Termine nur mit den Spielen dieses Servers.

export const EMBED_ORDER = ["ranking", "events", "achievement_week"];
// Auf Spielservern (#628): der Erfolg der Woche gilt für den ganzen Verein und bleibt am Hauptserver.
export const SUB_EMBEDS = ["ranking", "events"];

export function whenText(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : viennaDateTime(date);
}

// „zuletzt geprüft“ (#883): ob der Lauf überhaupt noch kommt - sonst stand „Nachricht steht“ tagelang still da.
function checkedText(entry) {
  return entry.checked_at ? ` · zuletzt geprüft ${whenText(entry.checked_at)}` : "";
}

export function stateText(entry) {
  if (!entry) return "";
  if (entry.error) return `Fehler: ${entry.error}${checkedText(entry)}`;
  if (!entry.enabled) return "aus";
  if (!entry.channel_id) return "kein Kanal gewählt – es wird nichts gepostet";
  if (entry.paused) return `Angehalten: ${entry.paused}${checkedText(entry)}`;
  if (!entry.message_id) return "eingeschaltet – die Nachricht kommt mit dem nächsten Lauf";
  return `Nachricht steht${entry.updated_at ? ` · Stand ${whenText(entry.updated_at)}` : ""}${entry.pending ? " · Änderung vorgemerkt" : ""}${checkedText(entry)}`;
}

export function refreshResultText(result) {
  if (result?.ok) return result.reason === "posted" ? "Nachricht gepostet und angepinnt." : result.reason === "unchanged" ? "Inhalt unverändert." : "Nachricht aktualisiert.";
  return `Nicht aktualisiert: ${result?.error || result?.reason || "unbekannt"}`;
}

/** Eine Einbettung: Schalter, Stand, Kanal (Liste oder ID), Speichern, Jetzt aktualisieren - am Hauptserver und je Spielserver gleich. */
function EmbedRow({ prefix, label, hint, entry, channels, draft, onDraft, busy, onToggle, onSave, onRefresh }) {
  const current = draft ?? (entry.channel_id || "");
  const list = channels.channels || [];
  const known = list.some((channel) => channel.id === current);
  const options = !known && current ? [{ id: current, name: `Kanal-ID ${current}`, category: "", can_send: true, can_embed: true }, ...list] : list;
  return (
    <div className="border border-white/10 rounded-sm p-3 space-y-2" data-testid={prefix}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" checked={!!entry.enabled} disabled={!!busy} onChange={(e) => onToggle(e.target.checked)} className="accent-[#5865F2]" data-testid={`${prefix}-enabled`} />
          <span>{label}</span>
        </label>
        <span className={`text-[11px] ${entry.error ? "text-[#FF6B6B]" : "text-white/45"}`} data-testid={`${prefix}-state`}>{stateText(entry)}</span>
      </div>
      {hint ? <p className="text-xs text-white/45">{hint}</p> : null}
      <div className="grid sm:grid-cols-[minmax(0,1fr)_auto] gap-2 items-start">
        {channels.ok ? (
          <select aria-label={`Kanal für ${label}`} value={current} onChange={(e) => onDraft(e.target.value)}
            data-testid={`${prefix}-channel`} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
            <option value="">– kein Kanal –</option>
            {options.map((channel) => <option key={channel.id} value={channel.id} disabled={!channel.can_send}>{channelOptionLabel(channel)}</option>)}
          </select>
        ) : (
          <input aria-label={`Kanal-ID für ${label}`} inputMode="numeric" placeholder="Kanal-ID (Discord: Rechtsklick auf den Kanal → „Kanal-ID kopieren“)"
            value={current} onChange={(e) => onDraft(e.target.value.replace(/\D/g, ""))}
            data-testid={`${prefix}-id`} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => onSave(String(current).trim())} disabled={!!busy || draft === undefined} data-testid={`${prefix}-save`}
            className="px-3 py-1.5 bg-[#29B6E8] text-black text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-40">Speichern</button>
          <button type="button" onClick={onRefresh} disabled={!!busy || !entry.enabled || !entry.channel_id} data-testid={`${prefix}-refresh`}
            className="px-3 py-1.5 border border-[#5865F2]/60 text-[#b8c0ff] text-[10px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1 disabled:opacity-40">
            <RefreshCw className={`w-3 h-3 ${busy === "refresh" ? "animate-spin" : ""}`} /> Jetzt aktualisieren
          </button>
        </div>
      </div>
    </div>
  );
}

/** Gemeinsamer Ablauf: eine Aktion zur Zeit, Rückmeldung als Hinweis, danach neu laden. */
function useRunner(reload) {
  const [busy, setBusy] = useState("");
  const run = async (key, action, message) => {
    if (busy) return;
    setBusy(key);
    try {
      const result = await action();
      if (message) {
        const text = typeof message === "function" ? message(result) : message;
        if (result?.data && result.data.ok === false) toast.error(text);
        else toast.success(text);
      }
      await reload();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy("");
    }
  };
  return [busy, run];
}

/** Ein Spielserver (#628): Rangliste und nächste Termine nur mit seinen Spielen - Kanäle aus seiner eigenen Liste. */
function GuildEmbeds({ guild, labels, reload }) {
  const [channels, setChannels] = useState({ ok: false, channels: [] });
  const [drafts, setDrafts] = useState({});
  const [busy, run] = useRunner(reload);
  useEffect(() => {
    let alive = true;
    api.get(`/settings/discord/guilds/${guild.guild_id}/channels`)
      .then(({ data }) => alive && setChannels({ ok: !!data?.ok, channels: data?.channels || [] }))
      .catch(() => alive && setChannels({ ok: false, channels: [] }));
    return () => { alive = false; };
  }, [guild.guild_id]);
  const games = Array.isArray(guild.games) ? guild.games : [];
  const save = (kind, patch, message) => run(`save-${kind}`, () => api.patch(`/settings/discord/guilds/${guild.guild_id}`, { embeds: { [kind]: patch } }).then((result) => {
    setDrafts((current) => { const next = { ...current }; delete next[kind]; return next; });
    return result;
  }), message);
  return (
    <div className="space-y-2" data-testid={`discord-embeds-guild-${guild.guild_id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-bold">{guild.name}</div>
        <div className="text-[11px] text-white/45" data-testid={`discord-embeds-guild-${guild.guild_id}-games`}>
          {games.length ? `nur ${games.map((game) => game.name).join(", ")}` : "noch kein Spiel zugeordnet – Spiele → Spiel bearbeiten → Discord-Server"}
        </div>
      </div>
      {SUB_EMBEDS.map((kind) => {
        const entry = (guild.embeds || {})[kind] || {};
        return (
          <EmbedRow key={kind} prefix={`discord-embeds-guild-${guild.guild_id}-${kind}`} label={labels[kind] || kind} entry={entry} channels={channels}
            draft={drafts[kind]} onDraft={(value) => setDrafts((current) => ({ ...current, [kind]: value }))} busy={busy && (busy === `refresh-${kind}` ? "refresh" : busy)}
            onToggle={(checked) => save(kind, { enabled: checked }, checked ? `Einbettung auf „${guild.name}“ an – die Nachricht kommt mit dem nächsten Lauf.` : "Einbettung aus.")}
            onSave={(channelId) => save(kind, { channel_id: channelId }, "Kanal gespeichert – eine neue Nachricht kommt mit dem nächsten Lauf.")}
            onRefresh={() => run(`refresh-${kind}`, () => api.post(`/settings/discord/guilds/${guild.guild_id}/embeds/${kind}/refresh`), ({ data: result }) => refreshResultText(result))} />
        );
      })}
    </div>
  );
}

export function DiscordEmbedsPanel() {
  const [data, setData] = useState(null);
  const [guilds, setGuilds] = useState([]);
  const [channels, setChannels] = useState({ ok: false, channels: [], text: "" });
  const [drafts, setDrafts] = useState({});

  const load = useCallback(async () => {
    try {
      const result = await api.get("/settings/discord");
      setData(result.data);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    try {
      const result = await api.get("/settings/discord/guilds");
      const rows = Array.isArray(result.data?.guilds) ? result.data.guilds : [];
      setGuilds(rows.filter((row) => row.role === "sub" && row.enabled && !row.left_at));
    } catch {
      setGuilds([]);
    }
  }, []);
  const loadChannels = useCallback(async () => {
    try {
      const result = await api.get("/settings/discord/channels");
      setChannels({ ok: !!result.data?.ok, channels: result.data?.channels || [], text: result.data?.text || "" });
    } catch {
      setChannels({ ok: false, channels: [], text: "" });
    }
  }, []);
  useEffect(() => { load(); loadChannels(); }, [load, loadChannels]);
  const [busy, run] = useRunner(load);

  const save = (kind, patch, message) => run(`save-${kind}`, () => api.put("/settings/discord", { embeds: { [kind]: patch } }).then((result) => {
    setDrafts((current) => { const next = { ...current }; delete next[kind]; return next; });
    return result;
  }), message);

  if (!data) return null;
  const embeds = data.embeds || {};
  const labels = Object.fromEntries(EMBED_ORDER.map((kind) => [kind, (embeds[kind] || {}).label || kind]));
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4" data-testid="discord-embeds">
      <div>
        <div className="font-heading font-bold uppercase inline-flex items-center gap-2"><Pin className="w-4 h-4 text-[#5865F2]" /> Einbettungen, die sich aktualisieren</div>
        <p className="mt-1 text-xs text-white/50">
          Je Einbettung postet der Bot eine Nachricht, pinnt sie und bearbeitet sie danach – bei Änderungen binnen einer Minute, dazu ein Sammler alle zehn Minuten („Stand: …“ in der Fußzeile).
          Wird die Nachricht im Discord gelöscht, postet er sie neu. Kein Nachrichten-Spam.
        </p>
      </div>
      <div className="space-y-3">
        {guilds.length > 0 && <div className="text-[10px] font-bold uppercase tracking-widest text-white/45">Hauptserver – alle Spiele</div>}
        {EMBED_ORDER.map((kind) => {
          const entry = embeds[kind] || {};
          return (
            <EmbedRow key={kind} prefix={`discord-embed-${kind}`} label={entry.label || kind} hint={entry.hint} entry={entry} channels={channels}
              draft={drafts[kind]} onDraft={(value) => setDrafts((d) => ({ ...d, [kind]: value }))} busy={busy && (busy === `refresh-${kind}` ? "refresh" : busy)}
              onToggle={(checked) => save(kind, { enabled: checked }, checked ? "Einbettung an – die Nachricht kommt mit dem nächsten Lauf." : "Einbettung aus.")}
              onSave={(channelId) => save(kind, { channel_id: channelId }, "Kanal gespeichert – eine neue Nachricht kommt mit dem nächsten Lauf.")}
              onRefresh={() => run(`refresh-${kind}`, () => api.post(`/settings/discord/embeds/${kind}/refresh`), ({ data: result }) => refreshResultText(result))} />
          );
        })}
      </div>
      {guilds.length > 0 && (
        <div className="space-y-4 border-t border-white/10 pt-4" data-testid="discord-embeds-guilds">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-white/45">Spielserver</div>
            <p className="mt-1 text-xs text-white/45">
              Auf jedem Spielserver gibt es die Rangliste und die nächsten Termine noch einmal – nur mit den Spielen dieses Servers. Der Erfolg der Woche gilt für den ganzen Verein und bleibt am Hauptserver.
            </p>
          </div>
          {guilds.map((guild) => <GuildEmbeds key={guild.guild_id} guild={guild} labels={labels} reload={load} />)}
        </div>
      )}
    </div>
  );
}

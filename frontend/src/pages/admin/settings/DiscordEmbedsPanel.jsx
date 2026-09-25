import { useCallback, useEffect, useState } from "react";
import { Pin, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { channelOptionLabel } from "./DiscordTargets";

// Live-Einbettungen (#569): je Einbettung ein Kanal und ein Schalter; der Bot postet eine Nachricht,
// pinnt sie und bearbeitet sie danach (höchstens einmal pro Minute, ein Sammler alle zehn Minuten).
// Hier steht je Einbettung der Stand: gepostet, zuletzt aktualisiert, Fehler im Klartext.

export const EMBED_ORDER = ["ranking", "events", "live"];

export function whenText(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("de-DE");
}

export function stateText(entry) {
  if (!entry) return "";
  if (entry.error) return `Fehler: ${entry.error}`;
  if (!entry.enabled) return "aus";
  if (!entry.channel_id) return "kein Kanal gewählt – es wird nichts gepostet";
  if (!entry.message_id) return "eingeschaltet – die Nachricht kommt mit dem nächsten Lauf";
  return `Nachricht steht${entry.updated_at ? ` · Stand ${whenText(entry.updated_at)}` : ""}${entry.pending ? " · Änderung vorgemerkt" : ""}`;
}

export function refreshResultText(result) {
  if (result?.ok) return result.reason === "posted" ? "Nachricht gepostet und angepinnt." : result.reason === "unchanged" ? "Inhalt unverändert." : "Nachricht aktualisiert.";
  return `Nicht aktualisiert: ${result?.error || result?.reason || "unbekannt"}`;
}

export function DiscordEmbedsPanel() {
  const [data, setData] = useState(null);
  const [channels, setChannels] = useState({ ok: false, channels: [], text: "" });
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await api.get("/settings/discord");
      setData(result.data);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
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
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy("");
    }
  };
  const save = (kind, patch, message) => run(`save-${kind}`, () => api.put("/settings/discord", { embeds: { [kind]: patch } }).then((result) => {
    setDrafts((current) => { const next = { ...current }; delete next[kind]; return next; });
    return result;
  }), message);
  const refresh = (kind) => run(`refresh-${kind}`, () => api.post(`/settings/discord/embeds/${kind}/refresh`), ({ data: result }) => refreshResultText(result));

  if (!data) return null;
  const embeds = data.embeds || {};
  const list = channels.channels || [];
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
        {EMBED_ORDER.map((kind) => {
          const entry = embeds[kind] || {};
          const current = drafts[kind] ?? (entry.channel_id || "");
          const known = list.some((channel) => channel.id === current);
          const options = !known && current ? [{ id: current, name: `Kanal-ID ${current}`, category: "", can_send: true, can_embed: true }, ...list] : list;
          return (
            <div key={kind} className="border border-white/10 rounded-sm p-3 space-y-2" data-testid={`discord-embed-${kind}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm font-bold">
                  <input type="checkbox" checked={!!entry.enabled} disabled={!!busy} onChange={(e) => save(kind, { enabled: e.target.checked }, e.target.checked ? "Einbettung an – die Nachricht kommt mit dem nächsten Lauf." : "Einbettung aus.")} className="accent-[#5865F2]" data-testid={`discord-embed-${kind}-enabled`} />
                  <span>{entry.label || kind}</span>
                </label>
                <span className={`text-[11px] ${entry.error ? "text-[#FF6B6B]" : "text-white/45"}`} data-testid={`discord-embed-${kind}-state`}>{stateText(entry)}</span>
              </div>
              <p className="text-xs text-white/45">{entry.hint}</p>
              <div className="grid sm:grid-cols-[minmax(0,1fr)_auto] gap-2 items-start">
                {channels.ok ? (
                  <select aria-label={`Kanal für ${entry.label || kind}`} value={current} onChange={(e) => setDrafts((d) => ({ ...d, [kind]: e.target.value }))}
                    data-testid={`discord-embed-${kind}-channel`} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
                    <option value="">– kein Kanal –</option>
                    {options.map((channel) => <option key={channel.id} value={channel.id} disabled={!channel.can_send}>{channelOptionLabel(channel)}</option>)}
                  </select>
                ) : (
                  <input aria-label={`Kanal-ID für ${entry.label || kind}`} inputMode="numeric" placeholder="Kanal-ID (Discord: Rechtsklick auf den Kanal → „Kanal-ID kopieren“)"
                    value={current} onChange={(e) => setDrafts((d) => ({ ...d, [kind]: e.target.value.replace(/\D/g, "") }))}
                    data-testid={`discord-embed-${kind}-id`} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => save(kind, { channel_id: String(current).trim() }, "Kanal gespeichert – eine neue Nachricht kommt mit dem nächsten Lauf.")} disabled={!!busy || drafts[kind] === undefined} data-testid={`discord-embed-${kind}-save`}
                    className="px-3 py-1.5 bg-[#29B6E8] text-black text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-40">Speichern</button>
                  <button type="button" onClick={() => refresh(kind)} disabled={!!busy || !entry.enabled || !entry.channel_id} data-testid={`discord-embed-${kind}-refresh`}
                    className="px-3 py-1.5 border border-[#5865F2]/60 text-[#b8c0ff] text-[10px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1 disabled:opacity-40">
                    <RefreshCw className={`w-3 h-3 ${busy === `refresh-${kind}` ? "animate-spin" : ""}`} /> Jetzt aktualisieren
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

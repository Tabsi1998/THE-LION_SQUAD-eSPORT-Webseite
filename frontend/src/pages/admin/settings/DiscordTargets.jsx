import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";

// Kanal je Zweck und Schalter je Ereignis (#300, #566): der Bot schickt alles. Öffentliche Ziele
// fallen ohne eigenen Kanal auf „Community“ zurück; Vorstand und Betrieb sind privat und fallen nie
// zurück - fehlt ihr Kanal, wird nichts gesendet. Bot aus = keine Meldung, kein Webhook-Rückfall.

const TARGET_ORDER = ["community", "news", "events", "board", "ops"];
const TARGET_HINTS = {
  community: "Standard für alles Öffentliche: Turnier-Meldungen, Fast-Lap-Bestzeiten – und News und Events ohne eigenen Kanal.",
  news: "Veröffentlichte News.",
  events: "Angekündigte Events, Turnier-Meldungen, Fast-Lap-Bestzeiten.",
  board: "Privat: neue Mitgliedsanträge und Kontaktanfragen – ohne Namen. Ohne eigenen Kanal wird nichts gesendet.",
  ops: "Privat: rote Auto-Checks und neue Serverfehler (Betrieb & Logs → Alarme). Ohne eigenen Kanal wird nichts gesendet.",
};

export function deliveryText(target, status) {
  const entry = status?.[target];
  if (!entry) return "";
  if (entry.configured) return entry.channel_name ? `#${entry.channel_name}` : "Kanal gewählt";
  if (entry.private) return "kein Kanal – es wird nichts gesendet";
  return entry.delivers_to ? "kein eigener Kanal – geht an Community" : "kein Kanal gewählt";
}

export function lastAttemptText(last) {
  if (!last) return "";
  const when = new Date(last.created_at).toLocaleString("de-DE");
  if (last.status === "sent") return `zuletzt gesendet · ${when}`;
  return `zuletzt fehlgeschlagen · ${when}${last.error ? ` – ${last.error}` : ""}`;
}

export function channelOptionLabel(channel) {
  const base = `#${channel.name}${channel.category ? ` (${channel.category})` : ""}`;
  if (!channel.can_send) return `${base} – Bot darf hier nicht schreiben`;
  if (!channel.can_embed) return `${base} – ohne „Links einbetten“`;
  return base;
}

export function DiscordTargets() {
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
      setChannels({ ok: !!result.data?.ok, channels: result.data?.channels || [], text: result.data?.text || "", reason: result.data?.reason });
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  }, []);
  useEffect(() => { load(); loadChannels(); }, [load, loadChannels]);

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

  const setDraft = (target, value) => setDrafts((current) => ({ ...current, [target]: value }));
  const saveTarget = (target) => {
    const value = String(drafts[target] ?? "").trim();
    return run(`save-${target}`, () => api.put("/settings/discord", { channels: { [target]: value } }).then(() => setDrafts((current) => {
      const next = { ...current };
      delete next[target];
      return next;
    })), value ? "Kanal gespeichert." : "Kanal entfernt.");
  };
  const clearTarget = (target) => run(`clear-${target}`, () => api.put("/settings/discord", { channels: { [target]: "" } }), "Kanal entfernt.");
  const testTarget = (target) => run(`test-${target}`, () => api.post(`/settings/discord/test?target=${target}`), ({ data: result }) => (
    result?.ok
      ? `Test gesendet${result.target && result.target !== target ? " – ging an Community, weil kein eigener Kanal gewählt ist" : ""}.`
      : `Nicht gesendet: ${result?.error || result?.reason || "unbekannt"}`
  ));
  const toggleEvent = (key, enabled) => run(`event-${key}`, () => api.put("/settings/discord", { events: { [key]: enabled } }));

  if (!data) return null;
  const status = data.target_status || {};
  const botOff = Boolean(data.bot) && !data.bot.enabled;
  const list = channels.channels || [];
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-5" data-testid="discord-targets">
      <div>
        <div className="font-heading font-bold uppercase">Kanäle je Zweck</div>
        <p className="mt-1 text-xs text-white/50">
          Der Bot schickt alle Meldungen. Je Zweck ein Kanal aus der Liste (das sind die Kanäle, in denen der Bot schreiben darf) – ohne Liste die Kanal-ID.
          Ohne eigenen Kanal gehen News und Events in den Community-Kanal. Was nur Mitglieder oder der Vorstand sehen dürfen, geht nie in einen öffentlichen Kanal – egal, was hier steht.
        </p>
      </div>
      {botOff && (
        <div className="border border-[#FFD700]/40 bg-[#FFD700]/10 rounded-sm p-3 text-xs text-white/80" data-testid="discord-targets-bot-off">
          Der Bot ist aus – ohne Bot wird nichts gesendet. Unten im Bot-Kasten „Bot verbinden“ einschalten.
        </div>
      )}
      {!channels.ok && channels.text && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-white/50" data-testid="discord-channels-offline">
          <span>{channels.text}</span>
          <button type="button" onClick={loadChannels} className="inline-flex items-center gap-1 border border-white/15 px-2 py-1 rounded-sm text-[10px] font-bold uppercase tracking-wider text-white/70 hover:text-white">
            <RefreshCw className="w-3 h-3" /> Liste neu laden
          </button>
        </div>
      )}
      <div className="space-y-4">
        {TARGET_ORDER.map((target) => {
          const entry = status[target] || {};
          const current = drafts[target] ?? (entry.channel_id || "");
          const known = list.some((channel) => channel.id === current);
          const options = !known && current ? [{ id: current, name: `Kanal-ID ${current}`, category: "", can_send: true, can_embed: true }, ...list] : list;
          return (
            <div key={target} className={`border rounded-sm p-3 space-y-2 ${entry.private ? "border-[#FFD700]/25" : "border-white/10"}`} data-testid={`discord-target-${target}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-bold text-sm">{entry.label || target}</div>
                <span className={`text-[10px] font-black uppercase tracking-widest ${entry.configured ? "text-[#00FF88]" : entry.private ? "text-[#FFD700]" : "text-white/45"}`} data-testid={`discord-target-${target}-state`}>
                  {deliveryText(target, status)}
                </span>
              </div>
              <p className="text-xs text-white/45">{TARGET_HINTS[target]}</p>
              <div className="grid sm:grid-cols-[minmax(0,1fr)_auto] gap-2 items-start">
                {channels.ok ? (
                  <select aria-label={`Kanal für ${entry.label || target}`} value={current} onChange={(e) => setDraft(target, e.target.value)}
                    data-testid={`discord-target-${target}-channel`} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
                    <option value="">– kein Kanal –</option>
                    {options.map((channel) => (
                      <option key={channel.id} value={channel.id} disabled={!channel.can_send}>{channelOptionLabel(channel)}</option>
                    ))}
                  </select>
                ) : (
                  <input aria-label={`Kanal-ID für ${entry.label || target}`} inputMode="numeric" placeholder="Kanal-ID (Discord: Rechtsklick auf den Kanal → „Kanal-ID kopieren“)"
                    value={current} onChange={(e) => setDraft(target, e.target.value.replace(/\D/g, ""))}
                    data-testid={`discord-target-${target}-id`} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => saveTarget(target)} disabled={!!busy || drafts[target] === undefined} data-testid={`discord-target-${target}-save`}
                    className="px-3 py-1.5 bg-[#29B6E8] text-black text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-40">Speichern</button>
                  <button type="button" onClick={() => testTarget(target)} disabled={!!busy} data-testid={`discord-target-${target}-test`}
                    className="px-3 py-1.5 border border-[#5865F2]/60 text-[#b8c0ff] text-[10px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1 disabled:opacity-40">
                    <Send className="w-3 h-3" /> Test
                  </button>
                  {entry.configured && (
                    <button type="button" onClick={() => clearTarget(target)} disabled={!!busy} data-testid={`discord-target-${target}-clear`}
                      className="px-3 py-1.5 border border-white/20 text-white/60 text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-40">Entfernen</button>
                  )}
                </div>
              </div>
              {entry.last && (
                <div className={`text-xs ${entry.last.status === "sent" ? "text-white/45" : "text-[#FF6B6B]"}`} data-testid={`discord-target-${target}-last`}>
                  {lastAttemptText(entry.last)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div>
        <div className="font-heading font-bold uppercase text-sm">Was gemeldet wird</div>
        <div className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-2">
          {(data.events || []).map((event) => (
            <label key={event.key} className="flex items-center gap-2 text-sm" data-testid={`discord-event-${event.key}`}>
              <input type="checkbox" checked={!!event.enabled} disabled={!!busy} onChange={(e) => toggleEvent(event.key, e.target.checked)} className="accent-[#29B6E8]" />
              <span>{event.label}</span>
              <span className="text-[10px] uppercase tracking-widest text-white/35">{status[event.target]?.label || event.target}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

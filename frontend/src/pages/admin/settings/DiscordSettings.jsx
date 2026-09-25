import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Search } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError, resolveMediaUrl } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useAuth } from "@/context/AuthContext";
import { DiscordBotPanel } from "./DiscordBotPanel";
import { DiscordSamplesPanel } from "./DiscordSamplesPanel";
import { DiscordTargets } from "./DiscordTargets";

// Discord: Meldungen über den Bot (Kanal je Zweck, Schalter je Ereignis), Bot und Aktivitätszähler.
// Seit #566 gibt es keine Webhook-Adressen mehr - der Bot schickt alles; ist er aus, wird nichts
// gesendet. Alles steht auf der Discord-Seite unter Verbindungen (24.09.: „muss das doppelt sein?“).

const EMPTY_DISCORD = { enabled: true, configured: false, last_status: "", last_error: "", last_event_key: "", last_checked_at: "" };
const READ_ONLY = ["configured", "channels", "events", "target_status", "bot", "last_status", "last_error", "last_event_key", "last_checked_at", "updated_at"];

/** Nur, was sich einstellen lässt - der Rest der Antwort ist Stand, kein Feld. */
export function discordPayload(source) {
  const payload = { ...(source || {}) };
  for (const key of READ_ONLY) delete payload[key];
  return payload;
}

export function DiscordSettings() {
  const { user } = useAuth();
  const [discord, setDiscord] = useState(EMPTY_DISCORD);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [counters, setCounters] = useState([]);
  const [counterQuery, setCounterQuery] = useState("");
  const [counterValues, setCounterValues] = useState({});
  const [savingCounter, setSavingCounter] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/settings/discord");
      setLoadError(false);
      if (data) setDiscord((prev) => ({ ...prev, ...data }));
    } catch {
      setLoadError(true);
    }
  }, []);
  const loadCounters = useCallback((query) => {
    api.get(`/admin/discord/counters?q=${encodeURIComponent(query)}&limit=50`)
      .then(({ data }) => setCounters(Array.isArray(data) ? data : []))
      .catch(() => setCounters([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ["settings"], { fallbackMs: 0 });
  useEffect(() => {
    const id = window.setTimeout(() => loadCounters(counterQuery), 250);
    return () => window.clearTimeout(id);
  }, [counterQuery, loadCounters]);

  const toggleEnabled = async (enabled) => {
    if (saving) return;
    setSaving(true);
    try {
      await api.put("/settings/discord", { enabled });
      setDiscord((prev) => ({ ...prev, enabled }));
      toast.success(enabled ? "Discord-Meldungen an." : "Discord-Meldungen aus – es wird nichts mehr gesendet.");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };
  const changeCounter = async (entry, delta) => {
    if (!entry?.id || savingCounter) return;
    setSavingCounter(`${entry.id}:delta`);
    try {
      await api.post(`/admin/discord/counter/${entry.id}`, { delta });
      toast.success(delta > 0 ? `+${delta} Discord-Aktivität gezählt.` : `${delta} Discord-Aktivität abgezogen.`);
      loadCounters(counterQuery);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSavingCounter(""); }
  };
  const setCounter = async (entry) => {
    const raw = counterValues[entry.id];
    if (raw === undefined || raw === "") return toast.error("Zählerwert eingeben.");
    const total = Number(raw);
    if (!Number.isFinite(total) || total < 0) return toast.error("Zähler muss 0 oder höher sein.");
    setSavingCounter(`${entry.id}:set`);
    try {
      await api.put(`/admin/discord/counter/${entry.id}`, { total: Math.round(total) });
      toast.success("Discord-Zähler gespeichert.");
      setCounterValues((prev) => ({ ...prev, [entry.id]: "" }));
      loadCounters(counterQuery);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSavingCounter(""); }
  };

  const notConfigured = !discord.configured;

  return (
    <div className="space-y-4" data-testid="discord-settings">
      {loadError && (
        <div className="border border-[#FF3B30]/30 bg-[#FF3B30]/10 rounded-sm p-3 text-xs text-white/70" data-testid="discord-load-error">
          Die Discord-Einstellungen konnten nicht geladen werden. Die Felder zeigen deshalb nicht den gespeicherten Stand.
        </div>
      )}
      {notConfigured && (
        <div className="flex items-start gap-3 border border-[#5865F2]/30 bg-[#5865F2]/10 rounded-sm p-4" data-testid="discord-not-configured">
          <MessageSquare className="w-5 h-5 text-[#5865F2] shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-bold text-[#5865F2] uppercase tracking-wider text-xs">Noch kein Kanal gewählt</div>
            <p className="text-white/70 mt-1">Der Bot schickt News, Events, Turnier-Meldungen und Alarme in Kanäle deines Servers. Unten den Bot einrichten und verbinden, dann je Zweck einen Kanal wählen – der Bot braucht dort „Nachrichten senden“ und „Links einbetten“.</p>
          </div>
        </div>
      )}
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-heading font-bold uppercase">Discord-Meldungen</div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!discord.enabled} disabled={saving} onChange={(e) => toggleEnabled(e.target.checked)} className="accent-[#29B6E8]" data-testid="discord-enabled" />
            <span>Versand aktiv</span>
          </label>
        </div>
        <p className="text-xs text-white/50">Alles geht über den Bot – ist er aus oder nicht verbunden, wird nichts gesendet; einen anderen Weg gibt es nicht. Der Versand-Log steht unter System → Betrieb &amp; Logs.</p>
        {discord.last_status && (
          <div className={`border rounded-sm p-3 text-xs ${discord.last_status === "sent" ? "border-[#00FF88]/25 bg-[#00FF88]/5 text-white/60" : "border-[#FF3B30]/25 bg-[#FF3B30]/5 text-white/60"}`} data-testid="discord-last-status">
            <div className="font-bold uppercase tracking-widest mb-1">Letzte Meldung: {discord.last_status}</div>
            <div>{discord.last_checked_at ? new Date(discord.last_checked_at).toLocaleString("de-DE") : ""}{discord.last_event_key ? ` - ${discord.last_event_key}` : ""}</div>
            {discord.last_error && <div className="mt-1 text-[#FF3B30] break-words">{discord.last_error}</div>}
          </div>
        )}
      </div>
      <DiscordTargets />
      <DiscordSamplesPanel />
      <DiscordBotPanel canSystem={user?.role === "superadmin"} />
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <div className="font-heading font-bold uppercase">Discord-Aktivität</div>
            <p className="mt-1 text-xs text-white/45">Der Bot zählt Nachrichten verknüpfter Konten von selbst (nur die Zahl, für die Erfolge „Discord-Aktiv“). Hier korrigierst du einen Zähler von Hand – etwa für Zeiten, in denen der Bot aus war.</p>
          </div>
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35" />
            <input value={counterQuery} onChange={(e) => setCounterQuery(e.target.value)} data-testid="discord-counter-search" placeholder="User, Name, Discord oder E-Mail" className="w-full bg-[#0A0A0A] border border-white/10 pl-9 pr-3 py-2 rounded-sm text-sm" />
          </div>
        </div>
        <div className="border border-white/5 rounded-sm divide-y divide-white/5 overflow-hidden">
          {counters.map((entry) => {
            const total = entry.discord_messages_count || 0;
            return (
              <div key={entry.id} className="grid lg:grid-cols-[minmax(0,1fr)_auto] gap-3 p-3 items-center">
                <div className="flex items-center gap-3 min-w-0">
                  {entry.avatar_url ? (
                    <img src={resolveMediaUrl(entry.avatar_url)} alt="" className="w-10 h-10 rounded-sm object-cover border border-white/10" />
                  ) : (
                    <div className="w-10 h-10 rounded-sm bg-[#0A0A0A] border border-white/10 flex items-center justify-center text-xs font-black text-white/40">
                      {(entry.display_name || entry.username || "?").slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="font-bold truncate">{entry.display_name || entry.username}</div>
                    <div className="text-xs text-white/40 truncate">@{entry.username}{entry.discord_name ? ` · ${entry.discord_name}` : ""}</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 justify-start lg:justify-end">
                  <div className="px-3 py-2 border border-[#5865F2]/30 bg-[#5865F2]/10 text-[#b8c0ff] text-xs font-bold uppercase tracking-widest rounded-sm">
                    {total.toLocaleString("de-DE")} Nachrichten
                  </div>
                  <button type="button" onClick={() => changeCounter(entry, 1)} disabled={!!savingCounter} className="px-3 py-2 border border-white/10 hover:border-[#5865F2]/60 text-xs font-bold uppercase tracking-wider rounded-sm">+1</button>
                  <button type="button" onClick={() => changeCounter(entry, 10)} disabled={!!savingCounter} className="px-3 py-2 border border-white/10 hover:border-[#5865F2]/60 text-xs font-bold uppercase tracking-wider rounded-sm">+10</button>
                  <input type="number" min="0" value={counterValues[entry.id] ?? ""} onChange={(e) => setCounterValues((prev) => ({ ...prev, [entry.id]: e.target.value }))} data-testid={`discord-counter-total-${entry.id}`} placeholder="Wert" className="w-24 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-xs" />
                  <button type="button" onClick={() => setCounter(entry)} disabled={!!savingCounter} data-testid={`discord-counter-save-${entry.id}`} className="px-3 py-2 bg-[#5865F2] text-white text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">Setzen</button>
                </div>
              </div>
            );
          })}
          {!counters.length && (
            <div className="px-4 py-10 text-center text-sm text-white/40">
              Keine Discord-Zähler gefunden. Suche nach einem Benutzer, um den ersten Wert zu setzen.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

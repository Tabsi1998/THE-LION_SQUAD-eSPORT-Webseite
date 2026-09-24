import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError, resolveMediaUrl } from "@/lib/api";
import { buildDirtyPayload, hasPayloadChanges } from "@/lib/dirtyPayload";
import { ImageUpload, useImageUploadBusy } from "@/components/tls/ImageUpload";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useAuth } from "@/context/AuthContext";
import { DiscordBotPanel } from "./DiscordBotPanel";
import { DiscordTargets } from "./DiscordTargets";

// Discord: Community-Webhook, Betriebs-Webhook, Ziele je Ereignis, Bot und Aktivitätszähler. Bis
// 24.09. ein Reiter der Einstellungen - der Betreiber fragte „muss das doppelt sein?“; seitdem steht
// alles nur noch auf der Discord-Seite unter Verbindungen. Geheimnisse gehen nur mit, wenn neu
// eingetippt; die „gespeichert“-Marke nie.

const EMPTY_DISCORD = {
  webhook_url: "", ops_webhook_url: "", username: "", avatar_url: "", enabled: true, configured: false,
  ops_configured: false, webhook_url_masked: "", ops_webhook_url_masked: "", last_status: "", last_error: "",
  last_event_key: "", last_checked_at: "",
};

export function discordPayload(source) {
  const payload = { ...(source || {}) };
  if (!payload.webhook_url) delete payload.webhook_url;
  if (!payload.ops_webhook_url) delete payload.ops_webhook_url;
  delete payload.configured;
  delete payload.webhook_url_masked;
  delete payload.ops_configured;
  delete payload.ops_webhook_url_masked;
  delete payload.last_status;
  delete payload.last_error;
  delete payload.last_event_key;
  delete payload.last_checked_at;
  return payload;
}

export function DiscordSettings() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const imageUploadBusy = useImageUploadBusy();
  const [discord, setDiscord] = useState(EMPTY_DISCORD);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [counters, setCounters] = useState([]);
  const [counterQuery, setCounterQuery] = useState("");
  const [counterValues, setCounterValues] = useState({});
  const [savingCounter, setSavingCounter] = useState("");
  const dirtyRef = useRef(false);
  const originalRef = useRef({});

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/settings/discord");
      setLoadError(false);
      if (data && !dirtyRef.current) {
        setDiscord((prev) => {
          const next = { ...prev, ...data, webhook_url: "", ops_webhook_url: "" };
          originalRef.current = discordPayload(next);
          return next;
        });
      }
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

  const setField = (key, value) => {
    dirtyRef.current = true;
    setDiscord((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    if (saving) return;
    if (imageUploadBusy) return toast.error("Bild-Upload läuft noch. Bitte kurz warten und dann speichern.");
    const payload = buildDirtyPayload(discordPayload(discord), originalRef.current);
    if (!hasPayloadChanges(payload)) return toast.info("Keine Änderungen zum Speichern.");
    setSaving(true);
    try { await api.put("/settings/discord", payload); dirtyRef.current = false; toast.success("Discord gespeichert."); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };
  const sendTest = async () => {
    try {
      const { data } = await api.post("/settings/discord/test");
      if (data.ok) toast.success(`Discord-Test gesendet${data.status_code ? ` (${data.status_code})` : ""}.`);
      else toast.error(`Fehler: ${data.error || data.reason || "unbekannt"}`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const sendOpsTest = async () => {
    try {
      const { data } = await api.post("/settings/discord/test?target=ops");
      if (data.ok) toast.success("Testalarm an den Betriebs-Webhook gesendet.");
      else toast.error(data.reason === "ops_webhook_missing" ? "Kein Betriebs-Webhook hinterlegt." : `Fehler: ${data.error || data.reason}`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const clearOpsWebhook = async () => {
    if (!await confirm({
      title: "Betriebs-Webhook entfernen?",
      description: "Rote Auto-Checks und neue Serverfehler werden danach nicht mehr gemeldet.",
      confirmLabel: "Entfernen",
    })) return;
    try {
      await api.put("/settings/discord", { clear_ops_webhook: true });
      toast.success("Betriebs-Webhook entfernt.");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const clearWebhook = async () => {
    if (!await confirm({
      title: "Discord Webhook entfernen?",
      description: "Automatische Discord-Meldungen werden danach nicht mehr versendet.",
      confirmLabel: "Entfernen",
    })) return;
    try {
      await api.put("/settings/discord", { clear_webhook: true });
      toast.success("Discord Webhook entfernt.");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
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

  const notConfigured = !discord.configured && !discord.webhook_url_masked;

  return (
    <div className="space-y-4" data-testid="discord-settings">
      {loadError && (
        <div className="border border-[#FF3B30]/30 bg-[#FF3B30]/10 rounded-sm p-3 text-xs text-white/70" data-testid="discord-load-error">
          Die Discord-Einstellungen konnten nicht geladen werden. Die Felder zeigen deshalb nicht den gespeicherten Stand.
        </div>
      )}
      {notConfigured && (
        <div className="flex items-start gap-3 border border-[#5865F2]/30 bg-[#5865F2]/10 rounded-sm p-4">
          <MessageSquare className="w-5 h-5 text-[#5865F2] shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-bold text-[#5865F2] uppercase tracking-wider text-xs">Kein Webhook konfiguriert</div>
            <p className="text-white/70 mt-1">Erstelle in deinem Discord-Server einen Webhook (Server-Einstellungen → Integrationen → Webhooks → Neuer Webhook), kopiere die URL und füge sie unten ein. Damit werden Turniere, Spiele und F1-Ergebnisse automatisch im Kanal gepostet.</p>
          </div>
        </div>
      )}
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-heading font-bold uppercase">Discord Webhook</div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={discord.enabled} onChange={(e) => setField("enabled", e.target.checked)} className="accent-[#29B6E8]" data-testid="discord-enabled" />
            <span>Versand aktiv</span>
          </label>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Webhook URL {discord.webhook_url_masked && <span className="text-white/40 normal-case">(aktuell: {discord.webhook_url_masked})</span>}</div>
          <input type="password" placeholder="https://discord.com/api/webhooks/…" value={discord.webhook_url} onChange={(e) => setField("webhook_url", e.target.value)} data-testid="discord-webhook" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
          <p className="text-xs text-white/40 mt-1">Leer lassen um den bestehenden Webhook beizubehalten. Erlaubt sind https://discord.com/api/webhooks/... URLs.</p>
        </div>
        {discord.last_status && (
          <div className={`border rounded-sm p-3 text-xs ${discord.last_status === "sent" ? "border-[#00FF88]/25 bg-[#00FF88]/5 text-white/60" : "border-[#FF3B30]/25 bg-[#FF3B30]/5 text-white/60"}`}>
            <div className="font-bold uppercase tracking-widest mb-1">Letzter Discord Status: {discord.last_status}</div>
            <div>{discord.last_checked_at ? new Date(discord.last_checked_at).toLocaleString("de-DE") : ""}{discord.last_event_key ? ` - ${discord.last_event_key}` : ""}</div>
            {discord.last_error && <div className="mt-1 text-[#FF3B30] break-words">{discord.last_error}</div>}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Bot-Name</div>
            <input value={discord.username || ""} onChange={(e) => setField("username", e.target.value)} data-testid="discord-username" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="THE LION SQUAD" />
          </div>
          <ImageUpload value={discord.avatar_url || ""} onChange={(v) => setField("avatar_url", v)} label="Avatar" testId="discord-avatar" variant="square" allowLibrary />
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <button onClick={save} disabled={imageUploadBusy || saving} data-testid="discord-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">{saving ? "Speichere..." : "Speichern"}</button>
          <button onClick={sendTest} data-testid="discord-test" className="px-4 py-2 border border-[#5865F2] text-[#5865F2] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"><Send className="w-3.5 h-3.5" /> Test senden</button>
          {discord.configured && <button onClick={clearWebhook} data-testid="discord-clear" className="px-4 py-2 border border-[#FF3B30]/60 text-[#FF3B30] font-bold uppercase tracking-wider rounded-sm">Webhook entfernen</button>}
        </div>
      </div>
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3" data-testid="discord-ops">
        <div className="font-heading font-bold uppercase">Betriebs-Webhook (nur Alarme)</div>
        <p className="text-xs text-white/50">
          Eigener Kanal für den Betrieb: rote Auto-Checks und neue Serverfehler (Admin → Betrieb). Der Community-Webhook oben bekommt davon nichts.
          Leer heißt: keine Alarme.
        </p>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Webhook URL {discord.ops_webhook_url_masked && <span className="text-white/40 normal-case">(aktuell: {discord.ops_webhook_url_masked})</span>}</div>
          <input type="password" placeholder="https://discord.com/api/webhooks/…" value={discord.ops_webhook_url} onChange={(e) => setField("ops_webhook_url", e.target.value)} data-testid="discord-ops-webhook" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
          <p className="text-xs text-white/40 mt-1">Am besten ein privater Kanal nur für den Vorstand. Speichern über „Speichern“ oben.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <button onClick={sendOpsTest} data-testid="discord-ops-test" className="px-4 py-2 border border-[#FF3B30]/60 text-[#FF3B30] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"><Send className="w-3.5 h-3.5" /> Testalarm senden</button>
          {discord.ops_configured && <button onClick={clearOpsWebhook} data-testid="discord-ops-clear" className="px-4 py-2 border border-white/20 text-white/70 font-bold uppercase tracking-wider rounded-sm">Betriebs-Webhook entfernen</button>}
        </div>
      </div>
      <DiscordTargets />
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

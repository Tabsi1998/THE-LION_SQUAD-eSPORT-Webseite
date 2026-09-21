import { useCallback, useEffect, useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";

// Ein Webhook je Zweck und ein Schalter je Ereignis (#300). Öffentliche Ziele
// fallen ohne eigenen Webhook auf „Community“ zurück; der Vorstand ist privat
// und fällt nie zurück - fehlt sein Webhook, wird nichts gesendet.

const TARGET_ORDER = ["news", "events", "achievements", "board"];
const TARGET_HINTS = {
  news: "Veröffentlichte News.",
  events: "Angekündigte Events, Turnier-Meldungen, Fast-Lap-Bestzeiten.",
  achievements: "Freigeschaltete Erfolge – nur von Personen mit öffentlichem Profil, gebündelt je Person.",
  board: "Privat: neue Mitgliedsanträge und Kontaktanfragen – ohne Namen. Ohne eigenen Webhook wird nichts gesendet.",
};

export function deliveryText(target, status) {
  const entry = status?.[target];
  if (!entry) return "";
  if (entry.configured) return "eigener Webhook";
  if (entry.private) return "kein Webhook – es wird nichts gesendet";
  return entry.delivers_to ? "kein eigener Webhook – geht an Community" : "kein Webhook eingerichtet";
}

export function DiscordTargets() {
  const [data, setData] = useState(null);
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

  const saveTarget = (target) => {
    const draft = drafts[target] || {};
    const entry = {};
    if ((draft.webhook_url || "").trim()) entry.webhook_url = draft.webhook_url.trim();
    if (draft.username !== undefined) entry.username = draft.username;
    return run(`save-${target}`, () => api.put("/settings/discord", { targets: { [target]: entry } }).then(() => setDrafts((current) => ({ ...current, [target]: {} }))), "Gespeichert.");
  };
  const clearTarget = (target) => run(`clear-${target}`, () => api.put("/settings/discord", { targets: { [target]: { clear: true } } }), "Webhook entfernt.");
  const testTarget = (target) => run(`test-${target}`, () => api.post(`/settings/discord/test?target=${target}`), ({ data: result }) => (
    result?.ok ? `Test gesendet${result.target && result.target !== target ? " – ging an Community, weil kein eigener Webhook da ist" : ""}.` : `Nicht gesendet: ${result?.error || result?.reason || "unbekannt"}`
  ));
  const toggleEvent = (key, enabled) => run(`event-${key}`, () => api.put("/settings/discord", { events: { [key]: enabled } }));

  if (!data) return null;
  const status = data.target_status || {};
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-5" data-testid="discord-targets">
      <div>
        <div className="font-heading font-bold uppercase">Kanäle je Zweck</div>
        <p className="mt-1 text-xs text-white/50">
          Optional. Ohne eigenen Webhook gehen News, Events und Erfolge in den Community-Kanal oben. Was nur Mitglieder oder der Vorstand sehen dürfen, geht nie in einen öffentlichen Kanal – egal, welcher Schalter an ist.
        </p>
      </div>
      <div className="space-y-4">
        {TARGET_ORDER.map((target) => {
          const entry = status[target] || {};
          const draft = drafts[target] || {};
          const last = entry.last;
          return (
            <div key={target} className={`border rounded-sm p-3 space-y-2 ${entry.private ? "border-[#FFD700]/25" : "border-white/10"}`} data-testid={`discord-target-${target}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-bold text-sm">{entry.label || target}</div>
                <span className={`text-[10px] font-black uppercase tracking-widest ${entry.configured ? "text-[#00FF88]" : entry.private ? "text-[#FFD700]" : "text-white/45"}`}>{deliveryText(target, status)}</span>
              </div>
              <p className="text-xs text-white/45">{TARGET_HINTS[target]}</p>
              <div className="grid sm:grid-cols-[minmax(0,1fr)_12rem] gap-2">
                <input type="password" autoComplete="off" aria-label={`Webhook für ${entry.label || target}`} placeholder={entry.configured ? "gespeichert – leer lassen, um ihn zu behalten" : "https://discord.com/api/webhooks/…"}
                  value={draft.webhook_url || ""} onChange={(e) => setDrafts((current) => ({ ...current, [target]: { ...draft, webhook_url: e.target.value } }))}
                  data-testid={`discord-target-${target}-url`} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
                <input aria-label={`Bot-Name für ${entry.label || target}`} placeholder="Bot-Name (optional)" value={draft.username ?? data.targets?.[target]?.username ?? ""}
                  onChange={(e) => setDrafts((current) => ({ ...current, [target]: { ...draft, username: e.target.value } }))}
                  className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => saveTarget(target)} disabled={!!busy} data-testid={`discord-target-${target}-save`} className="px-3 py-1.5 bg-[#29B6E8] text-black text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-40">Speichern</button>
                <button type="button" onClick={() => testTarget(target)} disabled={!!busy} data-testid={`discord-target-${target}-test`} className="px-3 py-1.5 border border-[#5865F2]/60 text-[#b8c0ff] text-[10px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1 disabled:opacity-40"><Send className="w-3 h-3" /> Test</button>
                {entry.configured && <button type="button" onClick={() => clearTarget(target)} disabled={!!busy} className="px-3 py-1.5 border border-white/20 text-white/60 text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-40">Entfernen</button>}
                {last && (
                  <span className={`text-xs ${last.status === "sent" ? "text-white/45" : "text-[#FF6B6B]"}`}>
                    zuletzt {last.status === "sent" ? "gesendet" : `fehlgeschlagen${last.status_code ? ` (${last.status_code})` : ""}`} · {new Date(last.created_at).toLocaleString("de-DE")}
                  </span>
                )}
              </div>
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

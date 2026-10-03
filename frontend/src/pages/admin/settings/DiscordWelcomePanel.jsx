import { useCallback, useEffect, useRef, useState } from "react";
import { Send, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { DiscordMessagePreview } from "@/components/tls/DiscordMessagePreview";

// Willkommensnachricht (#574): wer neu auf den Discord-Server kommt, bekommt vom Bot eine Direktnachricht -
// einmal je Person, mit „Auf der Website anmelden“ und „Konto verknüpfen“. Standard aus, bis der Text geprüft
// ist. Die Vorschau baut der Server mit derselben Funktion wie den Versand.

const PREVIEW_DELAY_MS = 400;

export function statsText(stats) {
  if (!stats) return "";
  const parts = [`${stats.sent || 0} gesendet`, `${stats.dm_closed || 0} mit geschlossenen Direktnachrichten`];
  if (stats.error) parts.push(`${stats.error} Fehler`);
  const last = stats.last_at ? ` · zuletzt ${new Date(stats.last_at).toLocaleString("de-DE")}` : "";
  return `${parts.join(" · ")}${last}`;
}

export function DiscordWelcomePanel() {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data: result } = await api.get("/settings/discord");
      const welcome = result?.welcome || null;
      setData(welcome);
      if (welcome) {
        setDraft(welcome.text || "");
        setPreview(welcome.preview || null);
      }
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const changeText = (value) => {
    setDraft(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const { data: result } = await api.post("/settings/discord/welcome/preview", { text: value });
        setPreview(result);
      } catch {
        // Die Vorschau ist Komfort - der gespeicherte Stand bleibt sichtbar.
      }
    }, PREVIEW_DELAY_MS);
  };

  const run = async (key, action, message) => {
    if (busy) return;
    setBusy(key);
    try {
      const result = await action();
      if (message) toast.success(typeof message === "function" ? message(result) : message);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy("");
    }
  };
  const save = (patch, message) => run(`save-${Object.keys(patch).join("-")}`, async () => {
    await api.put("/settings/discord", { welcome: patch });
    await load();
  }, message);
  const sendTest = async () => {
    if (busy) return;
    setBusy("test");
    try {
      const { data: result } = await api.post("/settings/discord/welcome/test", { text: draft });
      if (result?.ok) toast.success("Willkommensnachricht als Direktnachricht an dich gesendet.");
      else toast.error(`Nicht gesendet: ${result?.error || result?.reason || "unbekannt"}`);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy("");
    }
  };

  if (!data) return null;
  const max = data.max_length || 1500;
  const changed = draft.trim() !== String(data.text || "").trim();
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4" data-testid="discord-welcome">
      <div>
        <div className="font-heading font-bold uppercase inline-flex items-center gap-2"><UserPlus className="w-4 h-4 text-[#5865F2]" /> Willkommensnachricht</div>
        <p className="mt-1 text-xs text-white/50">
          Wer neu auf den Discord-Server kommt, bekommt vom Bot eine Direktnachricht – einmal je Person, mit den Knöpfen „Auf der Website anmelden“
          und „Konto verknüpfen“. <code>{"{name}"}</code> wird der Name im Discord, <code>{"{verein}"}</code> der Vereinsname. Lässt jemand keine
          Direktnachrichten zu, passiert nichts – das zählt nur unten mit.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!data.enabled} disabled={!!busy} onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? "Willkommensnachricht an." : "Willkommensnachricht aus.")}
          data-testid="discord-welcome-enabled" className="accent-[#5865F2]" />
        <span>Willkommensnachricht senden</span>
        {!data.enabled && <span className="text-[10px] uppercase tracking-widest text-[#FFD700]">aus – erst den Text prüfen</span>}
      </label>
      <div className="space-y-2">
        <textarea value={draft} onChange={(e) => changeText(e.target.value)} rows={7} maxLength={max} aria-label="Text der Willkommensnachricht"
          data-testid="discord-welcome-text" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => save({ text: draft }, "Text gespeichert.")} disabled={!!busy || !changed} data-testid="discord-welcome-save"
            className="px-3 py-1.5 bg-[#29B6E8] text-black text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-40">Text speichern</button>
          {data.custom && (
            <button type="button" onClick={() => save({ text: "" }, "Vorlage wiederhergestellt.")} disabled={!!busy} data-testid="discord-welcome-reset"
              className="px-3 py-1.5 border border-white/20 text-white/60 text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-40">Vorlage</button>
          )}
          <button type="button" onClick={sendTest} disabled={!!busy || !draft.trim()} data-testid="discord-welcome-test"
            className="px-3 py-1.5 border border-[#5865F2]/60 text-[#b8c0ff] text-[10px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1 disabled:opacity-40">
            <Send className="w-3 h-3" /> An mich senden
          </button>
          <span className="text-[10px] text-white/40" data-testid="discord-welcome-count">{draft.length}/{max}</span>
        </div>
      </div>
      {preview?.embed && <DiscordMessagePreview embed={preview.embed} buttons={preview.buttons} testId="discord-welcome-message" />}
      <div className="text-xs text-white/50" data-testid="discord-welcome-stats">{statsText(data.stats)}</div>
    </div>
  );
}

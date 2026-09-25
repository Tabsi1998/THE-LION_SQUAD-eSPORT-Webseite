import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { DiscordMessagePreview, embedColor } from "./DiscordMessagePreview";

// „So sieht die Meldung aus“ (#303): dasselbe Embed, das der Server später an
// Discord schickt, plus die ehrliche Auskunft, ob und wohin es ginge. Dazu der
// Haken „Ohne Discord“ für genau diese News / dieses Event. Die Nachbildung ist
// seit #583 dieselbe wie auf der Vorschau unter Verbindungen → Discord.

export { embedColor };

export const SKIP_REASONS = {
  author_opt_out: "„Ohne Discord“ ist angehakt – es wird nichts gesendet.",
  private_visibility: "Nur für Mitglieder oder den Vorstand sichtbar – so etwas geht nie in einen öffentlichen Discord-Kanal.",
  event_disabled: "Dieses Ereignis ist in Einstellungen → Discord ausgeschaltet.",
  disabled: "Discord-Meldungen sind ausgeschaltet (Verbindungen → Discord → „Versand aktiv“).",
  bot_off: "Der Bot ist aus – ohne Bot wird nichts gesendet (Verbindungen → Discord → „Bot verbinden“).",
  no_channel: "Für dieses Ziel ist kein Kanal gewählt (Verbindungen → Discord → Kanäle je Zweck).",
  too_old: "Schon länger veröffentlicht – Altes wird nicht nachträglich gemeldet.",
};
const TARGET_NAMES = { community: "Community", news: "News", events: "Events und Turniere" };
// Discord-Termin (#570): warum keiner entsteht - Texte vom Server, hier nur der Rückfall.
export function scheduledEventText(entry) {
  if (!entry) return "";
  if (entry.would_create && entry.payload) {
    const start = new Date(entry.payload.start).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
    const end = new Date(entry.payload.end).toLocaleTimeString("de-DE", { timeStyle: "short" });
    return `${entry.existing_id ? "Discord-Termin wird nachgezogen" : "Erscheint als Discord-Termin"}: „${entry.payload.name}“, ${start} – ${end} Uhr, ${entry.payload.location}.`;
  }
  return entry.reason_text || "Kein Discord-Termin.";
}

export function DiscordPreview({ kind, item, skip, onSkipChange }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/settings/discord/preview", { kind, item: { ...item, discord_skip: !!skip } });
      setPreview(data);
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  const embed = preview?.embed;
  return (
    <div className="border border-[#5865F2]/25 bg-[#5865F2]/5 rounded-sm p-3 space-y-3" data-testid="discord-preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold uppercase tracking-widest text-[#b8c0ff] inline-flex items-center gap-2"><MessageSquare className="w-3.5 h-3.5" /> Discord</div>
        <button type="button" onClick={load} disabled={loading} data-testid="discord-preview-load" className="px-3 py-1.5 border border-[#5865F2]/60 text-[#b8c0ff] text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-40">
          {loading ? "Lade …" : "So sieht die Meldung aus"}
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!skip} onChange={(e) => { onSkipChange(e.target.checked); setPreview(null); }} data-testid="discord-skip" className="accent-[#5865F2]" />
        <span>Ohne Discord veröffentlichen</span>
      </label>
      {error && <div className="text-xs text-[#FF6B6B]">{error}</div>}
      {preview && (
        <>
          <div className={`text-xs ${preview.would_send ? "text-[#00FF88]" : "text-[#FFD700]"}`} data-testid="discord-preview-verdict">
            {preview.would_send ? `Geht beim Veröffentlichen an: ${TARGET_NAMES[preview.target] || preview.target}.` : (SKIP_REASONS[preview.reason] || "Wird nicht gesendet.")}
          </div>
          <DiscordMessagePreview embed={embed} testId="discord-preview-message" embedTestId="discord-preview-embed" />
          {preview.scheduled_event && (
            <div className={`text-xs ${preview.scheduled_event.would_create ? "text-[#00FF88]" : "text-white/50"}`} data-testid="discord-preview-scheduled">
              {scheduledEventText(preview.scheduled_event)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

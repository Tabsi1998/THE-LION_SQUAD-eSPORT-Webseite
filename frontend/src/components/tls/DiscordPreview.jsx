import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { api, formatApiError } from "@/lib/api";

// „So sieht die Meldung aus“ (#303): dasselbe Embed, das der Server später an
// Discord schickt, plus die ehrliche Auskunft, ob und wohin es ginge. Dazu der
// Haken „Ohne Discord“ für genau diese News / dieses Event.

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

export function embedColor(color) {
  return `#${Number(color || 0x29b6e8).toString(16).padStart(6, "0")}`;
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
          <div className="bg-[#2B2D31] rounded-sm p-3 text-sm text-[#DBDEE1] border-l-4" style={{ borderLeftColor: embedColor(embed?.color) }} data-testid="discord-preview-embed">
            <div className="font-bold text-[#00A8FC] break-words">{embed?.title}</div>
            {embed?.description && <div className="mt-1 whitespace-pre-line break-words">{embed.description}</div>}
            {embed?.fields?.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {embed.fields.map((field) => (
                  <div key={field.name}><div className="text-xs font-bold">{field.name}</div><div className="text-xs">{field.value}</div></div>
                ))}
              </div>
            )}
            {embed?.image?.url && <img src={embed.image.url} alt="" className="mt-2 rounded-sm max-h-48 w-full object-cover" />}
            {embed?.url && <div className="mt-2 text-[10px] text-white/40 break-all">{embed.url}</div>}
          </div>
        </>
      )}
    </div>
  );
}

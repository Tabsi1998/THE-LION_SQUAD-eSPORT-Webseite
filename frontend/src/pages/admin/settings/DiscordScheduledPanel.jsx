import { useCallback, useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";

// Discord-Termine (#570): öffentliche Events und Turniere erscheinen als Termine im Discord-Server
// (mit „Interessiert“-Knopf und Erinnerung durch Discord). Zwei Schalter: an/aus und „auch interne“.
// Der Stand sagt, wie viele Termine gerade stehen und was der letzte Abgleich getan hat.

export function whenText(value) {
  if (!value) return "noch nie";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("de-DE");
}

export function resultText(result) {
  if (!result) return "";
  if (result.skipped === "disabled") return "aus";
  if (result.skipped === "bot_off") return "Bot aus – kein Abgleich";
  const parts = [];
  if (result.created) parts.push(`${result.created} angelegt`);
  if (result.updated) parts.push(`${result.updated} geändert`);
  if (result.cancelled) parts.push(`${result.cancelled} abgesagt`);
  if (result.errors) parts.push(`${result.errors} Fehler`);
  return parts.length ? parts.join(", ") : `nichts zu tun (${result.checked || 0} geprüft)`;
}

export function DiscordScheduledPanel() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: result } = await api.get("/settings/discord");
      setData(result?.scheduled_events || null);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (patch, message) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.put("/settings/discord", { scheduled_events: patch });
      toast.success(message);
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4" data-testid="discord-scheduled">
      <div>
        <div className="font-heading font-bold uppercase inline-flex items-center gap-2"><CalendarClock className="w-4 h-4 text-[#5865F2]" /> Discord-Termine</div>
        <p className="mt-1 text-xs text-white/50">
          Öffentliche Events und Turniere erscheinen als Termine im Discord-Server – mit „Interessiert“-Knopf, Erinnerung durch Discord und oben in der Serverliste.
          Ein Event = ein Termin; Zeit, Titel, Ort und Absagen zieht der Abgleich alle fünf Minuten nach. „Ohne Discord veröffentlichen“ gilt auch hier. Der Bot braucht das Recht „Events verwalten“.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!data.enabled} disabled={busy} onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? "Discord-Termine an – der nächste Abgleich legt sie an." : "Discord-Termine aus – bestehende bleiben stehen.")} className="accent-[#5865F2]" data-testid="discord-scheduled-enabled" />
          <span>Termine anlegen</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!data.internal} disabled={busy || !data.enabled} onChange={(e) => save({ internal: e.target.checked }, e.target.checked ? "Auch interne Events werden Termine – nur, wenn der Server intern ist." : "Interne Events bleiben draußen.")} className="accent-[#5865F2]" data-testid="discord-scheduled-internal" />
          <span>Auch interne Events <span className="text-white/40">(nur bei internem Server)</span></span>
        </label>
      </div>
      <div className="border border-white/5 rounded-sm divide-y divide-white/5 text-xs" data-testid="discord-scheduled-status">
        <div className="flex flex-wrap justify-between gap-2 px-3 py-2"><span className="text-white/45">Termine im Discord</span><span data-testid="discord-scheduled-active">{data.active || 0}</span></div>
        <div className="flex flex-wrap justify-between gap-2 px-3 py-2"><span className="text-white/45">Letzter Abgleich</span><span data-testid="discord-scheduled-last-run">{whenText(data.last_run_at)}{data.last_result ? ` · ${resultText(data.last_result)}` : ""}</span></div>
      </div>
    </div>
  );
}

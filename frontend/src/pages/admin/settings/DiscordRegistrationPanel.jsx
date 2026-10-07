import { useCallback, useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";

// Anmeldung im Discord (#885): Wer sein Konto verknüpft hat, meldet sich mit `/anmelden` oder dem Knopf „Anmelden“
// unter der Ankündigung an - privat, über denselben Weg wie das Formular. Hier der Schalter für alles; je Event und
// je Turnier gibt es einen eigenen im Formular.

export function DiscordRegistrationPanel() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: result } = await api.get("/settings/discord");
      setData(result?.registration || null);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (enabled) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.put("/settings/discord", { registration: { enabled } });
      toast.success(enabled ? "Anmeldung über Discord an – „Anmelden“ steht wieder unter den Ankündigungen." : "Anmeldung über Discord aus – der Knopf verschwindet, `/anmelden` nennt den Grund.");
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3" data-testid="discord-registration">
      <div>
        <div className="font-heading font-bold uppercase inline-flex items-center gap-2"><UserPlus className="w-4 h-4 text-[#5865F2]" /> Anmeldung im Discord</div>
        <p className="mt-1 text-xs text-white/50">
          Mit verknüpftem Konto melden sich Mitglieder und Gäste über <code>/anmelden</code> oder den Knopf „Anmelden“ unter der Ankündigung an – die Antwort sieht nur, wer geklickt hat.
          Es gelten dieselben Regeln wie auf der Website (Frist, Plätze, Warteliste, Kosten, Event-Pflicht); Begleitpersonen, externe Links und Team-Aufstellungen bleiben auf der Website.
          Mit <code>/abmelden</code> zieht man eine Event-Anmeldung zurück.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!data.enabled} disabled={busy} onChange={(e) => toggle(e.target.checked)} className="accent-[#5865F2]" data-testid="discord-registration-enabled" />
        <span>Anmeldung über Discord erlauben</span>
      </label>
      <div className="text-xs text-white/55" data-testid="discord-registration-counts">
        Bisher über Discord: {data.events || 0} Event-Anmeldungen, {data.tournaments || 0} Turnier-Anmeldungen.
      </div>
    </div>
  );
}

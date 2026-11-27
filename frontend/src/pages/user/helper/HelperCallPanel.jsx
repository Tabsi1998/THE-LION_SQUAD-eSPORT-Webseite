import { useCallback, useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { viennaDateTime } from "@/lib/vienna";

// Helfer-Aufruf (#1197) für den Vorstand: fehlen für ein Event noch Helfer, geht mit einem Knopf eine Meldung an alle
// Mitglieder - mit den offenen Schichten. Höchstens ein Aufruf je Event und Tag; wer das Thema „Helferdienste“ aus-
// schaltet, bekommt nichts. Bestätigt wird wie bisher im Vereinsmodul.

export function HelperCallPanel() {
  const confirm = useConfirm();
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    api.get("/membership/helper-calls").then(({ data }) => setView(data)).catch(() => setView(null));
  }, []);
  useEffect(() => { load(); }, [load]);

  const events = (view?.events || []).filter((event) => event.open_shifts?.length || event.called_today);
  if (!view?.available || !events.length) return null;

  const send = async (event) => {
    const ok = await confirm({
      title: `Helfer-Aufruf für ${event.label} senden?`,
      description: `Alle Mitglieder bekommen: „${event.text}“ – in der Glocke, als Push und über Discord, wenn sie das Thema „Helferdienste“ nicht ausgeschaltet haben. Höchstens ein Aufruf am Tag.`,
      confirmLabel: "Aufruf senden",
      tone: "info",
    });
    if (!ok) return;
    setBusy(event.id);
    try {
      const { data } = await api.post(`/membership/helper-calls/${event.id}`);
      toast.success(`Aufruf gesendet – an ${data.recipients} Mitglieder.`);
      load();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Das hat nicht geklappt.");
      load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-8 border border-brand/35 bg-brand/[0.05] rounded-sm p-4 md:p-5" data-testid="helper-call-panel">
      <div className="flex items-center gap-2 tls-type-label text-brand"><Megaphone className="w-3.5 h-3.5" /> Helfer-Aufruf · Vorstand</div>
      <p className="mt-1 tls-type-small text-white/55">Fehlen noch Helfer, fragst du hier mit einem Knopf alle Mitglieder.</p>
      <div className="mt-3 space-y-3">
        {events.map((event) => (
          <div key={event.id} className="border border-white/10 rounded-sm bg-[#121212] p-3" data-testid={`helper-call-${event.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold">{event.label}</div>
                <div className="tls-type-small text-white/60 mt-0.5" data-testid={`helper-call-text-${event.id}`}>{event.text || (event.open_shifts?.length ? `Noch ${event.open_places} freie Plätze.` : "Alle Schichten sind besetzt.")}</div>
                {event.last_call_at ? (
                  <div className="tls-type-small text-white/45 mt-1">Zuletzt gerufen: {viennaDateTime(event.last_call_at, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{event.last_call_recipients != null ? ` · an ${event.last_call_recipients} Mitglieder` : ""}</div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => send(event)}
                disabled={!event.can_call || busy === event.id}
                data-testid={`helper-call-send-${event.id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand text-black rounded-sm tls-type-label disabled:opacity-40"
              >
                <Megaphone className="w-3.5 h-3.5" /> {event.called_today ? "Heute gesendet" : "Aufruf senden"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default HelperCallPanel;

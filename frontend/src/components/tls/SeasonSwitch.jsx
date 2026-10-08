import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { viennaDateTime } from "@/lib/vienna";

// Adventkalender und Ostereiersuche (#1360): wer sie füllt, schaltet sie oben auf der eigenen Seite ein und aus - mit
// Zeitraum und wo sie erscheinen (Website, App). Redaktion und Vereinsverwaltung dürfen das; alle anderen Jahreszeiten
// (Deko, Wetter …) bleiben unter Auftritt → Jahreszeiten beim System.

const CHANNEL_LABELS = { web: "Website", app: "App" };

function when(value) {
  return value ? viennaDateTime(value, { dateStyle: "long", timeStyle: "short" }) : "";
}

/** Der Zeitraum in einem Satz - für den Kopf der Seite. */
export function switchWindowText(state) {
  if (!state) return "";
  const window = state.next_start ? `${when(state.next_start)} bis ${when(state.next_end)}` : "";
  if (!state.enabled) return window ? `Aus – erscheint nicht. Eingeschaltet zu sehen von ${window}.` : "Aus – erscheint nicht.";
  if (state.active_now) return "Läuft gerade.";
  return window ? `Sichtbar von ${window}.` : "Eingeschaltet.";
}

/** className setzt die Breite im Seitenkopf: am Handy volle Breite, am großen Bildschirm oben rechts. */
export function SeasonSwitch({ seasonKey, label, className = "mb-6" }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/seasonal/switch/${seasonKey}`)
      .then(({ data }) => { setState(data && typeof data === "object" && "enabled" in data ? data : null); setError(""); })
      .catch((failure) => setError(formatRequestError(failure, "Der Schalter lässt sich gerade nicht laden.")));
  }, [seasonKey]);
  useEffect(() => { load(); }, [load]);

  const save = async (patch, message) => {
    // Der Schalter springt sofort um und springt zurück, wenn der Server ablehnt.
    const before = state;
    setState((current) => ({ ...current, ...patch }));
    setBusy(true);
    try {
      const { data } = await api.put(`/seasonal/switch/${seasonKey}`, patch);
      setState(data);
      toast.success(message);
    } catch (failure) {
      setState(before);
      toast.error(formatRequestError(failure, "Das hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className={`${className} rounded-sm border border-white/10 bg-[#121212] p-4 text-sm text-white/55`} data-testid="season-switch-error">{error}</div>;
  if (!state) return null;
  const channels = state.channels || [];
  const toggleChannel = (channel) => {
    const next = channels.includes(channel) ? channels.filter((value) => value !== channel) : [...channels, channel];
    save({ channels: next }, `${label}: ${next.length ? next.map((value) => CHANNEL_LABELS[value] || value).join(" und ") : "nirgends"}.`);
  };
  return (
    <section className={`${className} rounded-sm border p-4 ${state.enabled ? "border-[#00FF88]/35 bg-[#00FF88]/5" : "border-white/10 bg-[#121212]"}`} data-testid="season-switch">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-heading font-bold uppercase" data-testid="season-switch-title">{label} ist {state.enabled ? "an" : "aus"}</div>
          <p className="mt-1 text-sm text-white/65" data-testid="season-switch-window">{switchWindowText(state)}</p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm font-bold shrink-0 cursor-pointer">
          <input type="checkbox" role="switch" aria-checked={Boolean(state.enabled)} checked={Boolean(state.enabled)} disabled={busy}
            onChange={(event) => save({ enabled: event.target.checked }, event.target.checked ? `${label} ist an.` : `${label} ist aus.`)}
            className="h-5 w-5 accent-[#00FF88]" data-testid="season-switch-enabled" />
          {state.enabled ? "An" : "Aus"}
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" data-testid="season-switch-channels">
        <span className="text-xs uppercase tracking-wider text-white/45 font-bold">Erscheint auf</span>
        {(state.supported_channels || ["web", "app"]).map((channel) => (
          <label key={channel} className="inline-flex items-center gap-2">
            <input type="checkbox" checked={channels.includes(channel)} disabled={busy} onChange={() => toggleChannel(channel)} className="accent-[#29B6E8]" data-testid={`season-switch-channel-${channel}`} />
            {CHANNEL_LABELS[channel] || channel}
          </label>
        ))}
      </div>
      {!state.seasons_enabled && <p className="mt-3 text-xs text-[#FF9500]" data-testid="season-switch-global-off">Die Jahreszeiten sind gerade insgesamt aus – einschalten kann das System unter Auftritt → Jahreszeiten.</p>}
      {state.mode && state.mode !== "auto" && (
        <p className="mt-2 text-xs text-white/50" data-testid="season-switch-forced">System hat das gerade {state.mode === "force_on" ? "fest eingeschaltet" : "fest ausgeschaltet"}{state.until ? ` bis ${when(state.until)}` : ""}.</p>
      )}
    </section>
  );
}

export default SeasonSwitch;

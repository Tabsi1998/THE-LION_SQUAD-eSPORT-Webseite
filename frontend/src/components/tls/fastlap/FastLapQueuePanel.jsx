import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowUp, Check, Play, Plus, SkipForward, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { attemptLabel } from "@/lib/fastLapEvent";
import { MOTION, motionAllowed } from "@/lib/motion";
import { INPUT_CLASS } from "@/components/tls/FormFields";
import { FastLapDriverChooser } from "./FastLapDriverChooser";

// „Am Start / Als Nächstes“ (#1585): die Leitung und das Fast-Lap-Team stellen die Reihenfolge am Simulator ein -
// hinzufügen (Konto oder Gast, Station als Auswahl oder Freitext), nach oben, starten, fertig. Das TV zeigt dieselbe
// Liste. Ein Wechsel gleitet ruhig (der Nächste rückt nach oben), nur über transform; „Bewegung reduzieren“ springt.

function Row({ row, max, children }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          {row.is_guest && <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest text-honor border border-honor/40 rounded-sm px-1">Gast</span>}
          <span className="text-sm font-semibold truncate" title={row.display_name}>{row.display_name}</span>
        </div>
        <div className="text-[11px] text-white/45 truncate">{[row.station, attemptLabel(row.attempts_used, max)].filter(Boolean).join(" · ")}</div>
      </div>
      <div className="flex items-center gap-1 shrink-0">{children}</div>
    </div>
  );
}

export function FastLapQueuePanel({ challenge, track, queue, guests, onGuestCreated, onChanged }) {
  const [driver, setDriver] = useState(null);
  const [station, setStation] = useState("");
  const [busy, setBusy] = useState(false);
  const moving = motionAllowed();
  const max = queue?.max_attempts ?? null;
  const onTrack = queue?.on_track || [];
  const waiting = queue?.next || [];
  const layout = moving ? { layout: "position", transition: { layout: { duration: MOTION.slow / 1000, ease: [0.77, 0, 0.175, 1] } } } : {};

  const run = async (call, failure) => {
    setBusy(true);
    try {
      await call();
      onChanged?.();
    } catch (error) {
      toast.error(formatRequestError(error, failure));
    } finally {
      setBusy(false);
    }
  };

  const add = (event) => {
    event.preventDefault();
    if (!driver) { toast.error("Bitte zuerst den Fahrer wählen."); return; }
    run(async () => {
      await api.post(`/f1/challenges/${challenge.id}/queue`, {
        ...(driver.kind === "guest" ? { guest_id: driver.id } : { user_id: driver.id }),
        track_id: track?.id || null,
        station: station.trim() || null,
      });
      setDriver(null);
    }, "Der Fahrer ließ sich nicht in die Liste setzen.");
  };

  const next = (row) => run(() => api.post(`/f1/challenges/${challenge.id}/queue/next`, { done_id: row?.id || null, station: row?.station || station.trim() || null, track_id: row?.track_id || track?.id || null }),
    "Der nächste Fahrer ließ sich nicht holen.");

  return (
    <section className="min-w-0 border border-white/10 bg-[#121212] rounded-sm p-4 sm:p-5" data-testid="fl-queue" aria-label="Am Start und als Nächstes">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="font-heading font-bold uppercase text-lg">Am Start / Als Nächstes</h2>
        {waiting.length > 0 && onTrack.length === 0 && (
          <button type="button" disabled={busy} onClick={() => next(null)} data-testid="fl-queue-first" className="tls-btn tls-btn--secondary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-40">
            <Play className="w-3.5 h-3.5" /> Ersten starten
          </button>
        )}
      </div>

      <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#29B6E8] mb-1.5">Am Start</div>
      <div className="space-y-1.5 mb-4" data-testid="fl-queue-ontrack">
        {onTrack.map((row) => (
          <motion.div key={row.id} {...layout} className="border border-[#29B6E8]/35 bg-[#29B6E8]/[0.07] rounded-sm px-3 py-2" data-testid={`fl-queue-row-${row.id}`}>
            <Row row={row} max={max}>
              <button type="button" disabled={busy} onClick={() => next(row)} title="Fertig - nächster Fahrer an diese Station" aria-label={`${row.display_name} fertig, nächster Fahrer`} data-testid={`fl-queue-next-${row.id}`} className="tls-btn tls-btn--secondary inline-flex items-center gap-1 px-2 py-1 rounded-sm text-[11px] font-bold uppercase disabled:opacity-40">
                <SkipForward className="w-3.5 h-3.5" /> Nächster
              </button>
              <button type="button" disabled={busy} onClick={() => run(() => api.delete(`/f1/queue/${row.id}`), "Ließ sich nicht entfernen.")} title="Fertig" aria-label={`${row.display_name} fertig`} className="p-1.5 text-white/50 hover:text-white disabled:opacity-40"><Check className="w-4 h-4" /></button>
            </Row>
          </motion.div>
        ))}
        {onTrack.length === 0 && <div className="text-xs text-white/40 border border-dashed border-white/10 rounded-sm px-3 py-2">Niemand am Start.</div>}
      </div>

      <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/50 mb-1.5">Als Nächstes</div>
      <ol className="space-y-1.5 mb-4" data-testid="fl-queue-next">
        {waiting.map((row, index) => (
          <motion.li key={row.id} {...layout} className="border border-white/10 bg-black/30 rounded-sm px-3 py-2" data-testid={`fl-queue-row-${row.id}`}>
            <Row row={row} max={max}>
              <span className="sr-only">Platz {index + 1}</span>
              {index > 0 && <button type="button" disabled={busy} onClick={() => run(() => api.post(`/f1/queue/${row.id}/up`), "Ließ sich nicht verschieben.")} aria-label={`${row.display_name} nach oben`} className="p-1.5 text-white/50 hover:text-white disabled:opacity-40"><ArrowUp className="w-4 h-4" /></button>}
              <button type="button" disabled={busy} onClick={() => run(() => api.post(`/f1/queue/${row.id}/start`, { station: station.trim() || null }), "Ließ sich nicht starten.")} aria-label={`${row.display_name} starten`} className="p-1.5 text-white/50 hover:text-[#29B6E8] disabled:opacity-40"><Play className="w-4 h-4" /></button>
              <button type="button" disabled={busy} onClick={() => run(() => api.delete(`/f1/queue/${row.id}`), "Ließ sich nicht entfernen.")} aria-label={`${row.display_name} aus der Liste nehmen`} className="p-1.5 text-white/50 hover:text-live disabled:opacity-40"><X className="w-4 h-4" /></button>
            </Row>
          </motion.li>
        ))}
        {waiting.length === 0 && <li className="text-xs text-white/40 border border-dashed border-white/10 rounded-sm px-3 py-2">Niemand wartet.</li>}
      </ol>

      <form onSubmit={add} className="space-y-2 border-t border-white/5 pt-3">
        <FastLapDriverChooser challengeId={challenge.id} guests={guests} onGuestCreated={onGuestCreated} value={driver} onChange={setDriver} testId="fl-queue-driver" />
        <div className="flex gap-2">
          <input value={station} onChange={(event) => setStation(event.target.value)} maxLength={40} list="fl-stations" placeholder="Station, z. B. Simulator 1" aria-label="Station" data-testid="fl-queue-station" className={`${INPUT_CLASS} min-w-0`} />
          <datalist id="fl-stations">{(queue?.stations || []).map((name) => <option key={name} value={name} />)}</datalist>
          <button disabled={busy || !driver} data-testid="fl-queue-add" className="tls-btn tls-btn--primary shrink-0 inline-flex items-center gap-1.5 px-3 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> In die Liste
          </button>
        </div>
      </form>
    </section>
  );
}

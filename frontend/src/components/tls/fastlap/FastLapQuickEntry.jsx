import { useEffect, useMemo, useRef, useState } from "react";
import { Delete, Flag, RotateCcw, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { formatLapTime, plausibilityText } from "@/lib/laptime";
import {
  INVALID_REASONS, attemptLabel, attemptsUsedBy, canDriveAgain, keypadInput, timePreview,
} from "@/lib/fastLapEvent";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";
import { FastLapDriverChooser, driverFromRow } from "./FastLapDriverChooser";

// Schnelleingabe am Simulator (#1585): großer Ziffernblock, ein Parser (lib/laptime), Rückfrage bei unplausiblen Zeiten,
// „ungültig“ mit einem Tipp samt Grund, „Eintragen & nächster Fahrer“ (übergibt in der Liste „Am Start / Als Nächstes“)
// und „Letzte Zeit korrigieren“. Am Ziffernblock der Tastatur: Enter trägt ein, „+“ trägt ein und holt den nächsten
// Fahrer, „/“ setzt den Doppelpunkt. Die Versuchsgrenze zeigt die Eingabe an - durchgesetzt wird sie vom Server.

const KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ":", "0", ","];

function sameDriver(row, driver) {
  if (!row || !driver) return false;
  return driver.kind === "guest" ? row.guest_id === driver.id : row.user_id === driver.id;
}

export function FastLapQuickEntry({ challenge, track, times, guests, onGuestCreated, queue, onSaved }) {
  const confirm = useConfirm();
  const { submitting, submitOnce } = useSubmissionGuard();
  const [driver, setDriver] = useState(null);
  const [text, setText] = useState("");
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const [last, setLast] = useState(null);
  const [correcting, setCorrecting] = useState(false);
  const inputRef = useRef(null);
  const onTrack = queue?.on_track || [];

  // Kommt genau eine Person neu an den Start dieser Strecke, ist sie gleich gewählt - einmal je Eintrag, damit „Anderen
  // Fahrer wählen“ nicht sofort wieder zurückspringt.
  const autoPicked = useRef("");
  const here = onTrack.filter((row) => row.track_id === track?.id);
  const single = here.length === 1 ? here[0] : null;
  useEffect(() => {
    if (!single || driver || autoPicked.current === single.id) return;
    autoPicked.current = single.id;
    setDriver(driverFromRow(single));
  }, [single, driver]);

  const scope = challenge?.block_club_member_results && driver?.is_club_member ? "club_reference" : "official";
  const max = challenge?.attempt_limit ?? null;
  const used = attemptsUsedBy(times, driver, scope);
  const allowed = canDriveAgain(used, max);
  const preview = timePreview(text);
  const queueRow = onTrack.find((row) => sameDriver(row, driver)) || null;

  const press = (key) => { setText((current) => keypadInput(current, key)); inputRef.current?.focus({ preventScroll: true }); };

  const consent = async (ms) => {
    const question = plausibilityText(ms, track);
    if (!question) return {};
    const ok = await confirm({ title: "Zeit prüfen", description: question, confirmLabel: "Trotzdem speichern", tone: "info" });
    return ok ? { confirm_implausible: true } : null;
  };

  const handOver = async () => {
    try {
      const { data } = await api.post(`/f1/challenges/${challenge.id}/queue/next`, {
        done_id: queueRow?.id || null, station: queueRow?.station || null, track_id: track?.id || null,
      });
      if (data) autoPicked.current = data.id;
      setDriver(data ? driverFromRow(data) : null);
      if (data) toast.success(`Am Start: ${data.display_name}${data.station ? ` · ${data.station}` : ""}`);
    } catch (failure) {
      setDriver(null);
      toast.error(formatRequestError(failure, "Der nächste Fahrer ließ sich nicht holen."));
    }
  };

  const save = async ({ invalidReason = null, next = false } = {}) => {
    if (!driver) { toast.error("Bitte zuerst den Fahrer wählen."); return; }
    const noTime = invalidReason && !text.trim();
    if (!noTime && !preview.ok) { toast.error("Zeit bitte als 1:24,587 oder 84,587 eingeben."); return; }
    if (correcting && last) {
      const ok = preview.ok ? await consent(preview.ms) : null;
      if (!ok) return;
      const attempt = await submitOnce(async () => {
        await api.patch(`/f1/times/${last.id}`, { time_ms: preview.ms, ...ok });
        setLast({ ...last, time_ms: preview.ms });
        setCorrecting(false);
        setText("");
        toast.success("Letzte Zeit korrigiert.");
        onSaved?.();
      });
      if (attempt.started && attempt.error) toast.error(formatRequestError(attempt.error, "Die Zeit ließ sich nicht korrigieren."));
      return;
    }
    if (!allowed) { toast.error(attemptLabel(used, max)); return; }
    const ok = noTime ? {} : await consent(preview.ms);
    if (!ok) return;
    const attempt = await submitOnce(async () => {
      const { data } = await api.post(`/f1/challenges/${challenge.id}/times`, {
        ...(driver.kind === "guest" ? { guest_id: driver.id } : { user_id: driver.id }),
        track_id: track.id,
        time_ms: noTime ? 0 : preview.ms,
        is_invalid: Boolean(invalidReason),
        admin_note: invalidReason,
        score_scope: scope,
        ...ok,
      });
      setLast({ ...data, driverName: driver.name });
      setText("");
      setReasonsOpen(false);
      toast.success(invalidReason ? `${driver.name}: ungültig (${invalidReason})` : `${driver.name}: ${formatLapTime(data.time_ms)}`);
      onSaved?.();
      if (next) await handOver();
    });
    if (attempt.started && attempt.error) toast.error(formatRequestError(attempt.error, "Die Zeit ließ sich nicht eintragen."));
  };

  const onKeyDown = (event) => {
    if (event.key === "/" ) { event.preventDefault(); press(":"); }
    else if (event.key === "+") { event.preventDefault(); save({ next: true }); }
  };

  const status = useMemo(() => {
    if (!driver) return { text: "Fahrer wählen", tone: "text-white/45" };
    if (!allowed) return { text: attemptLabel(used, max), tone: "text-[#FFB4AE]" };
    return { text: attemptLabel(used, max), tone: "text-[#29B6E8]" };
  }, [driver, allowed, used, max]);

  return (
    <section className="min-w-0 border border-[#29B6E8]/25 bg-[#0d1418] rounded-sm p-4 sm:p-5" data-testid="fl-quick" aria-label="Schnelleingabe">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="font-heading font-bold uppercase text-lg leading-tight">Schnelleingabe</h2>
          <div className="text-xs text-white/45 mt-0.5 truncate">{track?.name || "Strecke wählen"}</div>
        </div>
        <div className={`tls-attempt-chip max-w-[55%] text-right ${status.tone}`} data-testid="fl-quick-attempt" key={`${driver?.id || ""}:${used}`}>{status.text}</div>
      </div>

      {onTrack.length > 0 && !driver && (
        <div className="mb-3 flex flex-wrap gap-1.5" data-testid="fl-quick-ontrack">
          {onTrack.filter((row) => row.track_id === track?.id).map((row) => (
            <button key={row.id} type="button" onClick={() => setDriver(driverFromRow(row))} className="tls-btn tls-btn--secondary px-2.5 py-1 rounded-sm text-xs max-w-full truncate">
              {row.display_name}{row.station ? ` · ${row.station}` : ""}
            </button>
          ))}
        </div>
      )}

      <FastLapDriverChooser challengeId={challenge.id} guests={guests} onGuestCreated={onGuestCreated} value={driver} onChange={(next) => { setDriver(next); setCorrecting(false); }} testId="fl-quick-driver" />

      <form onSubmit={(event) => { event.preventDefault(); save(); }} className="mt-4">
        <label className="block">
          <span className="sr-only">Rundenzeit</span>
          <input
            ref={inputRef}
            value={text}
            onChange={(event) => setText(event.target.value.replace(/[^\d:,.]/g, ""))}
            onKeyDown={onKeyDown}
            inputMode="decimal"
            autoComplete="off"
            placeholder="1:24,587"
            data-testid="fl-quick-time"
            aria-describedby="fl-quick-preview"
            className={`w-full bg-black border rounded-sm px-4 py-3 font-display text-4xl sm:text-5xl tabular-nums tracking-wide text-center focus:outline-none ${correcting ? "border-honor/60" : "border-white/15 focus:border-[#29B6E8]"}`}
          />
        </label>
        <div id="fl-quick-preview" className={`mt-1 min-h-[1.25rem] text-center text-xs tabular-nums ${preview.text && !preview.ok ? "text-[#FFB4AE]" : "text-white/55"}`} aria-live="polite">
          {correcting ? `Korrektur für ${last?.driverName || "die letzte Zeit"}${preview.ok ? ` · ${preview.text}` : ""}` : preview.ok ? `= ${preview.text}` : preview.text}
        </div>

        <div className="tls-keypad mt-3" role="group" aria-label="Ziffernblock">
          {KEYS.map((key) => (
            <button key={key} type="button" className="tls-keypad__key font-display" onClick={() => press(key)} data-testid={`fl-key-${key === ":" ? "colon" : key === "," ? "comma" : key}`}>{key}</button>
          ))}
          <button type="button" className="tls-keypad__key tls-keypad__key--wide" onClick={() => press("back")} aria-label="Letzte Ziffer löschen" data-testid="fl-key-back"><Delete className="w-6 h-6 mx-auto" /></button>
          <button type="button" className="tls-keypad__key tls-keypad__key--wide text-sm uppercase tracking-wider" onClick={() => press("clear")} data-testid="fl-key-clear">Leeren</button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button disabled={submitting || !driver} data-testid="fl-quick-save" className="tls-btn tls-btn--primary col-span-2 py-3.5 rounded-sm font-bold uppercase tracking-wider disabled:opacity-40">
            {correcting ? "Korrektur speichern" : "Eintragen"}
          </button>
          {!correcting && (
            <button type="button" disabled={submitting || !driver} onClick={() => save({ next: true })} data-testid="fl-quick-save-next" className="tls-btn tls-btn--secondary col-span-2 py-3 rounded-sm font-bold uppercase tracking-wider inline-flex items-center justify-center gap-2 disabled:opacity-40">
              <SkipForward className="w-4 h-4 shrink-0" /> <span>Eintragen &amp; nächster Fahrer</span>
            </button>
          )}
          {!correcting && (
            <button type="button" disabled={submitting || !driver} onClick={() => setReasonsOpen((open) => !open)} aria-expanded={reasonsOpen} data-testid="fl-quick-invalid" className="tls-btn tls-btn--danger py-2.5 rounded-sm font-bold uppercase tracking-wider text-xs inline-flex items-center justify-center gap-2 disabled:opacity-40">
              <Flag className="w-3.5 h-3.5" /> Ungültig
            </button>
          )}
          {last && (
            <button type="button" disabled={submitting} onClick={() => { setCorrecting((value) => !value); setText(correcting ? "" : formatLapTime(last.time_ms).replace(".", ",")); }} data-testid="fl-quick-correct" className={`tls-btn tls-btn--quiet py-2.5 rounded-sm font-bold uppercase tracking-wider text-xs inline-flex items-center justify-center gap-2 disabled:opacity-40 ${correcting ? "col-span-2" : ""}`}>
              <RotateCcw className="w-3.5 h-3.5" /> {correcting ? "Abbrechen" : "Letzte korrigieren"}
            </button>
          )}
        </div>
        {reasonsOpen && !correcting && (
          <div className="mt-2 grid grid-cols-2 gap-1.5 tls-reveal" data-testid="fl-quick-reasons">
            {INVALID_REASONS.map((reason) => (
              <button key={reason} type="button" disabled={submitting} onClick={() => save({ invalidReason: reason })} className="tls-btn tls-btn--danger py-2 rounded-sm text-xs">
                {reason}
              </button>
            ))}
            <div className="col-span-2 text-[11px] text-white/45">Ohne getippte Zeit zählt die Runde als „ohne Zeit“ - als Versuch zählt sie immer.</div>
          </div>
        )}
        {last && !correcting && (
          <div className="mt-3 text-xs text-white/50 truncate" data-testid="fl-quick-last">
            Zuletzt: <span className="text-white/80">{last.driverName}</span> · {last.is_invalid ? "ungültig" : formatLapTime(last.time_ms)}
          </div>
        )}
        <div className="mt-2 hidden sm:block text-[11px] text-white/35">Tastatur: Enter = eintragen · + = eintragen &amp; nächster Fahrer · / = Doppelpunkt</div>
      </form>
    </section>
  );
}

// Nachmeldefrist verlängern (docs/LIGA.md, B.4 „Nachmeldung nach dem Season-Start“, #2422, Entscheidung Nr. 184): nur mit Grund, er steht
// im Protokoll. Das neue Ende liegt nach der regulären Frist und höchstens am Ende des Fensters - das prüft der Server und sagt es im Klartext.
import { useState } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { TextField } from "@/components/tls/FormFields";
import { fromViennaInput, viennaDateTime } from "@/lib/vienna";

const BUTTON = "inline-flex min-h-[40px] items-center rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50";
const WHEN = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };
const REASON_MIN = 5;

export function SeasonLateExtension({ seasonId, extension, onSaved }) {
  const [open, setOpen] = useState(false);
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async (value) => {
    setBusy(true);
    try {
      await api.post(`/admin/leagues/seasons/${seasonId}/application-extension`, { until: value, reason: reason.trim() });
      toast.success(value ? "Nachmeldung verlängert. Der Grund steht im Protokoll." : "Verlängerung zurückgenommen.");
      setOpen(false);
      setUntil("");
      setReason("");
      await onSaved?.();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const ready = Boolean(until) && reason.trim().length >= REASON_MIN;
  // Die Felder stehen im Formular des Reiters: Enter speichert hier nur die Verlängerung, nie den ganzen Reiter (Review #2422).
  const onKeyDown = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (ready && !busy) send(fromViennaInput(until));
  };

  return (
    <div className="space-y-2 border-l-2 border-[#29B6E8]/40 pl-3" data-testid="season-late-extension" role="presentation" onKeyDown={onKeyDown}>
      {extension?.until ? (
        <p className="text-xs text-white/70" data-testid="season-late-extension-current">
          Verlängert bis {viennaDateTime(extension.until, WHEN)} Uhr. Grund: {extension.reason}
        </p>
      ) : null}
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className={`tls-btn tls-btn--quiet ${BUTTON}`} data-testid="season-late-extension-open">
          {extension?.until ? "Verlängerung ändern" : "Mit Grund verlängern"}
        </button>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <TextField label="Nachmeldung bis" type="datetime-local" value={until} onChange={setUntil} hint="Wiener Zeit, höchstens bis zum Ende des Fensters" testId="season-late-extension-until" />
          <TextField label="Grund" value={reason} onChange={setReason} hint="Steht im Protokoll, mindestens fünf Zeichen" testId="season-late-extension-reason" />
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="button" disabled={busy || !ready} onClick={() => send(fromViennaInput(until))}
              className={`tls-btn tls-btn--primary ${BUTTON}`} data-testid="season-late-extension-save">Verlängern</button>
            {extension?.until ? (
              <button type="button" disabled={busy || reason.trim().length < REASON_MIN} onClick={() => send(null)}
                className={`tls-btn tls-btn--quiet ${BUTTON}`} data-testid="season-late-extension-remove">Verlängerung zurücknehmen</button>
            ) : null}
            <button type="button" disabled={busy} onClick={() => setOpen(false)} className={`tls-btn tls-btn--quiet ${BUTTON}`}>Abbrechen</button>
          </div>
        </div>
      )}
    </div>
  );
}

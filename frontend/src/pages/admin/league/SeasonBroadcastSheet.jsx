// Rundnachricht der Liga-Leitung (E.4, Nr. 153): Empfänger wählen - Captains und Vertreter (Vorgabe) oder alle Spieler - und den Kreis
// (ganze Season, eine Liga N, eine Staffel). Vor dem Senden steht die Zahl der Empfänger (Vorschau des Servers), beim Senden fragt der
// Dialog noch einmal nach. Zustellung über Glocke und Push, Mail auf Wunsch. Gegen Doppelklick: Der Knopf sperrt, solange gesendet wird,
// und der Server schickt je Kennung des Dialogs (``request_id``) genau einmal. Im Protokoll steht die Nachricht mit Absender.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { api, formatApiError } from "@/lib/api";
import { AUDIENCES, BROADCAST_LIMITS, broadcastProblem, broadcastResultText, newRequestId, peopleText, scopeOptions, splitScope } from "@/lib/leagueDesk";

const POLL_MS = 1500;
const POLL_LIMIT_MS = 2 * 60 * 1000;

export function SeasonBroadcastSheet({ seasonId, divisions = [], onClose, onSent }) {
  const confirm = useConfirm();
  const requestId = useRef(newRequestId());
  // Schon beim Nachfragen gesperrt: Ein Doppelklick öffnet keine zweite Rückfrage und schickt nicht zweimal.
  const busy = useRef(false);
  const [audience, setAudience] = useState("captains");
  const [scope, setScope] = useState("season:");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [mail, setMail] = useState(false);
  const [preview, setPreview] = useState({ status: "loading", recipients: null });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  // Nach dem Senden (N3): Der Server antwortet sofort mit „sending“ und verschickt im Hintergrund - der Dialog liest den Stand nach.
  const [progress, setProgress] = useState(null);
  const options = useMemo(() => scopeOptions(divisions), [divisions]);

  const finish = useCallback((data) => {
    (data.state === "failed" ? toast.error : toast.success)(broadcastResultText(data));
    onSent?.(data);
  }, [onSent]);

  useEffect(() => {
    if (!progress || progress.state !== "sending") return undefined;
    let alive = true;
    const started = Date.now();
    const timer = window.setInterval(async () => {
      try {
        const { data } = await api.get(`/admin/leagues/seasons/${seasonId}/broadcast/${requestId.current}`);
        if (!alive) return;
        if (data.state !== "sending") {
          window.clearInterval(timer);
          finish(data);
          return;
        }
        setProgress({ ...data, slow: Date.now() - started > POLL_LIMIT_MS });
      } catch {
        // Ein Aussetzer beim Nachlesen ändert nichts am Versand - der nächste Abruf holt den Stand.
      }
    }, POLL_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, [progress, seasonId, finish]);

  useEffect(() => {
    let alive = true;
    setPreview((current) => ({ ...current, status: "loading" }));
    api.post(`/admin/leagues/seasons/${seasonId}/broadcast/preview`, { audience, ...splitScope(scope) })
      .then(({ data }) => alive && setPreview({ status: "ready", recipients: data.recipients, scope: data.scope_label }))
      .catch((failure) => alive && setPreview({ status: "error", recipients: null, error: formatApiError(failure.response?.data?.detail) }));
    return () => { alive = false; };
  }, [seasonId, audience, scope]);

  const count = preview.recipients;
  const submit = async (event) => {
    event.preventDefault();
    if (sending || busy.current || progress) return;
    const problem = broadcastProblem({ title, text });
    if (problem) {
      setError(problem);
      return;
    }
    if (!count) {
      setError("In diesem Kreis gibt es niemanden, der die Nachricht bekommen kann.");
      return;
    }
    setError("");
    busy.current = true;
    const audienceLabel = AUDIENCES.find((row) => row.key === audience)?.label || "";
    const ok = await confirm({
      title: `An ${peopleText(count)} schicken?`,
      description: `${audienceLabel}, ${options.find((row) => row.value === scope)?.label || "Ganze Season"}. Glocke und Push${mail ? " und Mail" : ""}. Zurückholen lässt sich die Nachricht danach nicht.`,
      confirmLabel: "Jetzt schicken",
      cancelLabel: "Noch einmal ansehen",
      tone: "info",
    });
    if (!ok) {
      busy.current = false;
      return;
    }
    setSending(true);
    try {
      const { data } = await api.post(`/admin/leagues/seasons/${seasonId}/broadcast`, {
        request_id: requestId.current, title: title.trim(), text: text.trim(), audience, mail, ...splitScope(scope),
      });
      if (data.state === "sending") setProgress(data);
      else finish(data);
    } catch (failure) {
      setError(formatApiError(failure.response?.data?.detail) || "Die Nachricht ließ sich nicht verschicken.");
      setSending(false);
      busy.current = false;
    }
  };

  return (
    <AdminSheet title="Rundnachricht" eyebrow="Leitstand" onClose={onClose} onSubmit={submit} saving={sending} noValidate
      submitLabel={count ? `An ${peopleText(count)} schicken` : "Schicken"} savingLabel="Wird verschickt …" submitTestId="broadcast-send"
      submitDisabled={preview.status !== "ready" || !count || Boolean(progress)} testId="broadcast-sheet">
      <fieldset>
        <legend className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/50">Empfänger</legend>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
          {AUDIENCES.map((row) => {
            const selected = audience === row.key;
            return (
              <label key={row.key} data-testid={`broadcast-audience-${row.key}`}
                className={`tls-press tls-press--flat flex min-h-11 cursor-pointer flex-col gap-0.5 rounded-sm border p-3 transition-colors ${selected ? "border-[#29B6E8] bg-[#29B6E8]/10" : "border-white/10 hover:border-white/25"}`}>
                <span className="flex items-center gap-2 text-sm font-bold text-white">
                  <input type="radio" name="broadcast-audience" value={row.key} checked={selected} onChange={() => setAudience(row.key)} className="accent-[#29B6E8]" />
                  {row.label}
                </span>
                <span className="text-xs text-white/55">{row.hint}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <SelectField label="Kreis" value={scope} onChange={setScope} options={options.map((row) => [row.value, row.label])} testId="broadcast-scope" />
      <p className="rounded-sm border border-white/10 bg-[#121212] px-3 py-2 text-sm" aria-live="polite" data-testid="broadcast-preview">
        {preview.status === "loading" ? <span className="text-white/50">Empfänger werden gezählt …</span> : null}
        {preview.status === "error" ? <span className="text-warn">{preview.error || "Die Empfänger ließen sich nicht zählen."}</span> : null}
        {preview.status === "ready" ? (
          count ? <>Geht an <strong className="tabular-nums text-white">{peopleText(count)}</strong> – du selbst bekommst sie nicht.</>
            : <span className="text-warn">In diesem Kreis gibt es noch niemanden, der die Nachricht bekommen kann.</span>
        ) : null}
      </p>
      <TextField label="Betreff" value={title} onChange={setTitle} maxLength={BROADCAST_LIMITS.titleMax} testId="broadcast-title"
        hint={`${title.trim().length} / ${BROADCAST_LIMITS.titleMax} Zeichen · steht in der Glocke nach dem Namen der Season („Liga Season: Betreff“)`} />
      <TextAreaField label="Nachricht" value={text} onChange={(value) => setText(value.slice(0, BROADCAST_LIMITS.textMax))} rows={6} testId="broadcast-text"
        hint={`${text.trim().length} / ${BROADCAST_LIMITS.textMax} Zeichen`} />
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-white/80" data-testid="broadcast-mail">
        <input type="checkbox" checked={mail} onChange={(event) => setMail(event.target.checked)} className="mt-1 accent-[#29B6E8]" />
        <span>Auch per Mail<span className="block text-xs text-white/50">Glocke, Push und Mail folgen bei jeder Person der Einstellung „Turnier-Updates“. Wer sie per Mail abgeschaltet hat, bekommt keine Mail.</span></span>
      </label>
      {progress ? (
        <div className="rounded-sm border border-[#29B6E8]/30 bg-[#29B6E8]/5 p-3 text-sm" role="status" aria-live="polite" data-testid="broadcast-progress">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-bold text-white">Wird verschickt …</span>
            <span className="tabular-nums text-white/70">{progress.processed || 0} von {progress.recipients || 0}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-[#29B6E8] transition-[width] duration-300 ease-out motion-reduce:transition-none"
              style={{ width: `${progress.recipients ? Math.round(((progress.processed || 0) / progress.recipients) * 100) : 0}%` }} />
          </div>
          {progress.slow ? <p className="mt-2 text-xs text-white/60" data-testid="broadcast-progress-slow">Das dauert länger. Der Versand läuft im Hintergrund weiter – du kannst den Dialog schließen, den Endstand zeigt das Protokoll.</p> : null}
        </div>
      ) : null}
      {error ? <p className="text-sm text-warn" role="alert" data-testid="broadcast-error">{error}</p> : null}
    </AdminSheet>
  );
}

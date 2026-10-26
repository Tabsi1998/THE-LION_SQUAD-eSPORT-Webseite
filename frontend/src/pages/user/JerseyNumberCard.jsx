import { useCallback, useEffect, useRef, useState } from "react";
import { Shirt, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { viennaDate } from "@/lib/vienna";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { checkState, jerseyRequestLine, parseJerseyInput } from "@/lib/jerseyNumber";

const CHECK_DELAY_MS = 350;
const day = (iso) => (iso ? viennaDate(iso, { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
const TONE = {
  ok: "text-ok border-ok/40 bg-ok/10",
  bad: "text-warn border-warn/40 bg-warn/10",
  busy: "text-white/60 border-white/15 bg-white/5",
};
const SYNC_WARN = new Set(["failed", "field_missing", "no_member", "read_only", "conflict"]);
const inputClass = "bg-[#0A0A0A] border border-white/10 focus:border-honor rounded-sm text-white focus:outline-none";

// Live-Prüfung beim Tippen (#2034): kurz warten, ältere Antworten verwerfen, nie den Knopf freigeben, bevor der Server
// „frei“ gesagt hat. Ein Bereich vom Server fängt Tippfehler schon vorher ab.
function useNumberCheck(input, range, nonce = 0) {
  const [state, setState] = useState({ result: null, busy: false, failed: false });
  const seq = useRef(0);
  const local = parseJerseyInput(input, range);
  useEffect(() => {
    const mine = ++seq.current;
    if (local.value === null || local.error) {
      setState({ result: null, busy: false, failed: false });
      return undefined;
    }
    setState({ result: null, busy: true, failed: false });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.get("/membership/me/jersey-number/check", { params: { number: String(local.value) }, signal: controller.signal })
        .then(({ data }) => { if (mine === seq.current) setState({ result: data, busy: false, failed: false }); })
        .catch((error) => { if (mine === seq.current && error?.name !== "CanceledError") setState({ result: null, busy: false, failed: true }); });
    }, CHECK_DELAY_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [local.value, local.error, nonce]);
  return { local, ...state, view: checkState({ input, local: local.error, ...state }) };
}

function CheckChip({ view, testId }) {
  if (view.tone === "idle") return <span data-testid={testId} className="sr-only" aria-live="polite" />;
  const Icon = view.tone === "ok" ? Check : view.tone === "busy" ? Loader2 : X;
  return (
    <span
      key={`${view.tone}-${view.text}`}
      data-testid={testId}
      data-tone={view.tone}
      aria-live="polite"
      className={`tls-reveal inline-flex items-center gap-1.5 max-w-full px-2.5 py-1 border rounded-sm text-xs font-bold ${TONE[view.tone] || TONE.busy}`}
    >
      <Icon className={`w-3.5 h-3.5 shrink-0 ${view.tone === "busy" ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
      <span className="min-w-0 break-words">{view.text}</span>
    </span>
  );
}

function ChooseForm({ view, onChosen }) {
  const confirm = useConfirm();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);
  const check = useNumberCheck(input, view.range, nonce);
  const ready = check.view.tone === "ok" && check.result?.free && !busy;
  const noneLeft = view.free_count === 0;

  const submit = async (event) => {
    event.preventDefault();
    if (!ready) return;
    const number = check.local.value;
    const ok = await confirm({
      title: `Die ${number} als deine Nummer festlegen?`,
      description: "Danach änderst du sie nicht mehr selbst – nur noch über einen Antrag an den Vorstand.",
      confirmLabel: "Festlegen",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { data } = await api.post("/membership/me/jersey-number", { number, confirmed: true });
      onChosen(data);
      toast.success(`Die ${data.number} gehört jetzt dir.`);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Das hat nicht geklappt.");
      setNonce((n) => n + 1);   // gleich neu prüfen - meist hat sich jemand die Nummer eben gesichert
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-4" data-testid="jersey-choose-form">
      {view.again && (
        <p className="mb-3 text-sm border border-brand/40 bg-brand/10 text-white/80 rounded-sm p-3" data-testid="jersey-again">
          Der Vorstand hat deine Nummer freigegeben – such dir einmal eine neue aus.
        </p>
      )}
      <p className="text-sm text-white/70">
        Such dir eine Nummer von {view.range.min} bis {view.range.max} aus. Jede gibt es im Verein nur einmal.
        {view.reserved?.length ? ` Nicht wählbar: ${view.reserved.join(", ")}.` : ""}
      </p>
      {noneLeft ? (
        <p className="mt-3 text-sm text-honor" data-testid="jersey-none-left">Gerade ist keine Nummer frei. Melde dich beim Vorstand – er findet eine Lösung.</p>
      ) : (
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="sr-only" htmlFor="jersey-number-input">Deine Nummer</label>
          <input
            id="jersey-number-input"
            value={input}
            onChange={(e) => setInput(e.target.value.replace(/\s+/g, "").slice(0, 4))}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            placeholder={`${view.range.min}–${view.range.max}`}
            aria-describedby="jersey-number-check"
            data-testid="jersey-input"
            className={`${inputClass} w-28 px-3 py-2 text-center font-heading text-3xl font-black tabular-nums`}
          />
          <div id="jersey-number-check" className="min-h-[1.75rem] flex items-center min-w-0">
            <CheckChip view={check.view} testId="jersey-check" />
          </div>
          <button
            type="submit"
            disabled={!ready}
            data-testid="jersey-choose"
            className="tls-btn tls-btn--primary sm:ml-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50"
          >
            {busy ? "Lege fest …" : "Nummer festlegen"}
          </button>
        </div>
      )}
      <p className="mt-3 text-xs text-white/45">Einmal festgelegt, ändert sie nur noch der Vorstand.</p>
    </form>
  );
}

function RequestForm({ view, onSent, onCancel }) {
  const [wished, setWished] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const check = useNumberCheck(wished, view.range);
  const wishBlocked = wished.trim() !== "" && check.view.tone !== "ok";
  const ready = reason.trim().length >= 3 && !wishBlocked && !busy;

  const submit = async (event) => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      await api.post("/membership/me/jersey-number/requests", { wished: wished.trim() === "" ? null : check.local.value, reason: reason.trim() });
      toast.success("Antrag gesendet – der Vorstand meldet sich.");
      onSent();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Das hat nicht geklappt.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="tls-reveal mt-4 space-y-3 border border-white/10 rounded-sm p-4" data-testid="jersey-request-form">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <label className="block text-[11px] font-bold uppercase tracking-widest text-white/60" htmlFor="jersey-wish-input">
          Wunschnummer <span className="normal-case tracking-normal font-normal text-white/40">(optional)</span>
        </label>
        <input
          id="jersey-wish-input"
          value={wished}
          onChange={(e) => setWished(e.target.value.replace(/\s+/g, "").slice(0, 4))}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          aria-describedby="jersey-wish-check"
          data-testid="jersey-wish"
          className={`${inputClass} w-24 px-3 py-1.5 text-center font-heading text-xl font-black tabular-nums`}
        />
        <div id="jersey-wish-check" className="min-w-0"><CheckChip view={check.view} testId="jersey-wish-check" /></div>
      </div>
      <label className="block text-[11px] font-bold uppercase tracking-widest text-white/60">
        Warum eine andere?
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          data-testid="jersey-reason"
          placeholder="Ein Satz reicht."
          className={`${inputClass} mt-1.5 w-full px-3 py-2 text-sm normal-case tracking-normal font-normal`}
        />
      </label>
      <p className="text-xs text-white/45">Ohne Wunsch gibt dir der Vorstand die Wahl frei, und du suchst dir selbst eine neue aus.</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!ready} data-testid="jersey-request-send" className="tls-btn tls-btn--primary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">
          {busy ? "Sende …" : "Antrag senden"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="tls-btn tls-btn--quiet px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">Abbrechen</button>
      </div>
    </form>
  );
}

// Meine Nummer (#2034): einmal selbst wählen, danach nur über einen Antrag an den Vorstand - wie die Vereinsdaten.
// Nicht öffentlich: die Nummer sehen nur das Mitglied und der Vorstand.
export default function JerseyNumberCard() {
  const [view, setView] = useState(null);
  const [asking, setAsking] = useState(false);
  const [fresh, setFresh] = useState(false);
  const load = useCallback(() => {
    api.get("/membership/me/jersey-number")
      .then(({ data }) => setView(data && data.available === true ? data : null))
      .catch(() => setView(null));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!view) return null;

  const chosen = (data) => { setView(data); setFresh(true); };
  const sync = view.dolibarr;
  const requests = view.requests || [];

  return (
    <div className="mt-6 border border-white/10 rounded-sm bg-[#121212] p-5" data-testid="jersey-card">
      <h2 className="font-heading text-lg font-black uppercase inline-flex items-center gap-2"><Shirt className="w-4 h-4 text-honor" /> Meine Nummer</h2>
      <p className="mt-1 text-xs text-white/45">Zum Beispiel fürs Trikot. Sehen können sie nur du und der Vorstand.</p>

      {view.number === null || view.number === undefined ? (
        view.can_choose ? <ChooseForm view={view} onChosen={chosen} /> : null
      ) : (
        <div className="mt-4">
          <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
            <div
              className="tls-glow tls-jersey-number font-heading text-6xl font-black leading-none text-honor tabular-nums"
              data-tone="honor"
              data-glow={fresh ? "on" : undefined}
              data-fresh={fresh ? "1" : undefined}
              data-testid="jersey-number"
            >
              {view.number}
            </div>
            <div className="pb-1 text-xs text-white/55">
              {view.set_by === "board" ? "Vom Vorstand eingetragen" : view.set_by === "dolibarr" ? "Aus der Mitgliederverwaltung" : "Von dir gewählt"}
              {view.chosen_at ? ` am ${day(view.chosen_at)}` : ""}
            </div>
          </div>
          {sync && sync.state !== "ok" && sync.state !== "off" && (
            <p className={`mt-3 text-xs ${SYNC_WARN.has(sync.state) ? "text-warn" : "text-white/50"}`} data-testid="jersey-sync">{sync.text}</p>
          )}
          {view.open_request ? (
            <p className="mt-4 text-sm border-l-2 border-honor/50 pl-3 text-white/75" data-testid="jersey-open-request">
              Dein Antrag liegt beim Vorstand ({jerseyRequestLine(view.open_request)}, eingereicht am {day(view.open_request.received_at)}).
            </p>
          ) : asking ? (
            <RequestForm view={view} onCancel={() => setAsking(false)} onSent={() => { setAsking(false); load(); }} />
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => setAsking(true)} data-testid="jersey-ask" className="tls-btn tls-btn--secondary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
                Andere Nummer beantragen
              </button>
              <span className="text-xs text-white/45">Ändern geht nur über den Vorstand.</span>
            </div>
          )}
        </div>
      )}

      {requests.some((row) => row.status !== "received") && (
        <div className="mt-5 space-y-2" data-testid="jersey-requests">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Frühere Anträge</div>
          {requests.filter((row) => row.status !== "received").slice(0, 3).map((row) => (
            <div key={row.id} className="text-sm border-l-2 border-white/15 pl-3">
              <div className="text-white/75">{jerseyRequestLine(row)}</div>
              <div className="text-xs text-white/45">{row.status_label}{row.decision_reason ? ` – ${row.decision_reason}` : ""}{row.decided_at ? ` · ${day(row.decided_at)}` : ""}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

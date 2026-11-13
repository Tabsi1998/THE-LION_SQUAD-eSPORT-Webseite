import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MonitorPlay, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import {
  NOTICE_DURATION_DEFAULT,
  NOTICE_DURATIONS,
  NOTICE_MAX,
  deliveryText,
  newRequestId,
  noticeClock,
  noticeLength,
  noticeTemplates,
  pauseClockIn,
  pauseUntilIso,
  remainingText,
} from "@/lib/tournamentNotices";
import { viennaTime } from "@/lib/vienna";

// Reiter „Hinweis“ der Turnierleitung (#1166): ein Satz an alle im Turnier oder im ganzen Event - als Benachrichtigung,
// als Banner oben auf der Seite und auf Wunsch am TV. Darunter, was schon hinausging: wer, wann, an wen, wie viele.
// Doppelklick und neuer Versuch tragen dieselbe Kennung - der Server schickt nichts doppelt.

const PAUSE_STATUSES = new Set(["live", "paused"]);

export function NoticeComposer({ slug, tournament, stations = [] }) {
  const confirm = useConfirm();
  const [list, setList] = useState(null);
  const [text, setText] = useState("");
  const [target, setTarget] = useState("tournament");
  const [tv, setTv] = useState(false);
  const [duration, setDuration] = useState(NOTICE_DURATION_DEFAULT);
  const [setPause, setSetPause] = useState(false);
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState("");
  const [now, setNow] = useState(() => Date.now());
  // Eine Kennung je Hinweis: bleibt bei einem Fehler stehen (neuer Versuch = derselbe Hinweis), neu erst nach dem Senden.
  const requestId = useRef(newRequestId());
  const base = `/tournaments/${encodeURIComponent(slug)}/lead/notices`;

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(base);
      setList(data);
    } catch (err) {
      setList((current) => current || { items: [], error: formatApiError(err.response?.data?.detail) || "Die Hinweise konnten nicht geladen werden." });
    }
  }, [base]);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ["tournaments"], { fallbackMs: 15000, tournamentId: tournament?.id, eventId: tournament?.event_id });
  // Solange ein Versand läuft, alle drei Sekunden der Fortschritt; sonst je halbe Minute die Restzeit.
  const sending = (list?.items || []).some((item) => item.state === "sending" && !item.stale);
  useEffect(() => {
    const timer = setInterval(() => (sending ? load() : setNow(Date.now())), sending ? 3000 : 30000);
    return () => clearInterval(timer);
  }, [sending, load]);

  useEffect(() => {
    let alive = true;
    setCount(null);
    api.post(`${base}/preview`, { target }).then(({ data }) => alive && setCount(data?.recipients ?? null)).catch(() => alive && setCount(null));
    return () => { alive = false; };
  }, [base, target]);

  const templates = useMemo(() => noticeTemplates({ now, station: stations[0]?.name || "" }), [now, stations]);
  const length = noticeLength(text);
  const pauseClock = pauseClockIn(text);
  const canPause = Boolean(tournament?.can_pause) && PAUSE_STATUSES.has(tournament?.status) && Boolean(pauseClock);
  const canEvent = Boolean(list?.can_target_event);
  const hasEvent = Boolean(tournament?.event_id || list?.event_id);
  const tooShort = length < 3;

  const pickTemplate = (template) => {
    setText(template.text);
    // „Pause bis …“ kommt oft mit dem Pause-Bildschirm am TV - vorgeschlagen, nicht erzwungen.
    if (template.key === "pause") setTv(true);
  };

  const applyPause = async () => {
    const until = pauseUntilIso(pauseClock);
    if (!until) {
      toast.error("„Pause bis“: Die Uhrzeit im Text ist ungültig.");
      return;
    }
    const id = encodeURIComponent(tournament.id);
    try {
      if (tournament.status === "paused") await api.put(`/tournaments/${id}/pause`, { paused_until: until });
      else await api.post(`/tournaments/${id}/status`, { status: "paused", paused_until: until });
      toast.success(`Turnier pausiert bis ${viennaTime(until, { hour: "2-digit", minute: "2-digit" })} – der TV zeigt den Pause-Bildschirm.`);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "„Pause bis“ konnte nicht gesetzt werden.");
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy || tooShort || length > NOTICE_MAX) return;
    setBusy(true);
    try {
      const { data } = await api.post(base, {
        request_id: requestId.current, text, target, show_on_tv: tv, duration_minutes: duration,
      });
      const people = data.recipients === 1 ? "1 Person" : `${data.recipients} Personen`;
      toast.success(data.replay ? "Dieser Hinweis ist schon unterwegs." : `Hinweis gesendet – geht an ${people}.`);
      if (setPause && canPause && !data.replay) await applyPause();
      requestId.current = newRequestId();
      setText("");
      setSetPause(false);
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Der Hinweis konnte nicht gesendet werden. Bitte noch einmal tippen – er geht nicht doppelt hinaus.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item) => {
    const ok = await confirm({
      title: "Hinweis entfernen?",
      description: `„${item.text}“ verschwindet vom Banner${item.tv ? " und vom TV" : ""}. Die Benachrichtigungen bleiben, wo sie sind.`,
      confirmLabel: "Entfernen",
      cancelLabel: "Zurück",
      tone: "danger",
    });
    if (!ok) return;
    setRemoving(item.id);
    try {
      await api.delete(`${base}/${encodeURIComponent(item.id)}`);
      toast.success("Hinweis entfernt.");
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Entfernen hat nicht geklappt.");
    } finally {
      setRemoving("");
    }
  };

  const items = list?.items || [];
  return (
    <div className="mt-5 space-y-6" data-testid="lead-notice">
      <form onSubmit={submit} className="rounded-sm border border-white/10 bg-[#121212] p-4" data-testid="notice-form">
        <div className="text-[11px] font-bold uppercase tracking-widest text-white/50">Vorlagen</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {templates.map((template) => (
            <button key={template.key} type="button" onClick={() => pickTemplate(template)} className="tls-btn tls-btn--quiet min-h-[40px] max-w-full rounded-sm px-3 py-2 text-xs font-bold [overflow-wrap:anywhere]" data-testid={`notice-template-${template.key}`}>
              {template.label}
            </button>
          ))}
        </div>

        <label htmlFor="notice-text" className="mt-4 block text-[11px] font-bold uppercase tracking-widest text-white/50">Hinweis</label>
        <textarea
          id="notice-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={NOTICE_MAX}
          rows={2}
          placeholder="z. B. Pause bis 14:30"
          className="mt-2 w-full resize-none rounded-sm border border-white/15 bg-black/40 px-3 py-2 text-base text-white placeholder:text-white/30 focus:border-[#29B6E8] focus:outline-none"
          data-testid="notice-text-input"
        />
        <div className={`mt-1 text-right text-[11px] tabular-nums ${length > NOTICE_MAX - 20 ? "text-honor" : "text-white/40"}`} data-testid="notice-count">{length}/{NOTICE_MAX}</div>

        <fieldset className="mt-3">
          <legend className="text-[11px] font-bold uppercase tracking-widest text-white/50">An wen</legend>
          <div className="mt-2 grid grid-cols-2 gap-1 rounded-sm border border-white/10 bg-white/5 p-1" role="group">
            {[["tournament", "Dieses Turnier"], ["event", "Ganzes Event"]].map(([key, label]) => {
              const disabled = key === "event" && (!hasEvent || !canEvent);
              return (
                <button key={key} type="button" disabled={disabled} aria-pressed={target === key} onClick={() => setTarget(key)} className={`min-h-[40px] rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-40 ${target === key ? "bg-[#29B6E8] text-black" : "text-white/60"}`} data-testid={`notice-target-${key}`}>
                  {label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-white/50" data-testid="notice-recipients">
            {count == null ? "Empfänger werden gezählt …" : count === 0 ? "Gerade ist niemand angemeldet – der Hinweis steht nur als Banner." : `Geht an ${count === 1 ? "1 Person" : `${count} Personen`}: alle Angemeldeten, bei Teams alle Mitglieder.`}
            {!hasEvent ? " Dieses Turnier gehört zu keinem Event." : !canEvent && list ? " An das ganze Event schreibt, wer alle Turniere des Events leitet." : ""}
          </p>
        </fieldset>

        <fieldset className="mt-4">
          <legend className="text-[11px] font-bold uppercase tracking-widest text-white/50">Steht für</legend>
          <div className="mt-2 grid grid-cols-5 gap-1 rounded-sm border border-white/10 bg-white/5 p-1" role="group">
            {NOTICE_DURATIONS.map(([minutes, label]) => (
              <button key={minutes} type="button" aria-pressed={duration === minutes} onClick={() => setDuration(minutes)} className={`min-h-[40px] rounded-sm text-[11px] sm:text-xs font-bold tabular-nums ${duration === minutes ? "bg-[#29B6E8] text-black" : "text-white/60"}`} data-testid={`notice-duration-${minutes}`}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="mt-4 flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-white/85">
          <input type="checkbox" checked={tv} onChange={(event) => setTv(event.target.checked)} className="h-5 w-5 accent-[#29B6E8]" data-testid="notice-tv" />
          <MonitorPlay className="h-4 w-4 text-[#29B6E8]" aria-hidden="true" /> Auch am TV zeigen
        </label>
        {canPause ? (
          <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-white/85" data-testid="notice-pause-row">
            <input type="checkbox" checked={setPause} onChange={(event) => setSetPause(event.target.checked)} className="h-5 w-5 accent-honor" data-testid="notice-pause" />
            <span>Turnier gleich pausieren bis {pauseClock} <span className="text-white/45">(Pause-Bildschirm am TV)</span></span>
          </label>
        ) : null}

        <button type="submit" disabled={busy || tooShort} className="tls-btn tls-btn--primary mt-4 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-sm px-4 py-2 text-sm font-bold uppercase tracking-wider sm:w-auto" data-testid="notice-send">
          <Send className="h-4 w-4" aria-hidden="true" /> {busy ? "Wird gesendet …" : "Hinweis senden"}
        </button>
      </form>

      <section aria-labelledby="notice-log-title">
        <div id="notice-log-title" className="text-[11px] font-bold uppercase tracking-widest text-white/40">Gesendet · wer, wann, an wen</div>
        {list?.error ? <p className="mt-2 text-sm text-warn">{list.error}</p> : null}
        {list && !items.length && !list.error ? <div className="mt-2 rounded-sm border border-white/10 bg-[#121212] p-5 text-center text-sm text-white/50" data-testid="notice-log-empty">Noch kein Hinweis gesendet.</div> : null}
        <ul className="mt-2 space-y-2" data-testid="notice-log">
          {items.map((item) => (
            <li key={item.id} className={`rounded-sm border p-3 ${item.active ? "border-honor/40 bg-honor/[0.04]" : "border-white/10 bg-[#121212]"}`} data-testid={`notice-log-${item.id}`}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white [overflow-wrap:anywhere]">{item.text}</p>
                  <div className="mt-1 text-[11px] text-white/50 [overflow-wrap:anywhere]">
                    {noticeClock(item)} · {item.author || "Turnierleitung"} · {item.target_label}{item.tv ? " · am TV" : ""}
                  </div>
                  <div className="mt-0.5 text-[11px] text-white/60" data-testid={`notice-delivery-${item.id}`}>{deliveryText(item)}</div>
                  <div className={`mt-0.5 text-[11px] font-bold ${item.active ? "text-honor" : "text-white/35"}`}>
                    {item.removed_at ? `entfernt${item.removed_by ? ` von ${item.removed_by}` : ""}` : item.active ? `steht · ${remainingText(item.expires_at, now)}` : "abgelaufen"}
                  </div>
                </div>
                {item.active && item.can_remove ? (
                  <button type="button" disabled={removing === item.id} onClick={() => remove(item)} className="tls-btn tls-btn--quiet inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-sm px-3 py-2 text-[11px] font-bold uppercase tracking-wider" data-testid={`notice-remove-${item.id}`}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Entfernen
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-white/40">Die Benachrichtigung kommt nach den Einstellungen jeder Person (Thema „Turnier-Updates“). Banner und TV zeigen nur Text und Zeit, nie, wer geschrieben hat.</p>
      </section>
    </div>
  );
}

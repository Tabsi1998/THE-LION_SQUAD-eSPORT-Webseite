import { useCallback, useEffect, useState } from "react";
import { Ban, Plus, Signpost, Trash2, Vote, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { StatusChip } from "@/components/tls/StatusChip";
import { BallotResult } from "@/components/tls/ballot/BallotParts";
import { normalizeDateTimeFields, toDateTimeLocalInput } from "@/lib/datetime";
import { pollChip, pollDeadlineText, pollRuleText } from "@/lib/eventPolls";

// Abstimmungen am Event (#2612) in der Verwaltung: anlegen, ändern, früher beenden, löschen. Die Verwaltung sieht nur
// Zahlen - wer wie gestimmt hat, zeigt der Server nie. Sind die Antworten die Ort-Pläne (#2613), lässt sich das
// Ergebnis mit einem Klick als Ort übernehmen. Eigene Knöpfe statt Speichern der Maske: alles hier wirkt sofort.

export const OPTION_MAX = 12;
// So lang darf eine Antwort sein - dieselbe Grenze wie am Server (event_polls.LABEL_MAX).
export const LABEL_MAX = 80;

/** Zu lange Texte (etwa „Plan A: “ plus ein langer Ortsname) auf die Grenze kürzen, mit … am Ende. */
export function clip(text, max = LABEL_MAX) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function emptyPollForm() {
  return { question: "", options: [{ code: "", label: "" }, { code: "", label: "" }], multiple: false, max_choices: 2, closes_at: "",
    results_visibility: "live", notify: false };
}

/** Eine Abstimmung über die Ort-Pläne: je Plan eine Antwort, der Code ist der Schlüssel des Plans. */
export function pollFormFromPlans(plans) {
  return { ...emptyPollForm(), question: "Welcher Ort?",
    options: (plans || []).map((plan) => ({ code: plan.key, label: clip([plan.label, plan.name].filter(Boolean).join(": ")) })) };
}

export function pollFormFromPoll(poll) {
  return { question: poll.question || "", options: (poll.options || []).map((option) => ({ ...option })), multiple: Number(poll.max_choices) > 1,
    max_choices: Math.max(2, Number(poll.max_choices) || 2), closes_at: toDateTimeLocalInput(poll.closes_at),
    results_visibility: poll.results_visibility || "live", notify: false };
}

export function pollFormError(form) {
  if ((form.question || "").trim().length < 3) return "Die Frage braucht mindestens 3 Zeichen.";
  const labels = form.options.map((option) => option.label.trim()).filter(Boolean);
  if (labels.length < 2) return "Mindestens zwei Antworten.";
  if (labels.length !== form.options.length) return "Eine Antwort ist leer – ausfüllen oder entfernen.";
  const long = labels.findIndex((label) => label.length > LABEL_MAX);
  if (long >= 0) return `Antwort ${long + 1}: höchstens ${LABEL_MAX} Zeichen.`;
  if (new Set(labels.map((label) => label.toLowerCase())).size !== labels.length) return "Eine Antwort steht doppelt da.";
  if (form.multiple && !(Number(form.max_choices) >= 2 && Number(form.max_choices) <= form.options.length)) return `Mehrere Antworten: 2 bis ${form.options.length}.`;
  return "";
}

export function formToPoll(form, { create = false } = {}) {
  const payload = {
    question: form.question.trim(),
    options: form.options.map((option) => ({ ...(option.code ? { code: option.code } : {}), label: option.label.trim() })),
    max_choices: form.multiple ? Number(form.max_choices) : 1,
    closes_at: form.closes_at || null,
    results_visibility: form.results_visibility,
  };
  normalizeDateTimeFields(payload, ["closes_at"]);
  if (create) payload.notify = Boolean(form.notify);
  return payload;
}

function PollForm({ initial, onCancel, onSubmit, busy, create, canNotify, closed = false }) {
  const [form, setForm] = useState(initial);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const setOption = (index, label) => set({ options: form.options.map((option, i) => (i === index ? { ...option, label } : option)) });
  const error = pollFormError(form);
  const input = "w-full bg-surface-0 border border-white/10 focus:border-event px-3 py-2 rounded-sm tls-type-small";
  const label = "block tls-type-label text-white/45 mb-1";
  const blockEnter = (ev) => { if (ev.key === "Enter") ev.preventDefault(); };
  return (
    <div className="border border-event/30 rounded-sm p-4 space-y-3" data-testid="event-poll-form">
      <label className="block tls-type-small"><span className={label}>Frage</span>
        <input value={form.question} onKeyDown={blockEnter} onChange={(ev) => set({ question: ev.target.value })} maxLength={200} className={input} placeholder="Garage oder Garten?" data-testid="event-poll-question" />
      </label>
      <div className="space-y-2">
        <span className={label}>Antworten</span>
        {form.options.map((option, index) => (
          <div key={option.code || `neu-${index}`} className="flex items-center gap-2">
            <input value={option.label} onKeyDown={blockEnter} onChange={(ev) => setOption(index, ev.target.value)} maxLength={80} className={input}
              placeholder={`Antwort ${index + 1}`} aria-label={`Antwort ${index + 1}`} data-testid={`event-poll-option-${index}`} />
            <button type="button" onClick={() => set({ options: form.options.filter((_, i) => i !== index) })} disabled={form.options.length <= 2}
              className="tls-btn tls-btn--quiet min-h-11 min-w-11 inline-flex items-center justify-center rounded-sm disabled:opacity-30" aria-label={`Antwort ${index + 1} entfernen`}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button type="button" onClick={() => set({ options: [...form.options, { code: "", label: "" }] })} disabled={form.options.length >= OPTION_MAX}
          className="tls-btn tls-btn--quiet inline-flex min-h-11 items-center gap-2 px-3 py-2 rounded-sm tls-type-label disabled:opacity-40" data-testid="event-poll-option-add">
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Antwort
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block tls-type-small"><span className={label}>Frist (optional)</span>
          <input type="datetime-local" value={form.closes_at} onKeyDown={blockEnter} onChange={(ev) => set({ closes_at: ev.target.value })} disabled={closed} className={`${input} disabled:opacity-40`} data-testid="event-poll-closes" />
          <span className="mt-1 block tls-type-small text-quiet" data-testid="event-poll-closes-hint">{closed ? "Die Abstimmung ist beendet – eine neue Frist öffnet sie nicht wieder." : "Genau zur Frist ist die Abstimmung zu. Ohne Frist beendest du sie selbst. Verlängern geht, solange sie läuft."}</span>
        </label>
        <label className="block tls-type-small"><span className={label}>Ergebnis zeigen</span>
          <select value={form.results_visibility} onChange={(ev) => set({ results_visibility: ev.target.value })} disabled={closed} className={`${input} disabled:opacity-40`} data-testid="event-poll-results">
            <option value="live">Sofort (Stand läuft mit)</option>
            <option value="after_close">Erst nach der Frist bzw. dem Ende</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <label className="inline-flex min-h-11 items-center gap-2 tls-type-small">
          <input type="checkbox" checked={form.multiple} disabled={closed} onChange={(ev) => set({ multiple: ev.target.checked })} data-testid="event-poll-multiple" /> Mehrere Antworten erlauben
        </label>
        {form.multiple ? (
          <label className="inline-flex items-center gap-2 tls-type-small">bis zu
            <input type="number" min={2} max={form.options.length} value={form.max_choices} onKeyDown={blockEnter} onChange={(ev) => set({ max_choices: ev.target.value })} disabled={closed}
              className="w-20 bg-surface-0 border border-white/10 px-2 py-2 rounded-sm tls-type-small" data-testid="event-poll-max" />
          </label>
        ) : null}
        {create && canNotify ? (
          <label className="inline-flex min-h-11 items-center gap-2 tls-type-small">
            <input type="checkbox" checked={form.notify} onChange={(ev) => set({ notify: ev.target.checked })} data-testid="event-poll-notify" /> Angemeldete informieren
          </label>
        ) : null}
      </div>
      {error ? <p className="tls-type-small text-warn" data-testid="event-poll-form-error">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onSubmit(form)} disabled={busy || Boolean(error)} className="tls-btn tls-btn--primary inline-flex min-h-11 items-center gap-2 px-4 py-2 rounded-sm tls-type-label disabled:opacity-40" data-testid="event-poll-save">
          <Vote className="w-4 h-4" aria-hidden="true" /> {create ? "Abstimmung anlegen" : "Änderungen speichern"}
        </button>
        <button type="button" onClick={onCancel} className="tls-btn tls-btn--quiet inline-flex min-h-11 items-center px-4 py-2 rounded-sm tls-type-label">Abbrechen</button>
      </div>
    </div>
  );
}

export function EventPollsPanel({ eventId, plans = [], activePlan, onTakeOver, canNotify = true }) {
  const confirm = useConfirm();
  const [polls, setPolls] = useState(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState("");
  const load = useCallback(() => {
    api.get(`/admin/events/${eventId}/polls`)
      .then(({ data }) => { setPolls(Array.isArray(data) ? data : []); setFailed(false); })
      .catch(() => setFailed(true));
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    const create = editing === "new" || editing === "plans";
    setBusy("save");
    try {
      const { data } = create
        ? await api.post(`/admin/events/${eventId}/polls`, formToPoll(form, { create: true }))
        : await api.patch(`/admin/events/${eventId}/polls/${editing}`, formToPoll(form));
      toast.success(create ? (data?.notice?.notified ? `Abstimmung angelegt, ${data.notice.notified} informiert.` : "Abstimmung angelegt.") : "Abstimmung gespeichert.");
      setEditing(null);
      load();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Die Abstimmung wurde nicht gespeichert.");
    } finally {
      setBusy("");
    }
  };
  const close = async (poll) => {
    if (!await confirm({ title: "Abstimmung beenden?", description: `„${poll.question}“ nimmt danach keine Stimmen mehr an. Das Ergebnis ist dann für alle zu sehen.`, confirmLabel: "Beenden", tone: "info" })) return;
    setBusy(poll.id);
    try {
      await api.post(`/admin/events/${eventId}/polls/${poll.id}/close`);
      toast.success("Abstimmung beendet.");
      load();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Das hat nicht geklappt.");
    } finally {
      setBusy("");
    }
  };
  const remove = async (poll) => {
    if (!await confirm({ title: "Abstimmung löschen?", description: `„${poll.question}“ und ${poll.voters_count === 1 ? "die 1 Stimme" : `alle ${poll.voters_count} Stimmen`} sind danach weg. Das lässt sich nicht rückgängig machen.`, confirmLabel: "Löschen", tone: "danger" })) return;
    setBusy(poll.id);
    try {
      await api.delete(`/admin/events/${eventId}/polls/${poll.id}`);
      toast.success("Abstimmung gelöscht.");
      load();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Das hat nicht geklappt.");
    } finally {
      setBusy("");
    }
  };

  const planKeys = new Set((plans || []).map((plan) => plan.key));
  const initial = editing === "plans" ? pollFormFromPlans(plans) : editing === "new" ? emptyPollForm() : polls?.find((poll) => poll.id === editing);
  return (
    <div className="space-y-4" data-testid="event-polls-admin">
      <p className="tls-type-small text-white/60">
        Abstimmen können alle, die angemeldet sind – nicht die Warteliste. Du siehst nur Zahlen, nie wer wie gestimmt hat.
      </p>
      {failed ? <p className="tls-type-small text-warn" data-testid="event-polls-admin-failed">Die Abstimmungen konnten nicht geladen werden.</p> : null}
      {polls?.length === 0 && !editing ? <p className="tls-type-small text-quiet" data-testid="event-polls-admin-empty">Noch keine Abstimmung.</p> : null}
      <ul className="space-y-3">
        {(polls || []).map((poll) => {
          if (editing === poll.id) {
            return <li key={poll.id}><PollForm initial={pollFormFromPoll(poll)} onCancel={() => setEditing(null)} onSubmit={save} busy={busy === "save"} closed={poll.status === "closed"} /></li>;
          }
          const chip = pollChip({ ...poll, rights: [] });
          const winner = poll.result?.winner;
          const takeOver = poll.place_plan_poll && winner && planKeys.has(winner) && winner !== activePlan && onTakeOver;
          return (
            <li key={poll.id} className="border border-white/10 rounded-sm p-4 space-y-3 min-w-0" data-testid={`event-poll-admin-${poll.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="tls-type-card break-words">{poll.question}</div>
                  <div className="tls-type-small text-white/60">{pollDeadlineText(poll)}</div>
                  <div className="tls-type-small text-quiet">{pollRuleText(poll)}</div>
                </div>
                <StatusChip kind={chip.kind} label={chip.label} testId={`event-poll-admin-${poll.id}-status`}
                  meta={`${poll.voters_count} von ${poll.eligible_count} abgestimmt`} metaTestId={`event-poll-admin-${poll.id}-turnout`} />
              </div>
              <BallotResult result={poll.result} bars title={poll.status === "closed" ? "Ergebnis" : "Stand (nur für dich)"} testId={`event-poll-admin-${poll.id}-result`} />
              <div className="flex flex-wrap gap-2">
                {takeOver ? (
                  <button type="button" onClick={() => onTakeOver(winner, poll.result.winner_label)} className="tls-btn tls-btn--primary inline-flex min-h-11 items-center gap-2 px-3 py-2 rounded-sm tls-type-label" data-testid={`event-poll-admin-${poll.id}-take-over`}>
                    <Signpost className="w-3.5 h-3.5" aria-hidden="true" /> Als Ort übernehmen
                  </button>
                ) : null}
                <button type="button" onClick={() => setEditing(poll.id)} className="tls-btn tls-btn--quiet inline-flex min-h-11 items-center px-3 py-2 rounded-sm tls-type-label" data-testid={`event-poll-admin-${poll.id}-edit`}>Bearbeiten</button>
                {poll.status === "open" ? (
                  <button type="button" onClick={() => close(poll)} disabled={busy === poll.id} className="tls-btn tls-btn--quiet inline-flex min-h-11 items-center gap-2 px-3 py-2 rounded-sm tls-type-label" data-testid={`event-poll-admin-${poll.id}-close`}>
                    <Ban className="w-3.5 h-3.5" aria-hidden="true" /> Jetzt beenden
                  </button>
                ) : null}
                <button type="button" onClick={() => remove(poll)} disabled={busy === poll.id} className="tls-btn tls-btn--danger inline-flex min-h-11 items-center gap-2 px-3 py-2 rounded-sm tls-type-label" data-testid={`event-poll-admin-${poll.id}-delete`}>
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Löschen
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {editing === "new" || editing === "plans" ? (
        <PollForm key={editing} initial={initial} onCancel={() => setEditing(null)} onSubmit={save} busy={busy === "save"} create canNotify={canNotify} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setEditing("new")} disabled={!polls} className="tls-btn tls-btn--secondary inline-flex min-h-11 items-center gap-2 px-4 py-2 rounded-sm tls-type-label disabled:opacity-40" data-testid="event-poll-new">
            <Plus className="w-4 h-4" aria-hidden="true" /> Neue Abstimmung
          </button>
          {plans.length >= 2 ? (
            <button type="button" onClick={() => setEditing("plans")} disabled={!polls} className="tls-btn tls-btn--quiet inline-flex min-h-11 items-center gap-2 px-4 py-2 rounded-sm tls-type-label disabled:opacity-40" data-testid="event-poll-new-plans">
              <Signpost className="w-4 h-4" aria-hidden="true" /> Über die Ort-Pläne abstimmen
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useAuth } from "@/context/AuthContext";
import { canUseArea } from "@/lib/permissions";
import { HelperCallPanel } from "@/pages/user/helper/HelperCallPanel";
import { AddToCalendar } from "@/components/tls/AddToCalendar";
import { calendarAskDue, rememberCalendarAsked, shiftCalendarItem } from "@/lib/clubCalendar";
import { Calendar, CheckCircle2, HandHelping, MapPin, Users } from "lucide-react";
import { formatWhen } from "@/lib/datetime";

// Helferdienste (#331): Veranstaltungen mit Schichten aus der Vereinsakte (Vereine 1.4). Plätze, Bestätigung und
// Anmeldestelle kommen vom Verein; die Website zeigt und reicht Anfrage und Rücknahme durch. Selbst eingetragen
// ist noch kein Dienst - erst der Vorstand bestätigt, und erst „geleistet“ zählt.

export function formatDay(day) {
  if (!day) return "";
  return formatWhen(String(day).slice(0, 10), { time: false, fallback: String(day) });
}

export function shiftWhen(shift) {
  const time = shift.start && shift.end ? `${shift.start}–${shift.end} Uhr` : shift.start ? `ab ${shift.start} Uhr` : "";
  return [formatDay(shift.day), time].filter(Boolean).join(" · ");
}

function MineBadge({ shift }) {
  if (!shift.mine) return null;
  const done = shift.mine === "done" || shift.mine === "confirmed";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border tls-type-label ${done ? "border-ok/40 text-ok" : shift.mine === "requested" ? "border-quiet/40 text-quiet" : "border-white/15 text-white/50"}`} data-testid={`shift-${shift.id}-mine`}>
      {done ? <CheckCircle2 className="w-3 h-3" /> : null} {shift.mine_label}
    </span>
  );
}

function EventCard({ event, busy, onRequest, onWithdraw, highlight = false, askFor = "", onAskDone }) {
  // Helfer-Aufruf (#1197): die Meldung führt mit ?event=… hierher - diese Veranstaltung steht oben und leuchtet.
  return (
    <div className={`border rounded-sm bg-[#121212] p-5 ${event.upcoming ? "border-honor/40" : "border-white/10"} ${highlight ? "ring-2 ring-honor/70" : ""}`} data-testid={`helper-event-${event.id}`} data-highlight={highlight ? "true" : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="tls-type-label text-honor">{event.visibility_label} · {event.status_label}</div>
          <h2 className="tls-type-section mt-1">{event.label}</h2>
          <div className="mt-1 tls-type-small text-white/70 inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1"><Calendar className="w-3.5 h-3.5 text-honor" /> {formatDay(event.day)}{event.end_day && event.end_day !== event.day ? ` – ${formatDay(event.end_day)}` : ""}</span>
            {event.place ? <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {event.place}</span> : null}
            <span className="text-white/45" data-testid={`helper-event-${event.id}-registration`}>{event.registration?.text}</span>
          </div>
        </div>
        {event.open_places ? <span className="tls-type-small text-white/55" data-testid={`helper-event-${event.id}-open`}>{event.open_places} {event.open_places === 1 ? "freier Platz" : "freie Plätze"}</span> : null}
      </div>

      <div className="mt-4 space-y-2">
        {event.shifts.map((shift) => (
          <div key={shift.id} className="flex flex-wrap items-center gap-3 border border-white/10 rounded-sm px-3 py-2.5" data-testid={`shift-${shift.id}`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-white">{shift.label}</span>
                <MineBadge shift={shift} />
              </div>
              <div className="tls-type-small text-white/55 mt-0.5 inline-flex items-center gap-2">
                <span>{shiftWhen(shift)}</span>
                <span className="inline-flex items-center gap-1" data-testid={`shift-${shift.id}-places`}><Users className="w-3 h-3" /> {shift.taken}/{shift.capacity}{shift.full ? " · voll" : ""}</span>
              </div>
            </div>
            {shift.can_request ? (
              <button type="button" onClick={() => onRequest(event, shift)} disabled={busy === `shift-${shift.id}`} data-testid={`shift-${shift.id}-request`} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-honor text-black rounded-sm tls-type-label disabled:opacity-50">
                <HandHelping className="w-3.5 h-3.5" /> Ich helfe
              </button>
            ) : null}
            {shift.can_withdraw ? (
              <button type="button" onClick={() => onWithdraw(event, shift)} disabled={busy === `shift-${shift.id}`} data-testid={`shift-${shift.id}-withdraw`} className="px-3 py-1.5 border border-white/15 rounded-sm tls-type-label text-white/70 hover:text-white disabled:opacity-50">
                Anfrage zurückziehen
              </button>
            ) : null}
            {shift.mine === "confirmed" ? <span className="tls-type-small text-white/45">Absagen bitte beim Vorstand.</span> : null}
            <ShiftCalendar event={event} shift={shift} ask={askFor === `shift-${event.id}-${shift.id}`} onAskDone={onAskDone} />
          </div>
        ))}
        {!event.shifts.length ? <p className="tls-type-small text-white/45">Für diese Veranstaltung sind keine Helferdienste ausgeschrieben.</p> : null}
      </div>
    </div>
  );
}

// Die eigene Schicht in den Kalender (#1272): ein Knopf an jeder kommenden eigenen Schicht; nach dem „Ich helfe“
// fragt die Seite einmal „Im Kalender eintragen?“. Die Datei kommt vom Server und nennt niemanden sonst.
function ShiftCalendar({ event, shift, ask, onAskDone }) {
  const mine = ["requested", "confirmed"].includes(shift.mine);
  const item = mine && event.upcoming ? shiftCalendarItem(event, shift) : null;
  if (!item) return null;
  const testId = `shift-${shift.id}-calendar`;
  if (!ask) return <AddToCalendar item={item} testId={testId} />;
  return (
    <div className="basis-full border border-[#29B6E8]/40 bg-[#29B6E8]/5 rounded-sm p-3 flex flex-wrap items-center gap-3" data-testid={`shift-${shift.id}-calendar-ask`}>
      <span className="tls-type-small text-white/85 font-bold">Im Kalender eintragen?</span>
      <AddToCalendar item={item} testId={testId} />
      <button type="button" onClick={onAskDone} className="tls-type-small text-white/55 hover:text-white underline-offset-4 hover:underline" data-testid={`shift-${shift.id}-calendar-ask-no`}>Nein danke</button>
    </div>
  );
}

export default function MemberHelperShiftsPage() {
  const confirm = useConfirm();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const wanted = Number(searchParams.get("event") || 0);
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState("");
  const [askFor, setAskFor] = useState("");
  const load = useCallback(() => {
    api.get("/membership/me/helper-shifts")
      .then(({ data }) => setView(data && typeof data === "object" ? data : { available: false, reason: "error", text: "Konnte nicht geladen werden.", events: [] }))
      .catch(() => setView({ available: false, reason: "error", text: "Konnte nicht geladen werden.", events: [] }));
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["membership", "dolibarr"]);

  const request = async (event, shift) => {
    const ok = await confirm({
      title: `Beim Dienst „${shift.label}“ helfen?`,
      description: `${event.label} · ${shiftWhen(shift)}. Der Vorstand bestätigt die Anfrage; bis dahin kannst du sie zurückziehen.`,
      confirmLabel: "Ich helfe",
    });
    if (!ok) return;
    setBusy(`shift-${shift.id}`);
    try {
      await api.put(`/membership/me/events/${event.id}/shifts/${shift.id}`);
      toast.success("Angefragt – der Vorstand bestätigt.");
      const key = `shift-${event.id}-${shift.id}`;
      if (calendarAskDue(key)) {
        rememberCalendarAsked(key);
        setAskFor(key);
      }
      load();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Das hat nicht geklappt.");
      load();
    } finally {
      setBusy("");
    }
  };
  const withdraw = async (event, shift) => {
    setBusy(`shift-${shift.id}`);
    try {
      await api.delete(`/membership/me/events/${event.id}/shifts/${shift.id}`);
      toast.success("Anfrage zurückgezogen.");
      load();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Das hat nicht geklappt.");
      load();
    } finally {
      setBusy("");
    }
  };

  const events = view?.events || [];
  // Aus dem Helfer-Aufruf: die genannte Veranstaltung zuerst.
  const upcoming = events.filter((e) => e.upcoming).sort((a, b) => Number(b.id === wanted) - Number(a.id === wanted));
  const rest = events.filter((e) => !e.upcoming);

  return (
    <>
      <section className="min-w-0" data-testid="helper-shifts-page">
        <p className="tls-type-body text-white/60 max-w-2xl">Wo der Verein Hände braucht: Schichten mit Plätzen, dein Stand je Dienst. Angefragt heißt: der Vorstand bestätigt. Gezählt wird, was der Verein als geleistet bestätigt.</p>

        {/* Helfer-Aufruf (#1197): Vorstand - wie jeder Adminbereich nur mit bestätigter Zwei-Faktor-Anmeldung (#1479). */}
        {canUseArea(user, "club") ? <HelperCallPanel /> : null}

        {view === null ? <p className="mt-8 tls-type-small text-white/45" data-testid="helper-shifts-loading">Wird geladen …</p> : null}

        {view && !view.available ? (
          <div className="mt-8 border border-white/10 rounded-sm bg-[#121212] p-5 tls-type-small text-white/70" data-testid="helper-shifts-unavailable">
            {view.text || "Helferdienste sind hier noch nicht verfügbar."}
            {view.reason === "not_bound" ? <div className="mt-3"><Link to="/mein-bereich/mitgliedschaft" className="tls-btn tls-btn--secondary inline-flex min-h-11 items-center px-4 py-2 rounded-sm tls-type-label">Zur Mitgliedschaft</Link></div> : null}
          </div>
        ) : null}

        {view && view.available ? (
          <>
            {view.my_count ? <p className="mt-6 tls-type-small text-white/70" data-testid="helper-shifts-mine">Du bist bei {view.my_count === 1 ? "einem Dienst" : `${view.my_count} Diensten`} eingetragen.</p> : null}
            {!events.length ? <p className="mt-6 tls-type-small text-white/45" data-testid="helper-shifts-empty">Derzeit keine Veranstaltung mit Helferdiensten.</p> : null}
            <div className="mt-4 space-y-4">
              {upcoming.map((event) => <EventCard key={event.id} event={event} busy={busy} onRequest={request} onWithdraw={withdraw} highlight={event.id === wanted} askFor={askFor} onAskDone={() => setAskFor("")} />)}
              {rest.map((event) => <EventCard key={event.id} event={event} busy={busy} onRequest={request} onWithdraw={withdraw} />)}
            </div>
          </>
        ) : null}
      </section>
    </>
  );
}

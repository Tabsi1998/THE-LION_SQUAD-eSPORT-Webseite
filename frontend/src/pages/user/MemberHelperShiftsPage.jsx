import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { ArrowLeft, Calendar, CheckCircle2, HandHelping, MapPin, Users } from "lucide-react";

// Helferdienste (#331): Veranstaltungen mit Schichten aus der Vereinsakte (Vereine 1.4). Plätze, Bestätigung und
// Anmeldestelle kommen vom Verein; die Website zeigt und reicht Anfrage und Rücknahme durch. Selbst eingetragen
// ist noch kein Dienst - erst der Vorstand bestätigt, und erst „geleistet“ zählt.

export function formatDay(day) {
  if (!day) return "";
  const [y, m, d] = String(day).split("-");
  return y && m && d ? `${d}.${m}.${y}` : day;
}

export function shiftWhen(shift) {
  const time = shift.start && shift.end ? `${shift.start}–${shift.end} Uhr` : shift.start ? `ab ${shift.start} Uhr` : "";
  return [formatDay(shift.day), time].filter(Boolean).join(" · ");
}

function MineBadge({ shift }) {
  if (!shift.mine) return null;
  const done = shift.mine === "done" || shift.mine === "confirmed";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border text-[10px] font-bold uppercase tracking-wider ${done ? "border-[#00FF88]/40 text-[#00FF88]" : shift.mine === "requested" ? "border-[#FFD700]/40 text-[#FFD700]" : "border-white/15 text-white/50"}`} data-testid={`shift-${shift.id}-mine`}>
      {done ? <CheckCircle2 className="w-3 h-3" /> : null} {shift.mine_label}
    </span>
  );
}

function EventCard({ event, busy, onRequest, onWithdraw }) {
  return (
    <div className={`border rounded-sm bg-[#121212] p-5 ${event.upcoming ? "border-[#FFD700]/40" : "border-white/10"}`} data-testid={`helper-event-${event.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#FFD700]">{event.visibility_label} · {event.status_label}</div>
          <h2 className="font-heading text-xl font-black uppercase mt-1">{event.label}</h2>
          <div className="mt-1 text-sm text-white/70 inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1"><Calendar className="w-3.5 h-3.5 text-[#FFD700]" /> {formatDay(event.day)}{event.end_day && event.end_day !== event.day ? ` – ${formatDay(event.end_day)}` : ""}</span>
            {event.place ? <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {event.place}</span> : null}
            <span className="text-white/45" data-testid={`helper-event-${event.id}-registration`}>{event.registration?.text}</span>
          </div>
        </div>
        {event.open_places ? <span className="text-xs text-white/55" data-testid={`helper-event-${event.id}-open`}>{event.open_places} {event.open_places === 1 ? "freier Platz" : "freie Plätze"}</span> : null}
      </div>

      <div className="mt-4 space-y-2">
        {event.shifts.map((shift) => (
          <div key={shift.id} className="flex flex-wrap items-center gap-3 border border-white/10 rounded-sm px-3 py-2.5" data-testid={`shift-${shift.id}`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-white">{shift.label}</span>
                <MineBadge shift={shift} />
              </div>
              <div className="text-xs text-white/55 mt-0.5 inline-flex items-center gap-2">
                <span>{shiftWhen(shift)}</span>
                <span className="inline-flex items-center gap-1" data-testid={`shift-${shift.id}-places`}><Users className="w-3 h-3" /> {shift.taken}/{shift.capacity}{shift.full ? " · voll" : ""}</span>
              </div>
            </div>
            {shift.can_request ? (
              <button type="button" onClick={() => onRequest(event, shift)} disabled={busy === `shift-${shift.id}`} data-testid={`shift-${shift.id}-request`} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#FFD700] text-black rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">
                <HandHelping className="w-3.5 h-3.5" /> Ich helfe
              </button>
            ) : null}
            {shift.can_withdraw ? (
              <button type="button" onClick={() => onWithdraw(event, shift)} disabled={busy === `shift-${shift.id}`} data-testid={`shift-${shift.id}-withdraw`} className="px-3 py-1.5 border border-white/15 rounded-sm text-[11px] font-bold uppercase tracking-wider text-white/70 hover:text-white disabled:opacity-50">
                Anfrage zurückziehen
              </button>
            ) : null}
            {shift.mine === "confirmed" ? <span className="text-[11px] text-white/45">Absagen bitte beim Vorstand.</span> : null}
          </div>
        ))}
        {!event.shifts.length ? <p className="text-xs text-white/45">Für diese Veranstaltung sind keine Helferdienste ausgeschrieben.</p> : null}
      </div>
    </div>
  );
}

export default function MemberHelperShiftsPage() {
  const confirm = useConfirm();
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState("");
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
  const upcoming = events.filter((e) => e.upcoming);
  const rest = events.filter((e) => !e.upcoming);

  return (
    <PublicLayout>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12" data-testid="helper-shifts-page">
        <Link to="/members/area" className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-white/50 hover:text-[#FFD700]"><ArrowLeft className="w-3 h-3" /> Mitgliederbereich</Link>
        <span className="block mt-4 text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Mitgliederbereich</span>
        <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Helferdienste</h1>
        <p className="mt-2 text-sm text-white/60 max-w-2xl">Wo der Verein Hände braucht: Schichten mit Plätzen, dein Stand je Dienst. Angefragt heißt: der Vorstand bestätigt. Gezählt wird, was der Verein als geleistet bestätigt.</p>

        {view === null ? <p className="mt-8 text-sm text-white/45" data-testid="helper-shifts-loading">Wird geladen …</p> : null}

        {view && !view.available ? (
          <div className="mt-8 border border-white/10 rounded-sm bg-[#121212] p-5 text-sm text-white/70" data-testid="helper-shifts-unavailable">
            {view.text || "Helferdienste sind hier noch nicht verfügbar."}
            {view.reason === "not_bound" ? <div className="mt-3"><Link to="/members/membership" className="text-[#FFD700] hover:underline">Zu Meine Mitgliedschaft</Link></div> : null}
          </div>
        ) : null}

        {view && view.available ? (
          <>
            {view.my_count ? <p className="mt-6 text-sm text-white/70" data-testid="helper-shifts-mine">Du bist bei {view.my_count === 1 ? "einem Dienst" : `${view.my_count} Diensten`} eingetragen.</p> : null}
            {!events.length ? <p className="mt-6 text-sm text-white/45" data-testid="helper-shifts-empty">Derzeit keine Veranstaltung mit Helferdiensten.</p> : null}
            <div className="mt-4 space-y-4">
              {upcoming.map((event) => <EventCard key={event.id} event={event} busy={busy} onRequest={request} onWithdraw={withdraw} />)}
              {rest.map((event) => <EventCard key={event.id} event={event} busy={busy} onRequest={request} onWithdraw={withdraw} />)}
            </div>
          </>
        ) : null}
      </section>
    </PublicLayout>
  );
}

import { useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { AuthFormAlert } from "@/components/tls/AuthFormFields";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";
import { formatCents, previewQuote } from "@/lib/pricing";

// Die eigene Event-Anmeldung ändern (#2113, L-A3): Begleitpersonen und Hinweis - bisher nur über Stornieren und neu
// anmelden. Ein leiser Link „Anmeldung ändern“ öffnet das kleine Formular im Kasten „Dein Event“; der Server sagt mit
// `can_edit`, ob es noch geht (bis zum Beginn, nicht nach dem Check-in), und prüft Plätze und Rechnung selbst.

export function EventRegistrationEdit({ event, own, onSaved }) {
  const [open, setOpen] = useState(false);
  const [companions, setCompanions] = useState(Number(own?.companion_count || 0));
  const [note, setNote] = useState(own?.note || "");
  const [error, setError] = useState("");
  const { submitting, submitOnce } = useSubmissionGuard();
  const maxCompanions = event.allow_companions ? Number(event.max_companions_per_registration || 0) : 0;
  // Neue Summe vor dem Speichern (#2113): nur, wenn es schon einen Preis gibt - ohne ihn rechnet die Turnierleitung.
  const seatsNow = 1 + Number(companions || 0);
  const chosen = (own?.price?.positions || []).filter((line) => line.optional).map((line) => line.key);
  const quote = own?.price && event.offer ? previewQuote(event.offer, { seats: seatsNow, selected: chosen }) : null;
  const seatsChanged = Number(companions || 0) !== Number(own?.companion_count || 0);

  if (!own?.can_edit) return null;

  const start = () => {
    setCompanions(Number(own.companion_count || 0));
    setNote(own.note || "");
    setError("");
    setOpen(true);
  };

  const save = async (ev) => {
    ev.preventDefault();
    setError("");
    const changes = {};
    if ((note.trim() || null) !== (own.note || null)) changes.note = note.trim();
    if (maxCompanions && Number(companions || 0) !== Number(own.companion_count || 0)) changes.companion_count = Number(companions || 0);
    if (!Object.keys(changes).length) {
      setOpen(false);
      return;
    }
    const attempt = await submitOnce(async () => {
      await api.patch(`/events/${event.id}/registrations/me`, changes);
      toast.success("Anmeldung geändert.");
      setOpen(false);
      await onSaved?.();
    });
    if (attempt.started && attempt.error) {
      const message = formatRequestError(attempt.error, "Die Anmeldung konnte nicht geändert werden.");
      setError(message);
      toast.error(message);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={start} data-testid="event-edit-link"
        className="tls-hit mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-white/55 underline-offset-4 hover:text-[#29B6E8] hover:underline">
        <Pencil className="w-3.5 h-3.5" /> Anmeldung ändern
      </button>
    );
  }

  return (
    <form onSubmit={save} className="mt-3 space-y-3 border border-white/10 bg-[#0A0A0A] rounded-sm p-4" data-testid="event-edit-form">
      <div className="text-[11px] uppercase tracking-widest text-white/50 font-bold">Anmeldung ändern</div>
      {maxCompanions > 0 && (
        <label className="block">
          <div className="text-[11px] uppercase tracking-widest text-white/50 font-bold mb-1.5">Begleitpersonen</div>
          <input type="number" min="0" max={maxCompanions} value={companions} onChange={(ev) => { setCompanions(ev.target.value); setError(""); }}
            data-testid="event-edit-companions" className="w-full min-h-11 bg-[#121212] border border-white/10 px-3 py-2 rounded-sm" />
          <div className="mt-1 text-xs text-white/40">Maximal {maxCompanions} pro Anmeldung.</div>
        </label>
      )}
      {seatsChanged && quote && !quote.free && (
        <div className="border border-white/15 rounded-sm p-3 text-sm flex items-baseline justify-between gap-3" data-testid="event-edit-quote">
          <span className="text-white/65">Neue Summe für {seatsNow} Person{seatsNow === 1 ? "" : "en"}</span>
          <strong className="font-heading text-xl text-white">{formatCents(quote.total_cents, quote.currency)}</strong>
        </div>
      )}
      <label className="block">
        <div className="text-[11px] uppercase tracking-widest text-white/50 font-bold mb-1.5">Hinweis optional</div>
        <textarea value={note} onChange={(ev) => { setNote(ev.target.value); setError(""); }} rows={3} maxLength={500}
          data-testid="event-edit-note" className="w-full bg-[#121212] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="z.B. komme etwas später" />
      </label>
      {error && <AuthFormAlert id="event-edit-error">{error}</AuthFormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={() => setOpen(false)} className="tls-btn tls-btn--quiet min-h-11 px-4 text-xs uppercase tracking-wider font-bold rounded-sm" data-testid="event-edit-cancel">Abbrechen</button>
        <button type="submit" disabled={submitting} className="tls-btn tls-btn--primary min-h-11 px-4 text-xs uppercase tracking-wider font-bold rounded-sm disabled:opacity-50" data-testid="event-edit-save">
          {submitting ? "Speichere…" : "Speichern"}
        </button>
      </div>
    </form>
  );
}

export default EventRegistrationEdit;

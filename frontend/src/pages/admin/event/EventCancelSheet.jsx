import { useState } from "react";
import { formatRequestError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { TextAreaField } from "@/components/tls/FormFields";
import { cancelConfirmText } from "@/lib/eventAdmin";
import { MIN_REASON, minimumSummary, reasonProblem } from "@/lib/eventMinimum";

// „Event absagen“ mit Grund (#2614) - als Blatt wie „Season absagen“ (#2607). Ein Schritt: Grund eintragen, absagen; der Server
// storniert Anmeldungen und Warteliste und schickt jeder Person genau eine Nachricht samt Mail mit dem Grund. Bei einem Event mit
// Mindestanzahl ist der Grund Pflicht; sind zu wenige da, steht der Vorschlag vom Server schon im Feld.
export function EventCancelSheet({ event, affected, defaultReason = "", onClose, onConfirm }) {
  const [reason, setReason] = useState(defaultReason);
  const [problem, setProblem] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (formEvent) => {
    formEvent.preventDefault();
    const missing = reasonProblem(reason);
    if (missing) {
      setProblem(missing);
      return;
    }
    setSaving(true);
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setProblem(formatRequestError(err, "Das Event konnte nicht abgesagt werden."));
      setSaving(false);
    }
  };
  return (
    <AdminSheet title={`${event?.name || "Event"} absagen`} eyebrow="Event absagen" accent="var(--tls-warn)" onClose={onClose} onSubmit={submit}
      saving={saving} savingLabel="Sage ab …" submitLabel="Event absagen" submitTestId="event-cancel-confirm" testId="event-cancel-sheet" noValidate>
      <p className="tls-type-body text-white/85 break-words" data-testid="event-cancel-consequences">{cancelConfirmText(affected)}</p>
      {event?.minimum ? (
        <p className="tls-type-small text-white/65 break-words" data-testid="event-cancel-minimum">Mindestanzahl: {minimumSummary(event.minimum)}</p>
      ) : null}
      <TextAreaField label="Grund" required rows={3} value={reason} onChange={(value) => { setReason(value.slice(0, 500)); setProblem(""); }}
        placeholder="z. B. zu wenige Anmeldungen bis zur Frist" hint={`Steht auf der Event-Seite und in der Nachricht an alle, mindestens ${MIN_REASON} Zeichen.`}
        testId="event-cancel-reason" />
      {problem ? <p className="tls-type-small text-warn break-words" role="alert" data-testid="event-cancel-problem">{problem}</p> : null}
    </AdminSheet>
  );
}

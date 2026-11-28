import { useState } from "react";
import { formatRequestError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { TextAreaField } from "@/components/tls/FormFields";
import { cancelConfirmText } from "@/lib/eventAdmin";
import { MIN_REASON, minimumSummary, reasonProblem } from "@/lib/eventMinimum";

// „Event absagen“ mit Grund (#2614, Fabian 28.11.: jede Absage läuft hierüber) - als Blatt wie „Season absagen“ (#2607). Ein Schritt:
// Grund eintragen, absagen; der Server storniert Anmeldungen und Warteliste und schickt jeder Person genau eine Nachricht samt Mail.
// Pflicht ist der Grund nur bei einem Event mit Mindestanzahl (`required`); sonst ist er freiwillig, und ohne Grund sehen Nachricht und
// Mail aus wie bisher. Sind zu wenige da, steht der Vorschlag vom Server schon im Feld.
export function EventCancelSheet({ event, affected, required = false, defaultReason = "", onClose, onConfirm }) {
  const [reason, setReason] = useState(defaultReason);
  const [problem, setProblem] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (formEvent) => {
    formEvent.preventDefault();
    const missing = required ? reasonProblem(reason) : "";
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
  const hint = required
    ? `Pflicht bei einer Mindestanzahl, mindestens ${MIN_REASON} Zeichen. Steht auf der Event-Seite und in der Nachricht an alle.`
    : "Freiwillig. Steht auf der Event-Seite und in der Nachricht an alle; leer bleibt die Nachricht wie bisher.";
  return (
    <AdminSheet title={`${event?.name || "Event"} absagen`} eyebrow="Event absagen" accent="var(--tls-warn)" onClose={onClose} onSubmit={submit}
      saving={saving} savingLabel="Sage ab …" submitLabel="Event absagen" submitTestId="event-cancel-confirm" testId="event-cancel-sheet" noValidate>
      <p className="tls-type-body text-white/85 break-words" data-testid="event-cancel-consequences">{cancelConfirmText(affected)}</p>
      {event?.minimum ? (
        <p className="tls-type-small text-white/65 break-words" data-testid="event-cancel-minimum">Mindestanzahl: {minimumSummary(event.minimum)}</p>
      ) : null}
      <TextAreaField label={required ? "Grund" : "Grund (freiwillig)"} required={required} rows={3} value={reason}
        onChange={(value) => { setReason(value.slice(0, 500)); setProblem(""); }}
        placeholder={required ? "z. B. zu wenige Anmeldungen bis zur Frist" : "z. B. Halle nicht verfügbar"} hint={hint} testId="event-cancel-reason" />
      {problem ? <p className="tls-type-small text-warn break-words" role="alert" data-testid="event-cancel-problem">{problem}</p> : null}
    </AdminSheet>
  );
}

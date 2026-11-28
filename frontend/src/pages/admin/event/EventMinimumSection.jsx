import { Ban } from "lucide-react";
import { FormGrid } from "@/components/tls/AdminForm";
import { CheckField, TextField } from "@/components/tls/FormFields";
import { StatusChip } from "@/components/tls/StatusChip";
import { formatWhen } from "@/lib/datetime";
import { minimumChip, minimumExample, minimumSummary } from "@/lib/eventMinimum";

// Mindestanzahl bis zu einer Frist (#2614): im Abschnitt „Anmeldung“ der Bearbeiten-Seite. Oben die Einstellung (Zahl, Frist,
// Begleitpersonen, Event-Seite), darunter - sobald das Event gespeichert ist - der Stand vom Server und „Event absagen“ als ein
// Schritt mit Pflichtgrund. Abgesagt wird nie von selbst: nach der Frist bekommt die Turnierleitung einen Hinweis.
export function EventMinimumSection({ value, onChange, minimum, notice, allowCompanions, canCancel, cancelBlocked, onCancel, accent }) {
  const set = (key, next) => onChange({ ...value, [key]: next });
  const chip = minimum ? minimumChip(minimum) : null;
  return (
    <div className="space-y-3 border-t border-white/10 pt-4" data-testid="event-minimum">
      <CheckField
        label="Findet nur mit Mindestanzahl statt"
        hint="Bis zur Frist müssen mindestens so viele angemeldet sein. Sonst bekommt die Turnierleitung einen Hinweis mit dem Vorschlag abzusagen – abgesagt wird nie von selbst."
        checked={value.enabled}
        onChange={(next) => set("enabled", next)}
        accent={accent}
        testId="event-minimum-enabled"
      />
      {value.enabled && (
        <>
          <FormGrid>
            <TextField label="Mindestanzahl" type="number" min={1} max={10000} value={value.count} onChange={(next) => set("count", next)} required testId="event-minimum-count" />
            <TextField label="Frist" type="datetime-local" value={value.deadline} onChange={(next) => set("deadline", next)} required hint="Mindestens 1 Stunde vor dem Beginn des Events." testId="event-minimum-deadline" />
          </FormGrid>
          {allowCompanions && (
            <CheckField label="Begleitpersonen zählen mit" checked={value.count_companions} onChange={(next) => set("count_companions", next)} accent={accent} testId="event-minimum-companions"
              hint={value.count_companions ? "Gezählt werden Personen: jede Anmeldung samt ihren Begleitpersonen." : "Gezählt werden nur die Anmeldungen, Begleitpersonen nicht."} />
          )}
          <CheckField label="Auf der Event-Seite zeigen" checked={value.public} onChange={(next) => set("public", next)} accent={accent} testId="event-minimum-public"
            hint={`${minimumExample(value, { allowCompanions })} im Kasten oben. Aus: Den Stand sieht nur die Verwaltung, hier unten.`} />
        </>
      )}
      {minimum && (
        <div className="rounded-sm border border-white/10 bg-[#0A0A0A] p-3 space-y-2 min-w-0" data-testid="event-minimum-state">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="tls-type-label text-white/60">Stand</span>
            <StatusChip kind={chip.kind} variant={chip.variant} label={chip.label} testId="event-minimum-chip" />
          </div>
          <p className="tls-type-small text-white/80 break-words" data-testid="event-minimum-summary">{minimumSummary(minimum)}</p>
          {notice?.at && (
            <p className="tls-type-small text-white/60" data-testid="event-minimum-notice">Hinweis an die Turnierleitung verschickt: {formatWhen(notice.at)}.</p>
          )}
          {minimum.state === "short" && (
            <p className="tls-type-small text-warn break-words" data-testid="event-minimum-proposal">
              Vorschlag: absagen. Alle Angemeldeten bekommen eine Nachricht mit dem Grund.
            </p>
          )}
          {canCancel && (
            <div className="space-y-1">
              <button type="button" onClick={onCancel} disabled={cancelBlocked}
                className="tls-btn tls-btn--secondary inline-flex min-h-11 items-center gap-2 px-4 py-2 tls-type-label rounded-sm disabled:opacity-50" data-testid="event-minimum-cancel">
                <Ban className="w-4 h-4" aria-hidden="true" /> Event absagen …
              </button>
              {cancelBlocked ? <p className="tls-type-small text-white/60">Erst die anderen Änderungen speichern – dann absagen.</p> : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

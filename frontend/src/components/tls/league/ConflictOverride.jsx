import { TextField } from "@/components/tls/FormFields";

// Befangenheit in der Liga (#2203, E.1 #1625): Über das eigene Team entscheidet eine andere Person. Nur der Superadmin darf
// trotzdem, als Notausnahme mit Grund (ab fünf Zeichen, steht im Protokoll) - wie im Eingang der Selbstanmeldung (#2245).

export const OWN_TEAM = "Über dein eigenes Team entscheidet eine andere Person.";
export const CONFLICT_REASON_MIN = 5;

/** Der Grund der Notausnahme, wie er mitgeht - leer, solange keine nötig ist. */
export function overridePayload(needed, text) {
  const value = String(text || "").trim();
  return needed && value ? { conflict_reason: value } : {};
}

/** Fehlt der Grund noch, obwohl er nötig ist? */
export function overrideMissing(needed, text) {
  return Boolean(needed) && String(text || "").trim().length < CONFLICT_REASON_MIN;
}

export function OwnTeamNote({ testId }) {
  return <p className="text-xs font-semibold text-white/80" data-testid={testId}>{OWN_TEAM}</p>;
}

export function ConflictReasonField({ value, onChange, testId }) {
  return (
    <div className="space-y-2 rounded-sm border border-warn/40 p-3">
      <OwnTeamNote />
      <TextField label="Grund für die Notausnahme" required value={value} onChange={onChange} maxLength={500} testId={testId}
        hint="Als Superadmin geht es trotzdem, mit mindestens fünf Zeichen. Der Grund steht im Protokoll." />
    </div>
  );
}

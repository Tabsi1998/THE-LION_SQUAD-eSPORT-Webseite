import { FormActions } from "@/components/tls/AdminForm";

// Ein Reiter der Season-Seite mit eigenem Speichern (#2267). Die Leiste klebt unten, solange das Formular des Reiters im Bild ist;
// Bausteine mit eigenem Speichern (Map-Pool, Ergebnisregeln, Terminregeln, Sperrliste …) stehen außerhalb davon.
export function SeasonTabForm({ tab, submitLabel, dirty, saving, onSave, onDiscard, className = "space-y-6", children }) {
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSave(tab); }} noValidate data-testid={`season-form-${tab}`} className={className}>
      {children}
      <FormActions
        submitLabel={submitLabel}
        saving={saving}
        submitTestId={`season-save-${tab}`}
        onCancel={dirty ? () => onDiscard(tab) : undefined}
        cancelLabel="Verwerfen"
        hint={dirty
          ? <span className="text-warn" data-testid={`season-unsaved-${tab}`}>Nicht gespeichert – bleibt beim Reiterwechsel erhalten.</span>
          : <span data-testid={`season-saved-${tab}`}>Alles gespeichert.</span>}
      />
    </form>
  );
}

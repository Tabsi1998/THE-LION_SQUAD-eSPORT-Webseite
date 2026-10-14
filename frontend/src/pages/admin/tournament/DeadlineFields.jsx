// Fristen je Turnier (#1551) in den erweiterten Spieloptionen: leer heißt Standard.
import { FormGrid } from "@/components/tls/AdminForm";
import { TextField } from "@/components/tls/FormFields";
import { DEADLINE_FIELDS } from "@/lib/tournamentDeadlines";

export function DeadlineFields({ form, onChange }) {
  return (
    <div className="space-y-2" data-testid="tr-edit-deadlines">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Fristen</div>
      <p className="text-xs text-white/45">
        Nach „Nicht erschienen“ schlägt die Seite der Turnierleitung „kampflos verloren“ vor – sie bestätigt oder verlängert.
        Meldet nur eine Seite und widerspricht die andere nicht, gilt das Ergebnis nach der Frist (Liga spätestens zum Ende der
        Spielwoche). Vor Ort bestätigt die Turnierleitung. Leer heißt Standard.
      </p>
      <FormGrid cols={2}>
        {DEADLINE_FIELDS.map((field) => (
          <TextField
            key={field.key}
            label={field.label}
            type="number"
            min="1"
            max={String(field.max)}
            value={form[field.key]}
            placeholder={`Standard: ${field.fallback}`}
            onChange={(value) => onChange(field.key, value)}
            testId={field.testId}
          />
        ))}
      </FormGrid>
    </div>
  );
}

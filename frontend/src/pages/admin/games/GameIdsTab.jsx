// Reiter „Spiel-IDs“ der Spielseite (#2249): welche Spieler-ID bei Anmeldungen gefragt wird, mit Format und Auswahl (#2204),
// bei einer Spielversion dazu, woher die IDs kommen. Je Feld eine Karte mit beschrifteten Eingaben statt einer Zeile Platzhalter.
import { Plus, Trash2 } from "lucide-react";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, SelectField, TextField } from "@/components/tls/FormFields";
import { gameOptionLabel, selectableGames } from "@/lib/gameLabels";
import { fieldKeyFrom } from "@/lib/gameForm";

function IdFieldCard({ field, index, onChange, onRemove }) {
  const update = (patch) => onChange({ ...field, ...patch });
  const options = Array.isArray(field.options) ? field.options.join(", ") : field.options || "";
  return (
    <li className="rounded-sm border border-white/10 bg-[#0A0A0A] p-3 md:p-4 space-y-3" data-testid={`game-id-field-${index}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-semibold text-white">{String(field.label || "").trim() || `ID-Feld ${index + 1}`}</span>
        <button type="button" onClick={onRemove} aria-label={`ID-Feld ${index + 1} entfernen`} data-testid={`game-id-field-remove-${index}`}
          className="p-2 text-white/45 hover:text-live focus-visible:outline focus-visible:outline-1 focus-visible:outline-live rounded-sm">
          <Trash2 className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      <FormGrid cols={3}>
        <TextField label="Bezeichnung" required value={field.label} placeholder="z. B. Activision ID"
          onChange={(value) => update({ label: value, key: field._new ? fieldKeyFrom(value) : field.key || fieldKeyFrom(value) })} testId={`game-id-field-label-${index}`} />
        {/* Neu angelegt folgt der Schlüssel der Bezeichnung, bis man ihn selbst ändert; ein gespeicherter bleibt - an ihm hängen die IDs. */}
        <TextField label="Schlüssel" value={field.key} placeholder="entsteht aus der Bezeichnung" onChange={(value) => update({ key: fieldKeyFrom(value), _new: false })}
          hint="Bleibt gleich, auch wenn die Bezeichnung sich ändert." testId={`game-id-field-key-${index}`} />
        <TextField label="Hinweis für Spieler" value={field.help_text} placeholder="z. B. steht im Profil unter …" onChange={(value) => update({ help_text: value })}
          testId={`game-id-field-help-${index}`} />
      </FormGrid>
      {/* Liga (#2204): Format und Auswahl gelten für neue Werte im Profil und für die Spielberechtigung. Leer = keine Vorgabe. */}
      <FormGrid cols={3}>
        <TextField label="Format" value={field.pattern} placeholder="z. B. [^#]+#\d+" onChange={(value) => update({ pattern: value })}
          hint="Regulärer Ausdruck. Leer: jede Eingabe." testId={`game-id-field-pattern-${index}`} />
        <TextField label="Beispiel für Spieler" maxLength={120} value={field.format_hint} placeholder="z. B. Name#1234567" onChange={(value) => update({ format_hint: value })}
          hint="Steht unter dem Feld, wenn das Format nicht passt." testId={`game-id-field-hint-${index}`} />
        <TextField label="Auswahl" value={options} placeholder="z. B. PC, PS5, Xbox" onChange={(value) => update({ options: value })}
          hint="Mit Komma getrennt; dann wählen Spieler statt zu tippen." testId={`game-id-field-options-${index}`} />
      </FormGrid>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <CheckField label="Pflichtfeld für Turnieranmeldung" checked={field.required !== false} onChange={(value) => update({ required: value })} testId={`game-id-field-required-${index}`} />
        <CheckField label="Je Liga-Season nur einmal vergeben" hint="Für Auswahlfelder wirkungslos, wenn nicht eigens gesetzt."
          checked={field.unique_in_season !== false} onChange={(value) => update({ unique_in_season: value })} testId={`game-id-field-unique-${index}`} />
      </div>
    </li>
  );
}

export function GameIdsTab({ gameId, kind, form, onChange, games }) {
  const fields = form.player_id_fields || [];
  const setFields = (next) => onChange({ ...form, player_id_fields: next });
  const isEdition = kind === "edition";
  const identityOptions = selectableGames(games, form.identity_source_game_id).filter((game) => game.id !== gameId)
    .map((game) => [game.id, `ID von ${gameOptionLabel(game)}`]);
  return (
    <div className="space-y-5">
      {isEdition && (
        <FormSection title="Woher die IDs kommen" hint="Eine Spielversion kann die Spieler-IDs ihres Hauptspiels oder eines anderen Spiels nutzen." testId="game-ids-source">
          <SelectField label="ID-Quelle" value={form.identity_source_game_id} onChange={(value) => onChange({ ...form, identity_source_game_id: value })}
            options={[["", "Automatisch: das Hauptspiel"], ...identityOptions]} testId="game-edit-identity-source" />
          <CheckField label="Spieler-IDs vom Hauptspiel verwenden, solange keine eigene ID-Quelle gesetzt ist." checked={form.inherit_player_ids !== false}
            onChange={(value) => onChange({ ...form, inherit_player_ids: value })} testId="game-edit-inherit-ids" />
        </FormSection>
      )}
      <FormSection title="Spieler-IDs"
        hint="Welche ID bei der Anmeldung gefragt wird, etwa die Activision ID. Pflichtfelder prüft die Turnieranmeldung; Format und Auswahl gelten für neue Werte im Profil und für die Liga."
        testId="game-ids-fields">
        {fields.length ? (
          <ul className="space-y-3">
            {fields.map((field, index) => (
              <IdFieldCard key={index} field={field} index={index} onChange={(next) => setFields(fields.map((row, i) => (i === index ? next : row)))}
                onRemove={() => setFields(fields.filter((_, i) => i !== index))} />
            ))}
          </ul>
        ) : (
          <p className="rounded-sm border border-dashed border-white/15 px-4 py-5 text-sm text-white/55" data-testid="game-ids-empty">
            Noch keine Spieler-ID. Ohne ID-Feld fragt die Anmeldung nichts ab{isEdition ? " – außer die Version erbt sie oben" : ""}.
          </p>
        )}
        <button type="button" onClick={() => setFields([...fields, { key: "", label: "", help_text: "", required: true, _new: true }])}          className="tls-btn tls-btn--secondary inline-flex items-center gap-2 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-40"
          data-testid="game-id-field-add">
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> ID-Feld hinzufügen
        </button>
      </FormSection>
    </div>
  );
}

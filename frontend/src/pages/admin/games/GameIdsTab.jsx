// Reiter „Spiel-IDs“ der Spielseite (#2249): welche Spieler-ID bei Anmeldungen gefragt wird, mit Format und Auswahl (#2204),
// bei einer Spielversion dazu, woher die IDs kommen. Je Feld eine Karte mit beschrifteten Eingaben statt einer Zeile Platzhalter.
// Unter dem Schlüssel eines gespeicherten Felds stehen die IDs der Spieler: Er ist fest, und wer ein Feld mit gespeicherten IDs
// entfernt, wird mit der Zahl der Personen gefragt. Ein neues Feld mit derselben Bezeichnung wie ein eben entferntes bekommt
// dessen Schlüssel zurück (Codex-Nachprüfung #2249).
import { Plus, Trash2 } from "lucide-react";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, SelectField, TextField } from "@/components/tls/FormFields";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { gameOptionLabel, selectableGames } from "@/lib/gameLabels";
import { fieldKeyFrom, idFieldKey, removedFieldFor } from "@/lib/gameForm";

const people = (count) => `${count} ${count === 1 ? "Person" : "Personen"}`;

function keyHint(field) {
  if (field._restoredKey) return "Schlüssel des eben entfernten Felds – die gespeicherten IDs bleiben erreichbar.";
  return field._new ? "Entsteht aus der Bezeichnung; nach dem Speichern fest." : "Fest – daran hängen die IDs der Spieler.";
}

function IdFieldCard({ field, index, onChange, onLabel, onRemove }) {
  const update = (patch) => onChange({ ...field, ...patch });
  const options = Array.isArray(field.options) ? field.options.join(", ") : field.options || "";
  return (
    <li className="rounded-sm border border-white/10 bg-[#0A0A0A] p-3 md:p-4 space-y-3" data-testid={`game-id-field-${index}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-semibold text-white">{String(field.label || "").trim() || String(field.key || "").trim() || `ID-Feld ${index + 1}`}</span>
        <button type="button" onClick={onRemove} aria-label={`ID-Feld ${index + 1} entfernen`} data-testid={`game-id-field-remove-${index}`}
          className="p-2 text-white/45 hover:text-live focus-visible:outline focus-visible:outline-1 focus-visible:outline-live rounded-sm">
          <Trash2 className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      <FormGrid cols={3}>
        <TextField label="Bezeichnung" required value={field.label} placeholder="z. B. Activision ID" onChange={onLabel} testId={`game-id-field-label-${index}`} />
        {/* Neu angelegt folgt der Schlüssel der Bezeichnung, bis man ihn selbst ändert. Ein gespeicherter ist fest: an ihm hängen
            die IDs der Spieler - auch wenn er nicht so aussieht, wie ein neuer heute entstünde, oder leer ist (Altbestand). */}
        <TextField label="Schlüssel" value={field._new ? idFieldKey(field) : field.key} placeholder={field._new ? "entsteht aus der Bezeichnung" : "(leer)"}
          disabled={!field._new || Boolean(field._restoredKey)} onChange={(value) => update({ key: fieldKeyFrom(value), _keyTouched: true })}
          hint={keyHint(field)} testId={`game-id-field-key-${index}`} />
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

// `usage`: Antwort von GET /games/{id}/usage (`id_fields`: Personen je Schlüssel); undefined = lädt, null = unbekannt.
export function GameIdsTab({ gameId, kind, form, onChange, games, usage }) {
  const confirm = useConfirm();
  const fields = form.player_id_fields || [];
  const setFields = (next) => onChange({ ...form, player_id_fields: next });
  const isEdition = kind === "edition";
  const identityOptions = selectableGames(games, form.identity_source_game_id).filter((game) => game.id !== gameId)
    .map((game) => [game.id, `ID von ${gameOptionLabel(game)}`]);

  const setLabel = (index, value) => {
    const field = fields[index];
    if (!field._new) {
      setFields(fields.map((row, i) => (i === index ? { ...row, label: value } : row)));
      return;
    }
    const back = removedFieldFor({ ...form, player_id_fields: fields.filter((_, i) => i !== index) }, value);
    const next = { ...field, label: value, _restoredKey: back ? back.key : undefined };
    if (!back && !field._keyTouched) next.key = fieldKeyFrom(value);
    setFields(fields.map((row, i) => (i === index ? next : row)));
  };

  const remove = async (index) => {
    const field = fields[index];
    const rest = fields.filter((_, i) => i !== index);
    const key = String(field.key ?? "");
    if (field._new || !key) {
      setFields(rest);
      return;
    }
    const counted = usage?.id_fields && typeof usage.id_fields[key] === "number" ? usage.id_fields[key] : null;
    const label = String(field.label || "").trim() || key;
    if (counted !== 0) {
      const ok = await confirm({
        title: `„${label}“ entfernen?`,
        description: `${counted === null
          ? "Ob unter diesem Feld schon Spieler-IDs gespeichert sind, ließ sich nicht prüfen."
          : `Unter diesem Feld sind IDs von ${people(counted)} gespeichert (Profil oder Liga-Kader).`} Ohne das Feld findet die Seite sie nicht mehr. Legst du gleich wieder ein Feld „${label}“ an, bekommt es den alten Schlüssel zurück.`,
        confirmLabel: "Entfernen",
      });
      if (!ok) return;
    }
    onChange({ ...form, player_id_fields: rest, removed_fields: [...(form.removed_fields || []), { key, label, players: counted, confirmed: true }] });
  };

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
                onLabel={(value) => setLabel(index, value)} onRemove={() => remove(index)} />
            ))}
          </ul>
        ) : (
          <p className="rounded-sm border border-dashed border-white/15 px-4 py-5 text-sm text-white/55" data-testid="game-ids-empty">
            Noch keine Spieler-ID. Ohne ID-Feld fragt die Anmeldung nichts ab{isEdition ? " – außer die Version erbt sie oben" : ""}.
          </p>
        )}
        {(form.removed_fields || []).some((row) => !fields.some((field) => idFieldKey(field) === row.key)) ? (
          <p className="text-xs text-warn" data-testid="game-ids-removed">
            Beim Speichern entfernt: {(form.removed_fields || []).filter((row) => !fields.some((field) => idFieldKey(field) === row.key))
              .map((row) => `„${row.label}“${row.players ? ` (IDs von ${people(row.players)})` : ""}`).join(", ")}.
          </p>
        ) : null}
        <button type="button" onClick={() => setFields([...fields, { key: "", label: "", help_text: "", required: true, _new: true }])}
          className="tls-btn tls-btn--secondary inline-flex items-center gap-2 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-40"
          data-testid="game-id-field-add">
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> ID-Feld hinzufügen
        </button>
      </FormSection>
    </div>
  );
}

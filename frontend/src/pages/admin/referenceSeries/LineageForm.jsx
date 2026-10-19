import { useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid } from "@/components/tls/AdminForm";
import { SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { KIND_OPTIONS, VISIBILITY_OPTIONS, lineageToForm, lineagePayload } from "@/lib/referenceSeries";
import { gameOptionLabel } from "@/lib/gameLabels";
import { toast } from "sonner";

// Spur (#1741): die Klammer über den Saisons, etwa eine Rennliga mit der Bezeichnung „F1“. Die Adresse entsteht aus dem
// Titel; wird er geändert, leitet die alte Adresse weiter.

export function LineageForm({ lineage, games = [], onClose, onSaved }) {
  const isNew = !lineage?.id;
  const [form, setForm] = useState(() => lineageToForm(lineage || {}));
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const gameOptions = [["", "—"], ...games.map((game) => [game.id, gameOptionLabel(game)])];

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = lineagePayload(form);
      if (isNew) await api.post("/reference-series/admin/lineages", payload);
      else await api.patch(`/reference-series/admin/lineages/${lineage.id}`, payload);
      toast.success("Gespeichert.");
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminSheet title={isNew ? "Neue Spur" : "Spur bearbeiten"} eyebrow="Serien" onClose={onClose} onSubmit={save} saving={saving} submitTestId="lineage-save" testId="lineage-sheet">
      <TextField label="Titel" required value={form.title} onChange={(v) => set("title", v)} placeholder="Lion Racing F1" testId="lineage-title" />
      <FormGrid>
        <SelectField label="Art" value={form.kind} onChange={(v) => set("kind", v)} options={KIND_OPTIONS} testId="lineage-kind" />
        <TextField label="Bezeichnung" value={form.label} onChange={(v) => set("label", v)} placeholder="F1, 4vs4 …" testId="lineage-label" />
        <TextField label="Veranstalter" value={form.organizer} onChange={(v) => set("organizer", v)} testId="lineage-organizer" />
        <SelectField label="Spiel" value={form.game_id} onChange={(v) => set("game_id", v)} options={gameOptions} testId="lineage-game" />
        <TextField label="Seite des Veranstalters" value={form.external_url} onChange={(v) => set("external_url", v)} placeholder="https://…" testId="lineage-external-url" />
        <SelectField label="Sichtbarkeit" value={form.visibility} onChange={(v) => set("visibility", v)} options={VISIBILITY_OPTIONS} testId="lineage-visibility" />
        <TextField label="Adresse (Slug)" value={form.slug} onChange={(v) => set("slug", v)} placeholder="wird aus dem Titel gebildet" hint={isNew ? "" : "Die alte Adresse leitet weiter."} testId="lineage-slug" />
        <TextField label="Reihenfolge" type="number" value={form.order_index} onChange={(v) => set("order_index", Number(v) || 0)} testId="lineage-order" />
      </FormGrid>
      <TextAreaField label="Beschreibung" value={form.description} onChange={(v) => set("description", v)} testId="lineage-description" />
    </AdminSheet>
  );
}

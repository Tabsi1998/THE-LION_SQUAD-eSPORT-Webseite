// Galerie (#223): Abschnitt eines Albums bearbeiten.
import { useState } from "react";
import { formatRequestError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { TextAreaField, TextField } from "@/components/tls/FormFields";
import { toast } from "sonner";

export function SectionModal({ section, onClose, onSave }) {
  const isNew = !section?.id;
  const [form, setForm] = useState({
    title: section.title || "",
    description: section.description || "",
    order_index: section.order_index ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    if (!form.title.trim()) return toast.error("Bitte Abschnittstitel eingeben.");
    setSaving(true);
    try {
      await onSave({
        title: form.title.trim(),
        description: form.description.trim() || null,
        order_index: parseInt(form.order_index, 10) || 0,
      });
    } catch (err) {
      toast.error(formatRequestError(err, "Abschnitt konnte nicht gespeichert werden."));
      setSaving(false);
    }
  };
  // Seitenblatt statt Fenster (#435).
  return (
    <AdminSheet title={isNew ? "Abschnitt anlegen" : "Abschnitt bearbeiten"} eyebrow="Galerie" onClose={onClose} onSubmit={submit} saving={saving} submitTestId="gallery-section-save" testId="gallery-section-sheet">
      <TextField label="Titel" value={form.title} onChange={(value) => set("title", value)} placeholder="Aufbau, Tag 1, Tag 2" required testId="gallery-section-title" />
      <TextAreaField label="Beschreibung" value={form.description} onChange={(value) => set("description", value)} rows={2} testId="gallery-section-description" />
      <TextField label="Reihenfolge" value={form.order_index} onChange={(value) => set("order_index", value)} testId="gallery-section-order" />
    </AdminSheet>
  );
}

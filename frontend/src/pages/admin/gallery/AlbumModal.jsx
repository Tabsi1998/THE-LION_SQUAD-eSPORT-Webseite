// Galerie (#223): Album anlegen und bearbeiten.
import { useState } from "react";
import { api, formatRequestError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid } from "@/components/tls/AdminForm";
import { CheckField, FieldLabel, SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { GermanDateField } from "@/components/tls/GermanDateField";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { toast } from "sonner";

export function AlbumModal({ album, events, onClose, onSaved }) {
  const isNew = !album?.id;
  const slugFrom = (txt) => (txt || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  const [form, setForm] = useState({
    title: album.title || "",
    slug: album.slug || "",
    description: album.description || "",
    cover_url: album.cover_url || "",
    event_id: album.event_id || "",
    visibility: album.visibility || "public",
    taken_at: album.taken_at?.slice(0, 10) || "",
    published: album.published ?? true,
    order_index: album.order_index ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      Object.keys(payload).forEach((k) => { if (payload[k] === "") payload[k] = null; });
      if (payload.taken_at) payload.taken_at = `${payload.taken_at}T00:00:00`;
      payload.order_index = parseInt(form.order_index) || 0;
      if (payload.slug) payload.slug = slugFrom(payload.slug);
      if (isNew) await api.post("/gallery", payload);
      else await api.patch(`/gallery/${album.id}`, payload);
      toast.success("Gespeichert.");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(formatRequestError(err, "Album konnte nicht gespeichert werden.", { slug: form.slug, title: form.title }));
    }
    setSaving(false);
  };

  // Seitenblatt statt Fenster (#435).
  return (
    <AdminSheet title={isNew ? "Neues Album" : "Album bearbeiten"} eyebrow="Galerie" onClose={onClose} onSubmit={submit} saving={saving} submitTestId="album-save" testId="album-sheet">
      <FormGrid>
        <TextField label="Titel" value={form.title} onChange={(v) => { set("title", v); if (isNew && !form.slug) set("slug", slugFrom(v)); }} testId="album-title" required />
        <TextField label="Slug" value={form.slug} onChange={(v) => set("slug", v)} testId="album-slug" required />
      </FormGrid>
      <TextAreaField label="Beschreibung" value={form.description} onChange={(v) => set("description", v)} rows={2} testId="album-description" />
      <FieldLabel label="Cover-Bild">
        <ImageUpload value={form.cover_url} onChange={(v) => set("cover_url", v)} testId="album-cover" variant="wide" allowLibrary />
      </FieldLabel>
      <FormGrid>
        <SelectField label="Verknüpftes Event" value={form.event_id || ""} onChange={(v) => set("event_id", v)} options={[["", "— keines —"], ...events.map((e) => [e.id, e.name])]} testId="album-event" />
        <GermanDateField id="gallery-taken-at" label="Aufgenommen am" value={(form.taken_at || "").slice(0, 10)} onChange={(v) => set("taken_at", v)} testId="gallery-taken-at" />
        <SelectField label="Sichtbarkeit" value={form.visibility} onChange={(v) => set("visibility", v)} options={[["public", "Öffentlich"], ["community", "Community"], ["members", "Nur Mitglieder"]]} testId="album-visibility" />
        <TextField label="Sortierung" value={form.order_index} onChange={(v) => set("order_index", v)} testId="album-order" />
      </FormGrid>
      <CheckField label="Veröffentlicht" checked={form.published} onChange={(v) => set("published", v)} testId="album-published" />
    </AdminSheet>
  );
}

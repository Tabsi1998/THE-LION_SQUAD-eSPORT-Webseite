// Eintrag der Ausrüstung anlegen oder bearbeiten (#2218): Name, Bild über Upload oder Mediathek, Notiz; bei Aufsätzen die Waffen, zu
// denen er passt (ohne Wahl zu jeder). Die Kategorie steht beim Anlegen fest - umziehen hieße ein anderer Eintrag.
import { useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid } from "@/components/tls/AdminForm";
import { SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { equipmentPayload, equipmentToForm, matchesSearch, roleOf, ROLE_HINTS, statusOf } from "@/lib/loadoutBans";
import { toast } from "sonner";

function WeaponPicker({ weapons, value, onChange }) {
  const [search, setSearch] = useState("");
  const shown = weapons.filter((weapon) => matchesSearch(weapon, search));
  const toggle = (id) => onChange(value.includes(id) ? value.filter((key) => key !== id) : [...value, id]);
  return (
    <fieldset className="space-y-2" data-testid="equipment-weapons">
      <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">Passt zu</legend>
      <p className="text-xs text-white/60">
        {value.length ? `${value.length === 1 ? "1 Waffe" : `${value.length} Waffen`} gewählt.` : "Keine Waffe gewählt – der Aufsatz passt zu jeder Waffe."}
      </p>
      {weapons.length > 8 ? (
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Waffe suchen"
          aria-label="Waffe suchen" className="w-full rounded-sm border border-white/15 bg-[#0A0A0A] px-3 py-2 text-sm text-white placeholder:text-white/45 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]" />
      ) : null}
      {weapons.length ? (
        <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto pr-1">
          {shown.map((weapon) => {
            const on = value.includes(weapon.id);
            return (
              <label key={weapon.id} className={`inline-flex max-w-full cursor-pointer select-none items-center gap-2 rounded-sm border px-3 py-1.5 text-xs focus-within:outline focus-within:outline-1 focus-within:outline-[#29B6E8] ${on ? "border-[#29B6E8]/70 bg-[#29B6E8]/10 text-white" : "border-white/10 bg-[#0A0A0A] text-white/70 hover:border-white/25"}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(weapon.id)} className="accent-[#29B6E8]" />
                <span className="break-words">{weapon.name}{statusOf(weapon) !== "active" ? ` (${statusOf(weapon) === "inactive" ? "inaktiv" : "archiviert"})` : ""}</span>
              </label>
            );
          })}
        </div>
      ) : <p className="text-xs text-white/60">Noch keine Waffe angelegt.</p>}
    </fieldset>
  );
}

export function EquipmentItemSheet({ game, categories, items, item, initialCategory, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ ...equipmentToForm(item), category: item?.category || initialCategory || categories[0]?.key || "" }));
  const [saving, setSaving] = useState(false);
  const role = roleOf(categories, form.category);
  const weapons = useMemo(() => {
    const keys = new Set(categories.filter((row) => row.role === "weapon").map((row) => row.key));
    return items.filter((row) => keys.has(row.category) && (statusOf(row) !== "archived" || form.weapon_ids.includes(row.id)));
  }, [categories, items, form.weapon_ids]);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = equipmentPayload(form, role, { create: !item?.id });
      if (item?.id) await api.patch(`/games/${game.id}/equipment/${item.id}`, payload);
      else await api.post(`/games/${game.id}/equipment`, payload);
      toast.success(item?.id ? "Eintrag gespeichert." : "Eintrag angelegt.");
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      setSaving(false);
    }
  };

  return (
    <AdminSheet title={item?.id ? "Eintrag bearbeiten" : "Eintrag hinzufügen"} eyebrow={game.name} onClose={onClose} onSubmit={submit} saving={saving}
      submitTestId="equipment-save" testId="equipment-sheet" submitDisabled={!form.name.trim() || !form.category}>
      <FormGrid>
        <TextField label="Name" required maxLength={80} value={form.name} onChange={(value) => set("name", value)} placeholder="z. B. Blitz 9" testId="equipment-name" />
        {item?.id ? (
          <TextField label="Kategorie" value={categories.find((row) => row.key === form.category)?.label || ""} onChange={() => {}} disabled
            hint="Steht beim Anlegen fest." testId="equipment-category-fixed" />
        ) : (
          <SelectField label="Kategorie" value={form.category} onChange={(value) => set("category", value)}
            options={categories.map((row) => [row.key, row.label])} hint={ROLE_HINTS[role] || ""} testId="equipment-category" />
        )}
      </FormGrid>
      <ImageUpload value={form.image_url} onChange={(value) => set("image_url", value || "")} label="Bild (16 : 9)" testId="equipment-image" variant="wide" allowLibrary />
      {role === "attachment" ? <WeaponPicker weapons={weapons} value={form.weapon_ids} onChange={(value) => set("weapon_ids", value)} /> : null}
      <TextAreaField label="Notiz" rows={2} value={form.note} onChange={(value) => set("note", value)} placeholder="nur für die Verwaltung" testId="equipment-note" />
    </AdminSheet>
  );
}

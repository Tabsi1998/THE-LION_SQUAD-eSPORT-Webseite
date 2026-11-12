// Eintrag der Ausrüstung anlegen oder bearbeiten (#2218): Name, Bild über Upload oder Mediathek, Notiz; bei Aufsätzen die Waffen, zu
// denen er passt (ohne Wahl zu keiner). Die Kategorie steht beim Anlegen fest - umziehen hieße ein anderer Eintrag. Die Unterkategorie
// (#2287) lässt sich jederzeit ändern; ein Aufsatz passt zusätzlich zu ganzen Waffenklassen - eine neue Waffe der Klasse passt sofort.
import { useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid } from "@/components/tls/AdminForm";
import { SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { SubcategoryIcon } from "@/components/tls/league/LoadoutBansView";
import {
  countText, equipmentPayload, equipmentToForm, matchesSearch, NO_SUBCATEGORY, roleOf, ROLE_HINTS, statusOf, weaponClasses,
} from "@/lib/loadoutBans";
import { toast } from "sonner";
import { useReportDirty } from "./useReportDirty";

const CHIP = "inline-flex max-w-full cursor-pointer select-none items-center gap-2 rounded-sm border px-3 py-1.5 text-xs focus-within:outline focus-within:outline-1 focus-within:outline-[#29B6E8]";
const ON = "border-[#29B6E8]/70 bg-[#29B6E8]/10 text-white";
const OFF = "border-white/10 bg-[#0A0A0A] text-white/70 hover:border-white/25";

function fitsSummary(classCount, weaponCount) {
  const parts = [];
  if (classCount) parts.push(countText(classCount, "Waffenklasse", "Waffenklassen"));
  if (weaponCount) parts.push(countText(weaponCount, "Waffe", "Waffen"));
  return parts.length ? `Passt zu ${parts.join(" und ")}.` : "";
}

function WeaponPicker({ classes, weapons, value, classValue, onChange, onClassChange }) {
  const [search, setSearch] = useState("");
  const shown = weapons.filter((weapon) => matchesSearch(weapon, search));
  const toggle = (list, id) => (list.includes(id) ? list.filter((key) => key !== id) : [...list, id]);
  const summary = fitsSummary(classValue.length, value.length);
  return (
    <fieldset className="space-y-3" data-testid="equipment-weapons">
      <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">Passt zu</legend>
      <p className={`text-xs ${summary ? "text-white/60" : "font-semibold text-warn"}`} data-testid="equipment-weapons-count">
        {summary || "Keine Waffe gewählt – der Aufsatz passt dann zu keiner Waffe."}
      </p>
      {classes.length ? (
        <div className="space-y-1.5" data-testid="equipment-weapon-classes">
          <p className="text-xs text-white/60">Ganze Waffenklassen – neue Waffen der Klasse passen sofort.</p>
          <div className="flex flex-wrap gap-2">
            {classes.map((klass) => {
              const on = classValue.includes(klass.key);
              return (
                <label key={klass.key} className={`${CHIP} ${on ? ON : OFF}`}>
                  <input type="checkbox" checked={on} onChange={() => onClassChange(toggle(classValue, klass.key))} className="accent-[#29B6E8]" />
                  <SubcategoryIcon src={klass.icon_url} className="h-4 w-4" />
                  <span className="break-words">{klass.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="space-y-1.5">
        {classes.length ? <p className="text-xs text-white/60">Einzelne Waffen</p> : null}
        {weapons.length > 8 ? (
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Waffe suchen"
            aria-label="Waffe suchen" className="w-full rounded-sm border border-white/15 bg-[#0A0A0A] px-3 py-2 text-sm text-white placeholder:text-white/45 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]" />
        ) : null}
        {weapons.length ? (
          <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto pr-1">
            {shown.map((weapon) => {
              const on = value.includes(weapon.id);
              const viaClass = !on && weapon.subcategory && classValue.includes(weapon.subcategory);
              return (
                <label key={weapon.id} className={`${CHIP} ${on || viaClass ? ON : OFF}`}>
                  <input type="checkbox" checked={on || viaClass} disabled={viaClass} onChange={() => onChange(toggle(value, weapon.id))} className="accent-[#29B6E8]" />
                  <span className="break-words">
                    {weapon.name}{statusOf(weapon) !== "active" ? ` (${statusOf(weapon) === "inactive" ? "inaktiv" : "archiviert"})` : ""}
                    {viaClass ? <span className="text-white/50"> · über Klasse</span> : null}
                  </span>
                </label>
              );
            })}
          </div>
        ) : <p className="text-xs text-white/60">Noch keine Waffe angelegt.</p>}
      </div>
    </fieldset>
  );
}

export function EquipmentItemSheet({ game, categories, items, item, initialCategory, initialSubcategory = "", onClose, onSaved, onDirtyChange }) {
  const [initial] = useState(() => ({
    ...equipmentToForm(item), category: item?.category || initialCategory || categories[0]?.key || "",
    subcategory: item ? item.subcategory || "" : initialSubcategory || "",
  }));
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  useReportDirty(JSON.stringify(form) !== JSON.stringify(initial), onDirtyChange);
  const role = roleOf(categories, form.category);
  const category = categories.find((row) => row.key === form.category);
  const subs = category?.subcategories || [];
  const weapons = useMemo(() => {
    const keys = new Set(categories.filter((row) => row.role === "weapon").map((row) => row.key));
    return items.filter((row) => keys.has(row.category) && (statusOf(row) !== "archived" || form.weapon_ids.includes(row.id)));
  }, [categories, items, form.weapon_ids]);
  const classes = useMemo(() => weaponClasses(categories), [categories]);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  // Eine andere Kategorie (nur beim Anlegen): Die Unterkategorie gehört zur alten - zurück auf „ohne“.
  const setCategory = (value) => setForm((current) => ({ ...current, category: value, subcategory: "" }));

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
          <TextField label="Kategorie" value={category?.label || ""} onChange={() => {}} disabled
            hint="Steht beim Anlegen fest." testId="equipment-category-fixed" />
        ) : (
          <SelectField label="Kategorie" value={form.category} onChange={setCategory}
            options={categories.map((row) => [row.key, row.label])} hint={ROLE_HINTS[role] || ""} testId="equipment-category" />
        )}
        {subs.length ? (
          <SelectField label="Unterkategorie" value={form.subcategory} onChange={(value) => set("subcategory", value)}
            options={[["", NO_SUBCATEGORY], ...subs.map((row) => [row.key, row.label])]} hint="Lässt sich jederzeit ändern." testId="equipment-subcategory" />
        ) : null}
      </FormGrid>
      <ImageUpload value={form.image_url} onChange={(value) => set("image_url", value || "")} label="Bild (16 : 9)" testId="equipment-image" variant="wide" allowLibrary />
      {role === "attachment" ? (
        <WeaponPicker classes={classes} weapons={weapons} value={form.weapon_ids} classValue={form.weapon_class_ids}
          onChange={(value) => set("weapon_ids", value)} onClassChange={(value) => set("weapon_class_ids", value)} />
      ) : null}
      <TextAreaField label="Notiz" rows={2} value={form.note} onChange={(value) => set("note", value)} placeholder="nur für die Verwaltung" testId="equipment-note" />
    </AdminSheet>
  );
}

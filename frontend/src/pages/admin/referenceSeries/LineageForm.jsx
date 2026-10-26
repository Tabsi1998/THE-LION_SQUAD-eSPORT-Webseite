import { useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid } from "@/components/tls/AdminForm";
import { FieldLabel, SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { KIND_OPTIONS, VISIBILITY_OPTIONS, lineageToForm, lineagePayload, resultImageOptions } from "@/lib/referenceSeries";
import { gameOptionLabel } from "@/lib/gameLabels";
import { moveTier, tierOrderList } from "@/lib/seriesTiers";
import { organizerSuggestion } from "@/lib/seriesPartners";
import { profileOf } from "@/lib/seriesKinds";
import { SeriesPartnersField } from "./SeriesPartnersField";
import { SeriesLogoField } from "./SeriesLogoField";
import { ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "sonner";

// Spur (#1741): die Klammer über den Saisons, etwa eine Rennliga mit der Bezeichnung „F1“. Die Adresse entsteht aus dem
// Titel; wird er geändert, leitet die alte Adresse weiter.

export function LineageForm({ lineage, games = [], partners = [], profiles = null, onClose, onSaved }) {
  const isNew = !lineage?.id;
  const [form, setForm] = useState(() => lineageToForm(lineage || {}));
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const gameOptions = [["", "—"], ...games.map((game) => [game.id, gameOptionLabel(game)])];
  const imageOptions = resultImageOptions(form.kind, { value: form.result_image_template });
  // Art-Profil (#2024): Platzhalter je Art - eine Turnierserie zeigt keine Rennliga-Vorgabe.
  const placeholders = profileOf(profiles, form.kind)?.placeholders || {};
  // #1934: Partner mit Rolle; ist einer Veranstalter und das Feld „Veranstalter“ leer, steht sein Name als Vorschlag drin.
  const changePartners = (next) => setForm((current) => {
    const suggestion = organizerSuggestion(partners, next, current.organizer);
    return { ...current, ...next, ...(suggestion ? { organizer: suggestion } : {}) };
  });

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
      <TextField label="Titel" required value={form.title} onChange={(v) => set("title", v)} placeholder={placeholders.lineage_title || "Lion Racing F1"} testId="lineage-title" />
      <FormGrid>
        <SelectField label="Art" value={form.kind} onChange={(v) => set("kind", v)} options={KIND_OPTIONS} testId="lineage-kind" />
        <TextField label="Bezeichnung" value={form.label} onChange={(v) => set("label", v)} placeholder={placeholders.lineage_label || "F1, 4vs4 …"} testId="lineage-label" />
        <TextField label="Veranstalter" value={form.organizer} onChange={(v) => set("organizer", v)} testId="lineage-organizer" />
        <SelectField label="Spiel" value={form.game_id} onChange={(v) => set("game_id", v)} options={gameOptions} testId="lineage-game" />
        <TextField label="Seite des Veranstalters" value={form.external_url} onChange={(v) => set("external_url", v)} placeholder="https://…" testId="lineage-external-url" />
        <SelectField label="Sichtbarkeit" value={form.visibility} onChange={(v) => set("visibility", v)} options={VISIBILITY_OPTIONS} testId="lineage-visibility" />
        <TextField label="Adresse (Slug)" value={form.slug} onChange={(v) => set("slug", v)} placeholder="wird aus dem Titel gebildet" hint={isNew ? "" : "Die alte Adresse leitet weiter."} testId="lineage-slug" />
        <TextField label="Reihenfolge" type="number" value={form.order_index} onChange={(v) => set("order_index", Number(v) || 0)} testId="lineage-order" />
        {imageOptions.length > 0 && (
          <SelectField label="Vorlage für Ergebnis-Bilder" value={form.result_image_template} onChange={(v) => set("result_image_template", v)} options={imageOptions} testId="lineage-image-template"
            hint="So liest „Bild auslesen“ den Screenshot des Veranstalters. Eine Saison kann abweichen." />
        )}
      </FormGrid>
      <SeriesLogoField value={form.logo_url} onChange={(v) => set("logo_url", v)} testId="lineage-logo"
        hint="Am besten PNG mit durchsichtigem Hintergrund. Steht auf Serienseite, Runden, Referenzen, Profil und Partnerseite – ohne Logo das Spiel-Logo bzw. das Partner-Abzeichen. Jede Saison erbt es, eine Saison kann ein eigenes haben." />
      <SeriesPartnersField partners={partners} value={form} onChange={changePartners}
        hint="Veranstalter stehen mit Logo im Kopf der Serienseite, Mitwirkende darunter. Die Partnerseite zeigt die Spur unter „Ligen und Serien mit uns“." />
      <TextAreaField label="Beschreibung" value={form.description} onChange={(v) => set("description", v)} testId="lineage-description" />
      <TierOrderField tiers={(lineage?.series || []).map((item) => item.tier)} value={form.tier_order} onChange={(v) => set("tier_order", v)} />
    </AdminSheet>
  );
}

// Reihenfolge der Stufen (#1898): höchste zuerst. Vorgabe ist die Zahl im Namen („Liga 1“ vor „Liga 2“); wer etwas
// verschiebt, legt die Reihenfolge der Spur fest, „Vorgabe“ nimmt sie zurück. Liga-Weg und Vitrine nutzen sie, wenn eine
// Saison keinen eigenen Vermerk hat.
function TierOrderField({ tiers, value, onChange }) {
  const list = useMemo(() => tierOrderList(tiers, value), [tiers, value]);
  const custom = Array.isArray(value) && value.length > 0;
  const hint = list.length < 2
    ? "Sobald die Saisons mindestens zwei Stufen haben, lässt sich hier ihre Reihenfolge festlegen."
    : custom ? "Eigene Reihenfolge der Spur." : "Vorgabe aus der Zahl im Namen – verschieben legt eine eigene Reihenfolge fest.";
  return (
    <FieldLabel label="Reihenfolge der Stufen (höchste zuerst)" hint={hint}>
      {list.length > 0 && (
        <ol className="space-y-1" data-testid="lineage-tier-order">
          {list.map((tier, index) => (
            <li key={tier} className="flex items-center gap-2 border border-white/10 bg-[#0A0A0A] rounded-sm px-3 py-1.5 text-sm" data-testid={`lineage-tier-${index}`}>
              <span className="w-5 text-white/40 tabular-nums">{index + 1}.</span>
              <span className="flex-1 min-w-0 truncate">{tier}</span>
              <button type="button" onClick={() => onChange(moveTier(list, index, -1))} disabled={index === 0} aria-label={`${tier} höher`} data-testid={`lineage-tier-${index}-up`} className="p-1 text-white/50 hover:text-[#29B6E8] disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
              <button type="button" onClick={() => onChange(moveTier(list, index, 1))} disabled={index === list.length - 1} aria-label={`${tier} tiefer`} data-testid={`lineage-tier-${index}-down`} className="p-1 text-white/50 hover:text-[#29B6E8] disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
            </li>
          ))}
        </ol>
      )}
      {custom && (
        <button type="button" onClick={() => onChange(null)} data-testid="lineage-tier-reset" className="mt-2 text-xs uppercase tracking-wider font-bold text-[#29B6E8] hover:underline">Vorgabe aus den Namen</button>
      )}
    </FieldLabel>
  );
}

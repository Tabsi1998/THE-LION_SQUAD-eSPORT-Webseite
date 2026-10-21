import { useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid } from "@/components/tls/AdminForm";
import { SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { PUBLISH_OPTIONS, STATUS_OPTIONS, VISIBILITY_OPTIONS, WEEKDAY_OPTIONS, resultImageOptions, rulesToForm, seriesPayload, seriesToForm } from "@/lib/referenceSeries";
import { SEASON_RESULT_OPTIONS } from "@/lib/seriesTiers";
import { RulesFields } from "./RulesFields";
import { OwnTeamsField } from "./OwnTeamsField";
import { WeekendFormatsField } from "./WeekendFormatsField";
import { weekendPayload, weekendToForm } from "@/lib/raceWeekend";
import { toast } from "sonner";

// Saison einer Spur (#1741): Saison und Stufe ergeben die Adresse, die Vorlage füllt die Regeln vor (kopiert, nicht
// verknüpft). Ändert sich beim Bearbeiten eine Regel, rechnet der Server alle Stände neu und vermerkt den Hinweis.
// Rennliga (#1930): dazu „Läufe je Runde“ - der Ablauf eines Rennwochenendes, auch ab Runde X wechselnd.

export function SeriesForm({ series, lineage, schemes = [], defaultRules = {}, onClose, onSaved }) {
  const isNew = !series?.id;
  const archived = series?.status === "archived";
  const [form, setForm] = useState(() => seriesToForm({ ...(series || {}), lineage_id: lineage.id }, isNew ? defaultRules : series.rules));
  const [saving, setSaving] = useState(false);
  const [weekend, setWeekend] = useState(() => weekendToForm(series?.weekend));
  const racing = lineage.kind === "racing";
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const chooseScheme = (id) => {
    const scheme = schemes.find((item) => item.id === id);
    setForm((current) => ({ ...current, points_scheme_id: id, rules: rulesToForm(scheme ? scheme.rules : defaultRules) }));
  };
  const imageOptions = resultImageOptions(lineage.kind, { inherit: true, value: form.result_image_template || lineage.result_image_template });
  const schemeOptions = [
    ["", "Ohne Vorlage (Standard)"],
    ...schemes.filter((scheme) => !scheme.kinds?.length || scheme.kinds.includes(lineage.kind)).map((scheme) => [scheme.id, scheme.name]),
  ];

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = seriesPayload(form, { isNew, archived });
      if (racing) payload.weekend = weekendPayload(weekend);
      if (isNew) await api.post("/reference-series/admin/series", payload);
      else await api.patch(`/reference-series/admin/series/${series.id}`, payload);
      toast.success("Gespeichert.");
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminSheet title={isNew ? "Neue Saison" : "Saison bearbeiten"} eyebrow={lineage.title} size="lg" onClose={onClose} onSubmit={save} saving={saving} submitTestId="series-save" testId="series-sheet">
      {isNew && (
        <SelectField label="Punkteschema-Vorlage" value={form.points_scheme_id} onChange={chooseScheme} options={schemeOptions} testId="series-scheme"
          hint="Die Regeln werden kopiert – eine spätere Änderung der Vorlage ändert diese Saison nicht." />
      )}
      <FormGrid>
        <TextField label="Saison" required value={form.season} onChange={(v) => set("season", v)} placeholder="2026" testId="series-season" />
        <TextField label="Stufe" value={form.tier} onChange={(v) => set("tier", v)} placeholder="Division 1" hint="Ligastufe, falls es mehrere gibt." testId="series-tier" />
      </FormGrid>
      <TextField label="Eigener Titel" value={form.title} onChange={(v) => set("title", v)} hint="Leer: der Titel der Spur." testId="series-title" />
      <FormGrid>
        {!archived && <SelectField label="Status" value={form.status} onChange={(v) => set("status", v)} options={STATUS_OPTIONS} testId="series-status" />}
        <SelectField label="Einträge eines Captains" value={form.publish_mode} onChange={(v) => set("publish_mode", v)} options={PUBLISH_OPTIONS} testId="series-publish-mode" />
        <SelectField label="Standard-Wochentag" value={form.default_weekday} onChange={(v) => set("default_weekday", v)} options={WEEKDAY_OPTIONS} testId="series-weekday" />
        <TextField label="Standard-Uhrzeit" type="time" value={form.default_time} onChange={(v) => set("default_time", v)} hint="Wiener Zeit." testId="series-time" />
        <SelectField label="Sichtbarkeit" value={form.visibility} onChange={(v) => set("visibility", v)} options={VISIBILITY_OPTIONS} testId="series-visibility" />
        <SelectField label="Ergebnis der Saison" value={form.season_result} onChange={(v) => set("season_result", v)} options={SEASON_RESULT_OPTIONS} testId="series-season-result"
          hint="Leer: der Liga-Weg leitet Auf- und Abstieg aus den Stufen ab." />
        <TextField label="Offizielle Tabelle" value={form.official_table_url} onChange={(v) => set("official_table_url", v)} placeholder="https://…" testId="series-official-url" />
        <TextField label="Seite des Veranstalters" value={form.external_url} onChange={(v) => set("external_url", v)} placeholder="https://…" testId="series-external-url" />
        {imageOptions.length > 0 && (
          <SelectField label="Vorlage für Ergebnis-Bilder" value={form.result_image_template} onChange={(v) => set("result_image_template", v)} options={imageOptions} testId="series-image-template"
            hint="Nur, wenn der Veranstalter in dieser Saison anders aussieht als bei der Spur." />
        )}
      </FormGrid>
      <OwnTeamsField teams={form.own_teams} onChange={(teams) => set("own_teams", teams)} />
      <TextAreaField label="Beschreibung" value={form.description} onChange={(v) => set("description", v)} testId="series-description" />
      <RulesFields rules={form.rules} kind={lineage.kind} onChange={(rules) => set("rules", rules)} />
      {racing && <WeekendFormatsField formats={weekend} onChange={setWeekend} />}
      {!isNew && (
        <TextField label="Hinweis zur Regeländerung" value={form.rules_note} onChange={(v) => set("rules_note", v)} testId="series-rules-note"
          hint="Nur wenn sich eine Regel ändert: steht bei der Saison und im Protokoll; alle Stände werden neu gerechnet." />
      )}
    </AdminSheet>
  );
}

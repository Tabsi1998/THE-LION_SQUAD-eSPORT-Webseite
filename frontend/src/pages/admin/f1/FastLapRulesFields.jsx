// Meisterschaft und Stream einer Fast Lap (#2130): dieselben Felder beim Anlegen und im Bearbeiten.
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, SelectField, TextField } from "@/components/tls/FormFields";
import { STREAM_ADDRESS_HINT } from "@/lib/tournamentStream";
import { STREAM_PLATFORM_OPTIONS } from "../tournament/shared";

export function FastLapChampionshipFields({ form, set, prefix }) {
  return (
    <>
      <CheckField label="Meisterschaft (mehrere Strecken, Punkte je Platz, Gesamtwertung)" checked={form.is_championship} onChange={(v) => set("is_championship", v)} testId={`${prefix}-championship`} />
      {form.is_championship && (
        <TextField
          label="Punkte je Platz"
          hint="Platz 1 zuerst, durch Komma getrennt. Plätze dahinter bekommen 0 Punkte."
          value={form.points_text}
          onChange={(v) => set("points_text", v)}
          testId={`${prefix}-points`}
        />
      )}
    </>
  );
}

export function FastLapStreamFields({ form, set, prefix }) {
  return (
    <FormSection title="Stream" accent="#9146FF" hint="Wird auf der öffentlichen Seite eingebettet, wenn der Haken gesetzt ist.">
      <FormGrid>
        <SelectField label="Plattform" value={form.stream_platform} onChange={(v) => set("stream_platform", v)} options={STREAM_PLATFORM_OPTIONS} testId={`${prefix}-stream-platform`} />
        <TextField label="Kanal oder Adresse" value={form.stream_address} onChange={(v) => set("stream_address", v)} placeholder={STREAM_ADDRESS_HINT[form.stream_platform] || STREAM_ADDRESS_HINT[""]} testId={`${prefix}-stream-url`} />
      </FormGrid>
      <CheckField label="Stream auf der Seite der Challenge zeigen" checked={form.stream_embed} onChange={(v) => set("stream_embed", v)} testId={`${prefix}-stream-embed`} accent="#9146FF" />
    </FormSection>
  );
}

import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { ENTRY_POLICY_OPTIONS, waitingLine } from "@/lib/leagueApplications";

// Selbstanmeldung je Season (docs/LIGA.md, B.4, #2205): Alles sind Vorgaben, nichts ist fest. Ohne Beginn und Ende gibt es keine Selbstanmeldung, und alles bleibt wie vorher.

function Toggle({ label, hint, checked, onChange, testId }) {
  return (
    <label className="flex min-h-[44px] items-start gap-2 text-sm text-white/80">
      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} className="mt-1 accent-[#29B6E8]" data-testid={testId} />
      <span className="min-w-0">
        <span className="block">{label}</span>
        {hint ? <span className="block text-xs text-white/50">{hint}</span> : null}
      </span>
    </label>
  );
}

// ``waiting``: offene Anmeldungen (eingereicht, in Prüfung). Beim Einschalten von „automatisch annehmen“ (#2348) bleiben sie bei der Leitung.
export function SeasonApplicationSection({ form, set, id, deadlineField = null, waiting = 0 }) {
  const waitingText = form.application_auto_accept ? waitingLine(waiting) : "";
  return (
    <FormSection title="Selbstanmeldung" testId="season-application-settings" id={id} className="scroll-mt-24"
      hint="Captains und Vertreter melden ihr Co-Team auf der Ligaseite an, die Leitung entscheidet oder die Season nimmt automatisch an. Ohne Beginn und Ende gibt es das nicht: Dann teilst du wie bisher in der Turnierverwaltung zu. Für die Anmeldung braucht es ein gültiges Regelwerk.">
      <FormGrid cols={2}>
        <TextField label="Anmeldung ab" type="datetime-local" value={form.application_opens} onChange={(value) => set("application_opens", value)} hint="Wiener Zeit" testId="season-form-application-opens" />
        <TextField label="Anmeldung bis" type="datetime-local" value={form.application_closes} onChange={(value) => set("application_closes", value)} hint="Wiener Zeit" testId="season-form-application-closes" />
      </FormGrid>
      {deadlineField}
      <FormGrid cols={3}>
        <TextField label="Startplätze" type="number" min={1} max={500} value={form.application_slots} onChange={(value) => set("application_slots", value)} hint="leer: keine Grenze außer der Staffelgröße" testId="season-form-application-slots" />
        <TextField label="Warteliste höchstens" type="number" min={1} max={500} value={form.application_waitlist_limit} onChange={(value) => set("application_waitlist_limit", value)} hint="leer: keine Grenze" testId="season-form-application-waitlist-limit" />
        <SelectField label="Wer darf sich anmelden" value={form.entry_policy} onChange={(value) => set("entry_policy", value)} options={ENTRY_POLICY_OPTIONS}
          hint="Bei „Nur Vereinsmitglieder“ gilt das für den ganzen Kader." testId="season-form-entry-policy" />
      </FormGrid>
      {form.entry_policy === "all" && form.visibility === "members" ? (
        <p className="text-xs text-warn" data-testid="season-form-application-visibility-hint">Die Sichtbarkeit steht auf „Nur Mitglieder“: Externe Konten sehen die Season nicht und können sich nicht anmelden.</p>
      ) : null}
      <Toggle label="Anmeldungen automatisch annehmen"
        hint="Eine gültige Anmeldung ist sofort angenommen und belegt einen Startplatz. Wer zuerst kommt, wird zuerst bedient: Anmeldungen, die noch auf deine Prüfung warten, halten ihren Platz. Sind alle vergeben oder wartet schon jemand, kommt sie auf die Warteliste. Gibt es nur eine Staffel, ist das Co-Team gleich zugeteilt. Du kannst nachträglich mit Grund ablehnen. Aus: Du prüfst jede Anmeldung."
        checked={form.application_auto_accept} onChange={(value) => set("application_auto_accept", value)} testId="season-form-application-auto-accept" />
      {waitingText ? (
        <p className="text-xs text-warn" data-testid="season-form-application-auto-waiting">{waitingText}. Entscheide sie im Eingang.</p>
      ) : null}
      <Toggle label="Warteliste" hint="Sind alle Startplätze vergeben, kann die Leitung Anmeldungen auf die Warteliste setzen. Ohne Warteliste endet die Anmeldung, sobald alle Plätze weg sind. Niemand rückt von selbst nach."
        checked={form.application_waitlist} onChange={(value) => set("application_waitlist", value)} testId="season-form-application-waitlist" />
      <TextAreaField label="Regel zur Warteliste" rows={2} value={form.application_waitlist_note} onChange={(value) => set("application_waitlist_note", value)} hint="Steht öffentlich auf der Ligaseite, z. B. nach welcher Reihenfolge die Leitung entscheidet." testId="season-form-application-waitlist-note" />
      <Toggle label="Zwei Co-Teams eines Hauptteams in derselben Staffel" hint="Vorgabe: Nein. Gilt auch fürs Zuteilen in der Turnierverwaltung. Ein Co-Team bleibt je Season in einer Staffel."
        checked={form.sibling_squads_in_staffel} onChange={(value) => set("sibling_squads_in_staffel", value)} testId="season-form-sibling-squads" />
      <TextAreaField label="Hinweis zum Datenschutz" rows={3} value={form.application_privacy_text} onChange={(value) => set("application_privacy_text", value)}
        hint="Steht bei der Anmeldung über dem Link zur Datenschutzerklärung und wird mit der Zustimmung gespeichert. Leer: ein vorläufiger Platzhalter-Satz. Den Wortlaut gibt der Obmann frei." testId="season-form-application-privacy" />
    </FormSection>
  );
}

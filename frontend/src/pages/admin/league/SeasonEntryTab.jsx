// Reiter „Anmeldung und Kader“ der Season-Seite (#2267): Selbstanmeldung (B.4) und Kader samt Spielberechtigung (B.3) als ein Formular,
// darunter der Eingang der Anmeldungen (#anmeldungen, die Marke aus den Nachrichten des Servers) und die Kaderübersicht (#kader).
// Plattform je Season (#2270, #plattform): ein weiterer Abschnitt im Formular, gespeichert mit dem Reiter.
import { FormSection } from "@/components/tls/AdminForm";
import { TextField } from "@/components/tls/FormFields";
import { SeasonApplicationSection } from "./SeasonApplicationSection";
import { SeasonApplicationsPanel } from "./SeasonApplicationsPanel";
import { SeasonEligibilitySection } from "./SeasonEligibilitySection";
import { SeasonPlatformSection } from "./SeasonPlatformSection";
import { SeasonRosterPanel } from "./SeasonRosterPanel";
import { SeasonTabForm } from "./SeasonTabForm";

const JUMPS = [["selbstanmeldung", "Selbstanmeldung"], ["spielberechtigung", "Kader und Spielberechtigung"], ["plattform", "Plattform"], ["anmeldungen", "Eingang"], ["kader", "Kaderübersicht"]];

export function SeasonEntryTab({ seasonId, season, form, set, canSeason, canApplications, canRoster, formProps, onJump }) {
  const hasWindow = Boolean(form.application_opens || form.application_closes);
  // Meldeschluss (nur Anzeige) und Anmeldefenster sagten dasselbe zweimal: Mit Fenster gilt „Anmeldung bis“; ein schon gesetzter
  // Meldeschluss bleibt sichtbar, damit er sich leeren lässt.
  const deadline = !hasWindow || form.registration_deadline ? (
    <TextField label="Meldeschluss (nur Anzeige)" type="date" value={form.registration_deadline} onChange={(value) => set("registration_deadline", value)}
      hint={hasWindow ? "Mit Anmeldefenster gilt „Anmeldung bis“ – das Feld kann leer bleiben." : "Steht auf der Ligaseite, solange es keine Selbstanmeldung gibt."}
      testId="season-form-deadline" className="max-w-xs" />
  ) : null;
  const jumps = JUMPS.filter(([key]) => (key === "anmeldungen" ? canApplications : key === "kader" ? canRoster : canSeason));
  return (
    <div className="space-y-6">
      {jumps.length > 1 ? (
        <nav aria-label="Abschnitte" className="flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid="season-entry-jumps">
          {jumps.map(([key, label]) => (
            <button key={key} type="button" onClick={() => onJump(key)} className="min-h-[32px] font-bold text-[#29B6E8] underline-offset-2 hover:text-white hover:underline">{label}</button>
          ))}
        </nav>
      ) : null}
      {canSeason ? (
        <SeasonTabForm {...formProps}>
          <SeasonApplicationSection form={form} set={set} id="selbstanmeldung" deadlineField={deadline} />
          <SeasonEligibilitySection form={form} set={set} id="spielberechtigung" />
          <SeasonPlatformSection seasonId={seasonId} form={form} set={set} id="plattform" version={season.updated_at} />
        </SeasonTabForm>
      ) : null}
      {canApplications ? <SeasonApplicationsPanel seasonId={seasonId} version={season.updated_at} /> : null}
      {canRoster ? <div id="kader" className="scroll-mt-24"><SeasonRosterPanel seasonId={seasonId} /></div> : null}
      {!canSeason && !canApplications && !canRoster ? (
        <FormSection title="Anmeldung und Kader"><p className="text-sm text-white/60">Dafür fehlt dir die Zuständigkeit in dieser Liga.</p></FormSection>
      ) : null}
    </div>
  );
}

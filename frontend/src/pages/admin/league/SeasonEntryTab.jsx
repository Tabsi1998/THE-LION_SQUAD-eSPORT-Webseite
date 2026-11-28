// Reiter „Anmeldung und Kader“ der Season-Seite (#2267): Selbstanmeldung (B.4) und Kader samt Spielberechtigung (B.3) als ein Formular,
// darunter der Eingang der Anmeldungen (#anmeldungen, die Marke aus den Nachrichten des Servers) und die Kaderübersicht (#kader).
// Plattform je Season (#2270, #plattform): ein weiterer Abschnitt im Formular, gespeichert mit dem Reiter.
// Staffeln auslosen (#1623, #auslosung): gleich unter dem Eingang - Los auf mehrere Staffeln einer Liga N und die Platzprüfung.
// Nachmeldungen (#2422, #nachmeldungen): unter dem Eingang - Spiele für Teams, die nach dem Start in eine Staffel kamen.
// Startrechte (#1627, F.2a, #startrechte): zwischen Eingang und Los - wer aus der Vorgänger-Season zugesagt hat, kommt ins Los.
import { FormSection } from "@/components/tls/AdminForm";
import { TextField } from "@/components/tls/FormFields";
import { SeasonApplicationSection } from "./SeasonApplicationSection";
import { SeasonApplicationsPanel } from "./SeasonApplicationsPanel";
import { SeasonDrawPanel } from "./SeasonDrawPanel";
import { SeasonEligibilitySection } from "./SeasonEligibilitySection";
import { SeasonLateEntriesPanel } from "./SeasonLateEntriesPanel";
import { SeasonPlatformSection } from "./SeasonPlatformSection";
import { SeasonRosterPanel } from "./SeasonRosterPanel";
import { SeasonStartRightsPanel } from "./SeasonStartRightsPanel";
import { SeasonTabForm } from "./SeasonTabForm";
import { SOLO_TEAM_PANELS_FOLLOW } from "@/lib/leagueParticipants";

const JUMPS = [["selbstanmeldung", "Selbstanmeldung"], ["spielberechtigung", "Kader und Spielberechtigung"], ["plattform", "Plattform"], ["anmeldungen", "Eingang"],
  ["startrechte", "Startrechte"], ["auslosung", "Staffeln auslosen"], ["nachmeldungen", "Nachmeldungen"], ["kader", "Kaderübersicht"]];

// Solo-Liga (#1629): Seit P2 melden sich Spieler selbst an - Selbstanmeldung und Eingang wie bei Co-Teams. Startrechte, Los, Nachmeldungen
// und die Kaderübersicht rechnen mit Co-Teams und folgen (P3, P4); der Reiter sagt das in einem Satz unter dem Eingang.
const SOLO_JUMPS = new Set(["selbstanmeldung", "spielberechtigung", "plattform", "anmeldungen"]);

export function SeasonEntryTab({ seasonId, season, form, set, canSeason, canApplications, canRoster, formProps, onJump, applicationsWaiting = 0,
  lateRegistration = null, onReload = null, solo = false }) {
  const hasWindow = Boolean(form.application_opens || form.application_closes);
  // Meldeschluss (nur Anzeige) und Anmeldefenster sagten dasselbe zweimal: Mit Fenster gilt „Anmeldung bis“; ein schon gesetzter
  // Meldeschluss bleibt sichtbar, damit er sich leeren lässt.
  const deadline = !hasWindow || form.registration_deadline ? (
    <TextField label="Meldeschluss (nur Anzeige)" type="date" value={form.registration_deadline} onChange={(value) => set("registration_deadline", value)}
      hint={hasWindow ? "Mit Anmeldefenster gilt „Anmeldung bis“ – das Feld kann leer bleiben." : "Steht auf der Ligaseite, solange es keine Selbstanmeldung gibt."}
      testId="season-form-deadline" className="max-w-xs" />
  ) : null;
  const jumps = JUMPS.filter(([key]) => (solo && !SOLO_JUMPS.has(key) ? false
    : key === "anmeldungen" || key === "auslosung" || key === "nachmeldungen" ? canApplications
      : key === "kader" ? canRoster : key === "startrechte" ? canSeason || canApplications : canSeason));
  // Startrechte, Los, Nachmeldungen und Kaderübersicht rechnen mit Co-Teams - in der Solo-Liga folgen sie (P3, P4).
  const teamPanels = !solo;
  return (
    <div className="space-y-6">
      {jumps.length > 1 ? (
        <nav aria-label="Abschnitte" className="flex flex-wrap gap-x-4 gap-y-1 tls-type-small" data-testid="season-entry-jumps">
          {jumps.map(([key, label]) => (
            <button key={key} type="button" onClick={() => onJump(key)} className="min-h-[32px] font-bold text-[#29B6E8] underline-offset-2 hover:text-white hover:underline">{label}</button>
          ))}
        </nav>
      ) : null}
      {canSeason ? (
        <SeasonTabForm {...formProps}>
          <SeasonApplicationSection form={form} set={set} id="selbstanmeldung" deadlineField={deadline} waiting={applicationsWaiting}
            late={lateRegistration} seasonId={seasonId} onReload={onReload} season={season} solo={solo} />
          <SeasonEligibilitySection form={form} set={set} id="spielberechtigung" solo={solo} />
          <SeasonPlatformSection seasonId={seasonId} form={form} set={set} id="plattform" version={season.updated_at} />
        </SeasonTabForm>
      ) : null}
      {canApplications ? <SeasonApplicationsPanel seasonId={seasonId} version={season.updated_at} seasonStatus={season.status} /> : null}
      {solo && (canApplications || canRoster) ? (
        <p className="tls-type-small text-white/60" data-testid="season-solo-entry-follows">{SOLO_TEAM_PANELS_FOLLOW}</p>
      ) : null}
      {teamPanels && (canSeason || canApplications) ? <SeasonStartRightsPanel seasonId={seasonId} canSeason={canSeason} canApplications={canApplications} version={season.updated_at} /> : null}
      {teamPanels && canApplications ? <SeasonDrawPanel seasonId={seasonId} version={season.updated_at} /> : null}
      {teamPanels && canApplications ? <SeasonLateEntriesPanel seasonId={seasonId} version={season.updated_at} /> : null}
      {teamPanels && canRoster ? <div id="kader" className="scroll-mt-24"><SeasonRosterPanel seasonId={seasonId} /></div> : null}
      {!canSeason && !canApplications && !canRoster ? (
        <FormSection title="Anmeldung und Kader"><p className="tls-type-small text-white/60">Dafür fehlt dir die Zuständigkeit in dieser Liga.</p></FormSection>
      ) : null}
    </div>
  );
}

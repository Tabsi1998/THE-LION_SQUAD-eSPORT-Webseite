import { CheckField, SelectField, TextField } from "@/components/tls/FormFields";
import { GuestBadge } from "@/components/tls/league/GuestBadge";

// Gastteam (#1665, Entscheidungen Nr. 286 und C vom 27.11.) im Bearbeiten-Blatt: Die Teamleitung eines Liga-Teams gibt an, für welchen Verein
// oder welche Schule das Team als Gast spielt, und ob der Name einer Schule öffentlich stehen darf. Das Kennzeichen „Gast“ setzt die
// Liga-Leitung bei der Anmeldung - nie die Teamleitung selbst und nie aus der Mitgliedschaft. Die Felder gehören zum Formular des Blatts:
// Dasselbe „Speichern“ nimmt sie mit (``guestChanges`` / ``guestPayload``), beim Schließen geht nichts verloren, was gespeichert schien.
const KIND_OPTIONS = [["", "Kein Verein und keine Schule"], ["club", "Verein"], ["school", "Schule"]];
export const NAME_MAX = 80;

export function guestStatusLine(info) {
  if (!info?.confirmed) {
    return info?.kind ? "Wartet auf die Liga-Leitung: Sie bestätigt das Kennzeichen bei eurer Anmeldung." : "";
  }
  if (info.pending) return "Geändert: Bis die Liga-Leitung neu bestätigt, steht bei euch nur „Gast“.";
  return "Die Liga-Leitung hat euch als Gastteam bestätigt. So steht ihr in den Ligen:";
}

/** Der Stand der Felder aus der Antwort des Servers. */
export function guestForm(info) {
  return { kind: info?.kind || "", name: info?.name || "", school_name_public: Boolean(info?.school_name_public) };
}

/** Was der Server bekommt - nur Art, Name und bei einer Schule die Freigabe. */
export function guestPayload(form) {
  const kind = form.kind || null;
  return { kind, name: kind ? form.name.trim() || null : null, school_name_public: kind === "school" && Boolean(form.school_name_public) };
}

/** Hat sich gegenüber dem gespeicherten Stand etwas geändert? Sonst schickt „Speichern“ hier nichts. */
export function guestChanges(form, info) {
  return JSON.stringify(guestPayload(form)) !== JSON.stringify(guestPayload(guestForm(info)));
}

export function TeamGuestSection({ info, value, onChange }) {
  const set = (key, next) => onChange({ ...value, [key]: next });
  const status = guestStatusLine(info);
  return (
    <section className="border border-white/10 bg-[#0A0A0A] rounded-sm p-4 space-y-3" data-testid="team-guest-section" aria-labelledby="team-guest-title">
      <h3 id="team-guest-title" className="font-bold text-white">Gastteam in der Liga</h3>
      <p className="text-sm text-white/65">
        Spielt ihr als Gast für einen anderen Verein oder eine Schule? Dann gebt ihn hier an. Das Kennzeichen „Gast“ setzt die
        Liga-Leitung, wenn sie eure Anmeldung freigibt.
      </p>
      {status ? (
        <div className="space-y-2 text-sm text-white/80" data-testid="team-guest-status">
          <p>{status}</p>
          {info?.badge && !info.pending ? <GuestBadge badge={info.badge} testId="team-guest-preview" /> : null}
        </div>
      ) : null}
      <SelectField label="Wir spielen als Gast für" value={value.kind} onChange={(next) => set("kind", next)} options={KIND_OPTIONS}
        testId="team-guest-kind" />
      {value.kind ? (
        <TextField label={value.kind === "school" ? "Name der Schule" : "Name des Vereins"} value={value.name} onChange={(next) => set("name", next)}
          maxLength={NAME_MAX} testId="team-guest-name" hint="So, wie er in Tabellen und auf der Teamseite stehen soll. Gespeichert wird mit „Speichern“ unten." />
      ) : null}
      {value.kind === "school" ? (
        <CheckField label="Den Namen der Schule öffentlich zeigen" checked={value.school_name_public} onChange={(next) => set("school_name_public", next)}
          testId="team-guest-school-public"
          hint="Ohne Haken steht in den Ligen nur „Gast“. Den Namen sehen dann nur ihr und die Liga-Leitung. In Schulteams spielen oft Minderjährige – klärt das vorher mit der Schule." />
      ) : null}
    </section>
  );
}

export default TeamGuestSection;

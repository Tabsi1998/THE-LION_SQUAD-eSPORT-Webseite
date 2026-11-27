import { useState } from "react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { AuthFormAlert } from "@/components/tls/AuthFormFields";
import { CheckField, SelectField, TextField } from "@/components/tls/FormFields";
import { GuestBadge } from "@/components/tls/league/GuestBadge";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";

// Gastteam (#1665, Entscheidung Nr. 286) im Bearbeiten-Blatt: Die Teamleitung gibt an, für welchen Verein oder welche Schule das Team
// als Gast spielt, und ob der Name einer Schule öffentlich stehen darf. Das Kennzeichen „Gast“ setzt die Liga-Leitung bei der Anmeldung -
// nie die Teamleitung selbst und nie aus der Mitgliedschaft. Eigener Knopf, eigenes Speichern: wie „Team auflösen“ unabhängig vom Formular.
const KIND_OPTIONS = [["", "Kein Verein und keine Schule"], ["club", "Verein"], ["school", "Schule"]];
export const NAME_MAX = 80;

export function guestStatusLine(info) {
  if (!info?.confirmed) {
    return info?.kind ? "Wartet auf die Liga-Leitung: Sie bestätigt das Kennzeichen bei eurer Anmeldung." : "";
  }
  if (info.pending) return "Geändert: Bis die Liga-Leitung neu bestätigt, steht bei euch nur „Gast“.";
  return "Die Liga-Leitung hat euch als Gastteam bestätigt. So steht ihr in den Ligen:";
}

export function TeamGuestSection({ team, onSaved }) {
  const info = team.guest_team || null;
  const [kind, setKind] = useState(info?.kind || "");
  const [name, setName] = useState(info?.name || "");
  const [schoolPublic, setSchoolPublic] = useState(Boolean(info?.school_name_public));
  const [saved, setSaved] = useState(info);
  const [error, setError] = useState("");
  const { submitting, submitOnce } = useSubmissionGuard();

  const save = async () => {
    setError("");
    const attempt = await submitOnce(async () => {
      const { data } = await api.put(`/teams/${team.id}/guest-team`, {
        kind: kind || null, name: kind ? name.trim() || null : null, school_name_public: kind === "school" && schoolPublic,
      });
      setSaved(data.guest_team || null);
      toast.success("Angaben zum Gastteam gespeichert.");
      onSaved?.();
    });
    if (attempt.started && attempt.error) setError(formatRequestError(attempt.error, "Die Angaben ließen sich nicht speichern."));
  };

  const status = guestStatusLine(saved);
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
          {saved?.badge && !saved.pending ? <GuestBadge badge={saved.badge} testId="team-guest-preview" /> : null}
        </div>
      ) : null}
      <SelectField label="Wir spielen als Gast für" value={kind} onChange={(value) => { setKind(value); setError(""); }} options={KIND_OPTIONS}
        testId="team-guest-kind" />
      {kind ? (
        <TextField label={kind === "school" ? "Name der Schule" : "Name des Vereins"} value={name} onChange={(value) => { setName(value); setError(""); }}
          maxLength={NAME_MAX} testId="team-guest-name" hint="So, wie er in Tabellen und auf der Teamseite stehen soll." />
      ) : null}
      {kind === "school" ? (
        <CheckField label="Den Namen der Schule öffentlich zeigen" checked={schoolPublic} onChange={setSchoolPublic} testId="team-guest-school-public"
          hint="Ohne Haken steht in den Ligen nur „Gast“. Den Namen sehen dann nur ihr und die Liga-Leitung. In Schulteams spielen oft Minderjährige – klärt das vorher mit der Schule." />
      ) : null}
      {error ? <AuthFormAlert id="team-guest-error">{error}</AuthFormAlert> : null}
      <button type="button" onClick={save} disabled={submitting} data-testid="team-guest-save"
        className="tls-btn tls-btn--secondary inline-flex items-center gap-2 px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50">
        {submitting ? "Speichere…" : "Angaben speichern"}
      </button>
    </section>
  );
}

export default TeamGuestSection;

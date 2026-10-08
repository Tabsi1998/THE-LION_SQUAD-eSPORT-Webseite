// Turnier-Bearbeitung (#223): Teilnehmer von Hand hinzufügen. Konten kommen seit #1354 aus der Personensuche (Name und
// Bild, keine E-Mail-Adressen), Teams aus einer eigenen kleinen Auswahl - fehlt dafür ein Recht, steht ein Satz da.
import { REGISTRATION_STATUS_OPTIONS } from "@/lib/tournamentLabels";
import { PersonPicker } from "@/components/tls/PersonPicker";
import { Fld } from "./PrizeEditor";
import { SelectField } from "./TournamentEditForm";

export function ParticipantAddForm({ form, tournament, person = null, onPerson, teams, teamsError = "", noShowRegistrations, onChange, onSubmit }) {
  const isTeamTournament = (tournament?.team_mode || "solo") !== "solo";
  const teamOptions = [
    ["", "— Team auswählen —"],
    ...(teams || []).map((team) => [team.id, team.tag ? `[${team.tag}] ${team.name}` : team.name]),
  ];
  const replaceOptions = [
    ["", "Kein Ersatz"],
    ...(noShowRegistrations || []).map((r) => [r.id, r.display_name || r.ingame_name || r.user?.display_name || r.id]),
  ];
  return (
    <form onSubmit={onSubmit} className="border border-white/10 rounded-sm bg-[#121212] p-5 space-y-3" data-testid="participant-add-form">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">{isTeamTournament ? "Team hinzufügen" : "Teilnehmer hinzufügen"}</div>
          <div className="text-xs text-white/45 mt-1">{isTeamTournament ? "Bei Team-Turnieren zählt jedes Team als Startplatz." : "Konto suchen und wählen. Ohne Konto bleibt es ein manueller Gast – dann reicht der Anzeigename."}</div>
        </div>
        <button type="submit" data-testid="participant-add-submit" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs">Hinzufügen</button>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        {isTeamTournament ? (
          teamsError ? (
            <div className="min-w-0" data-testid="participant-add-teams-error">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Team</div>
              <p className="text-xs text-white/55 border border-white/10 rounded-sm px-3 py-2">{teamsError}</p>
            </div>
          ) : (
            <SelectField label="Team" value={form.team_id} onChange={(v)=>onChange("team_id", v)} options={teamOptions} testId="participant-add-team" />
          )
        ) : (
          <PersonPicker purpose="tournament" contextId={tournament?.id} value={person} onChange={onPerson} label="Konto (leer = manueller Gast)" placeholder="Name tippen …" testId="participant-add-user" />
        )}
        <Fld label="Anzeigename" value={form.display_name} onChange={(v)=>onChange("display_name", v)} testId="participant-add-display" />
        <Fld label="Spielname" value={form.ingame_name} onChange={(v)=>onChange("ingame_name", v)} testId="participant-add-ingame" />
        <Fld label="Discord" value={form.discord} onChange={(v)=>onChange("discord", v)} testId="participant-add-discord" />
        <SelectField label="Status" value={form.status} onChange={(v)=>onChange("status", v)} options={REGISTRATION_STATUS_OPTIONS} />
        <Fld label="Setzplatz" type="number" value={form.seed} onChange={(v)=>onChange("seed", v)} testId="participant-add-seed" />
        <SelectField label="Ersetzt Nicht-Erschienen" value={form.replace_registration_id} onChange={(v)=>onChange("replace_registration_id", v)} options={replaceOptions} />
      </div>
    </form>
  );
}

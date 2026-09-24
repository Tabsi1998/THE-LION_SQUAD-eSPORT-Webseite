// Turnier-Bearbeitung (#223): Teilnehmer von Hand hinzufügen.
import { REGISTRATION_STATUS_OPTIONS } from "@/lib/tournamentLabels";
import { Fld } from "./PrizeEditor";
import { SelectField } from "./TournamentEditForm";

export function ParticipantAddForm({ form, tournament, users, teams, noShowRegistrations, onChange, onSubmit }) {
  const isTeamTournament = (tournament?.team_mode || "solo") !== "solo";
  const userOptions = [
    ["", "Manueller Gast / kein Konto"],
    ...(users || []).map((u) => [u.id, `${u.display_name || u.username || u.email}${u.email ? ` · ${u.email}` : ""}`]),
  ];
  const teamOptions = [
    ["", "— Team auswählen —"],
    ...(teams || []).map((team) => [team.id, `[${team.tag}] ${team.name}`]),
  ];
  const replaceOptions = [
    ["", "Kein Ersatz"],
    ...(noShowRegistrations || []).map((r) => [r.id, r.display_name || r.ingame_name || r.user?.display_name || r.id]),
  ];
  return (
    <form onSubmit={onSubmit} className="border border-white/10 rounded-sm bg-[#121212] p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">{isTeamTournament ? "Team hinzufügen" : "Teilnehmer hinzufügen"}</div>
          <div className="text-xs text-white/45 mt-1">{isTeamTournament ? "Bei Team-Turnieren zählt jedes Team als Startplatz." : "Wähle ein Plattform-Konto aus. Nur wenn es keinen Account gibt, bleibt es ein manueller Gast."}</div>
        </div>
        <button type="submit" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs">Hinzufügen</button>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        {isTeamTournament ? (
          <SelectField label="Team" value={form.team_id} onChange={(v)=>onChange("team_id", v)} options={teamOptions} />
        ) : (
          <SelectField label="Konto oder manueller Gast" value={form.user_id} onChange={(v)=>onChange("user_id", v)} options={userOptions} />
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

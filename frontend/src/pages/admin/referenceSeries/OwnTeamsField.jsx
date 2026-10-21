import { FieldLabel, INPUT_CLASS } from "@/components/tls/FormFields";
import { emptyOwnTeam } from "@/lib/referenceSeries";
import { Plus, X } from "lucide-react";

// Eigene Teams der Saison (#1926): ein Verein fährt oft mit mehreren Teams. Je Team der Name wie beim Veranstalter und
// weitere Schreibweisen; Groß/klein, Leer- und Bindestriche erkennt der Server selbst („TLS-DarkFriday“ = „TLS
// DarkFriday“). Garage, Teamwertung, „Unser Platz“ und Liga-Weg zählen alle Teams der Liste.

const ICON_BUTTON = "p-2 rounded-sm text-white/45 hover:text-white hover:bg-white/5 transition active:scale-[0.97]";

export function OwnTeamsField({ teams, onChange }) {
  const update = (key, values) => onChange(teams.map((team) => (team.key === key ? { ...team, ...values } : team)));
  const remove = (key) => {
    const rest = teams.filter((team) => team.key !== key);
    onChange(rest.length ? rest : [emptyOwnTeam()]);
  };
  return (
    <FieldLabel label="Eigene Teams" hint="So heißen die Vereinsteams beim Veranstalter. Schreibweisen: weitere Namen, mit Komma getrennt – Groß/klein, Leer- und Bindestriche erkennt die Seite selbst.">
      <ol className="space-y-2" data-testid="series-own-teams">
        {teams.map((team, index) => (
          <li key={team.key} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2" data-testid="series-own-team">
            <input aria-label={`Team ${index + 1}`} value={team.name} maxLength={120} placeholder={index === 0 ? "THE LION SQUAD" : "Weiteres Team"}
              onChange={(event) => update(team.key, { name: event.target.value })} className={INPUT_CLASS} data-testid="series-own-team-name" />
            <input aria-label={`Schreibweisen Team ${index + 1}`} value={team.aliases} placeholder="Schreibweisen, etwa TLS"
              onChange={(event) => update(team.key, { aliases: event.target.value })} className={`${INPUT_CLASS} col-start-1 row-start-2 sm:col-start-auto sm:row-start-auto`} data-testid="series-own-team-aliases" />
            <button type="button" onClick={() => remove(team.key)} className={`${ICON_BUTTON} row-start-1 col-start-2 sm:row-start-auto sm:col-start-auto`}
              aria-label={`Team ${index + 1} entfernen`} title="Entfernen" data-testid="series-own-team-remove">
              <X className="w-4 h-4" />
            </button>
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => onChange([...teams, emptyOwnTeam()])} data-testid="series-own-team-add"
        className="mt-2 tls-btn tls-btn--quiet px-3 py-2 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
        <Plus className="w-3.5 h-3.5" /> Team
      </button>
    </FieldLabel>
  );
}

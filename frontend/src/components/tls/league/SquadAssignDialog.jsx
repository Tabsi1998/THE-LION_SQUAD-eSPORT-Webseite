import { useCallback, useEffect, useId, useState } from "react";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { personName } from "./squadRoles";

// „Co-Team zuteilen“ (docs/LIGA.md, #1649, Teil von #1623): die Turnierleitung wählt erst das Hauptteam, dann eines
// seiner Co-Teams. Der Server prüft alles (gehört zum Team, aktiv, Spiel, Kader, Staffel voll, zwei Co-Teams desselben
// Teams) und schickt die Gründe vorab mit - ein Co-Team, das nicht geht, steht mit dem Grund da und ist nicht wählbar.

export function canAssignSquads(tournament) {
  if (!tournament || (tournament.team_mode || "solo") === "solo") return false;
  return tournament.format === "league" || Boolean(tournament.league_context);
}

function seatsText(data) {
  if (!data) return "";
  const parts = [`Mindestkader ${data.min_squad_size}`];
  if (data.max_participants) parts.push(`${data.seats_taken} von ${data.max_participants} Plätzen belegt`);
  return parts.join(" · ");
}

function rolesLine(squad) {
  const parts = [];
  if (squad.captain) parts.push(`Captain ${personName(squad.captain)}`);
  if (squad.vice_captain) parts.push(`Vertreter ${personName(squad.vice_captain)}`);
  return parts.length ? parts.join(" · ") : "ohne Captain – die Teamleitung handelt";
}

export function SquadAssignDialog({ tournament, onAssigned }) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [teamId, setTeamId] = useState("");
  const [squadId, setSquadId] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const { data: rows } = await api.get(`/tournaments/${tournament.id}/squad-candidates`);
      setData(rows);
    } catch (err) {
      setData(null);
      setLoadError(formatRequestError(err, "Co-Teams lassen sich gerade nicht laden."));
    }
  }, [tournament.id]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === "Escape" && !busy) setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  const start = () => {
    setTeamId("");
    setSquadId("");
    setQuery("");
    setError("");
    setOpen(true);
  };

  const teams = data?.teams || [];
  const needle = query.trim().toLowerCase();
  const shownTeams = needle
    ? teams.filter((team) => `${team.name || ""} ${team.tag || ""}`.toLowerCase().includes(needle))
    : teams;
  const team = teams.find((row) => row.id === teamId) || null;
  const squad = team?.squads.find((row) => row.id === squadId) || null;

  const pickTeam = (id) => {
    setTeamId(id);
    setSquadId("");
    setError("");
  };

  const submit = async () => {
    if (!team || !squad) return;
    setBusy(true);
    setError("");
    try {
      await api.post(`/tournaments/${tournament.id}/squad-registrations`, { team_id: team.id, squad_id: squad.id });
      toast.success(`${squad.display_name} ist in der Staffel.`);
      setOpen(false);
      onAssigned?.();
    } catch (err) {
      setError(formatRequestError(err, "Das Co-Team konnte nicht zugeteilt werden."));
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" onClick={start} data-testid="squad-assign-open" className="tls-btn tls-btn--secondary inline-flex items-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider">
        <Users className="h-4 w-4" /> Co-Team zuteilen
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-testid="squad-assign-dialog"
            className="flex max-h-[90vh] w-full max-w-lg min-w-0 flex-col rounded-sm border border-white/10 bg-[#121212] shadow-xl"
          >
            <div className="shrink-0 border-b border-white/10 p-4">
              <h2 id={titleId} className="font-heading text-base font-bold uppercase text-white">Co-Team zuteilen</h2>
              <p className="mt-1 text-xs text-white/60">
                {team ? "Schritt 2 von 2: Welches Co-Team spielt in dieser Staffel?" : "Schritt 1 von 2: Zu welchem Team gehört das Co-Team?"}
              </p>
              {data ? <p className="mt-1 text-[11px] text-white/45" data-testid="squad-assign-seats">{seatsText(data)}</p> : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm text-white/85">
              {loadError ? <p role="alert" className="text-warn">{loadError}</p> : null}
              {!data && !loadError ? <p className="text-white/50">Lade Co-Teams …</p> : null}

              {data && !team ? (
                <fieldset className="min-w-0 space-y-2">
                  <legend className="sr-only">Team wählen</legend>
                  {teams.length > 6 ? (
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      aria-label="Team suchen"
                      placeholder="Team suchen"
                      data-testid="squad-assign-search"
                      className="mb-1 w-full rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm text-white placeholder:text-white/35 focus:border-[#29B6E8]/60 focus:outline-none"
                    />
                  ) : null}
                  {shownTeams.map((row) => {
                    const free = row.squads.filter((entry) => entry.problems.length === 0).length;
                    return (
                      <label key={row.id} aria-label={row.name} className="flex min-w-0 cursor-pointer items-center gap-3 rounded-sm border border-white/10 bg-[#0A0A0A] p-3 hover:border-white/25">
                        <input type="radio" name="squad-assign-team" value={row.id} checked={teamId === row.id} onChange={() => pickTeam(row.id)} className="accent-[#29B6E8]" data-testid={`squad-assign-team-${row.id}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-bold text-white">{row.name}{row.tag ? <span className="ml-2 text-xs text-[#29B6E8]">[{row.tag}]</span> : null}</span>
                          <span className="block text-xs text-white/50">
                            {row.in_staffel ? "hat schon ein Co-Team in dieser Staffel" : `${row.squads.length} ${row.squads.length === 1 ? "Co-Team" : "Co-Teams"}, ${free} zuteilbar`}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                  {shownTeams.length === 0 ? (
                    <p className="text-white/50">{teams.length === 0 ? "Noch kein Team hat ein aktives Co-Team. Co-Teams legt die Teamleitung im Profil unter „Teams“ an." : "Kein Team passt zur Suche."}</p>
                  ) : null}
                </fieldset>
              ) : null}

              {team ? (
                <fieldset className="min-w-0 space-y-2">
                  <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-white/60 break-words">{team.name}</legend>
                  {team.squads.map((row) => {
                    const blocked = row.problems.length > 0;
                    return (
                      <label key={row.id} className={`flex min-w-0 items-start gap-3 rounded-sm border bg-[#0A0A0A] p-3 ${blocked ? "border-white/5 opacity-70" : "cursor-pointer border-white/10 hover:border-white/25"}`}>
                        <input type="radio" name="squad-assign-squad" value={row.id} disabled={blocked} checked={squadId === row.id} onChange={() => { setSquadId(row.id); setError(""); }} className="mt-1 accent-[#29B6E8]" data-testid={`squad-assign-squad-${row.id}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block font-bold text-white break-words [overflow-wrap:anywhere]">{row.display_name}</span>
                          <span className="block text-xs text-white/55">{row.member_count} im Kader · {rolesLine(row)}</span>
                          {row.problems.map((text) => (
                            <span key={text} className="mt-1 block text-xs text-warn break-words [overflow-wrap:anywhere]">{text}</span>
                          ))}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              ) : null}
              {error ? <p role="alert" data-testid="squad-assign-error" className="mt-3 text-sm text-warn break-words">{error}</p> : null}
            </div>

            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-white/10 p-4">
              {team ? (
                <button type="button" onClick={() => pickTeam("")} disabled={busy} className="tls-btn tls-btn--quiet mr-auto rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider">
                  Anderes Team
                </button>
              ) : null}
              <button type="button" onClick={() => setOpen(false)} disabled={busy} className="tls-btn tls-btn--quiet rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider">
                Abbrechen
              </button>
              <button type="button" onClick={submit} disabled={busy || !squad} data-testid="squad-assign-confirm" className="tls-btn tls-btn--primary rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
                {busy ? "Teile zu …" : "Zuteilen"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

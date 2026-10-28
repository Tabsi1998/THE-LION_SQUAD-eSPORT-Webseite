import { useState } from "react";
import { AlertTriangle, Trophy } from "lucide-react";
import { LazyImg } from "@/components/tls/LazyImg";
import { viennaDateTime } from "@/lib/vienna";
import { LineupPicker } from "./LeagueReportForm";
import { followLineups, gamesProblem } from "./leagueGames";

// Die gespielten Maps eines Liga-Spiels (docs/LIGA.md, #1650): je Map Bild, Name, Modus, Sieger, Punkte und die
// Aufstellungen beider Seiten - fehlt eine noch, steht es da. Wer darf, trägt die eigene Aufstellung hier nach.

function until(value) {
  try {
    return value ? viennaDateTime(value, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  } catch {
    return "";
  }
}

export function LeagueGamesView({ league }) {
  const games = league?.games || [];
  if (!games.length) return null;
  const missing = new Set(league.lineups_missing || []);
  return (
    <div className="mt-5 space-y-3" data-testid="league-games">
      <h3 className="text-xs font-bold uppercase tracking-wider text-[#29B6E8]">Maps</h3>
      <ol className="grid gap-3 md:grid-cols-2">
        {games.map((game) => (
          <li key={game.position} className="min-w-0 overflow-hidden rounded-sm border border-white/10 bg-[#0A0A0A]" data-testid={`league-games-${game.position}`}>
            <div className="relative h-20">
              {game.map_image_url ? (
                <LazyImg src={game.map_image_url} alt="" sizes="(min-width: 768px) 360px, 92vw" className="h-full w-full object-cover opacity-60" />
              ) : <span className="block h-full bg-white/5" />}
              <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 to-transparent px-3 py-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/65">Map {game.position}{game.mode_label ? ` · ${game.mode_label}` : ""}</span>
                <span className="truncate font-heading text-lg font-black text-white">{game.map_name || "Map"}</span>
              </div>
            </div>
            <div className="space-y-2 p-3">
              {league.sides.map((side) => {
                const won = game.winner_registration_id === side.registration_id;
                const score = game.scores?.[side.registration_id];
                const lineup = game.lineups?.[side.registration_id] || [];
                return (
                  <div key={side.registration_id} className="min-w-0">
                    <div className="flex min-w-0 items-center justify-between gap-2 text-sm">
                      <span className={`inline-flex min-w-0 items-center gap-1.5 truncate font-bold ${won ? "text-[#FFD700]" : "text-white/70"}`}>
                        {won && <Trophy className="h-3.5 w-3.5 shrink-0" aria-label="Sieger" />}<span className="truncate">{side.name}</span>
                      </span>
                      {score !== undefined && score !== null && <span className="shrink-0 font-display text-white/80">{score}</span>}
                    </div>
                    <p className="text-xs text-white/50 [overflow-wrap:anywhere]">
                      {lineup.length ? lineup.map((person) => person.name).join(", ")
                        : missing.has(side.registration_id) ? <span className="text-[#FFD700]">Aufstellung fehlt noch</span> : "–"}
                    </p>
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Aufstellung nachtragen oder ändern - je Map die eigene Seite, bis zur Frist. */
export function LineupAmendForm({ league, busy = false, onSave }) {
  const own = league?.own_registration_id;
  const games = league?.games || [];
  const [lineups, setLineups] = useState(() => Object.fromEntries(
    games.map((game) => [game.position, (game.lineups?.[own] || []).map((person) => person.id)])));
  const [error, setError] = useState("");
  if (!league?.can_amend_lineup || !own || !games.length) return null;
  const missing = (league.lineups_missing || []).includes(own);
  const save = async (event) => {
    event.preventDefault();
    const problem = gamesProblem(games.map((game) => ({ position: game.position, lineup: lineups[game.position] || [] })), league, { needMaps: false });
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    await onSave({ games: games.map((game) => ({ position: game.position, lineup: lineups[game.position] || [] })) });
  };
  return (
    <form onSubmit={save} className={`mt-5 space-y-3 rounded-sm border px-4 py-3 ${missing ? "border-[#FFD700]/40 bg-[#FFD700]/5" : "border-white/10 bg-white/[0.02]"}`} data-testid="league-lineup-amend" noValidate>
      <p className="flex items-start gap-2 text-sm font-bold text-white">
        {missing && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#FFD700]" />}
        {missing ? "Eure Aufstellung fehlt noch – bitte je Map nachtragen." : "Aufstellung ändern"}
      </p>
      {league.amend_until && <p className="text-xs text-white/50">Möglich bis {until(league.amend_until)}, danach nur über die Turnierleitung.</p>}
      {games.map((game) => (
        <LineupPicker key={game.position} roster={league.roster} value={lineups[game.position] || []} size={league.team_size}
          label={`Map ${game.position} · ${game.map_name || "Map"}`} testId={`league-amend-lineup-${game.position}`}
          onChange={(lineup) => setLineups((current) => followLineups(current, game.position, lineup))} />
      ))}
      {error && <p className="text-sm text-[#FF6B60]" role="alert" data-testid="league-amend-error">{error}</p>}
      <button disabled={busy} className="tls-btn tls-btn--primary min-h-[44px] px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50" data-testid="league-amend-save">
        Aufstellung speichern
      </button>
    </form>
  );
}

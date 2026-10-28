import { useState } from "react";
import { AlertTriangle, Trophy } from "lucide-react";
import { LazyImg } from "@/components/tls/LazyImg";
import { viennaDateTime } from "@/lib/vienna";
import { LineupPicker } from "./LeagueReportForm";
import { followLineups, gamesProblem, lineupAmendClosed } from "./leagueGames";

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
                      <span className={`inline-flex min-w-0 items-center gap-1.5 truncate font-bold ${won ? "text-honor" : "text-white/70"}`}>
                        {won && <Trophy className="h-3.5 w-3.5 shrink-0" aria-label="Sieger" />}<span className="truncate">{side.name}</span>
                      </span>
                      {score !== undefined && score !== null && <span className="shrink-0 font-display text-white/80">{score}</span>}
                    </div>
                    <p className="text-xs text-white/50 [overflow-wrap:anywhere]">
                      {lineup.length ? lineup.map((person) => person.name).join(", ")
                        : missing.has(side.registration_id) ? <span className="text-warn">Aufstellung fehlt noch</span> : "–"}
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

/** Nach der Frist (#2110, L-D9): statt eines verschwundenen Formulars der Weg über die Turnierleitung. */
export function LineupAmendClosed({ league, onAskStaff = null }) {
  if (!lineupAmendClosed(league)) return null;
  return (
    <div className="mt-5 flex items-start gap-3 rounded-sm border border-warn/40 bg-warn/5 px-4 py-3" role="status" data-testid="league-lineup-closed">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-bold text-white">Eure Aufstellung fehlt noch – die Frist zum Nachtragen ist vorbei.</p>
        <p className="mt-0.5 text-xs text-white/60">
          {league.amend_until ? `Nachtragen ging bis ${until(league.amend_until)}. ` : ""}
          {/* Den Matchchat schreiben Captain, Vertreter und Teamleitung - der übrige Kader bekommt keinen Verweis darauf. */}
          {onAskStaff
            ? "Jetzt trägt sie nur noch die Turnierleitung nach – schreib ihr im Matchchat mit @leitung, wer je Map gespielt hat."
            : "Jetzt trägt sie nur noch die Turnierleitung nach – das klären Captain oder Vertreter eures Teams mit ihr."}
        </p>
        {onAskStaff ? (
          <button type="button" onClick={onAskStaff} className="tls-btn tls-btn--secondary mt-2 min-h-[44px] px-3 py-2 rounded-sm text-[10px] uppercase tracking-wider font-bold" data-testid="league-lineup-closed-ask">
            @leitung im Matchchat
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Aufstellung nachtragen oder ändern - je Map die eigene Seite, bis zur Frist. */
export function LineupAmendForm({ league, busy = false, onSave, onAskStaff = null }) {
  const own = league?.own_registration_id;
  const games = league?.games || [];
  const [lineups, setLineups] = useState(() => Object.fromEntries(
    games.map((game) => [game.position, (game.lineups?.[own] || []).map((person) => person.id)])));
  const [error, setError] = useState("");
  if (!league?.can_amend_lineup || !own || !games.length) return <LineupAmendClosed league={league} onAskStaff={onAskStaff} />;
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
    <form onSubmit={save} className={`mt-5 space-y-3 rounded-sm border px-4 py-3 ${missing ? "border-warn/40 bg-warn/5" : "border-white/10 bg-white/[0.02]"}`} data-testid="league-lineup-amend" noValidate>
      <p className="flex items-start gap-2 text-sm font-bold text-white">
        {missing && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />}
        {missing ? "Eure Aufstellung fehlt noch – bitte je Map nachtragen." : "Aufstellung ändern"}
      </p>
      {league.amend_until && <p className="text-xs text-white/50">Möglich bis {until(league.amend_until)}, danach nur über die Turnierleitung.</p>}
      {games.map((game) => (
        <LineupPicker key={game.position} roster={league.roster} value={lineups[game.position] || []} size={league.team_size}
          label={`Map ${game.position} · ${game.map_name || "Map"}`} testId={`league-amend-lineup-${game.position}`}
          onChange={(lineup) => setLineups((current) => followLineups(current, game.position, lineup))} />
      ))}
      {error && <p className="text-sm text-warn" role="alert" data-testid="league-amend-error">{error}</p>}
      <button disabled={busy} className="tls-btn tls-btn--primary min-h-[44px] px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50" data-testid="league-amend-save">
        Aufstellung speichern
      </button>
    </form>
  );
}

function sideLineups(games, side) {
  return Object.fromEntries(games.map((game) => [game.position, (game.lineups?.[side] || []).map((person) => person.id)]));
}

/** Turnierleitung (#1650): die Aufstellung einer Seite jederzeit nachtragen oder ändern - mit Grund fürs Protokoll. */
export function StaffLineupAmend({ league, busy = false, onSave }) {
  const games = league?.games || [];
  const sides = league?.sides || [];
  const firstMissing = (league?.lineups_missing || [])[0];
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState(firstMissing || sides[0]?.registration_id || "");
  const [lineups, setLineups] = useState(() => sideLineups(games, firstMissing || sides[0]?.registration_id));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  if (!games.length || !Object.keys(league?.rosters || {}).length) return null;
  const pick = (next) => {
    setSide(next);
    setLineups(sideLineups(games, next));
    setError("");
  };
  const save = async (event) => {
    event.preventDefault();
    const rows = games.map((game) => ({ position: game.position, lineup: lineups[game.position] || [] }));
    const problem = gamesProblem(rows, league, { needMaps: false });
    if (problem) {
      setError(problem);
      return;
    }
    if (reason.trim().length < 5) {
      setError("Bitte kurz den Grund angeben (mindestens 5 Zeichen) – er steht im Protokoll.");
      return;
    }
    setError("");
    const done = await onSave({ games: rows, registration_id: side, reason: reason.trim() });
    if (done !== false) setOpen(false);
  };
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-4 text-xs font-bold text-white/60 underline underline-offset-2 hover:text-white" data-testid="league-staff-amend-open">
        {firstMissing ? "Fehlende Aufstellung nachtragen (Turnierleitung)" : "Aufstellung ändern (Turnierleitung)"}
      </button>
    );
  }
  return (
    <form onSubmit={save} className="mt-5 space-y-3 rounded-sm border border-white/10 bg-white/[0.02] px-4 py-3" data-testid="league-staff-amend" noValidate>
      <p className="text-sm font-bold text-white">Aufstellung nachtragen (Turnierleitung)</p>
      <div role="group" aria-label="Seite" className="grid grid-cols-2 gap-2">
        {sides.map((row) => (
          <button key={row.registration_id} type="button" aria-pressed={side === row.registration_id} onClick={() => pick(row.registration_id)}
            className={`min-h-[44px] min-w-0 rounded-sm border px-3 py-2 text-sm font-bold ${side === row.registration_id ? "border-[#29B6E8] bg-[#29B6E8]/15 text-white" : "border-white/15 text-white/70"}`}
            data-testid={`league-staff-amend-side-${row.registration_id}`}>
            <span className="block truncate">{row.name}{(league.lineups_missing || []).includes(row.registration_id) ? " · fehlt" : ""}</span>
          </button>
        ))}
      </div>
      {games.map((game) => (
        <LineupPicker key={`${side}-${game.position}`} roster={league.rosters[side] || []} value={lineups[game.position] || []} size={league.team_size}
          label={`Map ${game.position} · ${game.map_name || "Map"}`} testId={`league-staff-amend-lineup-${game.position}`}
          onChange={(lineup) => setLineups((current) => followLineups(current, game.position, lineup))} />
      ))}
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/60">Grund (steht im Protokoll)</span>
        <input value={reason} onChange={(event) => setReason(event.target.value)} className="input" placeholder="z. B. per Discord nachgereicht" data-testid="league-staff-amend-reason" />
      </label>
      {error && <p className="text-sm text-warn" role="alert" data-testid="league-staff-amend-error">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} className="tls-btn tls-btn--primary min-h-[44px] px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50" data-testid="league-staff-amend-save">
          Aufstellung speichern
        </button>
        <button type="button" onClick={() => setOpen(false)} className="tls-btn tls-btn--quiet min-h-[44px] px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold">
          Abbrechen
        </button>
      </div>
    </form>
  );
}
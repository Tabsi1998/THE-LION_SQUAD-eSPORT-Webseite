import { useId, useRef, useState } from "react";
import { Check, ClipboardCheck, IdCard, Trophy, Users, X } from "lucide-react";
import { LazyImg } from "@/components/tls/LazyImg";
import { ModeIcon } from "@/components/tls/ModeIcon";
import { REPORT_STATE_TEXT } from "@/lib/matchReport";
import { blockedPlayers } from "@/lib/leagueIds";
import {
  changeGame,
  confirmPayload,
  followLineups,
  gamesProblem,
  isSeries,
  mapsFor,
  modeIcon,
  modeLabel,
  participantsProblem,
  personIds,
  plannedFor,
  poolModes,
  repeatedMap,
  rememberGames,
  reportPayload,
  scoresTied,
  scoreWinner,
  seriesSentence,
  settleGames,
  startGames,
  toggleLineup,
  withScores,
} from "./leagueGames";
import { ruleFor, ruleHint } from "./leagueResultRules";

// Liga-Ergebnis melden (docs/LIGA.md, #1650): je Map Modus, Map aus dem Pool, Sieger, auf Wunsch die Punkte und die
// eigene Aufstellung. Die nächste Map erscheint, sobald die letzte einen Sieger hat - bis die Serie entschieden ist.
// Die Gegenseite bestätigt mit einem Tipp und stellt dabei ihre eigene Aufstellung je Map auf.

const chip = (active) => `inline-flex min-h-[40px] max-w-full items-center gap-1.5 rounded-sm border px-3 py-1.5 text-sm ${
  active ? "border-[#29B6E8] bg-[#29B6E8]/15 text-white" : "border-white/15 bg-[#0A0A0A] text-white/70 hover:border-white/35"}`;

/** Teilnehmerliste einmal je Spiel (#2204): alle ankreuzen, die mindestens eine Map gespielt haben - nach oben offen. */
export function ParticipantsPicker({ roster = [], value = [], league, onChange, label = "Wer hat gespielt?", testId = "league-participants" }) {
  return (
    <div className="space-y-1.5">
      <LineupPicker roster={roster} value={value} size={null} minimum={league?.lineup_min_players || 1} onChange={onChange} label={label} testId={testId} />
      <p className="text-xs text-white/50" data-testid={`${testId}-hint`}>
        Kreuze alle an, die mindestens eine Map gespielt haben. Mindestens {league?.lineup_min_players || 1}, bei Wechseln auch mehr. Wer fehlt, zählt nicht als Einsatz.
      </p>
    </div>
  );
}

/** Spieler-Chips: genau `size` aus dem Kader antippen, ohne `size` so viele wie nötig ab `minimum`. Wer ohne gültige Spiel-ID nicht
 * aufgestellt werden kann (#2108) oder nach den Regeln der Season nicht spielen darf (#2204), steht grau mit Grund darunter; ein schon
 * Aufgestellter bleibt abwählbar. */
export function LineupPicker({ roster = [], value = [], size = 1, minimum = null, onChange, label = "Aufstellung", testId }) {
  const open = size == null;
  const full = !open && value.length >= size;
  const enough = open ? value.length >= (minimum || 1) : value.length === size;
  const blocked = blockedPlayers(roster);
  const reasonId = useId();
  return (
    <div role="group" aria-label={label} data-testid={testId}>
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-widest text-white/55">
        <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> {label}</span>
        <span className={enough ? "text-ok" : "text-white/45"} data-testid={testId ? `${testId}-count` : undefined}>{open ? `${value.length} · mindestens ${minimum || 1}` : `${value.length}/${size}`}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {roster.map((person) => {
          const active = value.includes(person.id);
          const locked = Boolean(person.lineup_blocked) && !active;
          return (
            <button
              key={person.id}
              type="button"
              aria-pressed={active}
              disabled={locked || (!active && full)}
              aria-describedby={locked ? reasonId : undefined}
              title={locked ? person.lineup_blocked : person.game_id_text || undefined}
              onClick={() => onChange(toggleLineup(value, person.id, size))}
              className={`${chip(active)} disabled:opacity-40 ${locked ? "cursor-not-allowed border-dashed" : ""}`}
              data-testid={testId ? `${testId}-${person.id}` : undefined}
              data-blocked={locked ? "true" : undefined}
            >
              {/* Platz fürs Häkchen immer reserviert (#2096): sonst wird der Chip beim Antippen breiter, die Reihe
                  springt und der nächste Tipp landet daneben. */}
              <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center" data-check-slot aria-hidden="true">
                {active && <Check className="h-3.5 w-3.5" />}
                {locked && <IdCard className="h-3.5 w-3.5" />}
              </span>
              <span className="truncate">{person.name}</span>
            </button>
          );
        })}
      </div>
      {blocked.length > 0 && (
        <ul id={reasonId} className="mt-1.5 space-y-0.5 text-xs text-warn" data-testid={testId ? `${testId}-blocked` : undefined}>
          {blocked.map((person) => (
            <li key={person.id} className="break-words [overflow-wrap:anywhere]">{open ? "Nicht eintragbar" : "Nicht aufstellbar"}: {person.name} – {person.reason}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Sieger einer Map: Stehen die Punkte beider Seiten da, ergibt er sich daraus - niemand muss ein Team antippen. Antippen
 * gibt es nur, wo Punkte freiwillig und nicht eingetragen sind, bei Gleichstand und bei kampflos gewerteten Maps.
 */
function MapWinner({ game, league, onPick, staff = false }) {
  const auto = scoreWinner(game, league);
  const awarded = game.decision === "awarded";
  const tied = scoresTied(game, league);
  const rule = ruleFor(league, game.mode);
  const testId = `league-game-${game.position}-winner`;
  const nameOf = (id) => league.sides.find((side) => side.registration_id === id)?.name;
  const fromScores = Boolean(auto) && game.winner === auto && !awarded;
  // Sieger und Punkte widersprechen sich (ältere Einträge, Korrektur der Leitung): sagen und anbieten, ihn zu übernehmen.
  const mismatch = Boolean(auto) && Boolean(game.winner) && game.winner !== auto && !awarded;
  if (!staff && fromScores) {
    return (
      <p role="status" className="flex min-h-[44px] min-w-0 items-start gap-2 rounded-sm border border-honor/50 bg-honor/10 px-3 py-2 text-sm font-bold text-honor" data-testid={`${testId}-auto`}>
        <Trophy className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {/* Lange Teamnamen brechen um statt abgeschnitten zu werden - der Sieger muss ganz lesbar sein. */}
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">
          Sieger: {nameOf(auto)}
          <span className="block text-xs font-normal text-white/55">aus den Punkten</span>
        </span>
      </p>
    );
  }
  if (!staff && !mismatch && !awarded) {
    if (tied && rule && !rule.draw_allowed) {
      return <p role="status" className="text-xs text-warn" data-testid={`${testId}-no-draw`}>Gleichstand gibt es in diesem Modus nicht – bitte die Punkte prüfen.</p>;
    }
    if (league.scores_required && !tied) {
      return <p className="text-xs text-white/50" data-testid={`${testId}-pending`}>Den Sieger ergeben die Punkte – einfach beide eintragen.</p>;
    }
  }
  // Leitung (Ergebnis-Fenster): Die Knöpfe bleiben immer - zum Übergehen einer Regel mit Grund und für Altdaten. Der Sieger
  // aus den Punkten ist vorgewählt.
  const question = tied ? `Gleichstand – wer hat Map ${game.position} gewonnen?` : `Wer hat Map ${game.position} gewonnen?`;
  return (
    <div className="space-y-1.5">
      {mismatch ? (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-white" data-testid={`${testId}-mismatch`}>
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">Der Sieger passt nicht zu den Punkten – mehr Punkte hat {nameOf(auto)}.</span>
          <button type="button" onClick={() => onPick(auto)} className="font-bold underline underline-offset-2 hover:text-white" data-testid={`${testId}-adopt`}>
            Sieger aus den Punkten übernehmen
          </button>
        </div>
      ) : null}
      <p className="text-[11px] font-bold uppercase tracking-widest text-white/55" aria-hidden="true">
        {question}{fromScores ? " · aus den Punkten" : ""}
      </p>
      <div role="group" aria-label={tied ? `Gleichstand – Sieger Map ${game.position}` : `Sieger Map ${game.position}`} className="grid grid-cols-2 gap-2">
        {league.sides.map((side) => (
          <button key={side.registration_id} type="button" aria-pressed={game.winner === side.registration_id}
            onClick={() => onPick(side.registration_id)}
            className={`min-h-[44px] min-w-0 rounded-sm border px-3 py-2 text-sm font-bold ${game.winner === side.registration_id ? "border-honor bg-honor/15 text-honor" : "border-white/15 text-white/70 hover:border-white/35"}`}
            data-testid={`${testId}-${side.registration_id}`}>
            <span className="block truncate">{game.winner === side.registration_id ? "Sieger: " : ""}{side.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function GameEditor({ game, league, onChange, index, staff = false, games = [] }) {
  const modes = poolModes(league.pool);
  // Veto (#1618, D.3): Modus und Map der Position stehen fest - die Captains tragen nur Sieger, Punkte und Aufstellung ein.
  const plan = !staff && game.planned ? plannedFor(game.position, league) : null;
  const fixedMode = Boolean(plan) || (league.mode_order || []).length > 0 || modes.length <= 1;
  const maps = mapsFor(league.pool, game.mode);
  const [openScores, setShowScores] = useState(Object.keys(game.scores || {}).length > 0);
  // Punkte je Map Pflicht (C.3, #1617): die Felder stehen gleich da. Die Regel des Modus steht als Hinweis an der Map.
  const showScores = openScores || Boolean(league.scores_required);
  const rule = ruleHint(ruleFor(league, game.mode));
  const set = (patch) => onChange({ ...game, ...patch });
  return (
    <fieldset className="min-w-0 space-y-3 rounded-sm border border-white/10 bg-[#0A0A0A] p-3 sm:p-4" data-testid={`league-game-${game.position}`}>
      <legend className="inline-flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-wider text-[#29B6E8]">
        {/* Modus-Symbol (#2266) aus dem Pool - ohne Bild das neutrale Symbol. */}
        {game.mode && fixedMode ? <ModeIcon src={modeIcon(league.pool, game.mode)} size="xs" testId={`league-game-${game.position}-mode-icon`} /> : null}
        Map {game.position}{game.mode && fixedMode ? ` · ${modeLabel(league.pool, game.mode)}` : ""}
      </legend>
      {rule ? <p className="text-xs text-white/60" data-testid={`league-game-${game.position}-rule`}>Gewertet: {rule}</p> : null}
      {plan ? (
        <div className="flex items-center gap-3 rounded-sm border border-[#00D26A]/40 bg-[#00D26A]/5 p-2" data-testid={`league-game-${game.position}-planned`}>
          {plan.map_image_url ? <LazyImg src={plan.map_image_url} alt="" sizes="64px" className="h-12 w-16 shrink-0 rounded-sm object-cover" /> : <span className="h-12 w-16 shrink-0 rounded-sm bg-white/5" />}
          <span className="min-w-0">
            <span className="block truncate font-bold text-white">{plan.map_name}</span>
            <span className="block text-xs text-white/60">laut Veto{plan.role === "decider" ? " (Decider)" : ""} · {plan.mode_label || modeLabel(league.pool, game.mode)}</span>
          </span>
        </div>
      ) : null}
      {!fixedMode && (
        <div role="group" aria-label={`Modus Map ${game.position}`} className="flex flex-wrap gap-1.5">
          {modes.map((group) => (
            <button key={group.mode} type="button" aria-pressed={game.mode === group.mode} onClick={() => set({ mode: group.mode, map_id: "" })}
              className={chip(game.mode === group.mode)} data-testid={`league-game-${game.position}-mode-${group.mode}`}>
              <ModeIcon src={group.icon_url} size="xs" />
              {group.label || group.mode}
            </button>
          ))}
        </div>
      )}
      {!plan && (fixedMode || game.mode) && (
        <div role="group" aria-label={`Map ${game.position}`} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {maps.map((item) => {
            const active = game.map_id === item.map_id;
            // Schon gespielt (#2096): dieselbe Map im selben Modus (bzw. je nach Season überhaupt) nur einmal je Serie.
            const earlier = active ? null : repeatedMap(games, game.position, game.mode, item.map_id, league);
            return (
              <button key={item.map_id} type="button" aria-pressed={active} disabled={Boolean(earlier)} onClick={() => set({ map_id: item.map_id })}
                title={earlier ? `Lief schon als Map ${earlier.position}` : undefined}
                className={`group relative min-w-0 overflow-hidden rounded-sm border text-left disabled:cursor-not-allowed disabled:opacity-35 ${active ? "border-[#29B6E8] ring-1 ring-[#29B6E8]" : "border-white/10 hover:border-white/30"}`}
                data-testid={`league-game-${game.position}-map-${item.map_id}`}>
                {item.image_url ? (
                  <LazyImg src={item.image_url} alt="" sizes="(min-width: 640px) 180px, 45vw" className={`h-16 w-full object-cover ${active ? "" : "opacity-70"}`} />
                ) : <span className="block h-16 bg-white/5" />}
                <span className="block truncate px-2 py-1.5 text-sm font-bold text-white">{item.name}</span>
                {active && <Check className="absolute right-1.5 top-1.5 h-4 w-4 rounded-full bg-[#29B6E8] p-0.5 text-black" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
      {showScores ? (
        <div className="grid grid-cols-2 gap-2">
          {league.sides.map((side) => (
            <label key={side.registration_id} className="block min-w-0 text-xs text-white/55">
              <span className="block truncate">{league.scores_required ? "Punkte (Pflicht)" : "Punkte"} {side.name}</span>
              <input inputMode="numeric" value={game.scores?.[side.registration_id] ?? ""} onChange={(event) => onChange(withScores(game, { ...game.scores, [side.registration_id]: event.target.value }, league))}
                className="input mt-1 w-full" data-testid={`league-game-${game.position}-score-${side.registration_id}`} />
            </label>
          ))}
        </div>
      ) : (
        <button type="button" onClick={() => setShowScores(true)} className="text-xs font-bold text-white/55 underline underline-offset-2 hover:text-white">
          Punkte eintragen (freiwillig)
        </button>
      )}
      <MapWinner game={game} league={league} staff={staff} onPick={(winner) => set({ winner })} />
      {isSeries(league) ? null : staff ? (
        // Turnierleitung (#1650): Aufstellungen beider Seiten, je Seite freiwillig.
        league.sides.map((side) => (
          <LineupPicker key={side.registration_id} roster={league.rosters?.[side.registration_id] || []}
            value={game.lineups?.[side.registration_id] || []} size={league.team_size}
            onChange={(lineup) => set({ lineups: { ...(game.lineups || {}), [side.registration_id]: lineup } })}
            label={`Aufstellung ${side.name}`} testId={`league-game-${game.position}-lineup-${side.registration_id}`} />
        ))
      ) : (
        <LineupPicker roster={league.roster} value={game.lineup} size={league.team_size} onChange={(lineup) => set({ lineup })}
          label={index === 0 ? "Deine Aufstellung" : "Deine Aufstellung (wie Map davor übernommen)"} testId={`league-game-${game.position}-lineup`} />
      )}
    </fieldset>
  );
}

/** Die Maps der Gegenseite in Worten - zum Bestätigen. */
export function GamesSummary({ games = [], league }) {
  return (
    <ol className="space-y-1.5" data-testid="league-games-summary">
      {games.map((game) => {
        const winner = league.sides.find((side) => side.registration_id === game.winner_registration_id)?.name;
        const scores = league.sides.map((side) => game.scores?.[side.registration_id]);
        const withScores = scores.some((value) => value !== undefined && value !== null && value !== "");
        return (
          <li key={game.position} className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-bold text-white">Map {game.position}</span>
            <span className="text-white/75">{game.map_name || "Map"}{game.mode_label ? ` (${game.mode_label})` : ""}</span>
            <span className="text-honor">→ {winner || "?"}</span>
            {withScores && <span className="text-white/60" data-testid={`league-games-summary-score-${game.position}`}>{scores.map((value) => value ?? "–").join(":")}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function ConfirmWithLineup({ league, state, busy, readOnly, onReport, onWrongResult }) {
  const proposal = league.proposal_games || [];
  const series = isSeries(league);
  const [lineups, setLineups] = useState(() => Object.fromEntries(proposal.map((game) => [game.position, []])));
  const [list, setList] = useState(() => personIds(league.own_lineup));
  const [error, setError] = useState("");
  const games = proposal.map((game) => ({ position: game.position, lineup: lineups[game.position] || [] }));
  const confirm = async () => {
    const problem = series ? participantsProblem(list, league) : gamesProblem(games, league, { needMaps: false });
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    await onReport({ ...confirmPayload(proposal, series ? list : lineups, league), screenshot_url: null, note: null });
  };
  return (
    <div className="mt-2 space-y-3">
      <GamesSummary games={proposal} league={league} />
      {state?.proposal_by && <p className="text-xs opacity-80">gemeldet von {state.proposal_by}</p>}
      <p className="text-xs opacity-80" data-testid="league-confirm-scores-hint">
        Es zählen die Punkte der ersten Meldung – stimmen sie nicht, bitte über „Stimmt nicht“ Einspruch einlegen.
      </p>
      {readOnly ? (
        <p className="text-xs opacity-80" data-testid="match-report-lead-confirms">Bestätigen können Captain und Vertreter.</p>
      ) : (
        <>
          {series ? <ParticipantsPicker roster={league.roster} value={list} league={league} onChange={setList} testId="league-confirm-participants" label="Wer hat bei euch gespielt?" /> : proposal.map((game) => (
            <LineupPicker key={game.position} roster={league.roster} value={lineups[game.position] || []} size={league.team_size}
              label={`Deine Aufstellung Map ${game.position}`} testId={`league-confirm-lineup-${game.position}`}
              onChange={(lineup) => setLineups((current) => followLineups(current, game.position, lineup))} />
          ))}
          {error && <p className="text-sm text-warn" role="alert" data-testid="league-confirm-error">{error}</p>}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <button type="button" disabled={busy} onClick={confirm} className="tls-btn tls-btn--primary inline-flex min-h-[44px] items-center justify-center gap-2 px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50" data-testid="match-report-confirm">
              <Check className="w-3.5 h-3.5" /> Stimmt
            </button>
            <button type="button" disabled={busy} onClick={() => onWrongResult?.()} className="tls-btn tls-btn--quiet inline-flex min-h-[44px] items-center justify-center gap-2 px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50" data-testid="match-report-wrong">
              <X className="w-3.5 h-3.5" /> Stimmt nicht
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function LeagueReportForm({ league, state = null, busy = false, readOnly = false, onReport, onWrongResult }) {
  const status = state?.status || "open";
  const [editing, setEditing] = useState(status === "open");
  const [games, setGames] = useState(() => startGames(league));
  const series = isSeries(league);
  const [list, setList] = useState(() => personIds(league.own_lineup));
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [seenStatus, setSeenStatus] = useState(status);
  if (seenStatus !== status) {
    setSeenStatus(status);
    setEditing(status === "open");
  }
  const problem = series ? gamesProblem(games, league, { withLineup: false }) || participantsProblem(list, league) : gamesProblem(games, league);
  const sentence = seriesSentence(games, league);

  // Gedächtnis je Map (#2334): Ein Zwischenstand beim Tippen der Punkte („1“ auf dem Weg zu „160“) kann die Serie kurz
  // entscheiden - weggefallene Maps kommen mit ihren Angaben zurück, sobald sie wieder offen ist.
  const memory = useRef({});
  const change = (position, game) => {
    // Auch gemerkte, gerade ausgeblendete Maps ziehen bei einer Aufstellung mit - sonst kämen sie mit der alten zurück.
    const all = Object.values(rememberGames(memory.current, games)).sort((a, b) => a.position - b.position);
    const changedAll = changeGame(all, position, game);
    memory.current = rememberGames({}, changedAll);
    const changed = changedAll.filter((row) => games.some((shown) => shown.position === row.position));
    setGames(settleGames(changed, league, memory.current));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    const done = await onReport({ ...reportPayload(games, league, list), screenshot_url: null, note: note.trim() || null });
    if (done) setNote("");
  };

  return (
    <div className="space-y-4" data-testid="match-report" data-league="true">
      <div className="text-xs text-[#29B6E8] font-bold uppercase tracking-wider flex items-center gap-2"><ClipboardCheck className="w-3.5 h-3.5" /> Ergebnis melden · Best of {league.best_of}</div>
      {status !== "open" && status !== "agreed" && (
        <div className={`rounded-sm border px-4 py-3 text-sm ${status === "confirm" ? "border-warn/40 bg-warn/10 text-white" : "border-[#29B6E8]/35 bg-[#29B6E8]/10 text-[#BFE9F8]"}`} data-testid="match-report-state" data-status={status}>
          <p className="font-bold">{REPORT_STATE_TEXT[status]}</p>
          {status === "confirm" && <ConfirmWithLineup league={league} state={state} busy={busy} readOnly={readOnly || state?.can_confirm === false} onReport={onReport} onWrongResult={onWrongResult} />}
          {status !== "confirm" && (league.own_games || []).length > 0 && <div className="mt-2"><GamesSummary games={league.own_games} league={league} /></div>}
          {(status === "waiting" || status === "conflict") && !editing && !readOnly && (
            <button type="button" onClick={() => setEditing(true)} className="mt-2 text-xs font-bold uppercase tracking-wider underline underline-offset-2 hover:text-white" data-testid="match-report-change">Meldung ändern</button>
          )}
        </div>
      )}
      {editing && !readOnly && (
        <form onSubmit={submit} className="space-y-4" data-testid="match-report-form" noValidate>
          {!league.pool ? (
            <p className="text-sm text-warn" role="alert">Für diese Staffel ist noch kein Map-Pool hinterlegt – bitte die Turnierleitung fragen.</p>
          ) : (
            games.map((game, index) => <GameEditor key={game.position} index={index} game={game} games={games} league={league} onChange={(next) => change(game.position, next)} />)
          )}
          {series && league.pool ? <ParticipantsPicker roster={league.roster} value={list} league={league} onChange={setList} /> : null}
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} className="input" placeholder="Notiz für die Turnierleitung (freiwillig)" data-testid="match-report-note" />
          <p className={`rounded-sm border px-3 py-2 text-sm font-bold ${sentence && !problem ? "border-[#29B6E8]/35 bg-[#29B6E8]/10 text-[#BFE9F8]" : "border-white/10 bg-white/5 text-white/45"}`} data-testid="match-report-sentence" aria-live="polite">
            {problem || sentence}
          </p>
          {error && <p className="text-sm text-warn" role="alert" data-testid="match-report-error">{error}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button disabled={busy} className="tls-btn tls-btn--primary min-h-[44px] px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50" data-testid="match-report-submit">Ergebnis melden</button>
            <p className="text-xs text-white/50">{series ? "Die Gegenseite bestätigt und trägt ein, wer bei ihr gespielt hat." : "Die Gegenseite bestätigt und stellt dabei ihre Aufstellung auf."} Ohne Antwort gilt dein Ergebnis nach 48 Stunden.</p>
          </div>
        </form>
      )}
    </div>
  );
}

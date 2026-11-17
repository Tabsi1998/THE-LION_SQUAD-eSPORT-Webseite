// Reiter „Spiele und Ergebnisse“ der Staffel-Seite (#2262, Entwurf 2.2, Paket B): eine schlanke Liste je Spielwoche mit Stand, Ergebnis
// und Chips für Check-in, Veto, Vorfall und Verfahren (Phase D/E, nur Anzeige aus `league_marks`). Bedient wird auf der Matchseite -
// hier stehen nur „Zum Spiel“, „Ergebnis eintragen/korrigieren“ (`ResultWindow`, Recht „Ergebnisse korrigieren“) und „Beide nicht
// erschienen“ (`DoubleNoShowAction`). Befangenheit wie überall: im eigenen Spiel trägt eine zweite Person ein, der Superadmin nur als
// Notausnahme mit Grund - das prüft der Server, die Seite zeigt den Satz statt des Knopfs.
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown, PenLine } from "lucide-react";
import { DoubleNoShowAction } from "@/components/tls/league/DoubleNoShowAction";
import { OwnTeamNote } from "@/components/tls/league/ConflictOverride";
import { ResultWindowLoader } from "@/components/tls/results/ResultWindow";
import { ResultUndoBar, useResultUndo } from "@/components/tls/results/ResultUndoBar";
import { matchWhen } from "@/lib/leaguePage";
import { matchRights } from "@/lib/tournamentRights";
import { staffelBeforeStart } from "@/pages/admin/tournament/StaffelParts";
import { gameChips, gameScore, gameState, gamesByWeek } from "./staffelGames";

const RESULTS_OPEN = new Set(["live", "paused"]);
const DONE_TONE = new Set(["done"]);
const BUTTON = "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-sm px-3 text-[11px] font-bold uppercase tracking-wider";
const STATE_TONE = {
  done: "border-white/15 text-white/70",
  live: "border-live/50 text-live",
  warn: "border-warn/50 text-warn",
  open: "border-[#29B6E8]/40 text-[#29B6E8]",
};
const CHIP_TONE = {
  info: "border-[#29B6E8]/40 bg-[#29B6E8]/10 text-[#29B6E8]",
  ok: "border-ok/40 bg-ok/10 text-ok",
  warn: "border-warn/40 bg-warn/10 text-warn",
};

const nameOf = (registration) => registration?.display_name || registration?.squad_name || registration?.ingame_name || "";

function sideNames(match, byId) {
  return (match.slots || []).slice(0, 2).map((slot) => ({ id: slot?.registration_id || "", name: nameOf(byId.get(slot?.registration_id)) || "noch offen" }));
}

function GameRow({ match, byId, canResults, onResult, onReload }) {
  const state = gameState(match);
  const score = gameScore(match);
  const chips = gameChips(match);
  const sides = sideNames(match, byId);
  const filled = sides.filter((side) => side.id).length === 2;
  // Im eigenen Spiel (ohne Notausnahme) trägt eine zweite Person ein - der Satz statt der Knöpfe.
  const own = Boolean(match.viewer_involved) && !match.viewer_override;
  const conflict = match.viewer_involved ? { kind: "involved", override: Boolean(match.viewer_override) } : null;
  return (
    <li className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center" data-testid={`staffel-game-${match.id}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] uppercase tracking-wider text-white/60">
          <span className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 font-bold ${STATE_TONE[state.tone]}`} data-testid={`staffel-game-state-${match.id}`}>{state.text}</span>
          <span className="tabular-nums">{DONE_TONE.has(state.tone) ? "" : matchWhen(match)}</span>
        </div>
        <p className="mt-1.5 flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm font-semibold text-white">
          <span className={`[overflow-wrap:anywhere] ${score.winner && score.winner !== sides[0]?.id ? "text-white/60" : ""}`}>{sides[0]?.name || "noch offen"}</span>
          <span className="shrink-0 font-heading text-base font-black tabular-nums text-white" data-testid={`staffel-game-score-${match.id}`}>{score.text || "–"}</span>
          <span className={`[overflow-wrap:anywhere] ${score.winner && score.winner !== sides[1]?.id ? "text-white/60" : ""}`}>{sides[1]?.name || "noch offen"}</span>
        </p>
        {chips.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Stand auf der Matchseite" data-testid={`staffel-game-chips-${match.id}`}>
            {chips.map((chip) => (
              <li key={chip.key} className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[11px] font-semibold ${CHIP_TONE[chip.tone]}`}
                data-testid={`staffel-game-chip-${match.id}-${chip.key}`}>{chip.text}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        {canResults && filled && own ? <OwnTeamNote testId={`staffel-game-own-${match.id}`} /> : null}
        {canResults && filled && !own ? (
          <button type="button" onClick={() => onResult(match.id)} data-testid={`staffel-game-result-${match.id}`}
            className={`${BUTTON} tls-btn tls-btn--secondary`}>
            <PenLine className="h-3.5 w-3.5" aria-hidden="true" /> {(match.results || []).length ? "Ergebnis korrigieren" : "Ergebnis eintragen"}
          </button>
        ) : null}
        {canResults && filled ? <DoubleNoShowAction match={match} conflict={conflict} onDone={onReload} /> : null}
        <Link to={`/matches/${encodeURIComponent(match.id)}`} data-testid={`staffel-game-open-${match.id}`} className={`${BUTTON} tls-btn tls-btn--quiet`}>
          Zum Spiel <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </li>
  );
}

/** Offen ist eine Woche, solange darin etwas aussteht oder ein Chip warnt - gespielte Wochen klappen zu. */
const weekNeedsLook = (week) => week.matches.some((match) => !DONE_TONE.has(gameState(match).tone) || gameChips(match).some((chip) => chip.tone === "warn"));

export function StaffelGamesTab({ tournament, registrations = [], matches = [], onReload }) {
  const [resultFor, setResultFor] = useState(null);
  const undo = useResultUndo({ onDone: onReload });
  const byId = new Map(registrations.map((row) => [row.id, row]));
  const weeks = gamesByWeek(matches);
  const resultsOpen = RESULTS_OPEN.has(tournament.status);
  const total = weeks.reduce((sum, week) => sum + week.matches.length, 0);
  const played = weeks.reduce((sum, week) => sum + week.matches.filter((match) => DONE_TONE.has(gameState(match).tone)).length, 0);
  const firstOpen = weeks.find(weekNeedsLook)?.number;

  return (
    <div className="space-y-4">
      <div id="ergebnisse" className="scroll-mt-24 rounded-sm border border-white/10 bg-[#121212] p-4">
        <h2 className="font-heading text-xl font-black uppercase" data-testid="staffel-games-count">
          Spiele <span className="tabular-nums text-white/60">{total ? `${played} von ${total} gespielt` : ""}</span>
        </h2>
        <p className="mt-1 text-sm text-white/60">
          {resultsOpen
            ? "Check-in, Veto, Vorfälle und Verfahren laufen auf der Matchseite. Hier trägst du Ergebnisse ein und korrigierst sie."
            : staffelBeforeStart(tournament)
              ? "Feste Spiele entstehen mit „Liga starten“. Die Vorschau steht im Reiter Spielplan."
              : "Ergebnisse trägt man ein, solange die Staffel im Spielbetrieb oder pausiert ist."}
        </p>
      </div>

      {!weeks.length ? (
        <p className="rounded-sm border border-white/10 bg-[#121212] px-4 py-10 text-center text-sm text-white/60" data-testid="staffel-games-empty">Noch keine festen Spiele.</p>
      ) : weeks.map((week) => {
        const done = week.matches.filter((match) => DONE_TONE.has(gameState(match).tone)).length;
        // Was in der Woche noch jemanden braucht (warnender Chip) - schon im zugeklappten Kopf sichtbar.
        const warns = week.matches.filter((match) => gameChips(match).some((chip) => chip.tone === "warn")).length;
        return (
          <details key={week.number ?? "ohne"} open={week.number === firstOpen || weekNeedsLook(week)} className="group min-w-0 overflow-hidden rounded-sm border border-white/10 bg-[#121212]"
            data-testid={`staffel-week-${week.number ?? "ohne"}`}>
            <summary className="flex min-h-[44px] cursor-pointer list-none flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 hover:bg-white/5 [&::-webkit-details-marker]:hidden">
              <span className="shrink-0 whitespace-nowrap font-heading text-base font-black uppercase">{week.number ? `Spielwoche ${week.number}` : "Ohne Spielwoche"}</span>
              <span className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-white/60 tabular-nums">
                {warns ? <span className="font-semibold text-warn" data-testid={`staffel-week-warn-${week.number ?? "ohne"}`}>{warns === 1 ? "1 Spiel mit offenem Punkt" : `${warns} Spiele mit offenem Punkt`}</span> : null}
                {done === week.matches.length ? "alle gespielt" : `${done} von ${week.matches.length} gespielt`}
                <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
              </span>
            </summary>
            <ul className="divide-y divide-white/5 border-t border-white/10">
              {week.matches.map((match) => (
                <GameRow key={match.id} match={{ ...match, tournament_id: match.tournament_id || tournament.id }} byId={byId}
                  canResults={resultsOpen && matchRights(tournament, match).results} onResult={setResultFor} onReload={onReload} />
              ))}
            </ul>
          </details>
        );
      })}

      {resultFor ? <ResultWindowLoader matchId={resultFor} onClose={() => setResultFor(null)} onSaved={undo.start} /> : null}
      <ResultUndoBar undo={undo} />
    </div>
  );
}

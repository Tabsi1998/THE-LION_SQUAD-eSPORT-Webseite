import { useId, useMemo, useState } from "react";
import { METALS } from "@/components/tls/TrophyShelf";
import { formatNumber } from "@/lib/standingsTable";
import { roundLabel, roundWhen } from "@/lib/referenceCalendar";
import { finalNeeds, maxRoundPoints } from "@/lib/finalCalc";
import { countLabel, nameOf, roundColumns, schemeLabel, tiebreakLabel } from "@/lib/referenceSeriesTable";
import "./referenceSeries.css";

// Bausteine der Serienseite (#1745): Rundenfortschritt mit nächstem Termin, Regeln, Finalrechner (ausdrücklich ein
// Richtwert) und das Finale als eigene Runde mit Endplatzierung (Podest in den Farben der Pokale).

// Wörter des Fortschritts je Art der Serie: eine Rennliga (#1746) zählt Rennen statt Runden.
export const PROGRESS_WORDS = {
  series: { rounds: "Runden", next: "Nächstes Turnier: " },
  racing: { rounds: "Rennen", next: "Nächstes Rennen: " },
};

/** Ein Feld je Wertungsrunde (gewertet in Cyan), das Finale in Gold am Ende; darunter der nächste Termin. */
export function SeriesProgress({ progress, rounds, words = PROGRESS_WORDS.series }) {
  const steps = roundColumns(rounds);
  const final = (rounds || []).find((round) => round.kind === "final");
  const next = progress?.next;
  return (
    <section className="mt-8" aria-labelledby="series-progress" data-testid="series-progress">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 id="series-progress" className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/55">Fortschritt</h2>
        <p className="text-sm text-white/80 tabular-nums">
          <span className="font-display text-xl font-bold text-white">{progress?.scored || 0}</span>
          <span className="text-white/50"> von {progress?.total || 0} {words.rounds} gewertet</span>
          {progress?.cancelled > 0 && <span className="text-white/40"> · {progress.cancelled} abgesagt</span>}
        </p>
      </div>
      {(steps.length > 0 || final) && (
        <div className="mt-3 flex gap-1" aria-hidden="true">
          {steps.map((round) => <span key={round.id} className="tls-series-step" data-state={round.state} title={`${roundLabel(round)} · ${roundWhen(round)}`} />)}
          {final && <span className="tls-series-step" data-kind="final" data-state={final.state} title={`Finale · ${roundWhen(final)}`} />}
        </div>
      )}
      {next && (
        <p className="mt-3 text-sm text-white/70" data-testid="series-next">
          <span className="text-white/45">{next.kind === "final" ? "Als Nächstes das Finale: " : words.next}</span>
          <span className="text-white font-semibold">{roundLabel(next)}</span>
          <span className="tabular-nums"> · {roundWhen(next)}</span>
          {next.venue && <span> · {next.venue}</span>}
        </p>
      )}
    </section>
  );
}

/** Punkteschlüssel, was zählt, Vorrang bei Gleichstand und Finalgrenze. */
export function SeriesRules({ rules }) {
  const items = [
    ["Punkte", schemeLabel(rules)],
    ["Wertung", countLabel(rules)],
    ["Gleichstand", tiebreakLabel(rules)],
  ];
  if (rules?.final_top_n) items.push(["Finale", `Die besten ${rules.final_top_n} der Gesamtwertung`]);
  return (
    <dl className="mt-6 grid gap-x-6 gap-y-2 sm:grid-cols-2 text-sm" data-testid="series-rules">
      {items.map(([term, value]) => (
        <div key={term} className="flex gap-3 min-w-0">
          <dt className="w-24 shrink-0 text-[11px] font-bold uppercase tracking-[0.16em] text-white/45 pt-0.5">{term}</dt>
          <dd className="text-white/80 min-w-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function needsText(result, topN) {
  if (result.status === "qualified") return "Nach der letzten Runde im Finale.";
  if (result.status === "out") return "Nach der letzten Runde nicht im Finale.";
  if (result.status === "inside") {
    return result.lead == null
      ? `Innerhalb der Finalgrenze (Top ${topN}).`
      : `Innerhalb der Finalgrenze – ${formatNumber(result.lead)} Punkte vor Platz ${topN + 1}.`;
  }
  const rounds = result.remaining === 1 ? "in der letzten offenen Runde" : `im Schnitt je offener Runde (${result.remaining} offen)`;
  if (result.gap === 0) return "Punktgleich mit der Finalgrenze – der Vorrang bei Gleichstand entscheidet.";
  const text = `Bis zur Finalgrenze fehlen ${formatNumber(result.gap)} Punkte: etwa ${formatNumber(result.perRound)} ${rounds}.`;
  return result.reachable === false ? `${text} Das ist mehr, als eine Runde bringt – aus eigener Kraft kaum noch zu schaffen.` : text;
}

/** „Was braucht … fürs Finale?“ - ein Richtwert aus dem gespeicherten Stand. */
export function FinalCalculator({ standings, rules, progress }) {
  const selectId = useId();
  const rows = useMemo(() => (standings?.rows || []).filter((row) => !row.name_hidden && row.name), [standings]);
  const topN = Number(rules?.final_top_n) || null;
  const preset = rows.find((row) => row.club_member) || rows.find((row) => row.rank > topN) || rows[0];
  const [key, setKey] = useState(preset?.key || "");
  if (!topN || rows.length === 0) return null;
  const row = rows.find((item) => item.key === key) || preset;
  const result = finalNeeds(row, standings.rows, { topN, remaining: progress?.remaining || 0, maxPerRound: maxRoundPoints(rules) });
  return (
    <section className="mt-6 border border-white/10 rounded-md bg-[var(--tls-surface-1)] p-4" aria-labelledby={`${selectId}-title`} data-testid="series-final-calc">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 id={`${selectId}-title`} className="font-heading text-lg font-black uppercase">Was braucht es fürs Finale?</h3>
        <span className="tls-series-badge tls-series-badge--guess">Richtwert</span>
      </div>
      <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <label htmlFor={selectId} className="text-sm text-white/60">Spieler</label>
        <select id={selectId} value={row.key} onChange={(event) => setKey(event.target.value)} className="min-h-[40px] bg-black/40 border border-white/15 rounded-md px-3 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#29B6E8]" data-testid="series-final-calc-select">
          {rows.map((item) => <option key={item.key} value={item.key}>{`${item.rank}. ${nameOf(item)}`}</option>)}
        </select>
      </div>
      <p className="mt-3 text-sm text-white" aria-live="polite" data-testid="series-final-calc-result">{needsText(result, topN)}</p>
      <p className="mt-2 text-[12px] text-white/45">Richtwert aus dem aktuellen Stand – ohne Streichergebnisse und ohne die Punkte, die die anderen noch holen.</p>
    </section>
  );
}

const PODIUM = { 1: METALS.gold, 2: METALS.silver, 3: METALS.bronze };

/** Das Finale als eigene Runde: Termin und, sobald gewertet, die Endplatzierung. */
export function SeriesFinal({ final }) {
  if (!final) return null;
  const { round, rows } = final;
  return (
    <section className="mt-12" aria-labelledby="series-final" data-testid="series-final">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 id="series-final" className="font-heading text-2xl font-black uppercase text-[var(--tls-honor)]">Finale</h2>
        <p className="text-sm text-white/60 tabular-nums">{[roundWhen(round), round.venue].filter(Boolean).join(" · ")}</p>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-white/55">Die Endplatzierung steht hier nach dem Finale.</p>
      ) : (
        <ol className="mt-4 divide-y divide-white/5 border-y border-white/10">
          {rows.map((row) => {
            const metal = PODIUM[row.place];
            return (
              <li key={row.key} className="py-2.5 flex items-center gap-3" data-testid="series-final-row" data-club={row.club_member ? "true" : undefined}>
                <span className={`w-10 shrink-0 font-display text-lg font-bold tabular-nums ${metal ? metal.text : "text-white/70"}`}>
                  {row.place ? `${row.place}.` : "–"}
                  {metal && <span className="sr-only"> ({metal.label})</span>}
                </span>
                <span className={`min-w-0 flex-1 ${row.name_hidden ? "text-white/40 italic" : "text-white"}`}>{nameOf(row)}</span>
                {row.club_member && <span className="tls-standing-me">Verein</span>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

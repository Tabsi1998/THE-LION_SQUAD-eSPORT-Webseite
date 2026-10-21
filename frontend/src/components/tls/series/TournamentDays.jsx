import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { formatNumber } from "@/lib/standingsTable";
import { roundLabel, roundWhen } from "@/lib/referenceCalendar";
import { nameOf, roundColumns } from "@/lib/referenceSeriesTable";
import { bonusLabels, dayRounds, dayTable, hasLobbies, isDoubleUp, lobbies, placeTone, playerDays, roundPlace, roundsOfDay } from "@/lib/seriesDays";
import "./referenceSeries.css";

// Turniertage einer Turnierserie (#1961): je Termin die Runden R1…Rn mit Platzfarben (Gold, Silber, Bronze, Top 4
// grün), die Tagessumme (GES P) und die Saisonpunkte daraus; wo Lobbys eingetragen sind, die Lobby-Ansicht je Runde wie
// beim Veranstalter; darunter das Spieler-Detail mit Tages- und Saisonpunkten. Double Up zeigt den Partner („mit …“).
// Am Handy Karten statt der breiten Tabelle. Fremde Namen sind reiner Text, nur Vereinsmitglieder verlinken im Detail
// auf ihr Profil.

const CHIP = "min-h-[36px] px-3 rounded-md border text-[12px] font-bold uppercase tracking-[0.12em] transition-colors whitespace-nowrap active:scale-[0.97]";
const CHIP_ON = "border-[#29B6E8]/70 bg-[#29B6E8]/10 text-[#29B6E8]";
const CHIP_OFF = "border-white/15 text-white/65 hover:text-white hover:border-white/30";

/** Punkte einer Runde mit Platzfarbe. Den Platz aus den Punkten ableiten (`infer`) geht nur bei Einzelspielern - im
 * Double Up gelten für ein Team andere Punkte, dort zählt nur ein eingetragener Platz. */
function RoundCell({ entry, index, scheme, infer = true }) {
  if (!entry) return <span className="text-white/20" aria-label={`R${index + 1}: nicht gespielt`}>–</span>;
  const place = infer ? roundPlace(entry, scheme) : entry.place || null;
  const label = `R${index + 1}: ${formatNumber(entry.points)} ${Number(entry.points) === 1 ? "Punkt" : "Punkte"}${place ? `, Platz ${place}` : ""}${entry.lobby ? `, Lobby ${entry.lobby}` : ""}`;
  return (
    <span className="tls-day-cell" data-tone={placeTone(place) || undefined} title={label} data-testid="series-day-round">
      <span aria-hidden="true">{formatNumber(entry.points)}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function Badges({ item, bonuses }) {
  const labels = bonusLabels(item.bonus_keys, bonuses);
  if (!labels.length && !(item.marks || []).includes("left")) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {(item.marks || []).includes("left") && <span className="tls-series-badge tls-day-badge--left" data-testid="series-day-left">Ausgestiegen</span>}
      {labels.map((label) => <span key={label} className="tls-series-badge tls-day-badge--bonus" data-testid="series-day-bonus">{label}</span>)}
    </span>
  );
}

function PersonName({ item, onOpen }) {
  const name = nameOf(item);
  return (
    <span className="flex flex-col min-w-0">
      <span className="flex items-center gap-2 min-w-0">
        {item.name_hidden ? (
          <span className="tls-standing-name text-white/40 italic">{name}</span>
        ) : (
          <button type="button" onClick={() => onOpen(item.key)} className="tls-standing-name tls-day-name text-left text-white font-medium" data-testid="series-day-name">{name}</button>
        )}
        {item.club_member && <span className="tls-standing-me">Verein</span>}
      </span>
      {item.partner && <span className="text-[11px] text-white/50" data-testid="series-day-partner">mit {nameOf(item.partner)}</span>}
    </span>
  );
}

function SeasonPoints({ item }) {
  return (
    <span className={item.dropped ? "tls-series-dropped" : undefined} title={item.dropped ? "Gestrichen" : undefined}>
      {formatNumber(item.points)}
      {item.dropped && <span className="sr-only"> (gestrichen)</span>}
    </span>
  );
}

function DayTableView({ table, count, scheme, bonuses, onOpen }) {
  const columns = Array.from({ length: count }, (_, index) => index);
  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- eine scrollbare Fläche muss per Tastatur erreichbar sein (axe: scrollable-region-focusable) */}
      <div role="region" aria-label="Tagesansicht" tabIndex={0} className="tls-standings hidden md:block mt-4 border border-white/10 rounded-md bg-[var(--tls-surface-1)] tls-swipe pb-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#29B6E8]" data-testid="series-day-table">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-[11px] uppercase tracking-[0.12em] text-white/50">
            <tr className="border-b border-white/10">
              <th scope="col" className="text-left pl-4 pr-1 py-2.5 w-12 font-semibold">#</th>
              <th scope="col" className="text-left px-2 py-2.5 font-semibold">Name</th>
              {columns.map((index) => <th key={index} scope="col" className="px-1.5 py-2.5 text-center font-semibold">R{index + 1}</th>)}
              <th scope="col" title="Summe der Runden" className="px-2 py-2.5 text-right font-semibold">GES P</th>
              <th scope="col" title="Saisonpunkte aus dem Tagesplatz" className="pr-4 pl-2 py-2.5 text-right font-semibold">Pkt</th>
            </tr>
          </thead>
          <tbody>
            {table.map((item, position) => (
              <tr key={item.key} className="tls-standing-row tls-series-row" style={{ "--i": Math.min(position, 12) }} data-testid="series-day-row" data-mine={item.club_member ? "true" : undefined}>
                <td className="pl-4 pr-1 py-2 align-middle font-display text-base font-bold text-white">{item.place ?? "–"}</td>
                <th scope="row" className="px-2 py-2 align-middle min-w-[11rem] text-left font-normal">
                  <PersonName item={item} onOpen={onOpen} />
                  <Badges item={item} bonuses={bonuses} />
                </th>
                {columns.map((index) => (
                  <td key={index} className="px-1.5 py-2 text-center align-middle text-white/80"><RoundCell entry={item.day_rounds?.[index]} index={index} scheme={scheme} infer={!item.partner} /></td>
                ))}
                <td className="px-2 py-2 text-right align-middle font-display text-base font-bold text-white" data-testid="series-day-total">{item.day_points ?? "–"}</td>
                <td className="pr-4 pl-2 py-2 text-right align-middle text-white/80"><SeasonPoints item={item} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ol className="md:hidden mt-4 space-y-2" data-testid="series-day-cards">
        {table.map((item, position) => (
          <li key={item.key} className="tls-standing-row tls-series-row border border-white/10 rounded-md bg-[var(--tls-surface-1)] px-3 py-2.5" style={{ "--i": Math.min(position, 12) }} data-testid="series-day-card" data-mine={item.club_member ? "true" : undefined}>
            <div className="flex items-start gap-3">
              <span className="w-7 shrink-0 font-display text-lg font-bold text-white tabular-nums">{item.place ?? "–"}</span>
              <span className="min-w-0 flex-1 space-y-1">
                <PersonName item={item} onOpen={onOpen} />
                <Badges item={item} bonuses={bonuses} />
              </span>
              <span className="flex flex-col items-end shrink-0 tabular-nums">
                <span className="font-display text-lg font-bold text-white">{item.day_points ?? "–"}</span>
                <span className="text-[11px] text-white/50"><SeasonPoints item={item} /> Pkt</span>
              </span>
            </div>
            {columns.length > 0 && (
              <div className="mt-1.5 pl-10 flex flex-wrap gap-1 text-[12px]">
                {columns.map((index) => <RoundCell key={index} entry={item.day_rounds?.[index]} index={index} scheme={scheme} infer={!item.partner} />)}
              </div>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

function LobbyView({ table, count, scheme, onOpen }) {
  const [index, setIndex] = useState(0);
  const round = Math.min(index, Math.max(count - 1, 0));
  const groups = lobbies(table, round, scheme) || [];
  return (
    <div className="mt-4" data-testid="series-lobbies">
      <div className="flex gap-1.5 tls-swipe tls-swipe--room pb-1" role="group" aria-label="Runde">
        {Array.from({ length: count }, (_, at) => (
          <button key={at} type="button" aria-pressed={at === round} onClick={() => setIndex(at)} className={`${CHIP} ${at === round ? CHIP_ON : CHIP_OFF}`} data-testid="series-lobby-round">R{at + 1}</button>
        ))}
      </div>
      {groups.length === 0 ? (
        <p className="mt-3 text-sm text-white/55">Für diese Runde sind keine Lobbys eingetragen.</p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <section key={group.lobby} className="border border-white/10 rounded-md bg-[var(--tls-surface-1)] p-3" aria-label={`Lobby ${group.lobby}`} data-testid="series-lobby">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/55">Lobby {group.lobby}</h3>
              <ol className="mt-2 space-y-1">
                {group.members.map(({ item, entry, place }) => (
                  <li key={item.key} className="flex items-center gap-2 text-sm tabular-nums">
                    <span className="tls-day-cell w-7" data-tone={placeTone(place) || undefined}>{place ?? "–"}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {item.name_hidden ? <span className="text-white/40 italic">{nameOf(item)}</span>
                        : <button type="button" onClick={() => onOpen(item.key)} className="tls-day-name text-left text-white">{nameOf(item)}</button>}
                    </span>
                    <span className="text-white/70">{formatNumber(entry.points)}</span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerDetail({ rows, row, days, scheme, bonuses, topN, onPick, detailRef }) {
  const selectId = useId();
  const named = rows.filter((item) => !item.name_hidden && item.name);
  if (!row) return null;
  const summary = playerDays(row, days);
  const count = Math.max(0, ...summary.days.map((day) => (day.result?.day_rounds || []).length));
  return (
    <section ref={detailRef} className="tls-day-detail mt-6 border border-white/10 rounded-md bg-[var(--tls-surface-1)] p-4" aria-labelledby={`${selectId}-title`} data-testid="series-player-detail">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <h3 id={`${selectId}-title`} className="font-heading text-lg font-black uppercase">Spieler-Detail</h3>
        <label htmlFor={selectId} className="sr-only">Spieler</label>
        <select id={selectId} value={row.key} onChange={(event) => onPick(event.target.value)} className="min-h-[40px] sm:ml-auto bg-black/40 border border-white/15 rounded-md px-3 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#29B6E8]" data-testid="series-player-select">
          {named.map((item) => <option key={item.key} value={item.key}>{`${item.rank}. ${nameOf(item)}`}</option>)}
        </select>
      </div>
      <div className="tls-day-detail__head mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1" key={row.key}>
        <span className="text-white font-semibold text-base">
          {row.club_member && row.profile_slug ? <Link to={`/members/${row.profile_slug}`} className="hover:text-[#29B6E8]">{nameOf(row)}</Link> : nameOf(row)}
        </span>
        <span className="text-sm text-white/70 tabular-nums" data-testid="series-player-summary">
          Platz {row.rank} · {formatNumber(row.points)} Saisonpunkte{row.bonus_points ? ` (davon ${formatNumber(row.bonus_points)} Sonderbonus)` : ""} · {summary.played} {summary.played === 1 ? "Turniertag" : "Turniertage"} · {summary.wins} {summary.wins === 1 ? "Sieg" : "Siege"} · {`${summary.topN(topN)}×\u00a0Top\u00a0${topN}`}
        </span>
      </div>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- eine scrollbare Fläche muss per Tastatur erreichbar sein (axe: scrollable-region-focusable) */}
      <div role="region" aria-label={`Turniertage von ${nameOf(row)}`} tabIndex={0} className="relative mt-3 tls-swipe pb-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#29B6E8] rounded-sm">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-[11px] uppercase tracking-[0.12em] text-white/50">
            <tr className="border-b border-white/10">
              <th scope="col" className="text-left pr-2 py-2 font-semibold">Termin</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Platz</th>
              {Array.from({ length: count }, (_, index) => <th key={index} scope="col" className="hidden sm:table-cell px-1 py-2 text-center font-semibold">R{index + 1}</th>)}
              <th scope="col" className="px-2 py-2 text-right font-semibold">GES P</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Pkt</th>
            </tr>
          </thead>
          <tbody>
            {summary.days.map(({ round, result }) => (
              <tr key={round.id} className="border-b border-white/5 last:border-0" data-testid="series-player-day">
                <th scope="row" className="text-left pr-2 py-2 font-normal whitespace-nowrap">
                  <span className="font-semibold text-white">{roundLabel(round)}</span>
                  {result?.partner && <span className="block text-[11px] text-white/50">Double Up mit {nameOf(result.partner)}</span>}
                  {result && <Badges item={result} bonuses={bonuses} />}
                  {/* Am Handy stehen die Runden unter dem Termin statt in eigenen Spalten. */}
                  {result && count > 0 && (
                    <span className="sm:hidden mt-1 flex flex-wrap gap-1 text-[12px]" aria-hidden="true">
                      {Array.from({ length: count }, (_, index) => <RoundCell key={index} entry={result.day_rounds?.[index]} index={index} scheme={scheme} infer={!result.partner} />)}
                    </span>
                  )}
                </th>
                {result ? (
                  <>
                    <td className="px-2 py-2 text-right font-display font-bold text-white">{result.place ?? "–"}</td>
                    {Array.from({ length: count }, (_, index) => (
                      <td key={index} className="hidden sm:table-cell px-1 py-2 text-center"><RoundCell entry={result.day_rounds?.[index]} index={index} scheme={scheme} infer={!result.partner} /></td>
                    ))}
                    <td className="px-2 py-2 text-right font-bold text-white">{result.day_points ?? "–"}</td>
                    <td className="px-2 py-2 text-right text-white/80"><SeasonPoints item={result} />{result.bonus ? <span className="text-[11px] text-[var(--tls-honor)]"> +{formatNumber(result.bonus)}</span> : null}</td>
                  </>
                ) : (
                  <>
                    <td colSpan={3} className="sm:hidden px-2 py-2 text-white/35">nicht dabei</td>
                    <td colSpan={count + 3} className="hidden sm:table-cell px-2 py-2 text-white/35">nicht dabei</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Turniertage der Saison - nur, wenn Ergebnisse Runden oder eine Tagessumme tragen. `standings`, `rounds`, `rules` wie
 * die Gesamtwertung (SeriesStandings). */
export function TournamentDays({ standings, rounds, rules }) {
  const rows = useMemo(() => standings?.rows || [], [standings]);
  const days = useMemo(() => dayRounds(roundColumns(rounds), rows), [rounds, rows]);
  const [dayId, setDayId] = useState(null);
  const [view, setView] = useState("table");
  const [playerKey, setPlayerKey] = useState(null);
  const detailRef = useRef(null);
  const [opened, setOpened] = useState(0);
  useEffect(() => {
    if (opened) detailRef.current?.scrollIntoView?.({ block: "nearest", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [opened]);
  if (!days.length) return null;
  const current = days.find((round) => round.id === dayId) || days[days.length - 1];
  const table = dayTable(rows, current.id);
  const count = roundsOfDay(table);
  const scheme = rules?.day_rounds?.points_by_place || [];
  const bonuses = rules?.custom_bonuses || [];
  const lobbyData = hasLobbies(table);
  const showLobbies = view === "lobbies" && lobbyData;
  const named = rows.filter((row) => !row.name_hidden && row.name);
  const player = rows.find((row) => row.key === playerKey) || named.find((row) => row.club_member) || named[0] || null;
  const open = (key) => {
    setPlayerKey(key);
    setOpened((value) => value + 1);
  };
  return (
    <section className="mt-12" aria-labelledby="series-days" data-testid="series-days">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 id="series-days" className="font-heading text-2xl font-black uppercase">Turniertage</h2>
        {lobbyData && (
          <div className="flex gap-1.5" role="group" aria-label="Ansicht">
            <button type="button" aria-pressed={!showLobbies} onClick={() => setView("table")} className={`${CHIP} ${!showLobbies ? CHIP_ON : CHIP_OFF}`} data-testid="series-day-view-table">Tabelle</button>
            <button type="button" aria-pressed={showLobbies} onClick={() => setView("lobbies")} className={`${CHIP} ${showLobbies ? CHIP_ON : CHIP_OFF}`} data-testid="series-day-view-lobbies">Lobbys</button>
          </div>
        )}
      </div>
      <div className="mt-4 flex gap-1.5 tls-swipe tls-swipe--room pb-1" role="group" aria-label="Turniertag">
        {days.map((round) => (
          <button key={round.id} type="button" aria-pressed={round.id === current.id} onClick={() => setDayId(round.id)} title={roundWhen(round)}
            className={`${CHIP} ${round.id === current.id ? CHIP_ON : CHIP_OFF}`} data-testid="series-day-pick">{roundLabel(round)}</button>
        ))}
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/60" data-testid="series-day-head">
        <span className="tabular-nums">{roundWhen(current)}</span>
        {isDoubleUp(table) && <span className="tls-series-badge tls-day-badge--duo" data-testid="series-day-double-up">Double Up</span>}
        <span>{count ? `${count} ${count === 1 ? "Runde" : "Runden"} · GES P bestimmt den Tagesplatz, daraus die Saisonpunkte` : "GES P bestimmt den Tagesplatz, daraus die Saisonpunkte"}</span>
      </p>
      {showLobbies
        ? <LobbyView table={table} count={count} scheme={scheme} onOpen={open} />
        : <DayTableView table={table} count={count} scheme={scheme} bonuses={bonuses} onOpen={open} />}
      <PlayerDetail rows={rows} row={player} days={days} scheme={scheme} bonuses={bonuses} topN={rules?.tiebreak_top_n || 4} onPick={setPlayerKey} detailRef={detailRef} />
    </section>
  );
}

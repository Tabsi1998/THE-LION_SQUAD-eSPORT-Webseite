import { useRef } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Star, Timer } from "lucide-react";
import { CountryFlag } from "@/components/tls/CountryFlag";
import { CountUp } from "@/components/tls/motion/CountUp";
import { COUNT_UP_MS, COUNT_UP_STAGGER_MS } from "@/lib/countUp";
import { formatNumber } from "@/lib/standingsTable";
import { nameOf } from "@/lib/referenceSeriesTable";
import {
  COLUMN_LABELS, gapText, medalOf, mobileMain, mobileSub, movement, movementLabel, neighbourLabel, penaltyLabel,
  posLabel, roundEyebrow, roundHeading, roundPath, roundSubline, rowBadges, timeText, visibleColumns,
} from "@/lib/roundResults";
import "./roundResults.css";

// Bausteine der Ergebnisseite einer Runde (#1950): Kopf mit Flagge und Pfeilen, Zusammenfassung, Reiter je Lauf, die
// Tabelle am PC und die Liste am Handy. Zeiten und Abstände zählen beim Öffnen und bei jedem Reiterwechsel hoch
// (CountUp, je Zeile 25 ms versetzt); am Ende leuchten Pole und schnellste Runde einmal auf, Vereinszeilen glänzen kurz.

const MAX_STAGGER_ROWS = 24;
const GLOW = new Set(["pole", "fastest_lap"]);

function rowDelay(index) {
  return Math.min(index, MAX_STAGGER_ROWS) * COUNT_UP_STAGGER_MS;
}

function glowDelay(index) {
  return `${rowDelay(index) + COUNT_UP_MS}ms`;
}

function teamStyle(row) {
  return row?.team_color ? { color: row.team_color } : undefined;
}

/** Kopf: Flagge, Runde mit Tag, Name (Land) und Strecke, dazu vorige und nächste Runde. */
export function RoundHead({ page, lineageSlug, seasonSlug }) {
  const round = page.round || {};
  const { heading, sub } = roundHeading(round);
  const link = (item, dir) => {
    const label = dir === "prev" ? "Vorige" : "Nächste";
    // Am Handy nur Pfeile (44 px) neben dem Namen, eine fehlende Richtung fällt dort weg; am PC mit Runde und Ort.
    if (!item) {
      return (
        <span className="tls-round-nav hidden sm:inline-flex" aria-disabled="true" data-testid={`round-${dir}`}>
          {dir === "prev" && <ChevronLeft className="w-4 h-4" aria-hidden="true" />}
          {label}
          {dir === "next" && <ChevronRight className="w-4 h-4" aria-hidden="true" />}
        </span>
      );
    }
    const text = neighbourLabel(item);
    return (
      <Link to={roundPath(lineageSlug, seasonSlug, item.number)} className="tls-btn tls-btn--quiet tls-round-nav inline-flex" aria-label={`${label} Runde: ${text}`} data-testid={`round-${dir}`}>
        {dir === "prev" && <ChevronLeft className="w-[18px] h-[18px] sm:w-4 sm:h-4" aria-hidden="true" />}
        <span className="hidden sm:inline">{text}</span>
        {dir === "next" && <ChevronRight className="w-[18px] h-[18px] sm:w-4 sm:h-4" aria-hidden="true" />}
      </Link>
    );
  };
  return (
    <header className="flex items-center justify-between gap-3 sm:gap-4 sm:flex-wrap" data-testid="round-head">
      <div className="flex items-center gap-3 sm:gap-[18px] min-w-0 flex-1 sm:flex-initial">
        {round.country_code && <span className="tls-round-flag flex shrink-0"><CountryFlag code={round.country_code} size="xl" /></span>}
        <div className="flex flex-col min-w-0">
          <span className="hidden sm:block text-xs font-bold uppercase tracking-[0.22em] text-[#29B6E8] tabular-nums" data-testid="round-eyebrow">{roundEyebrow(round)}</span>
          <h1 className="font-heading font-black uppercase leading-none text-[20px] sm:text-[clamp(28px,4vw,44px)] sm:mt-1 [overflow-wrap:anywhere]">{heading}</h1>
          {sub && <span className="hidden sm:block mt-1 text-[15px] text-white/65">{sub}</span>}
          {/* Am Handy eine Zeile unter dem Namen: Kürzel, Tag und Strecke. */}
          <span className="sm:hidden mt-1 text-[13px] text-white/65 tabular-nums" data-testid="round-subline">{roundSubline(round, sub)}</span>
        </div>
      </div>
      <nav aria-label="Runden" className="flex shrink-0 gap-2">
        {link(page.previous, "prev")}
        {link(page.next, "next")}
      </nav>
    </header>
  );
}

const TONES = { winner: "honor", pole: "pole", fastest_lap: "fastest", driver_of_the_day: "honor", best_club: "brand" };

/** Zusammenfassung: Sieger, Pole, schnellste Runde, Fahrer des Tages, bester Vereinsfahrer - Zeiten zählen hoch. */
export function RoundSummary({ cards, playKey }) {
  if (!cards.length) return null;
  return (
    <ul className="tls-round-facts tls-swipe" aria-label="Zusammenfassung der Runde" data-testid="round-summary">
      {cards.map((card) => (
        <li key={card.key} className="tls-round-fact" data-key={card.key} data-tone={TONES[card.key]} data-testid={`round-fact-${card.key}`}>
          <span className="tls-round-fact__label">{card.label}</span>
          <span className="tls-round-fact__value" style={card.named ? undefined : teamStyle({ team_color: card.color })}>
            {card.named && card.profile ? <Link to={`/members/${card.profile}`} className="hover:text-[#29B6E8]">{card.value}</Link> : card.value}
          </span>
          {(card.count || card.sub) && (
            <span className="tls-round-fact__sub">
              {card.count ? <CountUp value={card.count} playKey={playKey} /> : card.sub}
              {card.count && card.sub ? ` · ${card.sub}` : ""}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Reiter je Lauf: Pfeiltasten wechseln, der gewählte steht in der Adresse. */
export function SessionTabs({ sessions, current, onPick, panelId }) {
  const listRef = useRef(null);
  const onKey = (event) => {
    const index = sessions.findIndex((item) => item.key === current);
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    let next = null;
    if (step) next = sessions[(index + step + sessions.length) % sessions.length];
    if (event.key === "Home") next = sessions[0];
    if (event.key === "End") next = sessions[sessions.length - 1];
    if (!next) return;
    event.preventDefault();
    onPick(next.key);
    listRef.current?.querySelector(`[data-session="${next.key}"]`)?.focus();
  };
  if (sessions.length < 2) return null;
  return (
    <div ref={listRef} role="tablist" aria-label="Läufe dieser Runde" className="tls-round-tabs tls-swipe" data-testid="round-tabs">
      {sessions.map((item) => {
        const selected = item.key === current;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={`round-tab-${item.key}`}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            className="tls-round-tab"
            data-session={item.key}
            data-testid={`round-tab-${item.key}`}
            onClick={() => onPick(item.key)}
            onKeyDown={onKey}
          >
            {item.label}
            {item.time && <span className="tls-round-tab__time">{item.time}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Badge({ badge, short = false, glow, index }) {
  const Icon = badge.key === "fastest_lap" ? Timer : badge.key === "driver_of_the_day" ? Star : null;
  return (
    <span
      className="tls-round-badge"
      data-badge={badge.key}
      data-glow={glow && GLOW.has(badge.key) ? "true" : undefined}
      style={glow && GLOW.has(badge.key) ? { "--tls-glow-delay": glowDelay(index) } : undefined}
      data-testid="round-badge"
    >
      {Icon && <Icon strokeWidth={2.5} aria-hidden="true" fill={badge.key === "driver_of_the_day" ? "currentColor" : "none"} />}
      {short ? badge.short : badge.label}
    </span>
  );
}

function DriverName({ row }) {
  const name = nameOf(row);
  if (row.club_member && row.profile_slug && !row.name_hidden) {
    return <Link to={`/members/${row.profile_slug}`} className="hover:text-[#29B6E8] focus-visible:text-[#29B6E8]">{name}</Link>;
  }
  return <span className={row.name_hidden ? "text-white/45 italic font-medium" : undefined}>{name}</span>;
}

function Move({ row }) {
  const move = movement(row);
  if (!move) return null;
  const Icon = move.dir === "up" ? ChevronUp : ChevronDown;
  const label = movementLabel(move);
  return (
    <span className="tls-round-move" data-dir={move.dir} role="img" aria-label={label} title={label} data-testid="round-move">
      <Icon className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
      <span aria-hidden="true">{move.by}</span>
    </span>
  );
}

function Pos({ row }) {
  const out = row.status !== "finished";
  return <span className="tls-round-pos" data-medal={medalOf(row) || undefined} data-out={out ? "true" : undefined}>{posLabel(row)}</span>;
}

/** Tabelle am PC: nur Spalten, die etwas zeigen. */
export function ResultTable({ session, playKey }) {
  const columns = visibleColumns(session);
  const right = new Set(["points"]);
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- eine scrollbare Fläche muss per Tastatur erreichbar sein (axe: scrollable-region-focusable)
    <div className="tls-round-table tls-swipe hidden md:block focus:outline-none focus-visible:ring-2 focus-visible:ring-[#29B6E8]" role="region" aria-label={`Ergebnis ${session.label}`} tabIndex={0} data-testid="round-table">
      <table className="text-[15px]">
        <thead>
          <tr>
            {columns.map((key) => (
              <th key={key} scope="col" data-align={right.has(key) ? "right" : undefined} data-testid={`round-col-${key}`}>{COLUMN_LABELS[key]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {session.rows.map((row, index) => {
            const delay = rowDelay(index);
            const out = row.status !== "finished";
            return (
              <tr key={row.key} className="tls-round-row" data-own={row.own ? "true" : undefined} data-out={out ? "true" : undefined}
                data-shine={row.own ? "true" : undefined} style={row.own ? { "--tls-glow-delay": glowDelay(index) } : undefined} data-testid="round-row">
                {columns.map((key) => {
                  switch (key) {
                    case "pos": return <td key={key} className="w-14"><Pos row={row} /></td>;
                    case "number": return <td key={key} className="w-14"><span className="tls-round-number" style={teamStyle(row)}>{row.start_number || ""}</span></td>;
                    case "name": return (
                      <td key={key} className="font-bold">
                        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                          <DriverName row={row} />
                          {rowBadges(row, { penalty: false }).map((badge) => <Badge key={badge.key} badge={badge} glow index={index} />)}
                        </span>
                      </td>
                    );
                    case "team": return <td key={key}><span className="tls-round-team" style={teamStyle(row)}>{row.team || ""}</span></td>;
                    case "grid": return <td key={key} className="whitespace-nowrap text-white/80">{row.grid || "–"}<Move row={row} /></td>;
                    case "time": return <td key={key} className="whitespace-nowrap"><CountUp value={timeText(row)} playKey={playKey} delay={delay} /></td>;
                    case "gap": return <td key={key} className="whitespace-nowrap text-white/65"><CountUp value={gapText(row)} playKey={playKey} delay={delay} /></td>;
                    case "penalty": return <td key={key} className="tls-round-penalty whitespace-nowrap">{penaltyLabel(row.penalty_seconds)}</td>;
                    case "points": return <td key={key} className="tls-round-points">{row.points === null || row.points === undefined ? "" : formatNumber(row.points)}</td>;
                    default: return null;
                  }
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Liste am Handy: Platz, Nr, Name mit Abzeichen und Team, rechts groß die Zeit, darunter Abstand und Punkte. */
export function ResultList({ session, playKey }) {
  const columns = new Set(visibleColumns(session));
  return (
    <ol className="md:hidden -mx-1" aria-label={`Ergebnis ${session.label}`} data-testid="round-list">
      {session.rows.map((row, index) => {
        const delay = rowDelay(index);
        const sub = mobileSub(row, { points: columns.has("points") });
        const timed = columns.has("time") || columns.has("gap");
        const out = row.status !== "finished";
        return (
          <li key={row.key} className="tls-round-item" data-own={row.own ? "true" : undefined} data-out={out ? "true" : undefined}
            data-shine={row.own ? "true" : undefined} style={row.own ? { "--tls-glow-delay": glowDelay(index) } : undefined} data-testid="round-item">
            <Pos row={row} />
            {columns.has("number") && <span className="tls-round-number" style={teamStyle(row)}>{row.start_number || ""}</span>}
            <span className="flex-1 min-w-0 flex flex-col">
              <span className="font-bold text-[14px] flex flex-wrap items-center gap-x-1.5 gap-y-1 [overflow-wrap:anywhere]">
                <DriverName row={row} />
                {rowBadges(row).map((badge) => <Badge key={badge.key} badge={badge} short glow index={index} />)}
              </span>
              {row.team && <span className="tls-round-team text-[12px]" style={teamStyle(row)}>{row.team}</span>}
            </span>
            <span className="flex flex-col items-end shrink-0 tabular-nums">
              {timed ? (
                <span className="tls-round-item__main"><CountUp value={mobileMain(row)} playKey={playKey} delay={delay} /></span>
              ) : columns.has("points") && row.points !== null && row.points !== undefined ? (
                <span className="tls-round-item__main">{formatNumber(row.points)} P</span>
              ) : null}
              {timed && sub && <span className="tls-round-item__sub">{sub}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

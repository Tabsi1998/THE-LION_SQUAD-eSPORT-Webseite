import { ChevronDown, ChevronUp } from "lucide-react";
import { FORM_LETTERS, STANDING_COLUMNS, formLabel, rankMove, standingCell } from "@/lib/standingsTable";
import { ZONE_LABELS, standingNotes, zoneLegend } from "@/lib/leagueTable";
import { CountUp } from "@/components/tls/motion/CountUp";

// Eine Tabelle der Rangliste (#1562, #1179): Liga und Gruppen mit Spielen, Bilanz, Differenz, Form und Punkten; die
// Pfeile zeigen den Weg seit dem vorigen Spieltag (vom Server), die eigene Zeile ist markiert. Sieg hell in Cyan,
// Niederlage grau - Rot bleibt Live, Gold dem Podest (LSW-Farbregel). Am Handy fallen S/U/N weg, Form bleibt.

export function standingKey(row) {
  return row.registration_id || row.id || row.display_name;
}

function places(by) {
  return `${by} ${by === 1 ? "Platz" : "Plätze"}`;
}

function Move({ row }) {
  const move = rankMove(row);
  if (!move || move.direction === "same") return null;
  const up = move.direction === "up";
  const Icon = up ? ChevronUp : ChevronDown;
  const label = `${places(move.by)} ${up ? "hinauf" : "hinunter"}`;
  return (
    <span className="tls-standing-move" data-dir={move.direction} role="img" aria-label={label} title={label} data-testid={`standing-move-${row.registration_id}`}>
      <Icon className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
      <span aria-hidden="true">{move.by}</span>
    </span>
  );
}

function Form({ form }) {
  const list = (form || []).filter((letter) => FORM_LETTERS[letter]);
  return (
    <span className="tls-standing-form" role="img" aria-label={formLabel(list)} title={formLabel(list)} data-form={list.join("")}>
      {list.length ? list.map((letter, index) => (
        // Die Reihenfolge ist fest (ältestes links) - der Index ist hier der Schlüssel.
        <span key={index} className="tls-standing-form__dot" data-result={letter} aria-hidden="true">{FORM_LETTERS[letter]}</span>
      )) : <span className="text-white/30" aria-hidden="true">–</span>}
    </span>
  );
}

// Liga-Staffel (E.1, #1625): unter dem Namen, was bei Punktgleichheit entschied, kampflos, Abzug und das Ausscheiden.
// Gibt es die Felder nicht (andere Turniere), bleibt die Zeile wie bisher.
function Notes({ row }) {
  const notes = standingNotes(row);
  if (!notes.length) return null;
  return (
    <span className="tls-standing-notes" data-testid={`standing-notes-${row.registration_id}`}>
      {notes.map((note) => (
        <span key={note.key} className="tls-standing-note" data-tone={note.tone} title={note.title}>
          {note.text}{note.reason ? <span className="tls-standing-note__reason">: {note.reason}</span> : null}
        </span>
      ))}
    </span>
  );
}

/**
 * `rows`: Zeilen einer Tabelle; `kind`: league, swiss, ffa oder knockout (lib/standingsTable.tableKind); `changed`: Schlüssel
 * frisch geänderter Zeilen; `registerRow`: useFlipRows - Zeilen gleiten an ihren neuen Platz; `certificateHref`: Link
 * zur Urkunde (nur nach dem Ende); `mineLabel`: Marke an der eigenen Zeile; `nameLabel`: Kopf der Namensspalte („Team“
 * bei Team-Turnieren, lib/standingsTable.nameHead); `hideDraws`: ohne Spalte „U“ (Season ohne Remis, lib/leagueTable);
 * `mapPoints`: Punkte nach gewonnenen Maps (#2312) - „S“ bleibt auch am Handy (erstes Kriterium bei Punktgleichheit);
 * `championKey`: Schlüssel der Meister-Zeile (Liga, #2268) - nur sie trägt Gold.
 */
export function StandingsTable({ rows, kind = "league", changed, registerRow, certificateHref = null, label = "Rangliste", mineLabel = "Du", nameLabel = "Name", hideDraws = false, mapPoints = false, championKey = null }) {
  const columns = (STANDING_COLUMNS[kind] || STANDING_COLUMNS.league)
    .filter((column) => !(hideDraws && column.key === "drawn"))
    .map((column) => {
      if (!mapPoints) return column;
      if (column.key === "won") return { ...column, wide: false };
      if (column.key === "points") return { ...column, title: "Punkte = gewonnene Maps" };
      return column;
    });
  const span = columns.length + 2 + (certificateHref ? 1 : 0);
  return (
    // Bei großer Schrift (200 %) am Handy schiebt sich die Tabelle seitlich, statt die Punkte abzuschneiden.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- eine scrollbare Fläche muss per Tastatur erreichbar sein (axe: scrollable-region-focusable)
    <div role="region" aria-label={label} tabIndex={0} className="tls-standings border border-white/10 rounded-md bg-[var(--tls-surface-1)] tls-swipe pb-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#29B6E8]">
      <table className="w-full text-sm tabular-nums" aria-label={label}>
        <thead className="text-[11px] uppercase tracking-[0.12em] text-white/50">
          <tr className="border-b border-white/10">
            <th scope="col" className="text-left pl-3 sm:pl-4 pr-1 py-2.5 w-12 sm:w-16 font-semibold">#</th>
            <th scope="col" className="text-left px-2 py-2.5 font-semibold">{nameLabel}</th>
            {columns.map((column) => (
              <th key={column.key} scope="col" title={column.title} className={`px-1.5 sm:px-2.5 py-2.5 font-semibold ${column.key === "form" ? "text-left" : "text-right"} ${column.wide ? "hidden sm:table-cell" : ""} ${column.strong ? "pr-3 sm:pr-4" : ""}`}>
                {column.label}
              </th>
            ))}
            {certificateHref && <th scope="col" className="text-right pr-4 py-2.5 font-semibold hidden sm:table-cell">Urkunde</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = standingKey(row);
            const isChanged = changed?.has(key);
            return (
              <tr
                key={key}
                ref={registerRow ? registerRow(key) : undefined}
                data-testid={`standing-row-${row.registration_id}`}
                data-changed={isChanged ? "true" : undefined}
                data-mine={row.is_mine ? "true" : undefined}
                data-champion={championKey && key === championKey ? "true" : undefined}
                data-zone={ZONE_LABELS[row.zone] ? row.zone : undefined}
                className={`tls-standing-row ${isChanged ? "tls-changed-row" : ""}`}
              >
                <td className="tls-standing-rank pl-3 sm:pl-4 pr-1 py-2.5 align-middle">
                  <span className="flex items-center gap-1.5">
                    <span className="font-display text-base font-bold text-white w-5 text-right">{row.rank}</span>
                    {/* Zone für Auf- und Abstieg (F.2): der Strich links trägt die Farbe, für Screenreader das Wort. */}
                    {ZONE_LABELS[row.zone] ? <span className="sr-only">{ZONE_LABELS[row.zone]}</span> : null}
                    <Move row={row} />
                  </span>
                </td>
                <td className="px-2 py-2.5 align-middle min-w-0">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="tls-standing-name text-white font-medium">{row.display_name || "Teilnehmer"}</span>
                    {row.is_mine && <span className="tls-standing-me">{mineLabel}</span>}
                  </span>
                  <Notes row={row} />
                </td>
                {columns.map((column) => (
                  <td key={column.key} className={`px-1.5 sm:px-2.5 py-2.5 align-middle ${column.key === "form" ? "text-left" : "text-right"} ${column.wide ? "hidden sm:table-cell" : ""} ${column.strong ? "pr-3 sm:pr-4 font-display text-base font-bold text-white" : "text-white/70"}`}>
                    {/* Punkte zählen beim ersten Sichtbarwerden hoch (#1969); beim Nachladen steht der neue Wert sofort da -
                        die Zeile selbst leuchtet schon auf (tls-changed-row), ein zweites Aufleuchten wäre zu viel. */}
                    {column.key === "form" ? <Form form={row.form} /> : column.strong ? <CountUp value={standingCell(column, row)} flash={false} /> : standingCell(column, row)}
                  </td>
                ))}
                {certificateHref && (
                  <td className="pr-4 py-2.5 text-right hidden sm:table-cell">
                    {row.rank <= 4 ? (
                      <a href={certificateHref(row)} target="_blank" rel="noreferrer" className="text-[11px] font-bold uppercase tracking-wider text-[var(--tls-honor)] hover:text-white">PDF</a>
                    ) : <span className="text-white/25">–</span>}
                  </td>
                )}
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={span} className="text-center py-8 text-white/45">Noch keine Ergebnisse</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Legende der Zonen unter einer Liga-Tabelle (F.2, #1627): nur, was in der Tabelle vorkommt - sonst nichts. */
export function ZoneLegend({ rows, testId }) {
  const items = zoneLegend(rows);
  if (!items.length) return null;
  return (
    <ul className="tls-zone-legend mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/60" aria-label="Zonen der Tabelle" data-testid={testId}>
      {items.map((item) => (
        <li key={item.zone} className="inline-flex items-center gap-1.5">
          <span className="tls-zone-swatch" data-zone={item.zone} aria-hidden="true" /> {item.label}
        </li>
      ))}
    </ul>
  );
}

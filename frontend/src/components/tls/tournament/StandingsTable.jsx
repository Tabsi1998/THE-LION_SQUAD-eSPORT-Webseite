import { ChevronDown, ChevronUp } from "lucide-react";
import { FORM_LETTERS, formLabel, formatDiff, formatNumber, rankMove } from "@/lib/standingsTable";

// Eine Tabelle der Rangliste (#1562, #1179): Liga und Gruppen mit Spielen, Bilanz, Differenz, Form und Punkten; die
// Pfeile zeigen den Weg seit dem vorigen Spieltag (vom Server), die eigene Zeile ist markiert. Sieg hell in Cyan,
// Niederlage grau - Rot bleibt Live, Gold dem Podest (LSW-Farbregel). Am Handy fallen S/U/N weg, Form bleibt.

const COLUMNS = {
  league: [
    { key: "played", label: "Sp", title: "Spiele" },
    { key: "won", label: "S", title: "Siege", wide: true },
    { key: "drawn", label: "U", title: "Unentschieden", wide: true },
    { key: "lost", label: "N", title: "Niederlagen", wide: true },
    { key: "score_diff", label: "Diff", title: "Differenz", format: formatDiff },
    { key: "form", label: "Form", title: "Die letzten fünf Spiele" },
    { key: "points", label: "Pkt", title: "Punkte", strong: true },
  ],
  swiss: [
    { key: "played", label: "Sp", title: "Spiele" },
    { key: "won", label: "S", title: "Siege", wide: true },
    { key: "drawn", label: "U", title: "Unentschieden", wide: true },
    { key: "lost", label: "N", title: "Niederlagen", wide: true },
    { key: "buchholz", label: "BHZ", title: "Buchholz: Punkte der Gegner" },
    { key: "form", label: "Form", title: "Die letzten fünf Spiele" },
    { key: "points", label: "Pkt", title: "Punkte", strong: true },
  ],
  knockout: [
    { key: "won", label: "S", title: "Siege", read: (row) => row.won ?? row.wins ?? 0 },
    { key: "lost", label: "N", title: "Niederlagen", read: (row) => row.lost ?? row.losses ?? 0 },
    { key: "points", label: "Punkte", title: "Punkte", strong: true, read: (row) => row.points ?? row.furthest_round ?? 0 },
  ],
};

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

function cellValue(column, row) {
  if (column.read) return column.read(row);
  if (column.format) return column.format(row[column.key]);
  return formatNumber(row[column.key] ?? 0);
}

/**
 * `rows`: Zeilen einer Tabelle; `kind`: league, swiss oder knockout (lib/standingsTable.tableKind); `changed`: Schlüssel
 * frisch geänderter Zeilen; `registerRow`: useFlipRows - Zeilen gleiten an ihren neuen Platz; `certificateHref`: Link
 * zur Urkunde (nur nach dem Ende).
 */
export function StandingsTable({ rows, kind = "league", changed, registerRow, certificateHref = null, label = "Rangliste" }) {
  const columns = COLUMNS[kind] || COLUMNS.league;
  const span = columns.length + 2 + (certificateHref ? 1 : 0);
  return (
    <div className="tls-standings border border-white/10 rounded-md bg-[var(--tls-surface-1)] overflow-hidden">
      <table className="w-full text-sm tabular-nums" aria-label={label}>
        <thead className="text-[11px] uppercase tracking-[0.12em] text-white/50">
          <tr className="border-b border-white/10">
            <th scope="col" className="text-left pl-3 sm:pl-4 pr-1 py-2.5 w-12 sm:w-16 font-semibold">#</th>
            <th scope="col" className="text-left px-2 py-2.5 font-semibold">{kind === "knockout" ? "Spieler" : "Name"}</th>
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
                className={`tls-standing-row ${isChanged ? "tls-changed-row" : ""}`}
              >
                <td className="pl-3 sm:pl-4 pr-1 py-2.5 align-middle">
                  <span className="flex items-center gap-1.5">
                    <span className="font-display text-base font-bold text-white w-5 text-right">{row.rank}</span>
                    <Move row={row} />
                  </span>
                </td>
                <td className="px-2 py-2.5 align-middle min-w-0">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="tls-standing-name text-white font-medium">{row.display_name || "Teilnehmer"}</span>
                    {row.is_mine && <span className="tls-standing-me">Du</span>}
                  </span>
                </td>
                {columns.map((column) => (
                  <td key={column.key} className={`px-1.5 sm:px-2.5 py-2.5 align-middle ${column.key === "form" ? "text-left" : "text-right"} ${column.wide ? "hidden sm:table-cell" : ""} ${column.strong ? "pr-3 sm:pr-4 font-display text-base font-bold text-white" : "text-white/70"}`}>
                    {column.key === "form" ? <Form form={row.form} /> : cellValue(column, row)}
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

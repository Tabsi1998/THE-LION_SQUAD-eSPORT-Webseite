import { standingCell } from "@/lib/standingsTable";
import { tvTableColumns, tvTableSections } from "@/lib/tvTable";
import { useTv } from "./TvScreen";

// Die Folie „Tabelle“ (#2121): Liga, Jeder gegen jeden, Schweizer System und Gruppen am TV - dieselben Zahlen und
// Spalten wie auf der Website (ohne Form), aus 5 Metern lesbar. Gruppen stehen nebeneinander; ab drei Gruppen in einer
// Reihe ohne S/U/N. Eine lange Tabelle teilt sich in zwei Spalten, statt die Schrift zu verkleinern. Platz 1 bis 3 in
// Gold erst, wenn das Turnier beendet ist - vorher ist es ein Zwischenstand.

const SPLIT_AFTER = 12;
// Höhe in TV-Einheiten (--tv-u, 1 % der Bildhöhe): Platz der Folie zwischen Kopf- und Fußleiste, was Titel und
// Tabellenkopf brauchen, und wie hoch eine Zeile höchstens wird - wenige Zeilen sollen nicht über das ganze Bild laufen.
// Große Schrift macht auch Kopf- und Fußleiste höher - dann bleibt weniger Platz.
const SLIDE_U = 68;
const SLIDE_LARGE_U = 60;
const ROW_MAX_U = 7.5;
// Darunter passt die Schrift nicht mehr in die Zeile (normal bzw. „Große Schrift“) - dann lieber blättern.
const ROW_MIN_U = 3;
const ROW_MIN_LARGE_U = 4.2;

function groupColumns(count) {
  if (count <= 2) return Math.max(1, count);
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  return 4;
}

/** Platz je Zeile: die Folie geteilt durch die Reihen der Tabellen, ohne Titel und Kopf, durch die längste Tabelle. */
function roomPerRow(gridRows, rows, { titled, compact = false, large = false }) {
  const chrome = (titled ? (compact ? 7 : 9) : 5) + 2;
  return ((large ? SLIDE_LARGE_U : SLIDE_U) / Math.max(1, gridRows) - chrome) / Math.max(1, rows);
}

function rowHeight(share, minRow) {
  return `calc(var(--tv-u) * ${Math.min(ROW_MAX_U, Math.max(minRow, share)).toFixed(2)})`;
}

function TableBlock({ title, rows, columns, nameLabel, final, startRank = 0, testId }) {
  return (
    <div className="tv-standings__block" data-testid={testId}>
      {title ? <div className="tv-standings__title tv-t-head font-heading font-black uppercase">{title}</div> : null}
      <table className="tv-standings__table">
        <thead>
          <tr className="tv-t-meta">
            <th scope="col" className="tv-standings__rank">#</th>
            <th scope="col" className="tv-standings__name">{nameLabel}</th>
            {columns.map((column) => <th key={column.key} scope="col" title={column.title} className="tv-standings__num">{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.registration_id || `${startRank}-${index}`}
              className="tv-standings__row tv-t-name"
              data-place={final && Number(row.rank) <= 3 ? row.rank : undefined}
              data-testid={`tv-standing-${row.registration_id}`}
              style={{ "--tv-i": startRank + index }}
            >
              <td className="tv-standings__rank font-display">{row.rank}</td>
              <td className="tv-standings__name" data-tv-name="1">{row.display_name || "Teilnehmer"}</td>
              {columns.map((column) => (
                <td key={column.key} className={`tv-standings__num ${column.strong ? "tv-standings__num--strong font-display" : ""}`}>{standingCell(column, row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function chunk(list, size) {
  const out = [];
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size));
  return out;
}

/** Wie Gruppen nebeneinander stehen und wie hoch ihre Zeilen dann werden dürfen. */
function groupLayout(count, longest, large) {
  const cols = groupColumns(count);
  const gridRows = Math.ceil(count / cols);
  const compact = cols >= 3;
  return { cols, gridRows, compact, share: roomPerRow(gridRows, longest, { titled: true, compact, large }) };
}

/**
 * `standings`: wie GET /standings (Zeilen oder `[{group, standings}]`); `final`: Turnier beendet; `turn`: wie oft die
 * Folie schon dran war. Passt nicht alles lesbar auf ein Bild (viele Gruppen, große Schrift, lange Liga), zeigt jede
 * Runde der Wiedergabeliste die nächsten Gruppen bzw. Plätze - nie kleiner als die Untergrenze der Schrift.
 */
export function TvStandingsSlide({ standings, nameLabel = "Name", final = false, turn = 0 }) {
  const { settings } = useTv();
  const large = settings?.text_size === "large";
  const minRow = large ? ROW_MIN_LARGE_U : ROW_MIN_U;
  const sections = tvTableSections(standings);
  if (!sections.length) {
    return (
      <section className="tv-standings tv-standings--empty" data-testid="tv-standings-slide">
        <div className="tv-t-title font-heading font-black uppercase">Noch keine Tabelle</div>
      </section>
    );
  }
  const grouped = sections.some((section) => section.label);
  if (!grouped) {
    const { rows } = sections[0];
    const columns = tvTableColumns(rows);
    const perColumn = Math.max(1, Math.floor(roomPerRow(1, 1, { titled: false, large }) / minRow));
    const pages = chunk(rows, perColumn * 2);
    const shown = pages[turn % pages.length];
    const halves = shown.length > SPLIT_AFTER ? [shown.slice(0, Math.ceil(shown.length / 2)), shown.slice(Math.ceil(shown.length / 2))] : [shown];
    return (
      <section className="tv-standings" data-testid="tv-standings-slide" data-split={halves.length > 1 ? "1" : undefined} data-page={pages.length > 1 ? `${(turn % pages.length) + 1}/${pages.length}` : undefined}
        style={{ "--tv-cols": halves.length, "--tv-row-h": rowHeight(roomPerRow(1, halves[0].length, { titled: false, large }), minRow) }}>
        {halves.map((half, index) => (
          <TableBlock key={index} rows={half} columns={columns} nameLabel={nameLabel} final={final} startRank={index ? halves[0].length : 0} testId={`tv-standings-part-${index + 1}`} />
        ))}
      </section>
    );
  }
  const longest = Math.max(...sections.map((section) => section.rows.length));
  let perPage = sections.length;
  while (perPage > 1 && groupLayout(perPage, longest, large).share < minRow) perPage -= 1;
  const pages = chunk(sections, perPage);
  const shown = pages[turn % pages.length];
  const { cols, compact, share } = groupLayout(shown.length, longest, large);
  return (
    <section className="tv-standings tv-standings--groups" data-testid="tv-standings-slide" data-compact={compact ? "1" : undefined} data-page={pages.length > 1 ? `${(turn % pages.length) + 1}/${pages.length}` : undefined}
      style={{ "--tv-cols": cols, "--tv-row-h": rowHeight(share, minRow) }}>
      {shown.map((section) => (
        // Ein Gruppenplatz ist kein Podest - kein Gold.
        <TableBlock key={section.key} title={section.label} rows={section.rows} columns={tvTableColumns(section.rows, { compact })} nameLabel={nameLabel} testId={`tv-standings-group-${section.key}`} />
      ))}
    </section>
  );
}
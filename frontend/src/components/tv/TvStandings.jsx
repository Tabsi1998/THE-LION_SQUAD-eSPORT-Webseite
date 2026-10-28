import { standingCell } from "@/lib/standingsTable";
import { tvTableColumns, tvTableSections } from "@/lib/tvTable";

// Die Folie „Tabelle“ (#2121): Liga, Jeder gegen jeden, Schweizer System und Gruppen am TV - dieselben Zahlen und
// Spalten wie auf der Website (ohne Form), aus 5 Metern lesbar. Gruppen stehen nebeneinander; ab drei Gruppen in einer
// Reihe ohne S/U/N. Eine lange Tabelle teilt sich in zwei Spalten, statt die Schrift zu verkleinern. Platz 1 bis 3 in
// Gold erst, wenn das Turnier beendet ist - vorher ist es ein Zwischenstand.

const SPLIT_AFTER = 12;

function groupColumns(count) {
  if (count <= 2) return Math.max(1, count);
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  return 4;
}

function TableBlock({ title, rows, columns, nameLabel, final, startRank = 0, testId }) {
  return (
    <div className="tv-standings__block" data-testid={testId}>
      {title ? <div className="tv-standings__title tv-t-head font-heading font-black uppercase">{title}</div> : null}
      <table className="tv-standings__table" style={{ "--tv-rows": Math.max(rows.length, 4) }}>
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

/** `standings`: wie GET /standings (Zeilen oder `[{group, standings}]`); `final`: Turnier beendet. */
export function TvStandingsSlide({ standings, nameLabel = "Name", final = false }) {
  const sections = tvTableSections(standings);
  if (!sections.length) {
    return (
      <section className="tv-standings tv-standings--empty" data-testid="tv-standings-slide">
        <div className="tv-t-title font-heading font-black uppercase">Noch keine Tabelle</div>
      </section>
    );
  }
  const grouped = sections.some((section) => section.label);
  const cols = grouped ? groupColumns(sections.length) : 1;
  const compact = cols >= 3;
  if (!grouped) {
    const { rows } = sections[0];
    const columns = tvTableColumns(rows);
    const halves = rows.length > SPLIT_AFTER ? [rows.slice(0, Math.ceil(rows.length / 2)), rows.slice(Math.ceil(rows.length / 2))] : [rows];
    return (
      <section className="tv-standings" data-testid="tv-standings-slide" data-split={halves.length > 1 ? "1" : undefined} style={{ "--tv-cols": halves.length }}>
        {halves.map((half, index) => (
          <TableBlock key={index} rows={half} columns={columns} nameLabel={nameLabel} final={final} startRank={index ? halves[0].length : 0} testId={`tv-standings-part-${index + 1}`} />
        ))}
      </section>
    );
  }
  return (
    <section className="tv-standings tv-standings--groups" data-testid="tv-standings-slide" data-compact={compact ? "1" : undefined} style={{ "--tv-cols": cols }}>
      {sections.map((section) => (
        // Ein Gruppenplatz ist kein Podest - kein Gold.
        <TableBlock key={section.key} title={section.label} rows={section.rows} columns={tvTableColumns(section.rows, { compact })} nameLabel={nameLabel} testId={`tv-standings-group-${section.key}`} />
      ))}
    </section>
  );
}

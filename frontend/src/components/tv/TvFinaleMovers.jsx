import { ArrowDown, ArrowRight, ArrowUp, X } from "lucide-react";
import { FINALE_TIMING, columnWeight, finaleColumns, moreText, nameFit, rowDelay, rowLabel, rowMeta, rowUnits, targetText } from "@/lib/tvFinale";

// Saisonfinale (#1641): je Liga N die Auf- und Absteiger nach dem Sieger-Moment. Links steigt auf, rechts steigt ab bzw. scheidet aus.
// Detail-Runde (tv.css „Saisonfinale“): Titel und Spaltenköpfe kommen zuerst, dann gleiten die Zeilen gestaffelt auf ihren Platz -
// Aufsteiger von unten, Absteiger von oben -, danach schiebt sich die Ziel-Liga heran und der Pfeil leuchtet kurz auf; zuletzt zeichnet
// sich die Linie unter dem Titel. Nur Verschieben und Deckkraft; „Bewegung aus“ (Regel für .tv-screen) zeigt sofort das Endbild.
// Höchstens 8 Zeilen je Spalte (Nr. 235), darunter „und N weitere“ - es hebt sich, wenn die letzte Zeile ihrer Spalte steht.

const ICONS = { up: ArrowUp, down: ArrowDown, out: X };

function MoverRow({ row, index }) {
  const Icon = ICONS[row.move] || ArrowRight;
  const meta = rowMeta(row);
  const target = targetText(row);
  const delay = rowDelay(index);
  return (
    <li className="tv-finale__row" data-move={row.move} aria-label={rowLabel(row)}
      style={{ "--tv-finale-at": `${delay}s`, "--tv-finale-target-at": `${(delay + FINALE_TIMING.target).toFixed(2)}s` }}
      data-testid={`tv-finale-row-${row.registration_id}`}>
      <span className="tv-finale__sign" aria-hidden="true"><Icon className="tv-icon" strokeWidth={3} /></span>
      <span className="tv-finale__who">
        <span className="tv-finale__name font-heading" data-tv-name="1" data-fit={nameFit(row.name)}>{row.name}</span>
        {meta ? <span className="tv-finale__meta tv-t-meta">{meta}</span> : null}
      </span>
      {target ? (
        <span className="tv-finale__target tv-t-info" aria-hidden="true" data-testid={`tv-finale-target-${row.registration_id}`}>
          {row.move === "out" ? null : <ArrowRight className="tv-icon tv-finale__arrow" strokeWidth={3} />}{target}
        </span>
      ) : null}
    </li>
  );
}

export function TvFinaleMovers({ page, league = "", season = "" }) {
  const columns = finaleColumns(page);
  const longest = Math.max(1, ...columns.map(columnWeight));
  // Über dem Titel Liga und Season - nur, wenn sie mitkommen (am Turnierbaum-TV trägt die Kopfleiste „Saisonfinale“ und beides).
  const line = league || season ? ["Saisonfinale", league, season].filter(Boolean).join(" · ") : "";
  const total = columns.reduce((sum, column) => sum + column.rows.length, 0);
  // Der Schluss (Linie unter dem Titel), wenn die letzte Zeile steht und ihre Ziel-Liga da ist.
  const end = (rowDelay(Math.max(0, total - 1)) + FINALE_TIMING.target + FINALE_TIMING.settle).toFixed(2);
  let counter = 0;
  return (
    <section className="tv-finale" data-columns={columns.length} data-more={columns.some((column) => column.more) ? "1" : undefined}
      style={{ "--tv-finale-row": rowUnits(longest), "--tv-finale-end": `${end}s`, "--tv-finale-head-at": `${FINALE_TIMING.head}s` }}
      aria-label={`${page.label}: Auf- und Absteiger`} data-testid="tv-finale" data-step={page.step}>
      <header className="tv-finale__head">
        {line ? <div className="tv-finale__line tv-t-info" data-testid="tv-finale-line">{line}</div> : null}
        <h2 className="tv-finale__title font-display" data-testid="tv-finale-title">
          <span className="tv-finale__league">{page.label}</span> <span className="tv-finale__what">Auf- und Absteiger</span>
        </h2>
        {page.count > 1 ? (
          <ol className="tv-finale__dots" aria-label={`Liga ${page.step} von ${page.count}`} data-testid="tv-finale-dots">
            {Array.from({ length: page.count }, (_, index) => (
              <li key={index} className="tv-finale__dot" data-on={index + 1 === page.step ? "1" : undefined} />
            ))}
          </ol>
        ) : null}
        <span className="tv-finale__rule" aria-hidden="true" />
      </header>
      <div className="tv-finale__cols">
        {columns.map((column) => {
          const rows = column.rows.map((row) => {
            const index = counter;
            counter += 1;
            return <MoverRow key={row.registration_id} row={row} index={index} />;
          });
          // „und N weitere“, sobald die letzte Zeile der Spalte steht (mit ihrer Ziel-Liga).
          const moreAt = (rowDelay(Math.max(0, counter - 1)) + FINALE_TIMING.target).toFixed(2);
          return (
            <div key={column.key} className="tv-finale__col" data-col={column.key} data-testid={`tv-finale-col-${column.key}`}>
              <h3 className="tv-finale__col-title tv-t-head font-heading">{column.title}</h3>
              <ol className="tv-finale__rows">{rows}</ol>
              {column.more ? (
                <p className="tv-finale__more tv-t-info" style={{ "--tv-finale-at": `${moreAt}s` }} data-testid={`tv-finale-more-${column.key}`}>
                  {moreText(column.more)}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

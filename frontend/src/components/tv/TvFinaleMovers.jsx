import { useEffect, useLayoutEffect, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, X } from "lucide-react";
import { useTv, useTvArea } from "@/components/tv/TvScreen";
import { LeagueBadge } from "@/components/tls/league/LeagueBadge";
import { FINALE_TIMING, finaleColumns, fitFinaleColumns, moreText, nameFit, rowDelay, rowLabel, rowMeta, targetText } from "@/lib/tvFinale";

// Saisonfinale (#1641): je Liga N die Auf- und Absteiger nach dem Sieger-Moment. Links steigt auf, rechts steigt ab bzw. scheidet aus.
// Detail-Runde (tv.css „Saisonfinale“): Titel und Spaltenköpfe kommen zuerst, dann gleiten die Zeilen gestaffelt auf ihren Platz -
// Aufsteiger von unten, Absteiger von oben -, danach schiebt sich die Ziel-Liga heran und der Pfeil leuchtet kurz auf; zuletzt zeichnet
// sich die Linie unter dem Titel. Nur Verschieben und Deckkraft; „Bewegung aus“ (Regel für .tv-screen) zeigt sofort das Endbild.
// Höchstens 8 Zeilen je Spalte (Nr. 235), darunter „und N weitere“ - es hebt sich, wenn die letzte Zeile ihrer Spalte steht. Die 8 sind
// eine Obergrenze (Nr. 238): Es kommen nur so viele, wie samt Kopf und Hinweis über der Fußleiste stehen - geschätzt aus den Umbrüchen
// (lib/tvFinale `fitFinaleColumns`) auf der gemessenen Fläche. Läuft eine Spalte am TV trotzdem über (andere Schrift), wird sie um eine
// Zeile kürzer, bis sie passt - nie wird etwas verdeckt oder abgeschnitten.
// Liga-Abzeichen (#2561): im Titel vor „Liga N“ und im Ziel-Chip vor der Ziel-Liga - in TV-Größe, als Zierde (der Text steht daneben).
// Ohne eigene Erst-Sicht-Bewegung: Im Titel setzt es sich mit den Spaltenköpfen leise auf, im Chip schiebt es sich mit ihm heran
// (tv.css). Im Chip so hoch wie eine Textzeile - die Messung (lib/tvFinale `targetChipUnits`) rechnet nur die Breite dazu.

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
          {row.move === "out" ? null : <ArrowRight className="tv-icon tv-finale__arrow" strokeWidth={3} />}
          {row.move !== "out" && row.target_badge ? (
            <LeagueBadge badge={row.target_badge} size="tv" label={false} decorative play={false} testId={`tv-finale-target-badge-${row.registration_id}`} />
          ) : null}
          {target}
        </span>
      ) : null}
    </li>
  );
}

/** Wie weit jede Spalte über ihre Fläche hinausragt (Layout-Werte, unabhängig von laufenden Bewegungen) - `null` ohne Layout. */
function overflowing(cols) {
  if (!cols || !cols.clientHeight) return null;
  const out = {};
  for (const col of cols.querySelectorAll(".tv-finale__col")) {
    const last = col.lastElementChild;
    if (last && last.offsetTop + last.offsetHeight > cols.clientHeight + 1) out[col.dataset.col] = true;
  }
  return out;
}

export function TvFinaleMovers({ page, league = "", season = "" }) {
  const { scale } = useTv();
  const [colsRef, area] = useTvArea(null);
  const [cols, setCols] = useState(null);
  const [fontsReady, setFontsReady] = useState(0);
  const trimKey = `${page.label}|${page.step}|${area ? `${area.w}x${area.h}` : "-"}|${fontsReady}`;
  const [trim, setTrim] = useState({ key: null, counts: {} });
  const counts = trim.key === trimKey ? trim.counts : {};
  const columns = fitFinaleColumns(finaleColumns(page), { area, scale, trim: counts });
  const ref = (node) => {
    colsRef(node);
    setCols((current) => (current === node ? current : node));
  };
  useEffect(() => {
    let alive = true;
    document.fonts?.ready?.then(() => alive && setFontsReady((value) => value + 1));
    return () => { alive = false; };
  }, []);
  // Sicherheitsnetz: Ragt eine Spalte trotz Rechnung über ihre Fläche, kommt sie mit einer Zeile weniger (vor dem Zeichnen).
  useLayoutEffect(() => {
    const over = overflowing(cols);
    if (!over) return;
    const keys = columns.filter((column) => over[column.key] && column.rows.length > 1).map((column) => column.key);
    if (!keys.length) return;
    setTrim((current) => {
      const base = current.key === trimKey ? current.counts : {};
      const next = { ...base };
      for (const key of keys) next[key] = (next[key] || 0) + 1;
      return { key: trimKey, counts: next };
    });
  }, [cols, columns, trimKey]);
  // Über dem Titel Liga und Season - nur, wenn sie mitkommen (am Turnierbaum-TV trägt die Kopfleiste „Saisonfinale“ und beides).
  const line = league || season ? ["Saisonfinale", league, season].filter(Boolean).join(" · ") : "";
  const total = columns.reduce((sum, column) => sum + column.rows.length, 0);
  // Der Schluss (Linie unter dem Titel), wenn die letzte Zeile steht und ihre Ziel-Liga da ist.
  const end = (rowDelay(Math.max(0, total - 1)) + FINALE_TIMING.target + FINALE_TIMING.settle).toFixed(2);
  let counter = 0;
  return (
    <section className="tv-finale" data-columns={columns.length} data-more={columns.some((column) => column.more) ? "1" : undefined}
      style={{ "--tv-finale-row": columns[0]?.unitU || 8, "--tv-finale-end": `${end}s`, "--tv-finale-head-at": `${FINALE_TIMING.head}s` }}
      aria-label={`${page.label}: Auf- und Absteiger`} data-testid="tv-finale" data-step={page.step}>
      <header className="tv-finale__head">
        {line ? <div className="tv-finale__line tv-t-info" data-testid="tv-finale-line">{line}</div> : null}
        <h2 className="tv-finale__title font-display" data-testid="tv-finale-title">
          {page.badge ? <LeagueBadge badge={page.badge} size="tv" label={false} decorative play={false} className="tv-finale__badge" testId="tv-finale-badge" /> : null}
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
      <div className="tv-finale__cols" ref={ref}>
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

import { Check } from "lucide-react";
import { BrandedQRCode } from "@/components/tls/BrandedQRCode";
import { CHECKIN, DAYPLAN, SCHEDULE, SHEET, TREE, cardHeight, scheduleRowHeight, sheetBody, treeColumnCapacity, treeColumns } from "@/lib/printView";
import "@/styles/printView.css";

// Druckansicht (#1283): die Blätter. Jede Höhe kommt aus lib/printView (Millimeter) - Karten und Zeilen sind genau so
// hoch, wie die Aufteilung gerechnet hat; Namen bleiben einzeilig und enden mit „…“, statt das Blatt zu sprengen.

const mm = (value) => `${value}mm`;

/** Ein A4-Blatt mit Kopf (Verein, Titel, Teil) und Fuß (QR-Code zur Live-Seite, Druckzeit, Seitenzahl). */
export function PrintSheet({ orientation, kicker, title, meta, stamp, qrUrl, qrLabel, page, pages, children, testId, zoom = 1 }) {
  return (
    <div className="tls-print-frame" style={{ "--tls-print-zoom": zoom }}>
      <section
        className={`tls-paper-sheet tls-paper-sheet--${orientation}`}
        style={{ padding: mm(SHEET.margin), gap: mm(SHEET.gap) }}
        data-testid={testId}
        data-orientation={orientation}
        aria-label={`Seite ${page} von ${pages}: ${kicker}`}
      >
        <header className="tls-print-head" style={{ height: mm(SHEET.header), flex: "none" }}>
          <div style={{ minWidth: 0 }}>
            <div className="tls-print-kicker">THE LION SQUAD · {kicker}</div>
            <h1 className="tls-print-title">{title}</h1>
          </div>
          <div className="tls-print-meta">{meta}</div>
        </header>
        <div style={{ height: mm(sheetBody(orientation).height), flex: "none", overflow: "hidden" }} data-print-body>
          {children}
        </div>
        <footer className="tls-print-foot" style={{ height: mm(SHEET.footer), flex: "none" }}>
          {qrUrl ? (
            <span className="tls-print-foot__qr">
              <BrandedQRCode value={qrUrl} size={120} fgColor="#000000" accent="#000000" withLogo={false} className="!w-full !h-full" />
            </span>
          ) : null}
          <div className="tls-print-foot__text">
            <div>{qrLabel}</div>
            {qrUrl ? <div className="tls-print-foot__url">{qrUrl.replace(/^https?:\/\//, "")}</div> : null}
            <div className="tls-print-muted">Fällt das Netz aus, gilt dieses Blatt. Ergebnisse später in der Turnierleitung nachtragen.</div>
          </div>
          <div className="tls-print-foot__stamp">
            <strong data-testid="print-stamp">{stamp}</strong>
            Seite {page} von {pages}
          </div>
        </footer>
      </section>
    </div>
  );
}

function SlotRow({ slot, heat }) {
  const pending = slot.kind !== "player";
  return (
    <div className="tls-print-slot" style={{ height: mm(TREE.cardRow) }}>
      <span className={`tls-print-slot__name ${pending ? "tls-print-slot__name--pending" : ""} ${slot.winner ? "tls-print-slot__name--winner" : ""}`}>
        {slot.label || (heat ? "" : "noch offen")}
      </span>
      <span className="tls-print-slot__score" aria-label={heat ? "Platz" : "Ergebnis"}>{slot.score}</span>
    </div>
  );
}

function MatchCard({ match }) {
  const info = [match.time ? `${match.forecast ? "ca. " : ""}${match.time}` : "", match.station, match.cancelled ? "entfällt" : match.done ? "gespielt" : ""].filter(Boolean).join(" · ");
  return (
    <article className="tls-print-card" style={{ height: mm(cardHeight(match.slots.length)) }} data-testid="print-match">
      <div className="tls-print-card__head" style={{ height: mm(TREE.cardHead) }}>
        <b>{match.heat ? `Lauf ${match.key}` : `Spiel ${match.key}`}</b>
        <span>{info}</span>
      </div>
      {match.slots.map((slot, index) => <SlotRow key={index} slot={slot} heat={match.heat} />)}
    </article>
  );
}

/** Ein Blatt des Baums: Abschnitte nebeneinander, je Runde eine Spalte mit ihrem Namen (auch bei Fortsetzung). */
export function TreeBody({ page }) {
  const orientation = page.orientation;
  const max = treeColumns(orientation);
  const width = (sheetBody(orientation).width - (max - 1) * TREE.columnGap) / max;
  const capacity = treeColumnCapacity(orientation);
  return (
    <div className="flex" style={{ gap: mm(TREE.columnGap), height: "100%" }}>
      {page.blocks.map((block) => (
        <div key={block.key} data-testid="print-block">
          <div className="tls-print-block__title" style={{ height: mm(TREE.blockTitle) }}>
            {block.title}
            {block.part ? <span>Teil {block.part.index} von {block.part.of}</span> : null}
          </div>
          <div className="flex" style={{ gap: mm(TREE.columnGap) }}>
            {block.columns.map((column, index) => (
              <div key={index} style={{ width: mm(width) }} data-testid="print-column">
                <div className="tls-print-col__title" style={{ height: mm(TREE.columnTitle) }} data-testid="print-round-title">
                  <span className="tls-print-ellipsis">{column.title || block.title}</span>
                  {column.continued ? <small>{column.continued.band} / {column.continued.of}</small> : null}
                </div>
                <div className="flex flex-col justify-around" style={{ height: mm(capacity) }}>
                  {column.matches.map((match) => <MatchCard key={match.id} match={match} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionRow({ section, span }) {
  return (
    <tr className="tls-print-section">
      <td colSpan={span} style={{ height: mm(SCHEDULE.sectionHead) }}>
        {section.title}{section.continued ? " (Fortsetzung)" : ""}
        {section.note && !section.continued ? <span>{section.note}</span> : null}
      </td>
    </tr>
  );
}

function ScheduleSides({ row }) {
  if (!row.heat) {
    return (
      <div className="tls-print-ellipsis">
        {row.sides.map((side, index) => (
          <span key={index} className={!side.known ? "tls-print-slot__name--pending" : side.winner ? "font-extrabold" : ""}>
            {index ? " – " : ""}{side.label}{side.score ? ` (${side.score})` : ""}
          </span>
        ))}
      </div>
    );
  }
  return row.sides.map((side, index) => (
    <div key={index} className="flex items-center gap-[2mm]" style={{ height: mm(SCHEDULE.linePerSide) }}>
      <span className={`tls-print-ellipsis flex-1 ${!side.known ? "tls-print-slot__name--pending" : ""}`}>{side.label}</span>
      <span className="tls-print-box" style={{ width: "8mm" }}>{side.score}</span>
    </div>
  ));
}

/** Spielplan: Zeit, Station, Spiel, Teilnehmer und ein leeres Feld für das Ergebnis zum Handschreiben. */
export function ScheduleBody({ page }) {
  return (
    <table className="tls-print-table">
      <colgroup>
        <col style={{ width: "19mm" }} />
        <col style={{ width: "32mm" }} />
        <col style={{ width: "34mm" }} />
        <col />
        <col style={{ width: "24mm" }} />
      </colgroup>
      <thead>
        <tr style={{ height: mm(SCHEDULE.tableHead) }}><th>Zeit</th><th>Station</th><th>Spiel</th><th>Teilnehmer</th><th>Ergebnis</th></tr>
      </thead>
      <tbody>
        {page.sections.map((section) => [
          <SectionRow key={`${section.key}-head`} section={section} span={5} />,
          ...section.rows.map((row) => (
            <tr key={row.id} style={{ height: mm(scheduleRowHeight(row)) }} data-testid="print-schedule-row">
              <td className="whitespace-nowrap">{row.time ? `${row.forecast ? "ca. " : ""}${row.time}` : "–"}</td>
              <td className="tls-print-ellipsis">{row.station || "–"}</td>
              <td><div className="tls-print-ellipsis font-bold">{row.round}</div><div className="tls-print-muted tls-print-ellipsis">{[row.group, row.heat ? `Lauf ${row.key}` : `Spiel ${row.key}`].filter(Boolean).join(" · ")}</div></td>
              <td><ScheduleSides row={row} /></td>
              <td>{row.heat ? <span className="tls-print-muted">Platz je Zeile</span> : <span className="tls-print-write">{row.done ? <span className="block text-center font-bold">{row.sides.map((side) => side.score || "–").join(" : ")}</span> : null}</span>}</td>
            </tr>
          )),
        ])}
      </tbody>
    </table>
  );
}

/** Check-in-Liste: Kästchen zum Abhaken, Nummer, Name, Setzplatz, Begleitung (Event) bzw. Station zum Eintragen (Turnier)
 * und eine Zeile für Notizen. */
export function CheckinBody({ page, extraLabel = "Begleitung" }) {
  return (
    <table className="tls-print-table">
      <colgroup>
        <col style={{ width: "9mm" }} />
        <col style={{ width: "9mm" }} />
        <col />
        <col style={{ width: "16mm" }} />
        <col style={{ width: "28mm" }} />
        <col style={{ width: "40mm" }} />
      </colgroup>
      <thead>
        <tr style={{ height: mm(CHECKIN.tableHead) }}><th>Da</th><th>Nr.</th><th>Name</th><th>Setzpl.</th><th>{extraLabel}</th><th>Notiz</th></tr>
      </thead>
      <tbody>
        {page.sections.map((section) => [
          <SectionRow key={`${section.key}-head`} section={section} span={6} />,
          ...(section.empty ? [<tr key={`${section.key}-empty`} style={{ height: mm(CHECKIN.row) }}><td colSpan={6} className="tls-print-empty">Noch niemand angemeldet.</td></tr>] : []),
          ...section.rows.map((row) => (
            <tr key={row.id} style={{ height: mm(CHECKIN.row) }} data-testid="print-checkin-row">
              <td><span className="tls-print-box" aria-label={row.checked ? "schon da" : "abhaken"}>{row.checked ? <Check className="w-[3.5mm] h-[3.5mm]" strokeWidth={3} aria-hidden="true" /> : null}</span></td>
              <td>{row.number}</td>
              <td><div className="tls-print-ellipsis font-bold">{row.name}{row.detail ? <span className="tls-print-muted font-normal"> · {row.detail}</span> : null}</div></td>
              <td>{row.seed}</td>
              <td>{row.extra || (extraLabel === "Begleitung" ? "" : <span className="tls-print-line" />)}</td>
              <td><span className="tls-print-line" /></td>
            </tr>
          )),
        ])}
      </tbody>
    </table>
  );
}

/** Tagesplan: Einlass, Turniere und Fast Laps je Tag mit Zeit und Check-in. */
export function DayPlanBody({ page }) {
  return (
    <table className="tls-print-table">
      <colgroup>
        <col style={{ width: "26mm" }} />
        <col />
        <col style={{ width: "20mm" }} />
        <col style={{ width: "40mm" }} />
        <col style={{ width: "36mm" }} />
      </colgroup>
      <thead>
        <tr style={{ height: mm(DAYPLAN.tableHead) }}><th>Zeit</th><th>Programmpunkt</th><th>Art</th><th>Hinweis</th><th>Notiz</th></tr>
      </thead>
      <tbody>
        {page.sections.map((section) => [
          <SectionRow key={`${section.key}-head`} section={section} span={5} />,
          ...(section.empty ? [<tr key={`${section.key}-empty`} style={{ height: mm(DAYPLAN.row) }}><td colSpan={5} className="tls-print-empty">Für diesen Tag steht noch nichts mit Uhrzeit fest.</td></tr>] : []),
          ...section.rows.map((row) => (
            <tr key={row.id} style={{ height: mm(DAYPLAN.row) }} data-testid="print-dayplan-row">
              <td className="font-bold">{row.time}</td>
              <td className="tls-print-ellipsis font-bold">{row.title}</td>
              <td>{row.kind}</td>
              <td className="tls-print-ellipsis">{row.note}</td>
              <td><span className="tls-print-line" /></td>
            </tr>
          )),
        ])}
      </tbody>
    </table>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { CheckField, INPUT_CLASS } from "@/components/tls/FormFields";
import { parseSeasonTablePaste } from "@/lib/resultPaste";
import { changeLines } from "@/lib/partnerSource";
import { parseNumber } from "@/lib/resultPaste";
import {
  HOW_TEXT, KIND_OPTIONS, POINT_MODES, SEASON_STATES, UNCLEAR_TEXT, applyBody, applySummary, buildBody, cellKey,
  decisionFor, decisionValue, imageTable, imageTeamRows, isSelectable, lastTableRound, markText, mergeDecisions, organizerDecisions,
  proposalDecisions, rememberCandidates, roundColumns, roundOption, tableText, targetText, totalText, totalsSummary,
  unclearCells,
} from "@/lib/seasonTable";
import { OfficialTeamTotals } from "./OfficialTeamTotals";
import { attachOriginal } from "./OriginalsSection";
import { ResultImageButton, useResultImage } from "./ResultImageImport";
import { UnknownNamesSheet } from "./UnknownNamesSheet";
import { toast } from "sonner";
import { Check, ImagePlus, TableProperties, X } from "lucide-react";

// Saisontabelle einlesen (#1928, nur Vorstand): Wer eine laufende Saison später anlegt, fügt die Gesamttabelle des
// Veranstalters ein (Fahrer, Team, Punkte je Runde, Gesamt) statt jede vergangene Runde einzeln einzutragen. Je Spalte
// zeigt die Vorschau den Termin (korrigierbar), was Übernehmen täte und die Plätze aus den Punkten; gelbe Zellen klärt
// der Vorstand, der Abgleich prüft jede Summe gegen „Gesamt“. Geschrieben wird erst mit „Übernehmen“, immer als Entwurf.
// Bild auslesen (#1999): eine Fahrer-Tabelle landet als Text im Feld (gelbe Zellen aus dem Bild prüfen, bevor übernommen
// wird); eine Team-Tabelle wird zur Teamwertung laut Veranstalter einer Runde (Vorgabe: die letzte gewertete). Das Bild
// hängt erst beim Übernehmen als Original „Tabelle“ am Termin (#1933): bei der Team-Tabelle an der gewählten Runde, bei
// der Fahrer-Tabelle an der letzten Runde der Tabelle - „Nicht anhängen“ lässt es weg.

const SELECT_CLASS = `${INPUT_CLASS} text-sm py-1.5`;
// Wie die übrigen Felder, nur ohne volle Breite - im Raster bestimmt die Spalte die Breite.
const ROUND_SELECT_CLASS = `${INPUT_CLASS.replace("w-full ", "")} min-w-0 text-sm py-1.5`;
// Tabellen-Text: feste Zeichenbreite und kein Umbruch, damit Spalten erkennbar bleiben.
const PASTE_CLASS = `${INPUT_CLASS} font-mono text-xs leading-relaxed [tab-size:12]`;
const PLACEHOLDER = "Pos\tFahrer\tTeam\tR1\tR2\tR3\tGesamt\n1\tAda Ausgedacht\tProbe Rot\t25\t18\tOUT\t43\n2\tBruno Beispiel\tProbe Blau\t--\t25\t18\t43";

function Badge({ state }) {
  const shown = SEASON_STATES[state] || SEASON_STATES.error;
  return <span className={`inline-flex px-1.5 py-0.5 border rounded-sm text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${shown.tone}`}>{shown.label}</span>;
}

function ColumnKinds({ parsed, kinds, onKind }) {
  const label = (kind) => KIND_OPTIONS.find(([key]) => key === kind)?.[1] || kind;
  const rounds = roundColumns(kinds).length;
  const named = kinds.map((kind, index) => [kind, parsed.columns[index].label]).filter(([kind]) => kind !== "round" && kind !== "ignore");
  return (
    <details className="text-sm text-white/70" data-testid="season-table-kinds">
      <summary className="cursor-pointer text-white/60 hover:text-white">
        Erkannt: {named.map(([kind, text]) => `${label(kind)} „${text}“`).join(" · ")}{named.length ? " · " : ""}{rounds} {rounds === 1 ? "Runde" : "Runden"} – Spalten ändern
      </summary>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {parsed.columns.map((column, index) => (
          <li key={index} className="flex items-center gap-2 min-w-0">
            <span className="w-24 shrink-0 truncate text-white/80" title={column.label}>{column.label}</span>
            <select value={kinds[index]} onChange={(event) => onKind(index, event.target.value)} aria-label={`Art der Spalte ${column.label}`}
              data-testid="season-table-kind" className={SELECT_CLASS}>
              {KIND_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </li>
        ))}
      </ul>
    </details>
  );
}

function ColumnItem({ column, rounds, roundId, picked, onPick, onRound }) {
  // Wer neu dazukommt, steht gesammelt in einer Zeile - einzeln nur, was sich bei Vorhandenen ändert.
  const added = (column.changes || []).filter((change) => change.kind === "added");
  const lines = changeLines((column.changes || []).filter((change) => change.kind !== "added"), { removed: "fehlt in der Tabelle – fällt weg" });
  const total = lines.length + added.length;
  const problems = (column.errors || []).map((problem) => problem.message);
  const warnings = (column.warnings || []).map((problem) => problem.message);
  const selectable = isSelectable(column);
  const counts = column.counts?.rows ? `${column.counts.rows} Fahrer · ${column.counts.places} mit Platz` : "";
  const how = column.round ? HOW_TEXT[column.how] : "";
  return (
    <li className="py-3 flex items-start gap-3" data-testid="season-table-column" data-state={column.state}>
      <span className="w-5 shrink-0 pt-2">
        {selectable && (
          <input type="checkbox" checked={picked} onChange={() => onPick(column.index)} data-testid="season-table-pick"
            aria-label={`Spalte ${column.label} übernehmen`} style={{ accentColor: "#29B6E8" }} className="h-4 w-4" />
        )}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[4.5rem_minmax(0,26rem)_auto]">
          <span className="text-sm font-bold text-white break-words [overflow-wrap:anywhere]" title="Kopf der Spalte in der Tabelle">{column.label}</span>
          <select value={roundId ?? column.round?.id ?? ""} onChange={(event) => onRound(event.target.value)} aria-label={`Termin für Spalte ${column.label}`}
            data-testid="season-table-round" className={`${ROUND_SELECT_CLASS} col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto`}>
            {!column.round && column.state !== "skip" && <option value="">Termin wählen …</option>}
            <option value="__skip">Nicht übernehmen</option>
            {rounds.map((round) => <option key={round.id} value={round.id}>{roundOption(round)}</option>)}
          </select>
          <span className="flex items-center justify-end gap-2 sm:justify-start">
            <Badge state={column.state} />
            {column.unclear > 0 && <span className="text-xs font-semibold text-amber-200 tabular-nums">{column.unclear} gelb</span>}
          </span>
        </div>
        <div className="text-xs text-white/60">{[targetText(column), how, counts].filter(Boolean).join(" · ")}</div>
        {problems.length > 0 && (
          <ul className="text-xs text-red-200 space-y-0.5" data-testid="season-table-problems">
            {problems.map((text, index) => <li key={index}>{text}</li>)}
          </ul>
        )}
        {warnings.length > 0 && (
          <ul className="text-xs text-amber-200/90 space-y-0.5" data-testid="season-table-warnings">
            {warnings.map((text, index) => <li key={index}>{text}</li>)}
          </ul>
        )}
        {total > 0 && (
          <details className="text-xs text-white/70" data-testid="season-table-changes">
            <summary className="cursor-pointer text-white/60 hover:text-white">Abweichungen ansehen ({total})</summary>
            <ul className="mt-1.5 space-y-1 border-l border-white/10 pl-3">
              {lines.map((line) => <li key={line.key}><span className="font-semibold text-white">{line.name}</span>: {line.text}</li>)}
              {added.length > 0 && (
                <li><span className="font-semibold text-white">{added.length === 1 ? "Kommt neu dazu" : `${added.length} kommen neu dazu`}</span>: {added.map((change) => change.name).join(", ")}</li>
              )}
            </ul>
          </details>
        )}
      </div>
    </li>
  );
}

function UnclearList({ cells, decisions, onDecide, onProposals, onOrganizer, busy }) {
  const byKey = new Map(decisions.map((item) => [cellKey(item), item]));
  const open = cells.filter((cell) => !cell.decided).length;
  const single = cells.filter((cell) => !cell.decided && cell.candidates.length === 1).length;
  return (
    <section className={`border rounded-sm p-3 space-y-3 ${open ? "border-amber-400/40 bg-amber-400/[0.06]" : "border-white/10"}`} data-testid="season-table-unclear" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-white">{open ? `${open} ${open === 1 ? "Zelle" : "Zellen"} zum Klären` : "Alle gelben Zellen sind geklärt"}</h3>
          <p className="text-xs text-white/60">Hier ist der Platz aus den Punkten nicht eindeutig. Bis zur Klärung zählt der Wert der Tabelle – übernommen wird die Runde erst danach.</p>
        </div>
        {open > 0 && (
          <div className="flex flex-wrap gap-2">
            {single > 0 && (
              <button type="button" onClick={onProposals} disabled={busy} data-testid="season-table-proposals"
                className="tls-btn tls-btn--secondary px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">
                Eindeutige Vorschläge übernehmen ({single})
              </button>
            )}
            <button type="button" onClick={onOrganizer} disabled={busy} data-testid="season-table-organizer"
              className="tls-btn tls-btn--quiet px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">
              Offene: Punkte laut Veranstalter
            </button>
          </div>
        )}
      </div>
      <ul className="divide-y divide-amber-200/10">
        {cells.map((cell) => (
          <li key={cell.id} className="py-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] sm:items-center" data-testid="season-table-cell" data-decided={cell.decided || undefined}>
            <div className="min-w-0 text-sm">
              <span className="font-semibold text-white">{cell.round}</span>
              <span className="text-white/45"> · </span>
              <span className="text-white/85 break-words [overflow-wrap:anywhere]">{cell.name}</span>
              <span className="text-white/45"> · </span>
              <span className="tabular-nums text-white">{cell.value} Punkte</span>
              <span className={`block text-xs ${cell.decided ? "text-emerald-200/80" : "text-amber-200"}`}>{cell.decided ? "geklärt" : UNCLEAR_TEXT[cell.code] || "unklar"}</span>
            </div>
            <select value={decisionValue(byKey.get(cell.id), cell.candidates)} disabled={busy} aria-label={`Klären: ${cell.round}, ${cell.name}`}
              onChange={(event) => onDecide(cell, event.target.value)} data-testid="season-table-decide"
              className={`${SELECT_CLASS} ${cell.decided ? "" : "!border-amber-400/70"}`}>
              <option value="">Bitte wählen …</option>
              {cell.candidates.map((candidate, index) => <option key={index} value={`c${index}`}>{candidate.label}</option>)}
              <option value="organizer">Punkte laut Veranstalter ({cell.value})</option>
            </select>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Gelbe Zellen aus dem Bild: je Zeile, was unsicher ist - „Passt so“ oder im Feld korrigieren und neu einlesen. */
function ImageMarks({ marks, onConfirm, onConfirmAll }) {
  if (!marks.length) return null;
  const cells = marks.reduce((sum, mark) => sum + mark.cells.length, 0);
  return (
    <section className="border border-amber-400/40 bg-amber-400/[0.06] rounded-sm p-3 space-y-2" data-testid="season-table-image-marks" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-white">Aus dem Bild unsicher: {cells} {cells === 1 ? "Zelle" : "Zellen"} in {marks.length} {marks.length === 1 ? "Zeile" : "Zeilen"}</h3>
          <p className="text-xs text-amber-100/80">Mit dem Bild vergleichen. Falsches im Feld oben korrigieren und „Neu einlesen“ – sonst „Passt so“. Übernommen wird erst danach.</p>
        </div>
        <button type="button" onClick={onConfirmAll} data-testid="season-table-image-confirm-all"
          className="tls-btn tls-btn--quiet px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5" /> Alle geprüft
        </button>
      </div>
      <ul className="divide-y divide-amber-200/10">
        {marks.map((mark) => (
          <li key={mark.row} className="py-1.5 flex flex-wrap items-start justify-between gap-2 text-xs" data-testid="season-table-image-mark">
            <span className="min-w-0 text-amber-100">
              <span className="font-semibold text-white">{mark.name}</span> · {markText(mark)}
              {mark.notes.length > 0 && <span className="block text-amber-200/70">{mark.notes.join(" · ")}</span>}
            </span>
            <button type="button" onClick={() => onConfirm(mark.row)} data-testid="season-table-image-confirm"
              className="tls-btn tls-btn--quiet px-2 py-1 rounded-sm text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1">
              <Check className="w-3 h-3" /> Passt so
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function originalsUrl(series, round) {
  return `/reference-series/admin/series/${series.id}/rounds/${round.id}/originals`;
}

/** Das gelesene Bild hängt beim Übernehmen als Original „Tabelle“ am Termin (#1933) - oder eben nicht. */
function PendingOriginal({ target, onDrop, testId }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/60" data-testid={testId}>
      <ImagePlus className="w-3.5 h-3.5 text-[#29B6E8]" aria-hidden="true" />
      <span className="min-w-0">Das Bild hängt beim Übernehmen als Original „Tabelle“ an {target ? roundOption(target) : "der Runde"}.</span>
      <button type="button" onClick={onDrop} data-testid={`${testId}-drop`}
        className="tls-btn tls-btn--quiet px-2 py-1 rounded-sm text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1">
        <X className="w-3 h-3" aria-hidden="true" /> Nicht anhängen
      </button>
    </p>
  );
}

/** Original anhängen; scheitert es, bleibt das Übernommene - mit Hinweis. Liefert den Zusatz für die Meldung. */
async function attachTable(series, round, file) {
  try {
    await attachOriginal(originalsUrl(series, round), file, { kind: "table", origin: "reading" });
    return " Original-Bild angehängt.";
  } catch (err) {
    toast.error(`Das Original-Bild wurde nicht angehängt: ${formatApiError(err.response?.data?.detail) || "bitte im Ergebnisblatt unter „Original-Bilder“ neu hinzufügen."}`);
    return "";
  }
}

/** Team-Tabelle aus dem Bild → Teamwertung laut Veranstalter einer Runde: Runde wählen (Vorgabe: die letzte gewertete),
 * Team und Punkte prüfen, Vergleich mit der eigenen Rechnung, übernehmen. */
function TeamTotalsPanel({ series, result, file = null, onClose, onChanged }) {
  const url = `/reference-series/admin/series/${series.id}/team-totals`;
  const [initialRows] = useState(() => imageTeamRows(result));
  const [totals, setTotals] = useState(() => Object.fromEntries(initialRows.map((row) => [row.team, parseNumber(row.points)]).filter(([, points]) => points !== null)));
  const [open, setOpen] = useState(0);
  const [roundId, setRoundId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [attach, setAttach] = useState(Boolean(file));

  useEffect(() => {
    let alive = true;
    api.post(`${url}/preview`, { totals, round_id: roundId }, { skipInvalidation: true })
      .then(({ data }) => { if (alive) { setPreview(data); setError(""); } })
      .catch((err) => { if (alive) { setPreview(null); setError(formatApiError(err.response?.data?.detail) || "Die Vorschau ist nicht möglich."); } });
    return () => { alive = false; };
  }, [url, totals, roundId]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(url, { totals, round_id: preview.round.id, expected_version: preview.expected_version });
      // Übernommen: jetzt hängt das Bild als Original „Tabelle“ an der gewählten Runde (#1933).
      const attached = attach && file ? await attachTable(series, preview.round, file) : "";
      toast.success(`Teamwertung laut Veranstalter für ${roundOption(preview.round)} übernommen.${attached}`);
      onChanged?.();
      onClose();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  const official = new Set(Object.keys(totals));
  const rows = (preview?.rows || []).filter((row) => official.has(row.team) || row.official_points !== null);
  return (
    <section className="border border-[#29B6E8]/30 bg-[#29B6E8]/5 rounded-sm p-3 space-y-3" data-testid="season-table-team-totals">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-white">Team-Tabelle erkannt – Teamwertung laut Veranstalter</h3>
          <p className="text-xs text-white/60">Sie gilt nach der gewählten Runde für Platz und Punkte der Teamwertung; die eigene Rechnung bleibt als Prüfhinweis.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Team-Tabelle verwerfen" data-testid="season-table-team-close" className="-m-1 p-1 rounded-sm text-white/45 hover:text-white"><X className="w-4 h-4" /></button>
      </div>
      {preview && (
        <label className="block max-w-md">
          <span className="block text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Nach Runde</span>
          <select value={preview.round.id} onChange={(event) => setRoundId(event.target.value)} data-testid="season-table-team-round" className={SELECT_CLASS}>
            {preview.rounds.map((round) => <option key={round.id} value={round.id}>{roundOption(round)}{round.sheet_status === "published" ? "" : " · Entwurf"}</option>)}
          </select>
        </label>
      )}
      {error && <p className="text-sm text-amber-200" role="alert" data-testid="season-table-team-error">{error}</p>}
      {preview && !preview.team_scoring && <p className="text-xs text-amber-200">Die Saison führt keine Teamwertung – die Werte stehen dann nur im Ergebnis.</p>}
      <OfficialTeamTotals totals={totals} initialRows={initialRows} onChange={setTotals} onOpenChange={setOpen} teams={(preview?.rows || []).map((row) => row.team)} />
      {(preview?.unknown_teams || []).length > 0 && (
        <p className="text-xs text-amber-200" data-testid="season-table-team-unknown">Neu in der Saison: {preview.unknown_teams.join(", ")} – Schreibweise prüfen.</p>
      )}
      {rows.length > 0 && (
        <div className="tls-swipe">
          <table className="w-full text-sm" data-testid="season-table-team-compare">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-white/50">
                <th scope="col" className="py-1.5 pr-3 font-bold">Team</th>
                {/* Am Handy kurze Köpfe - die Zahlen bleiben lesbar, die Namen brechen nicht mitten im Wort. */}
                <th scope="col" className="py-1.5 pr-3 font-bold text-right whitespace-nowrap"><span className="sm:hidden">Bild</span><span className="hidden sm:inline">Laut Bild</span></th>
                <th scope="col" className="py-1.5 pr-3 font-bold text-right whitespace-nowrap"><span className="sm:hidden">Eigene</span><span className="hidden sm:inline">Eigene Rechnung</span></th>
                <th scope="col" className="py-1.5 font-bold text-right whitespace-nowrap"><span className="sm:hidden">Abw.</span><span className="hidden sm:inline">Abweichung</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((row) => (
                <tr key={row.team}>
                  <td className="py-1.5 pr-3 text-white break-words">{row.team}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-white">{row.official_points ?? "–"}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-white/70">{row.computed_points ?? "–"}</td>
                  <td className={`py-1.5 text-right tabular-nums ${row.deviation ? "text-amber-200" : "text-white/45"}`}>{row.deviation ? (row.deviation > 0 ? `+${row.deviation}` : `−${Math.abs(row.deviation)}`) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {attach && file && preview && <PendingOriginal target={preview.round} onDrop={() => setAttach(false)} testId="season-table-team-original" />}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={!preview || open > 0 || saving || !Object.keys(totals).length} data-testid="season-table-team-save"
          className="tls-btn tls-btn--primary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">
          {saving ? "Übernimmt …" : "Teamwertung übernehmen"}
        </button>
        {open > 0 && <span className="text-xs text-amber-200">Erst die gelben Zeilen prüfen.</span>}
      </div>
    </section>
  );
}

function rankText(item) {
  if (!item.rank && !item.table_rank) return "–";
  if (!item.table_rank || item.rank === item.table_rank) return String(item.rank || item.table_rank);
  return `${item.table_rank} → ${item.rank || "–"}`;
}

const TOTAL_TONES = { ok: "text-white/60", explained: "text-[#29B6E8]", differs: "text-amber-200", no_total: "text-white/45" };

function TotalsTable({ totals, error }) {
  const [onlyIssues, setOnlyIssues] = useState(true);
  if (error) return <p className="text-sm text-amber-200" role="alert" data-testid="season-table-totals-error">{error}</p>;
  if (!totals) return null;
  const summary = totalsSummary(totals);
  const issues = totals.filter((item) => item.state !== "ok" || item.rank_differs);
  const shown = onlyIssues ? issues : totals;
  const parts = [`${summary.ok} stimmen`];
  if (summary.explained) parts.push(`${summary.explained} erklärt`);
  if (summary.differs) parts.push(`${summary.differs} ${summary.differs === 1 ? "weicht" : "weichen"} ab`);
  if (summary.none) parts.push(`${summary.none} ohne „Gesamt“`);
  if (summary.ranks) parts.push(`${summary.ranks} mit anderem Platz`);
  return (
    <section className="space-y-2" data-testid="season-table-totals">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-white">Abgleich mit „Gesamt“</h3>
        <span className={`text-xs tabular-nums ${summary.differs ? "text-amber-200" : "text-white/60"}`} data-testid="season-table-totals-summary">{parts.join(" · ")}</span>
      </div>
      <p className="text-xs text-white/55">Die eigene Rechnung nach allen Runden, als wären die Entwürfe veröffentlicht – mit Streichresultaten, Anpassungen und Boni der Saison.</p>
      <CheckField label="Nur Auffällige zeigen" checked={onlyIssues} onChange={setOnlyIssues} testId="season-table-only-issues" />
      {shown.length === 0 ? (
        <p className="text-sm text-emerald-200/90" data-testid="season-table-totals-fine">Alle Summen und Plätze stimmen mit der Tabelle.</p>
      ) : (
        <div className="tls-swipe">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-white/50">
                <th scope="col" className="py-1.5 pr-3 font-bold">Fahrer</th>
                <th scope="col" className="py-1.5 pr-3 font-bold text-right">Tabelle</th>
                <th scope="col" className="py-1.5 pr-3 font-bold text-right">Gerechnet</th>
                <th scope="col" className="py-1.5 pr-3 font-bold text-right">Platz</th>
                <th scope="col" className="hidden sm:table-cell py-1.5 font-bold">Hinweis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {shown.map((item) => (
                <tr key={item.row} data-testid="season-table-total" data-state={item.state} className="align-top">
                  <td className="py-1.5 pr-3 text-white break-words [overflow-wrap:anywhere]">
                    {item.name}{item.is_new && <span className="ml-1.5 text-[10px] font-bold uppercase tracking-widest text-[#29B6E8]">neu</span>}
                    {/* Am Handy steht der Hinweis unter dem Namen statt in einer eigenen Spalte. */}
                    <span className={`block sm:hidden text-xs ${TOTAL_TONES[item.state] || "text-white/60"}`}>{totalText(item)}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-white/80">{item.table_total ?? "–"}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-white">{item.computed}</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${item.rank_differs ? "text-amber-200" : "text-white/70"}`}>{rankText(item)}</td>
                  <td className={`hidden sm:table-cell py-1.5 text-xs ${TOTAL_TONES[item.state] || "text-white/60"}`}>{totalText(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function SeasonTableSection({ series, onChanged }) {
  const url = `/reference-series/admin/series/${series.id}/season-table`;
  const byOrganizer = series.rules?.points_mode === "organizer";
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [kinds, setKinds] = useState([]);
  const [roundIds, setRoundIds] = useState({});
  const [points, setPoints] = useState("scheme");
  const [decisions, setDecisions] = useState([]);
  const [known, setKnown] = useState({});
  const [preview, setPreview] = useState(null);
  const [choice, setChoice] = useState({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [unknownOpen, setUnknownOpen] = useState(false);
  const request = useRef(0);
  const pasteRef = useRef(null);
  const [imageMarks, setImageMarks] = useState([]);
  const [teamImage, setTeamImage] = useState(null);
  const [tableFile, setTableFile] = useState(null);

  const body = useMemo(() => (parsed && kinds.includes("name") ? buildBody(parsed, kinds, roundIds, points, decisions) : null),
    [parsed, kinds, roundIds, points, decisions]);

  const runPreview = useCallback(async (next) => {
    const mine = ++request.current;
    setBusy("preview");
    setError("");
    try {
      // Die Vorschau schreibt nichts - sie soll die übrigen Abschnitte nicht neu laden lassen.
      const { data } = await api.post(`${url}/preview`, next, { skipInvalidation: true });
      if (mine !== request.current) return;
      setPreview(data);
      setKnown((current) => rememberCandidates(current, data.columns));
    } catch (err) {
      if (mine !== request.current) return;
      setPreview(null);
      setError(formatApiError(err.response?.data?.detail) || "Die Vorschau ist nicht möglich.");
    } finally {
      if (mine === request.current) setBusy("");
    }
  }, [url]);

  useEffect(() => {
    if (body && body.rows.length && body.columns.length) runPreview(body);
  }, [body, runPreview]);

  const startWith = (result) => {
    setParsed(result);
    setKinds(result.columns.map((column) => column.kind));
    setRoundIds({});
    setDecisions([]);
    setKnown({});
    setChoice({});
    setPreview(null);
  };
  // Bild (#1999): Fahrer-Tabelle als Text ins Feld und in die Vorschau, Team-Tabelle zur Teamwertung laut Veranstalter.
  const image = useResultImage({
    base: url, paste: false,
    onRead: (result, file) => {
      if (result.detected === "teams") {
        setTeamImage({ result, file: file || null });
        return;
      }
      setTableFile(file || null);
      const table = imageTable(result);
      setText(tableText(table.parsed));
      setImageMarks(table.marks);
      setTeamImage(null);
      startWith(table.parsed);
    },
  });

  const read = () => {
    // Nach dem Einfügen steht das Feld am Ende - zum Prüfen wieder an den Anfang der Tabelle.
    if (pasteRef.current) {
      pasteRef.current.scrollTop = 0;
      pasteRef.current.scrollLeft = 0;
    }
    // Neu eingelesen gilt der Text im Feld - was aus dem Bild gelb war, hat jemand geprüft oder korrigiert.
    setImageMarks([]);
    startWith(parseSeasonTablePaste(text));
  };

  const changeKind = (index, kind) => {
    setKinds((current) => current.map((value, position) => (position === index ? kind : value)));
    // Andere Runden-Spalten: Entscheidungen gelten für die alte Zählung der Spalten.
    setDecisions([]);
    setKnown({});
  };
  const rounds = roundColumns(kinds);
  const changeRound = (column, value) => setRoundIds((current) => ({ ...current, [rounds[column]]: value === "__skip" ? "" : value }));
  const decide = (cell, value) => setDecisions((current) => mergeDecisions(current, [[cell.id, decisionFor(cell, value)]]));

  const columns = preview?.columns || [];
  const picked = columns.filter((column) => isSelectable(column) && (choice[column.index] ?? column.state === "new")).map((column) => column.index);
  const togglePick = (index) => setChoice((current) => ({ ...current, [index]: !picked.includes(index) }));
  const cells = unclearCells(columns, body?.rows || [], known);
  const unknown = preview?.unknown_names || [];

  const apply = async () => {
    setBusy("apply");
    try {
      const { data } = await api.post(`${url}/apply`, applyBody(body, columns, picked));
      const summary = applySummary(data.items || []);
      // Übernommen: das gelesene Bild hängt als Original „Tabelle“ an der letzten Runde der Tabelle (#1933).
      const target = lastTableRound(columns);
      const saved = (data.items || []).some((item) => item.status === "saved");
      const attached = tableFile && target && saved ? await attachTable(series, target, tableFile) : "";
      if (saved) setTableFile(null);
      (summary.ok ? toast.success : toast.error)(`${summary.text}${attached}`);
      onChanged?.();
      if (data.open_unknown) setUnknownOpen(true);
      setChoice({});
      await runPreview(body);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy("");
    }
  };

  const parseErrors = parsed?.errors || [];
  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4" aria-labelledby="season-table-heading" data-testid="season-table">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="season-table-heading" className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Saisontabelle einlesen</h2>
          <p className="mt-1 text-sm text-white/60">Vergangene Runden in einem Schritt nachtragen: die Gesamttabelle des Veranstalters einfügen – je Runde entsteht ein Entwurf, veröffentlicht wird nichts.</p>
        </div>
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} data-testid="season-table-toggle"
          className="tls-btn tls-btn--secondary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
          <TableProperties className="w-3.5 h-3.5" aria-hidden="true" /> {open ? "Schließen" : "Tabelle einfügen"}
        </button>
      </div>
      {open && (
        <div className="mt-4 space-y-4">
          <label className="block min-w-0">
            <span className="block text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Tabelle des Veranstalters</span>
            <textarea ref={pasteRef} rows={8} wrap="off" spellCheck={false} value={text} onChange={(event) => setText(event.target.value)}
              placeholder={PLACEHOLDER} data-testid="season-table-text" className={PASTE_CLASS} />
            <span className="mt-1 block text-xs text-white/45">Aus der Tabellenkalkulation oder einer Webseite kopieren: Fahrer (auch Name#TAG), optional Team, je Runde Punkte, optional Gesamt. OUT oder DNF = Ausfall, -- oder leer = nicht angetreten, DSQ, DNS.</span>
          </label>
          <fieldset className="space-y-1.5" disabled={byOrganizer}>
            <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Punkte</legend>
            {POINT_MODES.map(([value, label]) => (
              <label key={value} className="flex items-start gap-2 text-sm text-white/80">
                <input type="radio" name={`season-points-${series.id}`} value={value} checked={(byOrganizer ? "organizer" : points) === value}
                  onChange={() => setPoints(value)} data-testid={`season-table-points-${value}`} style={{ accentColor: "#29B6E8" }} className="mt-1 shrink-0" />
                <span>{label}
                  <span className="block text-xs text-white/45">
                    {value === "scheme" ? "Über das Punkteschema der Runde; nicht Eindeutiges wird gelb." : "Ohne Rückrechnung, etwa wenn Boni schon im Wert stecken (21 = 18 + 3 Bingo) – mit Hinweis, wenn ein Wert nicht im Schema liegt."}
                  </span>
                </span>
              </label>
            ))}
            {byOrganizer && <p className="text-xs text-white/45">Die Saison zählt Punkte laut Veranstalter – zurückgerechnet wird nicht.</p>}
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={read} disabled={!text.trim() || busy === "apply"} data-testid="season-table-read"
              className="tls-btn tls-btn--primary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">
              {parsed ? "Neu einlesen" : "Einlesen"}
            </button>
            <ResultImageButton image={image} pasteHint={false} testId="season-table-image" fileTestId="season-table-image-file" />
            {image.busy && <span className="text-xs text-white/60" role="status" data-testid="season-table-image-reading">Bild wird gelesen – das dauert ein paar Sekunden.</span>}
            {busy === "preview" && <span className="text-xs text-white/50" role="status">Rechnet die Vorschau …</span>}
          </div>
          {teamImage && <TeamTotalsPanel series={series} result={teamImage.result} file={teamImage.file} onClose={() => setTeamImage(null)} onChanged={onChanged} />}
          <ImageMarks marks={imageMarks} onConfirm={(row) => setImageMarks((current) => current.filter((mark) => mark.row !== row))} onConfirmAll={() => setImageMarks([])} />
          {parseErrors.length > 0 && (
            <ul className="text-sm text-amber-200 space-y-0.5" data-testid="season-table-parse-errors">
              {parseErrors.map((item, index) => <li key={index}>{item.line ? `Zeile ${item.line}: ` : ""}{item.message}</li>)}
            </ul>
          )}
          {error && <p className="border border-red-400/40 bg-red-400/10 rounded-sm px-3 py-2 text-sm text-red-100" role="alert" data-testid="season-table-error">{error}</p>}
          {parsed && parsed.columns.length > 0 && <ColumnKinds parsed={parsed} kinds={kinds} onKind={changeKind} />}
          {preview && (
            <div className="space-y-5" data-testid="season-table-preview">
              <p className="text-sm text-white/75 tabular-nums" data-testid="season-table-summary">
                {preview.summary.rows} Fahrer · {preview.summary.mapped} von {preview.summary.columns} Runden zugeordnet
                {preview.summary.unclear ? ` · ${preview.summary.unclear} gelb` : ""}{preview.summary.errors ? ` · ${preview.summary.errors} mit Fehler` : ""}
              </p>
              <ol className="divide-y divide-white/5 border-y border-white/10">
                {columns.map((column) => (
                  <ColumnItem key={column.index} column={column} rounds={preview.rounds || []} roundId={roundIds[rounds[column.index]] === "" ? "__skip" : roundIds[rounds[column.index]]}
                    picked={picked.includes(column.index)} onPick={togglePick} onRound={(value) => changeRound(column.index, value)} />
                ))}
              </ol>
              {cells.length > 0 && (
                <UnclearList cells={cells} decisions={decisions} onDecide={decide} busy={Boolean(busy)}
                  onProposals={() => setDecisions((current) => mergeDecisions(current, proposalDecisions(cells).map((item) => [cellKey(item), item])))}
                  onOrganizer={() => setDecisions((current) => mergeDecisions(current, organizerDecisions(cells).map((item) => [cellKey(item), item])))} />
              )}
              <TotalsTable totals={preview.totals} error={preview.totals_error} />
              {unknown.length > 0 && (
                <p className="text-sm text-white/70" data-testid="season-table-unknown">
                  {unknown.length} {unknown.length === 1 ? "Name ist" : "Namen sind"} neu in der Saison – beim Übernehmen werden sie offene Teilnehmer, danach ordnest du sie zu.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={apply} disabled={!picked.length || Boolean(busy) || imageMarks.length > 0} data-testid="season-table-apply"
                  className="tls-btn tls-btn--primary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">
                  {busy === "apply" ? "Übernimmt …" : `Übernehmen (${picked.length})`}
                </button>
                {tableFile && <PendingOriginal target={lastTableRound(columns)} onDrop={() => setTableFile(null)} testId="season-table-original" />}
                <span className="text-xs text-white/50">Ergebnisse kommen als Entwurf. Vorhandenes wird nur ersetzt, wenn du es anhakst – ein veröffentlichtes Ergebnis bekommt einen Entwurf daneben. Runden mit gelben Zellen kommen nach dem Klären dazu.</span>
              </div>
            </div>
          )}
        </div>
      )}
      {unknownOpen && <UnknownNamesSheet series={series} onClose={() => setUnknownOpen(false)} onChanged={onChanged} />}
    </section>
  );
}

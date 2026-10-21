import { useState } from "react";
import { INPUT_CLASS, TextAreaField } from "@/components/tls/FormFields";
import { parseNumber } from "@/lib/resultPaste";
import { parseTeamTotals, teamTotalsObject, teamTotalsRows } from "@/lib/seriesSpecialRules";
import { ClipboardList, Plus, X } from "lucide-react";

// Teamwertung laut Veranstalter (#1960) im Ergebnisblatt einer Rennliga: nach dieser Runde die offiziellen Teampunkte
// eintragen oder einfügen (`official_team_totals`). Ist sie da, gilt sie für Platz und Punkte der Teamwertung; die eigene
// Rechnung steht auf der Serienseite nur noch als Vergleich bzw. Prüfhinweis. Eine Zeile ohne gültige Zahl geht nicht
// mit - sie ist rot markiert, bis sie stimmt.

const SMALL_INPUT = `${INPUT_CLASS} !py-1.5 text-sm`;
const BUTTON = "tls-btn tls-btn--quiet px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5";
let rowKey = 0;
const keyed = (row) => {
  rowKey += 1;
  return { key: `teamwert-${rowKey}`, team: row.team || "", points: row.points === undefined || row.points === null ? "" : String(row.points).replace(".", ",") };
};

export function OfficialTeamTotals({ totals, teams = [], onChange }) {
  const [rows, setRows] = useState(() => teamTotalsRows(totals).map(keyed));
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const [errors, setErrors] = useState([]);

  const publish = (next) => {
    setRows(next);
    onChange(teamTotalsObject(next.map((row) => ({ team: row.team, points: parseNumber(row.points) })).filter((row) => row.points !== null)));
  };
  const update = (key, values) => publish(rows.map((row) => (row.key === key ? { ...row, ...values } : row)));
  const apply = () => {
    const result = parseTeamTotals(text);
    setErrors(result.errors);
    if (result.rows.length) {
      publish(result.rows.map(keyed));
      setText("");
      setPasting(result.errors.length > 0);
    }
  };

  return (
    <section className="border border-white/10 rounded-sm bg-[#0A0A0A] p-3 space-y-2" data-testid="result-team-totals">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Teamwertung laut Veranstalter{rows.length ? ` · ${rows.length}` : ""}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setPasting((value) => !value)} aria-expanded={pasting} data-testid="result-team-totals-paste-toggle" className={BUTTON}>
            <ClipboardList className="w-3.5 h-3.5" /> Einfügen
          </button>
          {rows.length > 0 && <button type="button" onClick={() => publish([])} data-testid="result-team-totals-clear" className={BUTTON}>Leeren</button>}
        </div>
      </div>
      <p className="text-xs text-white/55">Optional, nach dieser Runde. Ist sie da, gilt sie für Platz und Punkte der Teamwertung – die eigene Rechnung bleibt als Vergleich.</p>
      {pasting && (
        <div className="space-y-2">
          <TextAreaField label="Teamwertung einfügen" value={text} onChange={(value) => { setText(value); setErrors([]); }} rows={4} placeholder={"1. Team A 123\n2. Team B 98"}
            hint="Je Zeile ein Team und seine Punkte – aus der Tabelle des Veranstalters kopiert (Tab, „|“ oder „;“). Ersetzt die Liste." testId="result-team-totals-text" />
          <button type="button" onClick={apply} disabled={!text.trim()} data-testid="result-team-totals-apply" className="tls-btn tls-btn--secondary px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">Liste übernehmen</button>
          {errors.length > 0 && (
            <ul className="text-xs text-red-200 space-y-0.5" role="alert" data-testid="result-team-totals-errors">
              {errors.map((error) => <li key={`${error.line}-${error.text}`}>{`Zeile ${error.line}: ${error.message}`}{error.text ? <span className="text-red-200/60">{` – „${error.text}“`}</span> : null}</li>)}
            </ul>
          )}
        </div>
      )}
      {rows.length > 0 && (
        <ol className="space-y-1.5" data-testid="result-team-totals-rows">
          {rows.map((row, index) => {
            const invalid = String(row.points).trim() !== "" && parseNumber(row.points) === null;
            return (
              <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_6rem_auto] items-center gap-2" data-testid="result-team-total">
                <input aria-label={`Team ${index + 1}`} value={row.team} list="result-team-total-names" maxLength={120} placeholder="Team" onChange={(event) => update(row.key, { team: event.target.value })} className={SMALL_INPUT} data-testid="result-team-total-team" />
                <input aria-label={`Punkte Team ${index + 1}`} value={row.points} placeholder="Pkt" onChange={(event) => update(row.key, { points: event.target.value })} aria-invalid={invalid || undefined}
                  className={`${SMALL_INPUT} text-right tabular-nums ${invalid ? "!border-red-400/80" : ""}`} data-testid="result-team-total-points" />
                <button type="button" onClick={() => publish(rows.filter((item) => item.key !== row.key))} aria-label={`Team ${index + 1} entfernen`} className="p-1.5 rounded-sm text-white/45 hover:text-white hover:bg-white/5"><X className="w-4 h-4" /></button>
              </li>
            );
          })}
        </ol>
      )}
      <datalist id="result-team-total-names">{teams.map((team) => <option key={team} value={team} />)}</datalist>
      <button type="button" onClick={() => setRows((current) => [...current, keyed({})])} data-testid="result-team-total-add" className={BUTTON}>
        <Plus className="w-3.5 h-3.5" /> Team
      </button>
    </section>
  );
}

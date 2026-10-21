import { INPUT_CLASS } from "@/components/tls/FormFields";
import { formatPoints } from "@/lib/referenceResults";
import { emptyRound, roundsTotal } from "@/lib/tournamentDays";

// Ergebnisblatt eines Turniertags (#1961): je Zeile die Runden R1…Rn (Punkte wie beim Veranstalter gelesen - Bots in
// einer Lobby verschieben sie, darum wird nichts aus der Reihenfolge der Menschen gerechnet), GES P mit der Summe als
// Vorschlag, im Double Up der Partner („mit …“) und die Sonderboni der Saison als Chips. Unter „Mehr“ je Runde der Platz
// in der Lobby samt Bots und die Lobby - ohne Punkte zählt der Platz nach dem Rundenschema.

const SMALL_INPUT = `${INPUT_CLASS} !py-1.5 text-sm`;
const LABEL = "text-[10px] font-bold uppercase tracking-widest text-white/45";
const INVALID = "!border-red-400/80";
const CHIP = "px-2 py-1 rounded-sm border text-[10px] font-bold uppercase tracking-wider transition-colors active:scale-[0.97]";
const CHIP_ON = "border-[#29B6E8] bg-[#29B6E8]/15 text-[#29B6E8]";
const CHIP_OFF = "border-white/10 text-white/50 hover:text-white";

function setRound(row, index, values) {
  const rounds = [...(row.rounds || [])];
  while (rounds.length <= index) rounds.push(emptyRound());
  rounds[index] = { ...rounds[index], ...values };
  return { rounds };
}

/** Runden, GES P und Partner einer Zeile - unter Platz und Name. */
export function DayRoundsLine({ row, number, count, scheme, doubleUp, invalid, onChange }) {
  const sum = roundsTotal(row, scheme);
  return (
    <div className="mt-1.5 flex flex-wrap items-end gap-1.5 sm:pl-[4rem]" data-testid="result-row-day">
      {doubleUp && (
        <label className="block w-full sm:w-44">
          <span className={LABEL}>mit</span>
          <input aria-label={`Partner Zeile ${number}`} value={row.partner} list="result-row-names" maxLength={120} placeholder="Partner im Double Up"
            onChange={(event) => onChange({ partner: event.target.value })} data-testid="result-row-partner" className={SMALL_INPUT} />
        </label>
      )}
      {Array.from({ length: count }, (_, index) => {
        const entry = row.rounds?.[index] || emptyRound();
        const bad = invalid?.[`round_${index}`];
        return (
          <label key={index} className="block w-11">
            <span className={LABEL}>R{index + 1}</span>
            <input aria-label={`Runde ${index + 1} Zeile ${number}`} inputMode="decimal" value={entry.points} placeholder={entry.place ? "P" : ""}
              title={entry.place ? `Platz ${entry.place} in der Lobby` : "Punkte der Runde"}
              onChange={(event) => onChange(setRound(row, index, { points: event.target.value }))} data-testid="result-row-round"
              aria-invalid={bad ? true : undefined} className={`${SMALL_INPUT} !px-1 text-center tabular-nums ${bad ? INVALID : ""}`} />
          </label>
        );
      })}
      <label className="block w-16">
        <span className={LABEL}>GES P</span>
        <input aria-label={`GES P Zeile ${number}`} inputMode="decimal" value={row.day_points} placeholder={sum === null ? "–" : formatPoints(sum)}
          title="Leer: Summe der Runden. Eingetragen: Wert des Veranstalters (wird gegen die Runden geprüft)."
          onChange={(event) => onChange({ day_points: event.target.value })} data-testid="result-row-day-points"
          aria-invalid={invalid?.day_points ? true : undefined} className={`${SMALL_INPUT} !px-1 text-center tabular-nums font-bold ${invalid?.day_points ? INVALID : ""}`} />
      </label>
    </div>
  );
}

/** Unter „Mehr“: je Runde Platz in der Lobby (samt Bots) und Lobby. */
export function DayRoundsDetails({ row, number, count, invalid, onChange }) {
  if (!count) return null;
  return (
    <div className="mt-2 overflow-x-auto" data-testid="result-row-day-details">
      <table className="text-sm">
        <thead>
          <tr className={LABEL}>
            <th scope="col" className="pr-2 text-left font-bold">Runde</th>
            {Array.from({ length: count }, (_, index) => <th key={index} scope="col" className="px-0.5 font-bold">R{index + 1}</th>)}
          </tr>
        </thead>
        <tbody>
          {[["place", "Platz", "numeric"], ["lobby", "Lobby", "text"]].map(([field, label, mode]) => (
            <tr key={field}>
              <th scope="row" className={`${LABEL} pr-2 text-left font-bold`}>{label}</th>
              {Array.from({ length: count }, (_, index) => {
                const bad = field === "place" && invalid?.[`round_place_${index}`];
                return (
                  <td key={index} className="px-0.5 py-0.5">
                    <input aria-label={`${label} Runde ${index + 1} Zeile ${number}`} inputMode={mode} maxLength={field === "lobby" ? 20 : 3}
                      value={row.rounds?.[index]?.[field] || ""} onChange={(event) => onChange(setRound(row, index, { [field]: event.target.value }))}
                      data-testid={`result-row-round-${field}`} aria-invalid={bad ? true : undefined}
                      className={`${SMALL_INPUT} !w-11 !px-1 text-center tabular-nums ${bad ? INVALID : ""}`} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-white/45">Platz in der Lobby samt Bots. Ohne Punkte zählt der Platz nach den Rundenpunkten der Saison.</p>
    </div>
  );
}

/** Sonderboni der Saison als Chips - offen alle, sonst nur die abgehakten. */
export function BonusChips({ row, bonuses, open, number, onChange }) {
  const chosen = row.bonus_keys || [];
  const shown = (bonuses || []).filter((bonus) => open || chosen.includes(bonus.key));
  if (!shown.length) return null;
  const toggle = (key) => onChange({ bonus_keys: chosen.includes(key) ? chosen.filter((item) => item !== key) : [...chosen, key] });
  return (
    <>
      {shown.map((bonus) => {
        const active = chosen.includes(bonus.key);
        return (
          <button key={bonus.key} type="button" aria-pressed={active} onClick={() => toggle(bonus.key)} aria-label={`${bonus.label} Zeile ${number}`}
            data-testid={`result-row-bonus-${bonus.key}`} className={`${CHIP} ${active ? CHIP_ON : CHIP_OFF}`}>
            {bonus.label} +{formatPoints(bonus.points)}
          </button>
        );
      })}
    </>
  );
}

/** Double Up für das ganze Blatt: Zweierteams teilen Platz und Punkte. */
export function DoubleUpToggle({ value, onChange }) {
  return (
    <label className="flex items-center gap-2 text-xs text-white/75" data-testid="result-double-up">
      <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} data-testid="result-double-up-toggle" className="accent-[#29B6E8]" />
      <span><span className="font-bold text-white/90">Double Up</span> – Zweierteams, beide bekommen denselben Platz und dieselben Punkte</span>
    </label>
  );
}

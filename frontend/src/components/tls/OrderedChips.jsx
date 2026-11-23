// Eine Reihenfolge zum Anklicken: jedes Kriterium ist an oder aus, die Nummer zeigt, als wievieltes es zählt. Für die
// Tabellenregeln der Liga (E.1, #1625) und die Gleichstandsregeln der Turniere (#1559) - dieselbe Bedienung an beiden Stellen.
export function OrderedChips({ legend, labels, keys, value, onChange, hint, testPrefix }) {
  const toggle = (key) => onChange(value.includes(key) ? value.filter((item) => item !== key) : [...value, key]);
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {keys.map((key) => {
          const position = value.indexOf(key);
          return (
            <label key={key} className={`inline-flex min-h-[40px] items-center gap-2 rounded-sm border px-3 py-1.5 text-xs cursor-pointer select-none focus-within:outline focus-within:outline-1 focus-within:outline-[#29B6E8] ${position >= 0 ? "border-[#29B6E8]/70 bg-[#29B6E8]/10 text-white" : "border-white/10 bg-[#0A0A0A] text-white/65"}`}>
              <input type="checkbox" checked={position >= 0} onChange={() => toggle(key)} className="accent-[#29B6E8]" data-testid={`${testPrefix}-${key}`} />
              {position >= 0 ? <span className="font-bold tabular-nums text-[#29B6E8]">{position + 1}.</span> : null}
              {labels[key]}
            </label>
          );
        })}
      </div>
      {hint ? <p className="text-xs text-white/45">{hint}</p> : null}
    </fieldset>
  );
}

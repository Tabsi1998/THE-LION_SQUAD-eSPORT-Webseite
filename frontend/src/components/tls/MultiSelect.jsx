import { Check } from "lucide-react";

/**
 * Multi-select chip component. Toggles values in/out of the selection array.
 *
 * Props:
 *   options: [{value, label, hint?}]
 *   value: array of selected values
 *   onChange: (newValues) => void
 *   testId: prefix for chip data-testid
 */
export function MultiSelect({ options = [], value = [], onChange, testId = "ms" }) {
  const selected = new Set(value || []);
  const toggle = (v) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange(Array.from(next));
  };
  return (
    <div className="flex flex-wrap gap-2" data-testid={testId}>
      {options.map((o) => {
        const on = selected.has(o.value);
        return (
          <button
            key={o.value}
            type="button"
            data-testid={`${testId}-${o.value}`}
            onClick={() => toggle(o.value)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border text-xs font-bold uppercase tracking-wider transition ${
              on
                ? "border-[#29B6E8] bg-[#29B6E8]/15 text-[#29B6E8]"
                : "border-white/10 text-white/60 hover:border-white/30 hover:text-white"
            }`}
          >
            {on && <Check className="w-3 h-3" />}
            {o.label}
            {o.hint && <span className="text-white/40 normal-case font-normal">· {o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

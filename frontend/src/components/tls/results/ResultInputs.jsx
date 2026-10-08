import { Check, Minus, Plus } from "lucide-react";
import { FLAG_LABELS, winsNeeded } from "@/lib/resultEntry";

// Bausteine des Ergebnis-Fensters (#1156, #1370): große Knöpfe statt Zahlenfelder. Dieselben Bausteine nutzt die
// Spieler-Meldung (#1157). Jeder Knopf ist mindestens 44 px hoch - am Handy mit dem Daumen gut zu treffen.

export function Stepper({ value = 0, onChange, label, min = 0, step = 1, testId }) {
  const number = Number(value || 0);
  return (
    <div className="flex items-center gap-2" data-testid={testId}>
      <button type="button" aria-label={`${label} weniger`} disabled={number <= min} onClick={() => onChange(Math.max(min, number - step))} className="tls-btn tls-btn--secondary h-11 w-11 rounded-sm inline-flex items-center justify-center disabled:opacity-40" data-testid={testId ? `${testId}-minus` : undefined}>
        <Minus className="w-5 h-5" />
      </button>
      <output aria-label={label} className="min-w-[3rem] text-center font-display text-3xl font-bold tabular-nums text-white" data-testid={testId ? `${testId}-value` : undefined}>{number}</output>
      <button type="button" aria-label={`${label} mehr`} onClick={() => onChange(number + step)} className="tls-btn tls-btn--secondary h-11 w-11 rounded-sm inline-flex items-center justify-center" data-testid={testId ? `${testId}-plus` : undefined}>
        <Plus className="w-5 h-5" />
      </button>
    </div>
  );
}

/** „Nicht erschienen“ und „Aufgegeben“ je Seite - ein Tipp, noch ein Tipp nimmt es zurück. */
export function FlagChips({ value = null, onChange, testId }) {
  return (
    <div className="flex flex-wrap gap-2" data-testid={testId}>
      {Object.entries(FLAG_LABELS).map(([key, label]) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? null : key)}
            className={`min-h-[36px] rounded-full border px-3 text-[11px] font-bold uppercase tracking-wider transition ${active ? "border-[#FF3B30]/60 bg-[#FF3B30]/15 text-[#FF6B60]" : "border-white/10 bg-white/5 text-white/60 hover:border-white/25"}`}
            data-testid={testId ? `${testId}-${key}` : undefined}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** 1 gegen 1: je Seite Name, Plus/Minus und darunter die beiden Wörter. */
export function ScoreInput({ entry, state, onChange }) {
  return (
    <div className="space-y-3" data-testid="result-score">
      {(entry.participants || []).map((side) => (
        <div key={side.registration_id} className="rounded-sm border border-white/10 bg-[#0A0A0A] p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 font-heading font-bold uppercase truncate">{side.name}</div>
            {state.flags[side.registration_id] === "no_show" ? (
              <span className="text-xs font-bold uppercase tracking-wider text-[#FF6B60]">nicht erschienen</span>
            ) : (
              <Stepper
                label={side.name}
                value={state.scores[side.registration_id] || 0}
                onChange={(next) => onChange({ ...state, scores: { ...state.scores, [side.registration_id]: next } })}
                testId={`result-score-${side.registration_id}`}
              />
            )}
          </div>
          <div className="mt-2">
            <FlagChips value={state.flags[side.registration_id] || null} onChange={(flag) => onChange(withFlag(state, side.registration_id, flag, true))} testId={`result-flag-${side.registration_id}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Ein Flag setzen; im Duell kann nur eine Seite markiert sein - der Tipp auf der anderen Seite verschiebt es. */
export function withFlag(state, id, flag, exclusive = false) {
  const flags = exclusive ? {} : { ...state.flags };
  if (flag) flags[id] = flag;
  else delete flags[id];
  const order = (state.order || []).filter((item) => item !== id || !flag);
  return { ...state, flags, order };
}

/** Best-of: je Spiel den Sieger antippen. Nach der Entscheidung sind die übrigen Spiele aus. */
export function BestOfInput({ entry, state, onTap, onChange }) {
  const sides = entry.participants || [];
  const total = Number(entry.best_of || 3);
  const needed = winsNeeded(total);
  const wins = Object.fromEntries(sides.map((side) => [side.registration_id, 0]));
  const decidedAt = [];
  (state.games || []).forEach((game, index) => {
    if (game && game in wins) wins[game] += 1;
    decidedAt[index] = Object.values(wins).some((count) => count >= needed);
  });
  return (
    <div className="space-y-3" data-testid="result-bestof">
      <p className="text-sm text-white/60">Wer hat welches Spiel gewonnen? Es braucht {needed} von {total}.</p>
      {Array.from({ length: total }, (_, index) => {
        const off = index > 0 && decidedAt[index - 1] && !(state.games || [])[index];
        return (
          <div key={index} className={`grid grid-cols-[4.5rem_1fr_1fr] gap-2 items-center ${off ? "opacity-40" : ""}`}>
            <span className="text-[11px] font-bold uppercase tracking-widest text-white/45">Spiel {index + 1}</span>
            {sides.map((side) => {
              const active = (state.games || [])[index] === side.registration_id;
              return (
                <button
                  key={side.registration_id}
                  type="button"
                  disabled={off}
                  aria-pressed={active}
                  onClick={() => onTap(index, side.registration_id)}
                  className={`min-h-[44px] rounded-sm border px-2 text-xs font-bold uppercase tracking-wider truncate transition ${active ? "border-[#29B6E8]/70 bg-[#29B6E8]/15 text-[#29B6E8]" : "border-white/10 bg-white/5 text-white/70 hover:border-[#29B6E8]/45"}`}
                  data-testid={`result-game-${index + 1}-${side.registration_id}`}
                >
                  {active ? <Check className="inline w-3.5 h-3.5 mr-1 -mt-0.5" /> : null}{side.name}
                </button>
              );
            })}
          </div>
        );
      })}
      <div className="grid grid-cols-2 gap-2 pt-1">
        {sides.map((side) => (
          <div key={side.registration_id}>
            <div className="text-[11px] text-white/45 truncate mb-1">{side.name}</div>
            <FlagChips value={state.flags[side.registration_id] || null} onChange={(flag) => onChange(withFlag(state, side.registration_id, flag, true))} testId={`result-flag-${side.registration_id}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Zeitduell: antippen, wer gewonnen hat. */
export function WinnerInput({ entry, state, onChange }) {
  return (
    <div className="space-y-3" data-testid="result-winner">
      <p className="text-sm text-white/60">Wer hat gewonnen?</p>
      <div className="grid grid-cols-2 gap-2">
        {(entry.participants || []).map((side) => {
          const active = state.winner === side.registration_id;
          return (
            <button key={side.registration_id} type="button" aria-pressed={active} onClick={() => onChange({ ...state, winner: side.registration_id })} className={`min-h-[48px] rounded-sm border px-3 text-sm font-bold uppercase tracking-wider transition ${active ? "border-[#29B6E8]/70 bg-[#29B6E8]/15 text-[#29B6E8]" : "border-white/10 bg-white/5 text-white/70"}`} data-testid={`result-winner-${side.registration_id}`}>
              {side.name}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(entry.participants || []).map((side) => (
          <FlagChips key={side.registration_id} value={state.flags[side.registration_id] || null} onChange={(flag) => onChange(withFlag(state, side.registration_id, flag, true))} testId={`result-flag-${side.registration_id}`} />
        ))}
      </div>
    </div>
  );
}

/** Durchgang per Zielreihenfolge: antippen, wie sie ins Ziel kamen; noch ein Tipp nimmt es heraus. */
export function OrderInput({ entry, state, onChange }) {
  const order = state.order || [];
  const tap = (id) => {
    if (state.flags[id]) return;
    onChange({ ...state, order: order.includes(id) ? order.filter((item) => item !== id) : [...order, id] });
  };
  return (
    <div className="space-y-2" data-testid="result-order">
      <p className="text-sm text-white/60">In Zielreihenfolge antippen – wer zuerst im Ziel war, zuerst. Noch ein Tipp nimmt es zurück.</p>
      {(entry.participants || []).map((side) => {
        const place = order.indexOf(side.registration_id) + 1;
        const flag = state.flags[side.registration_id];
        return (
          <div key={side.registration_id} className={`rounded-sm border p-2 ${place ? "border-[#29B6E8]/40 bg-[#29B6E8]/5" : "border-white/10 bg-[#0A0A0A]"}`}>
            <button type="button" onClick={() => tap(side.registration_id)} disabled={Boolean(flag)} className="w-full min-h-[44px] flex items-center gap-3 text-left disabled:opacity-60" data-testid={`result-order-${side.registration_id}`}>
              <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-lg font-bold ${place === 1 ? "bg-[#FFD700] text-black" : place ? "bg-[#29B6E8] text-black" : "bg-white/10 text-white/40"}`}>{flag ? "–" : place || ""}</span>
              <span className="min-w-0 flex-1 font-heading font-bold uppercase truncate">{side.name}</span>
              {flag ? <span className="text-[11px] font-bold uppercase tracking-wider text-[#FF6B60]">{FLAG_LABELS[flag]}</span> : null}
            </button>
            <div className="mt-1 pl-11">
              <FlagChips value={flag || null} onChange={(next) => onChange(withFlag(state, side.registration_id, next))} testId={`result-flag-${side.registration_id}`} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Durchgang mit Punkten je Fahrer: Plus/Minus, zum schnellen Eintippen auch ein Zahlenfeld. */
export function PointsInput({ entry, state, onChange }) {
  return (
    <div className="space-y-2" data-testid="result-points">
      {(entry.participants || []).map((side) => {
        const flag = state.flags[side.registration_id];
        return (
          <div key={side.registration_id} className="rounded-sm border border-white/10 bg-[#0A0A0A] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 font-heading font-bold uppercase truncate">{side.name}</div>
              {flag ? <span className="text-[11px] font-bold uppercase tracking-wider text-[#FF6B60]">{FLAG_LABELS[flag]}</span> : (
                <Stepper label={side.name} value={state.scores[side.registration_id] || 0} onChange={(next) => onChange({ ...state, scores: { ...state.scores, [side.registration_id]: next } })} testId={`result-points-${side.registration_id}`} />
              )}
            </div>
            <div className="mt-2">
              <FlagChips value={flag || null} onChange={(next) => onChange(withFlag(state, side.registration_id, next))} testId={`result-flag-${side.registration_id}`} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

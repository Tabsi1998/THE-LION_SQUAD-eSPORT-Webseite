import { Check } from "lucide-react";

// Ein Baustein für Abstimmungen (#2612): Versammlungen (#327, Popup #844) und Abstimmungen am Event nutzen dieselben
// Teile - die sichere Form einer Abstimmung aus der Server-Antwort, die Auswahl der Antworten je Stimmrecht und die
// Anzeige des Ergebnisses. Die Form liefert der Server bei beiden gleich (backend/services/ballot_views.py): `options`
// (Code und Beschriftung), `rights` (Stimmrechte) und `result` (Zahl je Antwort, gültige Stimmen, Gewinner).

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Eine Abstimmung in sicherer Form (#986): nur Antworten mit Code, Stimmrechte als Objekte, eine Frage als Text. Eine
 * kaputte Abstimmung hat danach leere Listen statt eines Absturzes; ohne Kennung ist sie `null`.
 */
export function normalizeBallot(ballot) {
  if (!isObject(ballot) || ballot.id == null || ballot.id === "") return null;
  return {
    ...ballot,
    question: typeof ballot.question === "string" ? ballot.question : "",
    options: (Array.isArray(ballot.options) ? ballot.options : []).filter((option) => isObject(option) && option.code != null && option.code !== ""),
    rights: (Array.isArray(ballot.rights) ? ballot.rights : []).filter((right) => isObject(right) && right.right_id != null),
  };
}

/** Eine Liste von Abstimmungen in sicherer Form - Unbrauchbares fällt heraus. */
export function normalizeBallotList(list) {
  return (Array.isArray(list) ? list : []).map(normalizeBallot).filter(Boolean);
}

/** Ist die Antwort gewählt? `chosen` ist ein Code (eine Antwort) oder eine Liste (mehrere). */
function isChosen(chosen, code) {
  return Array.isArray(chosen) ? chosen.includes(code) : chosen === code;
}

/**
 * Die Antworten zu einem Stimmrecht als Knöpfe zum Wählen (aria-pressed). Mit `multiple` darf mehr als eine gewählt
 * sein - `onChoose` meldet nur den Code, die Stelle entscheidet über An und Aus.
 */
export function BallotChoice({ ballot, right, label, chosen, onChoose, disabled = false, multiple = false }) {
  return (
    <div className="space-y-2" data-testid={`ballot-right-${right.right_id}`}>
      {label ? <div className="tls-type-label text-white/55">{label}</div> : null}
      <div className="flex flex-wrap gap-2" role={multiple ? "group" : undefined} aria-label={multiple ? label || ballot.question : undefined}>
        {ballot.options.map((option) => {
          const pressed = isChosen(chosen, option.code);
          return (
            <button key={option.code} type="button" disabled={disabled} onClick={() => onChoose(option.code)}
              data-testid={`ballot-option-${right.right_id}-${option.code}`} aria-pressed={pressed}
              className={`min-h-11 px-4 py-2 rounded-sm border tls-type-small font-bold transition disabled:opacity-40 ${pressed ? "border-brand bg-brand/15 text-brand" : "border-white/15 text-white/80 hover:border-white/40"}`}>
              {multiple && pressed ? <Check className="inline w-4 h-4 mr-1.5 -mt-0.5" aria-hidden="true" /> : null}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Anteil einer Antwort an den gültigen Stimmen, gerundet - 0 ohne Stimmen. */
export function sharePercent(count, valid) {
  const total = Number(valid) || 0;
  return total > 0 ? Math.round(((Number(count) || 0) / total) * 100) : 0;
}

/**
 * Das Ergebnis. Ohne `bars` die kurze Zeile der Versammlungen („Ja 41 · Nein 3 · gültig 44“); mit `bars` je Antwort ein
 * Balken mit Zahl - der Gewinner ist hervorgehoben, bei Gleichstand keiner.
 */
export function BallotResult({ result, testId, bars = false, title = "Ergebnis", className = "" }) {
  if (!result) return null;
  const counts = Array.isArray(result.counts) ? result.counts : [];
  if (!bars) {
    return (
      <div className={`mt-4 border-t border-white/10 pt-3 tls-type-small ${className}`.trim()} data-testid={testId}>
        <div className="font-bold text-white">Ergebnis: {result.outcome_label}{result.winner_label ? ` – ${result.winner_label}` : ""}</div>
        <div className="mt-1 text-white/70">
          {counts.map((row) => `${row.label} ${row.count}`).join(" · ")} · gültig {result.valid}
        </div>
      </div>
    );
  }
  const valid = Number(result.valid) || 0;
  return (
    <div className={`space-y-2 ${className}`.trim()} data-testid={testId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="tls-type-label text-white/55">{title}</span>
        <span className="tls-type-small text-white/60" data-testid={testId ? `${testId}-valid` : undefined}>
          <span className="tls-type-num">{valid}</span> {valid === 1 ? "Stimme" : "Stimmen"}
        </span>
      </div>
      <ul className="space-y-2">
        {counts.map((row) => {
          const winner = Boolean(result.winner) && row.code === result.winner;
          const share = sharePercent(row.count, valid);
          return (
            <li key={row.code} className="min-w-0" data-testid={testId ? `${testId}-${row.code}` : undefined} data-winner={winner ? "1" : undefined}>
              <div className="flex items-baseline justify-between gap-3 tls-type-small">
                <span className={`min-w-0 break-words ${winner ? "font-bold text-white" : "text-white/80"}`}>{row.label}</span>
                <span className="shrink-0 text-white/70"><span className="tls-type-num">{row.count}</span> · {share} %</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
                <div className={`h-full rounded-full ${winner ? "bg-brand" : "bg-white/35"}`} style={{ width: `${share}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

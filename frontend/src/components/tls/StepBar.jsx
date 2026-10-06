// Schritt-Anzeige (#1081): bei mehrstufigen Abläufen sieht man, wo man steht. Eine schmale Leiste je Schritt, die
// erledigten und der aktuelle sind gefüllt, der Balken füllt sich beim Weitergehen (index.css, .tls-steps).
// Vorleseprogramme hören „Schritt 2 von 4: Antrag“.
export function StepBar({ steps, current = 0, className = "", testId = "step-bar" }) {
  const list = Array.isArray(steps) ? steps.filter(Boolean) : [];
  if (!list.length) return null;
  const active = Math.max(0, Math.min(current, list.length - 1));
  return (
    <ol
      className={`tls-steps ${className}`}
      data-testid={testId}
      aria-label={`Schritt ${active + 1} von ${list.length}: ${list[active].label}`}
      style={{ "--tls-steps": list.length }}
    >
      {list.map((step, index) => {
        const state = index < active ? "done" : index === active ? "current" : "open";
        return (
          <li key={step.key || step.label} className="tls-steps__item" data-state={state} aria-current={state === "current" ? "step" : undefined}>
            <span className="tls-steps__bar" aria-hidden="true" />
            <span className="tls-steps__label">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Die vier Schritte zum Vereinsmitglied - Konto, Antrag, Prüfung durch den Vorstand, Mitglied. */
export const MEMBERSHIP_STEPS = [
  { key: "account", label: "Konto" },
  { key: "application", label: "Antrag" },
  { key: "review", label: "Prüfung" },
  { key: "member", label: "Mitglied" },
];

/** Wo im Weg zum Mitglied ein Antrag steht: Antrag (1), Prüfung durch den Vorstand (2), Mitglied (3). */
export function membershipStep(status, renew = false) {
  if (status === "approved") return 3;
  if (!renew && (status === "pending" || status === "submitting")) return 2;
  return 1;
}

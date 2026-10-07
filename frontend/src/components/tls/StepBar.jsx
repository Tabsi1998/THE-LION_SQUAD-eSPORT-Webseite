import { useLayoutEffect, useRef, useState } from "react";

// Schritt-Anzeige (#1081): bei mehrstufigen Abläufen sieht man, wo man steht. Eine schmale Leiste je Schritt, die
// erledigten und der aktuelle sind gefüllt, der Balken füllt sich beim Weitergehen (index.css, .tls-steps).
// Vorleseprogramme hören „Schritt 2 von 4: Antrag“.
//
// Nichts wird abgeschnitten: Passt ein Schrittname nicht in seine Spalte (schmales Handy, viele Schritte), steht nur
// der aktuelle Schritt mit Zähler unter der Leiste („2/5 · Freigabe“). Gemessen wird die Breite des Textes, nicht die
// der Box - so bleibt das Ergebnis in beiden Darstellungen gleich und springt nicht hin und her.

function labelsFit(list) {
  if (typeof document === "undefined" || typeof document.createRange !== "function") return true;
  for (const item of list.querySelectorAll(".tls-steps__item")) {
    const name = item.querySelector(".tls-steps__name");
    if (!name || !item.clientWidth) continue;
    const range = document.createRange();
    range.selectNodeContents(name);
    if (range.getBoundingClientRect().width > item.clientWidth + 0.5) return false;
  }
  return true;
}

export function StepBar({ steps, current = 0, className = "", testId = "step-bar" }) {
  const list = Array.isArray(steps) ? steps.filter(Boolean) : [];
  const listRef = useRef(null);
  const [compact, setCompact] = useState(false);
  const names = list.map((step) => step.label).join("|");

  useLayoutEffect(() => {
    const node = listRef.current;
    if (!node) return undefined;
    let alive = true;
    const check = () => { if (alive) setCompact(!labelsFit(node)); };
    check();
    // Schriften laden später nach und verbreitern den Text; die Breite ändert sich mit dem Fenster.
    document.fonts?.ready?.then(check, () => {});
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(check) : null;
    observer?.observe(node);
    return () => {
      alive = false;
      observer?.disconnect();
    };
  }, [names]);

  if (!list.length) return null;
  const active = Math.max(0, Math.min(current, list.length - 1));
  return (
    <ol
      ref={listRef}
      className={`tls-steps ${className}`}
      data-testid={testId}
      data-compact={compact ? "" : undefined}
      aria-label={`Schritt ${active + 1} von ${list.length}: ${list[active].label}`}
      style={{ "--tls-steps": list.length }}
    >
      {list.map((step, index) => {
        const state = index < active ? "done" : index === active ? "current" : "open";
        return (
          <li key={step.key || step.label} className="tls-steps__item" data-state={state} aria-current={state === "current" ? "step" : undefined}>
            <span className="tls-steps__bar" aria-hidden="true" />
            <span className="tls-steps__label">
              <span className="tls-steps__count" aria-hidden="true">{index + 1}/{list.length} · </span>
              <span className="tls-steps__name">{step.label}</span>
            </span>
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

// Kosten zählen, wenn die Anmeldung einen Betrag trägt (nicht storniert) oder - vor der Anmeldung - das Angebot welche
// nennt.
function hasCosts(offer, registration) {
  const price = registration?.price;
  if (price) return Number(price.total_cents) > 0 && price.billing_status !== "cancelled";
  return Boolean(offer?.positions?.length);
}

const indexOf = (steps, key) => steps.findIndex((step) => step.key === key);

/**
 * Turnier-Anmeldung (#1081): Anmeldung, Freigabe (oder Warteliste), Startgeld (nur mit Kosten), Check-in (nur mit
 * Check-in-Zeit), Turnier.
 */
export function tournamentSteps(tournament, registration = null) {
  const t = tournament || {};
  const steps = [
    { key: "registration", label: "Anmeldung" },
    { key: "approval", label: registration?.status === "waitlist" ? "Warteliste" : "Freigabe" },
  ];
  if (hasCosts(t.offer, registration)) steps.push({ key: "payment", label: "Startgeld" });
  if (t.check_in_from || t.check_in_until || t.status === "check_in") steps.push({ key: "checkin", label: "Check-in" });
  steps.push({ key: "play", label: "Turnier" });
  return steps;
}

/** Wo eine Turnier-Anmeldung steht; -1 = keine Leiste (abgelehnt, nicht erschienen). */
export function tournamentStep(steps, registration = null) {
  const status = registration?.status;
  if (!status) return 0;
  if (status === "pending" || status === "waitlist") return indexOf(steps, "approval");
  if (status === "checked_in") return indexOf(steps, "play");
  if (status === "approved" || status === "confirmed") {
    if (indexOf(steps, "payment") >= 0 && registration.price?.billing_status !== "paid") return indexOf(steps, "payment");
    if (indexOf(steps, "checkin") >= 0) return indexOf(steps, "checkin");
    return indexOf(steps, "play");
  }
  return -1;
}

/**
 * Event-Anmeldung (#1081): Anmeldung (oder Warteliste), Bezahlen, Dabei. Ohne Kosten ist es ein einziger Schritt -
 * dann gibt es keine Leiste (leere Liste).
 */
export function eventSteps(event, registration = null) {
  if (!hasCosts(event?.offer, registration)) return [];
  return [
    { key: "registration", label: registration?.status === "waitlist" ? "Warteliste" : "Anmeldung" },
    { key: "payment", label: "Bezahlen" },
    { key: "attend", label: "Dabei" },
  ];
}

/** Wo eine Event-Anmeldung steht; -1 = keine Leiste (storniert, nicht erschienen). */
export function eventStep(steps, registration = null) {
  const status = registration?.status;
  if (!status || status === "waitlist") return 0;
  if (status === "checked_in") return indexOf(steps, "attend");
  if (status === "registered") return registration.price?.billing_status === "paid" ? indexOf(steps, "attend") : indexOf(steps, "payment");
  return -1;
}

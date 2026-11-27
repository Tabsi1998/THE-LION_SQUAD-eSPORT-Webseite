import "./guestBadge.css";

// Gast-Plakette (#1665, Entscheidung Nr. 286): ein Team, das als Gast in der Liga spielt - „Gast · Verein/Schule“. Der Server setzt
// `guest_badge` ({label, org}) nur, wenn die Liga-Leitung das Kennzeichen am Hauptteam bestätigt hat; nie aus der Mitgliedschaft. Den
// Namen einer Schule schickt er nur mit Freigabe der Teamleitung. Ruhig gehalten wie „Vereinsintern“: eine Angabe, kein Signal, keine
// Bewegung. Lange Namen brechen um, nichts wird abgeschnitten. TV und Discord bekommen nur „Gast“ (`org` fehlt dort).
export const GUEST_HINT = "Gastteam: spielt als Gast in der Liga, kein Team des Vereins.";

export function guestText(badge) {
  if (!badge) return "";
  return badge.org ? `${badge.label || "Gast"} · ${badge.org}` : badge.label || "Gast";
}

export function GuestBadge({ badge, testId, className = "" }) {
  if (!badge) return null;
  const org = badge.org || "";
  return (
    <span className={`tls-guest-badge ${className}`} title={org ? `${GUEST_HINT} ${org}` : GUEST_HINT} data-testid={testId}>
      <span className="tls-guest-badge__label" aria-hidden="true">{badge.label || "Gast"}</span>
      {/* Vorgelesen wird „Gastteam“ statt des Etiketts - und der Name ohne den Punkt dazwischen. */}
      <span className="sr-only">Gastteam{org ? `: ${org}` : ""}</span>
      {org ? <span className="tls-guest-badge__org" aria-hidden="true">{org}</span> : null}
    </span>
  );
}

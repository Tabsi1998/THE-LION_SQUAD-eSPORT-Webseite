// Season absagen (#2607): die Folgen im Klartext für das Bestätigungsblatt - aus der Vorschau des Servers (`…/cancel-plan`).

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

const STATUS_WORDS = [["submitted", "eingereicht"], ["in_review", "in Prüfung"], ["waitlist", "auf der Warteliste"], ["accepted", "angenommen"]];

/** Die Folgen als Zeilen `{key, text}` - in der Reihenfolge, in der das Absagen sie bewirkt. */
export function cancelConsequences(plan) {
  if (!plan) return [];
  const solo = plan.kind === "solo";
  const lines = [{ key: "window", text: "Die Anmeldung schließt sofort." }];
  if (plan.applications) {
    const parts = STATUS_WORDS.filter(([status]) => plan.applications_by_status?.[status])
      .map(([status, word]) => `${plan.applications_by_status[status]} ${word}`);
    lines.push({ key: "applications", text: `${plural(plan.applications, "offene Anmeldung wird", "offene Anmeldungen werden")} mit deinem Grund abgelehnt${parts.length ? ` (${parts.join(", ")})` : ""}.` });
  } else {
    lines.push({ key: "applications", text: "Es gibt keine offenen Anmeldungen." });
  }
  lines.push({ key: "staffeln", text: plan.staffeln ? `${plural(plan.staffeln, "Staffel steht", "Staffeln stehen")} danach auf „Abgesagt“.` : "Es gibt keine Staffel, die noch abzusagen wäre." });
  if (plan.people) {
    const who = solo ? plural(plan.teams, "Spieler", "Spieler") : `Captain und Vertreter von ${plural(plan.teams, "Co-Team", "Co-Teams")}`;
    lines.push({ key: "people", text: `${plural(plan.people, "Person bekommt", "Personen bekommen")} genau eine Nachricht mit Mail – ${who}.` });
  } else {
    lines.push({ key: "people", text: "Niemand bekommt eine Nachricht – es ist noch niemand angemeldet." });
  }
  if (plan.carried) {
    const from = plan.predecessor?.name ? ` aus ${plan.predecessor.name}` : "";
    lines.push({ key: "carried", text: `${plural(plan.carried, "Co-Team ist", "Co-Teams sind")}${from} übernommen: Ihre Startrechte gelten für die nächste Season weiter.` });
  }
  lines.push({ key: "visible", text: "Die Season bleibt mit Grund und Datum auf der Ligaseite sichtbar." });
  return lines;
}

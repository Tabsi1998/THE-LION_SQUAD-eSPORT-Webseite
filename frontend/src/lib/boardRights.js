// Vorstand (#1355): wer einen Posten besetzt, sieht vorher, welche Rechte er bringt. Ein aktiver Posten (auch als
// Vertretung) bringt die Vereinsverwaltung - außer Dolibarr führt die Rechte über Funktionen (docs/ROLLEN.md).

export const CLUB_ACCESS = "Mitgliederdaten, Anträge, Dokumente, Benutzer";

/** „Kassier:in“, „Obmann / Obfrau“ - die Bezeichnung eines Postens in einer Zeile. */
export function postTitle(position) {
  const male = String(position?.title_male || "").trim();
  const female = String(position?.title_female || "").trim();
  if (!female || female === male) return male || "Posten";
  if (female === `${male}in`) return `${male}:in`;
  return `${male} / ${female}`;
}

/**
 * Der Satz vor dem Besetzen.
 * @param person    gewählte Person aus der Personensuche ({ name, has_account })
 * @param position  der Posten
 * @param deputy    besetzt die Vertretung statt des Postens
 * @param rightsFromDolibarr  Dolibarr führt die Rechte über Funktionen - der Posten ist nur für die Anzeige
 */
export function boardSentence({ person, position, deputy = false, rightsFromDolibarr = false }) {
  const name = person?.name || "Die Person";
  const role = deputy ? `Vertretung für ${postTitle(position)}` : postTitle(position);
  if (rightsFromDolibarr) return `${name} wird ${role}. Der Posten ist nur für die Anzeige – die Rechte kommen aus Dolibarr.`;
  if (person && person.has_account === false) return `${name} wird ${role}. Ohne Konto auf der Website bringt der Posten keine Rechte.`;
  if (position && position.is_active === false) return `${name} wird ${role}. Der Posten ist gerade inaktiv – Rechte bringt er erst, wenn er aktiv ist.`;
  return `${name} wird ${role} und bekommt damit die Vereinsverwaltung: ${CLUB_ACCESS}. Zwei-Faktor ist dafür Pflicht.`;
}

function holderNames(position) {
  return [position?.user, position?.deputy_user].map((person) => person?.display_name || person?.name).filter(Boolean);
}

/** Der Satz vor dem Aktivieren oder Deaktivieren (#2125): der Schalter entscheidet über die Vereinsverwaltung der Inhaber. */
export function statusSentence({ position, rightsFromDolibarr = false }) {
  const title = postTitle(position);
  const names = holderNames(position);
  const active = position?.is_active !== false;
  if (rightsFromDolibarr) return `„${title}“ wird ${active ? "inaktiv" : "aktiv"}. An den Rechten ändert das nichts – sie kommen aus Dolibarr.`;
  if (!names.length) return `„${title}“ wird ${active ? "inaktiv" : "aktiv"}. Der Posten ist offen, an den Rechten ändert sich nichts.`;
  const who = names.join(" und ");
  const many = names.length > 1;
  return active
    ? `„${title}“ wird inaktiv: ${who} ${many ? "verlieren" : "verliert"} damit die Vereinsverwaltung, wenn kein anderer Posten oder keine Freigabe sie gibt.`
    : `„${title}“ wird aktiv: ${who} ${many ? "bekommen" : "bekommt"} damit die Vereinsverwaltung: ${CLUB_ACCESS}. Zwei-Faktor ist dafür Pflicht.`;
}

/** Der Satz vor dem Löschen eines Postens (#2125). */
export function deleteSentence({ position, rightsFromDolibarr = false }) {
  const names = holderNames(position);
  const start = `„${postTitle(position)}“ wird gelöscht.`;
  if (!names.length) return start;
  const who = names.join(" und ");
  const many = names.length > 1;
  if (rightsFromDolibarr) return `${start} ${who} ${many ? "sind" : "ist"} den Posten damit los; an den Rechten ändert das nichts – sie kommen aus Dolibarr.`;
  return `${start} ${who} ${many ? "sind" : "ist"} den Posten damit los und ${many ? "verlieren" : "verliert"} die Vereinsverwaltung, wenn kein anderer Posten oder keine Freigabe sie gibt.`;
}

/** Der Satz vor dem Leeren eines Postens. */
export function clearSentence({ holderName, position, deputy = false, rightsFromDolibarr = false }) {
  const role = deputy ? `die Vertretung für ${postTitle(position)}` : postTitle(position);
  if (rightsFromDolibarr) return `${holderName || "Die Person"} ist danach nicht mehr ${role}. An den Rechten ändert das nichts – sie kommen aus Dolibarr.`;
  return `${holderName || "Die Person"} ist danach nicht mehr ${role} und verliert die Vereinsverwaltung, wenn kein anderer Posten oder keine Freigabe sie gibt.`;
}

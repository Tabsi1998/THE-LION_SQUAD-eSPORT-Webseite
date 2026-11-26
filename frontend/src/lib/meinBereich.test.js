import { GRUPPEN, gruppeZuPfad, gruppenFuer, legacyTarget, reiterPfad, schnellwege, zweiFaktorPfad } from "./meinBereich";

// „Mein Bereich“ (#2059): acht Gruppen wie im Issue, alte Adressen leiten mit Suche und Anker weiter, „Zu tun“ aus
// vorhandenen Daten.

test("die acht Gruppen stehen in der Reihenfolge des Issues, Verein nur für Mitglieder", () => {
  expect(GRUPPEN.map((item) => item.label)).toEqual([
    "Übersicht", "Profil", "Mitgliedschaft", "Rechnungen & Unterlagen", "Verein", "Benachrichtigungen", "Konto & Sicherheit", "Datenschutz",
  ]);
  expect(gruppenFuer({ mitglied: false }).map((item) => item.key)).not.toContain("verein");
  expect(gruppenFuer({ mitglied: true }).map((item) => item.key)).toContain("verein");
  for (const item of GRUPPEN) expect(item.path.startsWith("/mein-bereich")).toBe(true);
});

test("die Gruppe zu einer Adresse - auch für Unterseiten, nie außerhalb", () => {
  expect(gruppeZuPfad("/mein-bereich")).toBe("start");
  expect(gruppeZuPfad("/mein-bereich/")).toBe("start");
  expect(gruppeZuPfad("/mein-bereich/verein/versammlungen")).toBe("verein");
  expect(gruppeZuPfad("/mein-bereich/konto")).toBe("konto");
  expect(gruppeZuPfad("/mein-bereich/gibtsnicht")).toBeNull();
  expect(gruppeZuPfad("/mein-bereich/start")).toBeNull();
  expect(gruppeZuPfad("/profile")).toBeNull();
});

test("Reiter-Adressen: der erste Reiter ist die Gruppe selbst", () => {
  expect(reiterPfad("rechnungen")).toBe("/mein-bereich/rechnungen");
  expect(reiterPfad("rechnungen", "gewinne")).toBe("/mein-bereich/rechnungen?tab=gewinne");
  expect(reiterPfad("profil", "socials", "link=discord")).toBe("/mein-bereich/profil?link=discord&tab=socials");
});

const CASES = [
  // /profile und seine Reiter
  ["/profile", "", "", "/mein-bereich/profil"],
  ["/profile", "?tab=basic", "", "/mein-bereich/profil"],
  ["/profile", "?tab=gaming", "", "/mein-bereich/profil?tab=gaming"],
  ["/profile", "?tab=socials&link=discord", "", "/mein-bereich/profil?tab=socials&link=discord"],
  ["/profile", "?tab=socials&linked=steam", "", "/mein-bereich/profil?tab=socials&linked=steam"],
  ["/profile", "?tab=edit", "", "/mein-bereich/profil"],
  ["/profile", "?tab=notifications", "#dieser-browser", "/mein-bereich/benachrichtigungen#dieser-browser"],
  ["/profile", "?tab=notifications&bereich=mail", "", "/mein-bereich/benachrichtigungen?bereich=mail"],
  ["/profile", "?tab=security&mfa=required&next=%2Fadmin", "", "/mein-bereich/konto?mfa=required&next=%2Fadmin"],
  ["/profile", "?tab=sessions", "", "/mein-bereich/konto"],
  ["/profile", "?tab=appearance", "", "/mein-bereich/konto?tab=appearance"],
  ["/profile", "?tab=calendar", "", "/mein-bereich/konto?tab=calendar"],
  ["/profile", "?tab=about", "", "/mein-bereich/konto?tab=about"],
  ["/profile", "?tab=privacy", "", "/mein-bereich/datenschutz"],
  ["/profile", "?tab=invoices&invoice=d-501", "", "/mein-bereich/rechnungen?invoice=d-501"],
  ["/profile", "?tab=invoices&invoice=../x", "", "/mein-bereich/rechnungen"],
  ["/profile", "?tab=prizes", "", "/mein-bereich/rechnungen?tab=gewinne"],
  ["/profile", "?tab=unbekannt", "", "/mein-bereich/profil"],
  // was keine Einstellung ist, bleibt, wo es ist
  ["/profile", "?tab=teams", "", "/teams"],
  ["/profile", "?tab=friends", "", "/players"],
  ["/profile", "?tab=achievements", "", "/u/me?tab=achievements"],
  ["/profile", "?tab=honours", "", "/u/me?tab=honours"],
  ["/profile", "?tab=inbox&to=u-9", "", "/messages/u-9"],
  ["/profile", "?tab=inbox", "", "/messages"],
  // Mitgliederbereich
  ["/members/area", "", "#versammlung", "/mein-bereich/verein#versammlung"],
  ["/mitgliederbereich", "", "", "/mein-bereich/verein"],
  ["/member-area", "", "", "/mein-bereich/verein"],
  ["/members/membership", "", "#mitgliedskarte", "/mein-bereich/mitgliedschaft#mitgliedskarte"],
  ["/members/meetings", "?meeting=12", "", "/mein-bereich/verein/versammlungen?meeting=12"],
  ["/members/helfen", "?event=5", "", "/mein-bereich/verein/helfen?event=5"],
  ["/members/documents", "", "", "/mein-bereich/verein/dokumente"],
  ["/members/news", "", "", "/mein-bereich/verein/news"],
  ["/members/benefits", "", "", "/mein-bereich/verein/vorteile"],
  // Konto
  ["/account/invoices", "?invoice=d-7", "", "/mein-bereich/rechnungen?invoice=d-7"],
  ["/account/invoices", "", "", "/mein-bereich/rechnungen"],
  ["/account/documents", "", "", "/mein-bereich/rechnungen?tab=unterlagen"],
  ["/my/prizes", "", "", "/mein-bereich/rechnungen?tab=gewinne"],
  ["/me/prizes", "", "", "/mein-bereich/rechnungen?tab=gewinne"],
  ["/my/penalties", "", "", "/mein-bereich/rechnungen?tab=strafen"],
  ["/privacy-account", "", "", "/mein-bereich/datenschutz?tab=daten"],
];

test.each(CASES)("%s%s%s → %s", (pathname, search, hash, expected) => {
  expect(legacyTarget({ pathname, search, hash })).toBe(expected);
});

test("öffentliche Adressen gehören nicht dazu: /u/me, /members/<slug>, /consent", () => {
  expect(legacyTarget({ pathname: "/u/me" })).toBeNull();
  expect(legacyTarget({ pathname: "/members/luna-byte" })).toBeNull();
  expect(legacyTarget({ pathname: "/members" })).toBeNull();
  expect(legacyTarget({ pathname: "/consent" })).toBeNull();
});

test("Zwei-Faktor-Weg führt zu Konto & Sicherheit, mit dem Ziel danach", () => {
  expect(zweiFaktorPfad("/admin")).toBe("/mein-bereich/konto?mfa=required&next=%2Fadmin");
  expect(zweiFaktorPfad()).toBe("/mein-bereich/konto?mfa=required");
});

test("Schnellwege: Wunschnummer und Anschrift nur für Mitglieder, Rechnungen, Passwort und Konto löschen für alle", () => {
  expect(schnellwege({ mitglied: false }).map((item) => item.key)).toEqual(["rechnungen", "passwort", "loeschung"]);
  expect(schnellwege({ mitglied: true }).map((item) => item.label)).toEqual(["Wunschnummer", "Anschrift ändern", "Rechnungen", "Passwort ändern", "Konto löschen"]);
});

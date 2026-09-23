// Adminmenü (#408): wer „den Verein pflegen“ will, findet alles in einer Gruppe; Finanzen sind
// eine eigene Gruppe; Rechte je Eintrag bleiben wie vorher.

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null, logout: () => {} }) }));

const { ADMIN_GROUPS } = await import("./AdminLayout");

function group(label) {
  return ADMIN_GROUPS.find((entry) => entry.label === label);
}

test("Gruppen in der Reihenfolge Übersicht, Verein, Mitglieder, Finanzen, eSports, Content, System", () => {
  expect(ADMIN_GROUPS.map((entry) => entry.label)).toEqual(["Übersicht", "Verein", "Mitglieder", "Finanzen", "eSports", "Content", "System"]);
});

test("Verein bündelt Vereinsdaten, Vorstand, Sponsoren, Partner, Referenzen und Kontakt-Inbox", () => {
  expect(group("Verein").items.map((item) => item.label)).toEqual(["Vereinsdaten", "Vorstand", "Sponsoren", "Partner", "Referenzen", "Kontakt-Inbox"]);
  expect(group("Verein").items[0].to).toBe("/admin/settings?tab=legal");
  expect(group("Verein").items[0].areas).toEqual(["system"]);
});

test("Finanzen sind eine eigene Gruppe; Downloads & QR liegen bei Content; Rechte bleiben je Eintrag", () => {
  expect(group("Finanzen").items.map((item) => [item.label, item.to])).toEqual([["Finanzübersicht", "/admin/finance"], ["Dolibarr-Anbindung", "/admin/dolibarr"]]);
  expect(group("Finanzen").items[0].areas).toEqual(["finance"]);
  expect(group("Content").items.some((item) => item.to === "/admin/downloads")).toBe(true);
  expect(group("System").items.some((item) => item.to === "/admin/downloads")).toBe(false);
  expect(group("Mitglieder").items.map((item) => item.label)).toEqual(["Mitglieder", "Mitgliederprofile", "Bewerbungen", "Mitgliedervorteile", "Dokumente", "Alle Benutzer"]);
  // Jeder Weg genau einmal.
  const routes = ADMIN_GROUPS.flatMap((entry) => entry.items.map((item) => item.to));
  expect(new Set(routes).size).toBe(routes.length);
});

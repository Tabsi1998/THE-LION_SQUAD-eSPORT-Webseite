// Adminmenü (#408): wer „den Verein pflegen“ will, findet alles in einer Gruppe; Finanzen sind
// eine eigene Gruppe; Rechte je Eintrag bleiben wie vorher.

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null, logout: () => {} }) }));

const { ADMIN_GROUPS, navGroupsFor } = await import("./AdminLayout");

function group(label) {
  return ADMIN_GROUPS.find((entry) => entry.label === label);
}

test("Gruppen in der Reihenfolge Übersicht, Verein, Mitglieder, Finanzen, eSports, Content, Verbindungen, System", () => {
  expect(ADMIN_GROUPS.map((entry) => entry.label)).toEqual(["Übersicht", "Verein", "Mitglieder", "Finanzen", "eSports", "Content", "Verbindungen", "System"]);
  // Je Dienst ein Eintrag (Wunsch des Betreibers) - TikTok, Discord, Twitch und die anderen.
  const labels = group("Verbindungen").items.map((item) => item.label);
  expect(labels).toEqual(expect.arrayContaining(["Discord", "Twitch", "TikTok", "Steam", "Google-Login", "E-Mail-Versand", "Dolibarr"]));
  // Dienste mit eigener Seite führen dorthin; E-Mail, Google-Login, Analytics, Google Play und Dolibarr direkt auf ihren Reiter (#508).
  expect(group("Verbindungen").items.every((item) => item.areas.includes("system"))).toBe(true);
  expect(group("Verbindungen").items.filter((item) => !item.to.startsWith("/admin/integrations/")).map((item) => [item.label, item.to])).toEqual([
    ["Google-Login", "/admin/settings?tab=auth"], ["E-Mail-Versand", "/admin/settings?tab=email"], ["Analytics & Suchmaschinen", "/admin/settings?tab=seo"],
    ["Google Play", "/admin/settings?tab=brand"], ["Dolibarr", "/admin/dolibarr?tab=connection"],
  ]);
});

test("Verein bündelt Vereinsdaten, Über uns, Vorstand, Sponsoren, Partner, Referenzen und Kontakt-Inbox", () => {
  expect(group("Verein").items.map((item) => item.label)).toEqual(["Vereinsdaten", "Über uns", "Vorstand", "Sponsoren", "Partner", "Referenzen", "Kontakt-Inbox"]);
  expect(group("Verein").items[0].to).toBe("/admin/club");
  expect(group("Verein").items[0].areas).toEqual(["system"]);
});

test("Finanzen sind eine eigene Gruppe; Downloads & QR liegen bei Content; Rechte bleiben je Eintrag", () => {
  expect(group("Finanzen").items.filter((item) => !item.searchOnly).map((item) => [item.label, item.to])).toEqual([["Finanzübersicht", "/admin/finance"], ["Dolibarr-Anbindung", "/admin/dolibarr"]]);
  expect(group("Finanzen").items[0].areas).toEqual(["finance"]);
  expect(group("Content").items.some((item) => item.to === "/admin/downloads")).toBe(true);
  expect(group("System").items.some((item) => item.to === "/admin/downloads")).toBe(false);
  expect(group("Mitglieder").items.map((item) => item.label)).toEqual(["Mitglieder", "Mitgliederprofile", "Bewerbungen", "Mitgliedervorteile", "Dokumente", "Alle Benutzer"]);
  // Jeder Weg genau einmal.
  const routes = ADMIN_GROUPS.flatMap((entry) => entry.items.map((item) => item.to));
  expect(new Set(routes).size).toBe(routes.length);
});

// Wegweiser: Reiter der Einstellungen und der Dolibarr-Seite sind nur über die Suche sichtbar -
// „Steam“ führt zu „Login & Konten“, „Wortfilter“ zur Moderation, ohne dass das Menü länger wird.
const SYSTEM_USER = { role: "superadmin" };

test("ohne Suche bleiben die Wegweiser-Einträge unsichtbar", () => {
  const items = navGroupsFor(SYSTEM_USER, "").flatMap((entry) => entry.items);
  expect(items.some((item) => item.searchOnly)).toBe(false);
  expect(items.map((item) => item.to)).toContain("/admin/settings");
});

test("die Suche findet Reiter: Steam → Login & Konten, Analytics → SEO, Steuersätze → Dolibarr-Verbindung, Wortfilter → Moderation", () => {
  const find = (query) => navGroupsFor(SYSTEM_USER, query).flatMap((entry) => entry.items).map((item) => item.to);
  expect(find("steam")).toContain("/admin/settings?tab=auth");
  expect(find("google analytics")).toContain("/admin/settings?tab=seo");
  expect(find("Steuersätze")).toContain("/admin/dolibarr?tab=connection");
  expect(find("wortfilter")).toContain("/admin/moderation");
  expect(find("vereinsdaten aus dolibarr")).toContain("/admin/club");
});

test("Wegweiser respektieren die Bereiche: die Turnierleitung sieht keine Einstellungen", () => {
  const items = navGroupsFor({ role: "tournament_admin" }, "steam").flatMap((entry) => entry.items);
  expect(items.some((item) => item.to.startsWith("/admin/settings"))).toBe(false);
});


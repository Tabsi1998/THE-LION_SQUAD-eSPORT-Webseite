// Adminmenü (#408): wer „den Verein pflegen“ will, findet alles in einer Gruppe; Finanzen sind
// eine eigene Gruppe; Rechte je Eintrag bleiben wie vorher.

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null, logout: () => {} }) }));

const { ADMIN_GROUPS, navGroupsFor } = await import("./AdminLayout");

function group(label) {
  return ADMIN_GROUPS.find((entry) => entry.label === label);
}

test("Gruppen in der Reihenfolge Übersicht, Verein, Mitglieder, Finanzen, eSports, Content, Verbindungen, E-Mail, Auftritt, System (#546)", () => {
  expect(ADMIN_GROUPS.map((entry) => entry.label)).toEqual(["Übersicht", "Verein", "Mitglieder", "Finanzen", "eSports", "Content", "Verbindungen", "E-Mail", "Auftritt", "System"]);
  // Ganz oben die Übersicht, dann je Dienst ein Eintrag - Google, Resend, SMTP und die Plattformen.
  const labels = group("Verbindungen").items.map((item) => item.label);
  expect(labels[0]).toBe("Alle Verbindungen");
  expect(labels).toEqual(expect.arrayContaining(["Google", "Resend", "SMTP", "Discord", "Twitch", "TikTok", "Steam"]));
  expect(labels).not.toContain("Dolibarr");
  expect(group("Verbindungen").items.every((item) => item.areas.includes("system"))).toBe(true);
  expect(group("Verbindungen").items.filter((item) => !item.to.startsWith("/admin/integrations/")).map((item) => [item.label, item.to])).toEqual([
    ["Alle Verbindungen", "/admin/integrations"], ["Google", "/admin/settings/google"], ["Resend", "/admin/settings/resend"], ["SMTP", "/admin/settings/smtp"],
  ]);
  // Keine zweite Reiterleiste mehr: E-Mail, Auftritt und System tragen die früheren Reiter als Einträge.
  expect(group("E-Mail").items.map((item) => item.to)).toEqual(["/admin/settings/newsletter", "/admin/settings/mail-queue", "/admin/settings/mail-logs", "/admin/email-templates"]);
  expect(group("Auftritt").items.map((item) => item.to)).toEqual(["/admin/settings/branding", "/admin/settings/socials", "/admin/settings/seo"]);
  expect(group("System").items.map((item) => item.to)).toEqual(expect.arrayContaining(["/admin/settings/status", "/admin/settings/zugang"]));
  expect(ADMIN_GROUPS.flatMap((entry) => entry.items).some((item) => item.to === "/admin/settings" || item.to.includes("/admin/settings?tab="))).toBe(false);
});

test("Verein bündelt Vereinsdaten, Über uns, Vorstand, Sponsoren, Partner, Referenzen und Kontakt-Inbox", () => {
  expect(group("Verein").items.map((item) => item.label)).toEqual(["Vereinsdaten", "Über uns", "Vorstand", "Sponsoren", "Partner", "Referenzen", "Kontakt-Inbox"]);
  expect(group("Verein").items[0].to).toBe("/admin/club");
  expect(group("Verein").items[0].areas).toEqual(["system"]);
});

test("Finanzen sind eine eigene Gruppe; Dolibarr liegt bei den Mitgliedern (#512); Downloads & QR bei Content; Rechte bleiben je Eintrag", () => {
  expect(group("Finanzen").items.filter((item) => !item.searchOnly).map((item) => [item.label, item.to])).toEqual([["Finanzübersicht", "/admin/finance"]]);
  expect(group("Finanzen").items[0].areas).toEqual(["finance"]);
  expect(group("Content").items.some((item) => item.to === "/admin/downloads")).toBe(true);
  expect(group("System").items.some((item) => item.to === "/admin/downloads")).toBe(false);
  expect(group("Mitglieder").items.filter((item) => !item.searchOnly).map((item) => item.label)).toEqual(["Mitglieder", "Mitgliederprofile", "Bewerbungen", "Mitgliedervorteile", "Dokumente", "Alle Benutzer", "Dolibarr"]);
  expect(group("Mitglieder").items.find((item) => item.to === "/admin/dolibarr").areas).toEqual(["club", "system"]);
  // Menüname = Seitentitel (#512): Jahreswertung, Gewinne, Fast Lap, App-Logs, Push-Tests.
  expect(group("eSports").items.map((item) => item.label)).toEqual(expect.arrayContaining(["Fast Lap", "Jahreswertung", "Gewinne"]));
  expect(group("System").items.filter((item) => !item.searchOnly).map((item) => item.label)).toEqual(expect.arrayContaining(["App-Logs", "Push-Tests"]));
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
  expect(items.map((item) => item.to)).toContain("/admin/settings/status");
});

test("die Suche findet Seiten: Steam → Steam, Analytics → SEO, Registrierung → Zugang, nicht lesbar → Alle Verbindungen, Steuersätze → Dolibarr-Verbindung, Wortfilter → Moderation", () => {
  const find = (query) => navGroupsFor(SYSTEM_USER, query).flatMap((entry) => entry.items).map((item) => item.to);
  expect(find("steam")).toContain("/admin/integrations/steam");
  expect(find("google analytics")).toContain("/admin/settings/seo");
  expect(find("registrierung")).toContain("/admin/settings/zugang");
  expect(find("nicht lesbar")).toContain("/admin/integrations");
  expect(find("resend")).toContain("/admin/settings/resend");
  expect(find("Steuersätze")).toContain("/admin/dolibarr?tab=connection");
  expect(find("schalter")).toContain("/admin/dolibarr?tab=features");
  expect(find("saisons")).toContain("/admin/seasons");
  expect(find("wortfilter")).toContain("/admin/moderation");
  expect(find("vereinsdaten aus dolibarr")).toContain("/admin/club");
});

test("Wegweiser respektieren die Bereiche: die Turnierleitung sieht keine Einstellungen", () => {
  const items = navGroupsFor({ role: "tournament_admin" }, "steam").flatMap((entry) => entry.items);
  expect(items.some((item) => item.to.startsWith("/admin/settings"))).toBe(false);
});


// Adminmenü (#408): wer „den Verein pflegen“ will, findet alles in einer Gruppe; Finanzen sind
// eine eigene Gruppe; Rechte je Eintrag bleiben wie vorher.

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const authState = { user: null, logout: () => {} };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/hooks/usePublicSiteSettings", () => ({ usePublicSiteSettings: () => ({}) }));

const { ADMIN_GROUPS, AdminLayout, canOpenAdminLink, linkAreas, navGroupsFor } = await import("./AdminLayout");

// jsdom kennt kein scrollIntoView; das Menü führt damit zum aktiven Eintrag.
beforeAll(() => {
  window.Element.prototype.scrollIntoView = () => {};
});

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
  expect(group("E-Mail").items.map((item) => item.to)).toEqual(["/admin/settings/newsletter", "/admin/settings/mail-queue", "/admin/email-templates"]);
  expect(group("Auftritt").items.map((item) => item.to)).toEqual(["/admin/settings/branding", "/admin/settings/socials", "/admin/settings/seo", "/admin/settings/jahreszeiten"]);
  expect(group("System").items.map((item) => item.to)).toEqual(expect.arrayContaining(["/admin/settings/status", "/admin/settings/zugang"]));
  expect(ADMIN_GROUPS.flatMap((entry) => entry.items).some((item) => item.to === "/admin/settings" || item.to.includes("/admin/settings?tab="))).toBe(false);
});

test("Verein bündelt Vereinsdaten, Über uns, Vorstand, Sponsoren, Partner, Referenzen, Serien und Kontakt-Inbox", () => {
  expect(group("Verein").items.map((item) => item.label)).toEqual(["Vereinsdaten", "Über uns", "Vorstand", "Sponsoren", "Partner", "Referenzen", "Serien", "Kontakt-Inbox"]);
  expect(group("Verein").items[0].to).toBe("/admin/club");
  expect(group("Verein").items[0].areas).toEqual(["system"]);
});

test("Finanzen sind eine eigene Gruppe; Dolibarr liegt bei den Mitgliedern (#512); Downloads & QR bei Content; Rechte bleiben je Eintrag", () => {
  expect(group("Finanzen").items.filter((item) => !item.searchOnly).map((item) => [item.label, item.to])).toEqual([["Finanzübersicht", "/admin/finance"]]);
  expect(group("Finanzen").items[0].areas).toEqual(["finance"]);
  expect(group("Content").items.some((item) => item.to === "/admin/downloads")).toBe(true);
  expect(group("System").items.some((item) => item.to === "/admin/downloads")).toBe(false);
  expect(group("Mitglieder").items.filter((item) => !item.searchOnly).map((item) => item.label)).toEqual(["Mitglieder", "Mitgliederprofile", "Bewerbungen", "Mitgliedervorteile", "Dokumente", "Einlass (Versammlung)", "Alle Benutzer", "Dolibarr"]);
  expect(group("Mitglieder").items.find((item) => item.to === "/admin/dolibarr").areas).toEqual(["club", "system"]);
  // Menüname = Seitentitel (#512): Jahreswertung, Gewinne, Fast Lap, App-Logs, Push-Tests.
  expect(group("eSports").items.map((item) => item.label)).toEqual(expect.arrayContaining(["Fast Lap", "Jahreswertung", "Gewinne"]));
  // Betrieb & Logs (#517 Teil 2) trägt Logs, Audit Logs, App-Logs und Versandlogs als Reiter - keine eigenen Einträge mehr.
  expect(group("System").items.filter((item) => !item.searchOnly).map((item) => item.label)).toEqual(expect.arrayContaining(["Betrieb & Logs", "Push-Tests"]));
  expect(ADMIN_GROUPS.flatMap((entry) => entry.items).map((item) => item.to)).not.toEqual(expect.arrayContaining(["/admin/logs", "/admin/audit", "/admin/mobile-logs", "/admin/settings/mail-logs"]));
  // Jeder Weg genau einmal.
  const routes = ADMIN_GROUPS.flatMap((entry) => entry.items.map((item) => item.to));
  expect(new Set(routes).size).toBe(routes.length);
});

// Wegweiser: Reiter der Einstellungen und der Dolibarr-Seite sind nur über die Suche sichtbar -
// „Steam“ führt zu „Login & Konten“, „Wortfilter“ zur Moderation, ohne dass das Menü länger wird.
const SYSTEM_USER = { role: "superadmin", mfa_enabled: true, auth_mfa_verified: true };

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
  expect(find("audit logs")).toContain("/admin/ops");
  expect(find("app-logs")).toContain("/admin/ops");
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

// Abgehakte Plattformen (#558) fehlen im Menü Verbindungen; Alle Verbindungen bleibt.
test("abgehakte Plattformen fehlen im Menü, Alle Verbindungen bleibt", () => {
  const targets = navGroupsFor(SYSTEM_USER, "", ["twitch", "psn"]).flatMap((entry) => entry.items).map((item) => item.to);
  expect(targets).not.toContain("/admin/integrations/twitch");
  expect(targets).toContain("/admin/integrations/discord");
  expect(targets).toContain("/admin/integrations");
});

test("Moderatoren sehen die Moderation, Turniere, Fast Lap und Stationen nur mit Helfer-Einsatz", () => {
  const targets = (user) => navGroupsFor(user, "").flatMap((entry) => entry.items).map((item) => item.to);
  const moderator = { role: "moderator", areas: ["moderation"] };
  expect(targets(moderator)).toContain("/admin/moderation");
  for (const to of ["/admin/tournaments", "/admin/f1", "/admin/stations"]) {
    expect(targets(moderator)).not.toContain(to);
    expect(targets({ ...moderator, is_tournament_staff: true })).toContain(to);
  }
  // Ein Helfer ohne Bereich sieht seine Turnierseiten, aber keine Moderation.
  const helper = { role: "player", areas: [], is_tournament_staff: true };
  expect(targets(helper)).toContain("/admin/tournaments");
  expect(targets(helper)).not.toContain("/admin/moderation");
});

test("TV & Beamer (#1110): ein Eintrag unter eSports, nur mit dem Bereich Turniere, die Suche findet Beamer und Fernseher", () => {
  const item = group("eSports").items.find((entry) => entry.to === "/admin/tv");
  expect(item.label).toBe("TV & Beamer");
  expect(item.areas).toEqual(["tournaments"]);
  const find = (query, user = SYSTEM_USER) => navGroupsFor(user, query).flatMap((entry) => entry.items).map((entry) => entry.to);
  expect(find("beamer")).toContain("/admin/tv");
  expect(find("fernseher")).toContain("/admin/tv");
  expect(find("anzeige-schlüssel")).toContain("/admin/tv");
  expect(find("beamer", { role: "moderator" })).not.toContain("/admin/tv");
});

// Turnierleitung ohne Zwei-Faktor (#1028): im Menü keine Verwaltungs-Einträge, die der Server dann ablehnt, sondern
// der Hinweis „2FA einrichten“. Moderation braucht keine Zwei-Faktor-Anmeldung und bleibt.
const LEAD = { role: "tournament_admin", areas: ["tournaments", "moderation"], is_tournament_staff: true, mfa_enabled: true, auth_mfa_verified: true };
const LEAD_WITHOUT_MFA = { ...LEAD, auth_mfa_verified: false };

test("die Turnierleitung ohne Zwei-Faktor sieht keine Verwaltungs-Einträge - auch nicht über die Suche", () => {
  const targets = (user, query = "") => navGroupsFor(user, query).flatMap((entry) => entry.items).map((item) => item.to);
  expect(targets(LEAD)).toEqual(expect.arrayContaining(["/admin", "/admin/tournaments", "/admin/f1", "/admin/stations", "/admin/seasons", "/admin/prizes", "/admin/moderation"]));
  expect(targets(LEAD_WITHOUT_MFA)).toEqual(["/admin/moderation"]);
  expect(targets(LEAD_WITHOUT_MFA, "beamer")).toEqual([]);
  // Mit Freigabe statt Rolle gilt dasselbe.
  expect(targets({ role: "player", areas: ["tournaments"], is_tournament_staff: true, mfa_enabled: false })).toEqual([]);
});

test("ein Helfer sieht ohne Zwei-Faktor nur seine Turnierseiten", () => {
  const helper = { role: "player", areas: [], is_tournament_staff: true, mfa_enabled: false };
  const targets = navGroupsFor(helper, "").flatMap((entry) => entry.items).map((item) => item.to);
  expect(targets).toEqual(["/admin/dienst", "/admin/tournaments", "/admin/f1", "/admin/stations"]);
});

function renderLayout(path = "/admin/moderation") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminLayout><div>inhalt</div></AdminLayout>
    </MemoryRouter>,
  );
}

test("statt der Verwaltung steht im Menü „2FA einrichten“ - mit dem Weg zurück", () => {
  authState.user = LEAD_WITHOUT_MFA;
  const view = renderLayout();
  const hint = screen.getByTestId("admin-nav-mfa-setup");
  expect(hint).toHaveTextContent("2FA einrichten");
  expect(hint).toHaveAttribute("href", "/profile?tab=security&mfa=required&next=%2Fadmin%2Fmoderation");
  expect(screen.queryByTestId("admin-nav-tournaments")).toBeNull();
  expect(screen.getByTestId("admin-nav-moderation")).toBeInTheDocument();
  view.unmount();

  authState.user = LEAD;
  const confirmed = renderLayout("/admin/tournaments");
  expect(screen.queryByTestId("admin-nav-mfa-setup")).toBeNull();
  expect(screen.getByTestId("admin-nav-tournaments")).toBeInTheDocument();
  confirmed.unmount();

  // Helfer brauchen keine Zwei-Faktor-Anmeldung - also auch keinen Hinweis.
  authState.user = { role: "player", areas: [], is_tournament_staff: true, mfa_enabled: false };
  renderLayout("/admin/tournaments");
  expect(screen.queryByTestId("admin-nav-mfa-setup")).toBeNull();
  expect(screen.getByTestId("admin-nav-tournaments")).toBeInTheDocument();
  authState.user = null;
});

test("eine Turnierleitung ohne Zwei-Faktor mit Helfer-Einsatz sieht ihre Turnierseiten und den Hinweis", () => {
  const leadAndHelper = { ...LEAD_WITHOUT_MFA, has_staff_assignment: true };
  const targets = navGroupsFor(leadAndHelper, "").flatMap((entry) => entry.items).map((item) => item.to);
  expect(targets).toEqual(["/admin/dienst", "/admin/tournaments", "/admin/f1", "/admin/stations", "/admin/moderation"]);
  authState.user = leadAndHelper;
  renderLayout("/admin/tournaments");
  expect(screen.getByTestId("admin-nav-mfa-setup")).toBeInTheDocument();
  expect(screen.getByTestId("admin-nav-tournaments")).toBeInTheDocument();
  expect(screen.queryByTestId("admin-nav-seasons")).toBeNull();
  authState.user = null;
});

// Menü je Rolle (#1352, #1353): jeder sieht genau seine Einträge - der Kassier das Dashboard und die Finanzübersicht,
// Helfer und Moderation „Mein Dienst“, Redaktion keine Turnierseiten.
const MFA = { mfa_enabled: true, auth_mfa_verified: true };
const visible = (user) => navGroupsFor(user, "").flatMap((entry) => entry.items).map((item) => item.to);

test.each([
  ["Kassier (nur Finanzen)", { role: "player", areas: ["finance"], ...MFA }, ["/admin", "/admin/finance"]],
  ["Moderator", { role: "moderator" }, ["/admin/dienst", "/admin/moderation"]],
  ["Helfer", { role: "player", has_staff_assignment: true, is_tournament_staff: true }, ["/admin/dienst", "/admin/tournaments", "/admin/f1", "/admin/stations"]],
  ["Spieler", { role: "player" }, []],
])("%s sieht genau seine Einträge", (_name, user, expected) => {
  expect(visible(user)).toEqual(expected);
});

test("Redaktion und Vereinsverwaltung sehen keine Turnierseiten, auch nicht „Mein Dienst“", () => {
  for (const areas of [["content"], ["club"], ["finance"]]) {
    const targets = visible({ role: "player", areas, ...MFA });
    expect(targets).toContain("/admin");
    for (const to of ["/admin/tournaments", "/admin/f1", "/admin/stations", "/admin/dienst", "/admin/moderation"]) expect(targets).not.toContain(to);
  }
  // „Downloads & QR“ nicht für den Kassier (#1353) - Menü und Seiten-Schutz gleich.
  expect(visible({ role: "player", areas: ["finance"], ...MFA })).not.toContain("/admin/downloads");
});

test("ein Admin mit Helfer-Einsatz behält das Dashboard und bekommt „Mein Dienst“ dazu", () => {
  const targets = visible({ role: "player", areas: ["content"], has_staff_assignment: true, is_tournament_staff: true, ...MFA });
  expect(targets).toEqual(expect.arrayContaining(["/admin", "/admin/dienst", "/admin/tournaments", "/admin/news"]));
});

test("Knöpfe außerhalb des Menüs fragen dieselbe Liste (canOpenAdminLink)", () => {
  expect(linkAreas("/admin/tournaments/new")).toEqual(["tournaments"]);
  expect(linkAreas("/admin/ops?tab=app")).toEqual(["system"]);
  expect(linkAreas("/admin/settings/google")).toEqual(["system"]);
  expect(linkAreas("/admin/integrations/discord")).toEqual(["system"]);
  expect(linkAreas("/setup")).toEqual(["system"]);
  expect(linkAreas("/admin/gibt-es-nicht")).toBeNull();
  const editor = { role: "player", areas: ["content"], ...MFA };
  expect(canOpenAdminLink(editor, "/admin/sponsors")).toBe(true);
  expect(canOpenAdminLink(editor, "/admin/tournaments/new")).toBe(false);
  expect(canOpenAdminLink(editor, "/admin/gibt-es-nicht")).toBe(false);
  expect(canOpenAdminLink(editor, "/events/sommerfest")).toBe(true);
});

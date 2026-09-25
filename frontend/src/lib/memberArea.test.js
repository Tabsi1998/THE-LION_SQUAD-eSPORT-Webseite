import { boardContacts, eventDateLine, memberEvents, memberNews } from "./memberArea";

const now = new Date("2026-09-16T10:00:00Z");

const halloween = { id: "e-hallo", name: "Halloween Gaming Night 2026", visibility: "members", start_date: "2026-10-31T18:00:00Z", end_date: "2026-11-01T02:00:00Z" };
const board = { id: "e-board", name: "Vorstandssitzung", visibility: "internal", start_date: "2026-09-20T17:00:00Z" };
const lan = { id: "e-lan", name: "LAN für alle", visibility: "public", start_date: "2026-09-18T10:00:00Z" };
const past = { id: "e-past", name: "Sommerfest", visibility: "members", start_date: "2026-08-01T10:00:00Z", end_date: "2026-08-01T20:00:00Z" };
const undated = { id: "e-open", name: "Ohne Termin", visibility: "members" };

test("nur Mitglieder- und interne Events, nichts Vergangenes, nach Datum", () => {
  expect(memberEvents([halloween, lan, board, past, undated], now).map((e) => e.id)).toEqual(["e-board", "e-hallo", "e-open"]);
});

test("ein Event, das heute noch läuft, bleibt drin", () => {
  const running = { id: "e-run", visibility: "members", start_date: "2026-09-16T08:00:00Z", end_date: "2026-09-16T12:00:00Z" };
  expect(memberEvents([running], now)).toHaveLength(1);
});

test("keine Liste ergibt keine Events", () => {
  expect(memberEvents({ detail: "nope" }, now)).toEqual([]);
  expect(memberEvents(null, now)).toEqual([]);
});

test("die Terminzeile nennt Start und bei mehrtägigen Events das Ende", () => {
  expect(eventDateLine(board)).toMatch(/20\.09\./);
  expect(eventDateLine(halloween)).toMatch(/31\.10\..*–.*01\.11\./);
  expect(eventDateLine(undated)).toBe("Termin folgt");
});

test("interne News: nur Mitglieder- und interne Beiträge, höchstens drei", () => {
  const posts = [
    { id: "n1", visibility: "public" },
    { id: "n2", visibility: "members" },
    { id: "n3", visibility: "internal" },
    { id: "n4", visibility: "members" },
    { id: "n5", visibility: "members" },
  ];
  expect(memberNews(posts).map((p) => p.id)).toEqual(["n2", "n3", "n4"]);
  expect(memberNews(undefined)).toEqual([]);
});

test("Ansprechpartner: nur besetzte, aktive Posten mit Titel, Name und Profil-Link", () => {
  const positions = [
    { id: "p1", display_title: "Obfrau", title_male: "Obmann", is_active: true, user: { display_name: "Lea", avatar_url: "/api/static/uploads/lea.webp", profile_url: "/members/lea" } },
    { id: "p2", display_title: "Kassier", is_active: true, user: null },
    { id: "p3", title_male: "Schriftführer", is_active: false, user: { display_name: "Max" } },
    { id: "p4", title_male: "Beirat", user: { gamertag: "Tabsi98", slug: "tabsi98" } },
  ];
  expect(boardContacts(positions)).toEqual([
    { id: "p1", title: "Obfrau", name: "Lea", avatar: "/api/static/uploads/lea.webp", profileUrl: "/members/lea" },
    { id: "p4", title: "Beirat", name: "Tabsi98", avatar: "", profileUrl: "/members/tabsi98" },
  ]);
  expect(boardContacts("kaputt")).toEqual([]);
});

// #364: Jede Adresse der Verweiszeile hat eine Route in App.jsx - eine tote Adresse fällt hier auf,
// nicht erst beim Klick eines Mitglieds. Der Anker der Mitgliedskarte wird ohne Raute geprüft.
test("jede Adresse der Verweiszeile hat eine Route", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const app = fs.readFileSync(path.resolve(process.cwd(), "src/App.jsx"), "utf-8");
  const routes = [...app.matchAll(/<Route path="([^"]+)"/g)].map((match) => match[1]);
  const { MEMBER_AREA_LINKS } = await import("./memberArea");
  expect(MEMBER_AREA_LINKS.map((link) => link.label)).toEqual(["Mitgliedschaft", "Mitgliedskarte", "Vorteile", "Dokumente", "Versammlungen", "Interne News", "Vorstand"]);
  for (const link of MEMBER_AREA_LINKS) {
    const path = link.to.split("#")[0];
    expect(routes, `${link.label} → ${link.to}`).toContain(path);
  }
  // Alte Adressen leiten weiter, statt 404 zu zeigen.
  expect(routes).toContain("/mitgliederbereich");
  expect(routes).toContain("/member-area");
});

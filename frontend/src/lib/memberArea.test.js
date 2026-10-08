import {
  AREA_JUMPS, areaCard, boardContacts, dateTileParts, eventDateLine, helperEvents, isRecent, jumpEntries, memberEvents, memberNews, tileNote,
} from "./memberArea";

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
    { id: "p1", display_title: "Obfrau", title_male: "Obmann", is_active: true, user: { display_name: "Lea", gamertag: "LeaLion", photo_cutout: true, avatar_url: "/api/static/uploads/lea.webp", profile_url: "/members/lea" } },
    { id: "p2", display_title: "Kassier", is_active: true, user: null },
    { id: "p3", title_male: "Schriftführer", is_active: false, user: { display_name: "Max" } },
    { id: "p4", title_male: "Beirat", user: { gamertag: "Tabsi98", slug: "tabsi98" } },
  ];
  expect(boardContacts(positions)).toEqual([
    { id: "p1", title: "Obfrau", name: "Lea", avatar: "/api/static/uploads/lea.webp", profileUrl: "/members/lea", cutout: true, gamertag: "LeaLion" },
    { id: "p4", title: "Beirat", name: "Tabsi98", avatar: "", profileUrl: "/members/tabsi98", cutout: false, gamertag: "" },
  ]);
  expect(boardContacts("kaputt")).toEqual([]);
});

// #364, #1257: Jede Adresse der Sprungleiste hat eine Route in App.jsx - steht ein Abschnitt gerade nicht auf der Seite,
// öffnet der Eintrag diese Seite; eine tote Adresse fällt hier auf, nicht erst beim Tipp eines Mitglieds.
test("jede Adresse der Sprungleiste hat eine Route", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const app = fs.readFileSync(path.resolve(process.cwd(), "src/App.jsx"), "utf-8");
  const routes = [...app.matchAll(/<Route path="([^"]+)"/g)].map((match) => match[1]);
  expect(AREA_JUMPS.map((jump) => jump.label)).toEqual(["Karte", "Versammlung", "Helfen", "News", "Dokumente"]);
  for (const jump of AREA_JUMPS) {
    const target = jump.to.split("#")[0];
    expect(routes, `${jump.label} → ${jump.to}`).toContain(target);
  }
  // Alte Adressen leiten weiter, statt 404 zu zeigen.
  expect(routes).toContain("/mitgliederbereich");
  expect(routes).toContain("/member-area");
});

test("Sprungleiste und Kacheln auf /verein: dieselben Zahlen, ohne Offenes ohne Zahl", () => {
  const summary = { meetings_open: 1, helping_free: 6, news_new: 1, documents: 9, documents_new: 0 };
  expect(jumpEntries(summary).map((entry) => [entry.key, entry.note])).toEqual([
    ["karte", ""], ["versammlung", "1 offen"], ["helfen", "6 frei"], ["news", "1 neu"], ["dokumente", ""],
  ]);
  expect(jumpEntries({ ...summary, documents_new: 2 }).at(-1).note).toBe("2 neu");
  expect(jumpEntries(null).every((entry) => entry.count === 0 && entry.note === "")).toBe(true);
  expect(jumpEntries({ meetings_open: -3, helping_free: "x" }).every((entry) => entry.note === "")).toBe(true);
  expect(tileNote("meetings", summary)).toBe("1 offen");
  expect(tileNote("helping", summary)).toBe("6 frei");
  expect(tileNote("documents", summary)).toBe("");
  expect(tileNote("documents", { documents_new: 1 })).toBe("1 neu");
  expect(tileNote("benefits", summary)).toBe("");
});

test("neu heißt: in den letzten zwei Wochen erschienen", () => {
  expect(isRecent("2026-09-10T10:00:00Z", now)).toBe(true);
  expect(isRecent("2026-09-01T10:00:00Z", now)).toBe(false);
  expect(isRecent("2026-09-20T10:00:00Z", now)).toBe(false);
  expect(isRecent("kaputt", now)).toBe(false);
  expect(isRecent(null, now)).toBe(false);
});

test("Datums-Kachel: Monat auf Österreichisch und Tag", () => {
  expect(dateTileParts("2026-10-24")).toEqual({ month: "Okt", day: "24", full: "24.10.2026" });
  expect(dateTileParts("2027-01-05")).toEqual({ month: "Jän", day: "5", full: "05.01.2027" });
  expect(dateTileParts("")).toBeNull();
  expect(dateTileParts("2026-13-01")).toBeNull();
});

test("Karte oben: dieselben Angaben wie „Meine Mitgliedschaft“, nur für eine gültige Mitgliedschaft", () => {
  const user = { display_name: "LunaByte", username: "luna" };
  const me = { membership: { member_status: "active", member_number: "TLS-031", member_since: "2026-02-01", membership_type: "youth" }, dolibarr: { paid_until: "2026-12-31" } };
  expect(areaCard(user, me)).toEqual({ name: "LunaByte", number: "TLS-031", since: "2026-02-01", typeLabel: "Jugendmitglied", validUntil: "2026-12-31" });
  expect(areaCard(user, { ...me, dolibarr: { type_label: "Fördermitglied", membership_ends: "2026-11-30", paid_until: "2026-12-31" } }))
    .toMatchObject({ typeLabel: "Fördermitglied", validUntil: "2026-11-30" });
  expect(areaCard({ username: "luna" }, { membership: { member_status: "honorary" } })).toMatchObject({ name: "luna", typeLabel: "Mitglied", number: "" });
  expect(areaCard(user, { membership: { member_status: "pending" } })).toBeNull();
  expect(areaCard(user, null)).toBeNull();
});

test("Helferdienste: kommende Veranstaltungen mit freien Plätzen oder eigenen Diensten, nach Datum", () => {
  const view = { events: [
    { id: 6, day: "2026-11-14", upcoming: true, open_places: 2, mine: [] },
    { id: 5, day: "2026-10-10", upcoming: true, open_places: 0, mine: [{ id: 52 }] },
    { id: 4, day: "2026-10-01", upcoming: true, open_places: 0, mine: [] },
    { id: 3, day: "2025-12-20", upcoming: false, open_places: 4, mine: [] },
  ] };
  expect(helperEvents(view).map((event) => event.id)).toEqual([5, 6]);
  expect(helperEvents(view, 1).map((event) => event.id)).toEqual([5]);
  expect(helperEvents(null)).toEqual([]);
});

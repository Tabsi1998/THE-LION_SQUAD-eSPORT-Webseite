import { NAV_STRUCTURE, visibleNavChildren } from "@/components/tls/MainNav";
import { activeSection, bottomNavItems } from "@/components/tls/BottomNav";
import { userMenuEntries } from "@/pages/user/profile/constants";
import { WEB_TOPICS } from "./topics";

// Wächter „Jedes Thema an genau einem Ort“ (#1150): jedes Thema hat im Hauptmenü höchstens eine Stelle - und genau die
// Gruppe aus der Liste; das Benutzermenü führt keinen zweiten Weg (Chats, Glocke, Rechnungen, Teams …).

vi.mock("@/lib/api", () => ({ api: { get: vi.fn(async () => ({ data: [] })) } }));

function menuPlaces(signedIn) {
  const places = [];
  for (const item of NAV_STRUCTURE) {
    if (item.children?.length) {
      for (const child of visibleNavChildren(item, { isClubMember: true, signedIn })) places.push({ group: item.label, to: child.to.split("?")[0] });
    } else {
      places.push({ group: null, to: item.to });
    }
  }
  return places;
}

test("jedes Thema steht im Hauptmenü höchstens einmal - in seiner Gruppe", () => {
  expect(WEB_TOPICS.length).toBeGreaterThanOrEqual(11);
  const places = menuPlaces(true);
  for (const topic of WEB_TOPICS.filter((entry) => entry.path)) {
    const found = places.filter((place) => place.to === topic.path);
    if (topic.menu) {
      expect([topic.topic, found.map((place) => place.group)]).toEqual([topic.topic, [topic.menu]]);
    } else {
      expect([topic.topic, found]).toEqual([topic.topic, []]);
    }
  }
  // Jahreswertung und Erfolge gehören zu Community, ein Name: „Erfolge“.
  const community = NAV_STRUCTURE.find((item) => item.label === "Community").children.map((child) => child.label);
  expect(community).toEqual(expect.arrayContaining(["Chats", "Jahreswertung", "Erfolge", "Teams"]));
  const esports = NAV_STRUCTURE.find((item) => item.label === "eSports").children.map((child) => child.label);
  expect(esports).not.toContain("Jahreswertung");
  expect(JSON.stringify(NAV_STRUCTURE)).not.toMatch(/Achievements/);
});

test("Chats stehen nur mit Konto im Menü", () => {
  expect(menuPlaces(false).some((place) => place.to === "/messages")).toBe(false);
  expect(menuPlaces(true).filter((place) => place.to === "/messages")).toHaveLength(1);
});

// Seit #2059 führt das Benutzermenü direkt in die Gruppen von „Mein Bereich“ - dort wohnen Rechnungen, Mitgliedschaft und
// Konto. Ein zweiter Weg zu Chats, Glocke, Teams oder „Mitglied werden“ kommt nicht dazu.
test("das Benutzermenü führt keinen zweiten Weg zu einem der Themen", () => {
  const entries = userMenuEntries({ mitglied: true }).map((entry) => entry.to);
  expect(entries).toEqual([
    "/dashboard", "/mein-bereich", "/mein-bereich/profil", "/mein-bereich/mitgliedschaft", "/mein-bereich/rechnungen",
    "/mein-bereich/verein", "/mein-bereich/benachrichtigungen", "/mein-bereich/konto", "/mein-bereich/datenschutz",
  ]);
  expect(userMenuEntries({ mitglied: false }).map((entry) => entry.to)).not.toContain("/mein-bereich/verein");
  for (const path of ["/messages", "/notifications", "/teams", "/membership/join", "/contact", "/profile", "/members/area"]) {
    expect(entries).not.toContain(path);
  }
});

test("die Handy-Leiste hat die fünf Einträge der App und kennt jedes Thema", () => {
  expect(bottomNavItems(null).map((item) => item.label)).toEqual(["Start", "Events", "Community", "Verein", "Profil"]);
  expect(activeSection("/messages")).toBe("community");
  expect(activeSection("/achievements")).toBe("community");
  expect(activeSection("/galerie/sommer")).toBe("verein");
  expect(activeSection("/fastlap/monza")).toBe("events");
  expect(activeSection("/account/invoices")).toBe("profile");
  expect(activeSection("/mein-bereich/verein/helfen")).toBe("profile");
});

test("Saison-Deko: Angemeldete unter Konto & Sicherheit → Darstellung, Gäste je Gerät an einem Platz (#1239, #2059)", () => {
  const deco = WEB_TOPICS.find((entry) => entry.topic === "Saison-Deko und Einstellungen");
  expect(deco.place).toBe("Mein Bereich → Konto & Sicherheit → Darstellung (Gäste: am Handy im Menü, am PC in der Fußzeile)");
  expect(deco.menu).toBeNull();
});

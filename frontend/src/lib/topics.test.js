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

test("das Benutzermenü führt keinen zweiten Weg zu einem der Themen", () => {
  const entries = userMenuEntries({ username: "neonfalke" }).map((entry) => entry.to);
  expect(entries).toEqual(["/dashboard", "/u/neonfalke", "/profile"]);
  for (const path of ["/messages", "/notifications", "/account/invoices", "/members/membership", "/teams", "/my/prizes", "/membership/join", "/contact"]) {
    expect(entries).not.toContain(path);
  }
});

test("die Handy-Leiste hat die fünf Einträge der App und kennt jedes Thema", () => {
  expect(bottomNavItems(null).map((item) => item.label)).toEqual(["Home", "Events", "Community", "Verein", "Profil"]);
  expect(activeSection("/messages")).toBe("community");
  expect(activeSection("/achievements")).toBe("community");
  expect(activeSection("/galerie/sommer")).toBe("verein");
  expect(activeSection("/fastlap/monza")).toBe("events");
  expect(activeSection("/account/invoices")).toBe("profile");
});

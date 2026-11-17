import {
  LEGACY_TAB_ANCHORS, STAFFEL_SECTIONS, STAFFEL_TABS, STAFFEL_TABS_READY, legacyTabAnchor, staffelAdminUrl, staffelManageUrl, staffelTabOf,
  staffelTarget,
} from "./staffelTabs";

// Staffel-Seite (#2262): Jede Marke - Reiter, Abschnitt oder Ziel eines alten Reiters - gehört zu genau einem Reiter.

const TAB_KEYS = STAFFEL_TABS.map((tab) => tab.key);

test("alle sieben Reiter stehen fest und seit Paket C auf der Seite", () => {
  expect(TAB_KEYS).toEqual(["ueberblick", "teilnehmer", "spielplan", "spiele", "tabelle", "protokoll", "einstellungen"]);
  expect(new Set(TAB_KEYS).size).toBe(TAB_KEYS.length);
  expect([...STAFFEL_TABS_READY]).toEqual(TAB_KEYS);
  for (const key of STAFFEL_TABS_READY) expect(TAB_KEYS).toContain(key);
});

test("jede Marke gehört zu genau einem Reiter", () => {
  const anchors = [...TAB_KEYS, ...Object.keys(STAFFEL_SECTIONS), ...Object.values(LEGACY_TAB_ANCHORS)];
  for (const anchor of anchors) {
    const owners = TAB_KEYS.filter((tab) => tab === anchor || STAFFEL_SECTIONS[anchor] === tab);
    expect({ anchor, owners: owners.length }).toEqual({ anchor, owners: 1 });
    expect(staffelTabOf(anchor)).toBe(owners[0]);
  }
  // Kein Abschnitt heißt wie ein Reiter - sonst wäre die Marke doppelt belegt.
  for (const section of Object.keys(STAFFEL_SECTIONS)) expect(TAB_KEYS).not.toContain(section);
});

test("Sprungmarke → Reiter und Abschnitt, Unbekanntes → Überblick", () => {
  expect(staffelTarget("#teilnehmer")).toEqual({ tab: "teilnehmer", section: "" });
  expect(staffelTarget("#zuteilen")).toEqual({ tab: "teilnehmer", section: "zuteilen" });
  expect(staffelTarget("#Austritt")).toEqual({ tab: "teilnehmer", section: "austritt" });
  expect(staffelTarget("#gleichstand")).toEqual({ tab: "tabelle", section: "gleichstand" });
  expect(staffelTarget("")).toEqual({ tab: "ueberblick", section: "" });
  expect(staffelTarget("#gibtsnicht")).toEqual({ tab: "ueberblick", section: "" });
  expect(staffelTabOf("gibtsnicht")).toBe("");
});

test("Adresse flach wie die API, der Überblick ohne Marke", () => {
  expect(staffelAdminUrl("t-1")).toBe("/admin/leagues/staffeln/t-1");
  expect(staffelAdminUrl("t-1", "ueberblick")).toBe("/admin/leagues/staffeln/t-1");
  expect(staffelAdminUrl("t-1", "teilnehmer")).toBe("/admin/leagues/staffeln/t-1#teilnehmer");
  expect(staffelAdminUrl("t 1", "#zuteilen")).toBe("/admin/leagues/staffeln/t%201#zuteilen");
});

test("alte Reiter der Turnierverwaltung haben ihr Ziel auf der Staffel-Seite", () => {
  expect(legacyTabAnchor("participants")).toBe("teilnehmer");
  expect(legacyTabAnchor("matchplan")).toBe("spielplan");
  expect(legacyTabAnchor("stages")).toBe("spiele");
  expect(legacyTabAnchor("bracket")).toBe("tabelle");
  expect(legacyTabAnchor("edit")).toBe("einstellungen");
  expect(legacyTabAnchor("maps")).toBe("einstellungen");
  expect(legacyTabAnchor("staff")).toBe("helfer");
  expect(legacyTabAnchor("feedback")).toBe("ueberblick");
  expect(legacyTabAnchor("")).toBe("ueberblick");
  expect(legacyTabAnchor("gibtsnicht")).toBe("ueberblick");
});

test("jedes Ziel führt auf die Staffel-Seite, keins mehr in die Turnierverwaltung", () => {
  expect(staffelManageUrl("t-1")).toBe("/admin/leagues/staffeln/t-1");
  expect(staffelManageUrl("t-1", "participants")).toBe("/admin/leagues/staffeln/t-1#teilnehmer");
  expect(staffelManageUrl("t-1", "participants", "zuteilen")).toBe("/admin/leagues/staffeln/t-1#zuteilen");
  // Paket B: Spielplan, Spiele und Tabelle stehen auf der Staffel-Seite - samt Abschnitten.
  expect(staffelManageUrl("t-1", "matchplan")).toBe("/admin/leagues/staffeln/t-1#spielplan");
  expect(staffelManageUrl("t-1", "stages")).toBe("/admin/leagues/staffeln/t-1#spiele");
  expect(staffelManageUrl("t-1", "bracket")).toBe("/admin/leagues/staffeln/t-1#tabelle");
  expect(staffelManageUrl("t-1", "matchplan", "termine")).toBe("/admin/leagues/staffeln/t-1#termine");
  expect(staffelManageUrl("t-1", "stages", "ergebnisse")).toBe("/admin/leagues/staffeln/t-1#ergebnisse");
  expect(staffelManageUrl("t-1", "bracket", "gleichstand")).toBe("/admin/leagues/staffeln/t-1#gleichstand");
  // Paket C: Einstellungen samt Darstellung und Helfer, Protokoll, Rückmeldungen im Überblick.
  expect(staffelManageUrl("t-1", "edit")).toBe("/admin/leagues/staffeln/t-1#einstellungen");
  expect(staffelManageUrl("t-1", "maps")).toBe("/admin/leagues/staffeln/t-1#einstellungen");
  expect(staffelManageUrl("t-1", "staff")).toBe("/admin/leagues/staffeln/t-1#helfer");
  expect(staffelManageUrl("t-1", "feedback")).toBe("/admin/leagues/staffeln/t-1");
  expect(staffelManageUrl("t-1", "edit", "darstellung")).toBe("/admin/leagues/staffeln/t-1#darstellung");
  expect(staffelManageUrl("t-1", "", "protokoll")).toBe("/admin/leagues/staffeln/t-1#protokoll");
  for (const tab of Object.keys(LEGACY_TAB_ANCHORS)) expect(staffelManageUrl("t-1", tab)).not.toContain("/admin/tournaments");
});

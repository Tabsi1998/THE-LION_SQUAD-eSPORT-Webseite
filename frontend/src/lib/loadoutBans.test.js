import {
  categoriesPayload, categoriesProblem, equipmentPayload, fitsWeapon, formPayload, formProblem, groupByCategory, listToForm,
  matchesSearch, modesText, publicGroups, rowKey, sameRows,
} from "./loadoutBans";

// Sperrliste der Season (#2218): Formular, Anfrage und öffentliche Gruppen rechnen wie der Server. Nur erfundene Namen.
const LIBRARY = [
  { id: "w1", category: "waffen", name: "Blitz 9" },
  { id: "w2", category: "waffen", name: "Donner 4" },
  { id: "a1", category: "aufsaetze", name: "Rotpunkt", weapon_ids: ["w1"] },
  { id: "a2", category: "aufsaetze", name: "Griff", weapon_ids: [] },
  { id: "p1", category: "perks", name: "Leise Sohlen", status: "inactive" },
];
const MODES = [{ mode: "stellung", label: "Stellung" }, { mode: "suchen", label: "Suchen", status: "archived" }];

test("ein Aufsatz passt nur zu seinen Waffen, ohne Zuordnung zu keiner (Obmann, 03.11.)", () => {
  expect(fitsWeapon(LIBRARY[2], "w1")).toBe(true);
  expect(fitsWeapon(LIBRARY[2], "w2")).toBe(false);
  expect(fitsWeapon(LIBRARY[3], "w2")).toBe(false);
  expect(fitsWeapon({ name: "ohne Feld" }, "w1")).toBe(false);
});

test("Suche findet jedes Wort ohne Groß und klein", () => {
  expect(matchesSearch({ name: "Blitz  9" }, "blitz 9")).toBe(true);
  expect(matchesSearch({ name: "Blitz 9" }, "9 BLI")).toBe(true);
  expect(matchesSearch({ name: "Blitz 9" }, "Donner")).toBe(false);
});

test("Kategorien: Kennung bleibt, leere fallen weg, doppelte Namen werden genannt", () => {
  expect(categoriesPayload([{ key: "waffen", label: " Waffen ", role: "weapon" }, { label: "", role: "item" }, { label: "Perks", role: "item" }]))
    .toEqual([{ key: "waffen", label: "Waffen", role: "weapon" }, { label: "Perks", role: "item" }]);
  expect(categoriesProblem([{ label: "Perks" }, { label: " perks " }])).toBe("„perks“ steht zweimal in der Liste.");
  expect(categoriesProblem([{ label: "Perks" }, { label: "" }, { label: "" }])).toBe("");
});

test("ein Eintrag schickt Waffen nur als Aufsatz und die Kategorie nur beim Anlegen", () => {
  const form = { category: "aufsaetze", name: " Rotpunkt ", image_url: "", note: " ", weapon_ids: ["w1"] };
  expect(equipmentPayload(form, "attachment", { create: true })).toEqual({ category: "aufsaetze", name: "Rotpunkt", image_url: null, note: null, weapon_ids: ["w1"] });
  expect(equipmentPayload(form, "weapon")).toEqual({ name: "Rotpunkt", image_url: null, note: null });
});

test("die gespeicherte Liste wird Formular - Archiviertes und verschwundene Modi fallen mit Hinweis heraus", () => {
  const list = { entries: [
    { kind: "item", item_id: "w1", name: "Blitz 9", modes: ["stellung", "weg"] },
    { kind: "item", item_id: "alt", name: "Altwaffe", modes: [] },
    { kind: "attachments", item_id: "w2", name: "Donner 4", modes: [], attachments: [{ item_id: "a2", name: "Griff" }, { item_id: "x", name: "Lauf" }] },
  ] };
  const { rows, dropped } = listToForm(list, LIBRARY, MODES);
  expect(rows).toEqual({
    [rowKey("item", "w1")]: { kind: "item", item_id: "w1", modes: ["stellung"], attachment_ids: [] },
    [rowKey("attachments", "w2")]: { kind: "attachments", item_id: "w2", modes: [], attachment_ids: ["a2"] },
  });
  expect(dropped).toEqual(["Altwaffe", "Lauf"]);
});

test("die Anfrage folgt der Bibliothek: erst ganze Sperren, dann Aufsätze; leere Aufsatz-Zeilen fallen weg", () => {
  const rows = {
    "attachments:w2": { kind: "attachments", item_id: "w2", modes: [], attachment_ids: ["a2"] },
    "item:p1": { kind: "item", item_id: "p1", modes: ["stellung"], attachment_ids: [] },
    "item:w1": { kind: "item", item_id: "w1", modes: [], attachment_ids: [] },
    "attachments:w1": { kind: "attachments", item_id: "w1", modes: [], attachment_ids: [] },
  };
  expect(formPayload(rows, LIBRARY)).toEqual([
    { item_id: "w1", kind: "item", modes: [], attachment_ids: [] },
    { item_id: "p1", kind: "item", modes: ["stellung"], attachment_ids: [] },
    { item_id: "w2", kind: "attachments", modes: [], attachment_ids: ["a2"] },
  ]);
  expect(sameRows(rows, { "item:w1": rows["item:w1"], "item:p1": rows["item:p1"], "attachments:w2": rows["attachments:w2"] })).toBe(true);
  expect(sameRows(rows, { "item:w1": rows["item:w1"] })).toBe(false);
});

test("vor dem Speichern: leer und eine ganz gesperrte Waffe mit Aufsätzen werden genannt", () => {
  expect(formProblem({}, LIBRARY)).toContain("mindestens einen Eintrag");
  expect(formProblem({ "item:w1": { kind: "item", item_id: "w1", modes: [], attachment_ids: [] },
    "attachments:w1": { kind: "attachments", item_id: "w1", modes: [], attachment_ids: ["a1"] } }, LIBRARY)).toContain("„Blitz 9“");
  expect(formProblem({ "item:w1": { kind: "item", item_id: "w1", modes: ["stellung"], attachment_ids: [] },
    "attachments:w1": { kind: "attachments", item_id: "w1", modes: [], attachment_ids: ["a1"] } }, LIBRARY)).toBe("");
});

test("öffentlich: je Kategorie die gesperrten Einträge, danach die Waffen mit Aufsätzen", () => {
  const list = { entries: [
    { kind: "item", name: "Blitz 9", category_label: "Waffen", mode_labels: [] },
    { kind: "item", name: "Leise Sohlen", category_label: "Perks", mode_labels: ["Suchen"] },
    { kind: "attachments", name: "Donner 4", category_label: "Waffen", attachments: [{ name: "Griff" }] },
  ] };
  const { groups, weapons } = publicGroups(list);
  expect(groups.map((group) => [group.label, group.entries.map((row) => row.name)])).toEqual([["Waffen", ["Blitz 9"]], ["Perks", ["Leise Sohlen"]]]);
  expect(weapons.map((row) => row.name)).toEqual(["Donner 4"]);
  expect(modesText(list.entries[0])).toBe("alle Modi");
  expect(modesText(list.entries[1])).toBe("Suchen");
  expect(groupByCategory(LIBRARY, [{ key: "perks" }, { key: "waffen" }]).map((group) => group.items.length)).toEqual([1, 2]);
});

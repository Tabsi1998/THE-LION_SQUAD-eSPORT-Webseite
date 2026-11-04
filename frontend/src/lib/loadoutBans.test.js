import {
  categoriesPayload, categoriesProblem, differsFromSection, equipmentPayload, fitsNothing, fitsWeapon, formPayload, formProblem,
  groupByCategory, groupBySubcategory, listToForm, matchesSearch, missingSuggestions, modesText, publicGroups, rowKey, sameRows,
  subcategoriesPayload, subcategoriesProblem, subcategoryOf, weaponClasses,
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
  const form = { category: "aufsaetze", subcategory: "", name: " Rotpunkt ", image_url: "", note: " ", weapon_ids: ["w1"], weapon_class_ids: ["sturm"] };
  expect(equipmentPayload(form, "attachment", { create: true })).toEqual({
    category: "aufsaetze", subcategory: null, name: "Rotpunkt", image_url: null, note: null, weapon_ids: ["w1"], weapon_class_ids: ["sturm"] });
  expect(equipmentPayload({ ...form, subcategory: "optik" }, "weapon")).toEqual({ name: "Rotpunkt", subcategory: "optik", image_url: null, note: null });
});

// #2287: Unterkategorien, Waffenklassen und ganze Klassen.
const CATEGORIES = [
  { key: "waffen", label: "Waffen", role: "weapon", subcategories: [{ key: "sturm", label: "Sturmgewehr" }, { key: "schrot", label: "Schrotflinte" }] },
  { key: "aufsaetze", label: "Aufsätze", role: "attachment", subcategories: [{ key: "optik", label: "Optik" }] },
  { key: "perks", label: "Perks", role: "item", subcategories: [] },
];

test("ein Aufsatz passt über die Klasse der Waffe - eine neue Waffe der Klasse sofort", () => {
  const sight = { weapon_ids: [], weapon_class_ids: ["schrot"] };
  expect(fitsWeapon(sight, { id: "neu", subcategory: "schrot" })).toBe(true);
  expect(fitsWeapon(sight, { id: "w1", subcategory: "sturm" })).toBe(false);
  expect(fitsWeapon(sight, "neu")).toBe(false);
  expect(fitsNothing(sight)).toBe(false);
  expect(fitsNothing({ weapon_ids: [], weapon_class_ids: [] })).toBe(true);
  expect(weaponClasses(CATEGORIES).map((row) => [row.key, row.category_label])).toEqual([["sturm", "Waffen"], ["schrot", "Waffen"]]);
});

test("je Unterkategorie gruppiert, ohne Unterkategorie zuerst und nur mit Einträgen", () => {
  const items = [{ id: "w1", subcategory: "sturm" }, { id: "w2" }, { id: "w3", subcategory: "weg" }];
  expect(groupBySubcategory(items, CATEGORIES[0]).map((group) => [group.sub?.key || null, group.items.map((item) => item.id)]))
    .toEqual([[null, ["w2", "w3"]], ["sturm", ["w1"]], ["schrot", []]]);
  expect(groupBySubcategory([{ id: "w1", subcategory: "sturm" }], CATEGORIES[0])[0].sub.key).toBe("sturm");
  expect(groupBySubcategory([{ id: "p1" }], CATEGORIES[2])).toEqual([{ sub: null, items: [{ id: "p1" }] }]);
  expect(subcategoryOf(CATEGORIES, "optik")).toMatchObject({ label: "Optik", category_label: "Aufsätze" });
});

test("Unterkategorien: Kennung bleibt, Vorschlag nur, was fehlt", () => {
  expect(subcategoriesPayload([{ key: "sturm", label: " Sturmgewehr ", icon_url: "" }, { label: "  " }, { label: "Pistole", icon_url: "/api/static/uploads/p.png" }]))
    .toEqual([{ key: "sturm", label: "Sturmgewehr", icon_url: null }, { label: "Pistole", icon_url: "/api/static/uploads/p.png" }]);
  expect(subcategoriesProblem([{ label: "Pistole" }, { label: "pistole" }])).toContain("zweimal");
  expect(missingSuggestions([{ label: "sturmgewehr" }], ["Sturmgewehr", "Pistole"])).toEqual(["Pistole"]);
});

test("eine ganze Klasse im Formular: laden, schicken, Einzelzeilen darin werden genannt", () => {
  const library = [...LIBRARY, { id: "s1", category: "waffen", name: "Hagel", subcategory: "schrot" }];
  const list = { entries: [
    { kind: "class", subcategory: "schrot", name: "Schrotflinte", modes: ["stellung"] },
    { kind: "class", subcategory: "weg", name: "Entfernt", modes: [] },
  ] };
  const { rows, dropped } = listToForm(list, library, MODES, CATEGORIES);
  expect(rows).toEqual({ "class:schrot": { kind: "class", subcategory: "schrot", modes: ["stellung"], attachment_ids: [] } });
  expect(dropped).toEqual(["Entfernt"]);
  const withItem = { ...rows, "item:w1": { kind: "item", item_id: "w1", modes: [], attachment_ids: [] } };
  expect(formPayload(withItem, library, CATEGORIES)).toEqual([
    { kind: "class", subcategory: "schrot", modes: ["stellung"], attachment_ids: [] },
    { item_id: "w1", kind: "item", modes: [], attachment_ids: [] },
  ]);
  expect(sameRows(withItem, rows)).toBe(false);
  expect(formProblem({ ...rows, "item:s1": { kind: "item", item_id: "s1", modes: [], attachment_ids: [] } }, library, CATEGORIES)).toBe("");
  const full = { "class:schrot": { kind: "class", subcategory: "schrot", modes: [], attachment_ids: [] },
    "item:s1": { kind: "item", item_id: "s1", modes: ["suchen"], attachment_ids: [] } };
  expect(formProblem(full, library, CATEGORIES)).toContain("„Hagel“ gehört zu „Schrotflinte“");
  expect(formProblem({ "class:schrot": full["class:schrot"] }, library, CATEGORIES)).toBe("");
});

test("öffentlich gruppiert: Kategorie, ohne Unterkategorie zuerst, ganze Klasse mit den Einträgen von heute", () => {
  const list = { entries: [
    { kind: "item", item_id: "w9", name: "Ohne", category_label: "Waffen", mode_labels: [] },
    { kind: "class", subcategory: "schrot", subcategory_label: "Schrotflinte", category_label: "Waffen", image_url: "/api/static/uploads/k.png",
      mode_labels: ["Suchen"], items: [{ item_id: "s2", name: "Hagel" }, { item_id: "s1", name: "Bö" }] },
    { kind: "item", item_id: "s2", name: "Hagel", subcategory: "schrot", subcategory_label: "Schrotflinte", category_label: "Waffen", mode_labels: ["Stellung"] },
    { kind: "class", subcategory: "leer", subcategory_label: "Raketenwerfer", category_label: "Waffen", mode_labels: [], items: [] },
    { kind: "item", item_id: "p1", name: "Leise Sohlen", category_label: "Perks", mode_labels: [] },
  ] };
  const { categories } = publicGroups(list);
  expect(categories.map((row) => [row.label, row.count, row.sections.map((section) => section.label)]))
    .toEqual([["Waffen", 3, [null, "Schrotflinte"]], ["Perks", 1, [null]]]);
  const shotguns = categories[0].sections[1];
  expect([shotguns.all, shotguns.mode_labels, shotguns.icon_url]).toEqual([true, ["Suchen"], "/api/static/uploads/k.png"]);
  expect(shotguns.entries.map((row) => [row.name, row.mode_labels])).toEqual([["Bö", ["Suchen"]], ["Hagel", ["Suchen", "Stellung"]]]);
  expect(differsFromSection(shotguns.entries[0], shotguns)).toBe(false);
  expect(differsFromSection(shotguns.entries[1], shotguns)).toBe(true);
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
  const { categories, weapons } = publicGroups(list);
  // Ohne Unterkategorien: je Kategorie ein Abschnitt ohne Namen - wie vor #2287.
  expect(categories.map((group) => [group.label, group.sections.length, group.sections[0].label, group.sections[0].entries.map((row) => row.name)]))
    .toEqual([["Waffen", 1, null, ["Blitz 9"]], ["Perks", 1, null, ["Leise Sohlen"]]]);
  expect(weapons.map((row) => row.name)).toEqual(["Donner 4"]);
  expect(modesText(list.entries[0])).toBe("alle Modi");
  expect(modesText(list.entries[1])).toBe("Suchen");
  expect(groupByCategory(LIBRARY, [{ key: "perks" }, { key: "waffen" }]).map((group) => group.items.length)).toEqual([1, 2]);
});

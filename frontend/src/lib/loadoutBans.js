// Ausrüstung und Sperrliste der Season (docs/LIGA.md, C.4 #2218): Logik ohne Oberfläche, damit Bibliothek, Editor der Season und die
// öffentliche Ansicht dasselbe rechnen. Alles ist erlaubt außer der Sperrliste - eine Zeile sperrt einen Eintrag ganz (`item`), an
// einer Waffe einzelne Aufsätze (`attachments`) oder eine ganze Unterkategorie (`class`, #2287: alle Einträge, auch spätere), je in
// allen Modi (leere Liste) oder in den genannten.

export const ROLE_LABELS = { weapon: "Waffe", attachment: "Aufsatz", item: "Ausrüstung" };
export const NO_SUBCATEGORY = "Ohne Unterkategorie";
export const ROLE_HINTS = {
  weapon: "Kann Aufsätze haben; an ihr lassen sich einzelne Aufsätze sperren.",
  attachment: "Passt nur zu den gewählten Waffen – ohne Wahl zu keiner.",
  item: "Perks, Ausrüstung, Abschussserien und alles andere.",
};
export const ALL_MODES = "alle Modi";
export const STATUS_WORDS = { active: "aktiv", inactive: "inaktiv", archived: "archiviert" };

export function statusOf(item) {
  return ["inactive", "archived"].includes(item?.status) ? item.status : "active";
}

/** Gleich ist, was ohne Groß und klein und mit zusammengefasstem Leerraum gleich ist - wie der Server. */
export function nameKey(value) {
  return String(value ?? "").normalize("NFKC").split(/\s+/).filter(Boolean).join(" ").toLocaleLowerCase("de");
}

/** Je Kategorie die Einträge in Reihenfolge der Kategorien; Einträge ohne bekannte Kategorie fallen weg. */
export function groupByCategory(items = [], categories = []) {
  return categories.map((category) => ({ category, items: items.filter((item) => item.category === category.key) }));
}

export function roleOf(categories = [], key) {
  return categories.find((row) => row.key === key)?.role || null;
}

/**
 * Passt ein Aufsatz zu dieser Waffe? Wenn er ihr zugeordnet ist oder ihrer Waffenklasse (#2287) - ohne beides zu keiner (Obmann, 03.11.).
 * `weapon`: der Eintrag der Waffe (mit `subcategory`) oder nur ihre Kennung.
 */
export function fitsWeapon(attachment, weapon) {
  const id = typeof weapon === "string" ? weapon : weapon?.id;
  if (id && (attachment?.weapon_ids || []).includes(id)) return true;
  const klass = typeof weapon === "string" ? null : weapon?.subcategory;
  return Boolean(klass && (attachment?.weapon_class_ids || []).includes(klass));
}

/** Ohne Waffe und ohne Waffenklasse passt ein Aufsatz zu keiner. */
export function fitsNothing(attachment) {
  return !(attachment?.weapon_ids || []).length && !(attachment?.weapon_class_ids || []).length;
}

/** Die Waffenklassen eines Spiels: Unterkategorien aller Kategorien der Art Waffe, mit dem Namen der Kategorie. */
export function weaponClasses(categories = []) {
  return categories.filter((row) => row.role === "weapon")
    .flatMap((category) => (category.subcategories || []).map((sub) => ({ ...sub, category: category.key, category_label: category.label })));
}

/**
 * Die Einträge einer Kategorie je Unterkategorie (#2287), in deren Reihenfolge. Einträge ohne (oder mit einer, die es nicht mehr gibt)
 * stehen zuerst in `sub: null` - die Gruppe gibt es nur, wenn sie Einträge hat oder die Kategorie keine Unterkategorien kennt.
 */
export function groupBySubcategory(items = [], category = {}) {
  const subs = category.subcategories || [];
  const known = new Set(subs.map((sub) => sub.key));
  const without = items.filter((item) => !item.subcategory || !known.has(item.subcategory));
  const groups = subs.map((sub) => ({ sub, items: items.filter((item) => item.subcategory === sub.key) }));
  return [...(without.length || !subs.length ? [{ sub: null, items: without }] : []), ...groups];
}

export function subcategoryOf(categories = [], key) {
  if (!key) return null;
  for (const category of categories) {
    const found = (category.subcategories || []).find((sub) => sub.key === key);
    if (found) return { ...found, category: category.key, category_label: category.label };
  }
  return null;
}

/** Die Unterkategorien fürs Speichern: Kennung bleibt, Namen ohne Leerraum am Rand, leere Zeilen fallen weg. */
export function subcategoriesPayload(rows = []) {
  return rows.filter((row) => row.label.trim())
    .map((row) => ({ ...(row.key ? { key: row.key } : {}), label: row.label.trim(), icon_url: row.icon_url || null }));
}

export const subcategoriesProblem = (rows = []) => categoriesProblem(rows);

/** Was ein Vorschlag noch hinzufügt: die Gattungsbegriffe, die es (ohne Groß und klein) noch nicht gibt. */
export function missingSuggestions(rows = [], words = []) {
  const taken = new Set(rows.map((row) => nameKey(row.label)));
  return words.filter((word) => !taken.has(nameKey(word)));
}

/** Suchen über Namen: jedes Wort muss vorkommen. */
export function matchesSearch(item, search) {
  const words = nameKey(search).split(" ").filter(Boolean);
  const name = nameKey(item?.name);
  return words.every((word) => name.includes(word));
}

export function equipmentToForm(item) {
  return { category: item?.category || "", subcategory: item?.subcategory || "", name: item?.name || "", image_url: item?.image_url || "",
    note: item?.note || "", weapon_ids: [...(item?.weapon_ids || [])], weapon_class_ids: [...(item?.weapon_class_ids || [])] };
}

/** Was Anlegen bzw. Ändern schickt - Waffen und Waffenklassen nur bei Aufsätzen, die Kategorie nur beim Anlegen. */
export function equipmentPayload(form, role, { create = false } = {}) {
  const body = { name: form.name.trim(), image_url: form.image_url || null, note: form.note.trim() || null };
  if (create) body.category = form.category;
  body.subcategory = form.subcategory || null;
  if (role === "attachment") {
    body.weapon_ids = form.weapon_ids;
    body.weapon_class_ids = form.weapon_class_ids || [];
  }
  return body;
}

/** Die Kategorien fürs Speichern: Kennung bleibt, Namen ohne Leerraum am Rand, leere Zeilen fallen weg. */
export function categoriesPayload(rows = []) {
  return rows.filter((row) => row.label.trim()).map((row) => ({ ...(row.key ? { key: row.key } : {}), label: row.label.trim(), role: row.role }));
}

export function categoriesProblem(rows = []) {
  const seen = new Set();
  for (const row of rows) {
    const key = nameKey(row.label);
    if (!key) continue;
    if (seen.has(key)) return `„${row.label.trim()}“ steht zweimal in der Liste.`;
    seen.add(key);
  }
  return "";
}

export function modesText(entry) {
  return (entry?.mode_labels || []).join(", ") || ALL_MODES;
}

/** Schlüssel einer Zeile im Formular: Art und Eintrag, bei einer ganzen Klasse (#2287) Art und Unterkategorie. */
export function rowKey(kind, id) {
  return `${kind}:${id}`;
}

/**
 * Die gespeicherte Liste als Formular: je Zeile Art, Eintrag (bzw. Unterkategorie), Modi und Aufsätze. Was nicht mehr wählbar ist
 * (archiviert oder nicht mehr in der Bibliothek, Unterkategorie entfernt, Modus nicht mehr im Spiel), fällt heraus und steht in
 * `dropped` - der Server nähme es nicht mehr an.
 */
export function listToForm(list, library = [], modes = [], categories = []) {
  const known = new Map(library.map((item) => [item.id, item]));
  // Ein schon gesetzter Modus bleibt, auch inaktiv oder archiviert - nur einer, den das Spiel nicht mehr hat, fällt weg.
  const modeKeys = new Set(modes.map((mode) => mode.mode));
  const rows = {};
  const dropped = [];
  for (const entry of list?.entries || []) {
    if (entry.kind === "class") {
      if (!subcategoryOf(categories, entry.subcategory)) {
        dropped.push(entry.name);
        continue;
      }
      rows[rowKey("class", entry.subcategory)] = { kind: "class", subcategory: entry.subcategory, modes: (entry.modes || []).filter((mode) => modeKeys.has(mode)),
        attachment_ids: [] };
      continue;
    }
    if (!known.has(entry.item_id)) {
      dropped.push(entry.name);
      continue;
    }
    const attachments = (entry.attachments || []).filter((item) => {
      if (known.has(item.item_id)) return true;
      dropped.push(item.name);
      return false;
    });
    if (entry.kind === "attachments" && !attachments.length) continue;
    const kept = (entry.modes || []).filter((mode) => modeKeys.has(mode));
    const row = { kind: entry.kind, item_id: entry.item_id, modes: kept, attachment_ids: attachments.map((item) => item.item_id) };
    if (entry.kind === "attachments") {
      // Modi je Aufsatz (#2299): im Formular trägt jeder Aufsatz die Modi, die für ihn gelten - eigene, sonst die der Zeile.
      const own = Object.fromEntries(attachments
        .map((item) => [item.item_id, (item.modes?.length ? item.modes : kept).filter((mode) => modeKeys.has(mode))])
        .filter(([, modes]) => modes.length));
      row.modes = [];
      if (Object.keys(own).length) row.attachment_modes = own;
    }
    rows[rowKey(entry.kind, entry.item_id)] = row;
  }
  return { rows, dropped: [...new Set(dropped)] };
}

/** Die Modi, in denen ein Aufsatz an der Waffe gesperrt ist (#2299) - leer heißt alle. */
export function attachmentModes(row, id) {
  return row?.attachment_modes?.[id] || row?.modes || [];
}

/** Die Zeile einer Waffe für die Anfrage: gleiche Modi bei allen Aufsätzen als Modi der Zeile (wie bisher), sonst je Aufsatz. */
function attachmentsPayload(row) {
  const effective = row.attachment_ids.map((id) => attachmentModes(row, id));
  const key = (modes) => [...modes].sort().join("|");
  if (effective.every((modes) => key(modes) === key(effective[0]))) {
    return { item_id: row.item_id, kind: "attachments", modes: [...effective[0]], attachment_ids: row.attachment_ids };
  }
  const own = Object.fromEntries(row.attachment_ids.map((id, index) => [id, effective[index]]).filter(([, modes]) => modes.length));
  return { item_id: row.item_id, kind: "attachments", modes: [], attachment_ids: row.attachment_ids, attachment_modes: own };
}

const KIND_ORDER = { class: 0, item: 1, attachments: 2 };
const isActiveRow = (row) => row.kind !== "attachments" || row.attachment_ids.length;

/** Das Formular als Anfrage - Klassen, dann ganze Einträge, dann Aufsätze, je in der Reihenfolge der Bibliothek. */
export function formPayload(rows, library = [], categories = []) {
  const order = new Map(library.map((item, index) => [item.id, index]));
  const subOrder = new Map(categories.flatMap((category) => (category.subcategories || []).map((sub) => sub.key)).map((key, index) => [key, index]));
  const position = (row) => (row.kind === "class" ? subOrder.get(row.subcategory) : order.get(row.item_id)) ?? 0;
  return Object.values(rows)
    .filter(isActiveRow)
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || position(a) - position(b))
    .map((row) => {
      if (row.kind === "class") return { kind: "class", subcategory: row.subcategory, modes: row.modes, attachment_ids: [] };
      if (row.kind === "attachments") return attachmentsPayload(row);
      return { item_id: row.item_id, kind: row.kind, modes: row.modes, attachment_ids: [] };
    });
}

/** Gleiche Zeilen (Art, Eintrag bzw. Klasse, Modi, Aufsätze mit ihren Modi) - für „nichts geändert“. */
export function sameRows(a = {}, b = {}) {
  const attached = (row) => [...row.attachment_ids].sort()
    .map((id) => (row.kind === "attachments" ? `${id}:${[...attachmentModes(row, id)].sort().join(",")}` : id));
  const norm = (rows) => JSON.stringify(Object.values(rows)
    .filter(isActiveRow)
    .map((row) => [row.kind, row.kind === "class" ? row.subcategory : row.item_id, row.kind === "attachments" ? [] : [...row.modes].sort(),
      attached(row)]).sort());
  return norm(a) === norm(b);
}

// ---------------------------------------------------------------- Aufsätze je Waffe in der Verwaltung (#2299)

/**
 * Die passenden Aufsätze einer Waffe je Slot (Unterkategorie einer Kategorie der Art Aufsatz), in der Reihenfolge der Bibliothek, ohne
 * Slot zuerst. `attachments`: die Einträge, die schon zur Waffe passen.
 */
export function attachmentSlots(attachments = [], categories = []) {
  const slots = [];
  for (const category of categories.filter((row) => row.role === "attachment")) {
    for (const { sub, items } of groupBySubcategory(attachments.filter((item) => item.category === category.key), category)) {
      if (items.length) slots.push({ key: `${category.key}:${sub?.key || ""}`, label: sub?.label || null, icon_url: sub?.icon_url || null, items });
    }
  }
  return slots;
}

const fullyBanned = (rows, item) => (rows[rowKey("item", item.id)] && !rows[rowKey("item", item.id)].modes.length)
  || (item.subcategory && rows[rowKey("class", item.subcategory)] && !rows[rowKey("class", item.subcategory)].modes.length);

/**
 * „K gesperrt“ am Knopf einer Waffe in der Verwaltung: die passenden Aufsätze, die aufgeklappt als gesperrt angehakt sind - an dieser Waffe
 * (auch nur in Modi) oder überall in allen Modi über die Zeile des Aufsatzes bzw. seine ganz gesperrte Klasse (wie `AttachmentLine`).
 */
export function bannedAttachmentCount(rows = {}, weaponId, attachments = []) {
  const local = new Set(rows[rowKey("attachments", weaponId)]?.attachment_ids || []);
  return attachments.filter((item) => local.has(item.id) || Boolean(fullyBanned(rows, item))).length;
}

/**
 * „Für alle <Waffenklasse> übernehmen“: jede andere aktive Waffe derselben Klasse sperrt danach dieselben Aufsätze mit denselben Modi -
 * soweit sie zu ihr passen und dort neu sperrbar sind (inaktive nur, wo sie schon standen). Ganz gesperrte Waffen bleiben, wie sie sind.
 * Gibt die neuen Zeilen und die Zahl der Waffen zurück.
 */
export function copyAttachmentsToClass(rows, saved, weaponId, library = []) {
  const weapon = library.find((item) => item.id === weaponId);
  const source = rows[rowKey("attachments", weaponId)];
  if (!weapon?.subcategory) return { rows, count: 0 };
  const byId = new Map(library.map((item) => [item.id, item]));
  const next = { ...rows };
  let count = 0;
  for (const other of library) {
    if (other.id === weaponId || other.category !== weapon.category || other.subcategory !== weapon.subcategory) continue;
    const key = rowKey("attachments", other.id);
    // Archiviert, ganz gesperrt oder inaktiv ohne eigene Zeile: der Server nähme dort keine (neue) Aufsatz-Zeile an.
    if (statusOf(other) === "archived" || fullyBanned(rows, other) || (statusOf(other) === "inactive" && !saved?.[key])) continue;
    const kept = new Set(saved?.[key]?.attachment_ids || []);
    const ids = (source?.attachment_ids || []).filter((id) => {
      const attachment = byId.get(id);
      return attachment && fitsWeapon(attachment, other) && (statusOf(attachment) === "active" || kept.has(id));
    });
    if (ids.length) {
      const own = Object.fromEntries(ids.map((id) => [id, attachmentModes(source, id)]).filter(([, modes]) => modes.length));
      next[key] = { kind: "attachments", item_id: other.id, modes: [], attachment_ids: ids, ...(Object.keys(own).length ? { attachment_modes: own } : {}) };
    } else delete next[key];
    count += 1;
  }
  return { rows: next, count };
}

/**
 * „Aufsatz an allen Waffen sperren“: der Aufsatz selbst kommt auf die Liste (Zeile `item`) mit den Modi, die an dieser Waffe gelten. In
 * allen Modi gesperrt, fällt er aus den Zeilen der einzelnen Waffen (dort braucht es ihn nicht mehr).
 */
export function banAttachmentEverywhere(rows, attachmentId, modes = []) {
  const key = rowKey("item", attachmentId);
  const next = { ...rows, [key]: { kind: "item", item_id: attachmentId, modes: rows[key] ? mergeModes(rows[key].modes, modes) : [...modes], attachment_ids: [] } };
  if (next[key].modes.length) return next;
  for (const [rowId, row] of Object.entries(next)) {
    if (row.kind !== "attachments" || !row.attachment_ids.includes(attachmentId)) continue;
    const rest = row.attachment_ids.filter((id) => id !== attachmentId);
    if (!rest.length) delete next[rowId];
    else {
      const own = { ...(row.attachment_modes || {}) };
      delete own[attachmentId];
      next[rowId] = { ...row, attachment_ids: rest, attachment_modes: own };
    }
  }
  return next;
}

/** Ist die Klasse (Unterkategorie) in allen Modi ganz gesperrt? Dann braucht es keine Einzelzeile darin. */
export function classRow(rows, subcategory) {
  return subcategory ? rows[rowKey("class", subcategory)] || null : null;
}

/** Probleme vor dem Speichern, wie der Server sie sähe - leer heißt gut. */
export function formProblem(rows, library = [], categories = []) {
  const items = new Map(library.map((item) => [item.id, item]));
  const active = Object.values(rows).filter(isActiveRow);
  if (!active.length) return "Bitte mindestens einen Eintrag sperren – oder die Sperrliste entfernen.";
  for (const row of active) {
    if (row.kind === "class") continue;
    const item = items.get(row.item_id);
    const klass = classRow(rows, item?.subcategory);
    if (klass && !klass.modes.length) {
      const label = subcategoryOf(categories, item.subcategory)?.label || "Die Klasse";
      return `„${item.name}“ gehört zu „${label}“, die schon in allen Modi ganz gesperrt ist – einzeln braucht es das nicht.`;
    }
    if (row.kind !== "attachments") continue;
    const full = rows[rowKey("item", row.item_id)];
    if (full && !full.modes.length) return `„${item?.name || "Die Waffe"}“ ist schon in allen Modi gesperrt – einzelne Aufsätze dazu braucht es nicht.`;
  }
  return "";
}

function mergeModes(a, b) {
  if (!a.length || !b.length) return [];
  return [...a, ...b.filter((mode) => !a.includes(mode))];
}

/**
 * Die öffentliche Liste gruppiert (#2287): je Kategorie die Abschnitte - ohne Unterkategorie zuerst, dann je Unterkategorie in der
 * Reihenfolge der Liste. Eine ganz gesperrte Klasse (`all`) zeigt ihre Einträge (`items`, vom Server: die von heute) mit den Modi der
 * Klasse; ist ein Eintrag zusätzlich einzeln gesperrt, gelten beide. Leere Klassen entfallen. Danach die Aufsätze an erlaubten Waffen.
 */
export function publicGroups(list) {
  const entries = list?.entries || [];
  const categories = [];
  for (const entry of entries.filter((row) => row.kind !== "attachments")) {
    const label = entry.category_label || "Ausrüstung";
    let category = categories.find((row) => row.label === label);
    if (!category) {
      category = { label, sections: [] };
      categories.push(category);
    }
    const key = entry.subcategory || "";
    let section = category.sections.find((row) => row.key === key);
    if (!section) {
      section = { key, label: key ? entry.subcategory_label : null, icon_url: null, all: false, mode_labels: [], entries: [] };
      category.sections.push(section);
    }
    section.icon_url = section.icon_url || (entry.kind === "class" ? entry.image_url : entry.subcategory_icon_url) || null;
    const modes = entry.mode_labels || [];
    const add = (item) => {
      const known = section.entries.find((row) => (row.item_id || row.name) === (item.item_id || item.name));
      if (known) known.mode_labels = mergeModes(known.mode_labels, modes);
      else section.entries.push({ item_id: item.item_id, name: item.name, image_url: item.image_url, mode_labels: [...modes] });
    };
    if (entry.kind === "class") {
      section.all = true;
      section.mode_labels = [...modes];
      (entry.items || []).forEach(add);
    } else add(entry);
  }
  for (const category of categories) {
    category.sections = category.sections.filter((section) => section.entries.length);
    for (const section of category.sections) section.entries.sort((a, b) => nameKey(a.name).localeCompare(nameKey(b.name), "de"));
    category.sections.sort((a, b) => (a.key ? 1 : 0) - (b.key ? 1 : 0));
    category.count = category.sections.reduce((sum, section) => sum + section.entries.length, 0);
  }
  return { categories: categories.filter((category) => category.sections.length), weapons: entries.filter((row) => row.kind === "attachments") };
}

// ---------------------------------------------------------------- Erlaubte Ausrüstung (#2287, Fabian Nr. 99)
// Der Server liefert sie fertig (`allowed_equipment`, dieselbe Form wie der Baustein im Regelwerk) - hier nur die Texte, wie im Regelwerk.

function weaponText(weapon) {
  return weapon?.modes?.length ? `${weapon.name} (in ${weapon.modes.join(", ")})` : weapon?.name || "";
}

/** Der Modus-Hinweis (#2298): „nur in …“, wenn der Server `only_in` setzt (mehr Modi der Season gesperrt als erlaubt), sonst „nicht in …“. */
export function modesNote(entry) {
  if (entry?.only_in?.length) return `nur in ${entry.only_in.join(", ")}`;
  return entry?.not_in?.length ? `nicht in ${entry.not_in.join(", ")}` : "";
}

/** Die Einschränkungen eines erlaubten Eintrags: „nicht in Suchen“ bzw. „nur in Suchen“, in älteren Fassungen „nicht an Blitz 9 (in Suchen)“. */
export function restrictionParts(entry) {
  const parts = [];
  if (modesNote(entry)) parts.push(modesNote(entry));
  if (entry?.not_at?.length) parts.push(`nicht an ${entry.not_at.map(weaponText).join(", ")}`);
  return parts;
}

/** Was die Karte selbst sagt - ohne die Einschränkung, die schon im Kopf der Unterkategorie steht. */
export function ownRestrictionParts(entry, section) {
  const sectionModes = section?.not_in || [];
  if (sectionModes.length && (entry?.not_in || []).join("|") === sectionModes.join("|")) return restrictionParts({ ...entry, not_in: [], only_in: [] });
  return restrictionParts(entry);
}

/** „Kompensator, Holo (nur in Suchen)“ - die Aufsätze, die an keiner Waffe erlaubt sind (Fabian, 04.11.); leer ohne solche. */
export function everywhereText(data) {
  return (data?.attachments_everywhere || []).map((row) => (modesNote(row) ? `${row.name} (${modesNote(row)})` : row.name)).join(", ");
}

/** „14 Aufsätze · 2 gesperrt“ (#2299) - die Zahl der passenden und davon an dieser Waffe gesperrten. */
export function attachmentsSummary(attachments) {
  const count = attachments?.count || 0;
  // Auch die, die an keiner Waffe erlaubt sind und darum oben in einer Zeile stehen (Fabian, 04.11.) - die Zahl bleibt ehrlich.
  const banned = (attachments?.banned?.length || 0) + (attachments?.banned_everywhere || 0);
  return `${countText(count, "Aufsatz", "Aufsätze")}${banned ? ` · ${banned} gesperrt` : ""}`;
}

export function allowedCount(category) {
  return (category?.sections || []).reduce((sum, section) => sum + (section.entries || []).length, 0);
}

/** Gilt ein Eintrag anders als seine ganz gesperrte Klasse? Dann nennt die Karte seine Modi. */
export function differsFromSection(entry, section) {
  const own = entry.mode_labels || [];
  const base = section?.all ? section.mode_labels || [] : [];
  return own.join("|") !== base.join("|");
}

export function countText(count, one, many) {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

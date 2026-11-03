// Ausrüstung und Sperrliste der Season (docs/LIGA.md, C.4 #2218): Logik ohne Oberfläche, damit Bibliothek, Editor der Season und die
// öffentliche Ansicht dasselbe rechnen. Alles ist erlaubt außer der Sperrliste - eine Zeile sperrt einen Eintrag ganz (`item`) oder an
// einer Waffe einzelne Aufsätze (`attachments`), je in allen Modi (leere Liste) oder in den genannten.

export const ROLE_LABELS = { weapon: "Waffe", attachment: "Aufsatz", item: "Ausrüstung" };
export const ROLE_HINTS = {
  weapon: "Kann Aufsätze haben; an ihr lassen sich einzelne Aufsätze sperren.",
  attachment: "Passt zu den gewählten Waffen – ohne Wahl zu jeder.",
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

/** Passt ein Aufsatz zu dieser Waffe? Ohne Zuordnung passt er zu jeder. */
export function fitsWeapon(attachment, weaponId) {
  const fits = attachment?.weapon_ids || [];
  return !fits.length || fits.includes(weaponId);
}

/** Suchen über Namen: jedes Wort muss vorkommen. */
export function matchesSearch(item, search) {
  const words = nameKey(search).split(" ").filter(Boolean);
  const name = nameKey(item?.name);
  return words.every((word) => name.includes(word));
}

export function equipmentToForm(item) {
  return { category: item?.category || "", name: item?.name || "", image_url: item?.image_url || "", note: item?.note || "",
    weapon_ids: [...(item?.weapon_ids || [])] };
}

/** Was Anlegen bzw. Ändern schickt - Waffen nur bei Aufsätzen, die Kategorie nur beim Anlegen. */
export function equipmentPayload(form, role, { create = false } = {}) {
  const body = { name: form.name.trim(), image_url: form.image_url || null, note: form.note.trim() || null };
  if (create) body.category = form.category;
  if (role === "attachment") body.weapon_ids = form.weapon_ids;
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

export function rowKey(kind, itemId) {
  return `${kind}:${itemId}`;
}

/**
 * Die gespeicherte Liste als Formular: je Zeile Art, Eintrag, Modi und Aufsätze. Was nicht mehr wählbar ist (archiviert oder nicht
 * mehr in der Bibliothek, Modus nicht mehr im Spiel), fällt heraus und steht in `dropped` - der Server nähme es nicht mehr an.
 */
export function listToForm(list, library = [], modes = []) {
  const known = new Map(library.map((item) => [item.id, item]));
  // Ein schon gesetzter Modus bleibt, auch inaktiv oder archiviert - nur einer, den das Spiel nicht mehr hat, fällt weg.
  const modeKeys = new Set(modes.map((mode) => mode.mode));
  const rows = {};
  const dropped = [];
  for (const entry of list?.entries || []) {
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
    rows[rowKey(entry.kind, entry.item_id)] = { kind: entry.kind, item_id: entry.item_id, modes: kept,
      attachment_ids: attachments.map((item) => item.item_id) };
  }
  return { rows, dropped: [...new Set(dropped)] };
}

/** Das Formular als Anfrage - in der Reihenfolge der Bibliothek, damit gleiche Listen gleich aussehen. */
export function formPayload(rows, library = []) {
  const order = new Map(library.map((item, index) => [item.id, index]));
  return Object.values(rows)
    .filter((row) => row.kind === "item" || row.attachment_ids.length)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "item" ? -1 : 1) || (order.get(a.item_id) ?? 0) - (order.get(b.item_id) ?? 0))
    .map((row) => ({ item_id: row.item_id, kind: row.kind, modes: row.modes, attachment_ids: row.kind === "attachments" ? row.attachment_ids : [] }));
}

/** Gleiche Zeilen (Art, Eintrag, Modi, Aufsätze) - für „nichts geändert“. */
export function sameRows(a = {}, b = {}) {
  const norm = (rows) => JSON.stringify(Object.values(rows)
    .filter((row) => row.kind === "item" || row.attachment_ids.length)
    .map((row) => [row.kind, row.item_id, [...row.modes].sort(), [...row.attachment_ids].sort()]).sort());
  return norm(a) === norm(b);
}

/** Probleme vor dem Speichern, wie der Server sie sähe - leer heißt gut. */
export function formProblem(rows, library = []) {
  const names = new Map(library.map((item) => [item.id, item.name]));
  const active = Object.values(rows).filter((row) => row.kind === "item" || row.attachment_ids.length);
  if (!active.length) return "Bitte mindestens einen Eintrag sperren – oder die Sperrliste entfernen.";
  for (const row of active) {
    if (row.kind !== "attachments") continue;
    const full = rows[rowKey("item", row.item_id)];
    if (full && !full.modes.length) return `„${names.get(row.item_id) || "Die Waffe"}“ ist schon in allen Modi gesperrt – einzelne Aufsätze dazu braucht es nicht.`;
  }
  return "";
}

/** Die öffentliche Liste nach Kategorien (ganz gesperrt) und die Aufsätze an erlaubten Waffen. */
export function publicGroups(list) {
  const entries = list?.entries || [];
  const groups = [];
  for (const entry of entries.filter((row) => row.kind !== "attachments")) {
    const label = entry.category_label || "Ausrüstung";
    let group = groups.find((row) => row.label === label);
    if (!group) {
      group = { label, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return { groups, weapons: entries.filter((row) => row.kind === "attachments") };
}

export function countText(count, one, many) {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

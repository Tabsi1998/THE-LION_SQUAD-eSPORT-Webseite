// Spielseite der Verwaltung (#2249): Reiter, Adresse und je Reiter Formular ↔ API. Jeder Reiter schickt nur seine eigenen
// Felder - so überschreibt „Allgemein speichern“ keine ungespeicherten Modi und umgekehrt. Ein neuer Reiter (etwa
// „Ausrüstung“ mit C.4) ist ein Eintrag in GAME_TABS und ein Panel in pages/admin/games/AdminGamePage.jsx.

export const GAME_TABS = [
  { key: "allgemein", label: "Allgemein" },
  { key: "ids", label: "Spiel-IDs" },
  { key: "modi", label: "Modi" },
  { key: "maps", label: "Maps" },
];

export const GAME_KIND_OPTIONS = [
  ["standalone", "Einzelspiel"],
  ["series", "Hauptspiel / Serie"],
  ["edition", "Spielversion / Saisonspiel"],
];

export function gameKindLabel(kind) {
  return GAME_KIND_OPTIONS.find(([key]) => key === (kind || "standalone"))?.[1] || "Einzelspiel";
}

/** Der Reiter aus der Sprungmarke (`#modi`); fehlt sie oder ist sie unbekannt, ist es der erste. */
export function tabFromHash(hash) {
  const key = String(hash || "").replace(/^#/, "").trim().toLowerCase();
  return GAME_TABS.some((tab) => tab.key === key) ? key : GAME_TABS[0].key;
}

/** Die Adresse der Spielseite, auf Wunsch gleich mit Reiter - für Links aus Liga, Pool-Editor und Hinweisen. */
export function gamePageUrl(gameId, tab = "") {
  const base = `/admin/games/${encodeURIComponent(gameId || "")}`;
  return tab && tab !== GAME_TABS[0].key ? `${base}#${tab}` : base;
}

export function slugFrom(txt) {
  return (txt || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export const fieldKeyFrom = (txt) => slugFrom(txt).replace(/-/g, "_");

const text = (value) => (value === null || value === undefined ? "" : String(value));
const trimmedOrNull = (value) => text(value).trim() || null;

export const emptyNewGame = { name: "", kind: "standalone", parent_game_id: "" };

/** Schnell anlegen (#2249): Name und Art, bei einer Spielversion das Hauptspiel. Alles andere auf der Spielseite. */
export function newGamePayload(form) {
  const isEdition = form?.kind === "edition";
  const name = text(form?.name).trim();
  return { name, slug: slugFrom(name), kind: form?.kind || "standalone", parent_game_id: isEdition ? (form.parent_game_id || null) : null };
}

/** Reiter Allgemein: Name, Adresse, Art, Hauptspiel, Kurzname, Bilder, Discord. */
export function generalToForm(game) {
  return {
    name: text(game?.name),
    slug: text(game?.slug),
    kind: game?.kind || "standalone",
    parent_game_id: text(game?.parent_game_id),
    short_name: text(game?.short_name),
    logo_url: text(game?.logo_url),
    cover_url: text(game?.cover_url),
    discord_guild_id: text(game?.discord_guild_id),
    discord_role_name: text(game?.discord_role_name),
  };
}

export function generalPayload(form) {
  const isEdition = form.kind === "edition";
  return {
    name: text(form.name).trim(),
    slug: slugFrom(form.slug),
    kind: form.kind || "standalone",
    parent_game_id: isEdition ? (form.parent_game_id || null) : null,
    // Keine Spielversion mehr: die ID-Quelle gehört dann zu keinem Hauptspiel - wie bisher fällt sie mit weg.
    ...(isEdition ? {} : { identity_source_game_id: null }),
    short_name: form.short_name,
    logo_url: form.logo_url,
    cover_url: form.cover_url,
    discord_guild_id: form.discord_guild_id || null,
    // Spiel-Rolle im Discord (#629) je Hauptspiel; Spielversionen zählen fürs Hauptspiel.
    discord_role_name: isEdition ? null : trimmedOrNull(form.discord_role_name),
  };
}

function optionList(value) {
  const rows = Array.isArray(value) ? value : String(value || "").split(",");
  return rows.map((row) => String(row).trim()).filter(Boolean);
}

/**
 * Der Schlüssel eines ID-Felds. An einem gespeicherten hängen die IDs der Spieler (users.game_ids.<spiel>.<schlüssel>) - er
 * geht exakt so zurück, wie er gespeichert ist: nicht kanonisch („PSN-ID“), nichtlateinisch und auch leer (Altbestand). Ein
 * neues Feld (`_new`) bekommt einen aus der Bezeichnung - oder den Schlüssel eines eben entfernten Felds gleicher Bezeichnung
 * zurück (`_restoredKey`), damit dessen IDs nicht verloren gehen.
 */
export function idFieldKey(field) {
  if (!field?._new) return String(field?.key ?? "");
  if (field._restoredKey) return field._restoredKey;
  return fieldKeyFrom(String(field.key ?? "") || field.label || "");
}

// Was die Verwaltung pflegt; alles andere an einem Feld geht unverändert zurück (Codex-Prüfung #2249: Speichern ersetzt die
// ganze Liste). Nur die Hilfsfelder der Oberfläche fallen weg.
const ID_FIELD_OWN = ["key", "label", "help_text", "required", "pattern", "format_hint", "options", "unique_in_season"];
const ID_FIELD_UI = ["_new", "_keyTouched", "_restoredKey"];

const blankNew = (field) => field?._new && !String(field.label || "").trim() && !String(field.key || "").trim();

export function normalizePlayerIdFields(fields = []) {
  return (fields || [])
    .filter((field) => field && !blankNew(field))
    .map((field) => {
      const rest = Object.fromEntries(Object.entries(field).filter(([name]) => !ID_FIELD_OWN.includes(name) && !ID_FIELD_UI.includes(name)));
      return {
        key: idFieldKey(field),
        label: text(field.label).trim() || text(field.key).trim(),
        help_text: field.help_text || "",
        required: field.required !== false,
        // Spielberechtigung (#2204): Format, Beispiel, Auswahl - leer heißt „keine Vorgabe“.
        ...(String(field.pattern || "").trim() ? { pattern: String(field.pattern).trim() } : {}),
        ...(String(field.format_hint || "").trim() ? { format_hint: String(field.format_hint).trim() } : {}),
        ...(optionList(field.options).length ? { options: optionList(field.options) } : {}),
        ...(field.unique_in_season === false ? { unique_in_season: false } : {}),
        ...rest,
      };
    });
}

/**
 * Was vor dem Speichern der ID-Felder noch fehlt (Codex-Prüfung #2249) - leer, wenn alles passt. Geprüft werden nur neue
 * Felder: Sie brauchen eine Bezeichnung und einen Schlüssel, und keiner darf schon an einem anderen Feld stehen (aus „PSN-ID“ und
 * „PSN ID“ würde sonst zweimal „psn_id“). Gespeicherte Felder bleiben, wie sie sind - auch doppelt oder leer (Altbestand). Ein
 * ganz leeres neues Feld fällt still weg. Der Server prüft dasselbe (services/league_roster.id_key_problem).
 */
export function idFieldsProblem(fields = []) {
  const rows = (fields || []).map((field, index) => ({ field, index, key: idFieldKey(field), label: String(field?.label || "").trim() }))
    .filter(({ field }) => field && !blankNew(field));
  for (const { field, index, key, label } of rows) {
    if (!field._new) continue;
    if (!label) return `ID-Feld ${index + 1}: Bitte eine Bezeichnung eintragen.`;
    if (!key.trim()) {
      return `ID-Feld „${label}“: Aus der Bezeichnung entsteht kein Schlüssel – bitte unter „Schlüssel“ Buchstaben (a–z) oder Ziffern eintragen.`;
    }
    const other = rows.find((row) => row.index !== index && row.key === key && (!row.field._new || row.index < index));
    if (other) return `Der Schlüssel „${key}“ steht schon bei „${other.label || other.key}“ – bitte für „${label}“ einen anderen Schlüssel eintragen.`;
  }
  return "";
}

/** Ein eben entferntes, noch nicht gespeichertes Feld mit dieser Bezeichnung - ein neues Feld bekommt dann dessen Schlüssel. */
export function removedFieldFor(form, label) {
  const wanted = String(label || "").trim().toLowerCase();
  if (!wanted) return null;
  const inUse = new Set((form?.player_id_fields || []).filter((field) => !field._new).map((field) => String(field.key ?? "")));
  return (form?.removed_fields || []).find((row) => String(row.label || "").trim().toLowerCase() === wanted && !inUse.has(row.key)) || null;
}

/** Reiter Spiel-IDs: die ID-Felder, bei Spielversionen dazu woher die IDs kommen. */
export function idsToForm(game) {
  return {
    player_id_fields: (game?.player_id_fields || []).map((field) => ({ ...field })),
    identity_source_game_id: text(game?.identity_source_game_id),
    inherit_player_ids: game?.inherit_player_ids !== false,
  };
}

/**
 * Was an die API geht. Wurde ein Feld entfernt, unter dem schon IDs stehen, und hat die Person das in der Rückfrage bestätigt,
 * geht sein Schlüssel als `confirm_removed_keys` mit - sonst lehnt der Server mit 409 ab (#2249). Ein Schlüssel, der über ein
 * neues Feld gleicher Bezeichnung zurückkam, ist nicht entfernt.
 */
export function idsPayload(form, kind) {
  const fields = normalizePlayerIdFields(form.player_id_fields);
  const kept = new Set(fields.map((field) => field.key));
  const confirmed = (form.removed_fields || []).filter((row) => row.confirmed && row.key && !kept.has(row.key)).map((row) => row.key);
  const body = { player_id_fields: fields, ...(confirmed.length ? { confirm_removed_keys: confirmed } : {}) };
  if (kind !== "edition") return body;
  return { ...body, identity_source_game_id: form.identity_source_game_id || null, inherit_player_ids: form.inherit_player_ids !== false };
}
/** Gleicher Stand? Reicht für Formulare aus Text, Zahlen und Listen. */
export function sameForm(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Zeiten und freie Einstellungen je Spielmodus (#2271, docs/LIGA.md C.1): Eingabe „1:30“, „90 s“ oder „5“, gespeichert in Sekunden;
// Einstellungen mit Bezeichnung, Wert, Einheit und Gruppe. Dieselben Grenzen wie models.GameModeSetting im Backend.

export const TIME_LIMIT_SECONDS_MAX = 36000;
export const ROUND_TIME_SECONDS_MAX = 3600;
export const MODE_SETTINGS_MAX = 40;
export const SETTING_LABEL_MAX = 60;
export const SETTING_TEXT_MAX = 120;
export const SETTING_GROUP_MAX = 40;
export const MODE_RULES_TEXT_MAX = 1000;
export const SETTING_UNITS = [
  ["", "Text"],
  ["seconds", "Sekunden"],
  ["minutes", "Minuten"],
  ["points", "Punkte"],
  ["toggle", "An/aus"],
];
const SETTING_NUMBER_MAX = 1000000;

const blank = (value) => String(value ?? "").trim() === "";

/**
 * Eine Zeitangabe in Sekunden: „1:30“ (Minuten:Sekunden), „90 s“, „2 min“ oder eine Zahl in der Einheit `bare` („minutes“ oder
 * „seconds“), auch mit Komma („1,5“ Minuten = 90 s). Leer: `null`, unlesbar: `undefined`.
 */
export function parseDuration(value, bare = "minutes") {
  const text = String(value ?? "").trim().toLowerCase().replace(",", ".");
  if (!text) return null;
  const clock = text.match(/^(\d{1,4}):([0-5]\d)$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const unit = text.match(/^(\d+(?:\.\d+)?)\s*(s|sek|sek\.|sekunden|min|min\.|minuten|m)$/);
  if (unit) {
    const number = Number(unit[1]);
    return Math.round(unit[2].startsWith("s") ? number : number * 60);
  }
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.round(Number(text) * (bare === "seconds" ? 1 : 60));
  return undefined;
}

/** Sekunden für ein Eingabefeld: volle Minuten als Zahl („10“), sonst „1:30“. `bare = "seconds"`: kurze Zeiten als Sekunden („45“). */
export function durationInput(seconds, bare = "minutes") {
  if (seconds === null || seconds === undefined || seconds === "") return "";
  const total = Math.trunc(Number(seconds));
  if (!Number.isFinite(total)) return "";
  if (bare === "seconds" && total < 60) return String(total);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (!rest && bare !== "seconds") return String(minutes);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** Sekunden zum Lesen: „10 Min.“, „1:30 Min.“, „0:45 Min.“ - wie das Regelwerk (league_rule_blocks.duration). */
export function durationText(seconds) {
  const total = Math.trunc(Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${minutes}:${String(rest).padStart(2, "0")} Min.` : `${minutes} Min.`;
}

/** Das Zeitlimit je Map einer gespeicherten Regel in Sekunden - auch aus dem Altbestand in Minuten. */
export function ruleTimeLimitSeconds(rule) {
  const seconds = Number(rule?.time_limit_seconds);
  if (Number.isFinite(seconds) && seconds > 0) return Math.trunc(seconds);
  const minutes = Number(rule?.time_limit_minutes);
  return Number.isFinite(minutes) && minutes > 0 ? Math.trunc(minutes * 60) : null;
}

/** Der Wert einer Einstellung zum Lesen: „0:45 Min.“, „250 Punkte“, „an“. */
export function settingValueText(setting) {
  const value = setting?.value;
  if (setting?.unit === "toggle") return value ? "an" : "aus";
  if (setting?.unit === "seconds") return durationText(value);
  if (setting?.unit === "minutes") return `${String(value).replace(".", ",")} Min.`;
  if (setting?.unit === "points") return `${String(value).replace(".", ",")} Punkte`;
  return String(value ?? "");
}

/** Eine leere Formularzeile. */
export function emptySetting() {
  return { key: "", label: "", value: "", unit: "", group: "" };
}

/** Eine gespeicherte Einstellung als Formularzeile - Sekunden als „1:30“, an/aus als Wahrheitswert. */
export function settingToForm(setting) {
  const unit = setting?.unit || "";
  let value = setting?.value ?? "";
  if (unit === "seconds") value = durationInput(value, "seconds");
  else if (unit === "toggle") value = Boolean(value);
  else if (unit === "minutes" || unit === "points") value = String(value).replace(".", ",");
  else value = String(value);
  return { key: setting?.key || "", label: setting?.label || "", value, unit, group: setting?.group || "" };
}

function numberOf(value) {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return undefined;
  return Number(text);
}

/** Was an einer Zeile nicht passt - dieselben Sätze wie der Server. Leer, wenn alles passt. */
export function settingProblem(row) {
  const name = String(row.label || "").trim();
  if (!name) return "Jede Einstellung braucht eine Bezeichnung.";
  if (name.length > SETTING_LABEL_MAX) return `Einstellung „${name.slice(0, 20)}…“: Bezeichnung höchstens ${SETTING_LABEL_MAX} Zeichen.`;
  if (String(row.group || "").trim().length > SETTING_GROUP_MAX) return `Einstellung „${name}“: Gruppe höchstens ${SETTING_GROUP_MAX} Zeichen.`;
  if (row.unit === "toggle") return "";
  if (row.unit === "seconds") {
    const seconds = parseDuration(row.value, "seconds");
    if (seconds === null || seconds === undefined) return `Einstellung „${name}“: Zeit als Sekunden oder Minuten:Sekunden (z. B. 1:30).`;
    return seconds > SETTING_NUMBER_MAX ? `Einstellung „${name}“: Zahl zu groß.` : "";
  }
  if (row.unit === "minutes" || row.unit === "points") {
    const number = numberOf(row.value);
    if (number === undefined) return `Einstellung „${name}“: bitte eine Zahl angeben.`;
    return Math.abs(number) > SETTING_NUMBER_MAX ? `Einstellung „${name}“: Zahl zu groß.` : "";
  }
  const text = String(row.value ?? "").trim();
  if (!text) return `Einstellung „${name}“: bitte einen Wert angeben.`;
  return text.length > SETTING_TEXT_MAX ? `Einstellung „${name}“: Wert höchstens ${SETTING_TEXT_MAX} Zeichen.` : "";
}

/** Die Zeile für den Server - nur, was gesetzt ist; der Schlüssel bleibt, damit die Season vergleichen kann. */
export function settingPayload(row) {
  const out = { label: String(row.label || "").trim() };
  if (row.key) out.key = row.key;
  if (row.unit) out.unit = row.unit;
  if (row.unit === "toggle") out.value = Boolean(row.value);
  else if (row.unit === "seconds") out.value = parseDuration(row.value, "seconds");
  else if (row.unit === "minutes" || row.unit === "points") out.value = numberOf(row.value);
  else out.value = String(row.value ?? "").trim();
  const group = String(row.group || "").split(/\s+/).filter(Boolean).join(" ");
  if (group) out.group = group;
  return out;
}

/** Zeilen umsortieren: `index` um `delta` verschieben. */
export function moveRow(rows, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Ein Eintrag `{settings, rules_text}` als Formular. */
export function entryToForm(entry) {
  return { settings: (entry?.settings || []).map(settingToForm), rules_text: entry?.rules_text || "" };
}

/** Das Formular als Eintrag für den Server - `null`, wenn nichts eingetragen ist. */
export function entryPayload(form) {
  const settings = (form?.settings || []).filter((row) => !blank(row.label) || !blank(row.value)).map(settingPayload);
  const text = String(form?.rules_text || "").trim();
  if (!settings.length && !text) return null;
  return { settings, ...(text ? { rules_text: text } : {}) };
}

const comparable = (row) => JSON.stringify([row.label, row.value, row.unit || null, row.group || null]);

/** Je Schlüssel, wie die Season vom Spiel abweicht: „changed“ (anderer Wert), „added“ (nur in der Season). */
export function settingsDiff(season, game) {
  const theirs = Object.fromEntries((game?.settings || []).map((row) => [row.key, row]));
  const out = {};
  for (const row of season?.settings || []) {
    if (!theirs[row.key]) out[row.key] = "added";
    else if (comparable(row) !== comparable(theirs[row.key])) out[row.key] = "changed";
  }
  return out;
}

/** Was die Season gegenüber dem Spiel nicht hat (Schlüssel). */
export function settingsMissing(season, game) {
  const own = new Set((season?.settings || []).map((row) => row.key));
  return (game?.settings || []).filter((row) => !own.has(row.key));
}

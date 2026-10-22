// Ergebnis-Bild auslesen (#1756): die Antwort des Servers (POST …/results/image) als Zeilen des Ergebnis-Blatts. Gelesen
// und abgeglichen wird im Server (Tesseract, eigene Vorlage je Veranstalter-Layout) – hier wird nur übersetzt, und hier
// steht, welche Felder gelb sind, bis jemand sie prüft.
//
// Eine Zeile aus dem Bild trägt `ocr: {uncertain: [Feld], read: {Feld: gelesen}}`, solange etwas daran unsicher ist.
// Ändern eines gelben Felds nimmt die Markierung von diesem Feld, „Passt so“ von der ganzen Zeile. Übernommen wird erst,
// wenn keine Zeile mehr gelb ist – gespeichert hat der Server beim Lesen nichts.

import { formatRaceTime } from "@/lib/raceTime";
import { emptyRow, matchParticipant } from "@/lib/referenceResults";
import { cleanText } from "@/lib/resultPaste";

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
// Felder, die das Blatt zeigt – nur sie können gelb werden. Startplatz, Zeit und Abstand stehen unter „Mehr“ (#1927).
export const SHOWN_FIELDS = ["place", "start_number", "name", "team", "points", "grid", "time", "gap", "marks"];
// Felder des Rennens aus dem Kopf des Bilds (#1927): schnellste Runde (Fahrer, Zeit) und Fahrer des Tages.
export const RACE_FIELDS = ["fastest_lap_name", "fastest_lap_time", "driver_of_the_day"];
export const FIELD_LABELS = {
  place: "Platz", start_number: "Startnummer", name: "Name", team: "Team", points: "Punkte", marks: "Marken",
  grid: "Startplatz", time: "Zeit", gap: "Abstand", fastest_lap_name: "Schnellste Runde", fastest_lap_time: "Rundenzeit",
  driver_of_the_day: "Fahrer des Tages",
};
const OUT_MARKS = ["dnf", "dns", "dsq"];

const key = (value) => cleanText(value).toLowerCase();

/** Das erste Bild aus einem Einfüge-Ereignis (Strg+V) – oder `null`, wenn nur Text eingefügt wird. */
export function imageFromClipboard(event) {
  const data = event?.clipboardData;
  if (!data) return null;
  for (const file of Array.from(data.files || [])) {
    if (String(file.type || "").startsWith("image/")) return file;
  }
  for (const item of Array.from(data.items || [])) {
    if (item.kind === "file" && String(item.type || "").startsWith("image/")) {
      const file = item.getAsFile?.();
      if (file) return file;
    }
  }
  return null;
}

/** Vorab im Browser: Art und Größe. Liefert eine Meldung oder `null`. */
export function checkImageFile(file, maxMb = 50) {
  if (!file) return "Kein Bild gefunden.";
  if (file.type && !IMAGE_TYPES.includes(file.type)) return "Nur PNG, JPG oder WebP – etwa ein Screenshot.";
  if (file.size > maxMb * 1024 * 1024) return `Das Bild ist zu groß (höchstens ${maxMb} MB).`;
  return null;
}

function sameDriver(head, row) {
  if (!head) return false;
  if (head.participant_id) return head.participant_id === row.participant_id;
  return Boolean(key(head.name)) && key(head.name) === key(row.name);
}

/**
 * Die gelesenen Zeilen als Formularzeilen. Die Pole wird Marke an der Zeile ihres Fahrers; schnellste Runde und Fahrer
 * des Tages sind Felder des Rennens (`imageFormFields`). Ein Ausfall ohne Platz bleibt ohne Platz. Zeiten wie im Blatt
 * angezeigt (Komma, #1981). `points: false` - ein Lauf ohne Punkte (Qualifying ohne Wertung, Schema ohne Punkte):
 * gelesene Punkte gehen nie ins Blatt (#1981).
 */
export function imageToRows(result, participants = [], { points: withPoints = true } = {}) {
  const pole = result?.pole;
  return (result?.rows || []).map((row) => {
    const known = row.participant_id
      ? participants.find((person) => person.id === row.participant_id) || null
      : matchParticipant(row.name, participants);
    const marks = [...(row.marks || [])];
    const uncertain = (row.uncertain || []).filter((field) => SHOWN_FIELDS.includes(field) && (withPoints || field !== "points"));
    // Ohne gelesenen Platz setzt das Blatt die Reihenfolge ein – das ist geschätzt und bleibt gelb, bis jemand prüft.
    // Ein Ausfall (DNF, DNS, DSQ) hat keinen Platz.
    if (!row.place && !marks.some((mark) => OUT_MARKS.includes(mark)) && !uncertain.includes("place")) uncertain.push("place");
    // Die Pole wird Marke an der Zeile ihres Fahrers. Gelb nur, wenn unsicher ist, WER sie fuhr – eine unsichere Zeit
    // ändert die Marke nicht.
    if (sameDriver(pole, row)) {
      if (!marks.includes("pole")) marks.push("pole");
      if (pole.uncertain?.includes("name")) uncertain.push("marks");
    }
    return emptyRow({
      participant_id: known?.id || "",
      name: known?.name || row.name || "",
      team: row.team || "",
      place: row.place ? String(row.place) : "",
      no_place: !row.place && marks.some((mark) => OUT_MARKS.includes(mark)),
      marks,
      start_number: row.start_number || "",
      // Punkte aus dem Bild gelten als „laut Veranstalter“ und werden gegen den Schlüssel geprüft.
      points: !withPoints || row.points === null || row.points === undefined ? "" : String(row.points),
      grid: row.grid === null || row.grid === undefined ? "" : String(row.grid),
      time: formatRaceTime(row.time),
      gap: formatRaceTime(row.gap),
      color: row.color || "",
      from_image: true,
      // Was im Bild stand und was das Bild vorschlug (#2012): ändert jemand Name oder Team, geht die Lesung beim
      // Übernehmen mit und der Server lernt die Schreibweise (`formToPayload`).
      image_read: row.image || null,
      image_pick: { participant_id: known?.id || "", team: row.team || "" },
      ocr: uncertain.length ? { uncertain: [...new Set(uncertain)], read: row.read || {}, hint: row.hint || {} } : null,
    });
  });
}

// Welche gelben Felder des Rennens ein neuer Wert ersetzt (#1927): schnellste Runde (Fahrer und Zeit), Fahrer des Tages.
export const RACE_FIELD_GROUPS = {
  fastestLap: ["fastest_lap_name", "fastest_lap_time"],
  driverOfTheDay: ["driver_of_the_day"],
};

/**
 * Gelbe Felder des Rennens, wenn neue Werte kommen (ein Bild, eine eingefügte Liste): Markierungen der ersetzten
 * Felder (`replaced`, Schlüssel aus RACE_FIELDS) fallen weg, `fresh` kommt dazu, alle übrigen bleiben – ein Wert,
 * der stehen bleibt, ist so ungeprüft wie vorher.
 */
export function replaceRaceMarks(current, replaced = [], fresh = null) {
  const kept = afterEdit({ ocr: current || null }, replaced).ocr;
  const uncertain = [...new Set([...(kept?.uncertain || []), ...(fresh?.uncertain || [])])];
  if (!uncertain.length) return null;
  const keptRead = Object.fromEntries(Object.entries(kept?.read || {}).filter(([field]) => kept.uncertain.includes(field)));
  return { uncertain, read: { ...keptRead, ...(fresh?.read || {}) } };
}

/**
 * Kopf des Bilds als Felder des Rennens (#1927): `fastestLap {name, time}` und `driverOfTheDay` (Name), dazu `raceOcr`
 * mit den gelben Feldern (wie `ocr` an einer Zeile, Schlüssel aus RACE_FIELDS). Ohne Angabe im Bild bleibt, was im
 * Blatt steht – und mit ihm seine gelbe Markierung aus `current` (dem bisherigen `raceOcr`).
 */
export function imageFormFields(result, current = null) {
  const out = {};
  const uncertain = [];
  const read = {};
  const replaced = [];
  const flag = (field, head, part) => {
    if (!head?.uncertain?.includes(part)) return;
    uncertain.push(field);
    if (head.read) read[field] = head.read;
  };
  const lap = result?.fastest_lap;
  if (lap?.name || lap?.time) {
    out.fastestLap = { name: lap.name || "", time: formatRaceTime(lap.time) };
    replaced.push(...RACE_FIELD_GROUPS.fastestLap);
    flag("fastest_lap_name", lap, "name");
    flag("fastest_lap_time", lap, "time");
  }
  const dotd = result?.driver_of_the_day;
  if (dotd?.name) {
    out.driverOfTheDay = dotd.name;
    replaced.push(...RACE_FIELD_GROUPS.driverOfTheDay);
    flag("driver_of_the_day", dotd, "name");
  }
  out.raceOcr = replaceRaceMarks(current, replaced, uncertain.length ? { uncertain, read } : null);
  return out;
}

/** Wie viele Zeilen noch gelb sind. */
export function openImageRows(rows = []) {
  return rows.filter((row) => row.ocr?.uncertain?.length).length;
}

/** Was vor dem Übernehmen noch gelb ist: die Zeilen und – als eine weitere – die Felder des Rennens. */
export function openImageItems(form) {
  return openImageRows(form?.rows || []) + (form?.raceOcr?.uncertain?.length ? 1 : 0);
}

/** Ist dieses Feld der Zeile gelb? */
export function isUncertain(row, field) {
  return Boolean(row?.ocr?.uncertain?.includes(field));
}

/** Geänderte Felder sind geprüft: ihre gelbe Markierung fällt weg (Name auch, wenn nur die Kennung wechselt). */
export function afterEdit(row, changedFields) {
  if (!row.ocr) return row;
  const changed = new Set(changedFields);
  if (changed.has("participant_id")) changed.add("name");
  const uncertain = row.ocr.uncertain.filter((field) => !changed.has(field));
  return { ...row, ocr: uncertain.length ? { ...row.ocr, uncertain } : null };
}

/** „Passt so“: die ganze Zeile ist geprüft. */
export function confirmRow(row) {
  return { ...row, ocr: null };
}

// „Alle Namen bestätigen“ (#2018): vorbelegte gelbe Namen und Teams aus dem Bild (etwa „wie in Saison …“) auf einmal
// bestätigen – mit Rückgängig. Andere gelbe Felder (Platz, Zeit …) bleiben gelb.
export const NAME_FIELDS = ["name", "team"];
export const RACE_NAME_FIELDS = ["fastest_lap_name", "driver_of_the_day"];

const raceName = (form, field) => (field === "fastest_lap_name" ? form?.fastestLap?.name : form?.driverOfTheDay) || "";
const filled = (value) => String(value || "").trim() !== "";

/** Vorbelegte gelbe Namen bzw. Teams: je Zeile die Felder (`rows`: [Schlüssel, Felder]), die des Rennens (`race`) und
 * wie viele es zusammen sind (`count`). Nur Felder mit Wert – ein leeres gelbes Feld muss jemand ausfüllen. */
export function prefilledNames(form) {
  const rows = (form?.rows || [])
    .map((row) => [row.key, NAME_FIELDS.filter((field) => isUncertain(row, field) && filled(row[field]))])
    .filter(([, fields]) => fields.length);
  const race = RACE_NAME_FIELDS.filter((field) => form?.raceOcr?.uncertain?.includes(field) && filled(raceName(form, field)));
  return { rows, race, count: rows.reduce((sum, [, fields]) => sum + fields.length, 0) + race.length };
}

/** Alle vorbelegten gelben Namen und Teams bestätigen. Liefert das Formular und was „Rückgängig“ braucht (`undo`):
 * je Zeile die Markierung und die Werte von vorher. */
export function confirmNames(form) {
  const found = prefilledNames(form);
  const byKey = Object.fromEntries(found.rows);
  const undo = { count: found.count, rows: {}, race: null };
  const rows = (form?.rows || []).map((row) => {
    const fields = byKey[row.key];
    if (!fields) return row;
    undo.rows[row.key] = { ocr: row.ocr, values: Object.fromEntries(fields.map((field) => [field, row[field]])) };
    return afterEdit(row, fields);
  });
  let raceOcr = form?.raceOcr || null;
  if (found.race.length) {
    undo.race = { ocr: raceOcr, values: Object.fromEntries(found.race.map((field) => [field, raceName(form, field)])) };
    raceOcr = afterEdit({ ocr: raceOcr }, found.race).ocr;
  }
  return { form: { ...form, rows, raceOcr }, undo };
}

function restoreMarks(current, before, fields) {
  if (!fields.length) return current;
  const uncertain = [...new Set([...(current?.uncertain || []), ...fields])];
  const order = before?.uncertain || [];
  uncertain.sort((left, right) => (order.indexOf(left) + 1 || 99) - (order.indexOf(right) + 1 || 99));
  return { ...(before || {}), ...(current || {}), uncertain };
}

/** „Rückgängig“: die bestätigten Namen und Teams sind wieder gelb – nur, wo seitdem niemand den Wert geändert hat. */
export function undoConfirmNames(form, undo) {
  if (!undo) return form;
  const rows = (form?.rows || []).map((row) => {
    const entry = undo.rows[row.key];
    if (!entry) return row;
    const fields = Object.entries(entry.values).filter(([field, value]) => row[field] === value).map(([field]) => field);
    return fields.length ? { ...row, ocr: restoreMarks(row.ocr, entry.ocr, fields) } : row;
  });
  let raceOcr = form?.raceOcr || null;
  if (undo.race) {
    const fields = Object.entries(undo.race.values).filter(([field, value]) => raceName(form, field) === value).map(([field]) => field);
    raceOcr = restoreMarks(raceOcr, undo.race.ocr, fields);
  }
  return { ...form, rows, raceOcr };
}

/**
 * Kurztext der gelben Felder einer Zeile mit dem, was im Bild stand, und dem Hinweis des Servers (#2012):
 * „Name (gelesen „Emil Ek“, wie in Saison 1/2025), Team“.
 */
export function uncertainText(row) {
  return (row?.ocr?.uncertain || []).map((field) => {
    const read = row.ocr.read?.[field];
    const extra = [read ? `gelesen „${read}“` : "", row.ocr.hint?.[field] || ""].filter(Boolean).join(", ");
    return extra ? `${FIELD_LABELS[field] || field} (${extra})` : FIELD_LABELS[field] || field;
  }).join(", ");
}

/** Kopf des Bilds für die Übersicht: Strecke, schnellste Runde, Fahrer des Tages – je mit „unsicher“. */
export function imageHeader(result) {
  const out = [];
  if (result?.track?.name) out.push({ key: "track", label: "Strecke", value: result.track.name, uncertain: Boolean(result.track.uncertain?.length) });
  // Die Art ist nur ein Hinweis, bis es Läufe je Termin gibt (#1930).
  if (result?.session?.name) out.push({ key: "session", label: "Art", value: result.session.name, uncertain: false });
  if (result?.fastest_lap?.name || result?.fastest_lap?.time) {
    const lap = result.fastest_lap;
    out.push({ key: "fastest_lap", label: "Schnellste Rennrunde", value: [lap.name, formatRaceTime(lap.time)].filter(Boolean).join(" · "), uncertain: Boolean(lap.uncertain?.length) });
  }
  if (result?.pole?.name || result?.pole?.time) {
    const pole = result.pole;
    out.push({ key: "pole", label: "Pole", value: [pole.name, formatRaceTime(pole.time)].filter(Boolean).join(" · "), uncertain: Boolean(pole.uncertain?.length) });
  }
  if (result?.driver_of_the_day?.name) {
    out.push({ key: "driver_of_the_day", label: "Fahrer des Tages", value: result.driver_of_the_day.name, uncertain: Boolean(result.driver_of_the_day.uncertain?.length) });
  }
  return out;
}

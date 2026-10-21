// Ergebnis-Bild auslesen (#1756): die Antwort des Servers (POST …/results/image) als Zeilen des Ergebnis-Blatts. Gelesen
// und abgeglichen wird im Server (Tesseract, eigene Vorlage je Veranstalter-Layout) – hier wird nur übersetzt, und hier
// steht, welche Felder gelb sind, bis jemand sie prüft.
//
// Eine Zeile aus dem Bild trägt `ocr: {uncertain: [Feld], read: {Feld: gelesen}}`, solange etwas daran unsicher ist.
// Ändern eines gelben Felds nimmt die Markierung von diesem Feld, „Passt so“ von der ganzen Zeile. Übernommen wird erst,
// wenn keine Zeile mehr gelb ist – gespeichert hat der Server beim Lesen nichts.

import { emptyRow, matchParticipant } from "@/lib/referenceResults";
import { cleanText } from "@/lib/resultPaste";

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
// Felder, die das Blatt zeigt – nur sie können gelb werden. Startplatz, Zeit und Abstand liest der Server mit; sie
// gehen mit, sobald das Blatt sie hat (#1927), und kommen dann hier dazu.
export const SHOWN_FIELDS = ["place", "start_number", "name", "team", "marks"];
export const FIELD_LABELS = {
  place: "Platz", start_number: "Startnummer", name: "Name", team: "Team", marks: "Marken", grid: "Startplatz",
  time: "Zeit", gap: "Abstand",
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
 * Die gelesenen Zeilen als Formularzeilen. Die schnellste Runde wird zur Marke an der Zeile ihres Fahrers, der Fahrer
 * des Tages zum Feld `driver_of_the_day`. Ein Ausfall ohne Platz bleibt ohne Platz.
 */
export function imageToRows(result, participants = []) {
  const fastest = result?.fastest_lap;
  const dotd = result?.driver_of_the_day;
  return (result?.rows || []).map((row) => {
    const known = row.participant_id
      ? participants.find((person) => person.id === row.participant_id) || null
      : matchParticipant(row.name, participants);
    const marks = [...(row.marks || [])];
    const uncertain = (row.uncertain || []).filter((field) => SHOWN_FIELDS.includes(field));
    if (sameDriver(fastest, row)) {
      if (!marks.includes("fastest_lap")) marks.push("fastest_lap");
      // Gelb nur, wenn unsicher ist, WER die schnellste Runde fuhr – eine unsichere Zeit ändert die Marke nicht.
      if (fastest.uncertain?.includes("name")) uncertain.push("marks");
    }
    return emptyRow({
      participant_id: known?.id || "",
      name: known?.name || row.name || "",
      team: row.team || "",
      place: row.place ? String(row.place) : "",
      no_place: !row.place && marks.some((mark) => OUT_MARKS.includes(mark)),
      marks,
      start_number: row.start_number || "",
      grid: row.grid === null || row.grid === undefined ? "" : String(row.grid),
      time: row.time || "",
      gap: row.gap || "",
      driver_of_the_day: sameDriver(dotd, row),
      from_image: true,
      ocr: uncertain.length ? { uncertain: [...new Set(uncertain)], read: row.read || {} } : null,
    });
  });
}

/** Wie viele Zeilen noch gelb sind. */
export function openImageRows(rows = []) {
  return rows.filter((row) => row.ocr?.uncertain?.length).length;
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

/** Kurztext der gelben Felder einer Zeile mit dem, was im Bild stand: „Name (gelesen „Anna Prob3“), Team“. */
export function uncertainText(row) {
  return (row?.ocr?.uncertain || []).map((field) => {
    const read = row.ocr.read?.[field];
    return read ? `${FIELD_LABELS[field] || field} (gelesen „${read}“)` : FIELD_LABELS[field] || field;
  }).join(", ");
}

/** Kopf des Bilds für die Übersicht: Strecke, schnellste Runde, Fahrer des Tages – je mit „unsicher“. */
export function imageHeader(result) {
  const out = [];
  if (result?.track?.name) out.push({ key: "track", label: "Strecke", value: result.track.name, uncertain: Boolean(result.track.uncertain?.length) });
  if (result?.fastest_lap?.name || result?.fastest_lap?.time) {
    const lap = result.fastest_lap;
    out.push({ key: "fastest_lap", label: "Schnellste Rennrunde", value: [lap.name, lap.time].filter(Boolean).join(" · "), uncertain: Boolean(lap.uncertain?.length) });
  }
  if (result?.driver_of_the_day?.name) {
    out.push({ key: "driver_of_the_day", label: "Fahrer des Tages", value: result.driver_of_the_day.name, uncertain: Boolean(result.driver_of_the_day.uncertain?.length) });
  }
  return out;
}

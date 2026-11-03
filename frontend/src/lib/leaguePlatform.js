// Plattform je Season (docs/LIGA.md, B.3 „Plattform je Season“, #2270): nur Formular und Darstellung, geprüft wird im Server
// (services/league_platform.py). Die Plattformen sind die Auswahlwerte am Spiel - kein Titel steht hier.

export const INPUT_DEVICE_OPTIONS = [
  ["", "keine Angabe"],
  ["controller", "Controller"],
  ["mouse_keyboard", "Maus und Tastatur"],
  ["both", "Controller oder Maus und Tastatur"],
];

export const CROSSPLAY_OPTIONS = [["", "keine Angabe"], ["on", "an (plattformübergreifend)"], ["off", "aus"]];

const DEVICE_LABELS = Object.fromEntries(INPUT_DEVICE_OPTIONS.filter(([key]) => key));

/** „PC“, „PC und Xbox“, „PC, PlayStation und Xbox“ - wie der Server. */
export function platformWords(items = []) {
  const list = items.map(String);
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} und ${list[list.length - 1]}`;
}

function crossplayToForm(value) {
  if (value === true) return "on";
  if (value === false) return "off";
  return "";
}

function crossplayPayload(value) {
  if (value === "on") return true;
  if (value === "off") return false;
  return null;
}

/** Die gespeicherten Angaben der Season als Formular. */
export function platformToForm(settings = {}) {
  return {
    platform_field: settings.platform_field || "",
    allowed_platforms: [...(settings.allowed_platforms || [])],
    crossplay: crossplayToForm(settings.crossplay),
    input_device: settings.input_device || "",
  };
}

/** Das Formular für `PUT …/platform`: Plattformen in der Reihenfolge des Felds, leer heißt „keine Angabe“. */
export function platformPayload(form, options = []) {
  const picked = new Set(form.allowed_platforms || []);
  return {
    platform_field: form.platform_field || null,
    allowed_platforms: form.platform_field ? options.filter((value) => picked.has(value)) : [],
    crossplay: crossplayPayload(form.crossplay),
    input_device: form.input_device || null,
  };
}

/** Die Plattform-Abweichung einer Liga N als Teil des Liga-N-Formulars (`overridesToForm`). */
export function divisionPlatformToForm(overrides = {}) {
  return {
    platform_own: Array.isArray(overrides.allowed_platforms),
    allowed_platforms: [...(overrides.allowed_platforms || [])],
    crossplay: crossplayToForm(overrides.crossplay),
    input_device: overrides.input_device || "",
  };
}

/** Nur was Liga N anders macht - fehlt ein Schlüssel, gilt die Season. `allowed_platforms: []` heißt „alle erlaubt“. */
export function divisionPlatformPayload(form) {
  const out = {};
  if (form.platform_own) out.allowed_platforms = [...(form.allowed_platforms || [])];
  const crossplay = crossplayPayload(form.crossplay);
  if (crossplay !== null) out.crossplay = crossplay;
  if (form.input_device) out.input_device = form.input_device;
  return out;
}

/** Die Plattformen in Worten - „nur PC“ oder „alle Plattformen“. */
export function allowedText(allowed = []) {
  return allowed.length ? `nur ${platformWords(allowed)}` : "alle Plattformen";
}

/** Ein Satz je Angabe, für Kaderübersicht, Team-Seite und Anmeldung. Ohne Angabe: nichts. */
export function platformLines(platform) {
  if (!platform) return [];
  const lines = [];
  if (platform.allowed?.length) lines.push(`${platform.field_label || "Plattform"}: ${allowedText(platform.allowed)}.`);
  if (platform.crossplay === true) lines.push("Crossplay: an, plattformübergreifend.");
  if (platform.crossplay === false) lines.push("Crossplay: aus.");
  if (platform.input_device) lines.push(`Eingabegerät: ${DEVICE_LABELS[platform.input_device] || platform.input_device}.`);
  return lines;
}

/** Kurzfassung einer Liga N in der Übersicht des Kastens: „nur PC · Crossplay aus · Controller“. */
export function platformShort(view) {
  if (!view) return "";
  const parts = [allowedText(view.allowed || [])];
  if (view.crossplay === true) parts.push("Crossplay an");
  if (view.crossplay === false) parts.push("Crossplay aus");
  if (view.input_device) parts.push(DEVICE_LABELS[view.input_device] || view.input_device);
  return parts.join(" · ");
}

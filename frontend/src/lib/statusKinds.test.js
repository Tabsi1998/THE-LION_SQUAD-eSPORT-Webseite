import { readFileSync } from "node:fs";
import path from "node:path";
import { MATCH_STATUS_LABELS, REGISTRATION_STATUS_LABELS } from "./tournamentLabels";
import { ROLE_COLORS } from "./categoryColors";
import { OWN_STATUS_STATES, STATUS_KIND_ORDER, STATUS_KINDS, STATUS_STATES, STILL_STATES, isKnownStatus, statusKind, statusWord } from "./statusKinds";

// Zustands-Schilder (#1306): eine Tabelle für jeden Zustand. Dieser Test hält drei Stellen gleich - lib/statusKinds.js,
// docs/status-kinds.json (die App liest sie später, wie docs/category-colors.json) und das Aussehen in styles/system.css -
// und wacht darüber, dass jeder bekannte Zustand eine Art und ein Wort hat.

const root = process.cwd();
const read = (file) => readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const shared = JSON.parse(read("../docs/status-kinds.json"));
const system = read("src/styles/system.css");

test("docs/status-kinds.json nennt genau die Arten, Zustände und Du-Wörter der Website", () => {
  expect(Object.keys(shared.kinds)).toEqual(STATUS_KIND_ORDER);
  for (const [kind, info] of Object.entries(STATUS_KINDS)) {
    expect(shared.kinds[kind].label, kind).toBe(info.label);
    expect(shared.kinds[kind].icon, kind).toBe(info.icon);
    expect(Boolean(shared.kinds[kind].filled), kind).toBe(Boolean(info.filled));
    expect(Boolean(shared.kinds[kind].pulse), kind).toBe(Boolean(info.pulse));
  }
  expect(shared.states).toEqual(STATUS_STATES);
  expect(shared.own).toEqual(OWN_STATUS_STATES);
  expect(shared.still).toEqual(STILL_STATES);
});

test("zehn Arten; eine laufende Saison zeigt „Läuft“, der Punkt steht aber still (Fabian, 27.11.)", () => {
  expect(STATUS_KIND_ORDER).toHaveLength(10);
  expect(statusKind("active")).toMatchObject({ kind: "live", word: "Läuft", pulse: false });
  expect(statusKind("live")).toMatchObject({ kind: "live", pulse: true });
  expect(statusKind("busy")).toMatchObject({ kind: "live", pulse: true });
  expect(statusKind("free")).toMatchObject({ kind: "free", word: "Frei" });
  for (const state of STILL_STATES) expect(STATUS_STATES[state][0], state).toBe("live");
});

// ---------------------------------------------------------------- Aussehen: system.css = JSON

const CSS_ROLE = { muted: "text-muted" };

/** „ok“, „brand/0.55“, „white/0.88“, „onOk“, null → der Wert, der in system.css stehen muss. */
function cssColor(spec) {
  if (!spec) return "transparent";
  const [name, alpha] = spec.split("/");
  if (name === "onOk") return "var(--tls-on-ok)";
  if (name === "white") return alpha ? `rgb(255 255 255 / ${alpha})` : "rgb(255 255 255)";
  expect(Object.keys(ROLE_COLORS), `${spec}: keine Farb-Rolle`).toContain(name);
  const css = CSS_ROLE[name] || name;
  return alpha ? `rgb(var(--tls-${css}-rgb) / ${alpha})` : `var(--tls-${css})`;
}

function kindRule(kind) {
  const selector = `.tls-status-chip[data-kind="${kind}"] {`;
  const start = system.indexOf(selector);
  expect(start, `${selector} fehlt in system.css`).toBeGreaterThanOrEqual(0);
  return system.slice(start, system.indexOf("}", start));
}

test.each(STATUS_KIND_ORDER)("Art %s: Schrift, Fläche und Rahmen in system.css wie in der JSON-Datei", (kind) => {
  const spec = shared.kinds[kind];
  const css = kindRule(kind);
  expect(css).toContain(`--tls-chip-text: ${cssColor(spec.text)};`);
  expect(css).toContain(`--tls-chip-fill: ${cssColor(spec.fill)};`);
  expect(css).toContain(`--tls-chip-line: ${cssColor(spec.border)};`);
  if (spec.borderStyle === "dashed") expect(css).toContain("border-style: dashed;");
  else expect(css).not.toContain("border-style");
  expect(shared.colors.onOk).toBe(/--tls-on-ok: (#[0-9A-Fa-f]{6});/.exec(system)?.[1]);
});

test("gefüllt sind nur Anmeldung offen und Check-in offen; rot ist nur Läuft", () => {
  const filled = STATUS_KIND_ORDER.filter((kind) => shared.kinds[kind].fill && !shared.kinds[kind].fill.includes("/"));
  expect(filled).toEqual(["registration", "checkin"]);
  const red = STATUS_KIND_ORDER.filter((kind) => [shared.kinds[kind].text, shared.kinds[kind].fill, shared.kinds[kind].border].some((value) => value?.startsWith("live")));
  expect(red).toEqual(["live"]);
  // Gefüllt heißt dunkle Schrift: Weiß auf Grün hätte keine 4,5 : 1.
  expect(shared.kinds.registration.text).toBe("onOk");
  expect(shared.kinds.checkin.text).toBe("onOk");
});

test("das Schild: 12,5 px (mindestens 12 px), normal geschrieben, bricht nicht um", () => {
  const start = system.indexOf(".tls-status-chip {");
  const css = system.slice(start, system.indexOf("}", start));
  expect(/--tls-chip-size: ([\d.]+)rem;/.exec(system)?.[1]).toBe("0.78125");
  expect(css).toContain("font-size: var(--tls-chip-size);");
  expect(css).toContain("font-weight: 600;");
  expect(css).toContain("text-transform: none;");
  expect(css).toContain("white-space: nowrap;");
});

// ---------------------------------------------------------------- Abdeckung: jeder bekannte Zustand

/** Die Werte eines `Name = Literal[...]` aus backend/models.py. */
function literal(name) {
  const models = read("../backend/models.py");
  const start = models.search(new RegExp(`^${name}\\s*=\\s*Literal\\[`, "m"));
  expect(start, `${name} fehlt in backend/models.py`).toBeGreaterThanOrEqual(0);
  const body = models.slice(start, models.indexOf("]", start));
  return [...body.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
}

// Was StatusBadge und PhaseBadge auf main kannten (Stand e4158fb13, vor dem Umbau): beide Tabellen samt Rückfall-Wörtern.
const OLD_STATUS_BADGE = [
  "live", "active", "registration_open", "check_in", "checkin_open", "paused", "draft", "completed", "archived", "upcoming",
  "pending", "approved", "rejected", "waitlist", "checked_in", "no_show", "withdrawn", "disqualified", "disputed", "ready",
  "scheduled", "registration_closed", "results_published", "cancelled", "in_progress", "waiting_result", "forfeit", "free",
  "busy", "broken", "reserved",
];
const OLD_PHASE_BADGE = [
  "live", "day_break", "registration_open", "registration_pending", "registration_closed", "check_in", "announced", "draft",
  "paused", "completed", "results_published", "archived", "cancelled", "scheduled", "checkin_open",
];

test("jeder Zustand aus StatusBadge, PhaseBadge, Server und Aufrufern hat eine Art und ein Wort", () => {
  const phaseLabels = read("../backend/services/public_phase.py");
  const phaseStates = [...phaseLabels.slice(phaseLabels.indexOf("STATUS_LABELS = {"), phaseLabels.indexOf("}", phaseLabels.indexOf("STATUS_LABELS = {"))).matchAll(/"([a-z_]+)":/g)].map((match) => match[1]);
  expect(phaseStates.length).toBeGreaterThan(10);
  const models = read("../backend/models.py");
  const stationStates = [.../status: Optional\[Literal\[("free"[^\]]*)\]\]/.exec(models)[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  const registrationStates = [.../status: Optional\[Literal\[("pending", "approved"[^\]]*)\]/.exec(models)[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  const known = new Set([
    ...OLD_STATUS_BADGE,
    ...OLD_PHASE_BADGE,
    ...phaseStates,
    ...literal("EventStatus"),
    ...literal("TournamentStatus"),
    ...literal("MatchStatus"),
    ...literal("TournamentStageStatus"),
    ...literal("EventRegistrationStatus"),
    ...literal("LeagueSeasonStatus"),
    ...stationStates,
    ...registrationStates,
    ...Object.keys(MATCH_STATUS_LABELS),
    ...Object.keys(REGISTRATION_STATUS_LABELS),
    // Dashboard und Kalender: die eigene Anmeldung beim Event (registered) und alte Schreibweisen der App-Schnittstelle.
    "registered", "waitlisted", "declined",
    // TV: die Stationen-Übersicht kennt „in Benutzung“ (lib/tvStationGrid.js).
    "in_use",
  ]);
  const missing = [...known].filter((state) => !isKnownStatus(state));
  expect(missing).toEqual([]);
});

test("kein Wort ist ein Rohwert oder GROSS geschrieben", () => {
  for (const [state, [kind, word]] of [...Object.entries(STATUS_STATES), ...Object.entries(OWN_STATUS_STATES)]) {
    expect(STATUS_KIND_ORDER, state).toContain(kind);
    expect(word, state).not.toMatch(/_/);
    expect(word, state).not.toBe(word.toUpperCase());
    expect(word.length, state).toBeLessThanOrEqual(22);
  }
});

test("statusKind: Schreibweise egal, eigene Anmeldung in der Du-Form, Unbekanntes ohne Rohwert", () => {
  expect(statusKind("LIVE")).toEqual({ kind: "live", word: "Läuft", known: true, pulse: true });
  expect(statusKind("checked_in", { own: true })).toEqual({ kind: "joined", word: "Eingecheckt", known: true, pulse: false });
  expect(statusKind("approved", { own: true }).word).toBe("Du bist dabei");
  expect(statusKind("approved").word).toBe("Bestätigt");
  expect(statusKind("waitlist", { own: true }).word).toBe("Warteliste");
  expect(statusKind("cancelled", { own: true }).word).toBe("Abgemeldet");
  expect(statusKind("gibt_es_nicht")).toEqual({ kind: "waiting", word: "Unbekannt", known: false, pulse: false });
  expect(statusKind(null).known).toBe(false);
  // Die Beispiele aus dem Ticket.
  expect(statusKind("results_published")).toMatchObject({ kind: "done", word: "Ergebnisse da" });
  expect(statusKind("waitlist")).toMatchObject({ kind: "waiting", word: "Warteliste" });
  expect(statusKind("disputed")).toMatchObject({ kind: "problem", word: "Klärung" });
  expect(statusKind("broken")).toMatchObject({ kind: "problem", word: "Defekt" });
  expect(statusKind("busy")).toMatchObject({ kind: "live", word: "Belegt" });
  expect(statusWord("check_in")).toBe("Check-in offen");
});

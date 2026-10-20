import fs from "fs";
import path from "path";
import { PHASE_TONES, phaseTone } from "./phaseTone";

// Phase → Ton wie PhaseBadge im Web (#1869): Rot nur „läuft“, Grün offen, Cyan angekündigt, Violett Pause zwischen
// zwei Tagen, Grau vorbei. Der Test liest die Tabelle der Website (frontend/src/components/tls/PhaseBadge.jsx), damit
// beide Seiten nicht auseinanderlaufen.
const WEB = fs.readFileSync(path.join(__dirname, "../../../frontend/src/components/tls/PhaseBadge.jsx"), "utf8");

function webPhaseStyles(): Record<string, string> {
  const block = WEB.slice(WEB.indexOf("const PHASE_STYLES"), WEB.indexOf("};", WEB.indexOf("const PHASE_STYLES")));
  const rows: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const match = /^\s*([a-z_]+):\s*"([^"]+)"/.exec(line);
    if (match) rows[match[1]] = match[2];
  }
  return rows;
}

function toneOfWebClasses(classes: string) {
  if (classes.includes("text-live")) return "danger";
  if (classes.includes("bg-event")) return "event";
  if (classes.includes("text-ok")) return "success";
  if (classes.includes("text-brand")) return "cyan";
  return "default";
}

const web = webPhaseStyles();

test("die Tabelle der Website ist gelesen", () => {
  expect(Object.keys(web).length).toBeGreaterThanOrEqual(13);
  expect(Object.keys(PHASE_TONES).sort()).toEqual(Object.keys(web).sort());
});

test.each(Object.keys(web))("Phase %s hat denselben Ton wie im Web", (state) => {
  expect(phaseTone(state)).toBe(toneOfWebClasses(web[state]));
});

test.each([
  ["live", "danger"],
  ["day_break", "event"],
  ["registration_open", "success"],
  ["registration_pending", "cyan"],
  ["registration_closed", "default"],
  ["check_in", "success"],
  ["announced", "cyan"],
  ["draft", "default"],
  ["paused", "default"],
  ["completed", "default"],
  ["results_published", "default"],
  ["archived", "default"],
  ["cancelled", "default"],
])("Phase %s → %s", (state, tone) => {
  expect(phaseTone(state)).toBe(tone);
});

test("unbekannte Phase wie im Web: wie angekündigt", () => {
  expect(phaseTone("irgendwas")).toBe("cyan");
});

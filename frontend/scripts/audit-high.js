// Audit-Gate der Website: Laufzeit-Abhängigkeiten ab "high". Die Auswertung (kein stilles Grün, Ausnahmen mit
// Ablaufdatum und Begründung) liegt in scripts/dependency-audit-gate.cjs, #1055.
const { spawnSync } = require("child_process");
const { parseYarnAudit, runGate } = require("../../scripts/dependency-audit-gate.cjs");
const allowlist = require("./security-audit-allowlist.json");

const yarn = process.env.npm_execpath || "yarn";
const usesNodeShim = yarn.endsWith(".js");
const command = usesNodeShim ? process.execPath : yarn;
const args = usesNodeShim
  ? [yarn, "audit", "--groups", "dependencies", "--level", "high", "--json"]
  : ["audit", "--groups", "dependencies", "--level", "high", "--json"];

const result = spawnSync(command, args, {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  shell: process.platform === "win32" && !usesNodeShim,
});

process.exit(runGate({
  name: "Website-Audit (yarn, ab high)",
  threshold: "high",
  allowlist,
  parse: parseYarnAudit,
  result,
}));

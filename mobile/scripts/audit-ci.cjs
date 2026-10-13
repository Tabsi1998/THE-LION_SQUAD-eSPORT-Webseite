// Audit-Gate der App: alle Abhängigkeiten ab "moderate". Die Auswertung (kein stilles Grün, Ausnahmen mit
// Ablaufdatum und Begründung) liegt in scripts/dependency-audit-gate.cjs, #1055.
const { spawnSync } = require("child_process");
const { parseNpmAudit, runGate } = require("../../scripts/dependency-audit-gate.cjs");
const allowlist = require("./security-audit-allowlist.json");

const npmCli = process.env.npm_execpath;
const command = npmCli ? process.execPath : "npm";
const args = npmCli
  ? [npmCli, "audit", "--audit-level=moderate", "--json"]
  : ["audit", "--audit-level=moderate", "--json"];
const result = spawnSync(command, args, {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  shell: process.platform === "win32" && !npmCli,
});

process.exit(runGate({
  name: "App-Audit (npm, ab moderate)",
  threshold: "moderate",
  allowlist,
  parse: parseNpmAudit,
  result,
}));

const { spawnSync } = require("child_process");

const yarn = process.env.npm_execpath || "yarn";
const usesNodeShim = yarn.endsWith(".js");
const command = usesNodeShim ? process.execPath : yarn;
const args = usesNodeShim
  ? [yarn, "audit", "--groups", "dependencies", "--level", "high", "--json"]
  : ["audit", "--groups", "dependencies", "--level", "high", "--json"];

const result = spawnSync(command, args, {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: process.platform === "win32" && !usesNodeShim,
});

const lines = String(result.stdout || "").split(/\r?\n/).filter(Boolean);
const summaryLine = lines.find((line) => {
  try {
    return JSON.parse(line).type === "auditSummary";
  } catch {
    return false;
  }
});

if (!summaryLine) {
  process.stderr.write(result.stderr || "Could not read yarn audit summary.\n");
  process.exit(result.status || 1);
}

const summary = JSON.parse(summaryLine).data?.vulnerabilities || {};
const high = Number(summary.high || 0);
const critical = Number(summary.critical || 0);

if (high || critical) {
  process.stderr.write(`High/Critical dependency audit failed: high=${high}, critical=${critical}\n`);
  process.exit(1);
}

process.stdout.write(`Dependency audit gate passed: high=${high}, critical=${critical}\n`);

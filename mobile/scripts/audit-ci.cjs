const { spawnSync } = require("child_process");
const allowlist = require("./security-audit-allowlist.json");

const npmCli = process.env.npm_execpath;
const command = npmCli ? process.execPath : "npm";
const args = npmCli
  ? [npmCli, "audit", "--audit-level=moderate", "--json"]
  : ["audit", "--audit-level=moderate", "--json"];
const result = spawnSync(command, args, {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: process.platform === "win32" && !npmCli,
});

let report;
try {
  report = JSON.parse(String(result.stdout || ""));
} catch {
  process.stderr.write(result.stderr || "Could not read npm audit output.\n");
  process.exit(result.status || 1);
}

const vulnerabilities = report.vulnerabilities || {};
const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const relevant = Object.fromEntries(
  Object.entries(vulnerabilities).filter(([, item]) => severityRank[item.severity] >= severityRank.moderate),
);

function advisoryIdsFor(packageName, seen = new Set()) {
  if (seen.has(packageName)) return new Set();
  seen.add(packageName);
  const item = relevant[packageName];
  if (!item) return new Set();
  const ids = new Set();
  for (const source of item.via || []) {
    if (typeof source === "string") {
      for (const id of advisoryIdsFor(source, seen)) ids.add(id);
    } else if (source && source.url) {
      const match = String(source.url).match(/GHSA-[\w-]+/i);
      ids.add(match ? match[0].toUpperCase() : `source:${source.source || source.name}`);
    }
  }
  return ids;
}

const today = new Date().toISOString().slice(0, 10);
const advisories = new Map();
for (const [packageName, item] of Object.entries(relevant)) {
  for (const source of item.via || []) {
    if (!source || typeof source === "string") continue;
    const match = String(source.url || "").match(/GHSA-[\w-]+/i);
    const id = match ? match[0].toUpperCase() : `source:${source.source || packageName}`;
    advisories.set(id, { id, module: source.name || packageName, title: source.title || "Unknown advisory" });
  }
}

const accepted = [];
const blocking = [];
for (const advisory of advisories.values()) {
  const exception = allowlist[advisory.id];
  if (exception && exception.module === advisory.module && exception.expires >= today) accepted.push(advisory);
  else blocking.push(advisory);
}

const unexplained = [];
for (const packageName of Object.keys(relevant)) {
  if (!advisoryIdsFor(packageName).size) unexplained.push(packageName);
}

if (blocking.length || unexplained.length) {
  for (const advisory of blocking) {
    process.stderr.write(`[blocked] ${advisory.module}: ${advisory.id} ${advisory.title}\n`);
  }
  for (const packageName of unexplained) {
    process.stderr.write(`[blocked] ${packageName}: audit reported no traceable advisory\n`);
  }
  process.stderr.write("Mobile dependency audit failed: unaccepted moderate/high/critical findings remain.\n");
  process.exit(1);
}

for (const advisory of accepted) {
  process.stdout.write(`Accepted until ${allowlist[advisory.id].expires}: ${advisory.id} (${advisory.module})\n`);
}
process.stdout.write("Mobile dependency audit gate passed: no unaccepted moderate/high/critical advisories.\n");

const { spawnSync } = require("child_process");
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
  shell: process.platform === "win32" && !usesNodeShim,
});

const records = String(result.stdout || "")
  .split(/\r?\n/)
  .filter(Boolean)
  .flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
const advisories = records
  .filter((record) => record.type === "auditAdvisory")
  .map((record) => record.data?.advisory)
  .filter((advisory) => advisory && ["high", "critical"].includes(advisory.severity));

if (!records.length) {
  process.stderr.write(result.stderr || "Could not read yarn audit output.\n");
  process.exit(result.status || 1);
}

const today = new Date().toISOString().slice(0, 10);
const accepted = [];
const blocking = [];
for (const advisory of advisories) {
  const exception = allowlist[advisory.github_advisory_id];
  const validException = exception
    && exception.module === advisory.module_name
    && exception.expires >= today;
  if (validException) accepted.push(advisory);
  else blocking.push(advisory);
}

const unique = (items) => [...new Map(items.map((item) => [item.github_advisory_id || item.id, item])).values()];
const uniqueBlocking = unique(blocking);
const uniqueAccepted = unique(accepted);
if (uniqueBlocking.length) {
  for (const advisory of uniqueBlocking) {
    process.stderr.write(
      `[${advisory.severity}] ${advisory.module_name}: ${advisory.github_advisory_id || advisory.id} ${advisory.title}\n`,
    );
  }
  process.stderr.write(`High/Critical dependency audit failed: ${uniqueBlocking.length} unaccepted advisories.\n`);
  process.exit(1);
}

for (const advisory of uniqueAccepted) {
  process.stdout.write(
    `Accepted until ${allowlist[advisory.github_advisory_id].expires}: ${advisory.github_advisory_id} (${advisory.module_name})\n`,
  );
}
process.stdout.write("Dependency audit gate passed: no unaccepted high/critical advisories.\n");

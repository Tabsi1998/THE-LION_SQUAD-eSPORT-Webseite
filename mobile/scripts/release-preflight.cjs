#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const readText = (file) => fs.readFileSync(path.join(root, file), "utf8");

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const app = readJson("app.json");
const changelog = readText("CHANGELOG.md");
const releases = readText("RELEASES.md");

const expo = app.expo || {};
const android = expo.android || {};
const version = String(pkg.version || "").trim();
const appVersion = String(expo.version || "").trim();
const versionCode = android.versionCode;
const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : "";

check(/^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta)\.\d+)?$/.test(version), `Invalid mobile package version: ${version}`);
check(version === appVersion, `mobile/package.json version (${version}) must match mobile/app.json expo.version (${appVersion})`);
check(lock.version === version, `mobile/package-lock.json root version (${lock.version}) must match ${version}`);
check(lock.packages?.[""]?.version === version, `mobile/package-lock.json package entry version (${lock.packages?.[""]?.version}) must match ${version}`);
check(Number.isInteger(versionCode) && versionCode > 0, `expo.android.versionCode must be a positive integer, got ${versionCode}`);
check(expo.name === "LionsAPP", `expo.name must stay LionsAPP, got ${expo.name}`);
check(expo.slug === "lionsapp", `expo.slug must stay lionsapp, got ${expo.slug}`);
check(android.package === "at.lionsquad.app", `Android package must stay at.lionsquad.app, got ${android.package}`);

const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const changelogHeader = new RegExp(`^## ${escapedVersion} - \\d{4}-\\d{2}-\\d{2}\\s*$`, "m");
check(changelogHeader.test(changelog), `CHANGELOG.md must contain a dated section for ${version}`);

const sectionMatch = changelog.match(new RegExp(`^## ${escapedVersion} - \\d{4}-\\d{2}-\\d{2}\\s*\\n([\\s\\S]*?)(?=^## |\\s*$)`, "m"));
check(Boolean(sectionMatch && /(^|\n)- /.test(sectionMatch[1])), `CHANGELOG.md section for ${version} must contain bullet entries`);
check(releases.includes(version), `RELEASES.md historical list must contain ${version}`);

if (tag) {
  const baseTag = `mobile-v${version}`;
  const buildTag = `${baseTag}-build${versionCode}`;
  check(tag === baseTag || tag === buildTag, `Tag ${tag} must match ${baseTag} or ${buildTag}`);
}

if (version.includes("-alpha.")) {
  check(changelog.includes("alpha") || releases.includes("ALPHA"), "Alpha release metadata must mention alpha/ALPHA");
}

if (failures.length) {
  console.error("Mobile release preflight failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Mobile release preflight passed for ${version} (Android build ${versionCode}).`);

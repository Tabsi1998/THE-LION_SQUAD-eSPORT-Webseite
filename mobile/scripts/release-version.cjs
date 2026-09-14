// Versionen, Namen und Prüfungen für App-Releases.
//
// Schema seit September 2026 (#205): Vor 1.0.0 gibt es nur Betas
// (0.2.0-beta, 0.3.0-beta ...). Ab 1.0.0 gibt es Releases (1.2.3) und Betas
// dazwischen (1.2.3-beta).
//
// Android vergleicht beim Update nur den Build-Zähler versionCode. Der steigt
// immer weiter, auch wenn die sichtbare Version nach dem Neustart bei 0.x
// kleiner ist als die alten 1.x- und 2.x-Betas. Deshalb trägt jeder Tag den
// Build: mobile-v0.2.0-beta-build57.

const TAG_PREFIX = "mobile-v";

// Zertifikat des Upload-Schlüssels, mit dem alle bisherigen APKs signiert sind.
// Kein Geheimnis: Es steht in jeder .signature.txt eines Releases. Eine APK mit
// anderem Zertifikat lässt sich nicht über eine installierte App aktualisieren.
const EXPECTED_SIGNER_SHA256 = "0c5562d7e2f7d1bc214a3cb4b2ff0020aa0d1e7df46073739a96b8c8bbf197a1";

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-beta)?$/;

function parseVersion(version) {
  const match = VERSION_PATTERN.exec(String(version ?? "").trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    beta: Boolean(match[4]),
    core: `${match[1]}.${match[2]}.${match[3]}`,
  };
}

function versionProblems(version) {
  const parsed = parseVersion(version);
  if (!parsed) {
    return [`Version "${version}" passt nicht zum Schema: 0.2.0-beta, 1.2.3-beta oder 1.2.3.`];
  }
  if (parsed.major === 0 && !parsed.beta) {
    return [`Vor 1.0.0 gibt es nur Betas: "${version}-beta" statt "${version}".`];
  }
  return [];
}

function releaseChannel(version) {
  return parseVersion(version)?.beta ? "beta" : "stable";
}

function releaseTag(version, versionCode) {
  return `${TAG_PREFIX}${version}-build${versionCode}`;
}

function releaseName(version, versionCode) {
  return `LionsAPP v${version} (Build ${versionCode})`;
}

function apkName(version, versionCode, shortSha) {
  return `LionsAPP-v${version}-build${versionCode}-${shortSha}.apk`;
}

/** Höchster Build-Zähler aus den bisherigen App-Tags, alte wie neue. */
function highestBuild(tags) {
  let highest = 0;
  for (const tag of tags || []) {
    const match = /^mobile-v.+-build(\d+)$/.exec(String(tag).trim());
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest;
}

/** SHA-256 des Signaturzertifikats aus der Ausgabe von apksigner verify --print-certs. */
function signerDigest(signatureText) {
  const match = /(?:Signer #1|V\d+ Signer): certificate SHA-256 digest: ([0-9a-f]{64})/i.exec(signatureText || "");
  return match ? match[1].toLowerCase() : null;
}

function signerName(signatureText) {
  const match = /(?:Signer #1|V\d+ Signer): certificate DN: (.+)/.exec(signatureText || "");
  return match ? match[1].trim() : null;
}

function usesDebugCertificate(signatureText) {
  return /CN=Android Debug/.test(signatureText || "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Abschnitt einer Version aus CHANGELOG.md - genau diese Version, nicht 1.2.3 für 1.2.3-beta. */
function changelogSection(changelog, version) {
  const header = new RegExp(`^## ${escapeRegExp(version)} - \\d{4}-\\d{2}-\\d{2}\\s*$`);
  const lines = String(changelog || "").split(/\r?\n/);
  const start = lines.findIndex((line) => header.test(line));
  if (start < 0) return null;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    body.push(line);
  }
  return body.join("\n").trim();
}

function releaseNotes({ version, versionCode, apk, sha256, signatureText, changelog }) {
  const channel = releaseChannel(version);
  const section = changelogSection(changelog, version) || "- Keine Einträge im Changelog.";
  const install = channel === "beta"
    ? "Diese APK ist eine Beta-Testversion."
    : "Diese APK ist ein Release.";
  return [
    `# LionsAPP v${version}`,
    "",
    "| | |",
    "| --- | --- |",
    `| Kanal | ${channel === "beta" ? "Beta" : "Release"} |`,
    `| Android-Build | ${versionCode} |`,
    `| APK | \`${apk}\` |`,
    `| SHA-256 | \`${sha256}\` |`,
    `| Signiert von | \`${signerName(signatureText) || "unbekannt"}\` |`,
    `| Zertifikat SHA-256 | \`${signerDigest(signatureText) || "unbekannt"}\` |`,
    "",
    "## Änderungen",
    "",
    section,
    "",
    "## Installation",
    "",
    `${install} Außerhalb von Google Play kann Android Hinweise zu unbekannten Quellen oder Play Protect zeigen. Eine installierte LionsAPP lässt sich direkt aktualisieren, weil jede APK mit demselben Schlüssel signiert ist.`,
    "",
  ].join("\n");
}

module.exports = {
  EXPECTED_SIGNER_SHA256,
  TAG_PREFIX,
  apkName,
  changelogSection,
  highestBuild,
  parseVersion,
  releaseChannel,
  releaseName,
  releaseNotes,
  releaseTag,
  signerDigest,
  signerName,
  usesDebugCertificate,
  versionProblems,
};

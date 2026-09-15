import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import releaseVersion from "./release-version.cjs";

// Das Versionsschema der App (#205) und die Prüfungen, die vor einem Release
// laufen. Was hier kaputtgeht, merkt man sonst erst am Handy: eine APK, die
// sich nicht über die installierte App aktualisieren lässt.

const {
  EXPECTED_SIGNER_SHA256,
  PREVIOUS_SIGNER_SHA256,
  apkName,
  changelogSection,
  highestBuild,
  releaseChannel,
  releaseName,
  releaseNotes,
  releaseTag,
  signerDigest,
  signerName,
  usesDebugCertificate,
  versionProblems,
} = releaseVersion;

// Ausgabe von apksigner für Build 56, dem letzten Release mit dem alten Schlüssel.
const BUILD_56_SIGNATURE = [
  "V2 Signer: certificate DN: CN=THE LION SQUAD - eSPORTS, OU=Verein, O=THE LION SQUAD - eSPORTS, L=Telfs, ST=Tirol, C=AT",
  "V2 Signer: certificate SHA-256 digest: 0c5562d7e2f7d1bc214a3cb4b2ff0020aa0d1e7df46073739a96b8c8bbf197a1",
  "V2 Signer: certificate SHA-1 digest: 84aca40e417cab18d3e218f25b58fcdb04cdc073",
].join("\n");

// Dieselbe Angabe im Format, das apksigner aus den Build-Tools 36 schreibt.
const CURRENT_SIGNATURE = [
  "Signer #1 certificate DN: CN=THE LION SQUAD - eSPORTS, OU=Verein, O=THE LION SQUAD - eSPORTS, L=Telfs, ST=Tirol, C=AT",
  `Signer #1 certificate SHA-256 digest: ${EXPECTED_SIGNER_SHA256}`,
  "Signer #1 certificate SHA-1 digest: e2200d0061bc96eff6f798e84e547dc50f882922",
].join("\n");

test("das Schema nimmt 0.2.0-beta, 1.2.3-beta und 1.2.3", () => {
  for (const version of ["0.2.0-beta", "0.10.1-beta", "1.2.3-beta", "1.2.3", "10.0.0"]) {
    assert.deepEqual(versionProblems(version), [], version);
  }
});

test("vor 1.0.0 gibt es nur Betas, und alte Zählerformen gelten nicht mehr", () => {
  assert.match(versionProblems("0.2.0")[0], /nur Betas/);
  for (const version of ["1.2.3-beta.1", "2.0.0-alpha.1", "v1.2.3", "1.2", "01.2.3", "1.2.3-rc", ""]) {
    assert.equal(versionProblems(version).length, 1, version);
  }
});

test("Kanal, Tag, Release-Name und APK-Name", () => {
  assert.equal(releaseChannel("0.2.0-beta"), "beta");
  assert.equal(releaseChannel("1.0.0"), "stable");
  assert.equal(releaseTag("0.2.0-beta", 57), "mobile-v0.2.0-beta-build57");
  assert.equal(releaseName("0.2.0-beta", 57), "LionsAPP v0.2.0-beta (Build 57)");
  assert.equal(apkName("1.0.0", 80, "abc1234"), "LionsAPP-v1.0.0-build80-abc1234.apk");
});

test("der Build-Zähler kommt aus allen App-Tags, alten und neuen", () => {
  const tags = [
    "archive/2026-09-07/old-system",
    "mobile-v2.0.0-beta.2-build56",
    "mobile-v1.5.0-beta.9-build54",
    "mobile-v1.0.0-beta.1",
  ];
  assert.equal(highestBuild(tags), 56);
  // Nach dem Neustart ist die Version kleiner, der Zähler trotzdem der höchste.
  assert.equal(highestBuild([...tags, "mobile-v0.2.0-beta-build57"]), 57);
  assert.equal(highestBuild([]), 0);
});

test("Signaturangaben werden in beiden Formaten von apksigner gelesen", () => {
  assert.equal(signerDigest(BUILD_56_SIGNATURE), PREVIOUS_SIGNER_SHA256);
  assert.equal(signerDigest(CURRENT_SIGNATURE), EXPECTED_SIGNER_SHA256);
  assert.match(signerName(CURRENT_SIGNATURE), /^CN=THE LION SQUAD - eSPORTS/);
  assert.equal(usesDebugCertificate(BUILD_56_SIGNATURE), false);
  assert.equal(usesDebugCertificate("Signer #1 certificate DN: C=US, O=Android, CN=Android Debug"), true);
  assert.equal(signerDigest("keine Signatur"), null);
});

test("seit Build 57 gilt der neue Schlüssel, eine APK mit dem alten fällt auf", () => {
  // Der Wechsel ist bewusst (#205). Wer ihn rückgängig macht, soll es hier merken.
  assert.notEqual(EXPECTED_SIGNER_SHA256, PREVIOUS_SIGNER_SHA256);
  assert.notEqual(signerDigest(BUILD_56_SIGNATURE), EXPECTED_SIGNER_SHA256);
});

test("der Changelog-Abschnitt gehört genau zu seiner Version", () => {
  const changelog = [
    "# Changelog",
    "",
    "## 1.2.3 - 2027-01-02",
    "",
    "- Release",
    "",
    "## 1.2.3-beta - 2026-12-01",
    "",
    "- Beta",
  ].join("\n");
  assert.equal(changelogSection(changelog, "1.2.3"), "- Release");
  assert.equal(changelogSection(changelog, "1.2.3-beta"), "- Beta");
  assert.equal(changelogSection(changelog, "9.9.9"), null);
});

test("die Release-Notizen nennen Build, Prüfsumme, Zertifikat und Änderungen", () => {
  const notes = releaseNotes({
    version: "0.2.0-beta",
    versionCode: 57,
    apk: "LionsAPP-v0.2.0-beta-build57-abc1234.apk",
    sha256: "f".repeat(64),
    signatureText: CURRENT_SIGNATURE,
    changelog: "## 0.2.0-beta - 2026-09-15\n\n- Sticker im Chat\n",
  });
  assert.match(notes, /\| Android-Build \| 57 \|/);
  assert.match(notes, new RegExp(EXPECTED_SIGNER_SHA256));
  assert.match(notes, /- Sticker im Chat/);
  assert.doesNotMatch(notes, /undefined|null/);
});

test("die App im Repo erfüllt das Schema und zählt über Build 56 hinaus", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const app = JSON.parse(await readFile(new URL("../app.json", import.meta.url), "utf8"));
  assert.deepEqual(versionProblems(pkg.version), []);
  // Build 56 war das letzte Release vor dem Neustart bei 0.x (mobile-v2.0.0-beta.2-build56).
  assert.ok(app.expo.android.versionCode > 56, `versionCode ${app.expo.android.versionCode}`);
});

test("der Preflight besteht für den Stand im Repo und lehnt einen falschen Tag ab", () => {
  const preflight = fileURLToPath(new URL("./release-preflight.cjs", import.meta.url));
  const onBranch = spawnSync(process.execPath, [preflight], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "main" },
  });
  assert.equal(onBranch.status, 0, onBranch.stderr);

  const wrongTag = spawnSync(process.execPath, [preflight], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "mobile-v9.9.9-build1" },
  });
  assert.equal(wrongTag.status, 1);
  assert.match(wrongTag.stderr, /mobile-v9\.9\.9-build1/);
});

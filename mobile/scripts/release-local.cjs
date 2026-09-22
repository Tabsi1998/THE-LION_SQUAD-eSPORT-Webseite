#!/usr/bin/env node
/*
 * LionsAPP lokal bauen und als GitHub-Release veröffentlichen (#205).
 *
 *   npm run release:local -- --check     nur prüfen, was fehlt
 *   npm run release:local -- --dry-run   bauen und prüfen, nichts veröffentlichen
 *   npm run release:local                bauen, prüfen und das Release anlegen
 *   npm run release:local -- --upload-only  die zuletzt gebaute APK nur an den Vereinsserver schicken
 *   npm run release:local -- --aab       zusätzlich das App Bundle (.aab) für die Play Console bauen (#219)
 *
 * Schlüssel, Passwörter und google-services.json liegen außerhalb des Repos,
 * standardmäßig in %USERPROFILE%\.lionsapp-release (Einrichtung: RELEASES.md).
 * Das Skript gibt keinen dieser Werte aus und schreibt keinen davon ins Repo:
 * Gradle bekommt die Signatur über Umgebungsvariablen, die Push-Datei wird nach
 * dem Build wieder entfernt.
 *
 * Gebaut wird der Commit in einem eigenen Git-Worktree außerhalb des Repos
 * (Standard C:\lsb). So entspricht die APK genau dem Commit, und der Pfad ist
 * kurz und ohne Leerzeichen - im Projektpfad "C:\GIT Privat\..." brach der
 * native Build von react-native-reanimated ab ("build.ninja still dirty").
 */
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const release = require("./release-version.cjs");

const mobileDir = path.resolve(__dirname, "..");
const repoDir = path.resolve(mobileDir, "..");
const buildsDir = path.join(mobileDir, "builds");
const isWindows = process.platform === "win32";
const flags = new Set(process.argv.slice(2));
const mode = flags.has("--check") ? "check" : flags.has("--dry-run") ? "dry-run" : flags.has("--upload-only") ? "upload-only" : "release";
// Die Play Console nimmt nur App Bundles; die APK bleibt für Sideload und den Vereinsserver (#219).
const wantBundle = flags.has("--aab");
const releaseDir = process.env.LIONSAPP_RELEASE_DIR || path.join(os.homedir(), ".lionsapp-release");
const BUILD_MARKER = ".lionsapp-build";

class ReleaseAbort extends Error {}

// Wirft statt process.exit: Nur so laufen die finally-Blöcke, die Push-Datei
// und andere erzeugte Geheimnisse wieder wegräumen.
function fail(message) {
  throw new ReleaseAbort(message);
}

function quote(value) {
  const text = String(value);
  return /[\s"&|<>^()]/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}

/** Startet ein Programm. Unter Windows über die Shell, damit .cmd und .bat laufen. */
function run(command, args, { cwd = mobileDir, env = {}, capture = false, allowFailure = false } = {}) {
  const options = {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  };
  const result = isWindows
    ? spawnSync([command, ...args].map(quote).join(" "), { ...options, shell: true })
    : spawnSync(command, args, options);
  if (!allowFailure && (result.error || result.status !== 0)) {
    fail(`${path.basename(command)} ${args[0] || ""} endete mit Code ${result.status ?? result.error?.message}.`);
  }
  return result;
}

function git(args, options = {}) {
  return run("git", args, { cwd: repoDir, capture: true, allowFailure: true, ...options });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(mobileDir, file), "utf8"));
}

function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function insideRepo(file) {
  const resolved = path.resolve(file).toLowerCase();
  return resolved.startsWith(`${repoDir.toLowerCase()}${path.sep}`);
}

function loadConfig() {
  const file = path.join(releaseDir, "signing.json");
  let saved = {};
  let broken = "";
  if (fs.existsSync(file)) {
    try {
      saved = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      // Nur die Stelle nennen, nie den Inhalt - darin stehen Passwörter.
      const where = /line \d+ column \d+/.exec(error.message)?.[0] || "unbekannte Stelle";
      broken = `${file} ist kein gültiges JSON (${where}). Windows-Pfade mit / schreiben, z. B. C:/Users/...`;
    }
  }
  // Werte wie "HIER_ALIAS" aus der Vorlage gelten als noch nicht eingetragen.
  const pick = (envName, key, fallback = "") => {
    const value = process.env[envName] || saved[key] || fallback;
    return /^HIER_/.test(String(value)) ? "" : value;
  };
  const inReleaseDir = (value) => (path.isAbsolute(value) ? value : path.join(releaseDir, value));
  return {
    file,
    broken,
    storeFile: inReleaseDir(pick("LIONSAPP_KEYSTORE", "storeFile", "upload.jks")),
    storePassword: pick("LIONSAPP_KEYSTORE_PASSWORD", "storePassword"),
    keyAlias: pick("LIONSAPP_KEY_ALIAS", "keyAlias"),
    keyPassword: pick("LIONSAPP_KEY_PASSWORD", "keyPassword"),
    googleServices: inReleaseDir(pick("LIONSAPP_GOOGLE_SERVICES", "googleServicesFile", "google-services.json")),
    javaHome: pick("LIONSAPP_JAVA_HOME", "javaHome", process.env.JAVA_HOME || ""),
    androidHome: pick("LIONSAPP_ANDROID_HOME", "androidHome", process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || ""),
    buildDir: path.resolve(pick("LIONSAPP_BUILD_DIR", "buildDir", isWindows ? "C:/lsb" : path.join(os.tmpdir(), "lionsapp-build"))),
    // Update aus der App (#250): die APK nach dem Veröffentlichen an den Vereinsserver schicken.
    uploadUrl: String(pick("LIONSAPP_UPLOAD_URL", "uploadUrl", "")).replace(/\/+$/, ""),
    uploadToken: pick("LIONSAPP_UPLOAD_TOKEN", "uploadToken", ""),
  };
}

/**
 * Die APK an den Vereinsserver schicken, damit die App sie ohne GitHub laden
 * kann (#250). Fehlt die Einrichtung oder scheitert der Upload, bleibt das
 * GitHub-Release gültig - die APK lässt sich unter Admin → App-Versionen
 * von Hand nachreichen. Das Token wird nie ausgegeben.
 */
async function uploadToServer({ config, apkPath, apk, version, versionCode, changelog }) {
  if (!config.uploadUrl || !config.uploadToken) {
    console.log("Server-Upload übersprungen: LIONSAPP_UPLOAD_URL und LIONSAPP_UPLOAD_TOKEN (oder uploadUrl/uploadToken in signing.json) fehlen.");
    return false;
  }
  const { whatsNewEntries } = require("./whats-new.cjs");
  const notes = whatsNewEntries(changelog, version).map((item) => `- ${item}`).join("\n");
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(apkPath)], { type: "application/vnd.android.package-archive" }), apk);
  form.append("version", version);
  form.append("build", String(versionCode));
  form.append("notes", notes);
  form.append("set_current", "true");
  try {
    const response = await fetch(`${config.uploadUrl}/api/admin/app-releases`, {
      method: "POST",
      headers: { "X-Release-Token": config.uploadToken },
      body: form,
    });
    if (!response.ok) {
      let reason = "";
      try {
        const body = await response.json();
        reason = typeof body?.detail === "string" ? body.detail : "";
      } catch {
        reason = "";
      }
      console.warn(`Warnung: Server-Upload fehlgeschlagen (HTTP ${response.status}${reason ? `: ${reason}` : ""}). Das GitHub-Release gilt trotzdem; APK unter Admin → App-Versionen von Hand hochladen.`);
      return false;
    }
    console.log(`Am Server abgelegt: Build ${versionCode} (Admin → App-Versionen).`);
    return true;
  } catch (error) {
    console.warn(`Warnung: Server-Upload fehlgeschlagen (${error.message}). Das GitHub-Release gilt trotzdem.`);
    return false;
  }
}

function javaMajor(javaHome) {
  const java = path.join(javaHome || "", "bin", isWindows ? "java.exe" : "java");
  if (!javaHome || !fs.existsSync(java)) return 0;
  const result = run(java, ["-version"], { capture: true, allowFailure: true });
  const match = /version "(\d+)/.exec(`${result.stderr}${result.stdout}`);
  return match ? Number(match[1]) : 0;
}

function findApksigner(androidHome) {
  const buildTools = path.join(androidHome || "", "build-tools");
  if (!androidHome || !fs.existsSync(buildTools)) return null;
  const versions = fs.readdirSync(buildTools).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const version of versions) {
    const candidate = path.join(buildTools, version, isWindows ? "apksigner.bat" : "apksigner");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Zertifikat des hinterlegten Schlüssels, ohne zu bauen. Das Passwort geht nur
 * über eine Umgebungsvariable an keytool, nie über die Befehlszeile.
 */
function keystoreCheck(config) {
  const keytool = path.join(config.javaHome || "", "bin", isWindows ? "keytool.exe" : "keytool");
  if (!fs.existsSync(keytool) || !fs.existsSync(config.storeFile) || !config.storePassword || !config.keyAlias) return null;
  const result = run(
    keytool,
    ["-list", "-v", "-keystore", config.storeFile, "-alias", config.keyAlias, "-storepass:env", "LIONSAPP_KEYTOOL_STOREPASS"],
    { capture: true, allowFailure: true, env: { LIONSAPP_KEYTOOL_STOREPASS: config.storePassword } },
  );
  const match = /SHA-?256:\s*((?:[0-9A-F]{2}:){31}[0-9A-F]{2})/i.exec(result.stdout || "");
  if (result.status !== 0 || !match) return { error: true };
  return { digest: match[1].replace(/:/g, "").toLowerCase() };
}

function gatherChecks() {
  const config = loadConfig();
  const pkg = readJson("package.json");
  const app = readJson("app.json");
  const version = pkg.version;
  const versionCode = app.expo.android.versionCode;
  const checks = [];
  const add = (ok, label, hint, onlyForRelease = false) => checks.push({ ok, label, hint, onlyForRelease });

  const problems = release.versionProblems(version);
  add(!problems.length, `Version ${version} passt zum Schema`, problems.join(" "));

  git(["fetch", "--quiet", "--tags", "origin"]);
  const tags = (git(["tag", "-l", "mobile-v*"]).stdout || "").split(/\r?\n/).filter(Boolean);
  const highest = release.highestBuild(tags);
  add(versionCode > highest, `Build ${versionCode} liegt über dem letzten Build ${highest}`, `expo.android.versionCode in app.json auf mindestens ${highest + 1} setzen.`);
  const tag = release.releaseTag(version, versionCode);
  add(!tags.includes(tag), `Tag ${tag} ist noch frei`, "Diesen Build gibt es schon. versionCode erhöhen.", true);

  const dirty = Boolean((git(["status", "--porcelain"]).stdout || "").trim());
  add(!dirty, "Keine ungespeicherten Änderungen", "Erst committen: Die APK soll genau einem Commit auf GitHub entsprechen.", true);
  const branch = (git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout || "").trim();
  const head = (git(["rev-parse", "HEAD"]).stdout || "").trim();
  const remoteMain = (git(["rev-parse", "origin/main"]).stdout || "").trim();
  add(branch === "main" && head === remoteMain, "Stand ist main, genau wie auf GitHub", `Gerade: ${branch}. Veröffentlicht wird nur, was in main auf GitHub liegt.`, true);

  const java = javaMajor(config.javaHome);
  add(java >= 17, `Java gefunden (Version ${java || "keine"})`, "JDK 21 installieren und javaHome in signing.json oder JAVA_HOME setzen.");
  const apksigner = findApksigner(config.androidHome);
  add(Boolean(apksigner), "Android SDK mit apksigner gefunden", "Android SDK installieren und androidHome in signing.json oder ANDROID_HOME setzen.");
  add(!insideRepo(config.buildDir) && !/\s/.test(config.buildDir), `Build-Ordner ${config.buildDir} liegt außerhalb des Repos, ohne Leerzeichen`, "Einen kurzen Ordner ohne Leerzeichen als buildDir in signing.json eintragen, z. B. C:/lsb.");

  add(!config.broken, "signing.json ist lesbar", config.broken);
  add(fs.existsSync(config.storeFile) && !insideRepo(config.storeFile), "Upload-Schlüssel liegt außerhalb des Repos", `Erwartet unter ${config.storeFile}. Nie ins Repo legen.`);
  add(Boolean(config.storePassword && config.keyAlias && config.keyPassword), "Passwörter und Alias sind hinterlegt", `In ${config.file} oder als Umgebungsvariablen, siehe mobile/RELEASES.md.`);
  const key = keystoreCheck(config);
  const keyHint = !key
    ? "Prüfbar, sobald Schlüssel, Passwort, Alias und Java da sind."
    : key.error
      ? "Der Schlüssel ließ sich nicht öffnen: Passwort oder Alias stimmen nicht."
      : `Das ist ein anderes Zertifikat (${key.digest.slice(0, 8)}…), nicht der Upload-Schlüssel der App.`;
  add(key?.digest === release.EXPECTED_SIGNER_SHA256, "Schlüssel passt zum Zertifikat der App", keyHint, true);
  add(fs.existsSync(config.googleServices) && !insideRepo(config.googleServices), "google-services.json für Push liegt außerhalb des Repos", `Erwartet unter ${config.googleServices} (Firebase, App at.lionsquad.app).`);

  const gh = run("gh", ["auth", "status"], { capture: true, allowFailure: true });
  add(gh.status === 0, "GitHub CLI ist angemeldet", "gh auth login", true);

  return { config, version, versionCode, tag, head, dirty, apksigner, checks };
}

// --check zeigt, was fürs Veröffentlichen fehlt; nur der Probelauf sieht über
// Git-Stand, Tag und Schlüssel hinweg, weil er nichts veröffentlicht.
const ignoredInThisMode = (item) => item.onlyForRelease && mode === "dry-run";

function printChecks(checks) {
  console.log(`\nLionsAPP-Release (${mode === "check" ? "Prüfung" : mode === "dry-run" ? "Probelauf ohne Veröffentlichen" : "Veröffentlichen"})\n`);
  for (const item of checks) {
    const state = item.ok ? "[ ok  ]" : ignoredInThisMode(item) ? "[später]" : "[FEHLT]";
    console.log(`${state} ${item.label}`);
    if (!item.ok && item.hint) console.log(`       ${item.hint}`);
  }
}

function step(title) {
  console.log(`\n=== ${title}`);
}

/**
 * Legt den Commit sauber im Build-Ordner ab. Beim nächsten Lauf bleiben
 * node_modules und damit die nativen Zwischenstände erhalten, solange sich
 * package-lock.json nicht ändert.
 */
function prepareBuildTree(buildDir, head) {
  const listed = (git(["worktree", "list", "--porcelain"]).stdout || "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
  const registered = listed.some((item) => samePath(item, buildDir));
  const ours = fs.existsSync(path.join(buildDir, BUILD_MARKER));

  if (registered) {
    run("git", ["checkout", "--quiet", "--detach", "--force", head], { cwd: buildDir });
    run("git", ["clean", "-fdqx", "-e", "node_modules", "-e", BUILD_MARKER], { cwd: buildDir });
  } else {
    if (fs.existsSync(buildDir) && fs.readdirSync(buildDir).length) {
      if (!ours) fail(`${buildDir} ist schon belegt und kein Build-Ordner dieses Skripts. Anderen Ort als buildDir in signing.json eintragen.`);
      fs.rmSync(buildDir, { recursive: true, force: true });
    }
    git(["worktree", "prune"]);
    run("git", ["worktree", "add", "--quiet", "--detach", buildDir, head], { cwd: repoDir });
  }
  fs.writeFileSync(path.join(buildDir, BUILD_MARKER), "Build-Ordner von mobile/scripts/release-local.cjs. Darf gelöscht werden.\n");

  const buildMobile = path.join(buildDir, "mobile");
  const lockHash = crypto.createHash("sha256").update(fs.readFileSync(path.join(buildMobile, "package-lock.json"))).digest("hex");
  const stamp = path.join(buildMobile, "node_modules", ".lionsapp-lock-hash");
  if (!fs.existsSync(stamp) || fs.readFileSync(stamp, "utf8").trim() !== lockHash) {
    run("npm", ["ci"], { cwd: buildMobile });
    fs.writeFileSync(stamp, `${lockHash}\n`);
  }
  return buildMobile;
}

function removeGeneratedPushConfig(buildMobile) {
  for (const file of [path.join(buildMobile, "google-services.json"), path.join(buildMobile, "android", "app", "google-services.json")]) {
    fs.rmSync(file, { force: true });
  }
}

/**
 * Nur der Server-Upload (#305): die zuletzt gebaute APK der aktuellen Version
 * aus mobile/builds an den Vereinsserver schicken - ohne neu zu bauen. Für den
 * Fall, dass der Upload nach dem Veröffentlichen scheiterte.
 */
async function uploadOnly() {
  const config = loadConfig();
  if (config.broken) fail(config.broken);
  const version = readJson("package.json").version;
  const versionCode = readJson("app.json").expo.android.versionCode;
  const prefix = `LionsAPP-v${version}-build${versionCode}-`;
  const candidates = fs.existsSync(buildsDir)
    ? fs.readdirSync(buildsDir).filter((name) => name.startsWith(prefix) && name.endsWith(".apk"))
    : [];
  if (!candidates.length) fail(`Keine APK für ${version} (Build ${versionCode}) in ${buildsDir}. Erst bauen.`);
  const apk = candidates.sort((a, b) => fs.statSync(path.join(buildsDir, b)).mtimeMs - fs.statSync(path.join(buildsDir, a)).mtimeMs)[0];
  const apkPath = path.join(buildsDir, apk);
  const changelog = fs.readFileSync(path.join(mobileDir, "CHANGELOG.md"), "utf8");
  step(`APK an den Vereinsserver schicken: ${apk}`);
  const ok = await uploadToServer({ config, apkPath, apk, version, versionCode, changelog });
  if (!ok) process.exitCode = 1;
  return ok;
}

function main() {
  if (mode === "upload-only") return uploadOnly();
  const state = gatherChecks();
  printChecks(state.checks);
  const blocking = state.checks.filter((item) => !item.ok && !ignoredInThisMode(item));
  if (mode === "check") {
    process.exitCode = blocking.length ? 1 : 0;
    return;
  }
  if (blocking.length) fail(`${blocking.length} Voraussetzung(en) fehlen, siehe oben.`);

  const { config, version, versionCode, tag, head } = state;

  step(`Build-Ordner vorbereiten: ${config.buildDir} (Commit ${head.slice(0, 7)})`);
  if (state.dirty) console.warn("Hinweis: Gebaut wird der letzte Commit. Ungespeicherte Änderungen sind nicht enthalten.");
  const buildMobile = prepareBuildTree(config.buildDir, head);
  const buildAndroid = path.join(buildMobile, "android");

  step("Prüfen: Preflight, Typen, Tests");
  const tagEnv = mode === "release" ? { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: tag } : { GITHUB_REF_TYPE: "", GITHUB_REF_NAME: "" };
  run("npm", ["run", "release:preflight"], { cwd: buildMobile, env: tagEnv });
  run("npm", ["run", "typecheck"], { cwd: buildMobile });
  run("npm", ["run", "test:security"], { cwd: buildMobile });
  run("npm", ["run", "test:release"], { cwd: buildMobile });
  run("npm", ["test", "--", "--silent"], { cwd: buildMobile });

  const signingEnv = {
    JAVA_HOME: config.javaHome,
    ANDROID_HOME: config.androidHome,
    ANDROID_SDK_ROOT: config.androidHome,
    ORG_GRADLE_PROJECT_TLS_UPLOAD_STORE_FILE: config.storeFile,
    ORG_GRADLE_PROJECT_TLS_UPLOAD_STORE_PASSWORD: config.storePassword,
    ORG_GRADLE_PROJECT_TLS_UPLOAD_KEY_ALIAS: config.keyAlias,
    ORG_GRADLE_PROJECT_TLS_UPLOAD_KEY_PASSWORD: config.keyPassword,
  };

  try {
    step("Android-Projekt erzeugen");
    run(process.execPath, [path.join(buildMobile, "scripts", "prepare-google-services.cjs")], {
      cwd: buildMobile,
      env: { GOOGLE_SERVICES_JSON: fs.readFileSync(config.googleServices, "utf8"), REQUIRE_ANDROID_PUSH_CONFIG: "1" },
    });
    const prebuild = run("npx", ["expo", "prebuild", "--platform", "android", "--clean"], { cwd: buildMobile, env: { CI: "1" }, allowFailure: true });
    if (prebuild.status !== 0) {
      // Häufigster Grund unter Windows: EBUSY, weil ein Terminal oder Editor im Ordner android steht.
      fail(`expo prebuild ist fehlgeschlagen. Steht ein Terminal oder Editor in ${buildAndroid}? Dann dort herausgehen und neu starten.`);
    }
    run(process.execPath, [path.join(buildMobile, "scripts", "configure-android-signing.cjs")], { cwd: buildMobile });

    step("APK bauen (beim ersten Mal lädt Gradle einiges herunter)");
    // Mit vollem Pfad: Aus Git Bash gestartet sucht cmd.exe nicht im aktuellen
    // Ordner (NoDefaultCurrentDirectoryInExePath), "gradlew.bat" allein fehlt dann.
    run(path.join(buildAndroid, isWindows ? "gradlew.bat" : "gradlew"), ["assembleRelease", "--no-daemon"], { cwd: buildAndroid, env: signingEnv });
    if (wantBundle) {
      step("App Bundle bauen (Play Console)");
      run(path.join(buildAndroid, isWindows ? "gradlew.bat" : "gradlew"), ["bundleRelease", "--no-daemon"], { cwd: buildAndroid, env: signingEnv });
    }
  } finally {
    removeGeneratedPushConfig(buildMobile);
  }

  step("APK prüfen");
  const apk = release.apkName(version, versionCode, head.slice(0, 7));
  const apkPath = path.join(buildsDir, apk);
  fs.mkdirSync(buildsDir, { recursive: true });
  fs.copyFileSync(path.join(buildAndroid, "app", "build", "outputs", "apk", "release", "app-release.apk"), apkPath);

  const verify = run(state.apksigner, ["verify", "--print-certs", apkPath], { capture: true, env: { JAVA_HOME: config.javaHome } });
  const signatureText = verify.stdout.split(/\r?\n/).filter((line) => /Signer/.test(line)).join("\n");
  fs.writeFileSync(`${apkPath}.signature.txt`, `${signatureText}\n`);
  if (release.usesDebugCertificate(signatureText)) fail("Die APK ist mit dem Android-Debug-Zertifikat signiert.");
  const digest = release.signerDigest(signatureText);
  if (digest !== release.EXPECTED_SIGNER_SHA256) {
    const message = `Die APK ist nicht mit dem Upload-Schlüssel der App signiert (${digest || "unbekannt"}). Eine installierte LionsAPP ließe sich damit nicht aktualisieren.`;
    if (mode === "release") fail(message);
    console.warn(`\nWarnung: ${message}`);
  }

  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(apkPath)).digest("hex");
  fs.writeFileSync(`${apkPath}.sha256`, `${sha256}  ${apk}\n`);
  const notesPath = path.join(buildsDir, `release-notes-${version}-build${versionCode}.md`);
  const changelog = fs.readFileSync(path.join(buildMobile, "CHANGELOG.md"), "utf8");
  fs.writeFileSync(notesPath, release.releaseNotes({ version, versionCode, apk, sha256, signatureText, changelog }));
  console.log(`APK: ${apkPath}`);
  console.log(`SHA-256: ${sha256}`);

  // Das Bundle ist mit demselben Schlüssel signiert (Upload-Key bei Play App Signing) und wird
  // von Hand in die Play Console geladen - hier nur ablegen, prüfen und ans Release hängen.
  let aabPath = "";
  if (wantBundle) {
    const aab = release.aabName(version, versionCode, head.slice(0, 7));
    aabPath = path.join(buildsDir, aab);
    fs.copyFileSync(path.join(buildAndroid, "app", "build", "outputs", "bundle", "release", "app-release.aab"), aabPath);
    const aabSha256 = crypto.createHash("sha256").update(fs.readFileSync(aabPath)).digest("hex");
    fs.writeFileSync(`${aabPath}.sha256`, `${aabSha256}  ${aab}\n`);
    console.log(`AAB: ${aabPath}`);
    console.log(`AAB SHA-256: ${aabSha256}`);
  }

  if (mode === "dry-run") {
    console.log("\nProbelauf fertig. Nichts veröffentlicht.");
    return;
  }

  step(`Veröffentlichen als ${tag}`);
  const channelArgs = release.releaseChannel(version) === "beta" ? ["--prerelease"] : ["--latest"];
  run("gh", [
    "release", "create", tag,
    apkPath, `${apkPath}.sha256`, `${apkPath}.signature.txt`,
    ...(aabPath ? [aabPath, `${aabPath}.sha256`] : []),
    "--target", head,
    "--title", release.releaseName(version, versionCode),
    "--notes-file", notesPath,
    ...channelArgs,
  ], { cwd: repoDir });
  git(["fetch", "--quiet", "--tags", "origin"]);
  console.log(`\nVeröffentlicht: ${release.releaseName(version, versionCode)}`);
  step("APK an den Vereinsserver schicken");
  return uploadToServer({ config, apkPath, apk, version, versionCode, changelog });
}

try {
  main();
} catch (error) {
  console.error(error instanceof ReleaseAbort ? `\nAbgebrochen: ${error.message}` : error);
  process.exitCode = 1;
}

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import play from "./play-publish.cjs";

// Bundle in den Play-Test-Track (#412): geprüft wird ohne Google - ein nachgestelltes fetch
// hält jede Anfrage fest. Was hier zählt: ein gültig signiertes JWT, die richtige Reihenfolge
// (Edit → Bundle → Track → Commit), Build und Versionshinweise im Track, kein Weg nach Produktion,
// und dass ein gescheiterter Edit verworfen wird.

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const account = {
  clientEmail: "lionsapp-release@test-projekt.iam.gserviceaccount.com",
  privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
  tokenUri: "https://oauth2.test/token",
};
const PACKAGE = "at.lionsquad.app";

const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });

function fakeFetch(overrides = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", headers: init.headers || {}, body: init.body });
    const route = `${init.method || "GET"} ${String(url).replace(play.UPLOAD_API, "").replace(play.API, "")}`;
    for (const [pattern, response] of Object.entries(overrides)) {
      if (route.startsWith(pattern)) return typeof response === "function" ? response(init) : response;
    }
    if (String(url) === account.tokenUri) return reply(200, { access_token: "tok-1", expires_in: 3600 });
    if (route === `POST /applications/${PACKAGE}/edits`) return reply(200, { id: "edit-1", expiryTimeSeconds: "1" });
    if (route.startsWith(`POST /applications/${PACKAGE}/edits/edit-1/bundles`)) return reply(200, { versionCode: 78, sha256: "abc" });
    if (route.startsWith(`PUT /applications/${PACKAGE}/edits/edit-1/tracks/`)) return reply(200, JSON.parse(init.body));
    if (route === `POST /applications/${PACKAGE}/edits/edit-1:commit`) return reply(200, { id: "edit-1" });
    if (route === `GET /applications/${PACKAGE}/edits/edit-1/tracks`) return reply(200, { tracks: [{ track: "internal" }, { track: "alpha" }] });
    if (route === `DELETE /applications/${PACKAGE}/edits/edit-1`) return { ok: true, status: 204, json: async () => { throw new Error("leer"); } };
    return reply(404, { error: { message: `unbekannt: ${route}` } });
  };
  return { fetch, calls };
}

async function bundleFile() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lionsapp-play-"));
  const file = path.join(dir, "LionsAPP-v0.18.0-beta-build78-abc1234.aab");
  await writeFile(file, Buffer.from("PK\u0003\u0004 nicht wirklich ein Bundle"));
  return file;
}

test("das JWT nennt Dienstkonto, Scope und Token-Adresse und ist mit dem Schlüssel signiert", () => {
  const token = play.assertion(account, 1_700_000_000);
  const [header, claims, signature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url")), {
    iss: account.clientEmail,
    scope: play.SCOPE,
    aud: account.tokenUri,
    iat: 1_700_000_000,
    exp: 1_700_003_600,
  });
  assert.equal(crypto.verify("RSA-SHA256", Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, "base64url")), true);
});

test("der Zugangstoken kommt per JWT-Bearer; ohne Token steht Googles Grund in der Meldung", async () => {
  const { fetch, calls } = fakeFetch();
  assert.equal(await play.accessToken(account, { fetch }), "tok-1");
  assert.equal(calls[0].url, account.tokenUri);
  assert.match(calls[0].body, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=/);

  const refused = fakeFetch();
  const denyingFetch = async () => ({ ok: false, status: 401, json: async () => ({ error: "invalid_grant", error_description: "Invalid JWT Signature." }) });
  await assert.rejects(play.accessToken(account, { fetch: denyingFetch }), /Invalid JWT Signature/);
  assert.equal(refused.calls.length, 0);
});

test("Bundle hochladen: Edit, Bundle als Rohdaten, Track mit Build und Hinweisen, Commit - jeweils mit dem Token", async () => {
  const { fetch, calls } = fakeFetch();
  const aabPath = await bundleFile();
  const result = await play.publishBundle({ account, packageName: PACKAGE, aabPath, versionCode: 78, track: "internal", notes: "- Sticker der Tastatur im Chat\n- GIF bleibt GIF", fetch });

  assert.deepEqual(result, { editId: "edit-1", track: "internal", versionCode: 78 });
  const routes = calls.slice(1).map((call) => `${call.method} ${call.url.replace(play.UPLOAD_API, "upload:").replace(play.API, "")}`);
  assert.deepEqual(routes, [
    `POST /applications/${PACKAGE}/edits`,
    `POST upload:/applications/${PACKAGE}/edits/edit-1/bundles?uploadType=media`,
    `PUT /applications/${PACKAGE}/edits/edit-1/tracks/internal`,
    `POST /applications/${PACKAGE}/edits/edit-1:commit`,
  ]);
  for (const call of calls.slice(1)) assert.equal(call.headers.Authorization, "Bearer tok-1");

  const upload = calls[2];
  assert.equal(upload.headers["Content-Type"], "application/octet-stream");
  assert.equal(Buffer.isBuffer(upload.body), true);
  assert.equal(upload.body.toString(), "PK\u0003\u0004 nicht wirklich ein Bundle");

  assert.deepEqual(JSON.parse(calls[3].body), {
    track: "internal",
    releases: [{ versionCodes: ["78"], status: "completed", releaseNotes: [{ language: "de-DE", text: "- Sticker der Tastatur im Chat\n- GIF bleibt GIF" }] }],
  });
});

test("geschlossener Test heißt bei Google „alpha“; Produktion wird abgelehnt, ein eigener Track-Name geht durch", () => {
  assert.equal(play.resolveTrack(undefined), "internal");
  assert.equal(play.resolveTrack("closed"), "alpha");
  assert.equal(play.resolveTrack("Geschlossen"), "alpha");
  assert.equal(play.resolveTrack("mitglieder-test"), "mitglieder-test");
  assert.throws(() => play.resolveTrack("production"), /Produktion/);
  assert.throws(() => play.resolveTrack("Produktion"), /Produktion/);
});

test("trägt das Bundle einen anderen Build, wird der Edit verworfen und nichts bestätigt", async () => {
  const { fetch, calls } = fakeFetch({ [`POST /applications/${PACKAGE}/edits/edit-1/bundles`]: reply(200, { versionCode: 77 }) });
  const aabPath = await bundleFile();
  await assert.rejects(play.publishBundle({ account, packageName: PACKAGE, aabPath, versionCode: 78, track: "internal", fetch }), /Build 77, erwartet war 78/);
  const routes = calls.map((call) => `${call.method} ${call.url.replace(play.API, "")}`);
  assert.equal(routes.includes(`DELETE /applications/${PACKAGE}/edits/edit-1`), true);
  assert.equal(routes.some((route) => route.endsWith(":commit")), false);
});

test("eine Ablehnung der API nennt Googles Meldung und den Weg", async () => {
  const { fetch } = fakeFetch({ [`POST /applications/${PACKAGE}/edits`]: reply(403, { error: { message: "The caller does not have permission" } }) });
  await assert.rejects(play.checkAccess({ account, packageName: PACKAGE, fetch }), /Play API POST \/applications\/at\.lionsquad\.app\/edits: The caller does not have permission/);
});

test("die Prüfung liest nur: Tracks abfragen und den Edit wieder verwerfen", async () => {
  const { fetch, calls } = fakeFetch();
  assert.deepEqual(await play.checkAccess({ account, packageName: PACKAGE, fetch }), ["internal", "alpha"]);
  const routes = calls.slice(1).map((call) => `${call.method} ${call.url.replace(play.API, "")}`);
  assert.deepEqual(routes, [
    `POST /applications/${PACKAGE}/edits`,
    `GET /applications/${PACKAGE}/edits/edit-1/tracks`,
    `DELETE /applications/${PACKAGE}/edits/edit-1`,
  ]);
});

test("Versionshinweise: leer bleibt leer, zu lang wird auf 500 Zeichen gekürzt", () => {
  assert.deepEqual(play.trackNotes(""), []);
  assert.deepEqual(play.trackNotes("- Neu"), [{ language: "de-DE", text: "- Neu" }]);
  const long = play.trackNotes("x".repeat(600));
  assert.equal(long[0].text.length, play.RELEASE_NOTES_LIMIT);
  assert.equal(long[0].text.endsWith("…"), true);
});

test("Dienstkonto-Datei: fehlt → null, ohne Schlüssel → klare Meldung, sonst E-Mail, Schlüssel und Token-Adresse", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lionsapp-play-"));
  assert.equal(play.loadServiceAccount(path.join(dir, "fehlt.json")), null);

  const incomplete = path.join(dir, "ohne-schluessel.json");
  await writeFile(incomplete, JSON.stringify({ client_email: "x@y" }));
  assert.throws(() => play.loadServiceAccount(incomplete), /Feld private_key fehlt/);

  const broken = path.join(dir, "kaputt.json");
  await writeFile(broken, "{ nicht json");
  assert.throws(() => play.loadServiceAccount(broken), /kein gültiges JSON/);

  const complete = path.join(dir, "play-service-account.json");
  await writeFile(complete, JSON.stringify({ type: "service_account", client_email: account.clientEmail, private_key: account.privateKey }));
  assert.deepEqual(play.loadServiceAccount(complete), { clientEmail: account.clientEmail, privateKey: account.privateKey, tokenUri: play.DEFAULT_TOKEN_URI });
});

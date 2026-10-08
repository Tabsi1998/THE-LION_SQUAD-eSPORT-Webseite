import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Teile des lokalen Release-Skripts (#1408). Die Datei wird nur geladen - gebaut und veröffentlicht wird dabei
// nichts, das passiert nur beim Aufruf als Skript.

const require = createRequire(import.meta.url);
const { quote, readIfPresent } = require("./release-local.cjs");

/** Liest eine Angabe so, wie Windows-Programme ihre Befehlszeile lesen (Regeln von CommandLineToArgvW). */
function parseWindowsArgument(commandLine) {
  let value = "";
  let quoted = false;
  let slashes = 0;
  for (const char of commandLine) {
    if (char === "\\") {
      slashes += 1;
      continue;
    }
    if (char === '"') {
      value += "\\".repeat(Math.floor(slashes / 2));
      if (slashes % 2 === 1) value += '"';
      else quoted = !quoted;
      slashes = 0;
      continue;
    }
    value += "\\".repeat(slashes);
    slashes = 0;
    if (!quoted && /\s/.test(char)) throw new Error(`zerfällt in mehrere Angaben: ${commandLine}`);
    value += char;
  }
  return value + "\\".repeat(slashes);
}

test("quote lässt einfache Werte und Pfade, wie sie sind", () => {
  assert.equal(quote("git"), "git");
  assert.equal(quote("C:/lsb"), "C:/lsb");
  assert.equal(quote("C:\\lsb\\mobile"), "C:\\lsb\\mobile");
  assert.equal(quote("C:\\Program Files\\Java\\bin\\keytool.exe"), '"C:\\Program Files\\Java\\bin\\keytool.exe"');
  assert.equal(quote("LionsAPP 1.2.3 (Build 90)"), '"LionsAPP 1.2.3 (Build 90)"');
});

test("quote: ein Backslash vor einem Anführungszeichen oder am Ende verschluckt nichts mehr", () => {
  assert.equal(quote("C:\\Mein Ordner\\"), '"C:\\Mein Ordner\\\\"');
  assert.equal(quote('sagt "hallo"'), '"sagt \\"hallo\\""');
  assert.equal(quote('a\\" b'), '"a\\\\\\" b"');
  for (const value of ["C:\\Mein Ordner\\", 'sagt "hallo"', 'a\\" b', "x & y", "\\\\server\\freigabe\\a b", ' "\\'])
    assert.equal(parseWindowsArgument(quote(value)), value, value);
});

test("quote: jeder Wert kommt beim Programm genau so an", () => {
  const alphabet = ["a", " ", "\\", '"', "&", "("];
  let seed = 1408;
  const next = () => {
    seed = (seed * 48271) % 2147483647;
    return seed;
  };
  for (let round = 0; round < 3000; round += 1) {
    const length = next() % 12;
    let value = "";
    for (let index = 0; index < length; index += 1) value += alphabet[next() % alphabet.length];
    if (!/[\s"&|<>^()]/.test(value)) continue;
    assert.equal(parseWindowsArgument(quote(value)), value, JSON.stringify(value));
  }
});

test("readIfPresent liest eine Datei und gibt ohne Datei einen leeren Text", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lionsapp-release-"));
  try {
    const file = path.join(dir, "stempel");
    assert.equal(readIfPresent(file), "");
    assert.equal(readIfPresent(path.join(dir, "fehlt", "stempel")), "");
    await writeFile(file, "abc\n");
    assert.equal(readIfPresent(file), "abc\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

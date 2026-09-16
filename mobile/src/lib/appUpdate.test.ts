import { decideUpdate, progressShare, releaseSizeLabel, releaseTitle, shouldCheck, verifyDownload, type AppRelease } from "./appUpdate";

// Update aus der App (#250): wann gefragt wird, wann der Banner erscheint,
// wann ein Download als heil gilt.

const release: AppRelease = {
  build: 63, version: "0.5.0-beta", notes: "- Neu", sha256: "abc", md5: "d41d8cd98f00b204e9800998ecf8427e",
  size: 52_428_800, filename: "LionsAPP-v0.5.0-beta-build63.apk", download_url: "/api/mobile/app-download/63",
};

test("höchstens einmal pro Stunde nachfragen", () => {
  const now = 10_000_000;
  expect(shouldCheck(null, now)).toBe(true);
  expect(shouldCheck(now - 59 * 60 * 1000, now)).toBe(false);
  expect(shouldCheck(now - 60 * 60 * 1000, now)).toBe(true);
});

test("der Banner erscheint nur bei einem neueren Build und lässt sich bis zur nächsten Sitzung wegdrücken", () => {
  expect(decideUpdate(null, null).show).toBe(false);
  expect(decideUpdate({ current: release, update_available: false, mandatory: false }, null).show).toBe(false);
  expect(decideUpdate({ current: release, update_available: true, mandatory: false }, null)).toEqual({ show: true, mandatory: false, release });
  expect(decideUpdate({ current: release, update_available: true, mandatory: false }, 63).show).toBe(false);
  expect(decideUpdate({ current: release, update_available: true, mandatory: false }, 62).show).toBe(true);
});

test("ein Pflicht-Update lässt sich nicht wegdrücken", () => {
  expect(decideUpdate({ current: release, update_available: true, mandatory: true }, 63)).toEqual({ show: true, mandatory: true, release });
});

test("Texte und Fortschritt", () => {
  expect(releaseTitle(release)).toBe("Build 63 ist da – v0.5.0-beta");
  expect(releaseSizeLabel(52_428_800)).toBe("50.0 MB");
  expect(releaseSizeLabel(2048)).toBe("2 KB");
  expect(progressShare(25, 100)).toBe(0.25);
  expect(progressShare(200, 100)).toBe(1);
  expect(progressShare(5, 0)).toBe(0);
});

test("eine unvollständige oder fremde Datei wird nicht installiert", () => {
  expect(verifyDownload(release, { size: 52_428_800, md5: "D41D8CD98F00B204E9800998ECF8427E" })).toBeNull();
  expect(verifyDownload(release, { size: 100 })).toMatch(/unvollständig/);
  expect(verifyDownload(release, { size: 52_428_800, md5: "ffff" })).toMatch(/Prüfsumme/);
  expect(verifyDownload({ ...release, md5: null }, { size: 52_428_800, md5: "egal" })).toBeNull();
});

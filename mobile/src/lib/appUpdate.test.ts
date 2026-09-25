import { channelLabel, decideUpdate, installPrompt, releaseChannel, releaseTitle, shouldCheck, type AppRelease } from "./appUpdate";

// Update aus der App (#250, #593): wann gefragt wird, wann der Banner erscheint, welche
// Art (Beta oder Release) genannt wird. Den Download gibt es seit der Play-Fassung nicht mehr.

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

test("Titel des Banners", () => {
  expect(releaseTitle(release)).toBe("Build 63 ist da – v0.5.0-beta");
});

// Kanal und Rückfrage (#309): Beta aus dem Server-Feld oder der Versionsnummer; je Art ein eigener Satz.
test("releaseChannel, channelLabel und installPrompt", () => {
  expect(releaseChannel({ channel: "beta", version: "1.0.0" })).toBe("beta");
  expect(releaseChannel({ channel: null, version: "0.9.0-beta" })).toBe("beta");
  expect(releaseChannel({ version: "1.0.0" })).toBe("release");
  expect(channelLabel("beta")).toBe("BETA · Testversion");
  expect(installPrompt("beta", false)).toEqual({ title: "Testversion installieren?", message: expect.stringContaining("kann Fehler enthalten") });
  expect(installPrompt("release", true).message).toContain("Pflicht");
  expect(installPrompt("release", false).title).toBe("Release installieren?");
});

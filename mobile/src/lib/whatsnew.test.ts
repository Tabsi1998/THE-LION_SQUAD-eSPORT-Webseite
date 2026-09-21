import { currentWhatsNew, shouldShowWhatsNew, tidyItem, whatsNewTitle } from "./whatsnew";

// „Was ist neu“ (#249): genau einmal nach einem Update, nie beim ersten Start.

test("die gebündelte Datei passt zur App-Version", () => {
  // Gegen app.json, nicht gegen feste Zahlen – sonst bricht der Test bei jedem Release (#218).
  const { expo } = require("../../app.json");
  const entry = currentWhatsNew();
  expect(entry.version).toBe(expo.version);
  expect(entry.build).toBe(expo.android.versionCode);
  expect(entry.items.length).toBeGreaterThan(0);
  expect(whatsNewTitle(entry)).toBe(`Neu in v${expo.version} (Build ${expo.android.versionCode})`);
});

test("gespeicherter Build kleiner als der eigene → Karte, gleich oder nichts gespeichert → keine", () => {
  const items = ["Etwas Neues."];
  expect(shouldShowWhatsNew(62, 63, items)).toBe(true);
  expect(shouldShowWhatsNew(63, 63, items)).toBe(false);
  expect(shouldShowWhatsNew(64, 63, items)).toBe(false);
  expect(shouldShowWhatsNew(null, 63, items)).toBe(false);
  expect(shouldShowWhatsNew(62, 63, [])).toBe(false);
  expect(shouldShowWhatsNew(62, 0, items)).toBe(false);
});

test("Changelog-Punkte werden lesbar", () => {
  expect(tidyItem("- Mobile: Bilder im Chat laden über den API-Client (#238).")).toBe("Bilder im Chat laden über den API-Client.");
  expect(tidyItem("- App: Update aus der App heraus (#250, #249)")).toBe("Update aus der App heraus.");
  expect(tidyItem("Kein Präfix.")).toBe("Kein Präfix.");
});

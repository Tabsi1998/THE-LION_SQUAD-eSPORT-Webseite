import { changedFields, changedWebsiteFields, exitLine, selfRequestLine, validWishedDay, websiteFieldText, websiteStateLine } from "./selfService";

// Vereinsakte in der App (#324/#329): nur Geändertes geht raus, Sätze wie im Web.

test("changedFields nimmt nur, was anders ist als im Profil", () => {
  const profile = { address: "Teststraße 1", zip: "6410", phone_mobile: "+43 660 0" };
  expect(changedFields(profile, { address: "Teststraße 1", zip: "6020", phone: "1" }, ["address", "zip", "phone", "phone_mobile"])).toEqual({ zip: "6020", phone: "1" });
  expect(changedFields(profile, {}, ["address"])).toEqual({});
});

test("Einreichungen und Austritt als Satz", () => {
  expect(selfRequestLine({ external_id: "a", kind: "change", changes: { address: "Neue Gasse 2", zip: "6020" } })).toBe("Änderung: Straße und Hausnummer: Neue Gasse 2, PLZ: 6020");
  expect(selfRequestLine({ external_id: "b", kind: "exit", notice_day: "2026-09-24", last_day: "2026-12-31", wished_too_early: true })).toBe("Austritt erklärt am 24.09.2026 – letzter Tag 31.12.2026 (Wunschdatum lag vor der Kündigungsfrist)");
  expect(exitLine({ exit: { status: "planned", notice_day: "2026-09-24", last_day: "2026-12-31" } })).toBe("Austritt geplant: letzter Tag der Mitgliedschaft 31.12.2026 (Eingang 24.09.2026).");
  expect(exitLine({ exit: null })).toBe("");
});

test("Wunschdatum nur als JJJJ-MM-TT", () => {
  expect(validWishedDay("")).toBe(true);
  expect(validWishedDay("2026-12-31")).toBe(true);
  expect(validWishedDay("31.12.2026")).toBe(false);
});

test("Website-Profil (#260, Vereine 1.2): Feldtext, Sichtbarkeitssatz, nur Geändertes", () => {
  const select = { code: "hauptspiel", label: "Hauptspiel", type: "select" as const, editable: true, value: "rl", options: [{ code: "tft", label: "TFT" }, { code: "rl", label: "Rocket League" }] };
  expect(websiteFieldText(select)).toBe("Rocket League");
  expect(websiteFieldText({ ...select, type: "multi", value: ["tft", "rl"] })).toBe("TFT, Rocket League");
  expect(websiteFieldText({ code: "s", label: "S", type: "boolean", editable: true, value: false })).toBe("Nein");
  expect(websiteFieldText({ code: "g", label: "G", type: "text", editable: true, value: null })).toBe("");
  expect(websiteStateLine({ consent: "", given: false })).toMatch(/keine Einwilligung/);
  expect(websiteStateLine({ consent: "profil", given: false })).toMatch(/erst, wenn du/);
  expect(websiteStateLine({ consent: "profil", given: true })).toMatch(/zeigt dieses Profil/);
  const profile = { fields: [select, { code: "dabei", label: "Dabei", type: "date" as const, editable: false, value: "2023-01-01" }, { code: "g", label: "G", type: "text" as const, editable: true, value: "a" }] };
  expect(changedWebsiteFields(profile, { hauptspiel: "rl", dabei: "2024-01-01", g: "b" })).toEqual({ g: "b" });
});

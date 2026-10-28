import { blockedPlayers, idText, leagueIdNotice, missingIdsLine, profileValues } from "./leagueIds";

const FIELDS = [{ key: "activision_id", label: "Activision-ID" }];
const ENTRY = {
  title: "Testliga · Season 1",
  state: "locked",
  text: "Testloewe#1234567",
  locked: { activision_id: "Testloewe#1234567" },
  fields: FIELDS,
  identity_slug: "hauptspiel",
  game_slug: "version",
};

test("die ID steht wie beim Server: ein Feld als Wert, mehrere mit Namen", () => {
  expect(idText(FIELDS, { activision_id: " Testloewe#1 " })).toBe("Testloewe#1");
  expect(idText(FIELDS, {})).toBeNull();
  expect(idText([...FIELDS, { key: "platform", label: "Plattform" }], { activision_id: "A#1", platform: "PC" }))
    .toBe("Activision-ID: A#1 · Plattform: PC");
});

test("die ID des Hauptspiels gilt für die Version, ein eigener Wert der Version geht vor", () => {
  expect(profileValues(ENTRY, { hauptspiel: { activision_id: "Haupt#1" } })).toEqual({ activision_id: "Haupt#1" });
  expect(profileValues(ENTRY, { hauptspiel: { activision_id: "Haupt#1" }, version: { activision_id: "Version#2" } }))
    .toEqual({ activision_id: "Version#2" });
});

test("nach einer Profiländerung sagt der Hinweis, dass in der laufenden Liga die gemeldete ID weiter gilt", () => {
  const same = leagueIdNotice(ENTRY, { hauptspiel: { activision_id: "Testloewe#1234567" } });
  expect(same.tone).toBe("info");

  const changed = leagueIdNotice(ENTRY, { hauptspiel: { activision_id: "Neu#7654321" } });

  expect(changed.tone).toBe("warn");
  expect(changed.text).toContain("gilt weiter Testloewe#1234567");
  expect(changed.text).toContain("Liga-Leitung freigeben");
});

test("ohne festgehaltene ID: fehlt sie, warnt der Hinweis; steht sie im Profil, wird sie beim Aufstellen festgehalten", () => {
  const open = { ...ENTRY, state: "missing", text: null, locked: {} };
  expect(leagueIdNotice(open, {}).tone).toBe("warn");
  expect(leagueIdNotice(open, {}).text).toContain("nicht aufgestellt");
  const typed = leagueIdNotice(open, { hauptspiel: { activision_id: "Testloewe#1" } });
  expect(typed.tone).toBe("info");
  expect(typed.text).toContain("Testloewe#1 wird beim ersten Aufstellen");
  expect(leagueIdNotice({ ...open, state: "late" }, {}).text).toContain("Stichtag");
  expect(leagueIdNotice({ ...ENTRY, fields: [] }, {})).toBeNull();
});

test("gesperrte Spieler und fehlende IDs werden benannt", () => {
  expect(blockedPlayers([{ id: "a", name: "Mila", lineup_blocked: "Activision-ID fehlt im Profil." }, { id: "b", name: "Tom" }]))
    .toEqual([{ id: "a", name: "Mila", reason: "Activision-ID fehlt im Profil." }]);
  expect(missingIdsLine([{ name: "Ida", ok: false }, { name: "Tom", ok: true }], "Activision-ID"))
    .toBe("Ohne gültige Activision-ID: Ida. Zuteilen geht trotzdem – aufgestellt werden kann erst, wer die ID hat.");
  expect(missingIdsLine([{ name: "Tom", ok: true }])).toBe("");
});

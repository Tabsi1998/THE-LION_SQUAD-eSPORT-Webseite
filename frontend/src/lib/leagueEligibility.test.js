import { ELIGIBILITY_LABELS, ageLabel, eligibilityNotice, hasSeasonRules, requirementHint, rulesLines, windowText } from "./leagueEligibility";

const ALL = {
  min_squad_size: 3, max_squad_size: 50, one_team_per_season: true, min_age: 18, new_player_wait_days: 7, roster_deadline: "2027-03-01",
  transfer_windows: [{ start_date: "2027-04-01", end_date: "2027-04-07", label: "Frühjahr" }], transfer_open: true,
};

test("jede Regel steht in einem eigenen Satz, ohne Regel nichts", () => {
  const lines = rulesLines(ALL).join(" | ");
  expect(lines).toContain("Kader: 3 bis 50 Spieler");
  expect(lines).toContain("nur für ein Team");
  expect(lines).toContain("Mindestalter: 18 Jahre");
  expect(lines).toContain("7 Tage, nach einem Transfer immer");
  expect(lines).toContain("1.3.2027");
  expect(lines).toContain("Frühjahr: 1.4.2027 bis 7.4.2027 (gerade offen)");
  expect(rulesLines({ one_team_per_season: true, transfer_windows: [] }).join()).toContain("Transfers gibt es in dieser Season nicht");
  expect(rulesLines({ min_squad_size: 4 })).toEqual(["Kader: mindestens 4 Spieler"]);
  expect(rulesLines(null)).toEqual([]);
});

test("ein Fenster ohne Namen", () => {
  expect(windowText({ start_date: "2027-04-01", end_date: "2027-04-07" })).toBe("1.4.2027 bis 7.4.2027");
});

test("vom Alter ist nur erfüllt oder fehlt sichtbar", () => {
  expect(ageLabel("met")).toBe("Alter erfüllt");
  expect(ageLabel("missing")).toBe("Geburtsdatum fehlt");
  expect(ageLabel(null)).toBe("");
});

test("der eigene Hinweis sagt, was zu tun ist", () => {
  const missing = eligibilityNotice({ title: "Liga · Season 1", state: "age_missing", ok: false, min_age: 18 });
  expect(missing.tone).toBe("warn");
  expect(missing.text).toContain("Geburtsdatum");
  expect(eligibilityNotice({ title: "L", state: "waiting", ok: false, reason: "Neu im Kader: darf ab 09.11.2026, 12:00 spielen." }).text).toContain("darf ab");
  expect(eligibilityNotice({ title: "L", state: "locked", ok: true, age: "met" })).toEqual({ tone: "info", text: "L: Altersvorgabe erfüllt." });
  expect(eligibilityNotice({ title: "L", state: "locked", ok: true, age: null })).toBeNull();
});

test("der Hinweis im Kader-Dialog nennt nur, was die Season trägt", () => {
  expect(requirementHint({ min_size: 3 })).toBe("");
  const text = requirementHint({ min_size: 3, max_size: 50, min_age: 18, transfers_open: false });
  expect(text).toContain("höchstens 50");
  expect(text).toContain("Geburtsdatum");
  expect(text).toContain("Transfer");
});

test("Seasons ohne Regeln bleiben bei der einfachen Liste", () => {
  expect(hasSeasonRules({ one_team_per_season: false, min_age: 0, new_player_wait_days: 0 })).toBe(false);
  expect(hasSeasonRules({ min_age: 18 })).toBe(true);
  expect(hasSeasonRules({ platform: { allowed: [], crossplay: true } })).toBe(false);
  expect(hasSeasonRules({ platform: { allowed: ["PC"] } })).toBe(true);
});

test("die Plattform steht als eigene Sätze bei den Regeln, Stand und Grund mit eigenem Wort (#2270)", () => {
  const lines = rulesLines({ min_squad_size: 4, platform: { field_label: "Plattform", allowed: ["PC"], crossplay: false, input_device: null } });
  expect(lines).toEqual(["Kader: mindestens 4 Spieler", "Plattform: nur PC.", "Crossplay: aus."]);
  expect(ELIGIBILITY_LABELS.platform_not_allowed).toBe("Plattform nicht erlaubt");
  expect(ELIGIBILITY_LABELS.platform_missing).toBe("Plattform fehlt");
  const own = eligibilityNotice({ title: "L", state: "platform_not_allowed", ok: false, reason: "Diese Season ist nur für PC – angegeben ist PlayStation." });
  expect(own).toEqual({ tone: "warn", text: "L: Diese Season ist nur für PC – angegeben ist PlayStation." });
});

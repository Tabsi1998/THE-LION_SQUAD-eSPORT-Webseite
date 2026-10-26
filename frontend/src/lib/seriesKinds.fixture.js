// Nur für Tests (#2024): Art-Profile wie aus backend/services/series_kinds.py (Felder und Begriffe), damit die Tests
// der Oberfläche mit dem Profil rechnen können, das der Server liefert.

const COMMON = { no_round: "Noch kein Termin", open_round: "Termin folgt" };

export const RACING_PROFILE = {
  kind: "racing",
  label: "Rennliga",
  fields: {
    venue: true, country: true, session: true, opponent: false, race_details: true, race_extras: true, race_bonuses: true,
    team_scoring: true, start_number: true, day_rounds: false, double_up: false, name_tags: false,
    marks: ["dnf", "dns", "dsq", "fastest_lap", "pole"], result_needs_day: true, original_kinds: ["qualifying", "sprint", "race", "table", "other"],
  },
  vocab: {
    round_one: "Rennen", round_many: "Rennen", round_dative: "Rennen", progress_verb: "gewertet", next_round: "Nächstes Rennen",
    code_prefix: "R", person_one: "Fahrer", person_many: "Fahrer", club_people: "Vereinsfahrer", place_title: "Bester Fahrer",
    standings_label: "Fahrerwertung", team_scoring: "Teamwertung", venue_label: "Strecke oder Ort", since_previous: "seit der Runde davor", after_first: "nach der ersten gewerteten Runde", ...COMMON,
  },
  templates: ["organizer", "formula_1"],
  placeholders: { lineage_title: "Lion Racing F1", lineage_label: "F1", round_code: "R1" },
  examples: { calendar_paste: "R1 · 05.11. · Strecke\nR2 · 12.11. 20:00 · Strecke\nR3 Strecke", season_table: "Pos Fahrer Team R1 R2 R3 Pkt" },
};

export const SERIES_PROFILE = {
  kind: "series",
  label: "Turnierserie",
  fields: {
    venue: false, country: false, session: false, opponent: false, race_details: false, race_extras: false, race_bonuses: false,
    team_scoring: false, start_number: false, day_rounds: true, double_up: true, name_tags: true, marks: ["dns", "dsq", "left"],
    result_needs_day: true, original_kinds: ["scoreboard", "table", "other"],
  },
  vocab: {
    round_one: "Turniertag", round_many: "Turniertage", round_dative: "Turniertagen", progress_verb: "gewertet",
    next_round: "Nächster Turniertag", code_prefix: "T", person_one: "Spieler", person_many: "Spieler", club_people: "Vereinsspieler",
    place_title: "Gesamtwertung", standings_label: "Gesamtwertung", team_scoring: "Double Up", venue_label: "", since_previous: "seit dem Turniertag davor", after_first: "nach dem ersten gewerteten Turniertag", ...COMMON,
  },
  templates: ["organizer", "tft"],
  placeholders: { lineage_title: "TFT Masters", lineage_label: "TFT", round_code: "T1" },
  examples: { calendar_paste: "T1 · offen\nT2 · 12.11. 20:00\nT3", season_table: "Pos Spieler T1 T2 T3 Pkt" },
};

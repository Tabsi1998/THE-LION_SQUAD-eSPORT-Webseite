export const RULE_PRESETS = [
  {
    key: "online",
    label: "Online",
    description: "Spieler melden Ergebnisse, Termine koennen vorgeschlagen werden.",
    values: { event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal" },
  },
  {
    key: "local",
    label: "Vor Ort",
    description: "Turnierleitung oder Station-Crew wertet und plant fix.",
    values: { event_mode: "local", result_entry_mode: "staff_only", schedule_mode: "fixed_by_staff" },
  },
  {
    key: "hybrid",
    label: "Hybrid",
    description: "Staff kann eingreifen, Spieleraktionen bleiben je nach Phase möglich.",
    values: { event_mode: "hybrid", result_entry_mode: "hybrid", schedule_mode: "hybrid" },
  },
];

export function effectiveRuleModes(source = {}) {
  const eventMode = source.event_mode || "online";
  return {
    event_mode: eventMode,
    result_entry_mode: source.result_entry_mode || (eventMode === "local" ? "staff_only" : "player_confirmed"),
    schedule_mode: source.schedule_mode || (eventMode === "local" ? "fixed_by_staff" : "player_proposal"),
  };
}

export function rulePresetKey(source = {}) {
  const effective = effectiveRuleModes(source);
  const preset = RULE_PRESETS.find((item) => (
    item.values.event_mode === effective.event_mode
    && item.values.result_entry_mode === effective.result_entry_mode
    && item.values.schedule_mode === effective.schedule_mode
  ));
  return preset?.key || "custom";
}

export function rulePresetWarnings(source = {}) {
  const effective = effectiveRuleModes(source);
  const warnings = [];
  if (effective.event_mode === "local" && effective.result_entry_mode !== "staff_only") {
    warnings.push("Vor-Ort-Turnier mit Spieler-Ergebnismeldung.");
  }
  if (effective.event_mode === "local" && effective.schedule_mode !== "fixed_by_staff") {
    warnings.push("Vor-Ort-Turnier mit Spieler-Terminabstimmung.");
  }
  if (effective.event_mode === "online" && effective.result_entry_mode === "staff_only") {
    warnings.push("Online-Turnier ohne Spieler-Ergebnismeldung.");
  }
  return warnings;
}

export function ruleModeSummary(source = {}) {
  const effective = effectiveRuleModes(source);
  const result = {
    staff_only: "Ergebnisse nur Staff",
    player_confirmed: "Ergebnisse durch beide Parteien",
    hybrid: "Ergebnisse hybrid",
  }[effective.result_entry_mode] || effective.result_entry_mode;
  const schedule = {
    fixed_by_staff: "Termine fix durch Staff",
    player_proposal: "Terminvorschlaege durch Spieler",
    hybrid: "Terminplanung hybrid",
  }[effective.schedule_mode] || effective.schedule_mode;
  return `${result} · ${schedule}`;
}

// Veto der Liga (#1618, docs/LIGA.md D.3): die Vorlage je Season live prüfen (dieselben Sätze wie der Server für Positionen, Modusfolge
// und Poolgrößen - die Suche bei „jede Map nur einmal je Serie“ und der Abgleich mit dem gespeicherten Pool kommen vom Server) und die
// Sätze des Veto-Blocks auf der Matchseite. Der Server bleibt maßgeblich; hier geht es darum, dass man nichts Falsches eingibt.

// Kurz, damit die Art in der Zeile je Schritt nicht abgeschnitten wird; was Decider und Vorgabe sind, erklärt der Kasten darüber.
// „Vorgabe“ ist die Vorgabe der Woche (#2326): Die Map legt die Liga-Leitung je Spielwoche fest, das System setzt sie.
export const KIND_OPTIONS = [["ban", "Sperren"], ["pick", "Wählen"], ["decider", "Decider"], ["preset", "Vorgabe"]];
/** Schritte, die das System setzt - ohne Team. */
export const SYSTEM_KINDS = ["decider", "preset"];
export const isSystemKind = (kind) => SYSTEM_KINDS.includes(kind);
export const TEAM_OPTIONS = [["A", "Team A"], ["B", "Team B"]];
export const TEAM_A_OPTIONS = [["home", "Heimteam laut Spielplan"], ["draw", "Los je Spiel"]];
export const SECONDS = [10, 600];
export const STEPS_MAX = 60;

export const VETO_STATUS_LABELS = {
  waiting: "Veto wartet",
  running: "Veto läuft",
  paused: "Veto pausiert",
  done: "Spielreihenfolge steht",
  skipped: "Kein Veto in diesem Spiel",
};
/** Die Überschrift des Veto-Blocks: wartet das Veto auf die Vorgabe der Woche (#2326), sagt sie genau das. */
export function vetoHeadline(block) {
  if (block?.status === "waiting") return block.blocked ? "Veto wartet auf die Vorgabe der Woche" : "Vorgabe der Woche";
  return VETO_STATUS_LABELS[block?.status] || "Veto";
}

/** Die Rolle einer Map in der Spielreihenfolge als Zusatz hinter „Map 3“: Decider, Vorgabe der Woche - sonst nichts. */
export function plannedRoleLabel(role) {
  if (role === "decider") return "Decider";
  if (role === "preset") return "Vorgabe der Woche";
  return "";
}

export function emptyStep(mode = "") {
  return { kind: "ban", mode, team: "A", position: "" };
}

/** Einen Schritt nach oben oder unten schieben - am Rand passiert nichts. */
export function moveStep(steps, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= steps.length) return steps;
  const next = [...steps];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** „Team A sperrt eine Map (Stellung)“, „Team B wählt Map 4 (Suchen)“, „Die übrige Map wird Map 3 (Kontrolle)“ - wie der Server. */
export function stepSentence(step, labelOf = (mode) => mode) {
  const label = labelOf(step.mode) || step.mode || "?";
  if (step.kind === "decider") return `Die übrige Map wird Map ${step.position || "?"} (${label})`;
  if (step.kind === "preset") return `Die Liga-Leitung gibt Map ${step.position || "?"} je Spielwoche vor (${label})`;
  const who = `Team ${step.team || "?"}`;
  if (step.kind === "ban") return `${who} sperrt eine Map (${label})`;
  return `${who} wählt Map ${step.position || "?"} (${label})`;
}

const int = (value) => {
  const number = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(number) ? number : null;
};

/** Die Eingabe als Werte für den Server: Teams nur bei Sperre und Wahl, Positionen nur bei Wahl und Decider. */
export function vetoRulesPayload(form) {
  return {
    enabled: Boolean(form.enabled),
    team_a: form.team_a === "draw" ? "draw" : "home",
    step_seconds: int(form.step_seconds) ?? 60,
    steps: (form.steps || []).map((step) => ({
      kind: step.kind,
      mode: step.mode,
      team: isSystemKind(step.kind) ? null : step.team || null,
      position: step.kind === "ban" ? null : int(step.position),
    })),
  };
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * Was an der Vorlage nicht passt - dieselben Sätze wie `league_veto_rules.template_problems` im Server, soweit sie sich ohne
 * Datenbank rechnen lassen. `modes`: die Modi des Pools mit Zahl der Maps (`{mode, label, maps}`); `bestOf`, `order`, `repeat` wie die Season.
 */
export function templateProblems(form, { modes = [], bestOf = 1, order = [], repeat = "other_mode" } = {}) {
  const steps = vetoRulesPayload(form).steps;
  if (!steps.length) return ["Die Vorlage hat noch keine Schritte."];
  const haveOf = Object.fromEntries(modes.map((row) => [row.mode, Number(row.maps) || 0]));
  const labelOf = (mode) => modes.find((row) => row.mode === mode)?.label || mode;
  const best = Math.max(1, Number(bestOf) || 1);
  const sequence = (order || []).filter(Boolean);
  const out = [];
  steps.forEach((step, at) => {
    const number = at + 1;
    if (!step.mode) out.push(`Schritt ${number}: bitte den Modus wählen.`);
    else if (modes.length && !(step.mode in haveOf)) out.push(`Schritt ${number}: Der Modus „${labelOf(step.mode)}“ hat keine Maps im Pool.`);
    if (!isSystemKind(step.kind) && !step.team) out.push(`Schritt ${number}: bitte Team A oder Team B wählen.`);
    if (step.kind !== "ban" && (step.position == null || step.position < 1)) out.push(`Schritt ${number}: Position - bitte eine ganze Zahl ab 1.`);
  });
  if (out.length) return out;
  const taken = {};
  steps.forEach((step, at) => {
    if (step.kind === "ban") return;
    const number = at + 1;
    if (step.position > best) {
      out.push(`Schritt ${number}: Position ${step.position} gibt es bei Best of ${best} nicht.`);
      return;
    }
    (taken[step.position] ||= []).push(number);
    if (sequence.length) {
      const expected = sequence[(step.position - 1) % sequence.length];
      if (step.mode !== expected) out.push(`Schritt ${number}: Auf Position ${step.position} wird laut „Modus je Map“ ${labelOf(expected)} gespielt, nicht ${labelOf(step.mode)}.`);
    }
  });
  for (const [position, numbers] of Object.entries(taken).sort(([a], [b]) => Number(a) - Number(b))) {
    if (numbers.length > 1) out.push(`Position ${position} ist mehrfach belegt (Schritt ${numbers.join(" und ")}).`);
  }
  for (let position = 1; position <= best; position += 1) {
    if (!taken[position]) out.push(`Position ${position} ist nicht belegt – ohne Wahl oder Decider bleibt sie offen.`);
  }
  const counts = {};
  for (const step of steps) {
    const row = (counts[step.mode] ||= { bans: 0, picks: 0, deciders: 0, presets: 0 });
    if (step.kind === "ban") row.bans += 1;
    else if (step.kind === "pick") row.picks += 1;
    else if (step.kind === "preset") row.presets += 1;
    else row.deciders += 1;
  }
  for (const [mode, { bans, picks, deciders, presets }] of Object.entries(counts)) {
    const label = labelOf(mode);
    if (deciders > 1) out.push(`${label}: höchstens ein Decider je Modus.`);
    if (presets > 1) out.push(`${label}: höchstens eine Vorgabe der Woche je Modus.`);
    // Die Vorgabe der Woche ist von Anfang an aus dem Modus genommen - wo ihr Schritt steht, ändert am Decider nichts.
    const own = steps.filter((step) => step.mode === mode && step.kind !== "preset");
    if (deciders === 1 && own[own.length - 1].kind !== "decider") out.push(`${label}: Der Decider muss der letzte Schritt seines Modus sein.`);
    const have = haveOf[mode] || 0;
    if (!have) continue;
    const needed = bans + picks + deciders + presets;
    if (have < needed) {
      out.push(`${label}: ${plural(bans, "Sperre", "Sperren")} und ${plural(picks, "Wahl", "Wahlen")}${deciders ? " und ein Decider" : ""}${presets ? " und die Vorgabe der Woche" : ""} brauchen ${needed} Maps – der Pool hat ${have}.`);
    } else if (deciders === 1 && repeat !== "never" && have !== bans + picks + presets + 1) {
      out.push(`${label}: Der Decider braucht genau eine übrige Map – nach ${plural(bans, "Sperre", "Sperren")} und ${plural(picks, "Wahl", "Wahlen")}${presets ? " und der Vorgabe der Woche" : ""} bleiben ${have - bans - picks - presets}.`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- Vorgabe der Woche (#2326)

/** Die Modi mit einem Schritt „Vorgabe der Woche“ in einer Vorlage (Formular oder gespeichert). */
export function presetModes(steps) {
  return (steps || []).filter((step) => step.kind === "preset" && step.mode).map((step) => step.mode);
}

const presetKey = (week, mode) => `${week}|${mode}`;

/** Die gespeicherten Vorgaben als Formular: `{"<Woche>|<Modus>": map_id}`. */
export function presetsToForm(presets) {
  return Object.fromEntries((presets || []).map((row) => [presetKey(row.week, row.mode), row.map_id]));
}

/** Nur Vorgaben, deren Map im Pool ihres Modus steht - eine Map, die den Pool verlassen hat, zählt im Formular als „noch nicht gewählt“. */
export function knownPresets(presets, modes) {
  const known = Object.fromEntries((modes || []).map((row) => [row.mode, new Set((row.maps || []).map((item) => item.map_id))]));
  return (presets || []).filter((row) => known[row.mode]?.has(row.map_id));
}

export function presetValue(form, week, mode) {
  return (form || {})[presetKey(week, mode)] || "";
}

export function withPreset(form, week, mode, mapId) {
  return { ...(form || {}), [presetKey(week, mode)]: mapId || "" };
}

/** Das Formular als Liste für den Server - nur gewählte Maps, nur Wochen und Modi, die es gibt. */
export function presetsPayload(form, weeks, modes) {
  const out = [];
  for (const { week } of weeks || []) {
    for (const { mode } of modes || []) {
      const mapId = presetValue(form, week, mode);
      if (mapId) out.push({ week, mode, map_id: mapId });
    }
  }
  return out;
}

/** Die Wochen, in denen für mindestens einen Modus noch keine Map gewählt ist. */
export function missingWeeks(form, weeks, modes) {
  return (weeks || []).filter(({ week }) => (modes || []).some(({ mode }) => !presetValue(form, week, mode))).map(({ week }) => week);
}

/** „3, 4 und 5“ */
export function weekList(weeks) {
  const names = (weeks || []).map(String);
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
}

const dayMonth = (day) => {
  const [, month, date] = String(day || "").split("-");
  return month && date ? `${date}.${month}.` : "";
};

/** „10.11.–16.11.“ aus den Wiener Kalendertagen einer Spielwoche - leer, wenn der Kalender der Season nicht so weit reicht. */
export function weekDates(row) {
  const from = dayMonth(row?.start_day);
  const to = dayMonth(row?.end_day);
  return from && to ? `${from}–${to}` : "";
}

/** Der Vorschlag „rotiert durch den Pool“ über das Formular gelegt - alle Wochen, danach einzeln änderbar. */
export function applyRotation(form, rotation) {
  return { ...(form || {}), ...presetsToForm(rotation) };
}

/** Eine Zeile der Historie: „Spielwoche 1 · Kontrolle: Kai → Ruine“ (neu: „– → Kai“, entfernt: „Kai → –“). */
export function presetChangeLine(change, modes) {
  const mode = (modes || []).find((row) => row.mode === change.mode);
  const name = (mapId) => (mapId ? mode?.maps?.find((item) => item.map_id === mapId)?.name || "eine Map außerhalb des Pools" : "–");
  return `Spielwoche ${change.week} · ${mode?.label || change.mode}: ${name(change.from)} → ${name(change.to)}`;
}

// ---------------------------------------------------------------- Matchseite

/** Der eine Satz unter der Überschrift des Veto-Blocks. */
export function vetoText(block) {
  if (!block) return "";
  const current = block.current;
  const name = current?.name || "die Gegenseite";
  switch (block.status) {
    case "waiting":
      // Vorgabe der Woche fehlt (#2326): Das Veto beginnt nicht - der Server sagt, für welche Woche und welchen Modus.
      if (block.blocked?.text) return block.blocked.text;
      return "Sobald beide Seiten eingecheckt sind, beginnt das Map-Veto – danach startet Map 1.";
    case "running":
      if (!current) return "Das Veto läuft.";
      if (current.kind === "decider") return `Die übrige Map wird Map ${current.position} – das setzt das System.`;
      if (current.kind === "preset") return `Die Vorgabe der Woche wird Map ${current.position} – das setzt das System.`;
      if (block.own_turn) return `Ihr seid am Zug: ${current.kind === "ban" ? "sperrt eine Map" : `wählt Map ${current.position}`} (${current.mode_label}). Nach ${block.step_seconds} Sekunden wählt das System.`;
      return `${name} ist am Zug: ${current.kind === "ban" ? "sperrt eine Map" : `wählt Map ${current.position}`} (${current.mode_label}).`;
    case "paused":
      return `Die Liga-Leitung hat das Veto angehalten${block.paused?.reason ? ` – ${block.paused.reason}` : ""}. Es geht weiter, sobald sie es fortsetzt.`;
    case "done":
      return "Die Spielreihenfolge steht – Map 1 kann beginnen.";
    case "skipped":
      return block.skipped_reason ? `In diesem Spiel läuft kein Veto: ${block.skipped_reason} Die Maps werden beim Ergebnis eingetragen.` : "In diesem Spiel läuft kein Veto.";
    default:
      return "";
  }
}

/** „Schritt 3 von 11 · Stellung · Team A wählt Map 1“ */
export function stepLabel(current) {
  if (!current) return "";
  const what = current.kind === "ban" ? "sperrt eine Map" : current.kind === "pick" ? `wählt Map ${current.position}`
    : current.kind === "preset" ? `Vorgabe der Woche für Map ${current.position}` : `Decider für Map ${current.position}`;
  return `Schritt ${current.number} von ${current.total} · ${current.mode_label} · ${current.name ? `${current.name} ${what}` : what}`;
}

/** Das Wort auf dem Knopf je Map: „Sperren“ oder „Wählen“. */
export function actionWord(kind) {
  return kind === "ban" ? "Sperren" : "Wählen";
}

/** Wohin der Countdown zählt - die Frist des laufenden Schritts, sonst nichts. */
export function vetoDeadline(block) {
  if (block?.status !== "running" || !block.current?.deadline_at) return null;
  const at = new Date(block.current.deadline_at).getTime();
  return Number.isFinite(at) ? at : null;
}

/** Wie viel vom Ring noch übrig ist (1 = voll) - über die Zeit je Schritt. */
export function vetoRingShare(block, now = Date.now()) {
  const target = vetoDeadline(block);
  const seconds = Number(block?.step_seconds) || 0;
  if (!target || !seconds) return 1;
  return Math.min(1, Math.max(0, (target - now) / (seconds * 1000)));
}

/** Die Zeile einer Map in der Übersicht je Modus: „gesperrt von Loewen“, „Map 1 · Loewen“, „Map 3 · Decider“, „offen“. */
export function mapStatusText(row) {
  if (!row) return "";
  if (row.status === "banned") return row.by_name ? `gesperrt von ${row.by_name}` : "gesperrt";
  if (row.status === "picked") return `Map ${row.position}${row.by_name ? ` · ${row.by_name}` : ""}`;
  if (row.status === "decider") return `Map ${row.position} · Decider`;
  if (row.status === "preset") return `Map ${row.position} · Vorgabe der Woche`;
  // Jede Map nur einmal je Serie (`never`): in einem anderen Modus schon gewählt - nicht „offen“.
  if (row.status === "elsewhere") return `in anderem Modus gespielt${row.position ? ` (Map ${row.position})` : ""}`;
  return "offen";
}

/** Eine Zeile im Verlauf: „1. Loewen sperrt Glut (Stellung)“, „11. Decider: Hafen → Map 3 (Kontrolle) · automatisch“. */
export function historyLine(row) {
  if (!row) return "";
  const auto = row.via === "auto" && row.kind !== "decider" ? " · Zeit abgelaufen, das System hat gewählt" : "";
  if (row.kind === "decider") return `${row.index + 1}. Decider: ${row.map_name} → Map ${row.position} (${row.mode_label})`;
  if (row.kind === "preset") return `${row.index + 1}. Vorgabe der Woche: ${row.map_name} → Map ${row.position} (${row.mode_label})`;
  if (row.kind === "ban") return `${row.index + 1}. ${row.name || "?"} sperrt ${row.map_name} (${row.mode_label})${auto}`;
  return `${row.index + 1}. ${row.name || "?"} wählt ${row.map_name} → Map ${row.position} (${row.mode_label})${auto}`;
}

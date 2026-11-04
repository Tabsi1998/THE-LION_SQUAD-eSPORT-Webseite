// Veto der Liga (#1618, docs/LIGA.md D.3): die Vorlage je Season live prüfen (dieselben Sätze wie der Server für Positionen, Modusfolge
// und Poolgrößen - die Suche bei „jede Map nur einmal je Serie“ und der Abgleich mit dem gespeicherten Pool kommen vom Server) und die
// Sätze des Veto-Blocks auf der Matchseite. Der Server bleibt maßgeblich; hier geht es darum, dass man nichts Falsches eingibt.

// Kurz, damit die Art in der Zeile je Schritt nicht abgeschnitten wird; was der Decider ist, erklärt der Kasten darüber.
export const KIND_OPTIONS = [["ban", "Sperren"], ["pick", "Wählen"], ["decider", "Decider"]];
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
      team: step.kind === "decider" ? null : step.team || null,
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
    if (step.kind !== "decider" && !step.team) out.push(`Schritt ${number}: bitte Team A oder Team B wählen.`);
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
    const row = (counts[step.mode] ||= { bans: 0, picks: 0, deciders: 0 });
    if (step.kind === "ban") row.bans += 1;
    else if (step.kind === "pick") row.picks += 1;
    else row.deciders += 1;
  }
  for (const [mode, { bans, picks, deciders }] of Object.entries(counts)) {
    const label = labelOf(mode);
    if (deciders > 1) out.push(`${label}: höchstens ein Decider je Modus.`);
    const own = steps.filter((step) => step.mode === mode);
    if (deciders === 1 && own[own.length - 1].kind !== "decider") out.push(`${label}: Der Decider muss der letzte Schritt seines Modus sein.`);
    const have = haveOf[mode] || 0;
    if (!have) continue;
    const needed = bans + picks + deciders;
    if (have < needed) {
      out.push(`${label}: ${plural(bans, "Sperre", "Sperren")} und ${plural(picks, "Wahl", "Wahlen")}${deciders ? " und ein Decider" : ""} brauchen ${needed} Maps – der Pool hat ${have}.`);
    } else if (deciders === 1 && repeat !== "never" && have !== bans + picks + 1) {
      out.push(`${label}: Der Decider braucht genau eine übrige Map – nach ${plural(bans, "Sperre", "Sperren")} und ${plural(picks, "Wahl", "Wahlen")} bleiben ${have - bans - picks}.`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- Matchseite

/** Der eine Satz unter der Überschrift des Veto-Blocks. */
export function vetoText(block) {
  if (!block) return "";
  const current = block.current;
  const name = current?.name || "die Gegenseite";
  switch (block.status) {
    case "waiting":
      return "Sobald beide Seiten eingecheckt sind, beginnt das Map-Veto – danach startet Map 1.";
    case "running":
      if (!current) return "Das Veto läuft.";
      if (current.kind === "decider") return `Die übrige Map wird Map ${current.position} – das setzt das System.`;
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
  const what = current.kind === "ban" ? "sperrt eine Map" : current.kind === "pick" ? `wählt Map ${current.position}` : `Decider für Map ${current.position}`;
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
  // Jede Map nur einmal je Serie (`never`): in einem anderen Modus schon gewählt - nicht „offen“.
  if (row.status === "elsewhere") return `in anderem Modus gespielt${row.position ? ` (Map ${row.position})` : ""}`;
  return "offen";
}

/** Eine Zeile im Verlauf: „1. Loewen sperrt Glut (Stellung)“, „11. Decider: Hafen → Map 3 (Kontrolle) · automatisch“. */
export function historyLine(row) {
  if (!row) return "";
  const auto = row.via === "auto" && row.kind !== "decider" ? " · Zeit abgelaufen, das System hat gewählt" : "";
  if (row.kind === "decider") return `${row.index + 1}. Decider: ${row.map_name} → Map ${row.position} (${row.mode_label})`;
  if (row.kind === "ban") return `${row.index + 1}. ${row.name || "?"} sperrt ${row.map_name} (${row.mode_label})${auto}`;
  return `${row.index + 1}. ${row.name || "?"} wählt ${row.map_name} → Map ${row.position} (${row.mode_label})${auto}`;
}

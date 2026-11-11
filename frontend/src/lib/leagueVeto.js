// Veto der Liga (#1618, docs/LIGA.md D.3): die Vorlage je Season live prüfen (dieselben Sätze wie der Server für Positionen, Modusfolge
// und Poolgrößen - die Suche bei „jede Map nur einmal je Serie“ und der Abgleich mit dem gespeicherten Pool kommen vom Server) und die
// Sätze des Veto-Blocks auf der Matchseite. Der Server bleibt maßgeblich; hier geht es darum, dass man nichts Falsches eingibt.
// Live-Oberfläche (D.4, #1651): Takt des Nachfragens, Countdown nach der Serverzeit, Zeitleiste, Karten und was davon aufleuchtet.
import { serverOffset } from "@/seasons/clock";

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
/**
 * Die Überschrift des Veto-Blocks: wartet das Veto auf die Vorgabe der Woche (#2326), sagt sie genau das - und steht die
 * nachgetragene Vorgabe, dass jetzt beide Seiten „Bereit zum Veto“ tippen (Nr. 127).
 */
export function vetoHeadline(block) {
  // Die fehlende Vorgabe geht vor: Auch wenn schon eine Seite bereit ist, wartet das Veto zuerst auf sie.
  if (block?.status === "waiting" && block.blocked) return "Veto wartet auf die Vorgabe der Woche";
  if (block?.status === "waiting" && block.start) return block.presets?.length ? "Vorgabe steht – bereit zum Veto?" : "Bereit zum Veto?";
  if (block?.status === "waiting") return "Vorgabe der Woche";
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

export function presetValue(form, week, mode) {
  return (form || {})[presetKey(week, mode)] || "";
}

/**
 * Steht in dieser Woche eine Map, die den Pool ihres Modus verlassen hat? Sie bleibt im Formular stehen (und geht beim Speichern
 * unverändert mit), bis die Leitung neu wählt - still verworfen wird sie nicht.
 */
export function presetStale(form, week, mode) {
  const value = presetValue(form, week, mode?.mode);
  return Boolean(value) && !(mode?.maps || []).some((item) => item.map_id === value);
}

/** Die Wochen mit einer Vorgabe außerhalb des Pools - dort beginnt das Veto nicht, bis neu gewählt ist. */
export function staleWeeks(form, weeks, modes) {
  return (weeks || []).filter(({ week }) => (modes || []).some((mode) => presetStale(form, week, mode))).map(({ week }) => week);
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

/** Wochen, die der Vorschlag nie anfasst: Die Woche ist vorbei, oder in ihr hat schon ein Veto begonnen. */
export function weekLocked(row) {
  return Boolean(row?.past || row?.started);
}

/**
 * Der Vorschlag „rotiert durch den Pool“ über das Formular gelegt - danach ist jede Woche einzeln änderbar. Ohne `overwrite` füllt er
 * nur leere Wochen (was die Leitung schon gewählt hat, bleibt); mit `overwrite` („Alle neu verteilen“) ersetzt er jede Woche. Vergangene
 * Wochen und Wochen mit begonnenem Veto bleiben in beiden Fällen, wie sie sind.
 */
export function applyRotation(form, rotation, weeks = [], { overwrite = false } = {}) {
  const locked = new Set((weeks || []).filter(weekLocked).map((row) => row.week));
  const next = { ...(form || {}) };
  for (const row of rotation || []) {
    if (locked.has(row.week) || (!overwrite && presetValue(next, row.week, row.mode))) continue;
    next[presetKey(row.week, row.mode)] = row.map_id;
  }
  return next;
}

/** So viele schon gewählte Wochen bekämen durch „Alle neu verteilen“ eine andere Map - für die Rückfrage. */
export function overwriteCount(form, rotation, weeks = []) {
  const next = applyRotation(form, rotation, weeks, { overwrite: true });
  const changed = new Set();
  for (const row of rotation || []) {
    const before = presetValue(form, row.week, row.mode);
    if (before && before !== presetValue(next, row.week, row.mode)) changed.add(row.week);
  }
  return changed.size;
}

/** Die Wochen, deren Auswahl vom gespeicherten Stand abweicht - sie bleiben bis zum Speichern markiert. */
export function changedWeeks(form, saved, weeks, modes) {
  return (weeks || []).filter(({ week }) => (modes || []).some(({ mode }) => presetValue(form, week, mode) !== presetValue(saved, week, mode)))
    .map(({ week }) => week);
}

/** Eine Zeile der Historie: „Spielwoche 1 · Kontrolle: Kai → Ruine“ (neu: „– → Kai“, entfernt: „Kai → –“). */
export function presetChangeLine(change, modes) {
  const mode = (modes || []).find((row) => row.mode === change.mode);
  const name = (mapId) => (mapId ? mode?.maps?.find((item) => item.map_id === mapId)?.name || "eine Map außerhalb des Pools" : "–");
  return `Spielwoche ${change.week} · ${mode?.label || change.mode}: ${name(change.from)} → ${name(change.to)}`;
}

// ---------------------------------------------------------------- Matchseite

/** Der Satz im Stand „bereit zum Veto?“: wer schon bereit ist und was die eigene Seite jetzt tut. */
export function readyText(start) {
  const other = (start?.sides || []).find((side) => !side.own)?.name || "die Gegenseite";
  // Beide bereit und trotzdem kein Veto: Das Veto beginnt gleich von selbst - bis dahin kann jede Seite zurücknehmen.
  if ((start?.sides || []).length > 1 && start.sides.every((side) => side.ready)) return "Beide Seiten sind bereit – das Veto beginnt gleich.";
  if (start?.own_ready) return "Ihr seid bereit – wartet auf die Gegenseite.";
  if (start?.can_ready && start.other_ready) return `${other} ist bereit – tippt auf „Bereit zum Veto“, dann beginnt es sofort.`;
  if (start?.can_ready) return "Tippt auf „Bereit zum Veto“, sobald ihr so weit seid. Das Veto beginnt, wenn beide Seiten bereit sind.";
  const ready = (start?.sides || []).filter((side) => side.ready).map((side) => side.name);
  return ready.length ? `${ready.join(" und ")} ist bereit. Das Veto beginnt, sobald beide Seiten „Bereit zum Veto“ getippt haben.`
    : "Das Veto beginnt, sobald beide Seiten „Bereit zum Veto“ getippt haben.";
}

/** Der eine Satz unter der Überschrift des Veto-Blocks. */
export function vetoText(block) {
  if (!block) return "";
  const current = block.current;
  const name = current?.name || "die Gegenseite";
  switch (block.status) {
    case "waiting":
      // Vorgabe der Woche fehlt (#2326): Das Veto beginnt nicht - der Server sagt, für welche Woche und welchen Modus.
      if (block.blocked?.text) return block.blocked.text;
      // Nachgetragen: Das Veto beginnt nicht von selbst, sondern wenn beide Seiten „Bereit zum Veto“ getippt haben - vorher läuft
      // keine Zeit. Der Satz sagt jeder Seite, wer schon bereit ist und was sie jetzt tut.
      if (block.start) return readyText(block.start);
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

/**
 * Wohin der Countdown zählt - die Frist des laufenden Schritts, sonst nichts. `offset` (ms, Serveruhr minus Geräteuhr, #1651) rechnet
 * die Frist des Servers in die Zeit des Geräts um: Geht das Gerät zwei Minuten nach, zählt der Countdown trotzdem richtig.
 */
export function vetoDeadline(block, offset = 0) {
  if (block?.status !== "running" || !block.current?.deadline_at) return null;
  const at = new Date(block.current.deadline_at).getTime();
  return Number.isFinite(at) ? at - (Number(offset) || 0) : null;
}

/** Wie viel vom Ring noch übrig ist (1 = voll) - über die Zeit je Schritt. */
export function vetoRingShare(block, now = Date.now(), offset = 0) {
  const target = vetoDeadline(block, offset);
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

// ---------------------------------------------------------------- Live (D.4, #1651)

/**
 * Wie oft die Seite nachfragt (ms): schnell, solange das Veto läuft; ruhiger in der Pause (dort ändert nur die Leitung etwas, und das
 * meldet der Änderungsstrom ohnehin); beim Warten auf „Bereit“ oder die Vorgabe nur, wenn beide Seiten eingecheckt sind. 0: gar nicht.
 * Im Hintergrund-Tab fragt die Seite nie nach (`useVetoPolling`).
 */
export const VETO_POLL_MS = Object.freeze({ running: 2000, paused: 5000, waiting: 3000 });

export function vetoPollMs(block, { bothIn = false } = {}) {
  if (!block) return 0;
  if (block.status === "running") return VETO_POLL_MS.running;
  if (block.status === "paused") return VETO_POLL_MS.paused;
  if (block.status === "waiting" && (block.blocked || block.start) && bothIn) return VETO_POLL_MS.waiting;
  return 0;
}

/**
 * Abstand der Serveruhr zur Geräteuhr (ms) aus der Serverzeit einer Antwort (`server_now`). Ohne Anfragezeit zählt der Empfang - die
 * halbe Laufzeit (meist unter 0,1 s) bleibt dann als Fehler, für einen Countdown in Sekunden genug. Ohne gültige Zeit: 0.
 */
export function vetoClockOffset(serverNowIso, receivedAt = Date.now(), requestedAt = receivedAt) {
  return serverOffset(serverNowIso, requestedAt, receivedAt);
}

/** Die ganzen Sekunden bis zur Frist (aufgerundet, nie unter 0) - `null` ohne Frist. */
export function secondsLeft(deadline, now = Date.now()) {
  if (deadline == null || !Number.isFinite(deadline)) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** Ab hier betont der Countdown die letzten Sekunden (Farbe, ohne „Bewegung reduzieren“ ein ruhiger Puls). */
export const URGENT_SECONDS = 10;
export const isUrgent = (seconds) => seconds != null && seconds <= URGENT_SECONDS;

/** Wann der Bildschirmleser die Zeit ansagt: bei 30, 10 und 5 Sekunden und beim Ablauf - nicht jede Sekunde. */
export const ANNOUNCE_AT = Object.freeze([30, 10, 5]);

/**
 * Der Satz für die höfliche Ansage (`aria-live="polite"`): Er ändert sich nur an den Marken, so sagt der Bildschirmleser nicht jede
 * Sekunde an. Über 30 Sekunden leer.
 */
export function countdownAnnouncement(seconds) {
  if (seconds == null) return "";
  if (seconds <= 0) return "Zeit abgelaufen – das System wählt.";
  const mark = [...ANNOUNCE_AT].reverse().find((value) => seconds <= value);
  return mark ? `Noch ${mark} Sekunden.` : "";
}

/** Team A ist blau, Team B gold - Ring, Ablauf und Karten zeigen damit, wer gesperrt oder gewählt hat. */
export const SIDE_TONE = Object.freeze({ A: "a", B: "b" });
export const sideTone = (side) => SIDE_TONE[side] || "system";

/** Der Name einer Seite (A oder B) aus dem Block. */
export function sideName(block, side) {
  if (side === "A") return block?.team_a?.name || "Team A";
  if (side === "B") return block?.team_b?.name || "Team B";
  return "";
}

export const KIND_SHORT = Object.freeze({ ban: "Sperre", pick: "Wahl", decider: "Decider", preset: "Vorgabe" });

/** Der Ablauf als Zeitleiste: jeder Schritt mit Art, Seite und Modus - fertige mit Map, der laufende als `current`. */
export function timelineRows(block) {
  return (block?.plan || []).map((row) => ({
    ...row,
    key: `step-${row.index}`,
    kindLabel: KIND_SHORT[row.kind] || row.kind,
    who: row.side ? (row.name || `Team ${row.side}`) : row.kind === "preset" ? "Liga-Leitung" : "System",
    tone: sideTone(row.side),
    target: row.kind === "ban" ? "" : row.position ? `Map ${row.position}` : "",
    auto: row.via === "auto" && row.kind !== "decider" && row.kind !== "preset",
  }));
}

/** Der Satz zu einem Schritt der Zeitleiste für Bildschirmleser: „Schritt 3 von 11: Loewen wählt Map 1 (Stellung) – Hafen“. */
export function timelineLabel(row, total) {
  const what = row.kind === "ban" ? "sperrt eine Map" : row.kind === "pick" ? `wählt Map ${row.position}`
    : row.kind === "decider" ? `Decider für Map ${row.position}` : `Vorgabe der Woche für Map ${row.position}`;
  const state = row.state === "done" ? ` – ${row.map_name || "erledigt"}${row.auto ? ", das System hat gewählt" : ""}`
    : row.state === "current" ? " – läuft" : "";
  return `Schritt ${row.number} von ${total}: ${row.side ? `${row.who} ` : ""}${what} (${row.mode_label || row.mode})${state}`;
}

const cardKey = (mode, mapId) => `${mode}:${mapId}`;

/**
 * Die Karten des Bretts je Modus. `selectable`: die Seite am Zug kann die Karte jetzt antippen; `pickable`: die Karte gehört zur
 * Auswahl des laufenden Schritts (auch ausgegraut, mit Hinweis). `current`: der Modus des laufenden Schritts.
 */
export function boardGroups(block) {
  const current = block?.status === "running" || block?.status === "paused" ? block.current : null;
  const options = new Map((block?.options || []).map((option) => [option.map_id, option]));
  return (block?.remaining || []).map((group) => {
    const isCurrent = Boolean(current && current.mode === group.mode);
    return {
      ...group,
      current: isCurrent,
      cards: (group.maps || []).map((row, index) => {
        const option = isCurrent && block.can_pick ? options.get(row.map_id) || null : null;
        return {
          ...row, key: cardKey(group.mode, row.map_id), index, option,
          pickable: Boolean(option), selectable: Boolean(option?.allowed), tone: sideTone(row.side),
          statusText: mapStatusText(row),
        };
      }),
    };
  });
}

/**
 * Welche Karten seit dem letzten Stand eine Aktion bekommen haben und kurz aufleuchten: jede Wahl (auch Decider und Vorgabe) und jede
 * Sperre der Gegenseite - die eigene Sperre dimmt nur. Der erste Stand zählt nicht (beim Laden ist nichts neu), Zuschauer sehen jede
 * Aktion als neu. Gibt die Schlüssel `Modus:Map` zurück.
 */
export function freshCards(before, after, ownSide = null) {
  const out = new Set();
  if (!before || !after) return out;
  const was = new Map();
  for (const group of before) for (const row of group.maps || []) was.set(cardKey(group.mode, row.map_id), row.status);
  for (const group of after) {
    for (const row of group.maps || []) {
      const key = cardKey(group.mode, row.map_id);
      if (!was.has(key) || was.get(key) === row.status || row.status === "open" || row.status === "elsewhere") continue;
      if (row.status !== "banned" || !ownSide || row.side !== ownSide) out.add(key);
    }
  }
  return out;
}

/**
 * Ist die Antwort älter als der Stand, der schon da ist (Review zu #1651)? Antworten können sich überholen - eine langsame alte darf eine
 * schnellere neue nicht überschreiben. Maßgeblich ist die Serverzeit der Antwort (`server_now`); sind beide gleich oder fehlt sie, die
 * Version des Vetos. Eine kleinere Version mit neuerer Serverzeit ist ein neues Veto (neuer Termin) und gilt.
 */
export function isOlderVeto(current, next) {
  if (!current || !next) return false;
  const before = Date.parse(current.server_now || "");
  const after = Date.parse(next.server_now || "");
  if (Number.isFinite(before) && Number.isFinite(after) && after !== before) return after < before;
  return Number(next.version || 0) < Number(current.version || 0);
}

/**
 * Den kurzen Abruf (`GET /matches/{id}/veto`) in die geladene Matchseite übernehmen: Bleibt der Stand derselbe (Stand des Check-ins und
 * Status des Vetos), ersetzt er nur den Veto-Block - beim Captain in `checkin.veto`, beim Zuschauer in `veto_view`. Ändert sich der Stand
 * (das Veto beginnt, ist fertig, die Leitung pausiert), gibt es `null`: Dann lädt die Seite einmal ganz (Start-Knopf, Meldeformular). Eine
 * Antwort, die älter ist als der Stand auf der Seite (`isOlderVeto`), ändert nichts: Dann kommt `page` selbst zurück.
 */
export function mergeLiveVeto(page, live) {
  if (!page || !live?.veto) return null;
  const shown = page.checkin ? page.checkin.veto : page.veto_view;
  if (isOlderVeto(shown, live.veto)) return page;
  if (page.checkin) {
    if (!shown || shown.status !== live.veto.status || (live.state && live.state !== page.checkin.state)) return null;
    return { ...page, checkin: { ...page.checkin, veto: live.veto } };
  }
  if (shown && shown.status === live.veto.status) return { ...page, veto_view: live.veto };
  return null;
}

/** Der Name einer Karte für Bildschirmleser: Map, Zustand und - wenn sie antippbar ist - was das Antippen tut. */
export function cardLabel(card, kind) {
  const base = `${card.name}: ${card.statusText}`;
  if (card.selectable) return `${base} – antippen zum ${kind === "ban" ? "Sperren" : "Wählen"}`;
  if (card.pickable && card.option?.hint) return `${base} – ${card.option.hint}`;
  return base;
}

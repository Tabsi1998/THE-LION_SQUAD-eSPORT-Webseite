// Auf- und Abstieg über die Staffeln einer Liga hinweg (#1627, docs/LIGA.md „F.2 … Zielregel je Zone“): Wörter für den Reiter
// „Abschluss“. Verglichen wird auf dem Server (Punkte je Spiel, dann Map-Differenz je Spiel) - hier steht nur, wie es heißt.

const KIND_VERB = { promote_best: "steigt auf", relegate_worst: "steigt ab" };

/** „2,00“ - mit Komma, ohne Zahlenformat des Geräts, damit überall dasselbe steht. */
export function perGame(value) {
  return Math.abs(Number(value) || 0).toFixed(2).replace(".", ",");
}

/** „+0,67“, „−0,50“ oder „0,00“. */
export function signedPerGame(value) {
  const number = Number(value) || 0;
  const text = perGame(number);
  if (text === "0,00") return text;
  return `${number > 0 ? "+" : "−"}${text}`;
}

/** Woher ein Kandidat kommt und womit er verglichen wird: „Staffel A, Platz 2 · 2,00 Punkte je Spiel · +0,67 Maps je Spiel“. */
export function candidateLine(candidate) {
  return `Staffel ${candidate.staffel}, Platz ${candidate.rank} · ${perGame(candidate.points_per_game)} Punkte je Spiel · ${signedPerGame(candidate.map_diff_per_game)} Maps je Spiel`;
}

/** Das Etikett am Kandidaten: gewählt, im Gleichstand oder nichts. */
export function candidateState(side, candidate) {
  if (candidate.chosen) return { key: "chosen", label: KIND_VERB[side.kind] || "gewählt" };
  if (candidate.tied) return { key: "tied", label: "Gleichstand" };
  return null;
}

/** Überschrift einer Regel: „Aufstieg über den Vergleich der Staffeln · 1 Platz“. */
export function sideTitle(side) {
  return `${side.label} · ${side.count === 1 ? "1 Platz" : `${side.count} Plätze`}`;
}

/** Ob der Stand schon gilt. */
export function crossStatus(entry) {
  return entry.final ? "Alle Staffeln dieser Liga sind abgeschlossen: Das gilt für die neue Season."
    : "Stand von jetzt. Fest steht es erst, wenn alle Staffeln dieser Liga abgeschlossen sind – vorher trägt keine Tabelle die Zone.";
}

/** Der Satz zum offenen Gleichstand. */
export function tieLine(tie) {
  const count = tie.open === 1 ? "einer bekommt" : `${tie.open} bekommen`;
  return `Gleichstand nach Punkten je Spiel und Map-Differenz je Spiel: ${tie.names.join(" – ")}. Nur ${count} den Platz.`;
}

/** Der geltende Entscheid in einem Satz. */
export function crossDecisionLine(decision) {
  return `${decision.names.join(", ")} – ${decision.method_label}: ${decision.reason}`;
}

/** Darf die Auswahl im Entscheid so abgeschickt werden? Genau so viele wie offen, Art gewählt, Grund ab fünf Zeichen. */
export function decisionReady(tie, picked, method, reason) {
  return Boolean(tie) && picked.length === tie.open && Boolean(method) && String(reason || "").trim().length >= 5;
}

// Map-Pool einer Liga-Season absichern (#2207, docs/LIGA.md „C.2 Maps und Pools“): Prüfung vor der Veröffentlichung, Mindestgröße
// je Modus, Map in einem Schritt sperren und zwei Versionen vergleichen. Hier nur die Umformung für die Oberfläche - die Regeln
// prüft der Server (services/league_pool_check.py, services/league_readiness.py).

const keyOf = (mode) => mode ?? "";

/** Das Formular „Mindestgröße je Modus“: je Modus der überschriebene Wert als Text, leer = abgeleitet. */
export function minMapsForm(requirements) {
  return Object.fromEntries((requirements || []).map((row) => [keyOf(row.mode), row.override == null ? "" : String(row.override)]));
}

/** Was an den Server geht: nur Modi mit eigenem Wert, ganze Zahlen 1–50. Leer überall heißt: alles abgeleitet. */
export function minMapsPayload(requirements, form) {
  const out = [];
  for (const row of requirements || []) {
    const raw = String(form?.[keyOf(row.mode)] ?? "").trim();
    if (!raw) continue;
    const value = Number(raw);
    if (Number.isInteger(value) && value >= 1 && value <= 50) out.push({ mode: row.mode ?? null, min_maps: value });
  }
  return out;
}

/** Ein ungültiger Wert im Formular - der Satz dazu, sonst "". */
export function minMapsProblem(form) {
  const bad = Object.values(form || {}).map((value) => String(value ?? "").trim()).filter(Boolean)
    .some((value) => !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 50);
  return bad ? "Bitte je Modus eine ganze Zahl zwischen 1 und 50 – oder leer lassen." : "";
}

/** Die Maps eines Pools für „Map sperren“: jede einmal, mit den Modi, in denen sie steht. */
export function poolMapChoices(pool) {
  const byId = new Map();
  for (const group of pool?.modes || []) {
    for (const item of group.maps || []) {
      const entry = byId.get(item.map_id) || { map_id: item.map_id, name: item.name, modes: [] };
      entry.modes.push({ mode: group.mode ?? null, label: group.label || "Alle Maps" });
      byId.set(item.map_id, entry);
    }
  }
  return [...byId.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), "de"));
}

const STATUS_TEXT = { added: "neu im Pool", removed: "nicht mehr im Pool", changed: "geändert", same: "unverändert" };

/** Der Vergleich zweier Versionen als Zeilen für die Anzeige. */
export function compareRows(diff) {
  return (diff?.modes || []).map((row) => ({
    key: keyOf(row.mode) || "alle",
    label: row.label,
    status: row.status,
    statusText: STATUS_TEXT[row.status] || row.status,
    added: (row.added || []).map((item) => item.name),
    removed: (row.removed || []).map((item) => item.name),
    kept: row.kept || 0,
  }));
}

/** Kurzer Text zum Ergebnis von „Map sperren“ je Staffel. */
export function lockResultText(row) {
  const base = row.applied ? "übertragen" : "nicht übertragen";
  return row.notes?.length ? `${base} – ${row.notes.join(" ")}` : base;
}

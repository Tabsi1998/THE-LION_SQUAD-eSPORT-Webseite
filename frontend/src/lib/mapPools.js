// Map-Bibliothek und Map-Pools (#1616): Auswahl je Modus im Pool-Editor (Turnier, Phase, Saison), öffentliche
// Abschnitte und das Formular einer Map. Der Server prüft dieselben Regeln (services/map_pools.py) - hier geht es nur
// darum, dass die Oberfläche nichts anbietet, was er ablehnen würde: je Modus nur die freigegebenen, aktiven Maps.
// Die Auswahl ist `{ [modus]: [map-id …] }`; ein Spiel ohne Modi hat genau eine Gruppe unter "".

const keyOf = (mode) => mode ?? "";
const text = (value) => (value === null || value === undefined ? "" : String(value));
const orNull = (value) => {
  const cleaned = text(value).split(/\s+/).filter(Boolean).join(" ");
  return cleaned || null;
};

/** Die Maps der Bibliothek, die in diesem Modus freigegeben sind - ohne Modus (Spiel ohne Modi) alle. */
export function eligibleMaps(library, mode) {
  const maps = Array.isArray(library) ? library : [];
  if (mode === null || mode === undefined || mode === "") return maps;
  return maps.filter((item) => (item.modes || []).includes(mode));
}

/** Vorgabe des Spiels: je Modus alle aktiven Maps, die dort freigegeben sind, in der Reihenfolge der Bibliothek. */
export function defaultSelection(library, modes) {
  const list = Array.isArray(modes) && modes.length ? modes : [{ mode: null }];
  return Object.fromEntries(list.map(({ mode }) => [keyOf(mode), eligibleMaps(library, mode).map((item) => item.id)]));
}

/** Die Auswahl eines gespeicherten Pools. */
export function poolSelection(pool) {
  return Object.fromEntries((pool?.modes || []).map((group) => [keyOf(group.mode), (group.maps || []).map((item) => item.map_id)]));
}

export function toggleMap(selection, mode, mapId) {
  const key = keyOf(mode);
  const current = selection?.[key] || [];
  const next = current.includes(mapId) ? current.filter((id) => id !== mapId) : [...current, mapId];
  return { ...selection, [key]: next };
}

export function moveMap(selection, mode, mapId, delta) {
  const key = keyOf(mode);
  const list = [...(selection?.[key] || [])];
  const from = list.indexOf(mapId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.length) return selection;
  [list[from], list[to]] = [list[to], list[from]];
  return { ...selection, [key]: list };
}

export function selectionCount(selection) {
  return Object.values(selection || {}).reduce((sum, ids) => sum + (ids?.length || 0), 0);
}

/** Gleiche Auswahl wie gespeichert? Leere Modi zählen nicht. */
export function sameSelection(a, b) {
  const compact = (selection) => JSON.stringify(Object.entries(selection || {})
    .filter(([, ids]) => ids?.length).sort(([x], [y]) => x.localeCompare(y)));
  return compact(a) === compact(b);
}

/** Was an den Server geht: Gruppen in der Reihenfolge der Modi des Spiels, leere fallen weg. */
export function selectionBody(selection, modes, expectedVersion) {
  const list = Array.isArray(modes) && modes.length ? modes : [{ mode: null }];
  return {
    modes: list.map(({ mode }) => ({ mode: mode ?? null, map_ids: selection?.[keyOf(mode)] || [] }))
      .filter((group) => group.map_ids.length),
    expected_version: expectedVersion ?? 0,
  };
}

/**
 * Öffentliche Abschnitte eines Turniers: der Pool des Turniers, dann jede Phase mit eigenem Pool. Phasen, die den Pool
 * des Turniers übernehmen, stehen nicht doppelt da.
 */
export function poolSections(overview) {
  if (!overview) return [];
  const sections = [];
  if (overview.tournament) sections.push({ key: "tournament", title: "Map-Pool", pool: overview.tournament });
  for (const stage of overview.stages || []) {
    if (stage.pool?.origin === "stage") {
      sections.push({ key: stage.stage_id, title: `Map-Pool · ${stage.name || "Phase"}`, pool: stage.pool });
    }
  }
  return sections;
}

export function mapToForm(item) {
  return {
    name: text(item?.name),
    slug: text(item?.slug),
    image_url: text(item?.image_url),
    modes: Array.isArray(item?.modes) ? [...item.modes] : [],
    note: text(item?.note),
    external_ref: text(item?.external_ref),
    // Weitere Schreibweisen (#1616 an #1931) im Formular als ein Feld, mit Komma getrennt.
    aliases: (Array.isArray(item?.aliases) ? item.aliases : []).join(", "),
  };
}

export function mapFormPayload(form) {
  return {
    name: orNull(form?.name) || "",
    slug: orNull(form?.slug),
    image_url: orNull(form?.image_url),
    modes: [...(form?.modes || [])],
    note: orNull(form?.note),
    external_ref: orNull(form?.external_ref),
    aliases: text(form?.aliases).split(",").map(orNull).filter(Boolean),
  };
}

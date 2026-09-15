// Event-Typen als Begriff statt Rohwert.
//
// Die Begriffe kommen aus /api/events/meta. Ältere Einträge tragen aber
// Schreibweisen ohne Unterstrich ("clubevening"), die dort nicht vorkommen und
// bisher roh auf der Seite standen. Sie werden auf den bekannten Schlüssel
// gelegt; was auch dann unbekannt bleibt, wird wenigstens lesbar gemacht.

export const EVENT_TYPE_LABELS = {
  general: "Allgemein",
  public_event: "Public Event",
  club_evening: "Vereinsabend",
  lan_party: "LAN-Party",
  online_event: "Online Event",
  expo: "Messe / Expo",
  community_evening: "Community-Abend",
  grill_evening: "Grillabend",
  mario_kart_event: "Mario Kart Event",
  f1_event: "F1 Event",
  internal: "Interner Termin",
  sponsor_action: "Sponsorenaktion",
  tournament_finals: "Turnier-Finals",
};

export function normalizeEventType(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return "";
  if (EVENT_TYPE_LABELS[key]) return key;
  const squeezed = key.replace(/[^a-z0-9]/g, "");
  return Object.keys(EVENT_TYPE_LABELS).find((known) => known.replace(/_/g, "") === squeezed) || key;
}

function humanize(key) {
  return key.replace(/_/g, " ").replace(/\s+/g, " ").trim().replace(/^\w/, (char) => char.toUpperCase());
}

/** Begriff für einen Event-Typ; `types` sind die Einträge aus /api/events/meta, falls geladen. */
export function eventTypeLabel(value, types = []) {
  const key = normalizeEventType(value);
  if (!key) return "";
  const fromMeta = (types || []).find((type) => type?.k === key)?.l;
  return fromMeta || EVENT_TYPE_LABELS[key] || humanize(key);
}

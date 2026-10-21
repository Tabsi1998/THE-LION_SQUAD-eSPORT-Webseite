// Partner an Serien und Ligen (#1934): Spur und Saison tragen `partner_ids` und je Partner eine Rolle in `partner_roles`
// – Veranstalter oder Mitwirkender (ohne Eintrag: Mitwirkender). Die Saison erbt die Partner der Spur und kann eigene
// ergänzen. Gerechnet und gefiltert (nur aktive Partner) wird im Server (backend/services/series_partners.py).

export const ORGANIZER = "organizer";
export const CONTRIBUTOR = "contributor";
export const PARTNER_ROLE_OPTIONS = [[ORGANIZER, "Veranstalter"], [CONTRIBUTOR, "Mitwirkender"]];
export const PARTNER_ROLE_LABELS = Object.fromEntries(PARTNER_ROLE_OPTIONS);

const ids = (value) => (Array.isArray(value?.partner_ids) ? value.partner_ids : []);
const roles = (value) => (value?.partner_roles && typeof value.partner_roles === "object" ? value.partner_roles : {});

/** Rolle eines Partners; ohne Eintrag „Mitwirkender“. */
export function roleOf(value, id) {
  return roles(value)[id] === ORGANIZER ? ORGANIZER : CONTRIBUTOR;
}

/** Haken an oder aus: neue Partner kommen als Mitwirkende dazu, entfernte verlieren ihre Rolle. */
export function togglePartner(value, id, checked) {
  const current = ids(value);
  const nextIds = checked ? (current.includes(id) ? current : [...current, id]) : current.filter((item) => item !== id);
  const nextRoles = Object.fromEntries(nextIds.map((item) => [item, roleOf(value, item)]));
  return { partner_ids: nextIds, partner_roles: nextRoles };
}

export function setPartnerRole(value, id, role) {
  return { partner_ids: ids(value), partner_roles: { ...Object.fromEntries(ids(value).map((item) => [item, roleOf(value, item)])), [id]: role === ORGANIZER ? ORGANIZER : CONTRIBUTOR } };
}

/** Vorschlag für das Feld „Veranstalter“: der Name des ersten Veranstalters, solange das Feld leer ist. */
export function organizerSuggestion(partners, value, organizer) {
  if (String(organizer || "").trim()) return "";
  const host = ids(value).find((id) => roleOf(value, id) === ORGANIZER);
  return (partners || []).find((partner) => partner.id === host)?.name || "";
}

/** Partner, die eine Saison von ihrer Spur erbt – mit Name und Rolle, nur bekannte (aktive) Partner. */
export function inheritedPartners(lineage, partners) {
  const byId = new Map((partners || []).map((partner) => [partner.id, partner]));
  return ids(lineage).filter((id) => byId.has(id)).map((id) => ({ id, name: byId.get(id).name, role: roleOf(lineage, id) }));
}

const same = (a, b) => String(a || "").trim().toLocaleLowerCase("de") === String(b || "").trim().toLocaleLowerCase("de");

/**
 * Veranstaltender Partner einer Teilnahme in der Chronik: der ihrer Saison (Serien und Ligen), sonst ein Partner der
 * Referenz, dessen Name als Veranstalter eingetragen ist. Ohne Treffer `null`.
 */
export function chronicleHost(item, link) {
  const fromSeason = link?.season?.organizers?.[0];
  if (fromSeason) return fromSeason;
  return (item?.partners || []).find((partner) => same(partner.name, item?.organizer)) || null;
}

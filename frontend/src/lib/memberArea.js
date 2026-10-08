import { formatVienna } from "@/lib/dashboard";
import { asInstant } from "@/lib/vienna";

// Interne Events für den Mitgliederbereich (#283): aus der Event-Liste nur
// die, die Mitglieder oder der Vorstand sehen, und nur die, die noch
// anstehen – nach Datum sortiert.
const MEMBER_LEVELS = new Set(["members", "internal"]);

// Die Sprungleiste des Mitgliederbereichs (#1257, #1336) statt der Zeile aus neun kleinen Verweisen (#364): fünf
// Einträge, eine Zahl nur, wenn etwas offen oder neu ist („Versammlung · 1 offen“). Ein Tipp springt zum Abschnitt; steht
// der Abschnitt gerade nicht auf der Seite (nichts angesetzt), öffnet der Eintrag die eigene Seite - jede Adresse hat eine
// Route in App.jsx (Test). Dieselben Zahlen stehen an den Kacheln auf /verein und im Tab „Verein“ der App: eine Antwort
// des Servers (/membership/area-summary). Rechnungen und eigene Unterlagen stehen hier nicht: sie gehören zum Konto
// (Profil → „Nur für dich“), der Mitgliederbereich bleibt Verein (#320, #1255).
export const AREA_JUMPS = [
  { key: "karte", label: "Karte", to: "/members/membership#mitgliedskarte" },
  { key: "versammlung", label: "Versammlung", field: "meetings_open", unit: "offen", to: "/members/meetings" },
  { key: "helfen", label: "Helfen", field: "helping_free", unit: "frei", to: "/members/helfen" },
  { key: "news", label: "News", field: "news_new", unit: "neu", to: "/members/news" },
  { key: "dokumente", label: "Dokumente", field: "documents_new", unit: "neu", to: "/members/documents" },
];

function summaryCount(summary, field) {
  const value = Number(summary?.[field]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Die Einträge der Sprungleiste mit ihrer Zahl - ohne Offenes ohne Zahl. */
export function jumpEntries(summary) {
  return AREA_JUMPS.map((jump) => {
    const count = jump.field ? summaryCount(summary, jump.field) : 0;
    return { ...jump, count, note: count ? `${count} ${jump.unit}` : "" };
  });
}

const TILE_FIELDS = { meetings: "versammlung", helping: "helfen", documents: "dokumente" };

/** Die Zahl an einer Kachel auf /verein - dieselbe wie in der Sprungleiste des Mitgliederbereichs. */
export function tileNote(tileKey, summary) {
  const jump = jumpEntries(summary).find((entry) => entry.key === TILE_FIELDS[tileKey]);
  return jump?.note || "";
}

// „Neu“ heißt im Mitgliederbereich: in den letzten zwei Wochen erschienen - wie die Zahl vom Server.
export const NEW_DAYS = 14;

export function isRecent(value, now = new Date()) {
  if (!value) return false;
  const time = asInstant(value).getTime();
  if (Number.isNaN(time)) return false;
  return time <= now.getTime() && now.getTime() - time <= NEW_DAYS * 24 * 60 * 60 * 1000;
}

/** Helferdienste im Mitgliederbereich: kommende Veranstaltungen mit freien Plätzen oder eigenen Diensten, nach Datum. */
export function helperEvents(view, limit = 3) {
  return (Array.isArray(view?.events) ? view.events : [])
    .filter((event) => event?.upcoming && (Number(event.open_places) > 0 || (Array.isArray(event.mine) && event.mine.length > 0)))
    .sort((a, b) => String(a.day || "").localeCompare(String(b.day || "")))
    .slice(0, limit);
}

// Zusage zur Versammlung direkt in ihrer Karte (#1257) - dieselbe Antwort wie auf „Versammlungen“.
export const MEETING_ANSWERS = [["yes", "Ich komme"], ["maybe", "Vielleicht"], ["no", "Nein"]];

const MONTHS = ["Jän", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

/** Monat und Tag für die Datums-Kachel aus einem Kalendertag („2026-10-24“ → Okt / 24). */
export function dateTileParts(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ""));
  if (!match || !MONTHS[Number(match[2]) - 1]) return null;
  return { month: MONTHS[Number(match[2]) - 1], day: String(Number(match[3])), full: `${match[3]}.${match[2]}.${match[1]}` };
}

const CARD_TYPES = {
  ordinary: "Ordentliches Mitglied", supporting: "Unterstützendes Mitglied", honorary: "Ehrenmitglied", youth: "Jugendmitglied", guest: "Gastmitglied",
};

/**
 * Die Karte oben im Mitgliederbereich (#1336): dieselben Angaben wie auf „Meine Mitgliedschaft“ - Name, Nummer, seit,
 * Art und gültig bis (Austritt, sonst bezahlt bis). Nur für eine gültige Mitgliedschaft; sonst steht oben nur der Gruß.
 */
export function areaCard(user, me) {
  const membership = me?.membership;
  if (!membership || !["active", "honorary"].includes(membership.member_status)) return null;
  const erp = me?.dolibarr || {};
  return {
    name: user?.display_name || user?.username || "Mitglied",
    number: membership.member_number || erp.member_ref || "",
    since: membership.member_since || "",
    typeLabel: erp.type_label || CARD_TYPES[membership.membership_type] || "Mitglied",
    validUntil: erp.membership_ends || erp.paid_until || "",
  };
}

function toTime(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function memberEvents(events, now = new Date()) {
  const cutoff = now.getTime();
  return (Array.isArray(events) ? events : [])
    .filter((event) => MEMBER_LEVELS.has(event?.visibility))
    .filter((event) => {
      const start = toTime(event.start_date);
      const end = toTime(event.end_date) ?? start;
      return start === null || end === null || end >= cutoff;
    })
    .sort((a, b) => (toTime(a.start_date) ?? Infinity) - (toTime(b.start_date) ?? Infinity));
}

export function eventDateLine(event) {
  const start = formatVienna(event?.start_date);
  if (!start) return "Termin folgt";
  const end = event?.end_date ? formatVienna(event.end_date, { withTime: false }) : "";
  const startDay = formatVienna(event.start_date, { withTime: false });
  return end && end !== startDay ? `${start} – ${end}` : start;
}

// Interne News: nur, was Mitglieder oder der Vorstand sehen (#284).
export function memberNews(posts, limit = 3) {
  return (Array.isArray(posts) ? posts : [])
    .filter((post) => MEMBER_LEVELS.has(post?.visibility))
    .slice(0, limit);
}

/**
 * Ansprechpartner aus den Vorstandsposten (#284): nur besetzte Posten, in
 * der Reihenfolge des Vorstands. Vertretungen zählen nicht extra, sonst
 * stünde der Kassier zweimal da.
 */
export function boardContacts(positions, limit = 4) {
  return (Array.isArray(positions) ? positions : [])
    .filter((position) => position?.user && position.is_active !== false)
    .map((position) => {
      const name = position.user.display_name || position.user.gamertag || position.user.username || "";
      const gamertag = position.user.gamertag && position.user.gamertag !== name ? position.user.gamertag : "";
      return {
        id: position.id,
        title: position.display_title || position.title_male || "",
        name,
        avatar: position.user.avatar_url || position.user.photo_url || "",
        profileUrl: position.user.profile_url || (position.user.slug ? `/members/${position.user.slug}` : "/board"),
        // Kleines Porträt (#1332): freigestellt auf dem Vereins-Hintergrund, sonst Duoton; der Spielername klein darunter.
        cutout: Boolean(position.user.photo_cutout),
        gamertag,
      };
    })
    .slice(0, limit);
}

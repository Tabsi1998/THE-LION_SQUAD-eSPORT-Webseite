import { formatVienna } from "@/lib/dashboard";

// Interne Events für den Mitgliederbereich (#283): aus der Event-Liste nur
// die, die Mitglieder oder der Vorstand sehen, und nur die, die noch
// anstehen – nach Datum sortiert.
const MEMBER_LEVELS = new Set(["members", "internal"]);

// Die Verweiszeile des Mitgliederbereichs (#364): eine Quelle für Seite und Test.
// Jede Adresse hat eine Route in App.jsx; die Mitgliedskarte liegt auf „Meine
// Mitgliedschaft“ (Anker), weil sie dort mit Beitrag und Nummer zusammengehört.
// Rechnungen stehen hier nicht: sie gehören zum Konto (Profil → Rechnungen), der
// Mitgliederbereich bleibt Verein (#320, Entscheidung vom 23.09.).
export const MEMBER_AREA_LINKS = [
  { to: "/members/membership", label: "Mitgliedschaft" },
  { to: "/members/membership#mitgliedskarte", label: "Mitgliedskarte" },
  { to: "/members/benefits", label: "Vorteile" },
  { to: "/members/documents", label: "Dokumente" },
  { to: "/members/meetings", label: "Versammlungen" },
  { to: "/members/news", label: "Interne News" },
  { to: "/board", label: "Vorstand" },
];

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
    .map((position) => ({
      id: position.id,
      title: position.display_title || position.title_male || "",
      name: position.user.display_name || position.user.gamertag || position.user.username || "",
      avatar: position.user.avatar_url || position.user.photo_url || "",
      profileUrl: position.user.profile_url || (position.user.slug ? `/members/${position.user.slug}` : "/board"),
    }))
    .slice(0, limit);
}

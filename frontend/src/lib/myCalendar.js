import { mergeEventDays } from "@/lib/calendar";
import { asInstant, viennaDay } from "@/lib/vienna";

// „Mein Kalender“ (#1788): die eigenen Termine ohne Abo. Welche es sind, rechnet der Server an einer Stelle
// (GET /api/calendar/me = dieselbe Liste wie der persönliche Feed); hier nur, wie sie gruppiert und beschriftet werden -
// ohne React, damit sie sich testen lässt und die App dieselbe Rechnung übernehmen kann.

export const MY_CALENDAR_PATH = "/calendar/mine";
// Der Kasten „Automatisch in deinen Kalender“ hat diesen Anker - der Hinweis nach einer Anmeldung führt dorthin.
export const SUBSCRIBE_ANCHOR = "abo";

const DAY_MS = 24 * 60 * 60 * 1000;

function parse(value) {
  if (!value) return null;
  const date = asInstant(value);
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/** Der Sonntag der laufenden Woche (Wien, Woche ab Montag) als „JJJJ-MM-TT“. */
function weekEnd(now) {
  const today = viennaDay(now);
  const [year, month, day] = today.split("-").map(Number);
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  const weekday = (noon.getUTCDay() + 6) % 7; // Mo = 0
  return new Date(noon.getTime() + (6 - weekday) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * „Als Nächstes“ in drei Abschnitten: Heute (auch was gerade läuft), Diese Woche (bis Sonntag), Später. Vergangenes
 * fällt weg, die Tage eines Events sind eine Zeile. Leere Abschnitte gibt es nicht.
 */
export function agendaBuckets(items, now = new Date()) {
  const today = viennaDay(now);
  const sunday = weekEnd(now);
  const buckets = [
    { key: "today", label: "Heute", items: [] },
    { key: "week", label: "Diese Woche", items: [] },
    { key: "later", label: "Später", items: [] },
  ];
  for (const item of mergeEventDays(items || [])) {
    const start = parse(item.start);
    if (!start) continue;
    const end = parse(item.end);
    const day = item.all_day && item.day ? item.day : viennaDay(start);
    if (item.all_day) {
      // Ganztägig (Versammlung ohne Uhrzeit): gilt bis zum Ende seines letzten Tags in Wien - nicht bis 00:00 des
      // Beginns. Ein Ende ist ausschließlich (00:00 des Folgetags), darum eine Millisekunde davor.
      const lastInstant = end ? new Date(end.getTime() - 1) : null;
      const lastDay = lastInstant ? viennaDay(lastInstant) : day;
      if ((lastDay > day ? lastDay : day) < today) continue;
    } else if ((end || start).getTime() < now.getTime()) {
      continue;
    }
    if (day <= today) buckets[0].items.push(item);
    else if (day <= sunday) buckets[1].items.push(item);
    else buckets[2].items.push(item);
  }
  return buckets.filter((bucket) => bucket.items.length);
}

// Farbe der Plakette je Stand: Cyan heißt „du“ (#1305), Warteliste wartet in Gelb, Vereinstermine in Vereinsgold.
const BADGE_TONES = {
  waitlist: "wait",
  pending: "wait",
  requested: "wait",
  checked_in: "done",
  driven: "done",
  done: "done",
};

/** Die Plakette zu einem Termin: der eigene Stand vom Server, beim Turnier mit Team „mit Lions Rocket“. */
export function ownBadge(item) {
  const own = item?.own;
  if (!own?.label) return null;
  const tone = item.kind === "club" ? "club" : BADGE_TONES[own.state] || "mine";
  const label = own.team_name ? `${own.label} · mit ${own.team_name}` : own.label;
  return { label, tone };
}

/** Status des Abos in einem Satz - „aktiv seit 3. Okt., zuletzt abgerufen …“; ohne Abo nichts. */
export function subscriptionLine(status, format) {
  if (!status?.active) return "";
  const since = status.created_at ? ` seit ${format(status.created_at, { dateStyle: "medium" })}` : "";
  const used = status.last_used_at
    ? `, zuletzt abgerufen ${format(status.last_used_at, { dateStyle: "medium", timeStyle: "short" })}`
    : ", noch von keinem Kalender abgerufen";
  return `Aktiv${since}${used}.`;
}

/** Kurzanleitung je Kalender - dieselben Worte für das öffentliche und das persönliche Abo (wie bisher auf /calendar). */
export const SUBSCRIBE_GUIDE = [
  { key: "google", label: "Google Kalender", text: "„Weitere Kalender“ → „Per URL“ → Adresse einfügen. Am Handy einmal am PC einrichten, dann erscheint er überall." },
  { key: "apple", label: "Apple (iPhone, Mac)", text: "„Im Kalender öffnen“ antippen – oder „Ablage“ → „Neues Kalenderabonnement“ → Adresse einfügen." },
  { key: "outlook", label: "Outlook, Thunderbird", text: "„Kalender hinzufügen“ → „Aus dem Internet abonnieren“ → Adresse einfügen." },
];

/** Google Kalender öffnet mit dieser Adresse gleich „Kalender hinzufügen“ für das Abo. */
export function googleSubscribeUrl(webcal) {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(String(webcal || ""))}`;
}

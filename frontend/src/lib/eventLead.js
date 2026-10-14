// Anmeldungen & Einlass (#1372): Suche, Filter und Zähler der Arbeitsseite /events/<slug>/leitung. Die Liste kommt
// vollständig vom Server (GET /api/events/<slug>/lead?filter=all); gefiltert wird hier, damit an der Tür jeder
// Buchstabe sofort wirkt. Der Server kann dasselbe (?q=, ?filter=) - für die App und spätere Wege.

export const LEAD_FILTERS = [
  ["open", "Noch nicht da"],
  ["here", "Da"],
  ["waitlist", "Warteliste"],
  ["all", "Alle"],
];

const FILTER_STATUSES = {
  open: ["registered"],
  here: ["checked_in"],
  waitlist: ["waitlist"],
  all: null,
};

export const STATUS_LABELS = {
  registered: "Angemeldet",
  checked_in: "Da",
  waitlist: "Warteliste",
  no_show: "Nicht erschienen",
  cancelled: "Storniert",
};

// Vorlagen für „Nachricht an alle“ - ein Tipp setzt den Text, er bleibt änderbar.
export const MESSAGE_TEMPLATES = [
  "Der Parkplatz ist gesperrt – bitte den Hintereingang nehmen.",
  "Wir starten 15 Minuten später. Danke fürs Warten!",
  "Der Einlass ist jetzt offen.",
];
export const MESSAGE_MAX = 1000;

/** Klein und ohne Akzente: „Brünner“ findet man mit „brunner“, „Zoë“ mit „zoe“. */
export function normalizeName(value) {
  return String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/** Jedes Wort der Suche steht im Namen. */
export function matchesSearch(row, query) {
  const words = normalizeName(query).split(/\s+/).filter(Boolean);
  const name = normalizeName(row?.display_name);
  return words.every((word) => name.includes(word));
}

export function filterRows(rows, filter = "open", query = "") {
  const statuses = FILTER_STATUSES[filter] ?? null;
  return (rows || []).filter((row) => (!statuses || statuses.includes(row.status)) && matchesSearch(row, query));
}

/** Zähler je Filter - aus der Liste selbst, damit er nach jedem Tipp sofort stimmt. */
export function leadCounts(rows) {
  const list = rows || [];
  const seats = (row) => Number(row.seat_count) || 1;
  const registered = list.filter((row) => row.status === "registered");
  const here = list.filter((row) => row.status === "checked_in");
  return {
    open: registered.length,
    here: here.length,
    waitlist: list.filter((row) => row.status === "waitlist").length,
    all: list.length,
    expected: registered.length + here.length,
    expected_seats: [...registered, ...here].reduce((sum, row) => sum + seats(row), 0),
    here_seats: here.reduce((sum, row) => sum + seats(row), 0),
  };
}

/** „84 von 120 da“ - Personen; Begleitpersonen stehen in der zweiten Zeile. */
export function counterText(counts) {
  return `${counts?.here || 0} von ${counts?.expected || 0} da`;
}

export function seatsText(counts) {
  const here = counts?.here_seats || 0;
  const expected = counts?.expected_seats || 0;
  return expected === (counts?.expected || 0) ? "" : `${here} von ${expected} Plätzen mit Begleitpersonen`;
}

export function companionsText(row) {
  const count = Number(row?.companion_count) || 0;
  if (!count) return "";
  return count === 1 ? "+1 Begleitperson" : `+${count} Begleitpersonen`;
}

/** Die Vorschau unter dem Text: wer es bekommt und wie. */
export function messagePreview(count) {
  const n = Number(count) || 0;
  if (!n) return "Für dieses Event ist niemand angemeldet.";
  const who = n === 1 ? "1 angemeldete Person" : `${n} Angemeldete`;
  return `Geht an ${who} – je Person einmal, als Benachrichtigung und per Mail, wie jede Person es eingestellt hat.`;
}

/** Ein Status-Wechsel als ein Satz für die Rückmeldung unten. */
export function changeText(row, status) {
  const name = row?.display_name || "Die Person";
  if (status === "checked_in") return `${name} ist da.`;
  if (status === "registered" && row?.status === "waitlist") return `${name} ist nachgerückt.`;
  if (status === "registered" && row?.status === "checked_in") return `${name} ist wieder „noch nicht da“.`;
  return `${name}: ${STATUS_LABELS[status] || status}.`;
}

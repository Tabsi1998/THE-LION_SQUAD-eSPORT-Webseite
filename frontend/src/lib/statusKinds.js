// Zustands-Schilder (#1306, Fabians Variante C - gefüllt fürs Wichtige): zehn Arten mit fester Bedeutung, jede mit
// Symbol und Wort. Diese Tabelle ordnet jeden bekannten Zustand einer Art und einem Wort zu - nirgends steht mehr ein
// Rohwert wie „in_progress“ oder „CHECK-IN OFFEN“. Dieselben Werte stehen in docs/status-kinds.json (die App liest sie
// später), das Aussehen je Art in styles/system.css (.tls-status-chip); lib/statusKinds.test.js hält alle drei gleich.
// Die Wörter folgen der Wortliste (#1238): normal geschrieben, kurz, Check-in bleibt englisch.

/** Die zehn Arten in fester Reihenfolge (so stehen sie auch in der Doku und im Bildvergleich). „Frei“ (Station) kam
 *  nach Fabians Entscheidung vom 27.11. als zehnte Art dazu: grüner Rahmen, keine Füllung. */
export const STATUS_KIND_ORDER = ["soon", "registration", "checkin", "free", "live", "joined", "waiting", "problem", "done", "cancelled"];

/** Name und Symbol je Art. Gefüllt sind nur „Anmeldung offen“ und „Check-in offen“, rot ist nur „Läuft“. */
export const STATUS_KINDS = {
  soon: { label: "Bald", icon: "clock" },
  registration: { label: "Anmeldung offen", icon: "user-plus", filled: true },
  checkin: { label: "Check-in offen", icon: "circle-check", filled: true },
  free: { label: "Frei", icon: "plug" },
  live: { label: "Läuft", icon: "live-dot", pulse: true },
  joined: { label: "Du bist dabei", icon: "check" },
  waiting: { label: "Wartet", icon: "hourglass" },
  problem: { label: "Problem", icon: "triangle-alert" },
  done: { label: "Beendet", icon: "flag" },
  cancelled: { label: "Abgesagt", icon: "ban" },
};

/** Ruhige Spielart einer Art (Fabians Entscheidung Nr. 303 vom 28.11.): Cyan heißt „du“ - eine fremde bestätigte
 *  Anmeldung zeigt dieselbe Art mit Haken, aber in ruhigem Grau. Die Spielart steht als dritter Wert am Zustand. */
export const STATUS_VARIANTS = {
  quiet: ["joined"],
};

/** Jeder bekannte Zustand: [Art, Wort] oder [Art, Wort, Spielart]. Phasen (public_phase), Status von Turnier, Event, Fast Lap und Saison, Spiele,
 *  Anmeldungen und Stationen - ein Schlüssel heißt überall dasselbe. */
export const STATUS_STATES = {
  // Turnier, Event, Fast Lap, Saison (Status und öffentliche Phase)
  draft: ["waiting", "Entwurf"],
  scheduled: ["soon", "Angekündigt"],
  announced: ["soon", "Angekündigt"],
  upcoming: ["soon", "Bald"],
  registration_pending: ["soon", "Anmeldung öffnet"],
  registration_open: ["registration", "Anmeldung offen"],
  registration_closed: ["soon", "Anmeldung geschlossen"],
  check_in: ["checkin", "Check-in offen"],
  checkin_open: ["checkin", "Check-in offen"],
  live: ["live", "Läuft"],
  in_progress: ["live", "Läuft"],
  running: ["live", "Läuft"],
  active: ["live", "Läuft"],
  day_break: ["waiting", "Pause"],
  paused: ["waiting", "Pausiert"],
  completed: ["done", "Beendet"],
  results_published: ["done", "Ergebnisse da"],
  archived: ["done", "Archiviert"],
  cancelled: ["cancelled", "Abgesagt"],
  // Spiele
  preview: ["waiting", "Vorschau"],
  pending: ["waiting", "Ausstehend"],
  ready: ["soon", "Bereit"],
  waiting_result: ["waiting", "Wartet auf Ergebnis"],
  disputed: ["problem", "Klärung"],
  forfeit: ["done", "Wertung"],
  bye: ["done", "Freilos"],
  // Anmeldungen (Teilnehmerlisten, Verwaltung): fremde Anmeldungen ruhig grau - Cyan bekommt nur die eigene (own).
  approved: ["joined", "Bestätigt", "quiet"],
  registered: ["joined", "Angemeldet", "quiet"],
  checked_in: ["joined", "Eingecheckt", "quiet"],
  waitlist: ["waiting", "Warteliste"],
  waitlisted: ["waiting", "Warteliste"],
  rejected: ["cancelled", "Abgelehnt"],
  declined: ["cancelled", "Abgelehnt"],
  no_show: ["cancelled", "Nicht erschienen"],
  withdrawn: ["cancelled", "Ausgetreten"],
  disqualified: ["cancelled", "Disqualifiziert"],
  // Stationen
  free: ["free", "Frei"],
  busy: ["live", "Belegt"],
  in_use: ["live", "Belegt"],
  broken: ["problem", "Defekt"],
  reserved: ["waiting", "Reserviert"],
};

/** Die eigene Anmeldung („Dein Stand“, Dashboard): dieselben Arten, Wörter in der Du-Form. */
export const OWN_STATUS_STATES = {
  approved: ["joined", "Du bist dabei"],
  registered: ["joined", "Du bist dabei"],
  checked_in: ["joined", "Eingecheckt"],
  pending: ["waiting", "Wartet auf Freigabe"],
  cancelled: ["cancelled", "Abgemeldet"],
};

/** Der eigene Stand als Plakette („Mein Kalender“, Eventliste, Event-Programm): das Wort kommt vom Server, die Art von
 *  hier - Warteliste und Anfrage warten, Gefahrenes und Erledigtes ist vorbei, alles andere heißt „du bist dabei“
 *  (angemeldet, eingecheckt, zugesagt, Schicht). */
export const OWN_BADGE_KINDS = {
  waitlist: "waiting",
  waitlisted: "waiting",
  pending: "waiting",
  requested: "waiting",
  driven: "done",
  done: "done",
};

/** Die Art zum eigenen Stand (siehe OWN_BADGE_KINDS), sonst „joined“. */
export function ownBadgeKind(state) {
  return OWN_BADGE_KINDS[String(state ?? "").trim().toLowerCase()] || "joined";
}

/** Zustände, die „Läuft“ zeigen, deren Punkt aber still steht (Fabians Entscheidung vom 27.11.): eine Saison läuft
 *  Monate, ein Puls hieße „gerade jetzt“. */
export const STILL_STATES = ["active"];

/** Ein unbekannter Zustand zeigt nie den Rohwert: ruhig, mit dem Wort der Stelle oder „Unbekannt“. */
export const UNKNOWN_STATUS = { kind: "waiting", word: "Unbekannt", known: false, pulse: false, variant: null };

const normalize = (status) => String(status ?? "").trim().toLowerCase();

/** Art und Wort zu einem Zustand: `{ kind, word, known, pulse, variant }`. `own` nimmt die Du-Form der eigenen
 *  Anmeldung (immer ohne ruhige Spielart). `pulse` sagt, ob der Punkt bei „Läuft“ pulsiert - still bei den
 *  STILL_STATES. `variant` ist die Spielart („quiet“) oder null. */
export function statusKind(status, { own = false } = {}) {
  const key = normalize(status);
  const hit = (own && OWN_STATUS_STATES[key]) || STATUS_STATES[key];
  if (!hit) return { ...UNKNOWN_STATUS };
  return {
    kind: hit[0], word: hit[1], known: true, variant: hit[2] || null,
    pulse: Boolean(STATUS_KINDS[hit[0]].pulse) && !STILL_STATES.includes(key),
  };
}

/** Nur das Wort - für Stellen, die kein Schild zeigen (Vorlesetext, TV-Kopf). */
export function statusWord(status, options) {
  return statusKind(status, options).word;
}

/** Ist der Zustand bekannt? */
export function isKnownStatus(status) {
  return Object.hasOwn(STATUS_STATES, normalize(status));
}

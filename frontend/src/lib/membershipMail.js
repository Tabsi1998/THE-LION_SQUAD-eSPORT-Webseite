// Mitgliedschaft (#2125): der Server sagt, was mit der Mail passiert ist - die Meldung an die Verwaltung sagt es ehrlich.

const NOT_SENT = {
  no_address: "Keine Mail: Die Person hat keine Adresse hinterlegt.",
  mail_off: "Die Mail ist nicht versandt: Der Mailversand ist ausgeschaltet.",
  failed: "Die Mail ist nicht versandt: Das Einreihen ist fehlgeschlagen.",
};

/**
 * @param state Antwort des Servers: queued | skipped | no_address | mail_off | failed | null
 * @returns {{ sent: boolean, text: string }}
 */
export function mailOutcome(state) {
  if (state === "queued") return { sent: true, text: "Die Mail an die Person ist versandt." };
  if (state === "skipped") return { sent: true, text: "Ohne Mail, wie gewählt." };
  if (NOT_SENT[state]) return { sent: false, text: NOT_SENT[state] };
  return { sent: true, text: "" };
}

// Welche Mail ein neuer Status auslöst - für die Rückfrage. Andere Stati mailen nicht.
export const STATUS_MAIL = {
  active: "Mitgliedschaft aktiv",
  honorary: "Mitgliedschaft aktiv",
  inactive: "Mitgliedschaft ruht",
  former: "Mitgliedschaft beendet",
  blocked: "Mitgliedschaft gesperrt",
};

/** Die Rückfrage vor einem Statuswechsel: was passiert und ob die Person davon erfährt. */
export function statusChangeSentence({ name, statusLabel, status, notify }) {
  const person = name || "Die Person";
  const first = `${person} wird „${statusLabel}“.`;
  if (!STATUS_MAIL[status]) return `${first} Dazu geht keine Mail hinaus.`;
  return notify
    ? `${first} ${person} bekommt die Mail „${STATUS_MAIL[status]}“ und eine Meldung.`
    : `${first} ${person} bekommt keine Mail und keine Meldung.`;
}

export const USERS_LIST_LIMIT = 500;

/** Die Liste zeigt höchstens so viele Konten - der Hinweis sagt es, statt still abzuschneiden. */
export function listLimitHint(count) {
  return count >= USERS_LIST_LIMIT ? `Angezeigt werden höchstens ${USERS_LIST_LIMIT} Konten. Es können mehr sein: Suche gezielter oder nutze den CSV-Export.` : "";
}

/** Der erklärte Austritt in einem Satz. */
export function exitLine(exitRequest, formatDay) {
  if (!exitRequest?.declared_at) return "";
  const wished = exitRequest.wished_last_day ? `, Wunschtermin ${formatDay(exitRequest.wished_last_day)}` : "";
  return `Austritt erklärt am ${formatDay(exitRequest.declared_at)}${wished}.`;
}

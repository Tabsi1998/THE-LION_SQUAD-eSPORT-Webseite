// Check-in vor Ort durch die Turnierleitung (#1161): was der Reiter „Check-in“ zeigt und zählt. Die Liste kommt vom
// Server (GET /tournaments/<id>/lead/checkin), abgehakt wird über POST …/registrations/<rid>/checkin - Web und App gleich.
// Der Zähler rechnet aus dem angezeigten Stand, damit er beim Tippen sofort stimmt (optimistisch, mit Rücknahme).

// Groß/klein und Akzente egal, ß wie ss (Review N9): „Strasse“ findet „Straße“ und umgekehrt.
const fold = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/ß/g, "ss");

/** Der angezeigte Stand einer Zeile: was gerade gespeichert wird, sonst der Stand vom Server. */
export function shownStatus(row, pending = {}) {
  return pending[row?.id] || row?.status || "approved";
}

/** Suche nach Name, Spielname, Team-Kürzel und - bei Teams - den Namen der Mitglieder. Groß/klein und Akzente egal. */
export function checkinMatches(row, query) {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const haystack = fold([
    row?.name, row?.ingame_name, row?.team_tag,
    ...(row?.members || []).map((member) => member.name),
  ].filter(Boolean).join(" "));
  return words.every((word) => haystack.includes(word));
}

/** Filter „Fehlen noch“, „Da“, „Alle“. */
export function checkinFilter(row, filter, pending = {}) {
  const status = shownStatus(row, pending);
  if (filter === "missing") return status === "approved" || status === "pending";
  if (filter === "present") return status === "checked_in";
  return true;
}

/** Zähler aus dem angezeigten Stand: „13 von 16 da“ - wer als nicht erschienen markiert ist, zählt weiter mit. */
export function checkinCounts(rows = [], pending = {}) {
  let present = 0;
  let noShow = 0;
  let feeOpen = 0;
  for (const row of rows) {
    const status = shownStatus(row, pending);
    if (status === "checked_in") present += 1;
    if (status === "no_show") noShow += 1;
    if (row.fee === "open") feeOpen += 1;
  }
  return { total: rows.length, present, noShow, missing: rows.length - present - noShow, feeOpen };
}

/** „13 von 16 da“ - auch für Vorleser und den Seitentitel. */
export function checkinCounterText(counts) {
  return `${counts?.present ?? 0} von ${counts?.total ?? 0} da`;
}

/** Die kleine Zeile unter dem Zähler: „2 fehlen noch · 1 nicht erschienen · 3 Startgeld offen“. */
export function checkinSummary(counts) {
  const parts = [];
  if (counts?.missing) parts.push(`${counts.missing} ${counts.missing === 1 ? "fehlt" : "fehlen"} noch`);
  if (counts?.noShow) parts.push(`${counts.noShow} nicht erschienen`);
  if (counts?.feeOpen) parts.push(`${counts.feeOpen} Startgeld offen`);
  if (!parts.length && counts?.total) return "Alle da.";
  return parts.join(" · ");
}

/** Betrag fürs Etikett - nur, wenn der Server ihn schickt (Bereich Finanzen). */
export function feeAmount(row) {
  if (row?.fee_cents == null) return "";
  return new Intl.NumberFormat("de-AT", { style: "currency", currency: row.fee_currency || "EUR" }).format(row.fee_cents / 100);
}

/** Team-Zeile: „Spielt“, „Ersatz“ oder schlicht Mitglied - und wie viele laut „Ich bin da“ schon da sind. */
export function memberGroups(row) {
  const members = row?.members || [];
  if (!row?.lineup_set) return [{ key: "member", label: "", members }];
  return [
    { key: "starter", label: "Spielt", members: members.filter((member) => member.role === "starter") },
    { key: "substitute", label: "Ersatz", members: members.filter((member) => member.role === "substitute") },
  ].filter((group) => group.members.length);
}

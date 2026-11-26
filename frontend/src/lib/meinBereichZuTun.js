import { feeBadge, formatMoney } from "@/lib/dolibarr";
import { BEREICH, vereinPfad } from "@/lib/meinBereich";
import { zweiFaktorPfad } from "@/lib/meinBereichSeiten";

// „Zu tun“ in „Mein Bereich“ (#2059): eigene Datei, damit die Adressen in lib/meinBereich.js ohne Dolibarr-Helfer im
// Start-JS bleiben (Menü, untere Leiste, Weiterleitungen).

/**
 * Ob eine Änderung „Zu tun“ betrifft (Prüfung #2059): Fast Lap meldet sich über den Alias f1 → prizes auch als „prizes“,
 * ändert aber keine eigenen Gewinne - dann nicht nachladen. Ohne Ereignis (erstes Laden) immer.
 */
export function zuTunNachladen(event) {
  if (!event) return true;
  const quelle = String(event.resource || event.path || "").replace(/^\/+/, "");
  return !/^(f1|fastlap)(\/|$)/.test(quelle);
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

const plural = (n, one, many) => (n === 1 ? one : many);

/**
 * „Zu tun“ (#2059): aus vorhandenen Daten, nichts Neues am Server. Jede Zeile ist ein Knopf in die passende Gruppe.
 * Quellen: /account/invoices, /membership/me, /membership/me/consents, /membership/me/jersey-number,
 * /membership/area-summary, /prizes/me/open-count und die Sitzung (Zwei-Faktor für die Verwaltung).
 */
export function zuTun({ invoices = null, membership = null, consents = null, jersey = null, area = null, prizes = 0, secondFactor = false } = {}) {
  const items = [];
  if (secondFactor) {
    items.push({ key: "zweifaktor", gruppe: "konto", anzahl: 1, tone: "warn", label: "Zwei-Faktor einrichten", detail: "Für die Verwaltung brauchst du die Zwei-Faktor-Anmeldung.", to: zweiFaktorPfad() });
  }
  const summary = invoices?.summary || {};
  const open = count(summary.open_count);
  if (open) {
    const overdue = count(summary.overdue_count);
    const amount = summary.open_total !== undefined && summary.open_total !== null ? ` über ${formatMoney(summary.open_total, invoices.currency || "EUR")}` : "";
    items.push({
      key: "rechnung",
      gruppe: "rechnungen",
      anzahl: open,
      tone: overdue ? "warn" : "brand",
      label: open === 1 ? "Offene Rechnung bezahlen" : `${open} offene Rechnungen bezahlen`,
      detail: `${open} ${plural(open, "offener Beleg", "offene Belege")}${amount}${overdue ? `, davon ${overdue} überfällig` : ""}.`,
      to: `${BEREICH}/rechnungen`,
    });
  }
  // Der Beitrag steht meist auch als Rechnung da - dann reicht die Rechnung.
  const fee = membership ? feeBadge(membership.dolibarr) : null;
  if (!open && fee?.tone === "warn") {
    items.push({ key: "beitrag", gruppe: "mitgliedschaft", anzahl: 1, tone: "warn", label: "Mitgliedsbeitrag offen", detail: "Laut Mitgliederverwaltung noch nicht bezahlt.", to: `${BEREICH}/mitgliedschaft#beitrag` });
  }
  // Nur eine erteilte Einwilligung, deren Text sich seither geändert hat (Entscheidung 26.11., Prüfung #2059): die
  // Zustimmung deckt den neuen Text nicht. Nie beantwortete oder widerrufene freiwillige stehen unter Datenschutz →
  // Einwilligungen, aber nicht hier. `text_changed` setzt der Server (membership_routes._consent_view).
  const pending = (consents?.available === true && Array.isArray(consents.consents) ? consents.consents : [])
    .filter((row) => row.can_give && row.state === "given" && row.text_changed === true);
  if (pending.length) {
    items.push({
      key: "einwilligung",
      gruppe: "datenschutz",
      anzahl: pending.length,
      tone: "brand",
      label: pending.length === 1 ? "Einwilligung geändert – bitte neu lesen" : `${pending.length} Einwilligungen geändert – bitte neu lesen`,
      detail: pending.map((row) => row.label).filter(Boolean).join(", "),
      to: `${BEREICH}/datenschutz?tab=einwilligungen`,
    });
  }
  if (jersey?.available === true && jersey.can_choose && (jersey.number === null || jersey.number === undefined)) {
    items.push({ key: "nummer", gruppe: "mitgliedschaft", anzahl: 1, tone: "brand", label: "Nummer wählen", detail: "Deine Wunschnummer, zum Beispiel fürs Trikot.", to: `${BEREICH}/mitgliedschaft#nummer` });
  }
  // meetings_open zählt die offenen Abstimmungen schon mit (backend/services/member_area.py) - wie die Sprungleiste.
  const ballots = count(area?.ballots_open);
  if (ballots) {
    items.push({ key: "abstimmung", gruppe: "verein", anzahl: ballots, tone: "brand", label: plural(ballots, "Abstimmung offen", `${ballots} Abstimmungen offen`), detail: "Jetzt abstimmen.", to: vereinPfad("versammlungen") });
  }
  const invitations = Math.max(0, count(area?.meetings_open) - ballots);
  if (invitations) {
    items.push({ key: "versammlung", gruppe: "verein", anzahl: invitations, tone: "brand", label: "Zur Versammlung antworten", detail: plural(invitations, "Eine Einladung wartet auf deine Antwort.", `${invitations} Einladungen warten auf deine Antwort.`), to: vereinPfad("versammlungen") });
  }
  const prizeCount = count(prizes);
  if (prizeCount) {
    items.push({ key: "gewinn", gruppe: "rechnungen", anzahl: prizeCount, tone: "brand", label: plural(prizeCount, "Gewinn abholen", `${prizeCount} Gewinne abholen`), detail: "Offen oder bereit zum Abholen.", to: `${BEREICH}/rechnungen?tab=gewinne` });
  }
  return items;
}

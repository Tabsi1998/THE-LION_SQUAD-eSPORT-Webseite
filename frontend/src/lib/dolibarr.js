// Dolibarr-Anbindung (#295, #297, #316): Texte und kleine Entscheidungen für die
// Admin-Seite und „Meine Mitgliedschaft“. Die Regeln selbst liegen im Backend.

export const MODE_LABELS = { off: "Aus", preview: "Vorschau", live: "Live" };
export const MODE_HINTS = {
  off: "Die Website pflegt Mitgliedschaften selbst.",
  preview: "Dolibarr wird gelesen, aber nichts übernommen. Für die Umstellung.",
  live: "Dolibarr führt: bestätigte Zuordnungen übernehmen Status, Beitrag und Funktionen von selbst.",
};

export const LINK_STATUS_LABELS = {
  verified: "bestätigt",
  requested: "vom Mitglied angefragt",
  candidate: "Kandidat",
  conflict: "Konflikt",
  revoked: "gelöst",
  gone: "in Dolibarr gelöscht",
};

export const PREVIEW_STATE_LABELS = {
  linked: "schon zugeordnet",
  match: "Treffer über die bestätigte E-Mail",
  match_unverified_email: "Treffer über die E-Mail – am Konto ist sie aber nicht bestätigt, also genau hinsehen",
  shared_email: "mehrere Mitglieder teilen sich die E-Mail",
  member_claimed_twice: "zwei Konten passen auf dasselbe Mitglied",
  not_in_dolibarr: "lokal Mitglied, in Dolibarr nicht gefunden",
  email_unverified: "E-Mail nicht bestätigt – nur von Hand zuordnen",
};

export const DOLIBARR_STATUS_LABELS = { draft: "Entwurf", active: "aktiv", terminated: "beendet", excluded: "ausgeschlossen" };

/** Zeilen, bei denen ein Mensch das Mitglied aus der Liste wählen muss. */
export function needsManualChoice(row) {
  return !row.member_id && row.state !== "linked";
}

/** Mitglieder ohne Konto: die aktiven zuerst, Beendete getrennt – Ehemalige sind keine Mitglieder. */
export function splitWithoutAccount(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return { active: list.filter((entry) => !entry.ended), ended: list.filter((entry) => entry.ended) };
}

export const FEE_STATUS_LABELS = {
  paid: "bezahlt",
  invoiced: "Rechnung offen",
  due: "fällig",
  not_required: "kein Beitrag nötig",
  inactive: "ruht",
};

export const CAPABILITY_LABELS = {
  member_summary: "Mitglieds-Zusammenfassung",
  member_lookup: "Mitglied suchen",
  members_changed_since: "Abgleich nur geänderter Mitglieder",
  member_functions: "Vereinsfunktionen",
  member_invoices: "Rechnungen mit PDF",
  board: "Vorstand",
  membership_fees: "Mitgliedsarten und Beiträge",
  webhook_member_changed: "Benachrichtigung bei Änderung",
  verified_identities: "Verifizierte Identitäten (dolibarr-vereine#153)",
  change_feed: "Änderungsfeed mit Revisionen (#154)",
  signed_webhooks: "Signierte Webhooks (#155)",
  documents: "Dokumente (#157)",
};

export function formatDate(value) {
  if (!value) return "–";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return value.length === 10 ? date.toLocaleDateString("de-DE") : date.toLocaleString("de-DE");
}

export function formatMoney(amount, currency = "EUR") {
  if (amount === null || amount === undefined) return "–";
  try {
    return new Intl.NumberFormat("de-AT", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Eine Zeile zum letzten Abgleich – für die Kachel oben auf der Admin-Seite. */
export function describeSync(sync, mode) {
  if (mode === "off") return { tone: "plain", text: "Anbindung ist aus." };
  if (!sync?.last_run_at) return { tone: "warn", text: "Noch kein Abgleich gelaufen." };
  if (!sync.ok) {
    const last = sync.last_ok_at ? `, letzter Erfolg ${formatDate(sync.last_ok_at)}` : ", noch nie gelungen";
    return { tone: "danger", text: `${sync.last_error?.text || "Fehler"}${last}` };
  }
  const counts = sync.counts || {};
  const what = sync.applied_live ? `${counts.applied || 0} übernommen` : "nichts übernommen (Vorschau)";
  return { tone: "ok", text: `${formatDate(sync.last_ok_at)}: ${counts.seen || 0} gelesen, ${what}${sync.was_full ? " · vollständig" : ""}` };
}

/** Was auf „Meine Mitgliedschaft“ zum Beitrag steht. */
export function feeCard(view) {
  if (!view?.led_by_dolibarr || !view.fee) return null;
  const fee = view.fee;
  const lines = [];
  if (view.paid_until) lines.push(`Bezahlt bis ${formatDate(view.paid_until)}`);
  if (fee.status === "due" || fee.status === "invoiced") {
    lines.push(fee.next_due ? `Nächster Beitrag seit ${formatDate(fee.next_due)} offen` : "Beitrag offen");
  } else if (fee.next_due && fee.status === "paid") {
    lines.push(`Nächster Beitrag ab ${formatDate(fee.next_due)}`);
  }
  if (fee.payer === "other") lines.push("Den Beitrag zahlt eine andere Person für dich (z. B. Familie).");
  if (fee.discount?.kind && fee.discount.kind !== "none" && fee.discount.label) lines.push(`Ermäßigung: ${fee.discount.label}`);
  if (view.membership_ends) lines.push(`Mitgliedschaft endet am ${formatDate(view.membership_ends)}`);
  return {
    status: fee.status,
    label: FEE_STATUS_LABELS[fee.status] || fee.status,
    tone: fee.status === "due" ? "warn" : fee.status === "invoiced" ? "info" : "ok",
    amount: fee.required ? formatMoney(fee.amount, fee.currency) : null,
    lines,
    asOf: view.as_of,
    stale: !!view.stale,
  };
}

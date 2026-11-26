import { BEREICH, gruppe } from "@/lib/meinBereich";

// „Mein Bereich“ (#2059): was nur die Seiten selbst brauchen - die Zeile Text je Gruppe (Liste am Handy, Dashboard), die
// Reiter von „Rechnungen & Unterlagen“, die Schnellwege der Übersicht und Pfad-Helfer. Getrennt von lib/meinBereich.js,
// damit das Menü im Start-JS nur Namen, Wege und Zeichen trägt.

export const GRUPPEN_TEXT = {
  start: "Was gerade zu tun ist.",
  profil: "Gamertag, Bild, Banner, Spiel-IDs und Socials.",
  mitgliedschaft: "Status, Ausweis, Beitrag, Wunschnummer, Anschrift und Austritt.",
  rechnungen: "Rechnungen, Unterlagen, Gewinne und Strafen.",
  verein: "Versammlungen, Dokumente, Helfen, News und Vorteile.",
  benachrichtigungen: "Was wie zu dir kommt, Newsletter und Ruhezeit.",
  konto: "Passwort, Zwei-Faktor, Passkeys, Geräte und Google.",
  datenschutz: "Sichtbarkeit, Einwilligungen, Daten herunterladen und Konto löschen.",
};

// Reiter innerhalb einer Gruppe (?tab=…). Die Einstellungs-Reiter (basic, gaming, socials, notifications, security,
// privacy …) behalten ihre alten Kennungen - Mails, App und Hilfe nennen sie seit Jahren.
export const RECHNUNGEN_REITER = [
  { k: "rechnungen", label: "Rechnungen" },
  { k: "unterlagen", label: "Unterlagen" },
  { k: "gewinne", label: "Gewinne" },
  { k: "strafen", label: "Strafen" },
];

/** Ein Reiter einer Gruppe als Adresse: der erste Reiter ist die Gruppe selbst (ohne ?tab=). */
export function reiterPfad(gruppeKey, tab = "", extra = "") {
  const base = gruppe(gruppeKey)?.path || BEREICH;
  const params = new URLSearchParams(extra);
  if (tab) params.set("tab", tab);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

// Zwei-Faktor wohnt unter Konto & Sicherheit; `mfa=required` erklärt dort, warum (#348).
export function zweiFaktorPfad(next = "") {
  const params = new URLSearchParams({ mfa: "required" });
  if (next) params.set("next", next);
  return `${BEREICH}/konto?${params.toString()}`;
}

// Was am häufigsten gesucht wird (Abnahme #2059): direkt von der Übersicht aus, je ein Knopf.
export function schnellwege({ mitglied = false } = {}) {
  return [
    mitglied && { key: "nummer", label: "Wunschnummer", to: `${BEREICH}/mitgliedschaft#nummer` },
    mitglied && { key: "anschrift", label: "Anschrift ändern", to: `${BEREICH}/mitgliedschaft#meine-daten` },
    { key: "rechnungen", label: "Rechnungen", to: `${BEREICH}/rechnungen` },
    { key: "passwort", label: "Passwort ändern", to: `${BEREICH}/konto#passwort` },
    { key: "loeschung", label: "Konto löschen", to: `${BEREICH}/datenschutz?tab=loeschung` },
  ].filter(Boolean);
}

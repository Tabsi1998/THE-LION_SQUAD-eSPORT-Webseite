import type { Ionicons } from "@expo/vector-icons";
import { hilfeNormal } from "../faq";

// „Mein Bereich“ in der App (#2059, #1677): alles, was mich betrifft, an einem Ort - dieselben acht Gruppen mit denselben
// Namen wie im Web (frontend/src/lib/meinBereich.js, meinBereichSeiten.js). Der Tab „Mein Bereich“ ist die Übersicht
// (Zu tun, Häufig gebraucht, alle Gruppen und die Suche); jede Gruppe ist eine kurze Seite (MeinBereichGruppeScreen).
// Wege nennen Adressen der Website (/mein-bereich/…): navigation/rootNavigation.ts → targetFromUrl macht daraus den
// Screen der App. So führen Kacheln, „Zu tun“, Suche, Mails und Push zum selben Ort.

export const BEREICH = "/mein-bereich";

export type GruppeKey = "start" | "profil" | "mitgliedschaft" | "rechnungen" | "verein" | "benachrichtigungen" | "konto" | "datenschutz";
type IconName = keyof typeof Ionicons.glyphMap;

export type Gruppe = { key: GruppeKey; label: string; icon: IconName; text: string; memberOnly?: boolean };

/** Die acht Gruppen in der Reihenfolge des Webs - „Übersicht“ ist der Tab selbst. */
export const GRUPPEN: Gruppe[] = [
  { key: "start", label: "Übersicht", icon: "checkmark-done-outline", text: "Was gerade zu tun ist." },
  { key: "profil", label: "Profil", icon: "person-circle-outline", text: "Gamertag, Bild, Banner, Spiel-IDs und Socials." },
  { key: "mitgliedschaft", label: "Mitgliedschaft", icon: "card-outline", text: "Status, Ausweis, Beitrag, Wunschnummer, Anschrift und Austritt." },
  { key: "rechnungen", label: "Rechnungen & Unterlagen", icon: "receipt-outline", text: "Rechnungen, Unterlagen, Gewinne und Strafen." },
  { key: "verein", label: "Verein", icon: "shield-checkmark-outline", text: "Versammlungen, Dokumente, Helfen, News und Vorteile.", memberOnly: true },
  { key: "benachrichtigungen", label: "Benachrichtigungen", icon: "notifications-outline", text: "Was wie zu dir kommt, Newsletter und Ruhezeit." },
  { key: "konto", label: "Konto & Sicherheit", icon: "key-outline", text: "Passwort, Zwei-Faktor, Passkeys, Geräte und Google." },
  { key: "datenschutz", label: "Datenschutz", icon: "lock-closed-outline", text: "Sichtbarkeit, Einwilligungen, Daten herunterladen und Konto löschen." },
];

const BY_KEY = Object.fromEntries(GRUPPEN.map((item) => [item.key, item])) as Record<GruppeKey, Gruppe>;

export function gruppe(key?: string | null): Gruppe | null {
  return key && key in BY_KEY ? BY_KEY[key as GruppeKey] : null;
}

export function istGruppe(key: unknown): key is GruppeKey {
  return typeof key === "string" && key in BY_KEY;
}

/** Die Gruppen, die diese Person sieht: „Verein“ nur für Mitglieder (wie der Tab Verein). */
export function gruppenFuer({ mitglied = false }: { mitglied?: boolean } = {}): Gruppe[] {
  return GRUPPEN.filter((item) => mitglied || !item.memberOnly);
}

/** Wer „Verein“ sieht: Vereinsmitglieder - wie die Kacheln im Tab Verein (der Server prüft jede Antwort). */
export function siehtVerein(user: { is_club_member?: boolean | null } | null | undefined): boolean {
  return Boolean(user?.is_club_member);
}

// Die Seiten unter „Verein“ - früher /members/<seite>, im Web /mein-bereich/verein/<seite>.
export const VEREIN_SEITEN = [
  { k: "versammlungen", alt: "meetings", label: "Versammlungen" },
  { k: "helfen", alt: "helfen", label: "Helferdienste" },
  { k: "dokumente", alt: "documents", label: "Vereinsdokumente" },
  { k: "news", alt: "news", label: "Interne News" },
  { k: "vorteile", alt: "benefits", label: "Mitgliedervorteile" },
] as const;

export const vereinPfad = (seite = "") => (seite ? `${BEREICH}/verein/${seite}` : `${BEREICH}/verein`);

export type Schnellweg = { key: string; label: string; icon: IconName; to: string };

/** „Häufig gebraucht“ (Abnahme #2059): dieselben fünf Wege wie im Web - Wunschnummer und Anschrift nur für Mitglieder. */
export function schnellwege({ mitglied = false }: { mitglied?: boolean } = {}): Schnellweg[] {
  const alle: Array<Schnellweg | false> = [
    mitglied && { key: "nummer", label: "Wunschnummer", icon: "keypad-outline", to: `${BEREICH}/mitgliedschaft#nummer` },
    mitglied && { key: "anschrift", label: "Anschrift ändern", icon: "location-outline", to: `${BEREICH}/mitgliedschaft#meine-daten` },
    { key: "rechnungen", label: "Rechnungen", icon: "receipt-outline", to: `${BEREICH}/rechnungen` },
    // Das Passwort ändert die Website - in der App führt der Weg zur Zeile in Konto & Sicherheit, die dorthin öffnet.
    { key: "passwort", label: "Passwort ändern", icon: "key-outline", to: `${BEREICH}/konto#passwort` },
    { key: "loeschung", label: "Konto löschen", icon: "trash-outline", to: `${BEREICH}/datenschutz?tab=loeschung` },
  ];
  return alle.filter((item): item is Schnellweg => Boolean(item));
}

/** „1 offen“, „3 offen“ - die Zahl an einer Gruppe in der Liste. */
export function offenText(count: number): string {
  return count === 1 ? "1 offen" : `${count} offen`;
}

/** Wie viel je Gruppe offen ist - gezählt wie die Seite selbst (eine Rechnung, drei Abstimmungen …). */
export function offenJeGruppe(items: Array<{ gruppe: GruppeKey; anzahl?: number }>): Partial<Record<GruppeKey, number>> {
  return items.reduce<Partial<Record<GruppeKey, number>>>((acc, item) => ({ ...acc, [item.gruppe]: (acc[item.gruppe] || 0) + (item.anzahl || 1) }), {});
}

// ---------------------------------------------------------------- Suche (#1677)

/** Für wen eine Einstellung da ist: alle (auch Gäste), mit Konto, nur Mitglieder oder nur, wer noch nicht Mitglied ist. */
export type Fuer = "alle" | "konto" | "mitglied" | "nichtmitglied";

export type Einstellung = {
  /** Die Stelle in der Gruppe (Anker) - eindeutig in ihrer Gruppe, `mb-<ziel>` heißt sie im Screen. */
  ziel: string;
  gruppe: Exclude<GruppeKey, "start">;
  label: string;
  detail?: string;
  /** Weitere Wörter, unter denen man sie sucht. */
  worte?: string[];
  fuer: Fuer;
  /** Wohin der Treffer führt - ohne Angabe die Stelle in der Gruppe (/mein-bereich/<gruppe>#<ziel>). */
  to?: string;
};

const MB = (gruppeKey: string, rest = "") => `${BEREICH}/${gruppeKey}${rest}`;

/**
 * Jede Einstellung und jeder Weg in „Mein Bereich“ - die Suche findet sie, und der Test (meinBereich.test.ts) prüft, dass
 * jede bisherige Einstellung der App hier steht und in ihrer Gruppe zu sehen ist (nichts geht verloren).
 */
export const EINSTELLUNGEN: Einstellung[] = [
  // Profil
  { gruppe: "profil", ziel: "profil-bearbeiten", label: "Profil bearbeiten", detail: "Gamertag, Bild, Banner, Bio, Spiele und Konten", fuer: "konto", to: MB("profil", "?tab=basic"),
    worte: ["anzeigename", "gamertag", "name", "vorname", "nachname", "profilbild", "bild", "avatar", "banner", "bio", "land", "stadt", "lieblingsspiele", "plattform", "rolle", "eingabegerät", "spiel-ids", "konten", "socials", "discord", "twitch", "steam"] },
  { gruppe: "profil", ziel: "profil-ansehen", label: "Mein Profil ansehen", detail: "So sehen dich andere", fuer: "konto", to: "/u/me", worte: ["so sehen andere mich", "öffentlich", "referenzen", "teams"] },
  { gruppe: "profil", ziel: "erfolge", label: "Erfolge", detail: "Level, Prestige und angeheftete Erfolge", fuer: "konto", to: "/u/me?tab=achievements", worte: ["achievements", "level", "xp", "prestige"] },
  { gruppe: "profil", ziel: "trophaeen", label: "Trophäen", detail: "Profilbanner, Titel und Embleme wählen", fuer: "konto", to: "/u/me?tab=trophaeen", worte: ["pokale", "auszeichnungen", "titel", "embleme", "medaillen", "profilbanner"] },
  // Mitgliedschaft
  { gruppe: "mitgliedschaft", ziel: "status", label: "Status und Beitrag", detail: "Mitgliedsnummer, Mitglied seit, Beitrag", fuer: "mitglied", to: MB("mitgliedschaft", "#status"), worte: ["mitgliedschaft", "mitgliedsnummer", "beitrag", "mitglied seit", "vereinsakte", "verbinden"] },
  { gruppe: "mitgliedschaft", ziel: "mitgliedskarte", label: "Mitgliedskarte", detail: "Ausweis mit Prüfcode, auch ohne Netz", fuer: "mitglied", to: MB("mitgliedschaft", "#mitgliedskarte"), worte: ["ausweis", "karte", "qr", "prüfcode"] },
  { gruppe: "mitgliedschaft", ziel: "nummer", label: "Wunschnummer", detail: "Deine Nummer, zum Beispiel fürs Trikot", fuer: "mitglied", to: MB("mitgliedschaft", "#nummer"), worte: ["nummer", "trikot", "trikotnummer"] },
  { gruppe: "mitgliedschaft", ziel: "meine-daten", label: "Meine Daten", detail: "Anschrift und Telefon ändern", fuer: "mitglied", to: MB("mitgliedschaft", "#meine-daten"), worte: ["anschrift", "adresse", "telefon", "handynummer", "e-mail", "straße", "plz", "ort"] },
  { gruppe: "mitgliedschaft", ziel: "website-profil", label: "Website-Profil", detail: "Dein Eintrag auf der Website des Vereins", fuer: "mitglied", to: MB("mitgliedschaft", "#website-profil"), worte: ["eintrag", "mitgliederliste", "website"] },
  { gruppe: "mitgliedschaft", ziel: "austritt", label: "Austritt", detail: "Austritt aus dem Verein erklären", fuer: "mitglied", to: MB("mitgliedschaft", "#austritt"), worte: ["kündigen", "kündigung", "austreten"] },
  { gruppe: "mitgliedschaft", ziel: "beitreten", label: "Mitglied werden", detail: "Antrag stellen", fuer: "nichtmitglied", worte: ["beitreten", "antrag", "mitgliedschaft", "verein"] },
  // Rechnungen & Unterlagen
  { gruppe: "rechnungen", ziel: "rechnungen", label: "Rechnungen", detail: "Beitrag, Events und Turniere", fuer: "konto", to: MB("rechnungen"), worte: ["belege", "bezahlen", "zahlung", "offen", "pdf"] },
  { gruppe: "rechnungen", ziel: "unterlagen", label: "Unterlagen", detail: "Deine Schreiben aus der Vereinsakte", fuer: "konto", to: MB("rechnungen", "?tab=unterlagen"), worte: ["deine unterlagen", "schreiben", "briefe", "bestätigung", "dokumente"] },
  { gruppe: "rechnungen", ziel: "gewinne", label: "Gewinne", detail: "Offen oder bereit zum Abholen", fuer: "konto", to: MB("rechnungen", "?tab=gewinne"), worte: ["preise", "abholen", "gewonnen"] },
  { gruppe: "rechnungen", ziel: "strafen", label: "Strafen", detail: "Moderation und Liga", fuer: "konto", to: MB("rechnungen", "?tab=strafen"), worte: ["moderation", "sanktion", "einspruch", "verwarnung"] },
  // Verein
  { gruppe: "verein", ziel: "versammlungen", label: "Versammlungen", detail: "Einladungen und Abstimmungen", fuer: "mitglied", to: vereinPfad("versammlungen"), worte: ["generalversammlung", "abstimmung", "abstimmen", "einladung"] },
  { gruppe: "verein", ziel: "helfen", label: "Helferdienste", detail: "Schichten bei Veranstaltungen", fuer: "mitglied", to: vereinPfad("helfen"), worte: ["helfen", "schicht", "helfer"] },
  { gruppe: "verein", ziel: "dokumente", label: "Vereinsdokumente", detail: "Statuten, Protokolle und mehr", fuer: "mitglied", to: vereinPfad("dokumente"), worte: ["statuten", "protokoll", "dokumente"] },
  { gruppe: "verein", ziel: "news", label: "Interne News", detail: "Nur für Mitglieder", fuer: "mitglied", to: vereinPfad("news"), worte: ["news", "neuigkeiten"] },
  { gruppe: "verein", ziel: "vorteile", label: "Mitgliedervorteile", detail: "Vorteile bei unseren Partnern", fuer: "mitglied", to: vereinPfad("vorteile"), worte: ["vorteile", "rabatt", "partner"] },
  // Benachrichtigungen
  { gruppe: "benachrichtigungen", ziel: "stufe", label: "Stufe", detail: "Alles, Wichtiges oder Wenig", fuer: "konto", worte: ["push", "benachrichtigungen", "alles", "wichtiges", "wenig", "meldungen"] },
  { gruppe: "benachrichtigungen", ziel: "themen", label: "Themen", detail: "Je Thema Push, Nur App oder Aus", fuer: "konto",
    worte: ["push", "nur app", "aus", "spiele", "aufrufe", "turnier", "gewinne", "erfolge", "rechnungen", "nachrichten", "erwähnungen", "news", "vereinsintern", "helferdienste", "wochenrückblick", "geburtstag"] },
  { gruppe: "benachrichtigungen", ziel: "ruhezeit", label: "Ruhezeit", detail: "Nachts kein Push", fuer: "konto", worte: ["nacht", "ruhe", "stumm", "nicht stören", "von", "bis"] },
  { gruppe: "benachrichtigungen", ziel: "sammel-mail", label: "Sammel-Mail", detail: "Sofort, täglich oder wöchentlich", fuer: "konto", worte: ["e-mail", "email", "mail", "digest", "täglich", "wöchentlich", "sofort"] },
  { gruppe: "benachrichtigungen", ziel: "weitere-wege", label: "Weitere Wege", detail: "E-Mail je Thema, Discord und Kanäle", fuer: "konto", worte: ["e-mail", "email", "discord", "kanäle", "kanal", "browser", "in-app", "glocke"] },
  { gruppe: "benachrichtigungen", ziel: "newsletter", label: "Newsletter", detail: "News und Events per E-Mail", fuer: "konto", worte: ["newsletter", "events", "vereinsnews"] },
  // Konto & Sicherheit
  { gruppe: "konto", ziel: "passwort", label: "Passwort, Zwei-Faktor und Google", detail: "Auf der Website ändern", fuer: "konto", worte: ["passwort", "kennwort", "zwei-faktor", "2fa", "mfa", "google"] },
  { gruppe: "konto", ziel: "app-sperre", label: "App-Sperre mit Fingerabdruck", detail: "Gilt nur auf diesem Gerät", fuer: "konto", worte: ["fingerabdruck", "gesicht", "sperre", "entsperren", "biometrie", "gerätesperre"] },
  { gruppe: "konto", ziel: "passkeys", label: "Passkeys", detail: "Anmelden mit Fingerabdruck", fuer: "konto", worte: ["passkey", "fingerabdruck", "anmelden", "schlüssel"] },
  { gruppe: "konto", ziel: "geraete", label: "Angemeldete Geräte", detail: "Andere Geräte abmelden", fuer: "konto", worte: ["geräte", "sitzungen", "sessions", "abmelden", "handy", "browser"] },
  { gruppe: "konto", ziel: "kalender-abo", label: "Mein Kalender-Abo", detail: "Deine Termine automatisch im Handy-Kalender", fuer: "konto", to: MB("konto", "?tab=calendar"), worte: ["kalender", "abo", "termine", "ical"] },
  { gruppe: "konto", ziel: "darstellung", label: "Darstellung", detail: "Saison-Deko", fuer: "alle", worte: ["deko", "jahreszeiten", "saison", "weihnachten", "halloween", "schnee", "aussehen", "animation"] },
  { gruppe: "konto", ziel: "version", label: "Version", detail: "LionsAPP und Build", fuer: "alle", worte: ["app-version", "build", "über die app"] },
  { gruppe: "konto", ziel: "was-ist-neu", label: "Was ist neu", detail: "Neues in dieser Version", fuer: "alle", worte: ["neuigkeiten", "update", "changelog", "über die app"] },
  { gruppe: "konto", ziel: "faq", label: "FAQ", detail: "Häufige Fragen zu App und Website", fuer: "alle", worte: ["hilfe", "fragen", "anleitung", "über die app"] },
  { gruppe: "konto", ziel: "fehler-melden", label: "Fehler melden", detail: "Kontaktformular mit App-Version", fuer: "alle", worte: ["bug", "problem", "kontakt", "über die app"] },
  { gruppe: "konto", ziel: "datenschutzerklaerung", label: "Datenschutzerklärung", detail: "Auf der Website", fuer: "alle", worte: ["datenschutz", "privacy", "dsgvo", "über die app"] },
  { gruppe: "konto", ziel: "impressum", label: "Impressum", detail: "Auf der Website", fuer: "alle", worte: ["kontakt", "verein", "über die app"] },
  { gruppe: "konto", ziel: "abmelden", label: "Abmelden", detail: "Dieses Gerät aus deinem Konto ausloggen", fuer: "konto", worte: ["logout", "ausloggen"] },
  // Datenschutz
  { gruppe: "datenschutz", ziel: "oeffentliches-profil", label: "Öffentliches Profil", detail: "Profil ist in der Community-Suche sichtbar", fuer: "konto", worte: ["sichtbarkeit", "sichtbar", "privat", "privatsphäre", "suche"] },
  { gruppe: "datenschutz", ziel: "erfolge-oeffentlich", label: "Erfolge öffentlich", detail: "Ranglisten und Erfolg der Woche", fuer: "konto", worte: ["sichtbarkeit", "ranglisten", "bestenliste", "erfolg der woche", "privatsphäre"] },
  { gruppe: "datenschutz", ziel: "vereinsintern", label: "Vereinsinterne Erfolge zeigen", detail: "Nur Mitglieder sehen sie", fuer: "konto", worte: ["sichtbarkeit", "intern", "privatsphäre"] },
  { gruppe: "datenschutz", ziel: "twitch", label: "Twitch im Profil anzeigen", detail: "Live-Embed im öffentlichen Profil", fuer: "konto", worte: ["sichtbarkeit", "stream", "live", "privatsphäre"] },
  { gruppe: "datenschutz", ziel: "saison-fundstuecke", label: "Saison-Fundstücke öffentlich", detail: "Nur die Summen, nie wann", fuer: "konto", worte: ["sichtbarkeit", "fundstücke", "ostereier", "privatsphäre"] },
  { gruppe: "datenschutz", ziel: "freunde-anmeldungen", label: "Freunde sehen, wo ich angemeldet bin", detail: "Auf der Event-Seite", fuer: "konto", worte: ["sichtbarkeit", "freunde", "anmeldungen", "events", "privatsphäre"] },
  { gruppe: "datenschutz", ziel: "direktnachrichten", label: "Direktnachrichten", detail: "Wer dir schreiben darf", fuer: "konto", worte: ["dm", "nachrichten", "chat", "schreiben", "privatsphäre"] },
  { gruppe: "datenschutz", ziel: "blockiert", label: "Blockierte Benutzer", detail: "Blockieren aufheben", fuer: "konto", worte: ["blockieren", "entblocken", "sperren", "privatsphäre"] },
  { gruppe: "datenschutz", ziel: "einwilligungen", label: "Einwilligungen", detail: "Datenschutzerklärung, Nutzungsbedingungen und Verein", fuer: "konto", worte: ["zustimmung", "einwilligung", "nutzungsbedingungen", "agb", "fotos"] },
  { gruppe: "datenschutz", ziel: "daten", label: "Daten herunterladen", detail: "Auskunft und Export auf der Website", fuer: "konto", worte: ["meine daten", "export", "auskunft", "dsgvo"] },
  { gruppe: "datenschutz", ziel: "loeschung", label: "Konto löschen", detail: "Dauerhaft anonymisieren", fuer: "konto", worte: ["löschen", "anonymisieren", "account", "entfernen", "dsgvo"] },
];

/** Wohin eine Einstellung führt - ihre eigene Adresse oder die Stelle in ihrer Gruppe. */
export function einstellungZiel(item: Einstellung): string {
  return item.to || MB(item.gruppe, `#${item.ziel}`);
}

export type Sicht = { gast?: boolean; mitglied?: boolean };

/** Ob jemand diese Einstellung sieht (Gäste nur „alle“, Mitglied/Nicht-Mitglied wie die Gruppen). */
export function sichtbar(item: Einstellung, { gast = false, mitglied = false }: Sicht = {}): boolean {
  if (item.fuer === "alle") return true;
  if (gast) return false;
  if (item.fuer === "mitglied") return mitglied;
  if (item.fuer === "nichtmitglied") return !mitglied;
  return true;
}

/** Die Einstellungen einer Gruppe, die diese Person sieht - in fester Reihenfolge. */
export function einstellungenDer(gruppeKey: GruppeKey, sicht: Sicht = {}): Einstellung[] {
  return EINSTELLUNGEN.filter((item) => item.gruppe === gruppeKey && sichtbar(item, sicht));
}

const SUCHTEXT = new Map<Einstellung, string>();
function suchtext(item: Einstellung): string {
  let text = SUCHTEXT.get(item);
  if (text === undefined) {
    text = ` ${hilfeNormal([item.label, item.detail, gruppe(item.gruppe)?.label, ...(item.worte || [])].join(" "))} `;
    SUCHTEXT.set(item, text);
  }
  return text;
}

/** Die Wörter einer Suche - wie die FAQ: Umlaute auch ausgeschrieben, Groß und klein egal, ein Zeichen zählt nicht. */
export function suchWoerter(anfrage: string): string[] {
  return hilfeNormal(anfrage).split(" ").filter((wort) => wort.length > 1);
}

/**
 * Die Suche in „Mein Bereich“ (#1677): jedes Wort muss vorkommen (Anfang eines Worts oder mitten drin). Die Treffer
 * stehen in der Reihenfolge der Gruppen und behalten sie beim Weitertippen - die Liste wird nur kürzer, nichts springt.
 */
export function sucheEinstellungen(anfrage: string, sicht: Sicht = {}): Einstellung[] {
  const woerter = suchWoerter(anfrage);
  if (!woerter.length) return [];
  return EINSTELLUNGEN.filter((item) => sichtbar(item, sicht) && woerter.every((wort) => suchtext(item).includes(wort)));
}

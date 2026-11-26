import { Bell, Crown, KeyRound, LayoutDashboard, Lock, Receipt, Shield, UserCircle } from "lucide-react";

// „Mein Bereich“ (#2059): alles, was mich betrifft, an einem Ort - Profil, Mitgliedschaft, Rechnungen, Verein, Konto und
// Datenschutz. Dieselben acht Gruppen in derselben Reihenfolge wie in der App (#1677). Am PC eine Seitenleiste, am Handy
// eine Liste; jede Gruppe ist eine eigene kurze Seite unter /mein-bereich/<gruppe>. Die alten Adressen (/profile?tab=…,
// /members/*, /account/*, /my/*, /privacy-account) leiten hierher weiter (legacyTarget) - Mails, Benachrichtigungen und
// die App öffnen sie weiter.

export const BEREICH = "/mein-bereich";

export const GRUPPEN = [
  { key: "start", path: BEREICH, label: "Übersicht", text: "Was gerade zu tun ist.", icon: LayoutDashboard },
  { key: "profil", path: `${BEREICH}/profil`, label: "Profil", text: "Gamertag, Bild, Banner, Spiel-IDs und Socials.", icon: UserCircle },
  { key: "mitgliedschaft", path: `${BEREICH}/mitgliedschaft`, label: "Mitgliedschaft", text: "Status, Ausweis, Beitrag, Wunschnummer, Anschrift und Austritt.", icon: Crown },
  { key: "rechnungen", path: `${BEREICH}/rechnungen`, label: "Rechnungen & Unterlagen", text: "Rechnungen, Unterlagen, Gewinne und Strafen.", icon: Receipt },
  { key: "verein", path: `${BEREICH}/verein`, label: "Verein", text: "Versammlungen, Dokumente, Helfen, News und Vorteile.", icon: Shield, memberOnly: true },
  { key: "benachrichtigungen", path: `${BEREICH}/benachrichtigungen`, label: "Benachrichtigungen", heading: "Benachrichti\u00ADgungen", text: "Was wie zu dir kommt, Newsletter und Ruhezeit.", icon: Bell },
  { key: "konto", path: `${BEREICH}/konto`, label: "Konto & Sicherheit", text: "Passwort, Zwei-Faktor, Passkeys, Geräte und Google.", icon: KeyRound },
  { key: "datenschutz", path: `${BEREICH}/datenschutz`, label: "Datenschutz", text: "Sichtbarkeit, Einwilligungen, Daten herunterladen und Konto löschen.", icon: Lock },
];

const BY_KEY = Object.fromEntries(GRUPPEN.map((gruppe) => [gruppe.key, gruppe]));

export function gruppe(key) {
  return BY_KEY[key] || null;
}

/** Die Gruppen, die diese Person sieht: „Verein“ nur für Mitglieder (wie die Seiten dahinter). */
export function gruppenFuer({ mitglied = false } = {}) {
  return GRUPPEN.filter((item) => mitglied || !item.memberOnly);
}

/** Zu welcher Gruppe eine Adresse gehört (für die Seitenleiste) - null außerhalb von „Mein Bereich“. */
export function gruppeZuPfad(pathname = "") {
  const path = String(pathname || "").replace(/\/+$/, "");
  if (path === BEREICH) return "start";
  if (!path.startsWith(`${BEREICH}/`)) return null;
  const segment = path.slice(BEREICH.length + 1).split("/")[0];
  return BY_KEY[segment] && segment !== "start" ? segment : null;
}

// Reiter innerhalb einer Gruppe (?tab=…). Die Einstellungs-Reiter (basic, gaming, socials, notifications, security,
// privacy …) behalten ihre alten Kennungen - Mails, App und Hilfe nennen sie seit Jahren.
export const RECHNUNGEN_REITER = [
  { k: "rechnungen", label: "Rechnungen" },
  { k: "unterlagen", label: "Unterlagen" },
  { k: "gewinne", label: "Gewinne" },
  { k: "strafen", label: "Strafen" },
];

export const DATENSCHUTZ_REITER = [
  { k: "privacy", label: "Sichtbarkeit" },
  { k: "einwilligungen", label: "Einwilligungen" },
  { k: "daten", label: "Daten herunterladen" },
  { k: "loeschung", label: "Konto löschen" },
];

// Die Seiten unter „Verein“ - früher /members/<seite>. `heading` trägt bei langen Wörtern die weiche Trennstelle (#1218).
export const VEREIN_SEITEN = [
  { k: "versammlungen", alt: "meetings", label: "Versammlungen" },
  { k: "helfen", alt: "helfen", label: "Helferdienste" },
  { k: "dokumente", alt: "documents", label: "Vereinsdokumente", heading: "Vereins\u00ADdokumente" },
  { k: "news", alt: "news", label: "Interne News" },
  { k: "vorteile", alt: "benefits", label: "Mitgliedervorteile", heading: "Mitglieder\u00ADvorteile" },
];

export const vereinPfad = (seite = "") => (seite ? `${BEREICH}/verein/${seite}` : `${BEREICH}/verein`);

/** Ein Reiter einer Gruppe als Adresse: der erste Reiter ist die Gruppe selbst (ohne ?tab=). */
export function reiterPfad(gruppeKey, tab = "", extra = "") {
  const base = gruppe(gruppeKey)?.path || BEREICH;
  const params = new URLSearchParams(extra);
  if (tab) params.set("tab", tab);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

// Alte Reiter von /profile und ihre Gruppe. „sessions“ war der Reiter für Geräte (seit #258 unter Sicherheit),
// „edit“ der Weg aus der App zum Bearbeiten.
const SETTINGS_TAB_GROUP = {
  basic: "profil", gaming: "profil", socials: "profil", edit: "profil",
  notifications: "benachrichtigungen",
  security: "konto", sessions: "konto", appearance: "konto", calendar: "konto", about: "konto",
  privacy: "datenschutz",
};
const TAB_ALIASES = { sessions: "security", edit: "basic" };
// Der erste Reiter einer Gruppe braucht kein ?tab= in der Adresse.
const DEFAULT_TABS = new Set(["basic", "notifications", "security", "privacy"]);
const INVOICE_KEY = /^d-\d{1,12}$/;

function joined(path, params, hash = "") {
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}${hash || ""}`;
}

function profileTarget(params, hash) {
  const wanted = params.get("tab") || "";
  const rest = new URLSearchParams(params);
  rest.delete("tab");
  // Was keine Einstellung ist (#1150), hat seinen Ort woanders - unverändert.
  if (wanted === "teams") return "/teams";
  if (wanted === "friends") return "/players";
  if (wanted === "achievements" || wanted === "honours") return `/u/me?tab=${wanted}`;
  if (wanted === "inbox") return `/messages${params.get("to") ? `/${encodeURIComponent(params.get("to"))}` : ""}`;
  if (wanted === "invoices") {
    const invoice = params.get("invoice") || "";
    return `${BEREICH}/rechnungen${INVOICE_KEY.test(invoice) ? `?invoice=${invoice}` : ""}`;
  }
  if (wanted === "prizes") return `${BEREICH}/rechnungen?tab=gewinne`;
  const group = SETTINGS_TAB_GROUP[wanted] || "profil";
  const tab = TAB_ALIASES[wanted] || wanted;
  const next = new URLSearchParams();
  if (tab && SETTINGS_TAB_GROUP[wanted] && !DEFAULT_TABS.has(tab)) next.set("tab", tab);
  rest.forEach((value, key) => next.append(key, value));
  return joined(BY_KEY[group].path, next, hash);
}

const MEMBER_PAGES = Object.fromEntries(VEREIN_SEITEN.map((seite) => [seite.alt, seite.k]));

/**
 * Wohin eine alte Adresse führt - null, wenn sie nicht zu „Mein Bereich“ gehört. Suche (?invoice=, ?meeting=, ?event=,
 * ?link= …) und Anker (#versammlung, #mitgliedskarte, #dieser-browser) gehen mit.
 */
export function legacyTarget({ pathname = "", search = "", hash = "" } = {}) {
  const path = String(pathname || "").replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(search || "");
  if (path === "/profile") return profileTarget(params, hash);
  if (path === "/privacy-account") return `${BEREICH}/datenschutz?tab=daten`;
  if (["/members/area", "/mitgliederbereich", "/member-area"].includes(path)) return joined(vereinPfad(), params, hash);
  if (path === "/members/membership") return joined(`${BEREICH}/mitgliedschaft`, params, hash);
  const member = path.match(/^\/members\/(meetings|helfen|documents|news|benefits)$/);
  if (member) return joined(vereinPfad(MEMBER_PAGES[member[1]]), params, hash);
  if (path === "/account/invoices") {
    const invoice = params.get("invoice") || "";
    return `${BEREICH}/rechnungen${INVOICE_KEY.test(invoice) ? `?invoice=${invoice}` : ""}`;
  }
  if (path === "/account/documents") return `${BEREICH}/rechnungen?tab=unterlagen`;
  if (path === "/my/prizes" || path === "/me/prizes") return `${BEREICH}/rechnungen?tab=gewinne`;
  if (path === "/my/penalties") return `${BEREICH}/rechnungen?tab=strafen`;
  return null;
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

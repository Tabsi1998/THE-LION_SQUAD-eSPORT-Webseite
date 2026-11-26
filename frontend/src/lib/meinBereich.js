import { Bell, Crown, KeyRound, ListChecks, Lock, Receipt, Shield, UserCircle } from "lucide-react";

// „Mein Bereich“ (#2059): alles, was mich betrifft, an einem Ort - Profil, Mitgliedschaft, Rechnungen, Verein, Konto und
// Datenschutz. Dieselben acht Gruppen in derselben Reihenfolge wie in der App (#1677). Am PC eine Seitenleiste, am Handy
// eine Liste; jede Gruppe ist eine eigene kurze Seite unter /mein-bereich/<gruppe>. Die alten Adressen (/profile?tab=…,
// /members/*, /account/*, /my/*, /privacy-account) leiten hierher weiter (lib/meinBereichAlt.js, legacyTarget) - Mails,
// Benachrichtigungen und die App öffnen sie weiter. Diese Datei steht im Start-JS (Menü), deshalb nur das Nötigste - Texte, Reiter und Schnellwege stehen in
// lib/meinBereichSeiten.js.

export const BEREICH = "/mein-bereich";

export const GRUPPEN = [
  { key: "start", path: BEREICH, label: "Übersicht", icon: ListChecks },
  { key: "profil", path: `${BEREICH}/profil`, label: "Profil", icon: UserCircle },
  { key: "mitgliedschaft", path: `${BEREICH}/mitgliedschaft`, label: "Mitgliedschaft", icon: Crown },
  { key: "rechnungen", path: `${BEREICH}/rechnungen`, label: "Rechnungen & Unterlagen", icon: Receipt },
  { key: "verein", path: `${BEREICH}/verein`, label: "Verein", icon: Shield, memberOnly: true },
  { key: "benachrichtigungen", path: `${BEREICH}/benachrichtigungen`, label: "Benachrichtigungen", heading: "Benachrichti\u00ADgungen", icon: Bell },
  { key: "konto", path: `${BEREICH}/konto`, label: "Konto & Sicherheit", icon: KeyRound },
  { key: "datenschutz", path: `${BEREICH}/datenschutz`, label: "Datenschutz", icon: Lock },
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

// Die Seiten unter „Verein“ - früher /members/<seite>. `heading` trägt bei langen Wörtern die weiche Trennstelle (#1218).
export const VEREIN_SEITEN = [
  { k: "versammlungen", alt: "meetings", label: "Versammlungen" },
  { k: "helfen", alt: "helfen", label: "Helferdienste" },
  { k: "dokumente", alt: "documents", label: "Vereinsdokumente", heading: "Vereins\u00ADdokumente" },
  { k: "news", alt: "news", label: "Interne News" },
  { k: "vorteile", alt: "benefits", label: "Mitgliedervorteile", heading: "Mitglieder\u00ADvorteile" },
];

export const vereinPfad = (seite = "") => (seite ? `${BEREICH}/verein/${seite}` : `${BEREICH}/verein`);

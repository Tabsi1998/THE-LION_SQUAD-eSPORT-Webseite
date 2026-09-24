// Verbindungen (Wunsch des Betreibers, 24.09.: „für alles ein Menü, also TikTok eins usw.“): je Dienst
// eine eigene Seite unter Admin → Verbindungen mit Stand, Zugangsdaten, Rückrufadresse, „prüfen“ und
// der Anleitung. Die Registrierung hier sagt, welche App (Client ID + Secret) und welche Anleitungen
// dazugehören. Dienste mit `tab` haben keine eigene Seite: Menü und Adresse führen direkt auf den Reiter
// mit den Feldern (#508, 25.09.: „alles an einem Punkt, nicht weiter verlinken“).
import { PLATFORM_APPS } from "@/lib/platformLinks";
import { guideStatus } from "@/lib/setupGuides";

export const INTEGRATIONS = [
  // Discord und Twitch tragen ihre laufenden Einstellungen selbst (kein Reiter mehr, 24.09.).
  { key: "discord", label: "Discord", app: "discord", guides: ["discord_app", "discord_webhooks", "discord_bot"], searchTerms: ["webhook", "bot", "token", "kanal", "meldungen", "rollen abgleichen", "befehle", "betriebs-webhook", "aktivität", "zähler"] },
  { key: "twitch", label: "Twitch", app: "twitch", guides: ["twitch"], searchTerms: ["helix", "livestream", "live-erkennung", "stream", "vereinskanal", "kanal"] },
  { key: "steam", label: "Steam", app: "steam", guides: ["steam"] },
  { key: "battlenet", label: "Battle.net", app: "battlenet", guides: ["battlenet"] },
  { key: "x", label: "X (Twitter)", app: "x", guides: ["x"] },
  { key: "youtube", label: "YouTube", app: "youtube", guides: ["youtube"] },
  { key: "tiktok", label: "TikTok", app: "tiktok", guides: ["tiktok"] },
  { key: "riot", label: "Riot Games", app: "riot", guides: ["riot"] },
  { key: "xbox", label: "Xbox", app: "xbox", guides: ["xbox"] },
  { key: "epic", label: "Epic Games", app: "epic", guides: ["epic"] },
  // Seit #546 sind Google, Resend und SMTP eigene Seiten unter Verbindungen; Analytics, Google Play und
  // Dolibarr haben ihre Seite anderswo (Auftritt bzw. Mitglieder) und stehen nur in der Übersicht.
  { key: "google", label: "Google", guides: ["google_login"], tab: "/admin/settings/google", tabLabel: "Client-ID und Login-Schalter", searchTerms: ["google login", "google-login", "anmeldung mit google", "oauth", "web-client-id"] },
  { key: "resend", label: "Resend", guides: ["resend"], tab: "/admin/settings/resend", tabLabel: "API-Key, Absender, Testmail", searchTerms: ["e-mail", "mail", "versand", "api key", "absender", "testmail"] },
  { key: "smtp", label: "SMTP", guides: ["smtp"], tab: "/admin/settings/smtp", tabLabel: "Mailserver, Zugang, Diagnose", searchTerms: ["mailserver", "postausgang", "port", "tls", "e-mail", "diagnose"] },
  { key: "analytics", label: "Analytics & Suchmaschinen", guides: ["analytics", "search_console"], tab: "/admin/settings/seo", tabLabel: "Mess-ID, Bestätigungen, IndexNow", menu: false },
  { key: "play", label: "Google Play", guides: ["play_store"], tab: "/admin/settings/branding", tabLabel: "Play-Store-Link", menu: false },
  { key: "dolibarr", label: "Dolibarr", guides: ["dolibarr"], tab: "/admin/dolibarr?tab=connection", tabLabel: "Verbindung, Modus, Schreibzugriff", menu: false },
];

// Die Einträge der Menügruppe Verbindungen - in dieser Reihenfolge, nach der Übersicht.
export const MENU_INTEGRATIONS = [
  ...INTEGRATIONS.filter((integration) => ["google", "resend", "smtp"].includes(integration.key)),
  ...INTEGRATIONS.filter((integration) => integration.app),
];

export function integrationByKey(key) {
  return INTEGRATIONS.find((integration) => integration.key === key) || null;
}

export function integrationApp(integration) {
  return integration?.app ? PLATFORM_APPS.find((app) => app.key === integration.app) || null : null;
}

export function integrationForGuide(guideKey) {
  return INTEGRATIONS.find((integration) => integration.guides.includes(guideKey)) || null;
}

// Der Stand einer Verbindung ist der schlechteste Stand ihrer Anleitungen: fehlt → optional → ok.
const RANK = { missing: 0, unknown: 1, optional: 2, ok: 3 };

export function integrationStatus(integration, data) {
  const statuses = (integration?.guides || []).map((guideKey) => guideStatus(guideKey, data));
  if (statuses.length === 0) return { state: "unknown", text: "" };
  return statuses.reduce((worst, status) => (RANK[status.state] < RANK[worst.state] ? status : worst), statuses[0]);
}

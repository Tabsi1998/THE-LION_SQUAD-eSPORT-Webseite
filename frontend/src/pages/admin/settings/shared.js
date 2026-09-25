// Einstellungen (#223): Konstanten und reine Helfer, die Seite und Abschnitte teilen.
import { normalizeAnalyticsPayload } from "@/lib/analyticsConfig";
import { PLATFORM_SECRET_FIELDS } from "@/lib/platformLinks";

export const MAIL_TEMPLATE_LABELS = {
  user_invite: "Einladungsmail",
  registration: "Registrierung",
  password_reset: "Passwort zurücksetzen",
  registration_received: "Turnier-Anmeldung",
  registration_approved: "Anmeldung bestätigt",
  registration_rejected: "Anmeldung abgelehnt",
  checkin_reminder: "Check-in-Erinnerung",
  match_reminder: "Spiel-Erinnerung",
  score_reported: "Ergebnis gemeldet",
  dispute_opened: "Dispute eröffnet",
  dispute_resolved: "Dispute entschieden",
  tournament_finished: "Turnier beendet",
  membership_activated: "Mitgliedschaft aktiviert",
  membership_deactivated: "Mitgliedschaft deaktiviert",
  membership_blocked: "Mitgliedschaft gesperrt",
  direct_message: "Direktnachricht",
  team_chat_mention: "Team-Chat-Erwähnung",
  newsletter_news: "Newsletter: News",
  newsletter_event: "Newsletter: Event",
  contact_autoreply: "Kontakt-Antwort",
  contact_admin_notify: "Kontaktmeldung",
  test: "Testmail",
};

export const STATUS_LABELS = {
  pending: "wartet auf Versand",
  sending: "wird versendet",
  sent: "gesendet",
  failed: "fehlgeschlagen",
  skipped: "übersprungen",
};

// Seit #546 ist jede Einstellung eine eigene Seite in der Menüleiste (Verbindungen, E-Mail, Auftritt,
// System) - keine zweite Reiterleiste mehr. Die Adresse sagt, welcher Teil gezeigt wird; Google und Zugang
// teilen sich die Login-Einstellungen, liegen aber in verschiedenen Gruppen.

export const SETTINGS_SECTIONS = {
  google: { tab: "auth", group: "Verbindungen", label: "Google", superOnly: true },
  zugang: { tab: "auth", group: "System", label: "Zugang", superOnly: true },
  resend: { tab: "email", group: "Verbindungen", label: "Resend" },
  smtp: { tab: "smtp", group: "Verbindungen", label: "SMTP" },
  newsletter: { tab: "newsletter", group: "E-Mail", label: "Newsletter" },
  "mail-queue": { tab: "queue", group: "E-Mail", label: "Mail-Queue" },
  branding: { tab: "brand", group: "Auftritt", label: "Branding" },
  socials: { tab: "socials", group: "Auftritt", label: "Socials" },
  seo: { tab: "seo", group: "Auftritt", label: "SEO & Analytics" },
  status: { tab: "system", group: "System", label: "Status" },
};

export const GOOGLE_SWITCHES = [
  ["google_login_enabled", "Google-Login", "Bestehende verknüpfte Nutzer können sich mit Google anmelden."],
  ["google_registration_enabled", "Registrierung mit Google", "Neue Nutzer dürfen nach ausdrücklicher Zustimmung einen Account über Google erstellen."],
  ["google_linking_enabled", "Google nachträglich verknüpfen", "Eingeloggte Nutzer können Google mit ihrem bestehenden Konto verbinden."],
];

export const ACCESS_SWITCHES = [
  ["password_login_enabled", "E-Mail & Passwort Login", "Klassische Anmeldung mit E-Mail und Passwort."],
  ["registration_enabled", "Registrierung offen", "Neue Nutzer können selbst einen Community-Account erstellen."],
];
// Alte Reiter-Links (?tab=…) und Lesezeichen landen auf der passenden Seite.

export const LEGACY_TAB_REDIRECTS = {
  legal: "/admin/club", discord: "/admin/integrations/discord", twitch: "/admin/integrations/twitch",
  auth: "/admin/settings/google", email: "/admin/settings/resend", smtp: "/admin/settings/smtp", newsletter: "/admin/settings/newsletter",
  queue: "/admin/settings/mail-queue", logs: "/admin/ops?tab=events&source=email", brand: "/admin/settings/branding", socials: "/admin/settings/socials",
  seo: "/admin/settings/seo", system: "/admin/settings/status",
};

export const INDEXNOW_DEFAULT_PATHS = ["/", "/sitemap.xml", "/sitemap-news.xml", "/news", "/events", "/esports", "/tournaments", "/fastlap", "/galerie", "/members"];

export const BANNER_TEMPLATE_PRESETS = {
  custom: { title: "Eigener Hinweis", text: "", tone: "info", style: "neon", link_label: "Mehr", scope: "all" },
  live: { title: "Live-Hinweis", text: "Wir sind live - schau jetzt im Stream vorbei.", tone: "live", style: "solid", link_label: "Stream öffnen", scope: "all" },
  maintenance: { title: "Wartung", text: "Wartung aktiv - einzelne Funktionen können kurzzeitig nicht verfügbar sein.", tone: "warning", style: "minimal", link_label: "Status", scope: "all" },
  event: { title: "Event", text: "Nächstes Event steht bevor - sichere dir deinen Platz.", tone: "info", style: "neon", link_label: "Event ansehen", scope: "events" },
  registration: { title: "Anmeldung offen", text: "Anmeldung ist geöffnet - jetzt teilnehmen.", tone: "success", style: "solid", link_label: "Anmelden", scope: "tournaments" },
  discord: { title: "Discord", text: "Komm auf unseren Discord und bleib in der Community am Ball.", tone: "info", style: "minimal", link_label: "Discord öffnen", scope: "community" },
};

export const BANNER_SCOPE_OPTIONS = [
  ["all", "Ganze Website"],
  ["tournaments", "Turniere"],
  ["fastlap", "Fast Lap"],
  ["events", "Events"],
  ["news", "News"],
  ["servers", "Server"],
  ["community", "Community"],
  ["members", "Verein"],
  ["custom", "Eigener Pfad"],
];

export function defaultSocialLinks() {
  return [
    { platform: "discord", label: "Discord", url: "https://discord.com/invite/thelionsquadesports", enabled: true },
    { platform: "whatsapp", label: "WhatsApp Kanal", url: "https://whatsapp.com/channel/0029VaaWufTGU3BNG6VOxo1I", enabled: true },
    { platform: "facebook", label: "Facebook", url: "https://www.facebook.com/thelionsquadesports", enabled: true },
    { platform: "instagram", label: "Instagram", url: "https://instagram.com/thelionsquadesports", enabled: true },
    { platform: "tiktok", label: "TikTok", url: "https://www.tiktok.com/@thelionsquadesports", enabled: true },
    { platform: "youtube", label: "YouTube", url: "https://www.youtube.com/@TheLionSquadeSports", enabled: true },
    { platform: "twitch", label: "Twitch", url: "https://www.twitch.tv/the_lion_squad_esports", enabled: true },
  ];
}

export function emptyBannerForm() {
  return {
    title: "",
    text: "",
    enabled: true,
    priority: 50,
    tone: "info",
    mode: "ticker",
    speed_seconds: 22,
    style: "neon",
    position: "below_nav",
    scope: "all",
    path: "",
    audience: "all",
    link_url: "",
    link_label: "",
    starts_at: "",
    ends_at: "",
    template: "custom",
    // Wo der Banner läuft (#245): Website, App oder beides.
    channels: ["web"],
  };
}

export function bannerTickerDuration(text, configuredSpeed) {
  const saved = Number(configuredSpeed || 22);
  const automatic = Math.ceil(String(text || "").length / 3.6);
  return Math.max(8, Math.min(180, Math.max(saved, automatic)));
}

export function toDateTimeInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function fromDateTimeInput(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function emailPayload(source) {
  const payload = { ...(source || {}) };
  if (!payload.resend_api_key) delete payload.resend_api_key;
  delete payload.resend_api_key_masked;
  return payload;
}

export function smtpPayload(source) {
  const payload = { ...(source || {}) };
  if (!payload.smtp_pass) delete payload.smtp_pass;
  delete payload.smtp_pass_masked;
  return payload;
}

// Geheimnisse gehen nur mit, wenn neu eingetippt; die „gespeichert“-Marke nie (#260 dazu: Discord, Steam).

export const BRAND_SECRET_FIELDS = [...new Set(["twitch_client_secret", ...PLATFORM_SECRET_FIELDS])];

export function brandPayload(source = {}) {
  const payload = normalizeAnalyticsPayload(source);
  for (const field of BRAND_SECRET_FIELDS) {
    if (!payload[field]) delete payload[field];
    delete payload[`${field}_masked`];
  }
  return payload;
}

export function mailTemplateLabel(job) {
  return MAIL_TEMPLATE_LABELS[job?.template_key] || job?.template_key || "Mail";
}

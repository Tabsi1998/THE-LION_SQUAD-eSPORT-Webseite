import { Bell, Eye, Gamepad2, Globe, Info, LayoutDashboard, Settings, ShieldCheck, Sparkles, User, UserCircle } from "lucide-react";

// Das Benutzermenü (#282, #516, #1150): eine Liste für den Kopf am PC und das Handy-Menü - jedes Thema an genau einem
// Ort. Nachrichten stehen unter Community → Chats, Benachrichtigungen hinter der Glocke, Rechnungen, Gewinne und Strafen
// im eigenen Profil („Nur für dich“), „Mitglied werden“ unter Verein, Hilfe & Kontakt im Hauptmenü. Hier bleiben das
// Dashboard, das eigene Profil und die Einstellungen; Mitgliederbereich, Admin und Abmelden hängt das Menü selbst an.
export function userMenuEntries({ username = "" } = {}) {
  return [
    { key: "dashboard", to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "profile", to: `/u/${username}`, label: "Mein Profil", icon: UserCircle },
    { key: "settings", to: "/profile", label: "Einstellungen", icon: Settings },
  ];
}

// Die Einträge im Kopf des Menüs behalten ihre alten Kennungen (Smoke-Tests, Links aus Mails).
export const USER_MENU_TEST_IDS = { dashboard: "nav-dashboard", profile: "nav-profile" };
export function userMenuTestId(key, suffix = "") {
  const base = USER_MENU_TEST_IDS[key] || `nav-account-${key}`;
  return suffix ? `${base}${suffix}` : base;
}

// Einstellungen an einem Ort (#1146): /profile hat dieselben Gruppen in derselben Reihenfolge wie die App - Darstellung,
// Benachrichtigungen, Sicherheit, Privatsphäre, Konto, Über die App. Was keine Einstellung ist, hat seinen Ort woanders:
// Teams unter Community → Teams, Freunde unter Community → Spieler, Erfolge, Ehrungen, Rechnungen und Gewinne im eigenen
// Profil (/u/me). Alte Adressen (?tab=teams …) leiten dorthin weiter (TAB_REDIRECTS).
export const SETTINGS_GROUPS = [
  { key: "appearance", label: "Darstellung", tabs: [{ k: "appearance", label: "Saison-Deko und Töne", icon: Sparkles }] },
  // „Benachrichtigungen“ ist die Liste hinter der Glocke; hier werden sie eingestellt (#516).
  { key: "notifications", label: "Benachrichtigungen", tabs: [{ k: "notifications", label: "Benachrichtigungen einstellen", icon: Bell }] },
  // Sicherheit bündelt seit #258 Passwort, Passkeys, Zwei-Faktor, Google und die Geräte (?tab=sessions landet hier).
  { key: "security", label: "Sicherheit", tabs: [{ k: "security", label: "Sicherheit", icon: ShieldCheck }] },
  { key: "privacy", label: "Privatsphäre", tabs: [{ k: "privacy", label: "Privatsphäre", icon: Eye }] },
  { key: "account", label: "Konto", tabs: [
    { k: "basic", label: "Grunddaten", icon: User },
    { k: "gaming", label: "Gaming", icon: Gamepad2 },
    { k: "socials", label: "Socials", icon: Globe },
  ] },
  { key: "about", label: "Über die App", tabs: [{ k: "about", label: "App und Rechtliches", icon: Info }] },
];

export const TABS = SETTINGS_GROUPS.flatMap((group) => group.tabs.map((tab) => ({ ...tab, group: group.key })));

/** Frühere Reiter von /profile, die keine Einstellungen sind - sie haben einen eigenen Ort (#1150). */
export function tabRedirect(tab, params, username = "") {
  const me = username ? `/u/${username}` : "/u/me";
  switch (tab) {
    case "teams":
      return "/teams";
    case "friends":
      return "/players";
    case "achievements":
      return `${me}?tab=achievements`;
    case "honours":
      return `${me}?tab=honours`;
    case "invoices": {
      const invoice = params?.get?.("invoice") || "";
      return `/account/invoices${/^d-\d{1,12}$/.test(invoice) ? `?invoice=${invoice}` : ""}`;
    }
    case "inbox":
      return `/messages${params?.get?.("to") ? `/${params.get("to")}` : ""}`;
    default:
      return null;
  }
}

export const PLATFORMS = [
  { value: "PC", label: "PC" },
  { value: "PS5", label: "PlayStation 5" },
  { value: "PS4", label: "PlayStation 4" },
  { value: "Xbox", label: "Xbox Series" },
  { value: "Xbox_One", label: "Xbox One" },
  { value: "Switch2", label: "Switch 2" },
  { value: "Switch", label: "Switch" },
  { value: "Mobile", label: "Mobile" },
  { value: "Steam_Deck", label: "Steam Deck" },
  { value: "VR", label: "VR" },
];

export const INPUT_DEVICES = [
  { value: "keyboard_mouse", label: "Tastatur + Maus" },
  { value: "controller", label: "Controller" },
  { value: "wheel", label: "Lenkrad" },
  { value: "fightstick", label: "Fightstick" },
  { value: "mobile_touch", label: "Touch / Mobile" },
  { value: "arcade", label: "Arcade Stick" },
];

export const SUBSCRIPTIONS = [
  { value: "nintendo_online", label: "Nintendo Online" },
  { value: "nintendo_online_expansion", label: "Nintendo Online + Expansion" },
  { value: "ps_plus_essential", label: "PS Plus Essential" },
  { value: "ps_plus_extra", label: "PS Plus Extra" },
  { value: "ps_plus_premium", label: "PS Plus Premium" },
  { value: "xbox_game_pass", label: "Xbox Game Pass" },
  { value: "xbox_game_pass_ultimate", label: "Xbox Game Pass Ultimate" },
  { value: "ea_play", label: "EA Play" },
  { value: "ea_play_pro", label: "EA Play Pro" },
  { value: "ubisoft_plus", label: "Ubisoft+" },
  { value: "geforce_now", label: "GeForce NOW" },
];

export const DIRECT_MESSAGE_PRIVACY = [
  ["everyone", "Alle eingeloggten Benutzer"],
  ["friends", "Nur Freunde"],
  ["team_members", "Nur gemeinsame Teammitglieder"],
  ["club_members", "Nur Vereinsmitglieder"],
  ["admins_only", "Nur Admins"],
  ["none", "Niemand"],
];

export const GENDER_OPTIONS = [
  ["", "Keine Angabe"],
  ["male", "Männlich"],
  ["female", "Weiblich"],
  ["diverse", "Divers"],
];

export const EMAIL_PREFERENCES = [
  { k: "match_reminders", l: "Spiel-Erinnerungen", d: "Startzeiten, Spiel-Hub und Check-in-nahe Hinweise.", defaultOn: true },
  { k: "tournament_updates", l: "Turnier-Updates", d: "Anmeldung, Status, Ergebnisse und wichtige Turnierinfos.", defaultOn: true },
  { k: "prize_updates", l: "Gewinne & Abholung", d: "Gewinn bereit, übergeben oder Frist abgelaufen.", defaultOn: true },
  // Erfolge (#568): In-App, Push und Discord - eine Mail dafür gibt es nicht, die Spalte zeigt einen Strich.
  { k: "achievements", l: "Erfolge", d: "Freigeschaltete Erfolge – als Gratulation.", defaultOn: true, channels: ["in_app", "push", "discord"] },
  // Wochenrückblick (#622): montags eine Mail an dich selbst - nur bei Aktivität, nur per E-Mail.
  { k: "achievement_recap", l: "Wochenrückblick", d: "Montags eine kurze Mail mit deinen XP, deinem Level und neuen Erfolgen – nur, wenn du in der Woche etwas erreicht hast.", defaultOn: true, channels: ["email"] },
  // Rechnungen (#841): „Deine Rechnung ist da“ - Beträge gehen nie über Discord, die Spalte zeigt dort einen Strich.
  { k: "billing_updates", l: "Rechnungen", d: "Neue Rechnung mit Betrag, Zahlungsziel und Link zum PDF in deinem Konto.", defaultOn: true, channels: ["in_app", "push", "email"] },
  { k: "membership_updates", l: "Vereinsmitgliedschaft", d: "Bewerbung, Mitgliedsstatus und Vereinsvorteile.", defaultOn: true },
  { k: "birthday_greetings", l: "Geburtstagsgruß", d: "Einmal im Jahr eine Geburtstagsmail vom Verein.", defaultOn: true },
  { k: "community_messages", l: "Nachrichten & Erwähnungen", d: "Direktnachrichten, Team-Chat-Erwähnungen und ähnliche Community-Hinweise.", defaultOn: true },
  { k: "news_events", l: "News & Events", d: "Neue Vereinsnews, neue Events und wichtige Ankündigungen.", requiresNewsletter: true },
  { k: "club_internal", l: "Vereinsintern", d: "Interne Events und News, die nur Mitglieder sehen.", defaultOn: true },
  // Helferdienste (#1197): Aufruf des Vorstands und Erinnerung am Vortag - nur für Mitglieder, keine Mail.
  { k: "helper_shifts", l: "Helferdienste", d: "Nur für Vereinsmitglieder: Aufrufe für offene Helferschichten und die Erinnerung am Vortag.", defaultOn: true, channels: ["in_app", "push", "discord"] },
];

export const NOTIFICATION_CHANNELS = [
  { k: "email", l: "E-Mail", d: "Nur wichtige optionale Hinweise per Mail.", defaultOn: true },
  { k: "push", l: "Push", d: "System-Benachrichtigungen auf registrierten Mobilgeräten.", defaultOn: true },
  { k: "in_app", l: "In-App", d: "Hinweise in Web, App und Notification-Center.", defaultOn: true },
  // Discord als Kanal (#567): Direktnachricht vom Vereins-Bot, nur mit verknüpftem Konto - Standard aus.
  { k: "discord", l: "Discord", d: "Direktnachricht vom Vereins-Bot – nur mit verknüpftem Discord-Konto.", defaultOn: false },
];
export const notificationPreferenceKey = (channel, topic) => `${channel}:${topic}`;

export const ACHIEVEMENT_ACTIONS = {
  profile_completion: "Profil weiter ausfüllen",
  tournaments_joined: "Bei Turnieren mitmachen",
  tournaments_won: "Turniere gewinnen",
  matches_played: "Spiele spielen",
  matches_won: "Spiele gewinnen",
  f1_laps_submitted: "Fast-Lap-Zeiten einreichen",
  f1_podiums: "Fast-Lap-Podium holen",
  f1_wins: "Fast-Lap-Challenge gewinnen",
  discord_messages: "Im Discord aktiv sein",
  twitch_live_sessions: "Mit Twitch live gehen",
  twitch_stream_minutes: "Streamzeit sammeln",
  membership_days: "Vereinsmitgliedschaft pflegen",
};
// Begriffe statt Rohwerten: vorher stand "LEADER" in der Teamkarte (#253).
export const TEAM_ROLE_LABELS = { leader: "Leitung", co_leader: "Co-Leitung", member: "Mitglied" };

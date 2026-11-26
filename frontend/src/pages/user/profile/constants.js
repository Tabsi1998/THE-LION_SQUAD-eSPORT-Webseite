import { Bell, CalendarPlus, Eye, Gamepad2, Globe, Info, LayoutDashboard, ShieldCheck, Sparkles, User } from "lucide-react";
import { gruppe, gruppenFuer } from "@/lib/meinBereich";

// Das Benutzermenü (#282, #516, #1150, #2059): eine Liste für den Kopf am PC und das Handy-Menü - das Dashboard, dann
// „Mein Bereich“ mit seinen Gruppen, direkt anspringbar. Nachrichten stehen unter Community → Chats, die Liste der
// Benachrichtigungen hinter der Glocke, „Mitglied werden“ unter Verein. Das eigene öffentliche Profil öffnet der Kopf des
// Menüs (Name, „So sehen andere mich“); Admin und Abmelden hängt das Menü selbst an.
export function userMenuEntries({ mitglied = false } = {}) {
  return [
    { key: "dashboard", to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ...gruppenFuer({ mitglied }).map((item) => ({
      key: item.key,
      to: item.path,
      label: item.key === "start" ? "Mein Bereich" : item.label,
      icon: item.icon,
      bereich: true,
    })),
  ];
}

// Die Einträge im Kopf des Menüs behalten ihre alten Kennungen (Smoke-Tests, Links aus Mails).
export const USER_MENU_TEST_IDS = { dashboard: "nav-dashboard", profile: "nav-profile" };
export function userMenuTestId(key, suffix = "") {
  const base = USER_MENU_TEST_IDS[key] || `nav-account-${key}`;
  return suffix ? `${base}${suffix}` : base;
}

// Die Einstellungen in „Mein Bereich“ (#2059): vier Gruppen mit je ihren Reitern - dieselben Formulare, die vorher unter
// /profile standen, jetzt dort, wo man sie sucht. Darstellung, Kalender-Abo und „App & Rechtliches“ gehören zum Konto.
// Was keine Einstellung ist (Teams, Freunde, Erfolge, Ehrungen, Rechnungen), hat seinen Ort woanders; alte Adressen
// leiten dorthin weiter (lib/meinBereich.js, legacyTarget).
const settingsGroup = (key, tabs) => ({ key, label: gruppe(key).label, tabs });
export const SETTINGS_GROUPS = [
  settingsGroup("profil", [
    { k: "basic", label: "Grunddaten", icon: User },
    { k: "gaming", label: "Gaming & Spiel-IDs", icon: Gamepad2 },
    { k: "socials", label: "Socials", icon: Globe },
  ]),
  // „Benachrichtigungen“ ist die Liste hinter der Glocke; hier werden sie eingestellt (#516).
  settingsGroup("benachrichtigungen", [{ k: "notifications", label: "Benachrichtigungen einstellen", icon: Bell }]),
  // Sicherheit bündelt seit #258 Passwort, Passkeys, Zwei-Faktor, Google und die Geräte (?tab=sessions landet hier).
  settingsGroup("konto", [
    { k: "security", label: "Sicherheit", icon: ShieldCheck },
    { k: "appearance", label: "Darstellung", icon: Sparkles },
    // Mein Kalender-Abo (#1788): der feste Ort für den persönlichen Abo-Link - die App bekommt denselben Eintrag.
    { k: "calendar", label: "Kalender-Abo", icon: CalendarPlus },
    { k: "about", label: "App & Rechtliches", icon: Info },
  ]),
  settingsGroup("datenschutz", [{ k: "privacy", label: "Sichtbarkeit", icon: Eye }]),
];

export const TABS = SETTINGS_GROUPS.flatMap((group) => group.tabs.map((tab) => ({ ...tab, group: group.key })));

/** Zu welcher Gruppe ein Einstellungs-Reiter gehört. */
export function settingsGroupOf(tab) {
  return TABS.find((item) => item.k === tab)?.group || null;
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
  ["admins_only", "Nur Moderation und Admins"],
  ["none", "Niemand außer der Moderation"],
];

export const GENDER_OPTIONS = [
  ["", "Keine Angabe"],
  ["male", "Männlich"],
  ["female", "Weiblich"],
  ["diverse", "Divers"],
];

export const EMAIL_PREFERENCES = [
  // Spiele & Aufrufe (#1204): gleicher Name wie am Server und in der Stufen-Liste.
  { k: "match_reminders", l: "Spiele & Aufrufe", d: "Aufruf zum Spiel, Spielstart, Erinnerungen, Check-in, Veto und Ergebnisse deiner Spiele.", defaultOn: true },
  // Liga-Meldungen und Belohnungen der Liga laufen unter Turnier-Updates (#1204).
  { k: "tournament_updates", l: "Turnier-Updates", d: "Anmeldung, Status, Hinweise der Turnierleitung, Liga-Rundnachrichten und Belohnungen der Liga.", defaultOn: true },
  { k: "prize_updates", l: "Gewinne & Abholung", d: "Gewinn bereit, übergeben oder Frist abgelaufen.", defaultOn: true },
  // Erfolge (#568): In-App, Push und Discord - eine Mail dafür gibt es nicht, die Spalte zeigt einen Strich.
  { k: "achievements", l: "Erfolge", d: "Freigeschaltete Erfolge, Kronen und neue Level – als Gratulation.", defaultOn: true, channels: ["in_app", "push", "browser", "discord"] },
  // Wochenrückblick (#622): montags eine Mail an dich selbst - nur bei Aktivität, nur per E-Mail.
  { k: "achievement_recap", l: "Wochenrückblick", d: "Montags eine kurze Mail mit deinen XP, deinem Level und neuen Erfolgen – nur, wenn du in der Woche etwas erreicht hast.", defaultOn: true, channels: ["email"] },
  // Rechnungen (#841): „Deine Rechnung ist da“ - Beträge gehen nie über Discord, die Spalte zeigt dort einen Strich.
  { k: "billing_updates", l: "Rechnungen", d: "Neue Rechnung mit Betrag, Zahlungsziel und Link zum PDF in deinem Konto.", defaultOn: true, channels: ["in_app", "push", "browser", "email"] },
  { k: "membership_updates", l: "Vereinsmitgliedschaft", d: "Einladungen zum Antrag, Nummern und Vereinsvorteile. Entscheidungen über deine Mitgliedschaft bekommst du immer per Mail.", defaultOn: true },
  { k: "birthday_greetings", l: "Geburtstagsgruß", d: "Einmal im Jahr eine Geburtstagsmail vom Verein.", defaultOn: true },
  { k: "community_messages", l: "Nachrichten & Erwähnungen", d: "Direktnachrichten, Team-Chat-Erwähnungen und ähnliche Community-Hinweise.", defaultOn: true },
  { k: "news_events", l: "News & Events", d: "Neue Vereinsnews, neue Events und wichtige Ankündigungen.", requiresNewsletter: true },
  { k: "club_internal", l: "Vereinsintern", d: "Interne Events und News, die nur Mitglieder sehen.", defaultOn: true },
  // Helferdienste (#1197): Aufruf des Vorstands und Erinnerung am Vortag - nur für Mitglieder, keine Mail.
  { k: "helper_shifts", l: "Helferdienste", d: "Nur für Vereinsmitglieder: Aufrufe für offene Helferschichten und die Erinnerung am Vortag.", defaultOn: true, channels: ["in_app", "push", "browser", "discord"] },
];

export const NOTIFICATION_CHANNELS = [
  { k: "email", l: "E-Mail", d: "Nur wichtige optionale Hinweise per Mail.", defaultOn: true },
  { k: "push", l: "Push", d: "System-Benachrichtigungen auf registrierten Mobilgeräten.", defaultOn: true },
  // Browser-Benachrichtigungen (#1163): wie Push, nur im Browser - nur da, wenn der Server sie eingerichtet hat.
  { k: "browser", l: "Browser", d: "Meldungen im Browser – auch bei geschlossener Website, sobald du dort zugestimmt hast.", defaultOn: true },
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
export const TEAM_ROLE_LABELS = { leader: "Teamleitung", co_leader: "Co-Leitung", member: "Mitglied" };

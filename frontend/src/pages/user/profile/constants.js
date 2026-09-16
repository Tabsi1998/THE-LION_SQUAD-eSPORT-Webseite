import { Bell, Eye, Gamepad2, Globe, Medal, ShieldCheck, User, UserPlus, Users } from "lucide-react";

// Privatsphäre und Benachrichtigungen sind seit #257 zwei Reiter; Mails
// verlinken die Benachrichtigungen mit ?tab=notifications. Die Inbox ist seit
// #254 die eigene Seite /messages; ?tab=inbox leitet dorthin um.
export const TABS = [
  { k: "basic", label: "Grunddaten", icon: User },
  { k: "gaming", label: "Gaming", icon: Gamepad2 },
  { k: "socials", label: "Socials", icon: Globe },
  { k: "teams", label: "Teams", icon: Users },
  { k: "friends", label: "Freunde", icon: UserPlus },
  { k: "achievements", label: "Achievements", icon: Medal },
  { k: "privacy", label: "Privatsphäre", icon: Eye },
  { k: "notifications", label: "Benachrichtigungen", icon: Bell },
  // Sicherheit bündelt seit #258 Passwort, Passkeys, Zwei-Faktor, Google und
  // die Geräte (vorher eigener Reiter „Sitzungen“; ?tab=sessions landet hier).
  { k: "security", label: "Sicherheit", icon: ShieldCheck },
];

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
  { k: "membership_updates", l: "Vereinsmitgliedschaft", d: "Bewerbung, Mitgliedsstatus und Vereinsvorteile.", defaultOn: true },
  { k: "birthday_greetings", l: "Geburtstagsgruß", d: "Einmal im Jahr eine Geburtstagsmail vom Verein.", defaultOn: true },
  { k: "community_messages", l: "Nachrichten & Erwähnungen", d: "Direktnachrichten, Team-Chat-Erwähnungen und ähnliche Community-Hinweise.", defaultOn: true },
  { k: "news_events", l: "News & Events", d: "Neue Vereinsnews, neue Events und wichtige Ankündigungen.", requiresNewsletter: true },
];

export const NOTIFICATION_CHANNELS = [
  { k: "email", l: "E-Mail", d: "Nur wichtige optionale Hinweise per Mail.", defaultOn: true },
  { k: "push", l: "Push", d: "System-Benachrichtigungen auf registrierten Mobilgeräten.", defaultOn: true },
  { k: "in_app", l: "In-App", d: "Hinweise in Web, App und Notification-Center.", defaultOn: true },
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

import type { FaqBereich, FaqFrage } from "./types";

// Der Bereich „LionsAPP“ (#2449): Fragen, die nur die App betreffen und die sie wirklich kann - geprüft am Code:
// Stufen, Themen und Ruhezeit (screens/main/profile/NotificationLevels.tsx, lib/notificationLevels.ts), Android-Kanäle
// und der Gong beim Aufruf (notifications/channels.ts), Passkeys (components/PasskeysCard.tsx) und die App-Sperre
// (lib/appLock.ts), ohne Netz (lib/cache.ts, lib/network.ts, lib/memberCardOffline.ts) und Updates über Google Play
// (components/AppUpdateBanner.tsx). Ändert sich dort die Bedienung, gehört der Text hier mit.
// Links auf Website-Adressen öffnen den passenden Screen der App (navigation/rootNavigation.ts → targetFromUrl):
// /profile?tab=notifications und ?tab=security führen zu den Einstellungen.

export const APP_BEREICH: FaqBereich = {
  id: "lionsapp",
  titel: "LionsAPP",
  kurz: "Push, Aufruf-Ton, Anmelden, ohne Netz und Updates.",
  icon: "app",
  rollen: ["spieler", "captain", "mitglied", "turnierleitung"],
  sichtbar_fuer: "alle",
};

const ALLE = ["spieler", "captain", "mitglied", "turnierleitung"];
const ZU_BENACHRICHTIGUNGEN = { to: "/profile?tab=notifications", label: "Zu den Einstellungen" };
const ZU_SICHERHEIT = { to: "/profile?tab=security", label: "Zu den Einstellungen" };

export const APP_FRAGEN: FaqFrage[] = [
  {
    id: "app-push-stufen",
    frage: "Wie stelle ich Push-Nachrichten in der App ein?",
    antwort: "Öffne im Profil das Zahnrad und dann Benachrichtigungen. Wähl eine Stufe: Alles, Wichtiges oder Wenig. Darunter stellst du jedes Thema auf Push, Nur App oder Aus.",
    bereich: "lionsapp", rollen: ALLE, sichtbar_fuer: "alle",
    link: ZU_BENACHRICHTIGUNGEN,
  },
  {
    id: "app-ruhezeit",
    frage: "Kann ich nachts Ruhe vor Push-Nachrichten haben?",
    antwort: "Ja. Schalte unter Benachrichtigungen die Ruhezeit ein und stell Von und Bis ein. In der Zeit kommt kein Push. Der Aufruf zu deinem eigenen Spiel kommt trotzdem. Die übrigen Meldungen liegen in der Glocke.",
    bereich: "lionsapp", rollen: ALLE, sichtbar_fuer: "alle",
    link: ZU_BENACHRICHTIGUNGEN,
  },
  {
    id: "app-kanaele",
    frage: "Kann ich nur die Chats stumm schalten?",
    antwort: "Ja. Die App legt am Handy eigene Kanäle an: Aufrufe & Spielstart, Turniere & Events, Chats, Verein und Erfolge. In den Handy-Einstellungen bei der LionsAPP schaltest du jeden Kanal einzeln stumm. Den Aufruf zum Spiel verpasst du so nicht.",
    bereich: "lionsapp", rollen: ALLE, sichtbar_fuer: "alle",
  },
  {
    id: "app-kein-push",
    frage: "Ich bekomme keine Push-Nachrichten. Was tun?",
    antwort: "Prüf zuerst, ob du in der App angemeldet bist. Dann erlaub in den Handy-Einstellungen Benachrichtigungen für die LionsAPP. Zuletzt schau in der App unter Benachrichtigungen, ob das Thema auf Push steht.",
    bereich: "lionsapp", rollen: ALLE, sichtbar_fuer: "alle",
    link: ZU_BENACHRICHTIGUNGEN,
  },
  {
    id: "app-aufruf-ton",
    frage: "Wie klingt der Aufruf zu meinem Spiel?",
    antwort: "Der Aufruf, „Match startet jetzt“ und die Erinnerung vor dem Spiel kommen mit einem eigenen Gong und kräftiger Vibration. Ton und Lautstärke änderst du in den Handy-Einstellungen beim Kanal Aufrufe & Spielstart.",
    bereich: "lionsapp", rollen: ["spieler", "captain", "turnierleitung"], sichtbar_fuer: "alle", haeufig: true,
  },
  {
    id: "app-passkey",
    frage: "Kann ich mich mit Fingerabdruck anmelden?",
    antwort: "Ja, mit einem Passkey. Leg ihn unter Einstellungen bei Sicherheit an, dafür brauchst du einmal dein Passwort. Danach bietet die App beim Anmelden Fingerabdruck, Gesicht oder Displaysperre an.",
    bereich: "lionsapp", rollen: ALLE, sichtbar_fuer: "alle",
    link: ZU_SICHERHEIT,
  },
  {
    id: "app-sperre",
    frage: "Kann ich die App mit Fingerabdruck sperren?",
    antwort: "Ja. Schalte unter Einstellungen bei Sicherheit die App-Sperre ein. Dann fragt die App beim Start und nach einer Minute im Hintergrund nach Fingerabdruck, Gesicht oder Gerätesperre. Das gilt nur auf diesem Handy.",
    bereich: "lionsapp", rollen: ALLE, sichtbar_fuer: "alle",
    link: ZU_SICHERHEIT,
  },
  {
    id: "app-offline",
    frage: "Was zeigt die App ohne Netz?",
    antwort: "Was du zuletzt geöffnet hast, solange die App offen bleibt: bis zu einen Tag alt, Spielstände bis zu einer Stunde. Oben steht dann Offline mit der Uhrzeit des Stands. Deine Mitgliedskarte bleibt auch ohne Netz da. Kommt das Netz zurück, verschwindet die Leiste. Zum Neuladen ziehst du die Seite nach unten.",
    bereich: "lionsapp", rollen: ALLE, sichtbar_fuer: "alle",
  },
  {
    id: "app-aktualisieren",
    frage: "Wie aktualisiere ich die App?",
    antwort: "Updates kommen über Google Play. Gibt es eine neue Version, zeigt die App einen Hinweis. Tippe auf Update starten. Was neu ist, steht in den Einstellungen unter Über die App bei Was ist neu.",
    bereich: "lionsapp", rollen: ALLE, sichtbar_fuer: "alle", haeufig: true,
  },
];

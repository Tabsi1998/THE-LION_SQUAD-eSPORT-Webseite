// Android-Kanäle (#1138): jede Benachrichtigungsart landet in genau einem Kanal - die Liste der Arten steht am Server
// (backend/services/push_notifications.py → PUSH_CHANNELS). In den Handy-Einstellungen lässt sich jeder Kanal einzeln
// stumm schalten; wer die Chats leise stellt, verpasst den Spielaufruf nicht mehr.
//
// Aufteilung des Betreibers vom 07.10.2026:
// - „Aufrufe & Spielstart“ (wichtig, mit dem Gong): Aufruf, „Match startet jetzt“, Erinnerung vor dem Spiel; für die
//   Turnierleitung „Braucht Aufmerksamkeit“ (Dispute, abweichende Meldungen).
// - „Turniere & Events“: Check-in, Ergebnisse, Turnier-Updates, Gewinne, Event-Hinweise.
// - „Chats“: Direkt-, Team-, Turnier- und Match-Chat, Erwähnungen, Freundschafts- und Team-Einladungen.
// - „Verein“: Vereinsintern, News, Mitgliedschaft, Rechnungen.
// - „Erfolge“: Erfolge, Level, Kronen.
//
// Android ändert Ton und Wichtigkeit eines Kanals nach dem Anlegen nie mehr - deshalb neue Kennungen statt die alten
// („default“, „tournaments“) umzubauen; die alten werden gelöscht. Wer später den Ton ändern will, braucht wieder eine
// neue Kennung (für „normaler Ton“ beim Aufruf, #1164, ein zweiter Aufruf-Kanal).

export type ChannelImportance = "MAX" | "HIGH" | "DEFAULT";

export type PushChannel = {
  id: string;
  name: string;
  description: string;
  importance: ChannelImportance;
  /** Ton aus res/raw (über app.json → expo-notifications → "sounds") - oder der Ton des Handys. */
  sound: string;
  vibrationPattern: number[];
  lightColor: string;
};

/** Welche Kanäle die App anlegt - der Server schickt an Geräte mit diesem Stand die neuen Kennungen. */
export const PUSH_CHANNEL_SET = 2;
export const CALL_GONG_SOUND = "lion_call_gong.wav";

export const PUSH_CHANNELS: PushChannel[] = [
  {
    id: "lion_calls",
    name: "Aufrufe & Spielstart",
    description: "Du bist dran, Match startet jetzt, Erinnerung vor dem Spiel – für die Turnierleitung: braucht Aufmerksamkeit.",
    importance: "MAX",
    sound: CALL_GONG_SOUND,
    vibrationPattern: [0, 400, 200, 400],
    lightColor: "#FFD700",
  },
  {
    id: "lion_tournaments",
    name: "Turniere & Events",
    description: "Check-in, Ergebnisse, Anmeldungen, Gewinne und Event-Hinweise.",
    importance: "HIGH",
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#29B6E8",
  },
  {
    id: "lion_chats",
    name: "Chats",
    description: "Direkt-, Team-, Turnier- und Match-Chat, Erwähnungen, Freundschafts- und Team-Einladungen.",
    importance: "HIGH",
    sound: "default",
    vibrationPattern: [0, 150, 120, 150],
    lightColor: "#29B6E8",
  },
  {
    id: "lion_club",
    name: "Verein",
    description: "Vereinsintern, News, Mitgliedschaft und Rechnungen.",
    importance: "DEFAULT",
    sound: "default",
    vibrationPattern: [0, 250],
    lightColor: "#29B6E8",
  },
  {
    id: "lion_achievements",
    name: "Erfolge",
    description: "Erfolge, Level und Kronen.",
    importance: "DEFAULT",
    sound: "default",
    vibrationPattern: [0, 200],
    lightColor: "#FFD700",
  },
];

/** Die Kanäle der App bis Version 1.4 - beim Start gelöscht. */
export const RETIRED_CHANNEL_IDS = ["default", "tournaments"];

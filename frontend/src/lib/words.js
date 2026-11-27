// Ein Wort je Sache (#1238): die Wortliste der Website. Sichtbare Texte nehmen diese Wörter, nicht die Ausweichformen
// daneben. eSports-Begriffe wie Winner Bracket oder Check-in bleiben englisch. Die Verwaltung hat ihre eigene Liste
// (adminWords.js); der Wächter words.test.js prüft die Website-Seiten gegen AVOID.

export const WORDS = {
  signIn: "Anmelden",
  signOut: "Abmelden",
  account: "Konto",
  createAccount: "Konto erstellen",
  register: "Registrieren",
  achievements: "Erfolge",
  joinClub: "Mitglied werden",
};

// Ausweichform -> Wort aus der Liste. Groß- und Kleinschreibung zählt: „login“ in Adressen und Test-IDs bleibt.
export const AVOID = {
  Login: "Anmeldung bzw. Anmelden",
  Einloggen: "Anmelden",
  einloggen: "anmelden",
  Account: "Konto",
  Accounts: "Konten",
  "Public Event": "Öffentliches Event",
  // Glossar (#2542, #2591): Wer für ein Team spricht, heißt in der Liga „Captain“, sonst „Teamleitung“ - nie „Team-Captain“.
  "Team-Captain": "Captain (Liga) bzw. Teamleitung",
  "Team-Captains": "Captains (Liga) bzw. Teamleitungen",
};

/** Wer für ein Team spricht (Glossar, #2542): in der Liga „Captains“, sonst „Teamleitungen“ - wie die App (`teamLeadsWord`). */
export function teamLeadsWord(isLeague) {
  return isLeague ? "Captains" : "Teamleitungen";
}

// Vereinsname mit Untertitel (#1238): steht der Untertitel schon im Namen, kommt er nicht doppelt.
export function nameWithSubtitle(name, subtitle) {
  const cleanName = String(name || "").trim();
  const cleanSubtitle = String(subtitle || "").trim();
  if (!cleanSubtitle) return cleanName;
  if (!cleanName) return cleanSubtitle;
  if (cleanName.toLowerCase().includes(cleanSubtitle.toLowerCase())) return cleanName;
  return `${cleanName} — ${cleanSubtitle}`;
}

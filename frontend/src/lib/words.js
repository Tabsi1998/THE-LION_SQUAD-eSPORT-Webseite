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
};

// Vereinsname mit Untertitel (#1238): steht der Untertitel schon im Namen, kommt er nicht doppelt.
export function nameWithSubtitle(name, subtitle) {
  const cleanName = String(name || "").trim();
  const cleanSubtitle = String(subtitle || "").trim();
  if (!cleanSubtitle) return cleanName;
  if (!cleanName) return cleanSubtitle;
  if (cleanName.toLowerCase().includes(cleanSubtitle.toLowerCase())) return cleanName;
  return `${cleanName} — ${cleanSubtitle}`;
}

// Jedes Thema an genau einem Ort (#1150) - die Website hält dieselbe Zuordnung wie die App (mobile/src/navigation/topics.ts).
// Elf Dinge waren an zwei oder drei Stellen erreichbar; jedes hat jetzt einen Ort, alte Adressen leiten weiter. Der
// Wächter-Test (topics.test.js) prüft das Hauptmenü, das Benutzermenü und die Handy-Leiste gegen diese Liste.

export const WEB_TOPICS = [
  { topic: "Rechnungen", place: "Mein Profil → Nur für dich", path: "/account/invoices", menu: null },
  { topic: "Nachrichten", place: "Community → Chats", path: "/messages", menu: "Community" },
  { topic: "Benachrichtigungen", place: "die Glocke", path: "/notifications", menu: null },
  { topic: "Meine Mitgliedschaft", place: "Mitgliederbereich", path: "/members/membership", menu: null },
  { topic: "Öffentliches Profil", place: "Mein Profil → Schalter „So sehen dich andere“", path: null, menu: null },
  { topic: "Erfolge", place: "deine im Profil, die Bestenliste unter Community", path: "/achievements", menu: "Community" },
  { topic: "Galerie", place: "Verein", path: "/galerie", menu: "Verein" },
  { topic: "Saison-Deko und Einstellungen", place: "Einstellungen → Darstellung (Gäste: Footer)", path: "/profile", menu: null },
  { topic: "Fast Laps", place: "eSports → Fast Lap", path: "/fastlap", menu: "eSports" },
  { topic: "Mitgliedervorteile", place: "Mitgliederbereich", path: "/members/benefits", menu: null },
  { topic: "Interne Termine", place: "Events, gold markiert", path: null, menu: null },
  // Dazu aus #1150 (Web): „Teams entdecken“ nur noch unter Community.
  { topic: "Teams", place: "Community → Teams", path: "/teams", menu: "Community" },
];

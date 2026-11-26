// Jedes Thema an genau einem Ort (#1150). Elf Dinge waren in der App an zwei oder drei Stellen erreichbar; jedes hat jetzt
// genau einen Ort, die zweiten Wege sind weg. Die Liste ist zugleich der Wächter: der Test (topics.test.ts) sucht im
// Quelltext jede Stelle, die das Ziel nennt, und schlägt an, sobald ein zweiter Weg dazukommt. Links von außen und
// Benachrichtigungen (navigation/) zählen nicht - sie führen zum selben Ort. Seit Mein Bereich (#2059) führen dessen Knöpfe
// über Adressen (/mein-bereich/…, navigation/rootNavigation.ts) - also zum selben Ort, ohne zweiten Weg im Quelltext.

export type Topic = {
  topic: string;
  /** Wo es steht - so, wie man es am Telefon erklärt. */
  place: string;
  /** Woran man einen Weg dorthin im Quelltext erkennt. */
  pattern: RegExp;
  /** Die einzigen Dateien (unter src/), die den Weg enthalten dürfen. Leer: nur Links von außen. */
  files: string[];
  /** Der Screen selbst - er nennt seinen eigenen Namen, das ist kein Weg dorthin. */
  self?: string;
};

export const APP_TOPICS: Topic[] = [
  { topic: "Rechnungen", place: "Mein Bereich → Rechnungen & Unterlagen (im Profil unter „Nur für dich“)", pattern: /"MyInvoices"/, files: ["screens/main/ProfileScreen.tsx"], self: "screens/main/MyInvoicesScreen.tsx" },
  // #1255: die eigenen Schreiben aus der Vereinsakte - nicht mehr zwischen den Vereinsdokumenten.
  { topic: "Persönliche Unterlagen", place: "Mein Bereich → Rechnungen & Unterlagen (im Profil unter „Nur für dich“)", pattern: /"MyDocuments"/, files: ["screens/main/ProfileScreen.tsx"], self: "screens/main/MyDocumentsScreen.tsx" },
  { topic: "Nachrichten", place: "Community → Chats", pattern: /section: "chats"|"DirectMessages"/, files: [] },
  { topic: "Benachrichtigungen", place: "die Glocke", pattern: /"Notifications"/, files: ["components/TabHeader.tsx", "notifications/NotificationContext.tsx"], self: "screens/main/NotificationsScreen.tsx" },
  { topic: "Meine Mitgliedschaft", place: "Mein Bereich → Mitgliedschaft (der Tab Verein verlinkt)", pattern: /"MyMembership"/, files: ["screens/main/VereinScreen.tsx"], self: "screens/main/MyMembershipScreen.tsx" },
  { topic: "Öffentliches Profil", place: "Mein Bereich → Profil → Mein Profil ansehen, Schalter „So sehen dich andere“", pattern: /profile-as-others|ownPublicProfile/, files: ["screens/main/PublicProfileScreen.tsx"] },
  { topic: "Erfolge", place: "deine im Profil, die Bestenliste in Community → Bestenlisten", pattern: /"AchievementShowcase"/, files: ["screens/main/CommunityScreen.tsx"], self: "screens/main/AchievementShowcaseScreen.tsx" },
  { topic: "Galerie", place: "Verein → Vom Verein", pattern: /"Gallery"/, files: ["screens/main/VereinScreen.tsx"], self: "screens/main/GalleryScreen.tsx" },
  // Seit #2059 kein Zahnrad mehr: die Einstellungen wohnen in den Gruppen von Mein Bereich (SettingsScreen.tsx).
  { topic: "Saison-Deko und Einstellungen", place: "Mein Bereich → Konto & Sicherheit → Darstellung", pattern: /"Settings"|<DecoSetting/, files: ["screens/main/SettingsScreen.tsx"] },
  { topic: "Fast Laps", place: "Events (Filter „Fast Laps“)", pattern: /"FastLapList"/, files: [] },
  { topic: "Mitgliedervorteile", place: "Verein → Mitgliederbereich → Vorteile", pattern: /section: "benefits"/, files: ["screens/main/VereinScreen.tsx"] },
  { topic: "Interne Termine", place: "Events, gold markiert", pattern: /memberEvents\(/, files: [] },
];

/** Wo der Wächter sucht: alles, was Menschen in der App antippen - ohne Navigation, Tests und Saison-Deko. */
export const TOPIC_SCAN_DIRS = ["screens", "components", "chats", "notifications", "achievements", "advent", "lib"];

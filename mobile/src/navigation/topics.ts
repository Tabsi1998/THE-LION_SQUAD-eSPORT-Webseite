// Jedes Thema an genau einem Ort (#1150). Elf Dinge waren in der App an zwei oder drei Stellen erreichbar; jedes hat jetzt
// genau einen Ort, die zweiten Wege sind weg. Die Liste ist zugleich der Wächter: der Test (topics.test.ts) sucht im
// Quelltext jede Stelle, die das Ziel nennt, und schlägt an, sobald ein zweiter Weg dazukommt. Links von außen und
// Benachrichtigungen (navigation/) zählen nicht - sie führen zum selben Ort.

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
  { topic: "Rechnungen", place: "Profil → Nur für dich", pattern: /"MyInvoices"/, files: ["screens/main/ProfileScreen.tsx"], self: "screens/main/MyInvoicesScreen.tsx" },
  { topic: "Nachrichten", place: "Community → Chats", pattern: /section: "chats"|"DirectMessages"/, files: [] },
  { topic: "Benachrichtigungen", place: "die Glocke", pattern: /"Notifications"/, files: ["components/TabHeader.tsx", "notifications/NotificationContext.tsx"], self: "screens/main/NotificationsScreen.tsx" },
  { topic: "Meine Mitgliedschaft", place: "Verein → Mitgliederbereich", pattern: /"MyMembership"/, files: ["screens/main/VereinScreen.tsx"], self: "screens/main/MyMembershipScreen.tsx" },
  { topic: "Öffentliches Profil", place: "Profil → Schalter „So sehen dich andere“", pattern: /profile-as-others|ownPublicProfile/, files: ["screens/main/PublicProfileScreen.tsx"] },
  { topic: "Erfolge", place: "deine im Profil, die Bestenliste in Community → Bestenlisten", pattern: /"AchievementShowcase"/, files: ["screens/main/CommunityScreen.tsx"], self: "screens/main/AchievementShowcaseScreen.tsx" },
  { topic: "Galerie", place: "Verein → Vom Verein", pattern: /"Gallery"/, files: ["screens/main/VereinScreen.tsx"], self: "screens/main/GalleryScreen.tsx" },
  { topic: "Saison-Deko und Einstellungen", place: "Profil → Zahnrad", pattern: /"Settings"|<DecoSetting/, files: ["screens/main/ProfileScreen.tsx", "screens/main/SettingsScreen.tsx"] },
  { topic: "Fast Laps", place: "Events (Filter „Fast Laps“)", pattern: /"FastLapList"/, files: [] },
  { topic: "Mitgliedervorteile", place: "Verein → Mitgliederbereich → Vorteile", pattern: /section: "benefits"/, files: ["screens/main/VereinScreen.tsx"] },
  { topic: "Interne Termine", place: "Events, gold markiert", pattern: /memberEvents\(/, files: [] },
];

/** Wo der Wächter sucht: alles, was Menschen in der App antippen - ohne Navigation, Tests und Saison-Deko. */
export const TOPIC_SCAN_DIRS = ["screens", "components", "chats", "notifications", "achievements", "advent", "lib"];

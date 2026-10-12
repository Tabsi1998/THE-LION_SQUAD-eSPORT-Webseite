// Farben je Art an einer Stelle (#1151): Kalender, Karten und Etiketten der Website nehmen sie von hier, die App hat
// dieselben Werte in mobile/src/theme.ts (`kindColors`) - ein Test (categoryColors.test.js) hält beide gleich. Die neue
// Zuordnung aus #1305 (Event Violett, Turnier Cyan, Fast Lap Türkis, Verein Gold) ändert dann beide Stellen zugleich.

// „club“ (#1190): Versammlungen und eigene Helferschichten im Kalender - grün, nur für Mitglieder.
export const KIND_COLORS = { event: "#9F7AEA", tournament: "#FFD700", fastlap: "#29B6E8", club: "#10B981" };

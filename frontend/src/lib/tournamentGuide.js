// Turnier-Leitfaden (#228, Block 16): welches Turnier man wie einstellt. Der Text wird mit der
// Software ausgeliefert, damit er zu den Feldern passt. Drei Teile: der Ablauf unabhängig vom
// Spiel, die Turnierformen mit Teamgröße und Serie, und welches Format wofür. Jede Empfehlung
// zeigt auf das Feld im Formular „Turnier anlegen“ (`field`) – Schritt 2 (Voreinstellung
// übernehmen, #368) hängt daran.

export const GUIDE_STEPS = [
  {
    key: "rules-first",
    title: "Regelwerk, Format und Seeding vor der Anmeldung veröffentlichen",
    why: "Wer sich anmeldet, weiß, worauf er sich einlässt. Nachträgliche Änderungen kosten Vertrauen und Zeit im Streitfall.",
    how: "Regeln in das Feld „Regeln“, Format und Sichtbarkeit setzen, erst dann „Anmeldung öffnet“.",
    fields: ["Regeln", "Format", "Sichtbarkeit", "Anmeldung öffnet"],
  },
  {
    key: "check-in",
    title: "Check-in 30 bis 60 Minuten vor dem Start",
    why: "So sieht die Turnierleitung vor dem ersten Match, wer wirklich da ist, und kann den Baum mit den Anwesenden erzeugen.",
    how: "„Check-in öffnet“ eine Stunde vor Start, „Check-in endet“ zehn Minuten vor Start.",
    fields: ["Check-in öffnet", "Check-in endet"],
  },
  {
    key: "forfeit",
    title: "Nicht erschienen: nach 10 bis 15 Minuten Forfeit",
    why: "Ein Turnier, das auf einen Spieler wartet, verliert alle anderen. Eine feste Frist ist fair, weil sie vorher bekannt ist.",
    how: "Frist in die Regeln schreiben; die Turnierleitung setzt im Match „Walkover“ – das Ergebnis trägt dann den Grund.",
    fields: ["Regeln", "Walkover im Match"],
  },
  {
    key: "groups",
    title: "Ab etwa 32 Teilnehmern Gruppen zu 4 bis 8, danach Turnierbaum",
    why: "Ein reiner K.-o.-Baum mit 32 Teilnehmern ist für die Hälfte nach einem Spiel vorbei. Gruppen geben jedem mehrere Partien.",
    how: "Format „Gruppenphase“ mit anschließender Einzelausscheidung; Gruppengröße 4 bis 8.",
    fields: ["Format", "Gruppen", "Turnierbaum"],
  },
  {
    key: "disputes",
    title: "Streitfall-Ablauf und Verhaltensregeln festlegen",
    why: "Ein gemeldetes Ergebnis, das der Gegner bestreitet, braucht einen vorher bekannten Weg – sonst entscheidet, wer lauter ist.",
    how: "In die Regeln: Beweise (Screenshot, Aufzeichnung), wer entscheidet, wie schnell. Konflikte landen in der Tageszentrale.",
    fields: ["Regeln", "Ergebnis-Konflikte"],
  },
  {
    key: "matchdays",
    title: "Ligen: Termine über Spielwochen statt starrer Uhrzeit",
    why: "Eine Liga über Wochen lebt davon, dass Teams ihre Partie in der Woche selbst ausmachen. Eine feste Uhrzeit für alle scheitert am Alltag.",
    how: "Format „Liga“, Spielwoche und Standardzeit setzen; Terminvorschläge der Teams einschalten. Der geltende Termin steht dann in der Partie.",
    fields: ["Format", "Spielwoche", "Standardzeit", "Terminvorschläge"],
  },
];

export const GUIDE_FORMATS = [
  { key: "single_elim", label: "Einzelausscheidung", when: "Ein Abend, ein Sieger. Wer verliert, ist draußen – schnell, aber für die Hälfte nach einem Spiel vorbei." },
  { key: "double_elim", label: "Double Elimination", when: "Eine Niederlage soll nicht sofort das Aus sein. Gut für kleine Felder mit Zeit für ein Loser Bracket." },
  { key: "swiss", label: "Schweizer System", when: "Viele Teilnehmer, kein fester Baum: Jeder spielt gleich viele Runden gegen ähnlich Starke. Übliche Gruppenphase bei Counter-Strike und Valorant." },
  { key: "groups", label: "Gruppen und Turnierbaum", when: "Ab etwa 32 Teilnehmern: Gruppen zu 4 bis 8, die Besten in den Baum." },
  { key: "round_robin", label: "Jeder gegen jeden", when: "Kleines Feld, alle sollen gegeneinander spielen. Die Tabelle entscheidet." },
  { key: "league", label: "Liga mit Spielwochen", when: "Eine Saison über Wochen; jede Woche ein Spieltag, Termine machen die Teams aus." },
  { key: "ffa", label: "Freies Feld (FFA)", when: "Alle gleichzeitig in einer Lobby – Rennen, Battle Royale, Party-Spiele. Gewertet nach Platzierung." },
];

// Turnierformen nach Spielart – Teamgröße, übliche Serie, Besonderheiten. Die Liste wächst mit
// den Spielen, die der Verein wirklich spielt.
export const GUIDE_GAME_TYPES = [
  { key: "team-shooter", label: "Team-Shooter 5v5", examples: "Counter-Strike 2, Valorant, Rainbow Six Siege", team: "5v5", series: "Best of 1 in Gruppen, Best of 3 in Playoffs, Finale Best of 5", format: "swiss", notes: "Map-Veto vor der Partie; die Heimseite hostet. Schweizer System für die Gruppenphase, danach Double Elimination." },
  { key: "cod", label: "Call of Duty", examples: "Call of Duty (Ligaregeln)", team: "4v4", series: "Best of 5", format: "double_elim", notes: "Feste Modusfolge, etwa Hardpoint, Search & Destroy, Control." },
  { key: "moba", label: "MOBA", examples: "League of Legends, Dota 2", team: "5v5", series: "Best of 1 in Gruppen, Best of 3 bis 5 in Playoffs", format: "groups", notes: "Draft-Reihenfolge und Seitenwahl in die Regeln." },
  { key: "arcade-sport", label: "Arcade-Sport 3v3", examples: "Rocket League", team: "3v3", series: "Gruppen und Playoffs Best of 5, Finale Best of 7", format: "groups", notes: "Kurze Spiele – viele Runden an einem Abend möglich." },
  { key: "battle-royale", label: "Battle Royale", examples: "Fortnite, Warzone, Apex", team: "Solo, Duo oder Trio", series: "3 bis 6 Runden, Punkte je Platzierung und Abschuss", format: "ffa", notes: "Punktetabelle in die Regeln; Ergebnisse je Runde erfassen." },
  { key: "sport-1v1", label: "1v1 Sport", examples: "EA SPORTS FC, NBA 2K", team: "1v1", series: "Hin- und Rückspiel oder Best of 3", format: "league", notes: "Passt gut auf Liga mit Spielwochen." },
  { key: "strategy-1v1", label: "1v1 Strategie", examples: "Age of Empires, StarCraft", team: "1v1", series: "Best of 3, Finale Best of 5", format: "double_elim", notes: "Fester Map-Pool ohne Wiederholung; ELO-Grenze für Amateurturniere." },
  { key: "fighting", label: "Fighting", examples: "Street Fighter, Tekken, Smash", team: "1v1", series: "Best of 3, ab Halbfinale Best of 5", format: "double_elim", notes: "Double Elimination ist hier Standard; Charakterwahl nach Sieg fest, Verlierer darf wechseln." },
  { key: "racing", label: "Rennen auf Zeit", examples: "F1, Gran Turismo, Mario Kart", team: "Solo", series: "Zeitfahren oder Rennen mit Punkten", format: "ffa", notes: "Für Zeitfahren die Fast-Lap-Challenge nutzen; Rennen als freies Feld mit Platzierung." },
  { key: "mobile", label: "Mobil", examples: "Brawl Stars, Clash Royale", team: "1v1 bis 3v3", series: "Best of 3", format: "single_elim", notes: "Kurze Partien; Check-in besonders wichtig, weil Handys wechseln." },
  { key: "party-lan", label: "Party und LAN", examples: "Mario Kart, Jackbox, Poker-Abend", team: "Solo oder Team", series: "Eine Runde oder Punkte über den Abend", format: "ffa", notes: "Vor Ort: Stationen und Check-in am Eingang; Ergebnisse trägt die Turnierleitung ein." },
];

export function formatLabel(key) {
  return GUIDE_FORMATS.find((item) => item.key === key)?.label || key;
}

# Versionshinweise für Google Play

Der Text, der beim Hochladen des App-Bundles in den offenen Test der Play Console unter „Versionshinweise“
steht. Das Release-Skript übernimmt den Abschnitt der aktuellen Version in den GitHub-Release-Text, legt ihn
als `builds/play-notes-<Version>-build<N>.txt` zum Kopieren ab und gibt ihn mit `--play` an Google weiter.
Preflight und `npm run release:local -- --check` brechen ab, wenn er fehlt oder nicht passt.

Regeln:

- Je Version ein Abschnitt `## 1.2.3`, neueste oben. Darunter genau der Text für Google Play, ohne Markdown.
- Erste Zeile `Neu in 1.2.3:`, danach jeder Punkt in einer eigenen Zeile mit `• `.
- Höchstens 500 Zeichen inklusive Zeilenumbrüchen (Grenze von Google Play).
- Kurz und für Mitglieder verständlich: was sie in der App merken, keine Issue-Nummern, keine Technik.

## 1.7.13

Neu in 1.7.13:
• Benachrichtigungen in drei Stufen, je Thema Push, Nur App oder Aus
• Ruhezeit: nachts kein Push, danach eine Sammelmeldung
• Erfolgs-Zeremonien nur noch einmal je Konto statt auf jedem Gerät
• Kein doppeltes Handy mehr in der Push-Liste
• Zusammengelegte Läufe zählen nicht mehr mit, klarere Läufe-Karte
• Liga-Staffeln zeigen den Stand der Liga statt „Entwurf“
• Profil zeigt „Vereinsmitglied“ mit Funktion

## 1.7.12

Neu in 1.7.12:
• Turnier-Cockpit für die Turnierleitung vor Ort: Probleme auf einen Blick, Stationen aufrufen, starten, freigeben und Defekt melden
• Spielzeit-Uhr mit Balken: orange, wenn es knapp wird, steht in der Turnierpause
• Hinweis der Turnierleitung als Banner auf Turnier- und Event-Seite, die Leitung schreibt ihn direkt in der App
• Ein Hinweis an das ganze Event öffnet die Event-Seite

## 1.7.11

Neu in 1.7.11:
• Gesamtwertung der Liga: Co-Teams, Spieler, Punkte je Season
• Trophäen mit Filtern nach Art, Spiel, Season und Platz
• Bis zu drei Embleme neben deinem Namen und am Team
• Rankingbanner deines Teams kopieren oder teilen
• „Nachgemeldet ab Woche X“ in der Liga-Tabelle
• Anmeldefenster mit Nachmeldefrist an der Staffel
• Kurze Wartung: freundlicher Hinweis statt Fehlermeldung

## 1.7.10

Neu in 1.7.10:
• Check-in zum Liga-Spiel direkt in der App
• Map-Veto live: sperren, wählen, „Bereit zum Veto“
• Matchablauf auf einen Blick, Spiel starten
• Tabelle mit Auf- und Abstieg, Endstand und Meister
• Liga-Anmeldung deines Co-Teams am Team
• Seasons, Belohnungen und Titel im Profil
• Zeremonie bei neuer Belohnung
• Bessere Bedienung mit Vorleser

## 1.7.9

Neu in 1.7.9:
• Wunschnummer unter „Meine Mitgliedschaft“ wählen
• Rennligen: Runden mit Quali, Sprint und Rennen
• Ergebnis je Runde, Zeiten und Punkte zählen hoch
• Turnierserien wie TFT mit Turniertagen, ohne Ort und Flagge
• Termine ohne Datum zeigen „Termin folgt“
• Statistik der Saison, Sonderregeln wie Punktabzug
• Original-Bilder im Vollbild – wischen und zoomen
• Teamwertung zeigt Fahrer-Anpassungen
• Fast-Lap-Zeiten mit Komma, wischbare Reiter
• „Bewegung reduzieren“ wirkt sofort

## 1.7.8

Neu in 1.7.8:
• Rennligen: Runden mit Quali, Sprint und Rennen
• Ergebnis je Runde, Zeiten und Punkte zählen hoch
• Turnierserien wie TFT mit Turniertagen, ohne Ort und Flagge
• Termine ohne Datum zeigen „Termin folgt“
• Statistik der Saison, Sonderregeln wie Punktabzug
• Original-Bilder im Vollbild – wischen und zoomen
• Teamwertung zeigt Fahrer-Anpassungen
• Fast-Lap-Zeiten mit Komma, wischbare Reiter
• „Bewegung reduzieren“ wirkt sofort

## 1.7.7

Neu in 1.7.7:
• Original-Bilder des Veranstalters im Vollbild – wischen und zoomen
• Saison zeigt, von welcher Plattform die Daten kommen
• Teamwertung zeigt Fahrer-Anpassungen
• Zeiten und Punkte zählen hoch, Fast-Lap-Zeiten mit Komma
• Wischbare Reiter mit weichem Rand
• „Bewegung reduzieren“ wirkt sofort

## 1.7.6

Neu in 1.7.6:
• Rennligen: Runden mit Quali, Sprint und Rennen
• Ergebnis je Runde mit hochzählenden Zeiten
• Statistik der Saison
• Team-Ligen mit Map-Veto, Kader und Map-Statistik
• Turnierserien mit Turniertagen, Lobbys und Boni
• Sonderregeln wie Punktabzug und abgebrochene Saison
• Veranstalter-Partner und Map-Pools bei Turnieren

## 1.7.5

Neu in 1.7.5:
• Verein › Erfolge neu: Ehrentafel, Läuft gerade, Vitrine, Liga-Weg, Chronik
• Neue Saison-Ansicht für Rennligen und Team-Ligen mit Flaggen und Tabelle
• Profil › Referenzen: bestes Ergebnis, Liga-Weg, Chronik je Jahr
• News: Kategorien mit Anzahl, Suche als Symbol
• Voller Cup: Anmeldung zeigt deinen Platz auf der Warteliste
• Check-in-Zeiten zeigen, was wirklich gilt

## 1.7.4

Neu in 1.7.4:
• Galerie: Großansicht bleibt über Bildtext und Reiterleiste
• News ohne Bild als Text-Karte, Ergebnis-News nennen den Sieger
• News: Anmelde-Karte direkt unter dem ersten Absatz
• Profile ohne Nullen und ohne leere Reiter
• Private Profile zeigen keine Referenzen und Teams

## 1.7.3

Neu in 1.7.3:
• Ergebnis eintragen: „nicht erschienen“ im Lauf ist schon vorbelegt
• Turnierbaum: vorgemerkte „nicht erschienen“ sind durchgestrichen
• Abzeichen bleiben in einer Zeile und haben die richtige Farbe
• Fast Lap: lange Titel ohne Wortbruch, Symbol verdeckt nichts mehr
• Match: Teilnehmerliste ohne englische Begriffe

## 1.7.2

Neu in 1.7.2:
• Mein Kalender: alle deine Termine mit deinem Stand an einem Ort
• Kalender-Abo: Termine automatisch im Handy- oder Google-Kalender
• Fester Eintrag „Mein Kalender-Abo“ in den Einstellungen

## 1.7.1

Neu in 1.7.1:
• Weiterkommen in vier Modi: Der Turnierbaum zeigt, wie es weitergeht – fester Baum, Auslosung nach der Runde, Show-Auslosung oder sofort zufällig
• Show-Auslosung als Moment: „Auslosung bereit“, die Namen gleiten in ihre Plätze, eine leichte Vibration
• Neue Namen im Baum: „Loser Runde 1“, „Grand Final“, „voraussichtlich“ bei vorgeplanten Zeiten
• Fast Lap: Versuche und Gäste wie auf der Website

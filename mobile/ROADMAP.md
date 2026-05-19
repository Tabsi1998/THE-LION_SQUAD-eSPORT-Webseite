# LionsAPP Ausbauplan

Stand: 2026-05-19

## Zielbild

Die App soll fuer normale Nutzer die wichtigen Webseitenfunktionen nativ abbilden: Home, Events, Turniere, Fast-Laps, Teams, Chat, Profil, Benachrichtigungen, Anmeldungen, Ergebnisse und persoenliche Referenzen. Admin-Funktionen bleiben bewusst nicht vollstaendig in der App.

## Phase 1 - Darstellungs-Paritaet

- Rich-Text aus der Webseite nativ anzeigen: Markdown, einfache HTML-Formatierungen, Listen, Zitate, Links, Fett/Kursiv, Code und Markierungen.
- News, Events, Team-Chat, Turnier-Chat und Direktnachrichten auf denselben Rich-Text-Renderer umstellen.
- Medien in Inhalten sauber erkennen: Banner, Markdown-Bilder, HTML-Images, direkte Bild-URLs und API-relative Upload-URLs.
- Verknuepfte Inhalte in News und Events nativ anzeigen: Events, Turniere, Fast-Laps, Teams und markierte Personen.
- Lange Texte mobil lesbar machen: Abschnitte, Abstaende, max. Bildhoehen, keine rohen URLs im Fliesstext.

## Phase 2 - Navigation und Informationsarchitektur

- Bottom-Tab `Events` als zentralen Hub fuer Events, Turniere und Fast-Laps halten.
- Inhalte klar gruppieren: Events, Turniere und Fast-Laps getrennt anzeigen, zusaetzlich Filterchips fuer schnelle Eingrenzung.
- Home-Karten nur noch direkt in passende Detailseiten fuehren, keine generischen Zwischenlisten.
- Info Center auf Vereinsinfos reduzieren: Sponsoren, Partner, Vorteile, Profile und allgemeine Vereinsreferenzen.
- News-Verknuepfungen direkt in passende native Screens fuehren.
- Den `Mehr`-Bereich schlanker machen: Nachrichten, Benachrichtigungen, Info Center, News, Fast-Laps nur wenn nicht bereits im Events-Hub sichtbar genug.

## Phase 3 - Live-Interaktion

- Sichtbare Aktualisieren-Buttons entfernen; Pull-to-refresh bleibt als Fallback.
- App-interne Polling-Aktualisierung fuer Home, Events, Chat und Benachrichtigungen.
- Mittelfristig echte Realtime-Schicht pruefen: WebSocket oder Server-Sent Events fuer Chat, Benachrichtigungen, Match-Updates und Check-in-Aenderungen.
- Konfliktarme Updates: neue Chat-Nachrichten anhaengen, bekannte Benachrichtigungen nicht doppelt als Popup zeigen.
- Hintergrundverhalten klaeren: App-im-Vordergrund sofort, App-im-Hintergrund spaeter ueber echte Push-Infrastruktur.

## Phase 4 - Benachrichtigungen

- Globale Glocke mit ungelesener Anzahl in der App anzeigen.
- In-App-Popups fuer neue Benachrichtigungen im Vordergrund.
- Benachrichtigungs-Inbox mit ungelesen/gelesen, alle gelesen, einzelne Ziele oeffnen.
- URL-Routing fuer Benachrichtigungen in native Ziele uebersetzen: Turnier, Event, Team, Chat, Match, News.
- Echte Telefon-Pushs erst nach stabiler Firebase/Expo-Konfiguration reaktivieren und separat testen.

## Phase 5 - Event-, Turnier- und Fast-Lap-Funktionen

- Events: Detail, Programm, Anmeldung, Abmeldung, Begleitpersonen, verknuepfte Turniere/Fast-Laps/News/Sponsoren.
- Turniere: Detail, Anmeldung, Abmeldung, Check-in, Teilnehmer, Matches, Uhrzeiten, Ergebnisse, Rangliste, Regeln und Preise.
- Fast-Laps: Challenge-Detail, Strecken, Leaderboards, Referenzzeiten, persoenliche Bestzeiten, historische Platzierungen.
- Home: angemeldete Events/Turniere/Fast-Laps, naechste Matches, offene Aktionen, neue News.
- Persoenliche Referenzen: vergangene Turnierplatzierungen, Fast-Lap-Raenge, Season-Points, Podiums und Siege.

## Phase 6 - Teams und Chat

- Teamdetail mit Logo, Banner, Mitgliedern, Squads, Rollen und Teamstatus.
- Teamchat und Turnierchat mit Markierungen, Links und Formatierungen.
- Direktnachrichten mit Profilbezug, Lesestatus und neuer Nachricht als In-App-Popup.
- Chat-Update ohne manuelles Aktualisieren.
- Team-Bearbeitung fuer berechtigte Nutzer pruefen: Basisdaten, Logo/Banner, Mitgliederrollen, Einladungen.

## Phase 7 - Profil und Member-Funktionen

- Eigenes Profil vollstaendiger abbilden: Avatar, Banner, Socials, Game-IDs, Datenschutz, Benachrichtigungseinstellungen.
- Andere Profile oeffnen: Avatar, Achievements, Teams, Referenzen, Nachricht starten.
- Achievements optisch naeher an Webseite: Gruppen, Stufen, Fortschritt, erhalten/offen.
- Mitgliedervorteile dynamisch nach Mitgliedsstatus sperren/freigeben.
- Profilbearbeitung schrittweise erweitern statt alles in einem grossen Formular.

## Phase 8 - Qualitaet, Releases und Store-Faehigkeit

- E2E-Testpfade fuer Login, Home, Eventdetail, Turnieranmeldung, Chat, News und Profil.
- Crash-Logging vorbereiten, bevor breiter verteilt wird.
- APK-Releases weiter automatisch signiert ueber GitHub Actions.
- Spaeter Google Play Internal Testing fuer sichere Installation ohne Sideload-Warnung.
- Performance: Bildgroessen, Listenvirtualisierung, API-Caching und weniger unnoetige Requests.

## Bekannte Grenzen

- Echte Push-Benachrichtigungen sind aktuell in der APK deaktiviert, weil die native Push-Bibliothek zuvor Start-/Login-Crashes verursacht hat.
- Fast echte Live-Aktualisierung laeuft aktuell ueber Polling. Fuer echte Instant-Updates braucht die Plattform eine Realtime-Schicht.
- Admin-Funktionen sollten nicht 1:1 in die App, ausser einzelne mobile Staff-Aktionen wie Check-in oder Match-Ergebnis.

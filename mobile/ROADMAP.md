# LionsAPP Ausbauplan

Stand: 2026-05-19

## Zielbild

Die App soll fuer normale Nutzer die wichtigen Webseitenfunktionen nativ abbilden: Home, Events, Turniere, Fast-Laps, Teams, Chat, Profil, Benachrichtigungen, Anmeldungen, Check-ins, Matches, Ergebnisse und persoenliche Referenzen. Admin-Funktionen bleiben bewusst nicht vollstaendig in der App, ausser sinnvolle mobile Staff-Aktionen wie Check-in, Ergebnisfreigabe oder Matchbetreuung.

## Phase 0 - Release-, Versions- und GitHub-Hygiene

- Interne App-Versionen bleiben SemVer-kompatibel, z.B. `0.1.1-alpha.1`, `0.1.2-alpha.1`, `0.2.0-alpha.1`, `1.0.0-beta.1`, `1.0.0`.
- Der sichtbare GitHub-Release-Name wird testerfreundlich: `LionsAPP ALPHA v0.1.1 (Build 15)` statt nur `LionsAPP v0.1.0-alpha.15`.
- APK-Dateien bekommen ein klares Namensschema: `LionsAPP-ALPHA-v0.1.1-build15-<commit>.apk`.
- `mobile/package.json`, `mobile/app.json` und `expo.android.versionCode` muessen vor jedem Release konsistent erhoeht werden.
- Kleine Fixes erhoehen die Patch-Version, z.B. `0.1.0-alpha.14` -> `0.1.1-alpha.1`.
- Groessere Feature-Bloecke erhoehen die Minor-Version, z.B. `0.1.x` -> `0.2.0-alpha.1`.
- Vor Stable-Release wird auf Beta gewechselt, z.B. `1.0.0-beta.1`; danach `1.0.0`.
- Bestehende GitHub-Releases koennen im Titel und Text korrigiert werden. Bereits hochgeladene APK-Dateinamen bleiben historisch, ausser man loescht und laedt Assets bewusst neu hoch.
- Alte Releases sollten nicht unkontrolliert neu publiziert werden, weil GitHub Releases nach Publikationsdatum listet und alte neu erstellte Releases sonst oben erscheinen.
- Auf der GitHub-Hauptseite/Releases-Seite soll immer der neueste empfohlene Download eindeutig im obersten aktuellen Release stehen. Die Changelog-Historie bleibt absteigend in `mobile/CHANGELOG.md` und `mobile/RELEASES.md`.

## Phase 1 - Rechte, Sichtbarkeit und Anmeldelogik

- Mobile muss dieselbe Eligibility-Logik anzeigen wie Webseite und Backend: Sichtbarkeit `public`, `community`, `members`, `internal`, Invite-only, Status und Zeitfenster.
- Turniere: `block_club_member_registration`, Team-Modus, Game-ID-Pflichtfelder, Datenschutz/Regeln, Warteliste und passende Fehlertexte nativ abbilden.
- Events: Begleitpersonen, externe Registrierungslinks, Warteliste, Kapazitaeten und Status korrekt anzeigen.
- Fast-Laps: Club-Member-Reference-Regeln, gesperrte offizielle Zeiten und Referenzzeiten sichtbar und verstaendlich darstellen.
- Buttons duerfen nur Aktionen anbieten, die fuer den aktuellen Nutzer wirklich erlaubt sind.
- Akzeptanz: App zeigt keine falschen Anmelde-, Abmelde- oder Check-in-Aktionen mehr.

## Phase 2 - Turnier-, Match- und Check-in-Funktionen

- Turnierdetail vervollstaendigen: Anmeldung, Abmeldung, Team-Auswahl, Check-in, Teilnehmer, Regeln, Preise, Bracket, Matches und Rangliste.
- Match-Detailseite nativ bauen: Teilnehmer, Zeit, Station, Status, Ergebnis, Chat und Aktionen.
- Ergebnis melden, Forfeit und Dispute fuer berechtigte Nutzer mobil nutzbar machen.
- Home zeigt offene Aktionen direkt: Check-in offen, Match offen, Ergebnis fehlt, Anmeldung wartet.
- Matchbaum und Rangliste mobil besser lesbar machen, inklusive kleinen Screens.
- Akzeptanz: Ein Spieler kann einen kompletten Turniertag mobil abwickeln.

## Phase 3 - Events, News und Content-Paritaet

- Rich-Text weiter an die Webseite angleichen: Markdown, HTML, Listen, Links, Bilder, Zitate, Code, Mentions und Hashtags.
- Native Content-Embeds fuer Events, Turniere, Fast-Laps, Teams, Profile und News statt roher Tokens oder URLs.
- Event-Detail mit Programm, Karte, Sponsoren, verknuepften Turnieren/Fast-Laps/News und Anmeldung.
- News-Detail mit allen verknuepften Inhalten und sauberen Bildern.
- Navigation entflechten: keine Button-in-Button- oder Karten-in-Karten-Mechanik, jeder Klick fuehrt klar zu einem Ziel.
- Akzeptanz: News und Events sehen in der App nicht mehr roh, abgeschnitten oder verschachtelt aus.

## Phase 4 - Profile, Referenzen und Member-Bereich

- Oeffentliche Profile oeffnen: Avatar, Banner, Bio, Socials, Teams, Achievements und Referenzen.
- Mentions in News, Chat und Texten klickbar machen und auf Profile fuehren.
- Eigenes Profil vervollstaendigen: Avatar, Banner, Game-IDs, Datenschutz, Benachrichtigungseinstellungen und Socials.
- Persoenliche Referenzen: Turnierplatzierungen, Fast-Lap-Zeiten, Season-Points, Podiums und Siege.
- Mitgliedervorteile, Member-News, Dokumente und Mitgliedsstatus dynamisch nach Mitgliedschaft sperren/freigeben.
- Akzeptanz: Der Profilbereich ersetzt die wichtigsten Webseiten-Profilfunktionen fuer normale Nutzer.

## Phase 5 - Teams und Community

- Teamdetails vervollstaendigen: Logo, Banner, Mitglieder, Rollen, Squads, Status, Discord und Beschreibung.
- Team beitreten/verlassen, Join-Code, Einladungen, Rollenwechsel und Leader-Transfer mobil umsetzen.
- Team bearbeiten fuer berechtigte Nutzer: Basisdaten, Logo/Banner, Mitglieder und Squads.
- Teamchat mit Mention-Suche, klickbaren Profilen, Rich-Text und sauberer Benachrichtigungslogik.
- Direktnachrichten mit Profilbezug, Lesestatus und sauberer Navigation.
- Akzeptanz: Team-Leads koennen ihre wichtigsten Teamaufgaben mobil erledigen.

## Phase 6 - Benachrichtigungen und Live-Verhalten

- Globale Glocke mit ungelesener Anzahl bleibt sichtbar, ohne Inhalte zu ueberdecken.
- Notification-Tap-Routing: Benachrichtigung oeffnet direkt Event, Turnier, Match, Team, Chat, News oder Profil.
- Polling zentralisieren und reduzieren, damit nicht jede Ansicht separat unnoetig API-Last erzeugt.
- Realtime-Schicht pruefen: WebSocket oder Server-Sent Events fuer Chat, Benachrichtigungen, Match-Updates und Check-ins.
- Echte Telefon-Pushs nach stabiler Firebase/Expo-Konfiguration reaktivieren und separat auf APK testen.
- Akzeptanz: Nutzer bekommt relevante App- und Handy-Benachrichtigungen zuverlaessig und landet direkt am richtigen Ziel.

## Phase 7 - App-Design, UX und Store-Reife

- Safe-Area, Bottom-Navigation, Glocke, Popups und Header auf Samsung, kleinen Android-Geraeten und Emulator pruefen.
- Einheitliche App-Optik naeher an Webseite: Farben, Abstaende, Karten, Listen, Buttons, Status-Badges.
- Alle Listen mit Loading, Empty, Error, Pull-to-refresh und stabiler Skalierung.
- Performance: Bildgroessen, Listenvirtualisierung, API-Caching und weniger unnoetige Requests.
- Crash-Logging vorbereiten.
- Google Play Internal Testing vorbereiten, damit Installation ohne Sideload-/Play-Protect-Warnung moeglich wird.
- Akzeptanz: Die App wirkt wie eine echte mobile App und nicht mehr wie eine technische Alpha.

## Phase 8 - Tests, CI und Qualitaetssicherung

- Mobile Typecheck, Expo Config Check und Dependency Audit bleiben Pflicht.
- Backend-Tests fuer Rechte, Sichtbarkeit, Anmeldung, Check-in, Fast-Lap-Reference-Regeln und Notifications.
- Frontend-/Mobile-E2E-Pfade fuer Login, Home, Eventdetail, Turnieranmeldung, Check-in, Chat, News und Profil.
- Release-Workflow darf nur bauen, wenn Version, Changelog, Signatur und APK-Name konsistent sind.
- Build-Zeit weiter ueber Gradle/NPM-Cache optimieren, aber Android-Release-Builds bleiben grundsaetzlich mehrere Minuten lang.
- Akzeptanz: Updates laufen reproduzierbar und Fehler fallen vor Release auf.

## Bekannte Grenzen

- Echte Push-Benachrichtigungen sind aktuell in der APK deaktiviert, weil die native Push-Bibliothek zuvor Start-/Login-Crashes verursacht hat.
- Fast echte Live-Aktualisierung laeuft aktuell ueber Polling. Fuer echte Instant-Updates braucht die Plattform eine Realtime-Schicht.
- Admin-Funktionen sollten nicht 1:1 in die App, ausser einzelne mobile Staff-Aktionen wie Check-in oder Match-Ergebnis.
- GitHub sortiert Releases primaer nach Publikations-/Erstellzeit. Nachtraeglich neu erstellte alte Releases koennen deshalb oberhalb neuerer Versionen erscheinen, wenn man sie nicht bewusst nur dokumentiert oder kontrolliert korrigiert.

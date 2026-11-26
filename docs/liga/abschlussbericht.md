# Abschlussbericht Liga-Ausbau (G.3)

Paket G.3 des Liga-Masterplans (#2211), Abschnitt 26 I des Auftrags vom 02.11.2026. Erster Stand 15.11.2026 (`main` 4f59cfcb6,
mit G.1, #2423); **fortgeschrieben am 26.11.2026 zur Betriebsfreigabe (#1632)**, `main` 398b4ecfa (Website 1.100.0). Der Bericht ist
eine überprüfbare Aufstellung: Jede Aussage nennt PR, Issue, Datei oder Test.

**Stand 26.11. in drei Sätzen:** Seit G.1 sind Playoffs und Relegation, Startrechte, der Saisonende-Moment und die übrigen
Folgepakete gebaut; die nächtliche Gesamtabnahme prüft jetzt auch sie (zwei neue Specs, Abschnitt 5). Backup und Restore sind
mit echtem Docker-Stand und Liga-Daten zweimal durchgespielt, Datenbank und Uploads kamen vollständig zurück (Abschnitt 5). Offen
vor Season 1 sind nur noch Schritte auf dem Server und Entscheidungen des Betreibers - die Checkliste steht in Abschnitt 9.

Dazu gehören:

- Architektur und Felder: [LIGA.md](../LIGA.md), Abschnitt 12 (je Paket), Feature-Matrix in Abschnitt 13
- Regel gegen Funktion: [regelwerksabgleich.md](regelwerksabgleich.md)
- Gesamtabnahme: [abnahme.md](abnahme.md)
- Erweiterbarkeit: [erweiterbarkeit.md](erweiterbarkeit.md)
- Bedienung: [Liga leiten](../handbuch/liga.md), [Spickzettel für Captains](../handbuch/liga-captains.md), Hilfe `/hilfe/liga-captains`

## 1. Was wurde umgesetzt?

Ausgangslage am 02.11. (`main` 385beb0b3, Release 1.55.0): Liga → Season → Staffel, Best of, Maps, Tabelle. Es fehlten
Selbstanmeldung, Veto, Check-in, Strafen und Saisonabschluss. Dazu kamen 20 Funde der Systemanalyse (D-1 bis D-20).

| Phase | Paket | PR | Issue |
| --- | --- | --- | --- |
| A Grundlage | A.1 Vertrag, Architektur, Feature-Matrix, Entscheidungsliste | #2212 | #2211 |
| | A.2 Echte Tests: MongoDB-Job in der CI, schreibende Browser-Abnahme | #2217, #2373 | #2200 |
| | A.3 Fehler Spielbetrieb (D-1 Zwischenlösung, D-2, D-3, D-8, D-9, D-11 bis D-15, D-18, D-19) | #2220 | #2201 |
| | A.4 Fehler Kader (D-4, D-5, D-6, D-16, D-17) | #2222 | #2202 |
| B Rechte, Regeln, Anmeldung | B.1 Bereich „Ligen“, Zuständige je Liga, Befangenheit | #2227, #2241 | #2203, #2230 |
| | B.2 Regelwerk mit Versionen, PDF, Änderungen, Zustimmung (D-7) | #2231 | #1646 |
| | Regelwerk aus den Einstellungen: Bausteine, Variablen, Freigabe | #2286, #2291 | #2269 |
| | B.3 Spielberechtigung, Teilnehmerliste, Wartezeit, Transfers, Plattform | #2234, #2282, #2320, #2323 | #2204, #2270, #2313, #2322 |
| | B.4 Selbstanmeldung, zweite Person beim eigenen Team, automatisch annehmen | #2244, #2248, #2355 | #2205, #1623, #1665, #2245, #2348 |
| C Competitive | C.1 Spielmodi mit Zustand, Ergebnisregel, Symbol | #2247, #2280 | #2206, #2266, #2271 |
| | Eigene Spielseite in der Verwaltung | #2263, #2277 | #2249 |
| | C.2 Maps und Pools, Prüfung vor der Veröffentlichung | #2257 | #2207 |
| | C.3 Ergebnisregeln je Map, Punkte Pflicht | #2258 | #1617 |
| | C.4 Ausrüstung je Spiel, Sperrliste der Season | #2272, #2275, #2292, #2300, #2303, #2308, #2314, #2315 | #2218, #2287, #2298, #2299, #2302, #2305, #2306 |
| | Season-Seite mit Reitern und geführter Einrichtung | #2279 | #2267 |
| D Matchablauf | D.1 Termine: 72-h-Regel, Verschiebungen, überfällige Spiele | #2255, #2407 | #2194, #2406 |
| | D.2 Check-in je Spiel, Start, Vorschlag bei Nichterscheinen (D-1 endgültig) | #2283 | #1652 |
| | D.3 Map-Veto je Season, Vorgabe der Woche mit Bereit-Start | #2293, #2353 | #1618, #2326 |
| | D.4 Map-Veto live: Karten, Countdown, Zuschauer, TV | #2359 | #1651 |
| | D.5 Vorfälle im Spiel, Vertrag und Nachweis-Baustein | #2362, #2364 | #1619, #2360 |
| E Verwaltung | E.1 Tabelle: direkter Vergleich, kampflos, Tabellenende, Punkte nach Maps | #2259, #2319 | #1625, #1559, #2312, #2318 |
| | E.2 Beanstandung, Protest, Einspruch, MOSS (D-10) | #2366 | #1619 |
| | E.3 Strafen im Wettbewerb | #2370 | – |
| | E.4 Leitstand je Season: Aufgaben, Protokoll, Rundnachricht | #2385 | #2209 |
| | E.5 Erinnerungen: vor dem Spiel, Termin offen, Ergebnis fehlt, Veto | #2381 | #1647 |
| F Langfristig | F.1 Saisonabschluss mit festem Endstand, Meister, Wiederöffnen | #2389 | #1645 |
| | F.2 Neue Season mit Auf- und Abstieg, Zonen, Season-Historie | #2397 | #1627 (Teil) |
| | F.3 Prüfbericht Erweiterbarkeit (kein Bau) | #2399 | #2211 |
| | F.4 Belohnungen je Season | #2411 | #2214 |
| | F.5 Gesamtwertung über Seasons | #2415 | #2215 |
| Öffentlich | Liga auf der Startseite, öffentliche Season-Seite, Hilfe-Bereich | #2327, #2378, #2331 | #2324, #2268, #2295 |
| G Abnahme | G.1 Gesamtabnahme mit 18 Szenarien, nächtlich; Nachmeldung (Nr. 180) | #2423 | #1632 |
| | G.2 LionsAPP 1.7.10: Check-in, Veto live, Anmeldestatus, Zonen, Historie, Belohnungen | #2419 | #2173 (Teil) |
| | G.3 Handbücher, Regelwerksabgleich, Feature-Matrix, dieser Bericht, D-20 | Branch `docs/liga-g3-abschluss` | #2211 |
| Nach G.3 | Nachmeldung nach dem Start mit Spielen in offenen Wochen | – | #2422 |
| | Eigene Staffel-Seite, Edition je Season, Partien ohne Maps, Veto-Seitenwahl, Vorfallarten schaltbar, freier Name je Liga N | – | #2262, #2400, #2401, #2402, #2403, #2405 |
| | Playoffs und Relegation aus dem Endstand (F.6) | #2568 | #2404 |
| | Auf- und Abstieg bei mehreren Staffeln, Startrechte mit Zusage, Frist und Nachrücken (F.2a) | #2573 | #1627 |
| | Unterbesetzte Divisionen zusammenlegen | – | #1628 |
| | Saisonende-Moment für Auf- und Abstieg und Meister (F.8), TV-Sieger-Moment | #2581 | #1639, #2410 |
| G Freigabe | Gesamtabnahme erweitert (Saisonende, Betrieb), Backup-Probelauf, dieser Bericht fortgeschrieben | Branch `test/liga-abnahme-erweitern` | #1632 |

**Entscheidungen:** 180 Nummern (Nr. 1 bis 180, dazu 11a bis 11c und 34a bis 34d), alle von Fabian entschieden oder als Ergänzung aus
einem Review bestätigt. Jede ist eine Einstellung je Season oder Liga mit Vorgabe, keine feste Regel im Code. Stand je Nummer:
[regelwerksabgleich.md](regelwerksabgleich.md), Abschnitt 2. Offen ist nur Nr. 100 (Veto-Folge Anlage B, Prüfung gegen die CDL).

**D-20 (veraltete Doku):** Der Fund nannte Beispielwerte von Stufe 1 (Start 10.11., zehn Wochen, Best of 3, acht Teams, 3/1/0), die in
`docs/LIGA.md` und im Handbuch als feste Werte standen. `docs/LIGA.md` sagt seit A.1 oben, dass es Vorgaben von damals sind. G.3
hat das Handbuch Liga leiten (Abschnitt 1, 2.2, 2.6, Checkliste) und den Spickzettel (Woche, Tabelle) auf Vorgaben einer neuen
Season umgestellt. Die Checkliste „für den Obmann bis 9.11.“ heißt jetzt „vor dem Season-Start“. Die Zahlen BO3, zehn Wochen und
acht Teams sind weiter die **Vorgaben einer neuen Season** im Code (`league_service.SEASON_DEFAULTS`) – richtig so, die Tiroler Liga
stellt ihre Werte (etwa Best of 5) beim Einrichten ein.

## 2. Welche vorhandenen Funktionen wurden weiterverwendet?

Grundsatz „kein zweites System“ (LIGA.md, Abschnitt 12):

- **Staffel = Turnier** (`tournaments` mit `league_context`), Spiele in `matches_v2`, Ergebnis `games[]` mit Konsens `same_outcome`.
- **Map-Pools** mit unveränderlichen Versionen, `effective_pool`, `map_pools.allowed`; Bibliothek `game_maps`, Modi `games.match_modes`.
- **Termine:** `matchday_schedule` (Spielwochen, Sperrzeiten, `response_deadline`), Terminvorschläge.
- **Tabelle:** `scoring_rules`, `competition_standings`, Weiche `standings_for_structure`; Austritt und Disqualifikation aus
  `tournament_events`.
- **Proteste:** `match_disputes`, Nachweise `match_proofs` mit Aufbewahrung.
- **Ehrungen:** `tournament_awards`, `AwardBanner`, `prize_service`, Teilen-Bild-Cache.
- **Nachrichten:** `create_user_notification` mit `dedupe_key`, Push, Discord-Direktnachricht.
- **Rechte:** `permissions.py` mit Paritätstest zu `permissions.js`, Zwei-Faktor, Protokoll `audit_logs`.
- **Abgrenzung:** `league_scope.py`, `staffel_guard.py`, `SYNC_GROUPS` (Season → Staffel).

## 3. Welche Dateien und Modelle wurden verändert?

Seit 385beb0b3 (alle Themen, nicht nur Liga): 1526 Dateien, rund 174 000 Zeilen dazu. Für die Liga:

- **Backend:** 50 neue Module unter `backend/services/` (`league_*`, `match_flow`, `checkin_rules`, `loadout_bans` …) und 18 neue Routen-Dateien
  `backend/routes/league_*_routes.py`. Geändert unter anderem `models.py`, `database.py` (Indizes), `permissions.py`,
  `tournament_registration_routes.py`, `match_routes.py`, `team_routes.py`, `penalty_routes.py`.
- **Neue Sammlungen** (alle ohne Migration, Indizes beim Start): `league_applications`, `league_rules`, `league_rule_consents`,
  `league_staff`, `league_transfers`, `league_final_tables`, `league_overall_finals`, `competition_sanctions`, `game_equipment`,
  `game_equipment_categories`, `loadout_bans`, `loadout_allowed`.
- **Neue optionale Felder** an `league_seasons` (Check-in, Veto, Terminregeln, Spielberechtigung, Anmeldung, Proteste, Vorfälle,
  Belohnungen, Erinnerungen …), `league_divisions`, `leagues` (Gesamtwertung, Zuständige), `matches_v2` (`flow`, `veto`,
  `planned_games`, `incidents`, `lineups`) und `games.match_modes`. Felder je Paket: LIGA.md, Abschnitt 12.
- **Frontend:** Season-Seite mit zwölf Reitern (`frontend/src/pages/admin/league/`), Matchseite (Check-in, Veto, Vorfälle,
  Verfahren), Ligaseite mit Spieltagen, Teams, Regelwerk und Gesamtwertung, Profil und Teamseite (Belohnungen, Historie), Hilfe.
- **App** (`mobile/`, nur G.2): Version 1.7.10.
- **Tests:** 111 neue Backend-Testdateien für Liga, Ausrüstung und Veto, 41 neue Dateien unter `frontend/e2e` (Specs und Hilfen), dazu Vitest je Komponente.

## 4. Welche Migrationen sind erforderlich?

**Keine.** Kein Liga-Paket seit 02.11. hat eine Migration angelegt; die letzten Liga-Migrationen sind 16 (`league_published_at`) und
17 (`league_roster_backfill`) aus Stufe 1. Jedes neue Feld ist optional: Seasons ohne Feld verhalten sich wie vorher, das prüft
G.1 („Altdaten“). Neue Vorgaben gelten nur für neu angelegte Seasons.

## 5. Welche Tests wurden ausgeführt, welche sind grün?

| Prüfung | Ausgeführt | Ergebnis |
| --- | --- | --- |
| Je Paket: Backend-Suite (3 Teile), Flow-Tests auf echtem MongoDB, Vitest, Playwright (6 Teile), CodeQL, Mobile, Container-Smoke | in der CI jedes PRs; gemergt wurde nur mit grünem Lauf (Auto-Merge) | grün |
| G.1 Gesamtabnahme: 18 Szenarien, Grenzfälle, Rechte, Gleichzeitigkeit, Fristen-Job, Altdaten | GitHub Actions `liga-abnahme-nacht.yml`, von Hand am 15.11. (Lauf 43728934692) | grün; ein früherer Lauf am selben Tag war rot, die beiden folgenden grün |
| G.1-PR #2423: alle CI-Prüfungen | 15.11. | grün |
| G.3: `test_league_rule_facts_unit.py` (19 Tests, davon 2 neu, ohne Korrektur rot) | lokal | grün |
| G.3: `test_league_veto_preset_flow.py`, `test_league_rules_dynamic_flow.py`, `test_league_schedule_flow.py` (48) | lokal, mongomock | grün |
| G.3: Vitest `src/hilfe`, `HelpPages.test.jsx`, `HelpLink.test.jsx` (21) | lokal | grün |
| G.3: Wächter `pytest -n 2 -k "unit or boundary or inventory"` (5734 Tests, 15 übersprungen), `check-doc-links`, `check-code-patterns`, flake8 wie CI | lokal nach dem Merge von `main` | grün |

**Betriebsfreigabe (#1632, 26.11.):**

| Prüfung | Ausgeführt | Ergebnis |
| --- | --- | --- |
| Gesamtabnahme erweitert: `liga-saisonende.spec.js` (5 Szenarien), `liga-betrieb.spec.js` (3 Szenarien), dazu alle bisherigen Specs | lokal nach `docs/liga/abnahme.md`, eigenes MongoDB (`mongo:7.0.40-jammy`), je frisch geseedet, 4 volle Läufe | 4 von 4 grün, je 29 Tests in 5,3 bis 5,8 Minuten (Saisonende rund 40 s, Betrieb rund 45 s) |
| Saisonende-Moment am Meisterprofil: die Prüfung wartete auf die alte Belohnungs-Zeremonie und wäre ab #2581 auf `main` jede Nacht rot (lokal belegt) | lokal, Spec angepasst (Moment, zweite Karte mit der Goldmedaille, Reiter Trophäen) | grün |
| Backup-Probelauf `scripts/liga_backup_probe.sh`: eigener Docker-Stand, Liga-Daten über die Seeds, `backup.sh` mit Schreibpause, frischer Stand, `restore.sh`, Vergleich | lokal, zwei vollständige Läufe (`PROBE_RUNS=2`) | 2 von 2 gleich: 200 Sammlungen, 144 Konten, 4 Endstände, 12 Startrechte, 5 Momente, 766 Indizes, 26 Uploads mit gleichem Inhalt; Schreibversuch in der Pause `503`; Zahlen in `BACKUP_RESTORE.md`, „Probelauf“ |
| ESLint der Abnahme-Specs | lokal | grün |

Nicht automatisch geprüft: Versand an echte Dienste (Mail, Push, Discord – im Testbetrieb gesperrt; die erste Probe macht der
Betreiber, Abschnitt 9), Backup-Timer und Offsite-Kopie auf dem Server, Last bei vielen gleichzeitigen Vetos.

## 6. Welche Punkte sind noch nicht abgenommen?

„Abgenommen“ heißt: in der nächtlichen Gesamtabnahme geprüft (`docs/liga/abnahme.md`). **Seit 26.11. abgenommen** (neu dazu):
Playoffs und Relegation (#2404), Startrechte mit Zusage, Frist, Nachrücker, Pause, Startdatum und Korrektur (#1627), der
Saisonende-Moment je Person mit „Meister sofort“ und Einmaligkeit (#1639), Vorfälle (D.5), Leitstand mit Protokoll und Rundnachricht
(E.4), Erinnerungen (E.5) sowie Backup und Restore mit Liga-Daten (lokal, Backup-Probelauf).

**Getestet, aber nicht in der Gesamtabnahme** (Flow-, Unit- und Browser-Tests in der CI jedes PRs): Ausrüstung (C.4), Punkte nach
gewonnenen Maps, Plattform, Transfers, Startseite, eigene Staffel-Seite (#2262), Edition je Season (#2400), Partien ohne Maps (#2401),
Veto-Seitenwahl (#2402), Vorfallarten schaltbar (#2403), freier Name je Liga N (#2405), TV-Sieger-Moment (#2410), Zusammenlegen
unterbesetzter Divisionen (#1628). Sie hängen nicht am Ablauf einer Tiroler-Liga-Season und sind darum kein Freigabe-Hindernis.

Noch offen:

| Punkt | Issue |
| --- | --- |
| Erster Versand an echte Dienste (Mail, Push, Discord) mit Testkonto | #1632 - Betreiber, Abschnitt 9 |
| Backup-Timer, Offsite-Kopie und Restore-Drill auf dem Server | #1632 - Betreiber, Abschnitt 9 |
| App: Anmelden, Vorfälle, Verfahren, Ergebnis mit Maps, Strafen in der App | #2173 (Rest nach G.2) |
| App: Turniertag-Funktionen | #2393 |
| Wackelige Frontend- und Browser-Tests unter Last | #2390 |
| Abhängigkeiten: Hauptversionen nacheinander anheben | #2417 |
| Playoff-Belohnungen, Anlage F im Regelwerk, Mail/Push zu Playoff-Runden (F.6 „Folgepaket“) | noch kein Issue |
| Gesamtwertung bei mehreren Staffeln einer Stufe (Nr. 66 weicht ab) | noch kein Issue (Vorschlag A3) |
| Bilder zu den neuen Hilfe-Schritten (Einspruch, Strafen, Saisonende) | Bilder offen |

## 7. Welche bekannten Risiken bestehen?

- **Nachmeldung nach dem Start:** Erledigt mit #2422: Spiele in den noch offenen Wochen nach Vorschau, Frist 14 Tage nach dem Start. Offen ist nur
  noch die Frage nach einer Wertung nach Punkten je Spiel (siehe #2422).
- **Staffeln in der Turnierverwaltung:** Bis #2262 bedient die Leitung Staffeln an zwei Orten (Season-Seite und Turnierverwaltung).
  Die Turnierverwaltung zeigt bei Staffeln nur, was die Liga braucht, aber die Wege sind länger.
- **Vorgaben ≠ Tiroler Liga:** Eine neue Season startet mit Best of 3, zehn Wochen, acht Teams je Staffel, 3/0/0. Wer vergisst
  umzustellen, spielt mit falschen Werten. Gegenmittel: Checkliste vor dem Season-Start (Handbuch, Abschnitt 6) und „Was fehlt noch?“.
- **Datenschutz:** Ohne freigegebenen Text steht bei der Anmeldung ein Platzhalter. Externe Teilnehmer erst nach Freigabe und
  rechtlicher Prüfung (Nr. 1, 72, 141).
- **Regelwerk-Sätze beim Anzeigen gebildet:** Die Bausteine frieren ihre Daten ein, den Satz bildet der Code beim Anzeigen. Eine
  Textkorrektur (wie in G.3) ändert darum auch die Anzeige älterer Fassungen; der Inhalt bleibt.
- **Veto per kurzem Abruf:** Kein WebSocket. Viele gleichzeitige Vetos erzeugen viele kurze Anfragen; nicht unter Last geprüft.
- **Echte Dienste:** Mail, Push und Discord laufen in der Abnahme gesperrt; der erste echte Versand passiert in Season 1 - vorher
  eine Probe mit Testkonto (Abschnitt 9, Schritt 3).
- **Nächtliche Abnahme:** läuft seit dem Merge von #2423 jede Nacht auf `main`. Eine rote Nacht legt ein Issue an – es muss jemand lesen.
  Rot kann auch die Abnahme selbst sein: Am 26.11. hing Szenario 15 vom gelosten Spielplan ab (#2570), am selben Tag die
  Profil-Prüfung vom alten Belohnungs-Ablauf vor #1639. Neue Szenarien greifen darum nie auf feste Plätze im Spielplan zu.
- **Backup:** Der Probelauf lief lokal; auf dem Server sind Timer, Offsite-Ziel (`BACKUP_REMOTE`) und der monatliche Restore-Drill
  noch einmal zu prüfen. Ohne Passwortdatei und `SETTINGS_ENCRYPTION_KEY` im Passwortspeicher ist kein Backup wiederherstellbar.
- **App:** Wer nur die App nutzt, kommt für Anmeldung, Vorfälle, Verfahren und Ergebnis mit Maps ins Web (#2173).
- **Wackelige Tests** unter Last (#2390) können einen grünen Stand verdecken oder einen roten vortäuschen.

## 8. Was muss der Betreiber noch entscheiden?

| Thema | Empfehlung | Folge |
| --- | --- | --- |
| Datenschutztext für Externe (Nr. 1) | Text freigeben und rechtlich prüfen lassen, mit Bildern im Regelwerk nach Kontolöschung (Nr. 72) und MOSS (Nr. 141) | Ohne Text Anmeldung nur mit Platzhalter, für Externe nicht freigeben |
| Veto-Folge Anlage B (Nr. 100) | Nach der CDL-Prüfung als Vorlage eintragen | Ohne Vorlage kein Veto in der Season |
| Dritter Modus, Map-Pool, Zielwerte, Waffenliste, Controller, Crossplay, Abbruchphase, Sperrdauern (Nr. 14, Regelwerk v0.15) | Beim Einrichten in Spiel und Season eintragen | Ohne Werte „(nicht festgelegt)“ im Regelwerk |
| Nachmeldung (#2422) | Gebaut: Spiele nur in offenen Wochen, Frist 14 Tage nach dem Start | Ein Nachrücker hat weniger Spiele und steht nach Punkten |
| Staffel-Seite (#2262) vor oder nach Season 1 | Nach Season 1, der Weg über die Turnierverwaltung ist dokumentiert | Vorher: ein Paket mehr vor dem Start |
| Gesamtwertung bei mehreren Staffeln (Nr. 66, Vorschlag A3) | Die gebaute Rechnung „N je Staffel“ bestätigen | Sonst Schalter nachrüsten |
| Wortlaut „Spieltag“ im Regelwerk, Beispiel 3:2 (Vorschläge A5, A6) | Beim nächsten Regelwerk-Update mitnehmen | Rein sprachlich |
| Starttermin Season 1 | Nach Einrichtung und Prüfung „Was fehlt noch?“ | – |

## 9. Was ist vor Season 1 noch zu tun? Checkliste für den Server

Der Reihe nach abhaken. Gebaut ist alles; hier geht es um Einspielen, Einrichten und die erste echte Probe. Den echten
Versand an Teilnehmer macht der Betreiber in Season 1 - davor nur die Probe mit einem Testkonto (Schritt 3).

1. [ ] **Release einspielen.** Mindestens Website 1.100.0 (Saisonende-Moment #1639, Versionsanzeige #2585; Playoffs #2404 und
   Startrechte #1627 stecken schon in 1.96.0 und 1.98.0) auf dem Server einspielen, Migrationen laufen beim Start von selbst.
   Prüfen: `/api/health/ready` grün, die Fußzeile zeigt die Version (#2585), die nächste nächtliche Gesamtabnahme auf `main`
   grün - die erweiterte Abnahme dieses Pakets ist ein Test-PR und ändert am Release nichts.
2. [ ] **Bereich „Ligen“ vergeben.** Allen Liga-Leitungen den Bereich **Ligen** geben, Zwei-Faktor bei jedem Konto prüfen,
   Zuständige je Liga eintragen (B.1). Eine zweite Person mit Bereich Ligen ist Pflicht: Wiederöffnen, Einsprüche und
   Befangenheit brauchen sie.
3. [ ] **Erster echter Versand als Probe - mit Testkonto, nicht mit Teilnehmern.**
   - Vorher: `OUTBOUND_DISABLED` ist auf dem Server **nicht** gesetzt, Mail-Zugang (`RESEND_API_KEY`), Push (App mit Testkonto,
     Mitteilungen erlaubt) und der Discord-Bot sind eingerichtet; das Testkonto hat Discord verknüpft und Discord-Nachrichten erlaubt.
   - Eine Probe-Liga mit einer Season auf **Nur Liga-Leitung**, ein Test-Co-Team mit dem Testkonto als Captain, einer Staffel
     zugeteilt.
   - **Mail und Glocke:** Rundnachricht (Leitstand, „Mail auch“) an Captains der Probe-Season - kommt sie genau einmal im Postfach,
     in der Glocke und als Push am Handy an?
   - **Push und Discord:** In der Probe-Season unter Termine → Erinnerungen **Discord** einschalten, ein Spiel auf morgen legen -
     kommt „Liga-Spiel in 24 Stunden“ einmal als Push und als Direktnachricht vom Bot?
   - Danach die Probe-Liga archivieren. Fällt etwas aus, Mail- bzw. Push-Protokoll in der Betriebssicht ansehen, nicht mit echten
     Teilnehmern weiterprobieren.
4. [ ] **Backup-Timer prüfen.** `systemctl list-timers 'tls-*'` (Backup täglich 03:15, Restore-Drill monatlich),
   `journalctl -u tls-backup.service --since yesterday` ohne Fehler, das letzte Manifest mit `consistent: true`,
   `bash scripts/restore-drill-status.sh` gibt 0. `BACKUP_REMOTE` zeigt auf ein Ziel außerhalb des Servers. Passwortdatei und
   `SETTINGS_ENCRYPTION_KEY` liegen im Passwortspeicher. Die Dienstdatei mit `TimeoutStartSec=2h` ist kopiert
   (`BACKUP_RESTORE.md`, „Was am Server zu tun ist“). Den Ablauf hat der Backup-Probelauf lokal belegt (Abschnitt 5).
5. [ ] **Datenschutztext** für externe Teilnehmer freigeben, rechtlich prüfen lassen, in der Season eintragen (Nr. 1, 72, 141).
6. [ ] **Spiel und Bibliothek:** MW4 als Version unter Call of Duty (Nr. 36), Modi mit Ergebnisregel und Symbol, Maps mit Bild,
   Ausrüstung.
7. [ ] **Liga und Season anlegen:** „Tiroler Liga MW4 Allmode“ unter `tiroler-liga-mw4-allmode` (Nr. 68), Season mit den Werten aus
   dem Regelwerk – Checkliste im [Handbuch, Abschnitt 6](../handbuch/liga.md#6-checkliste-vor-dem-season-start). **Vor dem ersten
   Abschluss festlegen**, weil es danach feststeht (Nr. 228): Playoffs (Plätze je Staffel, „Meister aus“), Relegation, Zonen,
   Startrechte (Zusage, Frist, Nachrückerregel), Dauer des Saisonende-Moments, Erinnerungen samt Discord-Schalter, Vorfälle.
8. [ ] **Regelwerk v0.15** mit Bausteinen und Variablen übertragen, Veto-Folge nach CDL-Prüfung (Nr. 100), veröffentlichen mit
   Zustimmungspflicht. Dabei (#2424, #2426): Anlage B nur mit `[[baustein:veto]]`, `[[baustein:lead_rulings]]` in Anlage C bzw. § 9a,
   „Ende des ersten Spieltags“ im Fließtext auf „Spielwoche“ ändern. Playoffs und Relegation als Anlage F von Hand (der Baustein
   ist Folgepaket, Nr. 216).
9. [ ] **„Was fehlt noch?“** ohne Probleme, Ligaseite mit *Nur Liga-Leitung* ansehen, dann Sichtbarkeit und Anmeldefenster öffnen.
10. [ ] **Anmeldungen** entscheiden, Co-Teams zuteilen, **Liga starten** je Staffel.
11. [ ] **Ankündigung** auf Discord von Hand mit Link zur Ligaseite und zum Spickzettel.
12. [ ] **Nach dem ersten Spielabend:** Leitstand und Protokoll der Season ansehen, die erste echte Erinnerung und Rundnachricht
    kontrollieren; ein rotes Issue „Liga-Gesamtabnahme rot“ sofort lesen.

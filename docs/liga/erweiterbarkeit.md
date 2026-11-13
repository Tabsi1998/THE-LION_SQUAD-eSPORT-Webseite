# Liga: Erweiterbarkeit (Paket F.3)

Prüfbericht zum Masterplan, Phase F.3. Hier wird **nichts gebaut**. Die Frage ist, wie gut das Liga-System (Phasen A bis F.2)
schon vorbereitet ist auf:

- andere CoD-Titel,
- mehr Stufen und Solo,
- Playoffs und Relegation,
- andere Spiele,
- die App.

Zurück zum Vertrag: [LIGA.md](../LIGA.md), Abschnitt 12.

**Stand:** 13.11.2026.

- Grundlage ist `main` auf `3bcd18c7c`.
- Gelesen wurde dazu F.2 (#2397, Branch `feat/1627-neue-season` auf `e1435ea34`, noch offen).
- Fundstellen aus F.2 sind mit **(F.2)** markiert. Ihre Zeilennummern gelten für diesen Branch.

**Aufwand:**

| Stufe | Bedeutung |
| --- | --- |
| **S** | ein paar Stunden, eine Stelle |
| **M** | ein Paket mit Tests in Server und Web |
| **L** | Datenmodell, mehrere Flächen (Web, App, TV, Druck), eigene Abnahme |

**Hürde:**

| Art | Bedeutung |
| --- | --- |
| *fest* | fest verdrahtet |
| *fehlt* | gibt es nicht |
| *teilweise* | gibt es, reicht aber nicht |
| *Vorgabe* | nur ein Standardwert, schon einstellbar |

## Kurzfassung

| Ziel | Stand | Größte Hürde |
| --- | --- | --- |
| CoD-Nachfolger in **neuer Liga** | geht heute über Daten | keine – neues Spiel (Edition), eigene Modi, Maps, Ausrüstung, neue Liga |
| CoD-Nachfolger **in derselben Liga** (Season 3 auf neuem Titel) | geht nicht | Das Spiel hängt an der Liga und ist ab der ersten Staffel gesperrt. Die Folge-Season (F.2) übernimmt Pool und Sperrliste des alten Titels |
| Mehr Liga N, mehrere Staffeln | geht | nur „Liga N · Beiname“, kein freier Name |
| Solo neben Team | geht nicht | `participant_kind` nur `"team"`. Anmeldung, Kader, Berechtigung, Übernahme und Texte setzen ein Co-Team voraus |
| Playoffs, Relegation, Finale | vorbereitet, nicht spielbar | Es fehlt ein Übergang von Tabelle zu K.-o. Relegationszonen sind nur farbig. Mehrere Meister bei mehreren Staffeln der obersten Liga N |
| Rocket League 3v3, Best of 7 | geht im Kern | MOSS und Vorfallarten passen nicht, stören aber nicht. Wort „Map“ statt „Spiel“ |
| EA FC 1v1, Tore, Hin- und Rückspiel | geht nicht | Map-Pool und Map-Pflicht, kein Remis je Partie, Tabelle ohne Tordifferenz, Staffel immer Team mit Co-Team |
| App | liest vieles aus dem Server | keine Maps je Spiel, keine Co-Team-Wahl, Tabelle fest, Liga plus Playoffs zeigt nur einen Baum |

**Gut vorbereitet** sind:

- **Modus am Spiel:** Status, Spielerzahl, Ergebnisregel, Einstellungen (`games.match_modes[]`, `backend/models.py:519-540`).
- **Spiel und Edition:**
  - Edition mit ID-Erbe: `parent_game_id`, `identity_source_game_id`, `inherit_player_ids` (`backend/services/game_id_keys.py:27-44`). Eine Activision-ID gilt damit für alle CoD-Titel.
  - Map-Bibliothek je Spiel.
  - Ausrüstung je Spiel (`backend/services/game_equipment.py`).
- **Season-Vorgaben:**
  - Best of, Teamgröße, Modusfolge, Map-Wiederholung, Punkte, Veto-Schritte, Check-in, Fristen.
  - Abweichungen je Liga N über `OVERRIDE_FIELDS` (`backend/services/league_service.py:107`).
- **Seed und Migrationen:** Im Seed und in den Migrationen stehen keine CoD-Modi, -Maps oder -Waffen.

## 1. Andere CoD-Titel

### Was heute je Spiel oder Season einstellbar ist

| Wert | Wo | Fundstelle |
| --- | --- | --- |
| Modi mit Status, Beschreibung, Spielerzahl, Format, Ergebnisregel, Einstellungen | Spiel | `backend/models.py:519-540`, höchstens 20 Modi (`:329`) |
| Ergebnisregel: Art, Ziel, Rundenlimit, Zeit, Remis, Verlängerung | Spiel, Season weicht je Modus ab | `backend/models.py:380-430`, `backend/services/league_result_rules.py:89-131` |
| Maps je Modus, Map-Pools in Versionen | Spiel, Season, Staffel | `backend/services/game_maps.py`, `backend/services/map_pools.py:41` |
| Waffen, Aufsätze, Ausrüstung, Sperrliste in Versionen | Spiel, Season | `backend/services/game_equipment.py:3-15`, `backend/services/loadout_bans.py` |
| Spiel-ID-Felder (Muster, Pflicht, eindeutig je Season), Plattformfeld | Spiel | `backend/models.py:633-690`, `backend/services/league_platform.py:95-110` |
| Best of, Teamgröße, Modusfolge, Map-Wiederholung, Hin- und Rückrunde | Season, Liga N teilweise | `backend/services/league_service.py:50-94` |
| Veto: an/aus, Team A, Zeit je Schritt, Schrittfolge, Vorgabe der Woche | Season | `backend/services/league_veto_rules.py:77-122`, `:376-469` |
| Tabelle: Punkte, Punkteart, Reihenfolge, direkter Vergleich, Remis, Default-Win, Ausscheiden | Season, Liga N | `backend/services/scoring_rules.py:47-58`, `:305-312` |

### Hürden

| # | Fundstelle | Hürde | Aufwand | Vorschlag |
| --- | --- | --- | --- | --- |
| T1 | `backend/services/league_service.py:624-634`, `backend/models.py:2720` | *fest*: Das Spiel hängt an der **Liga**. Ab der ersten Staffel ist es gesperrt. | L | Optionales `league_seasons.game_id` (Edition), nur innerhalb derselben Hauptreihe (`top_game`). Fehlt es, gilt das Spiel der Liga. Die Staffel nimmt es beim Anlegen. Dann bleiben Season-Historie, Folge-Season und Gesamtwertung (F.5) über einen Titelwechsel hinweg eine Liga |
| T2 | `backend/services/league_successor.py` (F.2), `backend/services/league_service.py:1174` | *teilweise*: Die Folge-Season kopiert Map-Pool, Sperrliste und Modusfolge des Vorgängers. Bei neuem Titel wären die ungültig (`map_pools.valid_for` verwirft sie still). | M | Mit T1: In der Vorschau „anderes Spiel“ wählbar. Dann Pool, Sperrliste, `game_mode_order`, `result_rules` und Veto-Schritte nicht kopieren, sondern unter `dates_to_set` als „neu einrichten“ führen |
| T3 | `backend/services/squad_registration.py:140-147`, `backend/services/league_applications.py:1027-1032` | *teilweise*: Co-Team und Liga müssen nur dieselbe **Hauptreihe** haben. Ein Co-Team für einen älteren CoD-Titel darf in eine Liga des neuen. | S | Ist so gewollt (ein Co-Team über Titel hinweg). Wenn nicht: Schalter „Edition muss passen“ an der Season |
| T4 | `backend/services/league_veto_rules.py:23-24`, `frontend/src/lib/leagueVeto.js:9` | *fehlt*: Veto kennt nur Sperren, Wählen, Decider, Vorgabe. Keine **Seitenwahl** (z. B. Angriff/Verteidigung je Map) und kein Modus-Veto. | M | Schrittart `side` mit Seitennamen aus einem Feld am Modus (`sides: [...]`). Speichern in `planned_games[].side` (das Feld gibt es seit C.3 in `games[]`) |
| T5 | `backend/services/league_games.py` (`_lineup`, `setup.team_size`), `backend/models.py:533` | *teilweise*: Die Aufstellung ist immer `team_size` der Season. `players_per_side` am Modus ist nur eine Angabe. Ein 2v2-Modus in einer 4v4-Serie geht nicht. | M | Aufstellungsgröße je Map aus `players_per_side` des Modus, falls gesetzt. Sonst `team_size` |
| T6 | `backend/models.py:2766`, `:2848`; `frontend/src/lib/league.js:18` | *fest*: Best of an Season und Liga N nur 1, 3, 5, 7. Maps je Spiel höchstens 9 (`backend/models.py:1274`), Veto-Positionen 9 (`backend/services/league_veto_rules.py:33`). | S | Für CoD und RL reicht das. Bei Bedarf eine Liste am Spiel oder eine Zahl 1–9 |
| T7 | `backend/services/league_incident_rules.py:21-29`, `backend/services/league_protest_settings.py:25`, `backend/services/league_presets.py:23` | *fest*: Vorfallarten inklusive „MOSS-Absturz“ und MOSS-Frist. Das ist ein PC-Werkzeug aus der CoD-Szene und gilt für jedes Spiel. | M | Vorfallarten und MOSS-Frist je Season schaltbar. Vorgabe wie heute |
| T8 | `backend/services/league_platform.py:16`, `frontend/src/lib/leaguePlatform.js:4-9`, `backend/models.py:2795`, `:2857` | *fest*: Eingabegeräte nur Controller, Maus und Tastatur, beides | S | Liste am Spiel. Vorgabe wie heute |
| T9 | `backend/services/game_equipment.py:44-57`; Hilfetexte `frontend/src/pages/admin/games/GameGeneralTab.jsx:11-12`, `frontend/src/pages/admin/ModeSettingsEditor.jsx:11` | *Vorgabe*: Vorschläge „Perks“, „Abschussserien“, Beispiele mit Activision, Black Ops, „250“ | S | Nur Beispiele, gespeichert wird nichts davon. Bei Gelegenheit neutral formulieren |
| T10 | `backend/services/league_rule_facts.py:427-430` | *teilweise*: Im Regelwerk steht fest „72-h-Regel“, auch wenn die Frist anders eingestellt ist | S | Die Bezeichnung aus dem Wert bilden |

**Fazit CoD:**

- Ein Nachfolgetitel mit **eigener Liga** geht heute ohne Code.
- **Season für Season in derselben Liga** braucht T1 und T2. Das ist der wichtigste Punkt, wenn MW4 auf den nächsten Titel wechselt und die Liga mit Historie weiterlaufen soll.

## 2. Stufen: mehr Liga N, freie Namen, Solo

### Liga N und Staffeln

| # | Fundstelle | Hürde | Aufwand | Vorschlag |
| --- | --- | --- | --- | --- |
| S1 | `backend/models.py:2861` | *Vorgabe*: Liga 1 bis 20 je Season. Staffeln A–Z je Liga N (`backend/models.py:2878`, `backend/services/league_service.py:1092-1098`). Staffelgröße 2–20. | – | Reicht |
| S2 | `backend/services/league_service.py:401-409`, `backend/services/league_platform.py:87`, `backend/services/league_roster.py:971`, `backend/services/league_readiness.py:121`, `:190`; `frontend/src/lib/leagueDesk.js:45-47`, `frontend/src/pages/admin/league/SeasonDivisionsTab.jsx:59-63` | *fest*: Der Name ist immer „Liga N“ plus Beiname. Ein freier Name („Elite“, „Challenger“) geht nur als Zusatz. | S–M | Optional `display_name` an `league_divisions`. Fehlt er, gilt „Liga N“. Alle Stellen lesen `division_label()` statt selbst „Liga {level}“ zu bauen. Die Stufe bleibt `level` |
| S3 | `backend/services/league_scope.py:30` | *fest*: Kennzeichnung „Liga · Staffel A“ in Turnierliste, Profil, Teamseite | S | Den Namen der Liga bzw. der Liga N einsetzen |
| S4 | `backend/services/league_zones.py:69-80` (F.2) | *teilweise*: Auf- und Abstieg geht immer genau eine Liga N weiter. Bei zwei Staffeln oben und einer Liga N darunter gibt es keine Verteilung „Staffel A und B in eine Liga N“. | M | Reicht für den Start. Später Zielregel je Zone („Platz 1 jeder Staffel“, „die zwei besten Zweiten“) |

### Solo neben Team (#1629, #1622)

Der Turnierkern kann Solo (`team_mode="solo"`). `match_audience.roster_ids` kennt auch die Einzelperson
(`backend/services/match_audience.py:116-125`). Die Liga-Schicht nimmt aber an mehreren Stellen ein **Co-Team** an:

| # | Fundstelle | Hürde | Aufwand | Vorschlag |
| --- | --- | --- | --- | --- |
| S5 | `backend/models.py:2720`, `backend/services/league_service.py:601` | *fest*: `participant_kind: Literal["team"]` | S | `Literal["team", "solo"]`. Beim Anlegen gegen `games.supports_solo` / `supports_teams` prüfen (`backend/models.py:679-680`) |
| S6 | `backend/services/league_service.py:1138`, `:1147`; `backend/services/squad_registration.py:250`, `:444` | *fest*: Eine Staffel ist immer `team_mode="team"`, eine Anmeldung immer `registration_type="team"` | M | `team_mode` aus `participant_kind` der Liga. Solo-Anmeldung mit `user_id`, `identity_key "<tid>:user:<id>"` |
| S7 | `backend/models.py:2897`; `backend/services/league_applications.py:7`, `:212`, `:236` | *fest*: Die Selbstanmeldung braucht `squad_id`. `active_key` ist `<season>:<squad>`. | L | Antrag mit `user_id` statt `squad_id`, `active_key` `<season>:user:<id>`. Kapitän ist die Person selbst |
| S8 | `backend/services/league_roster.py` (97 Stellen mit `squad`), `backend/services/league_eligibility.py` (73) | *teilweise*: Kader, Stichtag, Transferfenster, Mindestkader und Mehrfachzuordnung rechnen je Co-Team | M–L | Für Solo: Kader = die Person. Kaderregeln abschalten (`min_squad_size = 1`, keine Transfers), Spiel-ID und Mindestalter bleiben |
| S9 | `backend/services/league_successor.py:153-154` (F.2) | *fest*: Die Folge-Season lässt Anmeldungen **ohne Co-Team** fallen („Ohne Co-Team - kein Startplatz“) | M | Übernahme je Person, sobald S7 steht |
| S10 | `backend/services/league_final.py:380-382`, F.2 `sides`/`team_ids`/`player_ids` | *teilweise*: Der Endstand kennt schon `player_ids`. Die Season-Historie im Profil geht damit auch für Solo. | S | Prüfen, wenn S6 steht |
| S11 | `backend/services/league_service.py:99`, `:300`; `:87` (`lineup_min_players: 3`) | *Vorgabe*: Neue Seasons setzen Mindestkader 3 und mindestens 3 Anwesende beim Check-in (`backend/services/checkin_rules.py:23-26`). Für 1v1 falsch. | S | Aus `team_size` bzw. `games.default_team_size` vorbelegen |
| S12 | Texte: „Co-Team“ an 231 Stellen in 50 Web-Dateien, 56 Dateien in `backend/services` und `backend/routes` | *fest*: Begriffe „Co-Team“, „Captain“, „Team“ | M | Begriffe aus einem Profil je Teilnehmerart (Muster `backend/services/series_kinds.py`, `vocab`), nicht Text für Text |

**Annahme „nur Co-Team“:** Ein Hauptteam ohne Co-Team kommt nicht in eine Liga. Das gilt für Zuteilen, Antrag und
Übernahme. Für Team-Ligen ist das gewollt (#1627). Für Solo ist es die Haupthürde.

## 3. Playoffs, Relegation, Finale

### Was es gibt

| Baustein | Fundstelle | Nutzbar für |
| --- | --- | --- |
| Formate Einfach-K.-o., Doppel-K.-o., eigenes Schema, Gruppen, Schweizer System | `backend/models.py:944-948`, Phasenarten `:1234-1238` | Playoff-Baum |
| Eigenes Schema mit Verweisen `W:X:1` / `L:X:1`, Grand-Final-Reset | `backend/services/custom_bracket.py:1-16` | Relegation (1 Spiel oder Hin und Rück als zwei Spiele), Finale |
| Mehrere Phasen je Turnier | `backend/routes/tournament_stage_routes.py:109-160` | Tabelle und K.-o. im selben Turnier |
| Endstand je Staffel, fest | `league_final_tables` (F.1, [LIGA.md](../LIGA.md) „F.1 Saisonabschluss“) | Setzliste der Playoffs |
| Zonen `promotion`, `playoff_promotion`, `playoff_relegation`, `relegation` | `backend/services/league_zones.py:18-24`, `:102-127` (F.2) | Wer in die Relegation muss |
| Entscheid bei Gleichstand mit Art „Entscheidungsspiel“ | `backend/services/league_table.py:120`, `backend/services/league_final.py:45` | wird nur vermerkt, nicht gespielt |

### Was fehlt

| # | Fundstelle | Hürde | Aufwand | Vorschlag |
| --- | --- | --- | --- | --- |
| P1 | `backend/routes/tournament_stage_routes.py:389-396`; `frontend/src/lib/tournamentGuide.js:33`, `:56` | *fehlt*: Eine Phase nimmt **alle** Anmeldungen. Es gibt keinen Übergang „Plätze 1–4 der Tabelle → K.-o.“. Der Leitfaden sagt selbst: K.-o. danach läuft als eigenes Turnier. | L | Gehört zu #1559 (Gruppen → Playoffs aus der Tabelle). Für die Liga: eine **Playoff-Staffel** je Liga N bzw. Season. Sie liest die Setzliste aus `league_final_tables` (fest, nicht live) und erbt Pool, Regelwerk, Veto und Kader der Season |
| P2 | `docs/LIGA.md` „Relegation (Entscheidung im Paket)“ (F.2) | *teilweise*: Relegationsplätze sind einstellbar und farbig, aber **ohne Wirkung**. Die Teams bleiben in ihrer Liga N. | M–L | Relegations-Staffel über zwei Liga N (Schema „Hin und Rück“ oder Best of). Ihr Sieger bekommt `movement` in der Folge-Season. Das braucht in F.2 `recompute` eine Quelle „Relegation“ neben dem Endstand |
| P3 | `docs/LIGA.md` Nr. 156 (F.1), `backend/services/league_final.py:285`, `:549` | *teilweise*: Meister ist **jede** Staffel der obersten Liga N. Bei zwei Staffeln gibt es zwei Meister. | M | Einstellung an der Season: „Meister aus Finale“. Dann zählt erst der Sieger der Playoff-Staffel (P1) als Meister (`tournament_awards`, F.4) |
| P4 | `backend/services/league_zones.py` (F.2), `backend/services/league_successor.py` (F.2) | *fehlt*: Zonen und Folge-Season kennen nur die Tabelle. Ein Playoff-Ergebnis ändert keinen Auf- oder Abstieg. | M | Mit P1/P2: Bewegung aus „Endstand plus Ergebnis der Entscheidungs-Staffel“. Die Tabelle bleibt unverändert, der Endstand auch (Vorgänger bleibt unverändert, F.2) |
| P5 | `backend/services/league_successor.py` (F.2, Voraussetzung „jede Staffel abgeschlossen“) | *teilweise*: Eine Playoff-Staffel muss beim Abschluss mitzählen, aber keinen eigenen Tabellen-Endstand bilden | S | Art der Staffel (`league_context.kind: "regular" \| "playoff" \| "relegation"`). Abschluss und Folge-Season werten je Art |
| P6 | Matchablauf (D.1–D.5, E.2, E.3) | *Vorgabe*: Check-in, Veto, Vorfälle, Proteste und Strafen hängen am Spiel und an `matches_v2`, nicht an der Tabelle | – | Laufen in einer K.-o.-Staffel ohne Umbau, sobald diese `league_context` trägt |
| P7 | App: `mobile/src/lib/tournamentView.ts:31-37` | *fest*: Die Tabelle erscheint nur, wenn **jede** Phase eine Tabelle ist. Liga plus K.-o. zeigt nur einen Baum, die Tabelle verschwindet. | M | Ansicht je Phase. Nötig, sobald P1 im selben Turnier läuft. Als eigene Staffel (Vorschlag P1) trifft es die App nicht |

**Zusammenspiel:**

- Der Endstand (F.1) ist die feste Setzliste.
- Die Zonen (F.2) sagen, wer in welche Entscheidungs-Staffel muss.
- Die Entscheidungs-Staffel ist ein normales Turnier mit `league_context` und eigener Art.
- So bleibt „Staffel = Turnier“ (Abschnitt 1) erhalten, und die Tabellen-Weiche `standings_for_structure` bleibt unberührt.

## 4. Andere Spiele

### Rocket League (3v3, Best of 7)

Geht im Kern schon:

- Modus „highest“ mit Verlängerung.
- Arenen als Maps.
- Best of 7, Teamgröße 3.

Offen sind nur Kleinigkeiten:

- MOSS und Vorfallarten (T7).
- Wort „Map“ (G4).
- Seitenwahl wird nicht gebraucht.

### EA FC (1v1, Hin- und Rückspiel, Tore)

| # | Fundstelle | Hürde | Aufwand | Vorschlag |
| --- | --- | --- | --- | --- |
| G1 | `backend/services/league_games.py:44`, `:366-367`, `backend/models.py:1310`, `backend/services/map_pools.py:109-116` | *fest*: Ohne Map-Pool kein Ergebnis, jede Partie braucht eine `map_id` | M | Schalter am Spiel bzw. an der Season „ohne Maps“. Dann ist `map_id` leer und es gibt keine Pool-Prüfung. Pool und Veto bleiben für Spiele mit Maps unverändert |
| G2 | `backend/services/league_games.py:402-407`, `:438-442`; `backend/models.py:1311` | *fest*: Jede Partie braucht einen Sieger, die Serie braucht `best_of // 2 + 1` Siege. Ein **Remis** je Partie und in der Serie ist unmöglich, auch mit `draw_allowed` bzw. `allow_draws`. | L | `winner_registration_id` optional mit Ausgang `draw`, wenn die Ergebnisregel Remis erlaubt. Dazu eine Serienart an der Season: `first_to` (heute) oder `all_played` (feste Anzahl Partien, z. B. 1 oder 2) |
| G3 | `backend/services/league_games.py:120-121`, `backend/services/league_result_rules.py:357`, `backend/services/league_rule_facts.py:93-94`, `backend/services/league_incidents.py:78` | *fest*: `best_of // 2 + 1` steht an vier Stellen | M | Eine Funktion `series_needed(setup)` mit der Serienart aus G2 |
| G4 | `backend/services/league_games.py:463-472`, `backend/services/scoring_rules.py:50`; `frontend/src/lib/leagueTable.js:5-13` | *teilweise*: Der Serienstand sind gewonnene Partien. Differenz und „Mehr gewonnene Maps“ in der Tabelle sind Map-Werte, die Tore aus `games[].scores` zählen nie. | M | Neue Reihenfolge-Kriterien `points_diff` und `points_for` (Summe der Punkte je Partie). Bezeichnung aus dem Spiel („Tordifferenz“) |
| G5 | Wort „Map“: `frontend/src/components/tls/league/LeagueReportForm.jsx:187`, `frontend/src/components/tls/league/LeagueGamesView.jsx:40`, `frontend/src/lib/leagueTable.js:13`, `backend/services/league_games.py:32`, `:40`, `:44`, `:440`, `backend/services/league_rule_facts.py:246-247`, Vorfall-Texte `backend/services/league_incident_rules.py:27`, `:36`, `:39` | *fest* | M | Begriff am Spiel (`unit_label`: Map, Spiel, Partie) und ein Hilfsbaustein für Ein- und Mehrzahl |
| G6 | `backend/services/league_service.py:58-59`, `:87`, `:99`; `frontend/src/lib/league.js:64-66` | *Vorgabe*: neue Season Best of 3, Teamgröße 4, Mindestkader 3 | S | Aus `games.default_best_of` / `default_team_size` vorbelegen (`backend/models.py:647`) |
| G7 | `backend/services/scoring_rules.py:305-312`; `frontend/src/lib/league.js:54` | *Vorgabe*: Tabelle 3/0/0 ohne Remis. Die Web-Vorgabe für Remis ist 1, der Server sagt 0. | S | Für FC in der Season 3/1/0 und Remis an (geht schon). Die Web-Vorgabe an den Server angleichen |
| G8 | `backend/models.py:2764` (`round_robin_legs` 1 \| 2), `backend/services/league_games.py:111-114` (Heim zuerst) | *Vorgabe*: Hin- und Rückrunde gibt es. Jedes Spiel zählt einzeln in der Tabelle, so wie in einer FC-Liga üblich. | – | Ein **Gesamtergebnis** aus zwei Spielen (Auswärtstore, Gesamtscore) braucht es nur für K.-o. bzw. Relegation (P2), dort im Schema als zwei Spiele mit Summe |
| G9 | `backend/services/loadout_bans.py:1204`, `frontend/src/lib/leagueRules.js:73` | *Vorgabe*: Ausrüstung mit Kopf „Waffe / Aufsätze“ | – | Für FC und RL einfach leer lassen. Der Block erscheint nur mit Sperrliste |

### Keine Vermischung zwischen Spielen

Das ist schon gegeben:

- Liga je Spiel (`leagues.game_id`, Index nicht eindeutig: mehrere Ligen je Spiel möglich).
- Pool nur gültig für sein Spiel (`backend/services/map_pools.py:119-121`).
- Kader je Season mit `game_id`.
- Co-Team-Prüfung gegen die Hauptreihe (T3).
- Zonen und Folge-Season bleiben in ihrer Liga (F.2).
- Gesamtwertung (F.5) hängt an der Liga.
- Die Referenz-Ligen (`series_kinds`, `team_league_*`) sind ein eigenes System und werden nicht berührt.

Einzige Lücke: T1. Wer heute für einen neuen Titel eine neue Liga anlegt, trennt die Historie.

## 5. App (`mobile/`, nur gelesen)

Die App enthält **keine** CoD-Werte und keine Weiche je Spiel. Diese Werte liest sie aus dem Server:

- Spiel-ID-Felder (`effective_player_id_fields`)
- Map-Pools
- Art der Ergebnis-Eingabe (`report_entry`)
- Bezeichnungen von Runde, Format und Punkten

Hürden:

| # | Fundstelle | Hürde | Aufwand | Vorschlag |
| --- | --- | --- | --- | --- |
| A1 | `mobile/src/components/MatchReportCard.tsx:87`, `mobile/src/components/results/ResultEntrySheet.tsx:83-87` | *fehlt*: Die Meldung schickt nur `results` (Platz, Stand), nie `games[]`. Maps, Aufstellung und Punkte je Partie gehen nur im Web. | L | Gehört zu G.2 (#2173). Bis dahin bleibt „App-Bestätigung ohne Maps“ der Vertrag |
| A2 | `mobile/src/lib/resultEntry.ts:63-68`, `:113-139`; `mobile/src/components/results/ResultInputs.tsx:62-97` | *teilweise*: Bei Best of fragt die App nur, wer jede Partie gewann. Kein Stand je Partie, kein Remis. | M | Mit G2 nachziehen |
| A3 | `mobile/src/lib/matchText.ts:88-110`, `mobile/src/screens/main/MatchDetailScreen.tsx:426` | *fehlt*: Ein fertiges Spiel zeigt nur den Gesamtstand, `match.games` wird nie gezeigt | M | Partien-Liste mit Begriff aus G5 |
| A4 | `mobile/src/components/tournament/RegistrationSheet.tsx:60`, `:95-99`, `:169-186`; `mobile/src/screens/main/TournamentDetailScreen.tsx:264-273` | *fest*: Die Anmeldung kennt nur das Hauptteam, keine Co-Team-Wahl | M | Liga-Anmeldung (B.4) in der App, G.2 |
| A5 | `mobile/src/screens/main/TournamentDetailScreen.tsx:154-157`, `:204` | *fest*: „Meine Anmeldung“ ist die erste passende. Zwei eigene Co-Teams in einer Staffel zählen als eine. | S–M | Menge statt einzelner Kennung |
| A6 | `mobile/src/lib/tournamentView.ts:141-169`, `mobile/src/components/tournament/StandingsTables.tsx:13` | *fest*: Spalten Sp/S/U/N/Diff/Pkt. Keine Zonen, keine zweite Reihenfolge-Spalte, Diff ohne Einheit. | M | Zonen und Bezeichnungen aus dem Server (F.2 liefert `zone` je Zeile) |
| A7 | `mobile/src/lib/tournamentView.ts:31-37` | *fest*: Liga plus K.-o. im selben Turnier zeigt nur einen Baum (P7) | M | Ansicht je Phase |
| A8 | `mobile/src/lib/teamDay.ts:41-49`, `mobile/src/components/tournament/TeamDayCard.tsx:55`, `:70-79` | *teilweise*: Aufstellung einmal je Turnier mit genau `team_size`, nicht je Spiel oder Partie | M–L | Für die Liga nicht nötig, solange die Aufstellung im Web gemeldet wird |
| A9 | `mobile/src/components/MatchReportCard.tsx:108`, `mobile/src/screens/main/MatchDetailScreen.tsx:533`, `:592`, `:673`; `mobile/src/screens/main/TournamentDetailScreen.tsx:63`, `:478` | *fest*: Texte „Teamleitung“, „Team-Captains“, Reiter „Spieler“ auch bei Teams | S | Begriffe nach Teilnehmerart (S12) |
| A10 | `mobile/src/lib/teamLeague.ts:43-64`, `mobile/src/components/references/season/TeamLeague.tsx:101-149` | *Vorgabe*: Veto-Wörter und Rundenanteil je Map in der Referenz-Teamliga | S | Nur Referenzen, blendet sich ohne Veto-Daten aus |

## Rangliste: was zuerst

### Wenn Fabian einen neuen CoD-Titel will

1. **Gleich, ohne Code:** Edition anlegen (ID-Erbe), Modi, Maps und Ausrüstung pflegen, neue Liga. Historie getrennt.
2. **T1 + T2 Edition je Season** (L). Damit läuft dieselbe Liga mit Historie, Folge-Season und Gesamtwertung weiter.
3. **T4 Seitenwahl im Veto** (M), falls das neue Regelwerk sie verlangt.
4. **T5 Aufstellung je Modus** (M), falls der Titel Modi mit anderer Spielerzahl bringt.
5. **T7 Vorfallarten schaltbar** (M), wenn MOSS wegfällt oder ersetzt wird.

### Wenn Fabian Playoffs oder Relegation will

1. **P1 Playoff-Staffel aus dem Endstand** (L), zusammen mit #1559.
2. **P5 Art der Staffel** (S) als Grundlage für Abschluss und Folge-Season.
3. **P3 Meister aus Finale** (M), wenn die oberste Liga N mehrere Staffeln hat.
4. **P2 + P4 Relegation mit Wirkung** (M–L).
5. **P7 / A7 App je Phase** (M), nur wenn K.-o. im selben Turnier läuft.

### Wenn Fabian Solo will

1. **S5 + S6 Teilnehmerart an Liga und Staffel** (M).
2. **S7 Antrag ohne Co-Team** (L).
3. **S8 Kader und Berechtigung je Person** (M–L).
4. **S11 Vorgaben für 1v1** (S) und **S12 Begriffe** (M).
5. **S9 Folge-Season für Solo** (M).
6. **App:** A4, A9 in G.2.

### Wenn Fabian EA FC will

1. Zuerst **Solo** (oben), weil 1v1.
2. **G1 ohne Maps** (M).
3. **G2 + G3 Remis und Serienart** (L).
4. **G4 Tordifferenz** (M), dann **G5 Begriff je Spiel** (M).

Rocket League braucht nur T7 und G5.

## Vorschläge für Issues

Vorhandene Issues, die schon passen:

- **#1629** (getrennte Ligasysteme, Solo und Team)
- **#1622** (Ligaserien, Divisionen, Solo/Team)
- **#1631** (Format-Matrix, Qualifier und Relegation)
- **#1559** (Gruppen → Playoffs aus der Tabelle)
- **#2173** (App)

Neu fehlen:

| Vorschlag Titel | Inhalt | Bezug |
| --- | --- | --- |
| Liga: Edition je Season – Titelwechsel ohne neue Liga | `league_seasons.game_id` optional, nur innerhalb der Hauptreihe. Staffel übernimmt es. Folge-Season mit „anderes Spiel“: Pool, Sperrliste, Modusfolge, Ergebnisregeln und Veto-Schritte neu einrichten statt kopieren. Historie und F.5 bleiben eine Liga | T1, T2 |
| Liga: Partien ohne Maps, Remis je Partie und Serienart | Schalter „ohne Maps“, `draw` als Ausgang je Partie, Serienart `first_to` / `all_played`, eine Funktion für „Siege nötig“. Reihenfolge-Kriterien Punkte-/Tordifferenz. Begriff je Spiel (Map/Spiel/Partie). Web, TV, PDF, App-Bestätigung | G1–G5 |
| Liga: Veto-Seitenwahl und Aufstellungsgröße je Modus | Schrittart `side` mit Seitennamen am Modus. Aufstellung je Partie nach `players_per_side` | T4, T5 |
| Liga: Vorfallarten und MOSS je Season schaltbar | Liste der Vorfallarten und MOSS-Frist je Season. Vorgabe wie heute, Regelwerk-Bausteine lesen die Auswahl | T7 |
| Liga: Playoff- und Relegations-Staffeln aus dem Endstand | Art der Staffel (`regular`/`playoff`/`relegation`), Setzliste aus `league_final_tables`, Meister aus Finale, Relegation wirkt auf die Folge-Season. Baut auf #1559 und F.2 | P1–P5 |
| Liga: Freier Name je Liga N | `display_name` an `league_divisions`, alle Stellen über `division_label()`, Kennzeichnung in Listen | S2, S3 |

Für **Solo** reicht eine Checkliste als Kommentar an #1629/#1622: S5–S12 mit den Fundstellen oben.
Für die **App** gehört A1–A9 als Liste in #2173.

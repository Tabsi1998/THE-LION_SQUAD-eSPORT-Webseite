# Liga – Stufe 1 (CoD-Liga, Start Di 10.11.2026)

Stand: 28.10.2026, verbindlicher Vertrag für die Pakete P1–P6 des Epics #1621 (Entscheidungen 15.10. und 27.10.).
Zwei Worker bauen parallel darauf: **A** = P1 Liga-Rahmen und Admin, P2 Spielplan und Wertung, P5 Ligaseite;
**B** = P3 Co-Team als Teilnehmer, P4 Ergebnis je Map mit Aufstellung. Wer den Vertrag ändern will, ändert zuerst
dieses Papier (eigener Commit, der andere Worker zieht nach).

## 1. Grundidee

- **Eine Staffel ist ein Turnier** (`tournaments`, `format="league"`, Phase `stage_type="league"`). Spielwochen,
  Terminabstimmung, Melden/Bestätigen, 48-h-Automatik, Einspruch, kampflos und Tabelle kommen unverändert aus dem
  Turnierkern.
- Darüber liegt eine **dünne Liga-Schicht**: Liga (je Spiel) → Season → Liga N (Division) → Staffel A/B (Turnier).
- **Nur ergänzen, nichts umbauen.** Jedes neue Feld ist optional; fehlt es, verhält sich alles wie heute.
- Die Season ist **Vorlage**, das Staffel-Turnier trägt die geltenden Werte selbst (Kopie beim Anlegen). Der
  Turnierkern liest nur das Turnier, nie die Season.
- Namensgrenze: `seasons`, `season_service.py`, `season_routes.py` sind die **Jahreswertung**, `services/seasons.py`
  sind die **Jahreszeiten**. Alles Neue heißt `league_*` (Sammlungen, Services, Routen, Komponenten).

## 2. Datenmodell

Kennungen sind `id` (String, `new_id()`), Zeiten ISO in UTC, Kalendertage als `YYYY-MM-DD` (Wiener Kalender).
Jede Sammlung hat dazu `created_at`, `created_by`, `updated_at`.

### `leagues` (neu, Worker A)

| Feld | Typ | Pflicht | Vorgabe / Bedeutung |
| --- | --- | --- | --- |
| `slug` | str | ja | Teil der URL `/liga/<slug>/…`; Vorgabe der Slug des Spiels |
| `name` | str | ja | z. B. „CoD-Liga“ |
| `game_id` | str | ja | Spiel aus `games` |
| `participant_kind` | `"team"` | ja | Stufe 1 nur `team`; `solo` folgt (#1629) |
| `description` | str | nein | |
| `status` | `"active"` \| `"archived"` | ja | `active` |

Indizes: `id` eindeutig, `slug` eindeutig, `game_id`.

### `league_seasons` (neu, Worker A)

| Feld | Typ | Pflicht | Vorgabe / Bedeutung |
| --- | --- | --- | --- |
| `league_id` | str | ja | |
| `number` | int ≥ 1 | ja | 1 |
| `name` / `slug` | str | ja | „Season 1“ / `season-1` |
| `start_date` | datetime | ja | Beginn Spielwoche 1 (Di 10.11.2026 00:00 Wien) |
| `weeks_total` | int 1–52 | ja | **10** – Kalenderwochen inklusive Sperrwochen |
| `blocked_periods` | `[{start_date, end_date, label}]` | nein | `[]`; Season 1: 21.12.–3.1. „Weihnachtspause“ |
| `matchday_days` | int | ja | 7 (Spielwoche Di–Mo) |
| `default_match_weekday` / `default_match_time` | int 0–6 / „HH:MM“ | ja | 6 / „20:00“ (So 20:00 Wien) |
| `round_robin_legs` | 1 \| 2 | ja | **1** (nur Hinrunde) |
| `max_staffel_size` | int 2–20 | ja | 8 |
| `best_of` | 1, 3, 5, 7 | ja | 3 (Fabian legt fest) |
| `team_size` | int ≥ 1 | ja | 4 (Spieler je Map) |
| `min_squad_size` | int ≥ `team_size` | ja | = `team_size` |
| `game_mode_order` | `[str]` | nein | `[]` = Modus je Map frei; sonst Modus je Position (zyklisch) |
| `scoring_rules` | dict | ja | `normalize_rules({})` aus `services/scoring_rules.py`; gelesen werden nur `match_points` (3/1/0) und `table_tiebreakers` |
| `result_confirm_hours` | int 1–336 | ja | 48 |
| `lineup_amend_hours` | int 1–336 | ja | 48 – Nachtragsfrist der eigenen Aufstellung nach dem Ergebnis |
| `rules_text` | str (Markdown) | nein | Regeltext der Season (Textfeld, #1646 später) |
| `registration_deadline` | Kalendertag | nein | Meldeschluss, nur Anzeige (Season 1: 6.11.) |
| `visibility` | `"off"` \| `"admins"` \| `"members"` \| `"public"` | ja | **`off`** |
| `status` | `"draft"` \| `"active"` \| `"completed"` \| `"archived"` | ja | `draft` |

Map-Pool der Season: in `map_pools` mit neuem Scope **`league_season`** (`scope_id` = Season-ID), gleiche Versionen
und Prüfungen wie heute (`services/map_pools.py`, `SCOPES` um `league_season` ergänzen).
Indizes: `id` eindeutig, (`league_id`, `number`) eindeutig, (`league_id`, `slug`) eindeutig, `status`.

### `league_divisions` (neu, Worker A)

| Feld | Typ | Pflicht | Vorgabe / Bedeutung |
| --- | --- | --- | --- |
| `league_id`, `season_id` | str | ja | |
| `level` | int ≥ 1 | ja | „Liga N“; (`league_id`, `level`) ist die dauerhafte Stufe über Seasons |
| `nickname` | str ≤ 40 | nein | Beiname: Anzeige „Liga 1 · Elite“ |
| `overrides` | dict | nein | Abweichung von der Season nur für `best_of`, `team_size`, `min_squad_size`, `max_staffel_size`, `scoring_rules` |
| `status` | `"active"` \| `"archived"` | ja | `active` |

Indizes: `id` eindeutig, (`season_id`, `level`) eindeutig.

### Staffel-Turnier: neue Felder an `tournaments` (Worker A)

| Feld | Typ | Pflicht | Bedeutung, Verhalten ohne Feld |
| --- | --- | --- | --- |
| `league_context` | `{league_id, season_id, division_id, staffel}` | nein | `staffel` = „A“, „B“ …; **fehlt bei allen anderen Turnieren** (nie `null` schreiben). Nur der Liga-Service setzt es, `TournamentUpdate` nimmt es nicht an |
| `round_robin_legs` | 1 \| 2 | nein | fehlt = 2 (Hin- und Rückrunde wie heute) |
| `matchday_blocked_weeks` | `[int]` | nein | gesperrte Kalenderwochen ab `start_date` (1-basiert); fehlt = `[]`. Gesperrt ist eine Woche, wenn mehr als die Hälfte ihrer Tage in einer Sperrzeit liegt (Season 1: Wochen 7 und 8; der Montag 21.12. allein sperrt Woche 6 nicht) |
| `matchday_weeks_total` | int | nein | Wochenbudget für „Runden ≤ aktive Wochen“; fehlt = keine Prüfung |
| `scoring_rules` | dict | nein | normalisiert; fehlt = heute fest 3/1/0 mit Reihenfolge Punkte, Siege, Differenz |
| `game_mode_order` | `[str]` | nein | fehlt = frei |
| `lineup_amend_hours` | int | nein | fehlt = 48 |
| `min_squad_size` | int | nein | Mindestkader fürs Zuteilen (B); fehlt = `team_size` |

Beim Anlegen kopiert A aus Season (und `overrides`) in vorhandene Felder: `game_id`, `format="league"`,
`team_mode="team"`, `team_size`, `min_squad_size`, `best_of`, `max_participants=max_staffel_size`, `min_participants=2`,
`start_date`, `end_date` (Ende der letzten Woche), `matchday_days`, `default_match_weekday`, `default_match_time`,
`result_confirm_hours_league`, `rules`, `result_entry_mode="player_confirmed"`, `registration_enabled=false`,
`discord_registration=false`, `discord_skip=true`, `season_weight=0`, Sichtbarkeit (Abschnitt 10). Den Pool speichert
A als Version im Scope `tournament` (gleiche Maps wie die Season) – `effective_pool` bleibt unverändert.
Titel „CoD-Liga Season 1 · Liga 1 · Staffel A“, Slug `<liga>-<season>-liga-1-a`.
Indizes: `league_context.season_id` (partiell, nur mit Feld); (`league_context.division_id`, `league_context.staffel`)
eindeutig, partiell.

### Co-Team und Anmeldung (Worker B)

| Sammlung.Feld | Typ | Pflicht | Bedeutung |
| --- | --- | --- | --- |
| `team_squads.captain_id` | str | nein | Mitglied des Co-Teams (`member_ids`) |
| `team_squads.vice_captain_id` | str | nein | Mitglied, ≠ `captain_id` |
| `tournament_registrations.squad_id` | str | nein | Co-Team; fehlt = Anmeldung wie heute |
| `tournament_registrations.squad_name` | str | nein | Schnappschuss des Co-Team-Namens |
| `tournament_registrations.league_squad_key` | str | nein | `<season_id>:<squad_id>`, eindeutig (sparse) – ein Co-Team je Season nur in einer Staffel; nur mit `league_context`; folgt jedem Statuswechsel: nicht aktiv (abgelehnt, nicht erschienen, Austritt, Disqualifikation) = weg, wieder aktiv = neu gesetzt, sonst 409 |

Eine Co-Team-Anmeldung: `team_id` = Hauptteam, `squad_id`, `display_name` = „Lions · Lions B“,
`registration_type="team"`, `registered_via="league_assign"`, `user_id=None`, `status="approved"`,
`identity_key = "<tid>:team:<team_id>"` (unverändert – damit erzwingt der vorhandene eindeutige Index „zwei Co-Teams
desselben Hauptteams nie in derselben Staffel“). `lineup`/`substitutes` (Team am Spieltag, #1192) bleiben leer;
„Team am Spieltag“ (`/api/team-day`) gilt für Co-Team-Anmeldungen nicht.
Indizes: `tournament_registrations.squad_id` (partiell), `team_squads.captain_id` und `.vice_captain_id` (sparse).

### Ergebnis je Map am Spiel (`matches_v2`, Worker B)

| Feld | Typ | Bedeutung |
| --- | --- | --- |
| `games` | `[MatchGame]` | geltende Maps des Spiels, geschrieben beim Bestätigen (Konsens, 48-h-Automatik) oder von der Turnierleitung |
| `reports[].games` | `[MatchGame]` | Sicht der jeweiligen Meldung, bis zur Bestätigung |
| `lineup_user_ids` | `[str]` | Vereinigung aller Aufstellungen aus `games` und offenen `reports[].games` – für die Doppel-Einsatz-Prüfung |
| `lineups_missing` | `[registration_id]` | Seiten ohne Aufstellung (App-Bestätigung, Automatik) |
| `map_pool_id` | str | vorhanden (#1616); B setzt es beim ersten Melden mit Maps, wenn leer |

`MatchGame`:

| Feld | Typ | Pflicht | Regel |
| --- | --- | --- | --- |
| `position` | int 1…`best_of` | ja | lückenlos ab 1 |
| `mode` | str | wenn der Pool Modi hat | Modus des Spiels; bei `game_mode_order` genau der Modus dieser Position |
| `map_id` | str | ja | aus dem geltenden Pool (`map_pools.effective_pool` + `map_pools.allowed(pool, mode, map_id)`) |
| `map_name`, `map_image_url`, `mode_label` | str | – | Schnappschuss, setzt der Server aus dem Pool, nie aus der Eingabe |
| `winner_registration_id` | str | ja | eine der beiden Anmeldungen des Spiels |
| `scores` | `{registration_id: Zahl ≥ 0}` | nein | Punkte der Map (z. B. Hardpoint 250:180) |
| `lineups` | `{registration_id: [user_id]}` | je Seite | genau `team_size` verschiedene Mitglieder des Co-Teams der Seite (Kader laut `match_audience.roster_ids`, nur wer noch im Hauptteam ist) |

Meldung (`models.py`, Abschnitt Matches): `MatchScoreReport.games: Optional[List[MatchGameReport]]` mit
`{position, mode, map_id, winner_registration_id, scores, lineup}` – `lineup` ist die **eigene** Seite.
Admin: `MatchV2ResultSubmit.games` (optional, mit `lineups` beider Seiten, je Seite freiwillig – fehlende Seiten landen
in `lineups_missing`). Ohne `games` bleiben die Maps des Spiels; passt ein korrigierter Stand nicht mehr zu ihnen,
fallen sie weg. Nachtrag: `PUT /api/matches/{id}/lineups` mit `{games: [{position, lineup}]}` für jede Map der eigenen
Seite; die Turnierleitung nennt zusätzlich `registration_id` und `reason`. Index: `matches_v2.lineup_user_ids`
(sparse, Mehrfachwert). Die Matchseite liefert dazu den Block `league` (Pool, Kader der eigenen Seite, Maps mit
Namen der Aufgestellten, Meldungen beider Seiten, `can_amend_lineup`, `amend_until`).

### Protokoll (`audit_logs.action`)

`league.create|update`, `league.season.create|update`, `league.season.map_pool.save|clear`,
`league.division.create|update`, `league.staffel.create`, `league.staffel.sync` (A) · `team.squad.roles`, `league.squad.assign|remove` (B) · `match.games.report`,
`match.lineup.amend`, `match.games.correct` (B).

## 3. Einstellbar statt fest

| Wert | Ebene | Vorgabe |
| --- | --- | --- |
| Wochen gesamt, Sperrzeiten, Spielwoche, Standardtag/-zeit | Season | 10 · keine · 7 Tage · So 20:00 |
| Runden (1 = Hinrunde, 2 = Hin/Rück) | Season | 1 |
| Staffelgröße max., Best of, Teamgröße, Mindestkader | Season, Liga N überschreibt | 8 · 3 · 4 · 4 |
| Punkte Sieg/Remis/Niederlage, Gleichstand | Season (`scoring_rules`), Liga N überschreibt | 3/1/0 · `score_diff`, `score_for` |
| Modus je Position | Season | frei |
| Bestätigungsfrist, Aufstellungs-Nachtrag | Season | 48 h · 48 h |
| Map-Pool | Season (`league_season`) | keiner = keine Liga-Meldung möglich |
| Regeltext, Meldeschluss, Sichtbarkeit | Season | leer · leer · aus |

Season-Änderungen wirken erst über „Vorgaben auf Staffeln übertragen“ (`league.staffel.sync`, A): Termine und
Kalender nur vor dem Start, Best of/Teamgröße/Punkte nur vor dem ersten Ergebnis, Sichtbarkeit und Regeltext immer.
Ausnahme: die **Sichtbarkeit** (`visibility`, `is_public`) schreibt schon das Speichern der Season auf alle ihre
Staffeln, auch gesperrte („aus“ heißt sofort aus).
Genau (`services/league_service.SYNC_GROUPS`): **immer** (auch gesperrte Staffeln) `visibility`, `is_public`, `rules`
und der Map-Pool (neue Version im Scope `tournament`, nur wenn er sich unterscheidet – Spiele mit festgehaltenem Pool
behalten ihren; hat die Season keinen Pool mehr, wird die Kopie nur vor dem ersten Ergebnis entfernt);
**vor dem Start** (Status `draft` bis `check_in`) `start_date`, `end_date`, `matchday_days`, `default_match_weekday`,
`default_match_time`, `round_robin_legs`, `matchday_blocked_weeks`, `matchday_weeks_total`, `max_participants`,
`min_squad_size` – nur wenn die Prüfung „Runden ≤ aktive Wochen“ passt und nicht schon mehr Teams angemeldet sind;
**vor dem ersten Ergebnis** `best_of`, `team_size`, `scoring_rules`, `game_mode_order`, `result_confirm_hours_league`,
`lineup_amend_hours`. `min_squad_size` steht damit am Turnier (Season bzw. Liga N, mindestens `team_size`); B liest es
beim Zuteilen dort.

## 4. Rechte

Angelehnt an `services/match_audience.py` (Verantwortliche/Spieler) und `auth.require_area` (Bereiche).

| Aktion | Turnierleitung (`require_area("tournaments")`, mit Zwei-Faktor) | Hauptteam-Leitung (Leitung, Co-Leitung) | Captain | Vertreter | Mitglied Co-Team |
| --- | --- | --- | --- | --- | --- |
| Liga, Season, Liga N, Staffel anlegen/ändern, Spielplan, Start | ja | – | – | – | – |
| Co-Team zuteilen/entfernen | ja | – | – | – | – |
| Co-Team-Kader pflegen | ja (`_can_manage`) | ja | – | – | – |
| Captain/Vertreter vergeben (mit Protokoll) | ja | ja | – | – | – |
| Termin vorschlagen/annehmen | ja | nur Fallback¹ | ja | ja | – |
| Ergebnis melden, bestätigen, Einspruch | ja | nur Fallback¹ | ja | ja | – |
| Eigene Aufstellung nachtragen (bis `lineup_amend_hours`) | jederzeit, mit Grund | nur Fallback¹ | ja | ja | – |
| Ergebnis/Maps korrigieren (`force` + Grund) | ja | – | – | – | – |
| Matchchat, Spiel-Hinweise | ja | ja | ja | ja | ja |
| Ligaseite lesen | immer | nach Sichtbarkeit | nach Sichtbarkeit | nach Sichtbarkeit | nach Sichtbarkeit |

¹ Hat ein Co-Team weder Captain noch Vertreter, handelt die Hauptteam-Leitung (niemand sperrt sich aus).
Umsetzung B: Für Anmeldungen mit `squad_id` gilt in `match_audience` – Verantwortliche = `captain_id`,
`vice_captain_id` (sonst Leitung und Co-Leitung des Hauptteams); Spieler = `member_ids` des Co-Teams plus
Verantwortliche plus Leitung und Co-Leitung des Hauptteams (Zeile „Matchchat, Spiel-Hinweise“), nicht die übrigen
Mitglieder des Hauptteams; im Matchchat schreibt der ganze Kader des Co-Teams; `responsible_registration` findet
Anmeldungen auch über Co-Teams, deren Captain/Vertreter man ist. Aufrufer mit eigener Projektion der Anmeldung lesen
`squad_id` mit. Anmeldungen ohne `squad_id` behalten exakt das heutige Verhalten (Regressionstests Pflicht).

## 5. Regeln und Prüfungen (Server, mit deutscher Meldung)

| Regel | Wann | Wer |
| --- | --- | --- |
| Co-Team gehört zum Hauptteam (`team_squads.team_id`), ist `active`, `game_id` = Spiel der Liga (ohne `game_id` am Co-Team: passt) | Zuteilen | B |
| Kader ≥ `min_squad_size` der Staffel (fehlt = `team_size`; nie kleiner als `team_size`), alle Mitglieder im Hauptteam | Zuteilen | B |
| Zwei Co-Teams desselben Hauptteams nie in derselben Staffel | Zuteilen (Index `identity_key`) | B |
| Ein Co-Team je Season nur in einer Staffel (`league_context.season_id`) | Zuteilen | B |
| Staffel nicht voller als `max_participants` | Zuteilen | B |
| Captain und Vertreter sind Mitglieder, verschieden; Entfernen aus Kader und Hauptteam erst nach Neuvergabe | Rollen, Kader, Team | B |
| Co-Team mit Anmeldung (jeder Status) in einer nicht beendeten Staffel nicht löschbar, sein Hauptteam nicht auflösbar | Löschen, Auflösen | B |
| Runden ≤ aktive Wochen: `(n−1 bei gerader, n bei ungerader Zahl) × round_robin_legs ≤ weeks_total − Sperrwochen` | Staffel anlegen, Spielplan | A |
| Heimrecht fair: Differenz Heim/Auswärts je Team ≤ 1 bei `round_robin_legs=1`; bei 2 Ausgabe unverändert | Spielplan | A |
| Terminvorschlag nicht in einer Sperrzeit | Vorschlagen | B ruft A-Helfer |
| Liga-Spiel: Erstmeldung nur mit `games` und eigener Aufstellung, sonst 422 „Bitte im Web mit Maps und Aufstellung melden“ | Melden | B |
| Best of: Sieger erreicht ⌊N/2⌋+1, keine Map nach Entscheidung, `results.score` = gewonnene Maps je Seite | Melden, Korrektur | B |
| Map im Pool und für den Modus freigegeben, Modus passt zu `game_mode_order` | Melden, Korrektur | B |
| Aufstellung: genau `team_size` verschiedene Mitglieder des eigenen Co-Teams je Map | Melden, Nachtrag | B |
| Kein Doppel-Einsatz: dieselbe Person nicht in Aufstellungen zweier Anmeldungen am selben Spieltag (`matchday_number_of`) in Staffeln derselben `league_context.season_id` | Melden, Nachtrag | B |
| Bestätigung mit anderen Maps/Modi/Siegern als die Erstmeldung → 409 mit Hinweis auf Einspruch | Bestätigen | B |

## 6. Abläufe

| Schritt | Wer | Was technisch passiert |
| --- | --- | --- |
| 1 Liga, Season, Liga N anlegen | Leitung | `leagues`, `league_seasons`, `league_divisions`; Pool im Scope `league_season` |
| 2 Staffel anlegen | Leitung | Turnier mit `league_context` und Vorgaben, Status `draft`, Prüfung Runden ≤ Wochen |
| 3 Co-Teams zuteilen (bis Meldeschluss) | Leitung | Anmeldung mit `squad_id` je Co-Team (Admin-Dialog „Co-Team zuteilen“) |
| 4 Spielplan und Start (9./10.11.) | Leitung | vorhandenes Erzeugen der Phase (`_auto_league_schema` mit `round_robin_legs`), Status `live` |
| 5 Termin | Captain/Vertreter | vorhandene Terminvorschläge; ohne Einigung Standardtermin der Woche (Sperrwochen übersprungen) |
| 6 Melden | Captain/Vertreter Seite 1, **Web** | `POST /matches/{id}/report` mit `results` + `games` (Maps, Sieger, eigene Aufstellung) |
| 7 Bestätigen + ergänzen | Captain/Vertreter Seite 2 | Web: gleiche `results`, eigene Aufstellung je Map → Konsens, `games` am Spiel. **App** (ohne neuen Build): gleiche `results` ohne `games` → Konsens zählt, Seite 2 landet in `lineups_missing` und bekommt die Nachricht „Bitte Aufstellung im Web nachtragen“ |
| 8 48 h ohne Antwort | Fristen-Job | `match_deadline_sweep._auto_confirm` trägt Ergebnis und `games` der Erstmeldung ein; Gegenseite in `lineups_missing` |
| 9 Aufstellung nachtragen | Captain/Vertreter | `PUT /matches/{id}/lineups`, bis `lineup_amend_hours` nach dem Ergebnis; danach nur Leitung |
| 10 Einspruch / Korrektur | Captain, Vertreter / Leitung | vorhandener `/dispute`; Korrektur über `/result` mit `force`, Grund und optional `games` |
| 11 Tabelle | – | `round_robin_standings(matches, registrations, rules=tournament["scoring_rules"])` |

Die App meldet heute ohne `games`: Erstmeldung → abgelehnt mit dem Satz oben; Bestätigung einer vorhandenen
Meldung mit gleichem Stand → angenommen; abweichender Stand ohne `games` → ebenfalls abgelehnt mit demselben Satz
(Einspruch über die App bleibt möglich). Aufstellungen spielen für die Tabelle keine Rolle.

## 7. Nebenwirkungen „Staffel = Turnier“ (Worker A, P1)

Gemeinsamer Baustein `services/league_scope.py`: `NOT_LEAGUE = {"league_context": None}` (Mongo, trifft „fehlt“),
`is_league_staffel(t)`, `league_label(t)`. **ausnehmen** = Filter, **kennzeichnen** = bleibt mit Hinweis „Liga · Staffel A“.

| Stelle | Datei (Funktion) | Tun |
| --- | --- | --- |
| Jahreswertung: Punkte schreiben | `routes/tournament_lifecycle_routes.py` (Hook `results_published`) | ausnehmen (nicht auf `season_weight` verlassen, s. offene Punkte) |
| Jahreswertung: Quellen, Stand, Rückfall | `routes/season_routes.py` (`_resolve_season_sources`) | ausnehmen |
| Turnierliste Web | `routes/tournament_crud_routes.py` (`list_tournaments`): neuer Parameter `league=include\|exclude\|only`, Vorgabe `include` (die App ohne Build sieht die Staffel); `TournamentsPage.jsx`, `EsportsOverviewPage.jsx`, `EventsPage.jsx` fragen `exclude`; kompakte Projektion um `league_context` | ausnehmen (Web), Karte kennzeichnen |
| Turnier-Erfolge (Pokale) | `services/awards.py` (`record_tournament_awards`, `rebuild_all_awards`, `needs_backfill`) | ausnehmen (Liga-Titel #1638 ff.) |
| Erfolge, Zähler | `services/achievement_counters.py` (`Context.tournaments`), `achievement_progress.py` | Turnierzähler ausnehmen; gespielte/gewonnene Spiele zählen weiter |
| Löwen-Rang/XP | `badges.py` (`on_tournament_completed`, `on_tournament_registered`, `on_checked_in`), `services/xp.py` | ausnehmen (Teilnahme, Podest); Spiele zählen weiter |
| Team-Stufe | `services/team_levels.py` (`compute_all_team_levels`) | ausnehmen |
| Discord | `discord_skip=true` beim Anlegen (wirkt in `discord_threads`, `discord_bracket`, `discord_scheduled`, `discord_commands`); `/turniere` sieht keine offene Anmeldung | über vorhandenen Schalter aus |
| Discord-Anmeldung, `/turniere` | `services/discord_registration.py` (`_open_tournaments`), `discord_commands.py` (`answer_turniere`) | zusätzlich ausnehmen (falls jemand eine Staffel auf „Anmeldung offen“ stellt) |
| Stream-Meldung | `services/tournament_streams.py` (`sync`) | ausnehmen |
| Startseite | `routes/home_routes.py` (`home_state` live/heute/bald/demnächst, `_club_numbers`, `_about_games`) | ausnehmen |
| Kalender öffentlich + Discord-Termine | `services/calendar_items.py` (`collect`) | ausnehmen; persönlicher Kalender (`personal_calendar.py`) behalten |
| App-Startseite | `routes/mobile_routes.py` (`_public_upcoming`) | ausnehmen |
| Profil Person | `routes/user_routes.py` (`get_public_profile`): Liste kennzeichnen, Zahlen Turniere/Siege/Top 3 ausnehmen; `services/profile_references.py` | kennzeichnen |
| Teamseite | `services/team_page.py` (`team_overview`), `routes/team_routes.py` (`get_team` Pokale) | kennzeichnen; P5 zeigt Co-Team mit Staffel |
| Jahresrückblick | `services/year_review.py` | ausnehmen |
| Sponsoring-Zahlen | `routes/sponsoring_routes.py` | ausnehmen |
| Suche, SEO-Titel | `routes/search_routes.py`, `routes/seo_render_routes.py` | kennzeichnen |
| Unverändert | `sitemap`, `prize_service`, `registration_notifications`, `tournament_reminders`, TV, Admin-Zahlen, `dolibarr_participations` (offen) | – |

## 8. Dateigrenzen

| Datei / Bereich | A | B |
| --- | --- | --- |
| neu `services/league_service.py`, `services/league_scope.py`, `routes/league_routes.py` (Admin + öffentliche Lese-API), Eintrag in `server.py` | ✔ | |
| `services/custom_bracket.py`, `advancement_draw.py`, `matchday_schedule.py` (inkl. Helfer `blocked_period_at`), `match_deadlines.py`, `match_disputes.py`, `match_scheduler.py`, `competition_standings.py`, `scoring_rules.py`, `map_pools.py` | ✔ | |
| alle Dateien aus Abschnitt 7, `tournament_crud_routes.py`, `tournament_lifecycle_routes.py`, `personal_data.py`, `PUBLIC_ROUTE_INVENTORY.md` | ✔ | |
| Frontend: `App.jsx`, Navigation, `pages/public/League*`, `pages/admin/league/*`, Listen-Seiten, `TournamentCard.jsx`, `StandingsTable.jsx`, `TournamentStandingsPage.jsx`, `TournamentSchedulePage.jsx`, öffentliche Teamseite (`TeamsPage.jsx`, `pages/public/team/*`, `lib/teamPage.js`) | ✔ | |
| `services/match_audience.py`, `team_lineup.py`, `v2_match_flows.py`, `v2_result_submission.py`, `match_v2_results.py`, `match_deadline_sweep.py`, neu `services/league_games.py`, `services/squad_registration.py` | | ✔ |
| `routes/team_routes.py` (Co-Team-Modelle, Rollen), `team_day_routes.py`, `tournament_registration_routes.py` (Zuteilen: `POST /api/tournaments/{tid}/squad-registrations`), `match_routes.py` (Melden, Nachtrag, Sperrzeit-Aufruf) | | ✔ |
| Frontend: `MatchReportForm.jsx`, `MatchPage.jsx`, neu `components/tls/league/*` (Maps/Aufstellung), `pages/user/profile/TeamsPanel.jsx` (Captain/Vertreter), `AdminTournamentEditPage.jsx` (Dialog „Co-Team zuteilen“), `docs/ROLLEN.md` | | ✔ |
| `backend/models.py` | Abschnitt Tournaments (`TournamentCreate`/`Update`) + neuer Block am Dateiende `# ---------- Liga (docs/LIGA.md) ----------` | nur Abschnitt Matches (`MatchGameReport`, `MatchScoreReport.games`, `MatchV2ResultSubmit.games`, `MatchLineupAmend`) |
| `backend/database.py` (`init_indexes`) | Block `# Liga Stufe 1 – Rahmen (A)` am Ende von `init_indexes` | Block `# Liga Stufe 1 – Co-Teams und Spiele (B)` direkt nach `# Registrations` |
| Tests | neue `tests/test_league_*.py`; bestehende Tests der eigenen Dateien | neue `tests/test_squad_*.py`, `test_league_games*.py`; Regressionstests Team-Turniere |
| `docs/LIGA.md` | Eigentümer | Änderungswunsch als eigener Commit, A zieht nach |
| `mobile/` | – | – (kein neuer Build) |

Abhängigkeit: Der Sperrzeit-Aufruf in `match_routes.py` (B) nutzt `matchday_schedule.blocked_period_at(tournament,
moment)` (A, P2). Bis P2 auf `main` ist, bleibt der Aufruf aus.

## 9. Nicht in Stufe 1

| Thema | Issue / Folgepaket |
| --- | --- |
| Erinnerungen 24 h/1 h, Termin offen, Ergebnis fehlt | #1647 – erstes Folgepaket |
| Auf-/Abstieg, Saisonabschluss, Meister, Zonen, Final-Snapshots | #1627, #1645, Rest von #1625 – bis ca. Woche 8 |
| Map-Veto live, Ready-Check | #1618, #1651, #1652 |
| Los mit Vorschau, Planhash/Preview-Apply | #1623 (voll), #1622 |
| Zusammenlegen unterbesetzter Ligen | #1628 |
| Abzeichen, Momente, Rückblick, „spielte in“ im Profil | #1630, #1638 ff. (Daten liegen ab Stufe 1 in `games[].lineups`) |
| Versioniertes Regelwerk | #1646 (Stufe 1: `rules_text`) |
| Gastteams anderer Vereine | #1665 (ab Season 2) |
| Solo-Ligen (`participant_kind="solo"`) | #1629 |
| Direkter Vergleich als Gleichstandsregel | #1559 |
| Discord-Meldungen der Liga (Spieltag, Saisonende) | eigenes Folgepaket |
| Map-Pool je Liga N, Statistik je Map/Spieler | später |

## 10. Sichtbarkeit, Schalter, Migration

- **Schalter ist die Season-Sichtbarkeit** (Vorgabe `off`), kein globaler Schalter. Die Navigation zeigt „Liga“ nur,
  wenn die öffentliche Lese-API für die Person mindestens eine Season liefert.
- **APIs (P1):** Verwaltung `/api/admin/leagues` (`require_area("tournaments")`): `GET ""` (Ligen mit Seasons, Spiele,
  Vorgaben), `POST ""`, `PATCH /{league_id}`, `POST /{league_id}/seasons`, `GET|PATCH /seasons/{id}` (mit Kalender,
  Map-Pool, Liga N samt Staffeln), `PUT|DELETE /seasons/{id}/map-pool`, `POST /seasons/{id}/sync`,
  `POST /seasons/{id}/divisions`, `PATCH /divisions/{id}`, `POST /divisions/{id}/staffeln`. Öffentlich `GET /api/leagues`
  und `GET /api/leagues/{liga}/{season}` – auch die Turnierleitung bekommt dort bei `off` ein 404 (sie sieht die Season
  in der Verwaltung). Gelesene Turniere tragen bei Staffeln `league_label` („Liga · Staffel A“, Turnierliste, Profil,
  Teamseite).

| `league_seasons.visibility` | Ligaseite | Staffel-Turniere (`visibility`, `is_public`) |
| --- | --- | --- |
| `off` | 404 | `internal`, `false`, Status bleibt `draft` |
| `admins` | nur Turnierleitung | `internal`, `false` |
| `members` | wie Turnier-Sichtbarkeit `members` | `members`, `true` |
| `public` | alle | `public`, `true` |

- **Migration:** keine. Nur neue Sammlungen und optionale Felder, Indizes in `init_indexes`. Ohne die Felder
  verhalten sich Turniere, Anmeldungen, Co-Teams, Spiele und Tabellen genau wie vorher (Regressionstests:
  Liga-Turnier mit Hin/Rück, Gruppen, Team-Turnier mit Aufstellung #1192, App-Meldung ohne `games`).
- **Rückweg:** Season auf `off` stellt alles unsichtbar; die Felder bleiben ungenutzt liegen.

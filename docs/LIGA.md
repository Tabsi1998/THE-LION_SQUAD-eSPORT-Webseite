# Liga

Abschnitte 1 bis 11 beschreiben die gebaute **Stufe 1**. Abschnitt 12 ist der Vertrag für den **Ausbau** (Epic #2211).
Beispielwerte in Stufe 1 (Start 10.11., zehn Wochen, Best of 3, acht Teams, 3/1/0) sind Vorgaben von damals, keine festen
Regeln: Jede Season stellt sie selbst ein.

Stand Stufe 1: 28.10.2026, verbindlicher Vertrag für die Pakete P1–P6 des Epics #1621 (Entscheidungen 15.10. und 27.10.).
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
| `published_at` | ISO | nein | erste Sichtbarkeit einer Season (#2106); ab dann bleibt `slug` |
| `emblem_url`, `banner_url`, `banner_focus`, `accent_color` | str / dict / str | nein | Gestaltung (#2107, Abschnitt 11) |

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
| `map_repeat` | `"never"` \| `"other_mode"` \| `"always"` | ja | `"other_mode"`: dieselbe Map in einer Serie nur in einem anderen Modus (#2096); `"never"` jede Map einmal, `"always"` frei |
| `pool_min_maps` | `[{mode, min_maps}]` | nein | fehlt = abgeleitet aus Reihenfolge, Best of und `map_repeat` (C.2, Abschnitt 12) |
| `scoring_rules` | dict | ja | neue Seasons `league_default_rules()` aus `services/scoring_rules.py`; gelesen werden `match_points` und `table_tiebreakers`, seit E.1 auch `head_to_head_criteria`, `allow_draws`, `forfeit_score`, `exit_rule` (Abschnitt 12) |
| `result_confirm_hours` | int 1–336 | ja | 48 |
| `lineup_amend_hours` | int 1–336 | ja | 48 – Nachtragsfrist der eigenen Aufstellung nach dem Ergebnis |
| `match_schedule_response_hours` | int 1–720 | nein | 72 – Antwortfrist auf Terminvorschläge (#2106, F3); fehlt (Seasons von vorher) = jede Staffel behält ihre |
| `rules_text` | str (Markdown) | nein | Regeltext der Season (Textfeld, #1646 später) |
| `registration_deadline` | Kalendertag | nein | Meldeschluss, nur Anzeige (Season 1: 6.11.) |
| `visibility` | `"off"` \| `"admins"` \| `"members"` \| `"public"` | ja | **`off`** |
| `status` | `"draft"` \| `"active"` \| `"completed"` \| `"archived"` | ja | `draft` |
| `emblem_url`, `banner_url`, `banner_focus` | str / dict | nein | überschreiben die der Liga (#2107, Abschnitt 11) |
| `prizes` | `[{place, text, image_url}]` | nein | Gewinne der Season (#2107) - reine Anzeige |

Map-Pool der Season: in `map_pools` mit neuem Scope **`league_season`** (`scope_id` = Season-ID), gleiche Versionen
und Prüfungen wie heute (`services/map_pools.py`, `SCOPES` um `league_season` ergänzen).
Indizes: `id` eindeutig, (`league_id`, `number`) eindeutig, (`league_id`, `slug`) eindeutig, `status`.

### `league_divisions` (neu, Worker A)

| Feld | Typ | Pflicht | Vorgabe / Bedeutung |
| --- | --- | --- | --- |
| `league_id`, `season_id` | str | ja | |
| `level` | int ≥ 1 | ja | „Liga N“; (`league_id`, `level`) ist die dauerhafte Stufe über Seasons |
| `nickname` | str ≤ 40 | nein | Beiname: Anzeige „Liga 1 · Elite“ |
| `overrides` | dict | nein | Abweichung von der Season nur für `best_of`, `team_size`, `min_squad_size`, `max_staffel_size`, `scoring_rules`, `match_schedule_response_hours` |
| `status` | `"active"` \| `"archived"` | ja | `active` |
| `prizes` | `[{place, text, image_url}]` | nein | eigene Gewinne (#2107); fehlt = die der Season |

Indizes: `id` eindeutig, (`season_id`, `level`) eindeutig.

### Staffel-Turnier: neue Felder an `tournaments` (Worker A)

| Feld | Typ | Pflicht | Bedeutung, Verhalten ohne Feld |
| --- | --- | --- | --- |
| `league_context` | `{league_id, season_id, division_id, staffel}` | nein | `staffel` = „A“, „B“ …; **fehlt bei allen anderen Turnieren** (nie `null` schreiben). Nur der Liga-Service setzt es, `TournamentUpdate` nimmt es nicht an |
| `round_robin_legs` | 1 \| 2 | nein | fehlt = 2 (Hin- und Rückrunde wie heute) |
| `matchday_blocked_weeks` | `[int]` | nein | gesperrte Kalenderwochen ab `start_date` (1-basiert); fehlt = `[]`. Gesperrt ist eine Woche, wenn mehr als die Hälfte ihrer Tage in einer Sperrzeit liegt (Season 1: Wochen 7 und 8; der Montag 21.12. allein sperrt Woche 6 nicht) |
| `blocked_periods` | `[{start_date, end_date, label}]` | nein | Kopie der Sperrzeiten der Season (Wiener Kalendertage); für `blocked_period_at` und Fristen; fehlt = keine |
| `matchday_weeks_total` | int | nein | Wochenbudget für „Runden ≤ aktive Wochen“; fehlt = keine Prüfung |
| `scoring_rules` | dict | nein | normalisiert; fehlt = heute fest 3/1/0 mit Reihenfolge Punkte, Siege, Differenz |
| `game_mode_order` | `[str]` | nein | fehlt = frei |
| `map_repeat` | str | nein | fehlt = `"other_mode"` |
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

### Liga-Kader: Spiel-ID je Season (`league_rosters`, #2108)

Liga-Spieler brauchen die Pflicht-IDs des Spiels aus dem Profil (z. B. Activision-ID inklusive `#`). Wie im Profil
und bei der Turnieranmeldung gilt die ID des Hauptspiels für seine Versionen (`tournament_common._enrich_game_identity`,
`_required_game_fields`, `_profile_player_ids`). Spiele ohne Pflicht-ID berühren nichts davon.

| Feld | Typ | Bedeutung |
| --- | --- | --- |
| `season_id`, `user_id` | str | ein Eintrag je Person und Season (eindeutig); Index `user_id` |
| `league_id`, `game_id` | str | zur Einordnung |
| `player_ids` | `{key: Wert}` | nur die Pflicht-IDs, die in der Season gelten; leer = noch keine festgehalten |
| `id_text` | str | Anzeige, z. B. „Testloewe#1234567“ |
| `locked_at`, `locked_via`, `locked_by` | | wann und wodurch festgehalten: `assign`, `squad_join`, `lineup`, `approval`, `backfill` |
| `added_at`, `added_via`, `added_by` | | wann die Person in den Kader kam |
| `squad_ids` | `[str]` | Co-Teams, mit denen die Person in der Season im Kader stand |
| `late_squad_ids` | `[str]` | Co-Teams, in die sie nach dem Stichtag kam – dort wartet sie auf Freigabe |
| `approvals` | `[{at, by, reason, old_text, new_text, was}]` | Protokoll der Freigaben durch die Liga-Leitung |

Season-Feld `league_seasons.roster_deadline` (Wiener Kalendertag, optional, Vorgabe: keiner): Stichtag für neue
Spieler. Gesetzt in der Kaderübersicht der Season (`PUT /api/admin/leagues/seasons/{id}/roster-settings`), nicht im
Season-Formular; der Turnierkern liest es nicht.

Ablauf (`services/league_roster.py`):

- **Zuteilen** eines Co-Teams: jedes Mitglied bekommt einen Eintrag; mit vollständiger ID im Profil wird sie
  festgehalten. Fehlt sie, steht der Eintrag leer, Spieler und Verantwortliche des Co-Teams bekommen eine Nachricht
  (Art `tournament_registration`); der Dialog warnt vorab mit Namen. Zuteilen geht trotzdem.
- **Aufnahme** in ein zugeteiltes Co-Team einer laufenden Staffel (`PATCH /api/teams/{id}/squads/{id}`): ebenso, auch
  die Nachricht an Spieler und Verantwortliche – je Person einmal, ebenso für „wartet auf Freigabe“ (#2202).
  Der **Stichtag gilt je Co-Team**: wer danach in ein Co-Team kommt, in dem er in der Season noch nicht stand, wartet
  dort auf Freigabe (`late_squad_ids`) – auch mit schon festgehaltener ID aus einem anderen Co-Team; die ID bleibt
  dieselbe, im bisherigen Co-Team spielt er weiter. Der Wiedereintritt ins selbe Co-Team ist nicht „spät“; das
  Zuteilen eines Co-Teams durch die Leitung hebt es für dieses Co-Team auf.
- **Erstes Aufstellen**: wer die ID erst später eingetragen hat, bekommt sie festgehalten, sobald die Aufstellung
  gespeichert ist (Meldung, gehaltenes oder geschriebenes Ergebnis der Turnierleitung, Nachtrag) – nur, solange noch
  keine festgehalten ist (`locked_at: null`); zwei gleichzeitige Meldungen überschreiben sich nicht.
- **Nachzug** (Migration 17 `league_roster_backfill`, idempotent): Co-Teams, die vor dem Kader zugeteilt wurden,
  bekommen ihre Einträge mit Co-Team (und festgehaltener ID, wo sie im Profil steht).
- **Altbestand bei Korrekturen:** Wer auf einer Map schon in der gespeicherten Aufstellung der Seite steht (Maps des
  Spiels, letzte Meldung je Seite, gehaltenes Ergebnis), bleibt aufstellbar – Korrektur und Nachtrag scheitern nicht
  an ihm. Neu aufstellen lässt sich auf dieser Map nur, wer eine gültige ID hat.
- Danach gilt die festgehaltene ID die ganze Season – Matchseite, Ergebnis-Fenster, Lobby. Eine **neue ID** gilt erst
  nach der Freigabe der Liga-Leitung (`POST /api/admin/leagues/seasons/{id}/roster/{user_id}/approve` mit Grund ≥ 5
  Zeichen; übernimmt die aktuelle ID aus dem Profil; Protokoll in `approvals` und `audit_logs`).
- Stand je Person (`league_roster.status`): `locked` (festgehalten), `pending` (im Profil, wird beim ersten Aufstellen
  festgehalten), `missing` (fehlt), `late` (wartet im Co-Team der Seite auf Freigabe), `banned` (Konto gesperrt, geht
  jedem anderen Stand vor, auch bei Spielen ohne Pflicht-ID; #2202), `free` (Spiel ohne Pflicht-ID). Aufstellbar sind
  `locked`, `pending` und `free`. Die Freigabe hebt jedes „spät“ auf, nie die Sperre.
- **Sichtbarkeit:** die IDs der Spieler stehen im Block `league` der Matchseite (`roster[].game_id_text`,
  `lobby_ids`) nur für Beteiligte des Spiels und die Turnierleitung – wie Aufstellungen. Die eigene ID je laufender
  Season steht unter `GET /api/me/league-ids` (Hinweis im Profil). Die Kaderübersicht
  (`GET /api/admin/leagues/seasons/{id}/roster`) sieht nur, wer das Liga-Recht „Kader prüfen“ hat.
- **Datenschutz:** Die Auskunft enthält `league_rosters`; das Löschen des Kontos löscht die Einträge
  (`account_erasure.PURGED`) – Aufstellungen und Ergebnisse bleiben ohne sie.

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
`match.lineup.amend`, `match.games.correct` (B) · `league.delete`, `league.season.delete`, `league.division.delete`,
`league.staffel.delete` (#2106, mit `reason` und den Kennungen dessen, was mitging) · `league.roster.approve` (neue
Spiel-ID freigegeben, mit Grund, ohne die ID selbst), `league.season.roster_deadline` (#2108) · `league.season.status`
(Season folgt dem Start der ersten Staffel), `match.plan.change` (Termin, Best of je Spiel mit `from`/`to`),
`match.no_show.cleared` (alter Vorschlag abgeräumt) (#2201) · `match.lineup.both_sides_kept` (Korrektur oder Nachtrag ließ
Altbestand auf beiden Seiten durch, nur mit `match_id` und Anzahl, ohne Personen; #2202).

## 3. Einstellbar statt fest

| Wert | Ebene | Vorgabe |
| --- | --- | --- |
| Wochen gesamt, Sperrzeiten, Spielwoche, Standardtag/-zeit | Season | 10 · keine · 7 Tage · So 20:00 |
| Runden (1 = Hinrunde, 2 = Hin/Rück) | Season | 1 |
| Staffelgröße max., Best of, Teamgröße, Mindestkader | Season, Liga N überschreibt | 8 · 3 · 4 · 4 |
| Punkte Sieg/Remis/Niederlage, Gleichstand, Remis, Default-Win, Ausscheiden (E.1) | Season (`scoring_rules`), Liga N überschreibt | neue Seasons 3/0/0 · direkter Vergleich, Differenz, Maps, Leitung · kein Remis · Best of · alle Spiele für die Gegner (ältere: 3/1/0 · `score_diff`, `score_for`) |
| Modus je Position | Season | frei |
| Bestätigungsfrist, Aufstellungs-Nachtrag | Season | 48 h · 48 h |
| Antwortfrist auf Terminvorschläge (#2106) | Season, Liga N überschreibt | 72 h |
| Map-Pool | Season (`league_season`) | keiner = keine Liga-Meldung möglich |
| Ergebnisregel je Modus, Punkte je Map Pflicht (C.3) | Season (`result_rules`, `scores_required`) | Kopie der Modi · an (nur neue Seasons) |
| Regeltext, Meldeschluss, Sichtbarkeit | Season | leer · leer · aus |
| Selbstanmeldung: Fenster, Startplätze, Warteliste, Zulassung, zwei Co-Teams, Datenschutz-Hinweis (#2205, Abschnitt 12) | Season | keine · keine · an · alle Konten · nein · Platzhalter |

Season-Änderungen wirken erst über „Vorgaben auf Staffeln übertragen“ (`league.staffel.sync`, A): Termine und
Kalender nur vor dem Start, Best of/Teamgröße/Punkte nur vor dem ersten Ergebnis, Sichtbarkeit und Regeltext immer.
Ausnahme: die **Sichtbarkeit** (`visibility`, `is_public`) schreibt schon das Speichern der Season auf alle ihre
Staffeln, auch gesperrte („aus“ heißt sofort aus).
Genau (`services/league_service.SYNC_GROUPS`): **immer** (auch gesperrte Staffeln) `visibility`, `is_public`, `rules`
und der Map-Pool (neue Version im Scope `tournament`, nur wenn er sich unterscheidet – Spiele mit festgehaltenem Pool
behalten ihren; hat die Season keinen Pool mehr, wird die Kopie nur vor dem ersten Ergebnis entfernt);
**laufend** (auch nach Start und Ergebnis, nicht bei gesperrten Staffeln) `match_schedule_response_hours` – sie gilt nur
für neue Terminvorschläge; trägt weder Season noch Liga N den Wert (Seasons von vor #2106), bleibt der der Staffel;
**vor dem Start** (Status `draft` bis `check_in`) `start_date`, `end_date`, `matchday_days`, `default_match_weekday`,
`default_match_time`, `round_robin_legs`, `matchday_blocked_weeks`, `matchday_weeks_total`, `max_participants` – nur
wenn die Prüfung „Runden ≤ aktive Wochen“ passt und nicht schon mehr Teams angemeldet sind; **vor dem ersten Ergebnis**
`best_of`, `team_size`, `min_squad_size` (immer gemeinsam mit `team_size`), `scoring_rules`, `game_mode_order`, `map_repeat`,
`result_confirm_hours_league`, `lineup_amend_hours`. `min_squad_size` steht damit am Turnier (Season bzw. Liga N, mindestens `team_size`); B liest es
beim Zuteilen dort.

**In der Staffel nur lesend (#2109):** Die Turnierverwaltung einer Staffel zeigt die Season-Werte (Spiel, Start/Ende,
Spielwoche und Standardtermin, Teamgröße, Staffelgröße, Best of, Bestätigungsfrist, Sichtbarkeit, Regeltext, Map-Pool)
nur zum Lesen mit „kommt aus der Season“ und einem Link zur Season; was es in der Liga nicht gibt (Anmeldung, Check-in,
Discord, Preise, Jahreswertung, Seeding, Weiterkommen, Vor Ort), fehlt. `update_tournament` lehnt Änderungen daran ab
(`services/staffel_guard.STAFFEL_LOCKED_FIELDS`, Meldung „Kommt aus der Season – dort ändern und übertragen.“ bzw.
„Gibt es in einer Liga-Staffel nicht.“/„Steht bei einer Liga-Staffel fest.“; derselbe Wert stört nicht). Das
Übertragen (`sync_staffel`, `apply_visibility`) schreibt direkt und bleibt davon unberührt. Seit #2106 kommt auch die
**Antwortfrist auf Terminvorschläge** (`match_schedule_response_hours`) aus der Season und ist in der Staffel gesperrt. Dazu:
`POST /status` kennt für Staffeln nur Entwurf, Live, Pausiert, Beendet, Ergebnisse veröffentlicht, Archiviert und
Abgesagt; `POST /registrations` (Turnierleitung) nimmt keine Teilnehmer an - nur „Co-Team zuteilen“; Löschen geht nur
vor dem Start ohne festen Spielplan, danach „Abgesagt“ oder „Archiviert“. Für alle Turniere gilt: `status` per PATCH
nur, wenn er sich nicht ändert - der Status wechselt über `POST /status` (Ablauf mit Prüfungen und Protokoll).

**Korrigieren, archivieren, löschen (#2106):** Eine Liga ändert Name, Beschreibung und Stand jederzeit; das Spiel nur,
solange keine Season eine Staffel hat (beim Wechsel leert der Server `game_mode_order` der Seasons, der Map-Pool gilt
danach als „anderes Spiel“); die Adresse (`slug`) nur vor der ersten Veröffentlichung (`published_at` oder eine Season
mit Sichtbarkeit ≠ `off`). Liga, Season und Liga N lassen sich löschen, wenn jede Staffel darunter eine **leere
Entwurfs-Staffel** ist (`staffel_guard.staffel_cascade_problem`: die Löschsperre `staffel_delete_problem` und kein
zugeteiltes Co-Team) und jede betroffene Season noch `draft` ist; die leeren Staffeln (samt Phasen, Vorschau-Spielen,
Map-Pool-Kopien) gehen mit, ebenso der Map-Pool der Season. Sonst antwortet der Server 409 „Löschen geht nicht: … Archivieren
statt löschen“; `GET …/delete-plan` liefert vorher Auflistung und Gründe. Eine Staffel allein löscht die Season-Seite mit
derselben Sperre wie die Turnierverwaltung (`staffel_delete_problem`). Löschen verlangt einen Grund (mindestens fünf
Zeichen), der im Protokoll steht. `delete_tree` arbeitet alles oder nichts: erst die Schreibsperren aller Staffeln
(ist eine belegt: 409, nichts gelöscht), dann unter allen Sperren neu prüfen, dann löschen; jede Staffel steht einzeln
als `league.staffel.delete` (mit `with`/`with_id`) im Protokoll. Kommt beim Löschen der Staffeln gleichzeitig eine
Staffel, Liga N oder Season dazu, bricht es danach mit 409 ab und lässt alles darüber stehen. Migration 16
(`league_published_at`) trägt `published_at` für Ligen nach, deren Season sichtbar ist oder nicht mehr Entwurf.

## 4. Rechte

Angelehnt an `services/match_audience.py` (Verantwortliche/Spieler) und `services/league_permissions.py` (Bereich Ligen und
Zuständige, seit #2203, Rechte-Matrix in Abschnitt 12). Die Spalte „Liga-Recht“ heißt: Bereich `leagues` oder die passende
Zuständigkeit dieser Liga, beides mit Zwei-Faktor. Der Bereich `tournaments` gibt in Staffeln nichts mehr.

| Aktion | Liga-Recht | Hauptteam-Leitung (Leitung, Co-Leitung) | Captain | Vertreter | Mitglied Co-Team |
| --- | --- | --- | --- | --- | --- |
| Liga, Season, Liga N, Staffel anlegen/ändern, Spielplan, Start | ja | – | – | – | – |
| Co-Team zuteilen/entfernen | ja | – | – | – | – |
| Spiel-ID freigeben, Stichtag für neue Spieler (#2108) | ja | – | – | – | – |
| Co-Team-Kader, Captain/Vertreter, Status, Löschen, solange es in einer nicht beendeten Staffel spielt (mit Protokoll) | `roster` | ja | – | – | – |
| Eigene Rolle abgeben (`PUT …/roles` nur mit dem eigenen Feld auf `null`, #2110) | – | – | ja | ja | – |
| Termin vorschlagen/annehmen | ja | nur Fallback¹ | ja | ja | – |
| Ergebnis melden, bestätigen, Einspruch | ja | nur Fallback¹ | ja | ja | – |
| Eigene Aufstellung nachtragen (bis `lineup_amend_hours`) | jederzeit, mit Grund | nur Fallback¹ | ja | ja | – |
| Ergebnis/Maps korrigieren (`force` + Grund) | ja | – | – | – | – |
| Matchchat, Spiel-Hinweise | ja | ja | ja | ja | ja |
| Ligaseite lesen | immer | nach Sichtbarkeit | nach Sichtbarkeit | nach Sichtbarkeit | nach Sichtbarkeit |

¹ Hat ein Co-Team weder Captain noch Vertreter, handelt die Hauptteam-Leitung (niemand sperrt sich aus). Ein gesperrtes
Konto zählt nicht als Captain oder Vertreter (#2202).
Umsetzung B: Für Anmeldungen mit `squad_id` gilt in `match_audience` – Verantwortliche = `captain_id`,
`vice_captain_id` (sonst Leitung und Co-Leitung des Hauptteams); Spieler = `member_ids` des Co-Teams plus
Verantwortliche plus Leitung und Co-Leitung des Hauptteams (Zeile „Matchchat, Spiel-Hinweise“), nicht die übrigen
Mitglieder des Hauptteams; im Matchchat schreibt der ganze Kader des Co-Teams; `responsible_registration` findet
Anmeldungen auch über Co-Teams, deren Captain/Vertreter man ist. Aufrufer mit eigener Projektion der Anmeldung lesen
`squad_id` mit. Anmeldungen ohne `squad_id` behalten exakt das heutige Verhalten (Regressionstests Pflicht).

## 5. Regeln und Prüfungen (Server, mit deutscher Meldung)

| Regel | Wann | Wer |
| --- | --- | --- |
| Co-Team gehört zum Hauptteam (`team_squads.team_id`), ist `active`, `game_id` gehört zum Spiel der Liga: Hauptspiel und Versionen zählen zusammen (ohne `game_id` am Co-Team: passt; `game_id` prüft der Server gegen `games`, in laufender Staffel nur innerhalb des Hauptspiels änderbar, #2128) | Zuteilen | B |
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
| Map-Wiederholung nach `map_repeat` (Vorgabe: dieselbe Map im selben Modus nur einmal je Serie) | Melden, Korrektur | P6 |
| Aufstellung: genau `team_size` verschiedene Mitglieder des eigenen Co-Teams je Map | Melden, Nachtrag | B |
| Aufstellung: nur mit gültiger Spiel-ID der Season (festgehalten oder im Profil; nicht „wartet auf Freigabe“), sonst 422 „… kann nicht aufgestellt werden – …“ – auch für die Turnierleitung (#2108) | Melden, Nachtrag, Ergebnis | B |
| Aufstellung: kein gesperrtes Konto, sonst 422 „… kann nicht aufgestellt werden – Das Konto ist gesperrt.“ – auch für die Turnierleitung, Altbestand wie bei der Spiel-ID (#2202) | Melden, Nachtrag, Ergebnis | A.4 |
| Dieselbe Person nie auf beiden Seiten desselben Spiels, über alle Maps, sonst 422; wer am Spiel schon auf beiden Seiten steht, hält keine Korrektur auf (#2202) | Melden, Bestätigen, Nachtrag, Ergebnis | A.4 |
| Kein Doppel-Einsatz: dieselbe Person nicht in Aufstellungen zweier Anmeldungen am selben Spieltag (`matchday_number_of`) in Staffeln derselben `league_context.season_id` | Melden, Nachtrag | B |
| Bestätigung mit anderen Maps/Modi/Siegern als die Erstmeldung → 409 mit Hinweis auf Einspruch | Bestätigen | B |

## 6. Abläufe

| Schritt | Wer | Was technisch passiert |
| --- | --- | --- |
| 1 Liga, Season, Liga N anlegen | Leitung | `leagues`, `league_seasons`, `league_divisions`; Pool im Scope `league_season` |
| 2 Staffel anlegen | Leitung | Turnier mit `league_context` und Vorgaben, Status `draft`, Prüfung Runden ≤ Wochen |
| 3 Co-Teams zuteilen (bis Meldeschluss) | Leitung | Anmeldung mit `squad_id` je Co-Team (Admin-Dialog „Co-Team zuteilen“) |
| 4 Spielplan und Start (9./10.11.) | Leitung | vorhandenes Erzeugen der Phase (`_auto_league_schema` mit `round_robin_legs`), Status `live` |
| 5 Termin | Captain/Vertreter | vorhandene Terminvorschläge; ohne Einigung Standardtermin der Woche (Sperrwochen übersprungen). Jede Aktion (vorschlagen, Gegenvorschlag, annehmen, ablehnen, zurückziehen – `action: "withdraw"` nur für die eigene Seite) erreicht die Verantwortlichen der anderen Seite (`match_notifications.notify_schedule_event`, Art `match_schedule`); offene Vorschläge der Gegenseite stehen als Aufgabe „Terminvorschlag beantworten“ auf der Startseite (#2110) |
| 6 Melden | Captain/Vertreter Seite 1, **Web** | `POST /matches/{id}/report` mit `results` + `games` (Maps, Sieger, eigene Aufstellung) |
| 7 Bestätigen + ergänzen | Captain/Vertreter Seite 2 | Web: gleiche `results`, eigene Aufstellung je Map → Konsens, `games` am Spiel. **App** (ohne neuen Build): gleiche `results` ohne `games` → Konsens zählt, Seite 2 landet in `lineups_missing` und bekommt die Nachricht „Bitte Aufstellung im Web nachtragen“ |
| 8 48 h ohne Antwort | Fristen-Job | `match_deadline_sweep._auto_confirm` trägt Ergebnis und `games` der Erstmeldung ein; Gegenseite in `lineups_missing`. In einer Sperrzeit läuft keine Frist: `match_deadlines.auto_confirm_due` rechnet die 48 h und die 24 h Mindestzeit mit `response_deadline` (Pause zählt nicht) – ohne Sperrzeiten exakt wie bisher. Ebenso Antwortfrist und Eskalation offener Terminvorschläge |
| 9 Aufstellung nachtragen | Captain/Vertreter | `PUT /matches/{id}/lineups`, bis `lineup_amend_hours` nach dem Ergebnis; danach nur Leitung. Bis zur Frist Aufgabe „Aufstellung nachtragen“ auf der Startseite (`match_overview.own_match_tasks`, Art `match_lineup`), danach auf der Matchseite der Hinweis auf @leitung im Matchchat (#2110) |
| 10 Einspruch / Korrektur | Captain, Vertreter / Leitung | vorhandener `/dispute`; Korrektur über `/result` mit `force`, Grund und optional `games` |
| 11 Tabelle | – | `round_robin_standings(matches, registrations, rules=tournament["scoring_rules"])` |

Die App meldet heute ohne `games`: Erstmeldung → abgelehnt mit dem Satz oben; Bestätigung einer vorhandenen
Meldung mit gleichem Stand → angenommen; abweichender Stand ohne `games` → ebenfalls abgelehnt mit demselben Satz
(Einspruch über die App bleibt möglich). Aufstellungen spielen für die Tabelle keine Rolle.

### Spielbetrieb (#2201, Paket A.3)

| Thema | Vertrag | Stelle |
| --- | --- | --- |
| „Nicht erschienen?“ | Staffeln ohne Check-in haben keine Frist und keinen Vorschlag, alte offene Vorschläge räumt der Fristen-Job ab, entschiedene bleiben. „Ergebnis fehlt“ bleibt. `POST /lead/no-show/{match}` mit `confirm` gilt in Staffeln auch ohne Vorschlag, solange `no_show_open` (keine Meldung, nicht begonnen). Endgültig mit dem Check-in (#1652) | `match_deadlines.no_show_deadline`, `match_deadline_sweep`, `tournament_lead_routes` |
| Karte | Mit einer Meldung gibt es in keinem Format mehr die Karte „Nicht erschienen?“ | `match_attention.attention_items` |
| Kampflos in den Strafen | Teamstrafe des Co-Teams: Captain, Vertreter, Leitung und Co-Leitung des Hauptteams (`match_audience.team_penalty_ids`), nicht der Kader. Admin-Liste einmal je Wertung mit `team_name`. Kein persönlicher Negativ-Eintrag | `penalty_routes` |
| Maps bei Wertung | `apply_forfeit` setzt `games` und `lineups_missing` leer, wenn das Spiel Maps hat; `match_reports_v2.previous_games` hält sie fest | `match_forfeit` |
| Einspruchsfenster | Spielwoche mit Sperrwochen und Sperrzeiten, Turnier vollständig gelesen | `match_disputes.dispute_window` |
| Antwortfrist | Vorschlag und Gegenvorschlag rechnen immer neu (`settings.schedule_deadline_at` in der Zukunft geht vor), Annahme löscht Frist und `schedule_escalated_at`, je abgelaufener Frist eine Nachricht | `match_routes._schedule_deadline` |
| Ablehnung | Nur in Spielwochen: offener anderer Vorschlag → `proposed`; angenommener → `accepted`; sonst ohne Stand und Frist, solange ein Termin gilt; ohne Termin `declined` mit Frist. Altbestand räumt `_settle_declined` im Spieltag-Lauf ab | `match_routes._status_after_decline`, `matchday_schedule` |
| Änderung durch die Leitung | `PATCH /matches/{id}`: `scheduled_at` und `best_of` immer im Protokoll; Nachricht (`match_schedule`, Grund `schedule_lead_changed`) nur in Spielwochen an die Verantwortlichen beider Seiten | `match_routes._record_plan_change`, `match_notifications.notify_lead_plan_change` |
| Spielplan | `DELETE /stages/{id}` und `POST /stages/{id}/generate` fallen nach dem Start unter `staffel_rebuild_problem`, auch mit `force` | `tournament_stage_routes` |
| Season-Stand | Start der ersten Staffel: `draft` → `active`, nur aus dem Entwurf und nur, wenn keine andere Staffel gestartet ist | `league_service.season_follows_first_staffel` |
| Staffelgröße | Schätzung für Format `league` mit `round_robin_legs`: n·(n−1)/2·Runden statt Zweierpotenz | `tournament_common._estimated_match_count` |
| Standardtermin | Nie in einer Sperrzeit: nächster freier Tag der Woche zur selben Uhrzeit, sonst der letzte davor, sonst kein Termin und `schedule_hint` im Plan | `matchday_schedule.default_time_for` |
| Anmeldung, Spiel-Antworten | Eine Staffel hat auf keinem Weg eine Selbstanmeldung (die läuft seit B.4 über die Season); `schedule_proposals` an Unbeteiligte nur mit `scheduled_at`, `status`, `actor_registration_id`; Notizen höchstens 500, Einspruch höchstens 1000 Zeichen | `self_register`, `access_link_routes`, `_match_page_payload`, `models.py` |

### Kader und Aufstellung (#2202, Paket A.4)

| Thema | Vertrag | Stelle |
| --- | --- | --- |
| Kontosperre | Stand `banned` in `league_roster.status`, eine Stelle für alle Prüfungen (Paket B.3 baut darauf auf). Festhalten und Freigabe hängen an der ID, nicht an der Sperre (`_id_status`). Die Gegenseite sieht in `lobby_ids` niemanden mit Sperre, kein Grund | `league_roster`, `league_games._lobby_ids` |
| Gesperrte Verantwortliche | Ein gesperrtes Konto zählt nicht als Captain oder Vertreter: Es handelt der andere, ohne beide die Hauptteam-Leitung. Anmeldungen ohne Co-Team bleiben unverändert | `match_audience._squad_roles` |
| Kader zu klein | Abgänge bleiben möglich (Entscheidung des Obmanns). Fällt der Kader eines aktiven Co-Teams (`team_squads.status`) mit aktiver Anmeldung in einer nicht beendeten Staffel unter `min_squad_size`: Warnung (Art `tournament_registration`, `meta.reason` `league_squad_short` und `league_squad_short_lead`, einmal je Größe und Wiener Tag) an Captain, Vertreter, Hauptteam-Leitung und Turnierleitung. Nie gespeichert, jedes Mal frisch berechnet | `squad_shortage`, `team_routes` |
| Aufgabe „Kader auffüllen“ | `me.actions[]` mit `type: "squad_short"`, `target_type: "team"`, `team_id`, ohne `target_id`: Apps ohne neuen Build zeigen die Zeile ohne Pfeil und öffnen nichts. Für Captain, Vertreter und Hauptteam-Leitung, bis der Kader reicht | `match_overview.own_squad_tasks`, `mobile_routes` |
| Hinweise vorab | `GET /api/teams/{id}/squads` trägt `league_requirement: {min_size, title}` bei Co-Teams in einer nicht beendeten Staffel (strengste Vorgabe). `GET …/seasons/{id}/roster`: je Co-Team `member_count`, `min_squad_size`, `short`; `counts.short`, `counts.banned` | `squad_shortage.requirements`, `league_roster.season_overview` |
| Beide Seiten | `check_both_sides` vergleicht die neuen Aufstellungen mit denen der anderen Seite am Spiel (`_lineup_sources`), über alle Maps. Die Korrektur der Leitung ersetzt beide Seiten: Dort zählt nur, was sie schickt. Lässt eine Korrektur oder ein Nachtrag Altbestand durch: Protokoll `match.lineup.both_sides_kept` | `league_games` |
| Freigabe „Turnierleitung“ in Teams | Zählt nur bei der Pflege öffentlicher Teams (Team bearbeiten, Co-Teams, Logo), Schalter `can_edit_team`. Banner, Chat, private Teams, Beitrittscode und Einladungen bleiben bei der Rolle (`can_manage`). Vertrag in [ROLLEN.md](ROLLEN.md) | `team_routes._can_edit_team` |
| Spätere Aufnahme | Fehlende ID und „wartet auf Freigabe“: `meta.reason` `league_id_missing`, `league_id_missing_team`, `league_late`, `league_late_team`, je Person einmal. Gleichzeitige Aufnahmen in zwei Co-Teams ergänzen denselben Eintrag per `$addToSet`. Gesperrte und archivierte Co-Teams bekommen nichts. Eine klemmende Nachricht hält die Änderung nicht auf | `league_roster.on_squad_members_added` |

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
moment)` (A, P2; liefert `{start_date, end_date, label}` oder `None` – Sperrzeit oder Tag einer Sperrwoche). Bis P2 auf
`main` ist, bleibt der Aufruf aus. Ebenso für B: `matchday_schedule.response_deadline(tournament, start, hours)` statt
`start + hours` in `match_routes._schedule_deadline` (Zeit in einer Sperrzeit zählt nicht). Fenster eines Spieltags
mit Sperrwochen: `matchday_schedule.tournament_matchday_window(tournament, number)`. In `match_v2_results` (B) ruft
`build_league_redraw_application` seit P2 `advancement_draw.league_home_swaps` – bei nur Hinrunde tauschen alle Seiten
gemeinsam, damit das Heimrecht fair bleibt.

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
| Gastteams anderer Vereine | #1665: Konten ohne Mitgliedschaft melden sich seit B.4 an (`entry_policy`), Gast-Plakette in Tabelle und Profil folgt |
| Solo-Ligen (`participant_kind="solo"`) | #1629 |
| Discord-Meldungen der Liga (Spieltag, Saisonende) | eigenes Folgepaket |
| Map-Pool je Liga N, Statistik je Map/Spieler | später |

## 10. Sichtbarkeit, Schalter, Migration

- **Schalter ist die Season-Sichtbarkeit** (Vorgabe `off`), kein globaler Schalter. Die Navigation zeigt „Liga“ nur,
  wenn die öffentliche Lese-API für die Person mindestens eine Season liefert.
- **APIs (P1):** Verwaltung `/api/admin/leagues` (Bereich `leagues` oder Zuständigkeit, Abschnitt 12): `GET ""` (Ligen mit Seasons, Spiele,
  Vorgaben), `POST ""`, `PATCH /{league_id}`, `POST /{league_id}/seasons`, `GET|PATCH /seasons/{id}` (mit Kalender,
  Map-Pool, Liga N samt Staffeln), `PUT|DELETE /seasons/{id}/map-pool`, `POST /seasons/{id}/sync`,
  `POST /seasons/{id}/divisions`, `PATCH /divisions/{id}`, `POST /divisions/{id}/staffeln`; seit #2106
  `GET …/delete-plan` und `DELETE` (Body `{reason}`) für `/{league_id}`, `/seasons/{id}`, `/divisions/{id}` sowie
  `DELETE /staffeln/{tournament_id}`. Öffentlich `GET /api/leagues`
  und `GET /api/leagues/{liga}/{season}` – auch die Turnierleitung bekommt dort bei `off` ein 404 (sie sieht die Season
  in der Verwaltung). Gelesene Turniere tragen bei Staffeln `league_label` („Liga · Staffel A“, Turnierliste, Profil,
  Teamseite).

| `league_seasons.visibility` | Ligaseite | Staffel-Turniere (`visibility`, `is_public`) |
| --- | --- | --- |
| `off` | 404 | `internal`, `false`, Status bleibt `draft` |
| `admins` | nur Bereich Ligen und Zuständige dieser Liga | `internal`, `false` |
| `members` | wie Turnier-Sichtbarkeit `members` | `members`, `true` |
| `public` | alle | `public`, `true` |

- **Migration:** keine. Nur neue Sammlungen und optionale Felder, Indizes in `init_indexes`. Ohne die Felder
  verhalten sich Turniere, Anmeldungen, Co-Teams, Spiele und Tabellen genau wie vorher (Regressionstests:
  Liga-Turnier mit Hin/Rück, Gruppen, Team-Turnier mit Aufstellung #1192, App-Meldung ohne `games`). Ausnahmen:
  Migration 16 (#2106, `published_at`) und Migration 17 (#2108, Liga-Kader für schon zugeteilte Co-Teams nachziehen).
- **Rückweg:** Season auf `off` stellt alles unsichtbar; die Felder bleiben ungenutzt liegen.
- **Teilnehmende sehen ihre Staffel auch bei `off` und `admins`** – die allgemeine Turnierregel
  (`tournament_hidden_reason`: wer angemeldet ist, sieht sein Turnier; Entwurf bleibt 404). Bewusst so belassen: Die
  Co-Teams müssen während der Season Spiele melden, Termine abstimmen und den Matchchat lesen können, auch wenn die
  Leitung die Liga nach außen kurz ausblendet. Für Teilnehmende zu verbergen hieße, die gemeinsame Sichtbarkeitsregel
  aller Turnier-, Spiel- und Chat-Routen um einen Liga-Sonderfall zu erweitern – viel Fläche für wenig Nutzen. Die
  Ligaseite und die Lese-API bleiben bei `off` für alle 404.

## 11. Gestaltung (#2107)

Logik in `services/league_look.py`, alles optional – ohne Felder sieht die Ligaseite aus wie vorher.

| Feld | Ebene | Regel |
| --- | --- | --- |
| `emblem_url` | Liga, Season überschreibt | eigene Upload-Adresse (wie `series_logo.clean`, auch SVG über `/api/uploads/logo`), Datei muss in `media_uploads` stehen |
| `banner_url` | Liga, Season überschreibt | eigene Upload-Adresse ohne SVG (`/api/uploads/image`), in `media_uploads` |
| `banner_focus` | mit dem Banner | `{x, y, mobile_x, mobile_y}` in Prozent, Vorgabe 50; Ligaseite: Desktop 3 : 1 mit `x/y`, Handy 4 : 3 mit `mobile_*` |
| `accent_color` | nur Liga | `#RRGGBB`, Kontrast ≥ 4,5 : 1 zu `#0A0A0A`, sonst 422; fehlt = Vereinsfarbe (`--tls-brand`) |
| `prizes` | Season, Liga N überschreibt | `[{place 1–64, text ≤ 160, image_url?}]`, höchstens 20, jeder Platz einmal; Bild wie Banner |

- **Rückfälle** (`league_look.effective`): Emblem und Banner Season → Liga → `None`; Gewinne Liga N → Season.
- **Öffentlich:** `GET /api/leagues` trägt je Liga `emblem_url`, `accent_color` und je Season `emblem_url`, `banner`
  (geltend); `GET /api/leagues/{liga}/{season}` trägt `look` (`emblem_url`, `banner`, `accent_color`), `prizes` und je
  Liga N `prizes` (eigene oder `null`). Teamseite: `league[].emblem_url`. Link-Vorschau (`seo_render_routes`): Bild =
  geltendes Banner der öffentlichen Season.
- **Staffeln:** `create_staffel` und jede Änderung am Banner (Liga oder Season, `apply_banner`) setzen `banner_url` der
  Staffeln auf das geltende Banner und merken es in `league_banner_url` – die App zeigt eine Staffel als Turnier mit
  ihrem Banner. Ein eigenes Turnierbanner (≠ `league_banner_url`) bleibt stehen. Kein „Übertragen“ nötig.
- **Gewinne** sind reine Anzeige: kein Feld am Turnier, keine XP, Pokale oder Jahreswertung (`NOT_LEAGUE` bleibt).
- **Mediathek:** `media_audit` kennt `leagues`/`league_seasons` (`emblem_url`, `banner_url`) und `prizes.image_url`
  an Season und Liga N – die Dateien gelten als verwendet.
- Audit: Änderungen laufen über `league.update`, `league.season.update`, `league.division.update` (Feldnamen).

## 12. Ausbau zur Wettbewerbsplattform (Epic #2211)

Stand: 02.11.2026. Dieser Abschnitt legt Richtung und Grenzen fest. Die genauen Felder trägt jedes Paket hier nach, bevor
es gebaut wird. Fachregeln stehen nicht hier, sondern werden je Season eingestellt.

### Grundsätze

- **Kein zweites System.** `Spiel → Liga → Season → Liga N → Staffel → Spiele` bleibt. Kein paralleles Match-, Modus- oder
  Map-System.
- **Jedes neue Feld ist optional.** Ohne Feld verhält sich alles wie vorher. Andere Turnierformate und die App ohne neuen
  Build bleiben unverändert.
- **Keine Werte eines Titels im Code.** Modi, Ergebnisgrenzen, Reihenfolgen und Veto-Abläufe stehen am Spiel oder an der
  Season.
- **Nichts Fachliches wird still entschieden.** Offene Regeln bekommen eine Einstellung, ihre Vorgabe gibt der Betreiber frei.
- **Season bleibt Vorlage, die Staffel trägt die geltenden Werte** (Abschnitt 1). Neue Werte laufen über `SYNC_GROUPS`.

### Datenfluss

```
games.match_modes[] ── Modus mit Status und Ergebnisregel
game_maps ──────────── Bibliothek, Map ↔ Modus (M:N)
map_pools ──────────── unveränderliche Versionen: league_season → Kopie je Staffel (tournament)
league_seasons ─────── Vorlage: Anmeldung, Kader, Best of, Modusfolge, Veto, Wertung, Fristen
league_rules ───────── Regelwerk in Versionen, Zustimmung

league_applications ── Antrag je Season (Kapitän) ──Genehmigung──▶ tournament_registrations (Staffel)
                                                                        │
matches_v2 ── flow (Check-in, Start) ── veto + planned_games[] ── games[] (Ergebnis) ── incidents[] ── disputes
                                                                        │
competition_sanctions ──▶ league_eligibility (Aufstellung, Check-in, Anmeldung)
                     └─▶ Tabelle (standings_for_structure) ──▶ league_final_tables (Endstand)
```

### Neue Bausteine

| Baustein | Paket | Kern | Baut auf |
| --- | --- | --- | --- |
| Echte Tests | A.2 | `flow_harness.py` wahlweise gegen MongoDB, schreibende Abnahme-Spec | CI, `docker-compose.abnahme.yml` |
| Bereich `leagues`, `league_staff` | B.1 | Zuständigkeiten je Liga, Befangenheit | `permissions.py`, `tournament_permissions.py` |
| `league_rules` | B.2 | Versionen, Zustimmung, Spiel merkt sich die Version | `rules` der Staffel, `rules_text` als Rückfall |
| `league_eligibility.py` | B.3 | Eine Prüfung für Anmeldung, Kaderaufnahme, Teilnehmerliste, Check-in | `league_roster.py`, `league_games._lineup` |
| `league_applications` | B.4 | Antrag je Season, die Staffel steht erst nach Genehmigung fest | `squad_problems`, `build_registration` |
| Modus-Felder | C.1 | Status, Ergebnisregel | `games.match_modes[]`, Dauerplanung bleibt |
| `season_readiness` | C.2 | Vorab-Prüfung vor der Veröffentlichung | `map_pools`, `game_mode_order` |
| Ergebnisregeln | C.3 | Prüfung in `normalize_games`, nur mit gesetzter Regel | `games[]` |
| `game_equipment`, `loadout_bans` | C.4 | Bibliothek je Spiel, Sperrliste in Versionen, Baustein `loadout_bans` | `game_maps`, `map_pools`, `league_rule_blocks` |
| `matches_v2.flow`, `match_flow.py` | D.2 | Stand abgeleitet, kein neuer globaler `status`; setzt `started_at` | `no_show_deadline`, `call_view` |
| `matches_v2.veto`, `planned_games[]` | D.3 | Zustandsautomat auf dem Server, gleiche Schlüssel wie `games[]` | `map_pools.allowed`, `map_pool_id` |
| `matches_v2.incidents[]` | D.5 | Abbruch, Pause, Rehost, Wiederholung, Entscheidung | `games[]` |
| Tabellen-Regeln | E.1 | Direkter Vergleich, Mini-Tabelle, Default-Win, Punktabzug | `scoring_rules`, `standings_for_structure` |
| `competition_sanctions` | E.3 | Strafen mit Wirkung, Moderation bleibt getrennt | `penalty_routes.py` |
| `league_final_tables` | F.1 | Dauerhafter Endstand, Meister | Muster `record_tournament_awards` |

### B.1 Bereich „Ligen“, Zuständige, Befangenheit (#2203)

**Bereich `leagues`** (Zwei-Faktor Pflicht, vergibt der Superadmin unter Alle Benutzer): darf alle Ligen und alle Zuständigkeiten.
Superadmin und Club-Admin haben ihn über `frozenset(AREAS)`. Die Rolle `tournament_admin` hat ihn **nicht**. Der Bereich
`tournaments` gibt in einer Staffel nichts mehr außer dem, was jede Person lesen darf. Keine Migration vergibt Rechte: Nach dem
Release vergibt der Superadmin den Bereich einmalig.

**Zuständige je Liga** (`league_staff`, eine Zeile je Person und Liga):

| Feld | Inhalt |
| --- | --- |
| `id` | Kennung |
| `league_id`, `user_id` | Liga und Person, eindeutig zusammen |
| `capabilities[]` | Zuständigkeiten, mindestens eine, nur aus der Liste unten |
| `created_at`, `created_by`, `updated_at`, `updated_by` | Wer es wann vergeben oder geändert hat |

Eigene Sammlung statt Feld an `leagues`: Das Liga-Dokument geht an die Verwaltung und in Teilen an die Öffentlichkeit, „meine Ligen“
je Person läuft über den Index `user_id`, Löschen des Kontos und Auskunft (`personal_data.py`) brauchen je Person eine Zeile.

| Zuständigkeit | Schlüssel | Was dazugehört |
| --- | --- | --- |
| Liga verwalten | `manage` | Liga bearbeiten, Season anlegen und löschen, Status und Sperre einer Staffel, Staffel-Einstellungen, Helfer der Staffel |
| Season konfigurieren | `season` | Season ändern, Map-Pool, Liga N, Staffel anlegen und löschen, Übertragen, Spielplan und Phasen |
| Teams freigeben | `applications` | Co-Team zuteilen und herausnehmen, Teilnehmerliste, Austritt |
| Kader prüfen | `roster` | Kaderübersicht mit Spiel-IDs, neue ID freigeben, Stichtag |
| Spiele betreuen | `matches` | Termine, Terminvorschläge entscheiden, Spielplan freigeben, Aufstellungen lesen, Check-in |
| Ergebnisse korrigieren | `results` | Ergebnis eintragen und korrigieren, Rückgängig, kampflos, nicht erschienen, Aufstellung nachtragen als Leitung |
| Proteste | `disputes` | Streitfälle entscheiden (zusammen mit `results` auch über eine Korrektur) |
| Strafen | `sanctions` | Vorgesehen für E.3, heute noch ohne eigene Route |
| Regeln veröffentlichen | `rules` | Regeltext der Season, Regelwerk der Liga und der Season: Entwurf, Vorschau, Veröffentlichen, Stand der Zustimmungen, Hinweis „Daten geändert“ (B.2) |

Regeln: Wer den Bereich hat, darf alle Ligen. Zuständige haben nur ihre Liga und nur ihre Zuständigkeiten. Liga anlegen und löschen
und die Vergabe der Zuständigen brauchen den Bereich. Vergabe mit Protokoll (`league.staff.grant`, `league.staff.update`,
`league.staff.revoke`) und Meldung an die Person (`rights_change`). Ohne bestätigte Zwei-Faktor-Anmeldung gilt weder Bereich noch
Zuständigkeit. Ein Zuständiger braucht keinen Bereich; `/admin` führt ihn über „Mein Dienst“ zu seinen Ligen.

**Befangenheit** (`league_permissions.conflict_of_interest(db, user, match, decided_by=None)`): Befangen ist, wer zu einer Seite des
Spiels gehört: Kader des Co-Teams, Captain, Vertreter, Hauptteam-Leitung, Person der Anmeldung, oder wer in einer Aufstellung des
Spiels steht. Dann gibt es dort keine Ergebnis-Korrektur, keine Protest-Entscheidung und keine Strafe zum Spiel. Es entscheidet eine
zweite berechtigte Person. Dasselbe gilt für den direkt gesetzten Termin: `matches` setzt im eigenen Spiel keinen Termin, als Captain oder
Vertreter gilt Vorschlag und Zustimmung wie für jede Seite. Notausnahme nur für den Superadmin, mit Pflichtgrund (mindestens fünf Zeichen, Feld
`conflict_reason`) und Protokoll `league.conflict.override`. Ein gehaltenes Ergebnis prüft Konto, Zwei-Faktor, Liga-Recht und Befangenheit beim
Veröffentlichen noch einmal; passt es nicht mehr, fällt es weg (`match.result.hold_failed`, Nachricht an die Person). Die Notausnahme gilt dabei, wenn sie
beim Ablegen gesetzt war. `decided_by` ist für E.3: Einen Einspruch entscheidet nie die Person, die die Ausgangsentscheidung
traf, auch nicht der Superadmin. Die eigene Seite handelt weiter als Captain oder Vertreter (melden, bestätigen, Termin).

**Befangenheit bei der Anmeldung** (#2245, Entscheidung Nr. 73; `league_permissions.side_conflict(db, user, side)`): Dieselbe Regel für die
Seite eines Antrags (B.4): Kader des Co-Teams, Captain, Vertreter, Leitung und Co-Leitung des Hauptteams und wer den Antrag eingereicht hat.
Über die Anmeldung des eigenen Teams entscheidet eine zweite Person: Prüfen, Annehmen, Ablehnen, Warteliste und Zuteilen antworten sonst 403.
Notausnahme wie oben (Superadmin, `conflict_reason`, mindestens fünf Zeichen). 403 und Notausnahme teilen sich beide Prüfungen in
`override_reason`, das Protokoll `league.conflict.override` schreibt `record_override`. Das bloße Zuteilen eines Co-Teams ohne Antrag kennt keine
Befangenheit. Nimmt es einen offenen Antrag an (Sonderweg), gilt die Regel auch dort.

**Helfer an Staffeln:** `organizer`, `referee`, `scorekeeper`, `station_manager` und `stream_operator` lesen in Staffeln wie bisher
(`READ_STAFF_ROLES`), ändern dort aber nichts. Andere Turniere bleiben unverändert.

**Rechte-Matrix.** „Staffel“ meint `/api/tournaments/{tid}/…` und `/api/matches/{id}/…` eines Turniers mit `league_context`. Das
Recht in der Spalte gilt zusätzlich zum Bereich `leagues`, der alles darf. Bereich `tournaments` allein, Helfer und Moderation: kein
Zugriff, außer „lesen“ steht in der Zeile. Prüfung: `backend/tests/test_league_rights_matrix_flow.py`.

| Route | Liga-Recht | Befangenheit | Helfer |
| --- | --- | --- | --- |
| `POST /api/admin/leagues`, `DELETE /api/admin/leagues/{id}`, `GET …/{id}/delete-plan` | nur Bereich | – | – |
| `GET /api/admin/leagues` | jede Zuständigkeit, nur die eigenen Ligen | – | – |
| `GET /api/admin/leagues/seasons/{id}` | jede Zuständigkeit der Liga | – | – |
| `PATCH /api/admin/leagues/{id}`, `POST …/{id}/seasons` | `manage` | – | – |
| `DELETE …/seasons/{id}`, `GET …/seasons/{id}/delete-plan` | `manage` | – | – |
| `PATCH …/seasons/{id}` | `season`; `rules_text` braucht `rules` | – | – |
| `PUT`, `DELETE …/seasons/{id}/map-pool`, `POST …/seasons/{id}/sync` | `season` | – | – |
| `GET …/seasons/{id}/result-rules` (C.3) | jede Zuständigkeit der Liga | – | – |
| `PUT …/seasons/{id}/result-rules` (C.3) | `season` | – | – |
| `POST …/seasons/{id}/map-pool/remove-map` (#2207) | `season` | – | – |
| `GET …/seasons/{id}/map-pool/versions`, `…/map-pool/compare`, `…/readiness` (#2207) | jede Zuständigkeit der Liga | – | – |
| `PUT`, `DELETE …/seasons/{id}/loadout-bans` (#2218) | `season` | – | – |
| `GET …/seasons/{id}/loadout-bans`, `…/loadout-bans/compare` (#2218) | jede Zuständigkeit der Liga | – | – |
| `POST …/seasons/{id}/divisions`, `PATCH`, `DELETE …/divisions/{id}`, `GET …/delete-plan` | `season` | – | – |
| `POST …/divisions/{id}/staffeln`, `DELETE …/staffeln/{tid}` | `season` | – | – |
| `GET …/seasons/{id}/roster`, `POST …/roster/{uid}/approve`, `PUT …/roster-settings` | `roster` | – | – |
| `GET`, `PUT …/seasons/{id}/schedule-rules` (Terminregeln, #2194) | `season` | – | – |
| `GET …/{id}/staff` | `manage` | – | – |
| `GET`, `PUT …/draft`, `DELETE …/draft`, `POST …/draft/from-version`, `…/preview`, `…/publish` unter `/api/admin/league-rules/{league\|league_season}/{id}` | `rules`; die Liga kommt aus der Adresse, bei einer Season aus der gespeicherten Season | – | – |
| `PATCH`, `PUT …/roles`, `DELETE /api/teams/{id}/squads/{sid}` eines Co-Teams in nicht beendeter Staffel | `roster` oder eigenes Team | – | – |
| `PUT`, `DELETE …/{id}/staff/{uid}` | nur Bereich | – | – |
| Staffel: `PATCH`, `POST /lock`, `/unlock`, `/status`, `PUT /pause`, `/round-sponsors`, `/onsite-access` | `manage` | – | – |
| Staffel: `DELETE`, `bracket/*`, `reset-bracket`, `stages*`, `swiss/*`, `groups/generate`, `heat-rebuild/*`, Map-Pool | `season` | – | – |
| Staffel: `POST`, `PUT`, `DELETE /staff` | `manage` | – | – |
| Staffel: `GET /staff`, `/lead`, `/planning-check`, `/match-plan.csv`, `/bracket/display`, `/schedule/deadlines`, Chat, Teilnehmer intern | jede Zuständigkeit | – | lesen |
| Staffel: `squad-candidates`, `squad-registrations`, `registrations` schreiben, `removal*`, `assignable-users` | `applications` | `POST squad-registrations` nur, wenn das Co-Team einen offenen Antrag hat | – |
| `GET …/seasons/{id}/applications` | `applications` | – | – |
| `POST …/applications/{aid}/review`, `/accept`, `/reject`, `/waitlist`, `/assign` | `applications` | ja, eigenes Team | – |
| Staffel: `registrations/{id}/checkin`, `print/checkin`, `schedule/plan`, `/apply`, `/release`, `live-queue/*`, Team-Tag `lineups` | `matches` | – | – |
| Spiel: `PATCH` (Termin und Betreuung), `schedule/apply` und `/release` mit eigenem Spiel | `matches` | ja, im Sammellauf ohne Notausnahme | – |
| Spiel: Terminvorschläge entscheiden und zurückziehen | `matches`; Beteiligte nur als Captain oder Vertreter wie jede Seite | ja | – |
| Spiel: `POST /reschedule`, `POST /reschedule/{rid}/decision` (Verschiebung, #2194) | keins – nur Captain oder Vertreter einer Seite (Seitenrecht wie beim Melden); die Leitung legt den Termin über `PATCH` fest (`matches`) | `PATCH`: ja (Notausnahme `conflict_reason`) | – |
| Spiel: `POST /result`, `/result/undo`, `/forfeit`, `PUT /lineups` als Leitung, `POST …/lead/no-show/{id}` | `results` | ja | – |
| Spiel: `POST /dispute/decision` | `disputes` | ja | – |
| Spiel: `POST /result` bei offenem Streitfall | `results` und `disputes` | ja | – |
| Spiel: `POST /dispute` (ohne eigene Seite) | `disputes` | nein | – |
| Spiel: `POST /proof-photos` als Leitung, `matches-v2/recalculate-advancement` | `results` | nein | – |
| `GET /api/admin/leagues/staffeln/{tid}/table` (E.1) | jede Zuständigkeit | – | – |
| `PUT …/staffeln/{tid}/table-decision`, `DELETE …/table-decision/{id}` (E.1) | `results` | ja, eigenes Team | – |
| `POST`, `DELETE …/staffeln/{tid}/matches/{mid}/double-no-show` (E.1) | `results` | ja | – |
| PDF-Exporte und Ergebnis-Vorabzug einer Staffel | jede Zuständigkeit | – | – |
| Zugangslinks, TV-Schlüssel, Stationen, Gewinne an einer Staffel | zusätzlich zum Bereich `tournaments`: `manage` | – | – |
| Öffentliche Ligaseite, Staffel, Spielplan, Tabelle, Matchseite | nach Sichtbarkeit; Sichtbarkeit `admins` nur mit Liga-Recht | – | lesen |

**Co-Teams in nicht beendeten Staffeln** (`PATCH`, `PUT …/roles`, `DELETE /api/teams/{id}/squads/{sid}`): Kader, Captain, Vertreter, Status und
Löschen ändern nur die Leitung und Co-Leitung des eigenen Teams und die Liga-Leitung mit `roster`, bei mehreren Ligen in jeder. Die Rolle
`tournament_admin` und die Freigabe `tournaments` nicht mehr. `GET …/squads` sagt je Co-Team `can_edit`; wer nur `roster` hat, liest nur die Co-Teams
seiner Liga. Die Liga-Leitung bearbeitet aus der Kaderübersicht der Season („Kader bearbeiten“), Protokoll `league.squad.edit`. Die eigene Rolle
abgeben geht weiter. Alle anderen Teams und Co-Teams, auch nach dem Ende der Staffel, bleiben wie bisher.

**Bewusst unverändert:** Die übrige Team-Verwaltung (`team_routes.py`, Team-Admin-Rollen) bleibt ein eigener Rechtebereich.
Jahreswertung, Spiele, Map-Bibliothek und Ausrüstungs-Bibliothek (#2218) bleiben beim Bereich `tournaments`. Die Moderation bleibt getrennt.

**Antworten an das Web:** `GET /api/tournaments/{tid}` schickt bei Staffeln `league_capabilities[]` und `can_edit_staffel`; die
Matchseite `conflict` (`{"kind": "involved", "override": bool}` oder `null`); `matches-v2` einer Staffel für die Leitung `viewer_involved` und `viewer_override`; die Verwaltung je Liga `capabilities[]`. `GET /api/auth/me`
schickt `has_league_staff`.

### Regelwerk (Paket B.2, #1646)

Logik in `services/league_rules.py` (Daten, Rechte, Ablauf), `services/league_rules_text.py` (Abschnitte, Anker, Vergleich, ohne
Datenbank), `services/league_rule_blocks.py` (Bausteine), `services/league_rules_store.py` (was `league_service` braucht, ohne
Import-Kreis), `pdf_service.pdf_league_rules`. Routen in `routes/league_rules_routes.py`.

**`league_rules`** – eine Zeile je Fassung, Muster `map_pools`:

| Feld | Typ | Bedeutung |
| --- | --- | --- |
| `scope`, `scope_id` | `"league"` \| `"league_season"`, str | liga-weit oder je Season; die Season erbt die Liga, solange sie keine eigene gültige Fassung hat |
| `league_id`, `season_id` | str, str \| `null` | zur Einordnung |
| `status` | `"draft"` \| `"published"` | je `scope` höchstens ein Entwurf |
| `version` | int \| `null` | Nummer ab 1, erst beim Veröffentlichen, je `scope` eigene Zählung |
| `revision` | int | nur im Entwurf: schützt vor gleichzeitigem Überschreiben |
| `title` | str ≤ 160 | Titel des Regelwerks |
| `body_md` | str ≤ 200 000 | Markdown mit Bausteinen |
| `annexes` | `[{key, title, body_md}]`, höchstens 26 | Anlagen; `key` = „A“, „B“ … aus der Reihenfolge |
| `frozen` | `{season_id: {block: {label, markdown, source}}}` | eingefrorene Bausteine; je Season, bei `scope: league` für jede Season, die nicht archiviert ist |
| `blocks_used` | `[str]` | im Text verwendete Bausteine |
| `valid_from` | `YYYY-MM-DD` | Wiener Kalendertag; nie vor heute und nie vor dem der Vorgänger-Fassung |
| `change_reason` | str 5–500 | Änderungsgrund |
| `requires_consent` | bool | muss der Fassung neu zugestimmt werden |
| `created_at`, `created_by`, `updated_at`, `updated_by`, `published_at`, `published_by` | | Autor und Zeiten; öffentlich nur `published_at` |

Indizes: `id` eindeutig; (`scope`, `scope_id`, `version`) eindeutig, nur für `published`; (`scope`, `scope_id`) eindeutig, nur für
`draft`. Eine veröffentlichte Fassung ändert niemand mehr: jedes Schreiben filtert auf `status: "draft"`, und das Veröffentlichen
setzt Stand und Nummer in einem Schritt.

**Gültig** ist je `scope` die höchste Nummer mit `valid_from` ≤ heute (Wien). Für eine Season zuerst die eigene, sonst die der Liga,
sonst `rules_text` als Rückfall (`source: "fallback"`). Eine Fassung mit späterem `valid_from` heißt `upcoming`, und bis dahin gilt die davor.

**Abschnitte und Anker:** Jede Überschrift (`#` bis `###`) beginnt einen Abschnitt. Der Anker ist der Slug der Überschrift, stabil,
solange sie gleich bleibt; doppelte zählen weiter (`-2`). Text vor der ersten Überschrift: `einleitung`. Eine Anlage ist ein Abschnitt
`anlage-a`, ihre Überschriften `anlage-a-<slug>`. Die Abschnitte kommen vom Server, Web und PDF zeigen dieselben.

**Bausteine:** `[[baustein:map_pool]]` (Tabelle Modus und Maps aus dem Pool `league_season`), `[[baustein:mode_order]]` (Liste aus
`game_mode_order` mit den Namen der Modi), `[[baustein:loadout_bans]]` (Sperrliste, C.4). Unbekannte lehnt das Veröffentlichen mit 422
ab. Neue Bausteine stehen in `league_rule_blocks.BLOCKS`. Beim Veröffentlichen wird das Markdown des Bausteins eingefroren; alte
Fassungen zeigen ihren Stand von damals. Ohne Season (Seite der Liga) oder bei einer Season, die erst nach dem Veröffentlichen dazukam,
steht dort ein Hinweis statt einer Liste.

**Reihenfolge:** Fassungen folgen ihrer Geltung (`valid_from`, am selben Tag die zuletzt veröffentlichte), nicht dem Tag der Veröffentlichung. Eine Season erbt die Liga-Fassungen, die
vor ihrer ersten eigenen gelten, auch wenn die eigene früher veröffentlicht wurde; spätere Liga-Fassungen gehören nicht zu ihrer Kette.

**Vergleich:** Abschnitte gleichen Ankers werden ohne Rücksicht auf Leerraum verglichen; übrige paaren sich bei ähnlichem Text (Überschrift
umbenannt = geändert). Ergebnis `{new, changed, removed}` gegen die Vorgänger-Fassung, auf der Season in der Reihe aus Liga und Season.
Der Wort-für-Wort-Vergleich (`ops: [{op: "eq"|"ins"|"del", text}]`) geht mit jeder alten Fassung und zeigt auch entfernten Text.

**Datenänderung:** Die Verwaltung vergleicht die Bausteine der letzten Fassung mit dem heutigen Stand der Quellen (`data_changes`). Nur
ein Vorschlag: „Neue Version vorbereiten“ legt einen Entwurf an, nichts veröffentlicht sich selbst.

**`league_rule_consents`:** `id`, `rule_version_id`, `version`, `league_id`, `season_id`, `squad_id`, `team_id`, `user_id`,
`created_at`. Eindeutig: (`rule_version_id`, `season_id`, `squad_id`, `user_id`); dazu Index `user_id` und (`season_id`, `squad_id`).
Zustimmen darf, wer für das Co-Team verantwortlich ist (`match_audience.responsible_ids`), und zwar nur der gültigen Fassung. Offen ist
sie für ein Co-Team mit aktiver Anmeldung, wenn es der letzten gültigen Fassung mit `requires_consent` (oder einer neueren) nicht zugestimmt
hat. Dann gibt es die Aufgabe `me.actions[]` `type: "rules_consent"` (`target_type: "league_rules"`, `rules_url`, kein `target_id`:
Apps ohne neuen Build zeigen die Zeile ohne Pfeil) und den Hinweis auf der Regelseite. **Nichts blockiert:** Melden, Aufstellen und
Spielen laufen weiter. Kontolöschung: gelöscht (`account_erasure.PURGED`), Auskunft: ja.

**Startseite:** `own_consent_tasks` lädt Seasons, Ligen, Fassungen (ohne Text), Teams und Zustimmungen gesammelt, die Zahl der Abfragen hängt nicht an der Zahl der Seasons.

**Am Spiel:** `matches_v2.rule_version_id` (optional) setzt `submit_v2_result` beim ersten Festschreiben eines Ergebnisses einer Staffel;
eine Korrektur lässt es stehen, das Zurücknehmen entfernt es. Andere Formate schreiben das Feld nie.

**`accepted_rules`, `accepted_privacy`:** Beim Zuteilen eines Co-Teams schreibt der Server beide `false`, die Zustimmung zu den Regeln steht allein in
`league_rule_consents`. Nur eine Anmeldung aus einem Antrag (B.4) trägt beide `true`, die Zustimmung steht dann im Antrag und in `league_rule_consents`. An Anmeldungen liest beide Felder kein Code; alte Zeilen bleiben unberührt, andere Anmeldewege auch.

**Unveränderlich auch von außen:** Die Mediathek schreibt veröffentlichte Fassungen nicht um (`media_audit.is_frozen`) und lässt die Bild-Migration dort aus.
Eine Datei, die eine veröffentlichte Fassung zeigt, lässt sich nicht drehen und nicht löschen, auch nicht mit Bestätigung (409); beim Duplikat ersetzen bleibt die
Kopie stehen. Entwürfe ändern sich mit. Eine Season oder Liga mit veröffentlichter Fassung oder mit Zustimmungen lässt sich nicht löschen (409, Grund im `delete-plan`,
Hinweis auf Archivieren), nur Entwürfe gehen mit.

**Sperren:** Veröffentlichen und Zustimmen halten die Sperre ihrer Season (`mutation_lock.league_season_resource`, dieselbe wie beim Zuteilen), das liga-weite
Regelwerk die der Liga (`league_resource`). Das Löschen hält nach den Staffeln die der Liga und aller Seasons bis zum letzten Schritt. Ist eine besetzt: 409,
bitte noch einmal. Die Mediathek schreibt nur mit der Bedingung `status: "draft"` (`media_audit.write_guard`, auch die Bild-Migration); Drehen und Löschen einer Datei
halten die Sperren der Entwürfe, die sie zeigen (`rule_draft_locks`). Bekannte Grenze: Speichert jemand genau in diesem Moment einen Entwurf neu mit dieser Datei und
veröffentlicht ihn noch während des Drehens, schützt die Sperre nicht, weil sie den Entwurf noch nicht kannte. Das Fenster sind Sekundenbruchteile, und der Vorgang
braucht zwei Schritte von Hand.

**Bilder:** Im Regelwerk nur eigene Uploads (`game_maps.IMAGE_URL`), mit Eintrag in der Mediathek (`media_uploads`). Der Server lehnt alles andere beim Speichern und
Veröffentlichen mit 422 ab, die Vorschau nennt es (`foreign_images`), das Web lädt es nicht (`markdownLite`, Option `imageAllowed`; andere Nutzer ohne Option bleiben unverändert) und zeigt einen Link. Die CSP bleibt.
Im PDF steht ein eigener Upload auf eigener Zeile als Bild, alles andere als `[Bild: …]`. Die PDF-Schrift kann nur Westeuropäisches: Zeichen wie → werden umschrieben,
Emoji fallen weg.

**Rechenlast:** Je Fassung höchstens 400 000 Zeichen und 400 Abschnitte mit allen Anlagen (`TEXT_TOTAL_MAX`, `SECTIONS_MAX`, 422). Über 60 000 Wörtern in geänderten
Abschnitten fällt der Vergleich auf ganze Abschnitte zurück (`coarse`, alt und neu), die Suche nach umbenannten Abschnitten prüft höchstens 900 Paare. PDF, Vergleich und Seite
werden je unveränderlicher Fassung einmal gerechnet (`league_rules_cache`, 64 MB je Prozess, gleichzeitige Abrufe warten auf eine Rechnung); die Sichtbarkeit prüft die Route
jedes Mal vorher, die Vorschau bleibt ohne Speicher. PDF und Vergleich: 60 Abrufe je Minute und Besucher im Server (`enforce_rate_limit`), in nginx Zone `tls_rules_heavy`
gegen Bursts.

**Staffel:** Gibt es für eine Season ein Regelwerk (eigenes oder der Liga), steht in `tournaments.rules` statt `rules_text` nur der
Hinweis auf die Regelseite. Das schreibt das Veröffentlichen sofort und das Übertragen (`SYNC_GROUPS.always`).

**Routen**

| Route | Wer | Zweck |
| --- | --- | --- |
| `GET /api/league-rules/leagues/{liga}` und `/seasons/{liga}/{season}` (`?version=<id>`) | wie Season-Sichtbarkeit | Regelseite: `source`, `version`, `sections`, `changes`, `versions`, `upcoming`, `fallback_text`, `consent` |
| `GET …/compare?base=<id>&target=<id>` | ebenso | Wort-für-Wort-Vergleich zweier Fassungen dieser Seite |
| `GET …/versions/{id}/pdf` (`?marks=0`) | ebenso | PDF der Fassung, mit Version und Datum auf jeder Seite, ohne `marks=0` mit Markierung |
| `POST /api/league-rules/consents` | angemeldet, verantwortlich | Zustimmung `{version_id, season_id, squad_id}`; mehrfach folgenlos |
| `GET /api/admin/league-rules/{scope}/{id}` | Zuständigkeit `rules` oder Bereich `leagues` | Entwurf, Fassungen, Geerbtes, Bausteine, `data_changes`, Stand der Zustimmungen |
| `PUT …/draft`, `POST …/draft/from-version`, `DELETE …/draft` | ebenso | Entwurf speichern, aus einer Fassung vorbereiten, verwerfen |
| `POST …/preview` | ebenso | Vorschau mit heutigen Bausteinen und Änderungen zur letzten Fassung |
| `POST …/publish` | ebenso | `{revision, valid_from, change_reason, requires_consent}`; 409 bei gleichzeitigem Veröffentlichen |

`GET /api/leagues/{liga}/{season}` trägt zusätzlich `rules`: `{source, version, valid_from, url, pdf_url, consent_open}` oder `null`.
`require_rules_editor` prüft das über `require_league`: Die Liga steht nie im Inhalt, eine Fassung aus einer anderen Liga ist im Geltungsbereich nicht zu finden (404). Die
Web-Route öffnet wie die anderen Liga-Seiten mit `allowLeagueStaff`, der Server bleibt maßgeblich. Eine Befangenheit gibt es beim Veröffentlichen nicht, das Regelwerk ist kein eigenes
Spiel. Bilder: Die Admin-Medien gehen über die Rolle, Zuständige ohne sie laden im Editor eigene Bilder hoch und sehen nur diese (`rulesMediaProps`).

**Seiten:** `/liga/<liga>/regeln` und `/liga/<liga>/<season>/regeln` (Season-Slug `regeln` ist reserviert), Pflege unter
`/admin/leagues/rules/{scope}/{id}`. Protokoll: `league.rules.draft`, `.draft_discard`, `.publish`, `.consent`, ohne Volltext.

### B.3 Spielberechtigung (#2204)

`services/league_eligibility.py` ist **die eine Prüfung** für Anmeldung, Kaderaufnahme, Teilnehmerliste und später den Check-in
(D.2 ruft `league_eligibility.check_participants` auf). Der Stand der Spiel-ID bleibt in `league_roster.status`, die Eignung legt
sich darüber. Kein Wert eines Titels steht im Code. **Ohne Feld verhält sich alles wie vorher:** Seasons von vor B.3 tragen die
neuen Felder nicht und prüfen nichts Neues.

**Einstellungen an `league_seasons`** (Bereich `leagues` oder Zuständigkeit `season`; Vorgabe nur beim Anlegen einer neuen Season):

| Feld | Typ | Vorgabe neu | Fehlt | Bedeutung |
| --- | --- | --- | --- | --- |
| `min_squad_size` | int | 3 | `team_size` | Mindestkader. Bei `lineup_mode: series` darf er unter `team_size` liegen, nie unter `lineup_min_players` |
| `max_squad_size` | int 1–200 | 50 | keine Grenze | Höchstkader. Gilt bei Zuteilen, Aufnahme, Transfer |
| `one_team_per_season` | bool | `true` | `false` | Eine Person steht in einer Season nur in einem Co-Team. In anderen Seasons und Ligen frei |
| `new_player_wait_days` | int 0–60 | 7 | keine Wartezeit | Wartezeit nach dem Ende von Spieltag 1, 0 = aus |
| `roster_deadline` | Kalendertag | keiner | keiner | Wie bisher: Neue warten auf Freigabe, Abgänge frei (`roster-settings`, `roster`) |
| `transfer_windows` | `[{start_date, end_date, label?}]` | `[]` | `[]` | Wiener Kalendertage, höchstens 10. Leer: Es gibt keine Transfers |
| `min_age` | int 0–99 | 18 | keine Prüfung | Mindestalter am Prüftag, 0 = aus. Selbstauskunft über `users.birth_date` |
| `unique_game_ids` | bool | `true` | `false` | Jede Spiel-ID nur einmal je Season |
| `lineup_mode` | `series` \| `per_map` | `series` | `per_map` | Teilnehmerliste einmal je Spiel oder Aufstellung je Map wie bisher |
| `lineup_min_players` | int 1–20 | 3 | – | Mindestzahl der Teilnehmerliste, nur bei `series`. Nach oben offen |

`lineup_mode` und `lineup_min_players` trägt auch die Staffel (`staffel_fields`, Gruppe `before_result`), Staffeln ohne Feld bleiben `per_map`.
`TournamentUpdate` nimmt beide nicht an. Die anderen Felder liest `league_eligibility` wie den Stichtag direkt an der Season.

**Felder am Spiel** (`games.player_id_fields[]`, alle optional, ohne sie wie bisher):

| Feld | Typ | Bedeutung |
| --- | --- | --- |
| `key` | str | Pflicht, je Spiel eindeutig (#2249): Unter ihm stehen die IDs der Spieler (`users.game_ids.<spiel>.<key>`). Doppelt oder leer: 422; was schon doppelt oder leer gespeichert ist (Altbestand), hält ein anderes Speichern nicht auf. Die Verwaltung ändert einen gespeicherten Schlüssel nie, auch keinen nicht kanonischen („PSN-ID“), und schickt fremde Angaben am Feld unverändert zurück |
| `pattern` | str ≤ 200 | Regulärer Ausdruck für den ganzen Wert. Der Server prüft beim Speichern, ob er gültig ist |
| `format_hint` | str ≤ 120 | Beispiel oder Beschreibung, steht im Profil und in jeder Meldung zum Format |
| `options` | `[str]`, höchstens 30 | Auswahl statt Freitext. So wird die **Plattform** zum Feld: Pflicht über `required`, einmal je Season festgehalten wie jede ID |
| `unique_in_season` | bool | `false` nimmt das Feld aus der Eindeutigkeit aus (Vorgabe: Felder mit `options` sind ausgenommen, alle anderen dabei) |

Das Profil lehnt beim Speichern nur Werte ab, die neu sind und nicht zu `pattern` oder `options` passen. Fehlen beide, gibt es keine Prüfung.

**Felder an `league_rosters`:**

| Feld | Bedeutung |
| --- | --- |
| `squad_joined_at` | `{squad_id: ISO}`: erste Aufnahme je Co-Team, wird nie überschrieben |
| `wait_from` | `{squad_id: ISO}`: Beginn der Wartezeit in diesem Co-Team. Gesetzt bei Aufnahme nach dem Ende von Spieltag 1 und bei jedem genehmigten Transfer (dort immer neu), nie beim Zuteilen durch die Leitung |
| `wait_waivers` | `[{squad_id, at, by, reason}]`: Aufhebungen der Leitung. Eine gilt nur für die Wartezeit, die zu ihr lief |
| `id_keys` | `[str]`: normalisierte IDs für den eindeutigen Teilindex (`season_id`, `id_keys`), nur in Seasons mit `unique_game_ids`. Fehlt das Feld, greift der Index nicht |

**Neue Sammlung `league_transfers`:** `id`, `season_id`, `league_id`, `user_id`, `from_squad_id`, `to_squad_id`, `to_team_id`, `status`
(`pending`, `approved`, `rejected`, `withdrawn`), `requested_by`, `requested_at`, `decided_by`, `decided_at`, `reason`. Ein offener Antrag je Person und Season
(eindeutiger Teilindex). Löschen des Kontos löscht die Zeilen, die Auskunft enthält sie.

**Stand einer Person** (`league_eligibility.status`, Vorrang in dieser Reihenfolge): `banned`, `other_team`, `age_missing`, `age_not_met`,
`waiting`, dann der ID-Stand `late`, `missing`, `format`, `taken`, `pending`, `locked`, `free`. `ok`: spielberechtigt. Dazu `until` bei `waiting` und
`age`: `null` (keine Regel), `met` oder `missing`. Für das Unterschreiten gibt es außerhalb der Person selbst nur den Stand `age_not_met` ohne Zahl.

**Regeln je Einstellung:**

| Regel | Wann | Meldung sagt |
| --- | --- | --- |
| `max_squad_size` | Zuteilen, Aufnahme, Transfer (422) | wie viele erlaubt sind |
| `min_squad_size` | Zuteilen (wie bisher). Abgang bleibt möglich, Warnung und Aufgabe aus #2202 | wie viele fehlen |
| `one_team_per_season` | Zuteilen, Aufnahme (409): schon in einem anderen Co-Team oder dort gestanden, solange dieses in der Season angemeldet ist. Teilnehmerliste: aktuell in zwei Co-Teams | dass ein Transfer nötig ist |
| `min_age` | Zuteilen, Aufnahme, Transfer (422), Teilnehmerliste | „Geburtsdatum fehlt“ mit Weg ins Profil, sonst „erfüllt die Altersvorgabe nicht“. Nie ein Datum |
| `new_player_wait_days` | Teilnehmerliste, Check-in. Aufnahme bleibt möglich, Hinweis an Person und Verantwortliche. Neuzugang erst nach dem Ende von Spieltag 1, Transfer immer | bis wann gewartet wird |
| Spiel-ID, Format, Eindeutigkeit | Festhalten, Freigabe, Teilnehmerliste. Eine schon festgehaltene ID bleibt gültig. Meldung nennt nie, wem die ID gehört | was zu tun ist |
| Transferfenster | Antrag (409 außerhalb). Entscheidung auch nach dem Fenster | wann es offen ist |

**Spieltag 1** endet mit `matchday_schedule.tournament_matchday_window(staffel, 1).end`. Wartezeit ist `wait_from + new_player_wait_days` in Wiener Zeit.
Ein gewöhnlicher Neuzugang spielt bis zum Ende von Spieltag 1 sofort, danach wartet er ab der Aufnahme. Der Wiedereintritt ins selbe Co-Team startet keine neue Wartezeit. Ein genehmigter **Transfer wartet immer** ab der Kaderaufnahme (Entscheidung Nr. 71, Regelwerk § 4.6): auch vor dem Ende von Spieltag 1, auch wenn die Person das alte Co-Team schon verlassen hat, auch im Co-Team, in dem sie früher stand. Das Zuteilen eines Co-Teams durch die Leitung startet keine Wartezeit. Aufhebung: `POST /api/admin/leagues/seasons/{id}/roster/{uid}/waive-wait` mit
`squad_id` und `reason` (mindestens fünf Zeichen), Recht `roster`, Protokoll `league.roster.wait_waive`.

**Transfers:** `POST /api/teams/{tid}/squads/{sid}/transfers` mit `user_id` (Recht wie Kader ändern, 409 außerhalb des Fensters, Person muss im Hauptteam
stehen), `GET` dasselbe, `DELETE …/transfers/{id}` zieht zurück. Leitung: `GET /api/admin/leagues/seasons/{id}/transfers`,
`POST …/transfers/{id}/approve`, `…/reject` mit `reason`, Recht `roster`. Genehmigen läuft unter der Season-Sperre `league_season:{id}:squads`:
prüft Alter, Höchstkader und Rolle im alten Co-Team, nimmt aus dem alten und setzt ins neue Co-Team, startet die Wartezeit, benachrichtigt Person und beide Teamleitungen samt dem Tag, ab dem sie spielen darf, warnt bei zu kleinem Kader. Protokoll `league.transfer.request`, `.approve`,
`.reject`, `.withdraw`. Ein Transfer ist nur nötig, wenn `one_team_per_season` gilt.

**Teilnehmerliste** (`lineup_mode: series`):

| Feld | Inhalt |
| --- | --- |
| `matches_v2.lineups` | `{registration_id: [user_id]}`: wer gespielt hat, geltend ab der Bestätigung. Nur für Beteiligte und Liga-Leitung sichtbar, `INTERNAL_KEYS` |
| `reports[].lineup` | die Liste der eigenen Seite in dieser Meldung |
| `lineups_missing` | Seiten ohne Liste, wie bisher |
| `lineup_user_ids` | Vereinigung aus `games[].lineups`, `lineups` und offenen Meldungen. Die Doppel-Einsatz-Prüfung liest weiter hier |
| `lineup_overdue_at` | Frist abgelaufen, Fall bei der Leitung (Art `match_attention`, `meta.reason` `lineup_overdue`, Recht `matches` oder `results`), intern |

Melden und Bestätigen im Web: `games` wie bisher ohne Aufstellung, dazu `lineup: [user_id]` der eigenen Seite. Mindestens `lineup_min_players`, nach oben offen, nur spielberechtigte
Kaderspieler (Altbestand der Seite bleibt), nie auf beiden Seiten. Die App bestätigt ohne `games` und ohne Liste: Das Ergebnis gilt, die Seite landet in `lineups_missing`. Die
Automatik nach 48 h übernimmt die Liste der Meldung. Nachtrag: `PUT /api/matches/{id}/lineups` mit `{lineup: [user_id]}`, Captain oder Vertreter, nur die eigene Seite, bis `lineup_amend_hours`
ab `completed_at`; danach geht der Fall im Fristen-Job an die Leitung (`match_deadline_sweep.sweep_overdue_lineups`), die mit Grund nachträgt. Das Ergebnis bleibt immer gültig. Leitung:
`POST /result` mit `lineups: {registration_id: [user_id]}`, je Seite freiwillig. Wer nicht auf der Liste steht, zählt nicht als Einsatz (`league_games.participants`, liest #2214). `games[].lineups` in Staffeln mit `per_map`
bleiben gültig und lesbar. Eine Wertung (kampflos) nimmt auch die Liste weg.

**Kaderänderungen im Protokoll:** Jede Änderung am Kader eines Co-Teams in einer nicht beendeten Staffel schreibt `league.squad.roster` mit `squad_id`, `added`, `removed`. Austritt und Rauswurf aus dem Hauptteam ebenso.
**Griff von außen:** Ändert die Liga-Leitung einen Co-Team-Kader oder dessen Rollen (Löschen geht in einer laufenden Staffel nicht), bekommen Leitung und Co-Leitung des Hauptteams eine Nachricht mit wer, was, wann (Art `team_role_changed`, `meta.reason` `league_squad_edit`, Schlüssel `league-squad-edit:<squad>:<Zeitpunkt>:<user>`).

**Mail:** Vorlage `league_notice` (Einstellung wie Spiel-Hinweise): Teilnehmerliste fehlt, Griff von außen, Transfer entschieden, Wartezeit der eigenen Person. Sonst bleibt es bei Postfach, Push und Discord.

**Antworten an das Web:** `GET /api/me/league-eligibility` (eigener Stand je Season, ohne Datum). `GET /api/teams/{tid}/squads/{sid}/eligibility`: Stand je Kaderspieler und je möglichem Neuzugang, offene Transfers, Fenster; für Teamleitung, Captain, Vertreter und Liga-Recht `roster`.
`league_requirement` an `GET /api/teams/{id}/squads` trägt zusätzlich `max_size`, `min_age`, `transfers_open`. `GET …/seasons/{id}/roster`: `eligibility` je Spieler (`state`, `ok`, `reason`, `until`, `age`) und `counts.waiting`, `counts.age`.
Der Block `league` der Matchseite trägt `lineup_mode`, `lineup_min_players`, `participants`, `own_lineup`, `lineup_overdue`.

**Datenschutz:** Die Liga-Prüfung und ihre Antworten nennen nie ein Datum oder Alter der Person, weder Stand, Team-Seite, Kaderübersicht, Fehlertext, Nachricht, Mail noch Protokoll. Gelesen wird `users.birth_date` dafür an einer Stelle (`league_eligibility._ages`), heraus kommen nur `met`, `missing` oder der Stand `age_not_met` (Wächter: `test_league_birth_date_guard_unit.py`). Das öffentliche Profil kann das Feld nach der freiwilligen Sichtbarkeits-Einstellung der Person selbst zeigen (`user_routes._visible_field`); das ist kein Liga-Weg und von dieser Regel nicht berührt. Die Gegenseite sieht keinen Eignungsgrund. Eine Meldung zu einer doppelten Spiel-ID nennt keinen Inhaber. Die Auskunft enthält `league_rosters`, `league_transfers` und `league_appearances` (Spiele, in denen die Person auf einer Teilnehmerliste, in `games[].lineups` oder einer offenen Meldung steht, auch ohne `lineup_user_ids`, nur die eigene Seite). Das Löschen des Kontos löscht Kadereinträge und Anträge; `matches_v2` bleibt als Sportdaten, das Konto heißt dort „Gelöschter User“.

**Audit-Aktionen neu:** `league.squad.roster`, `league.roster.wait_waive`, `league.transfer.request|approve|reject|withdraw`, `match.lineup.overdue`.

**Noch nicht gebaut, liest diese Prüfung später:** Check-in (D.2 ruft `check_participants`), Strafen (E.3 ergänzt den Stand).

### B.4 Selbstanmeldung (#2205, #1623, #1665)

Captain oder Vertreter melden ein vorhandenes Co-Team auf der Ligaseite für eine Season an. Die Leitung nimmt an, lehnt ab oder setzt auf die Warteliste und
teilt Liga N und Staffel zu. Erst dann entsteht die `tournament_registrations`-Zeile. Logik in `services/league_applications.py`, Routen in `routes/league_application_routes.py`.
**Ohne Anmeldefenster an der Season gibt es keine Selbstanmeldung**, und alles bleibt wie vorher. Das Zuteilen in der Turnierverwaltung bleibt als Sonderweg.

**Einstellungen an `league_seasons`** (Zuständigkeit `season`, alle optional; wirken sofort, kein Übertragen):

| Feld | Typ | Vorgabe neu | Fehlt | Bedeutung |
| --- | --- | --- | --- | --- |
| `application_opens_at`, `application_closes_at` | ISO (UTC), nur zusammen, Ende nach Beginn | keine | keine Selbstanmeldung | Anmeldefenster, in der Verwaltung als Wiener Zeit eingegeben. Beginn zählt, Ende nicht mehr |
| `application_slots` | int 1–500 | keine | keine Grenze | Startplätze der Season. Belegt: aktive Co-Team-Anmeldungen (`pending`, `approved`, `checked_in`) der Staffeln plus angenommene Anträge ohne Zuteilung |
| `application_waitlist` | bool | `true` | `false` | Warteliste möglich. Ohne sie nimmt die Season bei vollen Plätzen keine Anmeldung mehr an |
| `application_waitlist_limit` | int 1–500 | keine | keine Grenze | Höchstzahl auf der Warteliste |
| `application_waitlist_note` | str ≤ 500 | leer | kein Text | Eigener Satz zur Warteliste, steht öffentlich auf der Ligaseite |
| `entry_policy` | `all` \| `members` | `all` | `all` | Zulassung. `members`: Jeder im Kader muss Mitglied sein (dieselbe Regel wie Sichtbarkeit „Nur Mitglieder“) |
| `sibling_squads_in_staffel` | bool | `false` | `false` | Zwei Co-Teams eines Hauptteams in derselben Staffel. Ein Co-Team bleibt je Season in einer Staffel. Gilt auch fürs Zuteilen. Mit `true` lautet `identity_key` `<tid>:team:<team_id>:squad:<squad_id>` |
| `application_privacy_text` | str ≤ 2000 | leer | Platzhalter-Satz | Hinweis zum Datenschutz bei der Anmeldung. Den Wortlaut pflegt die Leitung, der Text steht mit im Antrag |

**`league_applications`** (eine Zeile je Antrag, ein neuer Antrag nach Ablehnung oder Rückzug ist eine neue Zeile):

| Feld | Typ | Bedeutung |
| --- | --- | --- |
| `id`, `league_id`, `season_id`, `team_id`, `squad_id` | str | Einordnung |
| `team_name`, `squad_name`, `display_name` | str | Schnappschuss |
| `status` | `submitted` \| `in_review` \| `accepted` \| `rejected` \| `waitlist` \| `withdrawn` | Stand |
| `active_key` | str | `<season_id>:<squad_id>`, nur an offenen Anträgen (alles außer `rejected`, `withdrawn`). Eindeutig, sparse |
| `applied_by`, `submitted_at` | str, ISO | Wer wann eingereicht hat |
| `rule_consent` | `{consent_id, rule_version_id, version, user_id, at}` | Die Fassung, der zugestimmt wurde. Dieselbe Zustimmung steht in `league_rule_consents` |
| `privacy_consent` | `{text, user_id, at}` | Der Wortlaut, dem zugestimmt wurde |
| `decided_by`, `decided_at`, `decision_reason` | str, ISO, str | Letzte Entscheidung der Leitung. Der Grund ist beim Ablehnen Pflicht |
| `withdrawn_by`, `withdrawn_at` | str, ISO | Rückzug |
| `assignment` | `{division_id, tournament_id, staffel, label, registration_id, assigned_by, assigned_at}` | Zuteilung, fehlt bis dahin. Tritt das Co-Team aus der Staffel aus, bleibt sie stehen, die Antworten sagen `staffel_left` bzw. `assignment.left`, der Platz ist frei |
| `history` | `[{status, by, at, reason?, conflict_reason?}]` | Jeder Schritt. `conflict_reason`: Grund einer Notausnahme des Superadmins (#2245) |
| `created_at`, `updated_at` | ISO | |

Indizes: `id` eindeutig, `active_key` eindeutig (sparse), (`season_id`, `status`), `squad_id`, `applied_by`.

**Zustände:** Dazu kommen zwei, die nur die Antwort kennt, weil es keinen Antrag gibt: `none` (nicht angemeldet) und `open` (Anmeldung offen). Hat ein Co-Team einen abgelehnten oder
zurückgezogenen Antrag und ist das Fenster offen, darf es neu einreichen.

| Von | Nach | Wer |
| --- | --- | --- |
| – | `submitted` | Captain oder Vertreter, Fenster offen, Prüfung leer, beide Zustimmungen |
| `submitted` | `in_review` | Leitung |
| `submitted`, `in_review`, `waitlist` | `accepted` | Leitung, nur mit freiem Platz. Prüfung wird wiederholt. Mit `tournament_id` gleich zugeteilt |
| `submitted`, `in_review` | `waitlist` | Leitung, nur wenn die Season eine Warteliste hat und sie nicht voll ist |
| `accepted` ohne Zuteilung | `waitlist` | Leitung, gibt den Platz frei |
| `submitted`, `in_review`, `waitlist`, `accepted` ohne Zuteilung | `rejected` | Leitung, Grund mindestens fünf Zeichen |
| `submitted`, `in_review`, `waitlist`, `accepted` ohne Zuteilung | `withdrawn` | Captain oder Vertreter |
| `accepted` ohne Zuteilung | `accepted` mit `assignment` | Leitung, die Prüfung wird wiederholt (`check_squad`), dazu die der Staffel (`build_registration`) |

Nichts rückt von selbst nach: Wird ein Platz frei, entscheidet die Leitung. Zugeteilt zieht niemand per Antrag zurück, das läuft über Austritt in der Teilnehmerliste.

**Prüfung** (`league_applications.check_squad`, derselbe Text für Captain und Leitung): Fenster offen, Season weder beendet noch archiviert, gültige Fassung des Regelwerks, Platz oder Warteliste frei,
kein offener Antrag und keine Anmeldung dieses Co-Teams in der Season, `squad_problems`, `registration_problems`, `entry_policy`, mindestens Mindestkader spielberechtigte Spieler (`league_eligibility.status`). Spieler ohne gültige ID stehen als Warnung da.
Mindestkader ist hier der kleinste aller aktiven Liga N. Beim Zuteilen zählt der genaue Wert der Staffel.

**Zustimmung:** Beim Einreichen schickt das Web `rule_version_id` (die Fassung, die es zeigt), `accept_rules` und `accept_privacy`. Passt die Fassung nicht mehr: 409. `rules_text` gilt hier nicht als Regelwerk, weil dazu keine Version existiert: Ohne gültige Fassung geht keine Anmeldung, die Prüfung nennt es.
Beim Zuteilen aus einem Antrag schreibt `build_registration` `accepted_rules` und `accepted_privacy` auf `true`, `registered_via: "league_application"`, `source: "league_application"`, `application_id`. Das Zuteilen ohne Antrag schreibt weiter `false`.

**Sonderweg:** Teilt die Leitung ein Co-Team mit offenem Antrag direkt zu, gilt der Antrag als angenommen und zeigt die Zuteilung (Protokoll `league.application.accept` mit `via: "squad_assign"`). Nimmt sie die Zuteilung zurück, bleibt der Antrag angenommen, ohne Zuteilung, und belegt einen Platz, bis sie neu zuteilt oder ablehnt.
Weil das Zuteilen hier über den Antrag entscheidet, gilt die Befangenheit (siehe unten): Die befangene Person bekommt 403, bevor eine Anmeldung entsteht. `POST /api/tournaments/{tid}/squad-registrations` nimmt dafür `conflict_reason` an; der Dialog „Co-Team zuteilen“ fragt nicht danach, die Absage verweist den Superadmin in den Eingang. Ohne offenen Antrag bleibt das Zuteilen ohne Befangenheit.

**Sperren:** Einreichen, Rückzug und Entscheidungen halten `league_season_resource`. Beim Zuteilen zuerst die Turnier-Sperre, dann diese. Besetzt: 409. Der Status wechselt nur mit Bedingung auf den alten Stand.

**Abgebrochenes Zuteilen:** Anmeldung und Antrag sind zwei Schreibvorgänge ohne Transaktion. Scheitert der Antrag, fällt die neue Anmeldung wieder weg. Bleibt sie stehen (Prozess stirbt dazwischen), findet `_left_over` sie über `application_id`: Annehmen und Zuteilen schließen mit ihrer Staffel ab, auch wenn eine andere gewählt ist, und zwar unter deren Sperre und mit derselben Prüfung (`check_squad`). Ist die Staffel gesperrt: 423, bis die Leitung sie entsperrt (`POST /api/tournaments/{id}/unlock`). Fällt die Prüfung durch, bleibt der Antrag stehen, die Leitung nimmt die Anmeldung aus der Teilnehmerliste. Ablehnen, Warteliste und Rückzug antworten 409, bis eines von beiden geschehen ist.

**Routen**

| Route | Wer | Zweck |
| --- | --- | --- |
| `GET /api/leagues/{liga}/{season}` | wie Season-Sichtbarkeit | zusätzlich `application`: `{state, opens_at, closes_at, slots, slots_free, waitlist, waitlist_full, waitlist_note, entry_policy}` oder `null`. Keine Personen |
| `GET /api/leagues/{liga}/{season}/application` | angemeldet, Season sichtbar | `application`, `rules`, `privacy`, `season_problems`, `squads[]`: die eigenen Co-Teams des Spiels mit `can_apply`, `state`, `application`, nur für Captain und Vertreter dazu `problems`, `warnings`. `hint`, wenn das Co-Team keinen Captain hat |
| `POST /api/leagues/{liga}/{season}/applications` | Captain, Vertreter | Einreichen `{squad_id, rule_version_id, accept_rules, accept_privacy}`. Fremdes oder unbekanntes Co-Team: 403 |
| `POST /api/leagues/{liga}/{season}/applications/{id}/withdraw` | Captain, Vertreter dieses Co-Teams | Zurückziehen |
| `GET /api/me/league-applications` | angemeldet | Letzter Antrag je eigenem Co-Team, je Season, für die Team-Seite |
| `GET /api/admin/leagues/seasons/{id}/applications` | `applications` | Eingang: `items[]` (je Antrag `own_team`, `history[].conflict_reason`), `superadmin`, `stats`, `divisions[]` |
| `POST …/seasons/{id}/applications/{aid}/review` (`{conflict_reason?}`) | `applications`, nicht befangen | In Prüfung |
| `POST …/accept` (`{tournament_id?, conflict_reason?}`), `/reject` (`{reason, conflict_reason?}`), `/waitlist` (`{reason?, conflict_reason?}`), `/assign` (`{tournament_id, conflict_reason?}`) | `applications`, nicht befangen | Entscheiden und zuteilen. Antrag oder Staffel aus einer anderen Season: 404 |

**Befangenheit** (#2245, Entscheidung Nr. 73, Regel in Abschnitt B.1): Über die Anmeldung des eigenen Teams entscheidet eine zweite Person. Befangen sind Kader des Co-Teams,
Captain, Vertreter, Leitung und Co-Leitung des Hauptteams und wer den Antrag eingereicht hat, auch mit Zuständigkeit `applications` oder Bereich `leagues`. Prüfen, Annehmen, Ablehnen,
Warteliste und Zuteilen antworten ihnen 403 („Über dein eigenes Team entscheidet eine andere Person.“), geprüft vor allem anderen und unter der Season-Sperre direkt vor dem Schreiben noch einmal (auch im Sonderweg), der Antrag bleibt unverändert. Kaderänderungen laufen nicht unter dieser Sperre. Anträge anderer Teams
derselben Season entscheidet die Person weiter. Der Superadmin geht als Notausnahme durch, mit `conflict_reason` (mindestens fünf Zeichen, sonst 403). Der Grund steht im Verlauf
(`history[].conflict_reason`), im Protokoll der Entscheidung (`league.application.*`, `data.conflict_override`) und unter `league.conflict.override` (`action: "application_<schritt>"`).
Der Eingang meldet `own_team` nach derselben Regel (`belongs_to_side`) und `superadmin`: Beim eigenen Team stehen statt der Knöpfe der Satz, beim Superadmin dazu das Feld
„Grund für die Notausnahme“.

**Benachrichtigungen:** Art `tournament_registration`, `meta.reason` `league_application_submitted`, `_accepted`, `_rejected`, `_waitlist`, `_assigned`, `_withdrawn`, Schlüssel `league-application:<id>:<status>:<schritt>:<user>`. An Captain und Vertreter (ohne beide die Hauptteam-Leitung), bei `submitted` und `withdrawn` auch an die Leitung (`applications`). Mail über `send_league_mail`.

**Datenschutz:** Gäste sehen Fenster und freie Plätze, keine Anträge. Andere Teams sehen nichts von einem Antrag. Den Grund einer Ablehnung sehen Captain, Vertreter, Leitung und Co-Leitung des Hauptteams und die Liga-Leitung, zurückziehen dürfen nur Captain und Vertreter (`can_withdraw`). Auskunft: `league_applications`, in denen die Person steht, mit den eigenen Zustimmungen und eigenen Schritten (`my_steps`), ohne Kennungen anderer. Wer nur als Liga-Leitung handelte, bekommt wie im Adminprotokoll nur den Vorgang (Kennung des Antrags, Season, Schritt, Zeitpunkt), ohne Team und Grund. Kontolöschung: Der Antrag gehört dem Co-Team und bleibt, die Kennung der Person fällt überall heraus (`applied_by`, Zustimmungen, `withdrawn_by`, `decided_by`, `history[].by`). Den Grund einer Notausnahme (`history[].conflict_reason`) enthält die Auskunft der Liga-Leitung nicht (Vorgang ohne Inhalt wie im Adminprotokoll), bei der Kontolöschung bleibt er im Verlauf, ohne Person. Kein Geburtsdatum in Antworten.

**Löschen:** Eine Season mit Anträgen lässt sich nicht löschen (`delete-plan`, Hinweis auf Archivieren). Ein Co-Team mit offenem Antrag lässt sich erst nach dem Rückzug löschen, ein Hauptteam mit solchem Co-Team nicht auflösen.

**Audit-Aktionen neu:** `league.application.submit`, `.withdraw`, `.review`, `.accept`, `.reject`, `.waitlist`, `.assign`.

### C.1 Spielmodi (#2206)

Modi bleiben in `games.match_modes[]`, kein zweites Modussystem. C.1 **speichert, prüft und zeigt** die neuen Felder. Endstände
gegen die Ergebnisregel prüft erst C.3 (#1617), ebenso das Übernehmen der Regel in die Season. Kein Wert eines Titels steht im
Code; Beispiele in Seeds und Tests sind erfunden. Logik in `models.GameMatchMode`, `services/game_modes.py` (Zustand, Auswahl),
`services/game_usage.py` (Verwendung). **Migration: keine.**

**Felder je Modus** (alle neuen optional; fehlt ein Feld, wird es nicht geschrieben und alles verhält sich wie vorher):

| Feld | Typ | Fehlt | Bedeutung |
| --- | --- | --- | --- |
| `mode` | str ≤ 40 | aus dem Namen | Kennung und Identität des Modus. Maps, Pools, Reihenfolgen, Turniere und Spiele zeigen auf sie |
| `label` | str 1–60 | Pflicht | Name, darf sich ändern |
| `minutes`, `per_game` | wie bisher | wie bisher | Dauerplanung (#1554), unverändert |
| `status` | `active` \| `inactive` \| `archived` | `active` | Zustand, siehe unten |
| `description` | str ≤ 500 | – | Beschreibung; wie alle Spieldaten über `GET /api/games` lesbar |
| `players_per_side` | int 1–64 | – | Spielerzahl je Seite |
| `format` | str ≤ 60 | – | Freitext, etwa die Regel-Variante des Modus |
| `result_rule` | Objekt | keine Regel | Ergebnisregel, siehe unten |

**`result_rule`** (gespeichert und angezeigt, noch nicht angewandt):

| Feld | Typ | Regel |
| --- | --- | --- |
| `kind` | `score` \| `rounds` \| `highest` | Pflicht. `score`: Punkte bis zum Ziel. `rounds`: Runden gewinnen. `highest`: höherer Endstand gewinnt, ohne Ziel |
| `target` | int 1–100 000 | Pflicht bei `score` und `rounds` (Zielpunkte bzw. Rundensiege), bei `highest` nicht erlaubt |
| `round_limit` | int 1–999 | nur bei `rounds`, mindestens `target` |
| `time_limit_minutes` | int 1–600 | Zeitlimit je Map, freiwillig |
| `draw_allowed` | bool | Remis erlaubt, Vorgabe `false` |
| `overtime` | bool | Verlängerung bei Gleichstand, Vorgabe `false` |

Unpassendes lehnt der Server mit 422 und deutschem Satz ab, gekürzt oder still verworfen wird nichts, auch kein unbekanntes Feld
in `result_rule`.

**Namen:** Innerhalb eines Spiels heißt jeder Modus anders (ohne Groß und klein, Leerraum zusammengefasst), sonst 422 beim Anlegen
und Ändern. Gleiche Namen aus Altbestand bleiben speicherbar, solange keine neue Dublette dazukommt.

**Zustände:**

| Zustand | Neu wählbar | Verwaltung | Bestehendes |
| --- | --- | --- | --- |
| `active` (oder fehlt) | ja | sichtbar | – |
| `inactive` | nein: neuer Map-Pool, Modus je Map der Season, Spielmodus des Turniers oder einer Phase | in Auswahllisten nur, wo er schon gesetzt ist, mit „(inaktiv)“ | bleibt gültig und sichtbar |
| `archived` | nein, dazu keine neue Zuordnung an Maps | zusätzlich aus allen Auswahllisten ausgeblendet, außer wo er schon gesetzt ist | bleibt gültig und sichtbar |

- „Neu“ heißt: Der Wert war vorher nicht gesetzt. Ein schon gesetzter Modus hält kein anderes Speichern auf (Muster
  `game_usage.chosen_is_archived`): ein Pool mit dem Modus in seiner geltenden Version, eine Season mit ihm in `game_mode_order`, ein
  Turnier mit ihm als `game_mode`, eine Phase mit ihm in `settings.game_mode`, eine Map mit ihm in `modes`. Wechselt ein Turnier das
  Spiel, ist nichts „schon gesetzt“: Der mitgenommene `game_mode` wird gegen das neue Spiel geprüft, auch ohne `game_mode` im Aufruf.
- **Unberührt:** fertige und laufende Spiele, festgehaltene Pools (`map_pool_id`), `effective_pool`, `map_pools.allowed`, das
  Kopieren Season → Staffel (`copy_version`), `GET /api/games` (inaktive und archivierte Modi stehen weiter in `match_modes`) und
  die Dauerplanung: `match_duration.game_mode` nimmt wie bisher den gewählten Modus, sonst den ersten, ohne Blick auf den Zustand.
- **Meldeformular:** Es zeigt die Modi des geltenden oder festgehaltenen Pools. Ein inaktiver Modus darin bleibt meldbar, bis ein
  neuer Pool ohne ihn gespeichert ist. So bricht eine laufende Season nicht ab.
- Die Referenz-Ligen (`team_league_maps.py`) lesen die Modi unverändert.

**Entfernen:** Nur ein unbenutzter Modus lässt sich entfernen, auch direkt über die API (`PATCH`/`PUT /api/games/{id}`, auch
`match_modes: null`). Verwendet heißt (`game_usage.mode_usage`): steht in einer Version eines Map-Pools des Spiels (jede Version,
außer dem Standard-Pool `game_default`), in `game_mode_order` einer Season oder Staffel, als `game_mode` eines Turniers, in
`settings.game_mode` einer Phase, in `games[]`, einer Meldung oder einem gehaltenen Ergebnis eines Spiels oder in einem
Ergebnisblatt einer Referenz-Serie des Spiels. Sonst 409: „Der Modus „…“ wird verwendet (…). Entfernen geht nicht – stell ihn auf
inaktiv oder archiviert.“ Die Zuordnung an Maps zählt nicht als Verwendung: Ein unbenutzter Modus verschwindet beim Entfernen wie
bisher auch aus den Maps (Rückfrage mit Zahl). `GET /api/games/{id}/usage` trägt je Modus zusätzlich `pool_versions`, `staffeln`,
`matches`, `references` und `in_use`.

**Umbenennen:** Die Kennung `mode` ist die Identität und ändert sich nie. Die Verwaltung schickt sie bei jedem Speichern mit.
Ein Eintrag ohne Kennung, dessen Name einem bestehenden Modus gleicht (ohne Groß und klein), bekommt dessen Kennung; passt er zu
mehreren noch freien Modi (Altbestand), gibt es 422 statt einer geratenen Kennung. Jeder andere
Eintrag ohne Kennung ist ein neuer Modus; ein alter Modus, dessen Kennung fehlt, gilt als entfernt (siehe oben). Eine neue Kennung
für einen verwendeten Modus gibt es also nicht. Gelesen werden Modi überall über die Kennung; Namen stehen nur als Schnappschuss
in Pools (`label`) und Spielen (`mode_label`) und bleiben dort, wie sie waren.

**App:** liest `match_modes` nicht, nur `map_pool.modes` (Schnappschuss). Antworten bekommen nur Felder dazu.

**Bekannte Grenze:** Prüfen und Schreiben beim Entfernen sind zwei Schritte. Speichert jemand in genau diesem Moment einen Pool mit
dem Modus, kann der Pool auf einen entfernten Modus zeigen. Das ist der Zustand von vor C.1 und wird gelesen wie bisher.

### C.2 Maps und Pools (#2207)

Maps bleiben in `game_maps`, Pools in `map_pools` mit unveränderlichen Versionen. C.2 gibt Maps einen Zustand wie den Modi, prüft
Pools gegen Reihenfolge und Wiederholungsregel der Season und bündelt alles in einer Prüfung vor der Veröffentlichung. Logik in
`services/game_maps.py` (Zustand), `services/map_pools.py` (Vergleich, Map herausnehmen), `services/league_pool_check.py`
(Mindestgröße, Länge der Reihenfolge, betroffene Seasons) und `services/league_readiness.py` (Prüfung). Kein Wert eines Titels steht
im Code. **Migration: keine.** Unberührt: `map_pools.allowed`, `effective_pool`, die Versionen selbst, festgehaltene Pools
(`map_pool_id`), fertige Spiele, der Vertrag `games[]`, die Dauerplanung, die Referenz-Ligen und alle anderen Formate.

**Zustand einer Map** (`game_maps.status`, fehlt = aktiv):

| Zustand | Neu in einen Pool | Bibliothek der Verwaltung | Bestehendes |
| --- | --- | --- | --- |
| `active` (oder fehlt) | ja | sichtbar | – |
| `inactive` | nein. Im selben Pool, wo sie schon im selben Modus steht, bleibt sie beim nächsten Speichern erlaubt | sichtbar mit „inaktiv“; der Pool-Editor zeigt sie nur, wo sie schon gewählt ist | bleibt gültig und meldbar |
| `archived` | nein, auch nicht im selben Pool (wie bisher) | nur mit „Archivierte zeigen“ | bleibt gültig und meldbar; der Pool-Editor nennt sie als „geändert“ |

- `PATCH /api/games/{id}/maps/{map_id}` nimmt `status: "inactive"` an. Die Antwort trägt zusätzlich `affected_seasons` und
  `warning`, wenn die Map beim Deaktivieren oder Archivieren im geltenden Pool einer Season im Entwurf oder in einer laufenden
  Season steht (Pool der Season oder einer ihrer Staffeln). **Nur Warnung, keine Sperre.** Vorab fragt die Verwaltung
  `GET /api/games/{id}/maps/{map_id}/usage`: `{pools, affected_seasons: [{season_id, season_name, league_id, league_name, status,
  in_season_pool, staffeln}]}`.
- **Löschen** geht wie bisher nur, wenn die Map in keiner Pool-Version (außer dem Standard-Pool) und keinem Ergebnisblatt steht. Neu
  zusätzlich: nicht in `games[]`, einer Meldung oder einem gehaltenen Ergebnis eines Spiels. Sonst 409 „… bitte archivieren statt
  löschen“.
- Gelesen wird der Zustand nur beim Speichern eines Pools und in der Verwaltung. Melden, Bestätigen, Veto und `effective_pool` lesen
  den Snapshot im Pool, nie den Zustand der Map.

**Pool-Versionen vergleichen:** `GET /api/admin/leagues/seasons/{id}/map-pool/versions` listet die Versionen der Season (neueste
zuerst, `{id, version, saved_at, saved_by, note, cleared, maps}`). `GET …/map-pool/compare?base=<Nr>&target=<Nr>` stellt zwei
gegenüber: `{base, target, modes: [{mode, label, added: [{map_id, name}], removed: [...], kept: Zahl, status: "added"|"removed"|"changed"|"same"}], same}`. Die Reihenfolge innerhalb eines Modus zählt nicht als Änderung. Recht: jede Zuständigkeit der Liga.

**Mindestgröße je Modus** (`league_pool_check.requirements`): Die längste Serie der Season ist das größte Best of aus Season und
aktiven Liga N (`max_maps`). Mit `game_mode_order` zählt jeder Modus so oft, wie er in den ersten `max_maps` Positionen steht
(zyklisch wie beim Melden). Daraus je Modus:

| `map_repeat` | braucht je Modus | dazu |
| --- | --- | --- |
| `always` | 1 | – |
| `other_mode` (Vorgabe) | so viele Maps, wie der Modus Positionen hat | – |
| `never` | ebenso | Modi zusammen genug verschiedene Maps (jede Teilmenge der Modi der Reihenfolge, Satz von Hall) |

Ohne Reihenfolge (Modus frei) gilt: `always` 1 Map, `other_mode` so viele Paare aus Modus und Map wie `max_maps`, `never` so viele
verschiedene Maps wie `max_maps`. Neues Season-Feld `pool_min_maps: [{mode, min_maps}]` (optional, `min_maps` 1–50, `mode` ein Modus
des Spiels, `null` für Spiele ohne Modi) überschreibt die Ableitung je Modus nach oben oder unten; fehlt es, gilt die Ableitung. Es
gehört nur der Season, die Staffel trägt es nicht. Zu klein: **Warnung** beim Speichern des Pools (`warnings[]` in der Antwort), in
der Prüfung ein Problem.

**Länge der Reihenfolge:** `game_mode_order` ist leer oder genau `max_maps` lang. Gespeichert wird beim Anlegen und Ändern der Season
(nur wenn sich Reihenfolge oder Best of ändern) und beim Ändern einer Liga N (nur wenn sich ihr Best of ändert). Season im Entwurf:
422. Season läuft schon (jeder Stand außer Entwurf): nur Warnung (`warnings[]`), damit Altbestand speicherbar bleibt.

**Map in einem Schritt sperren:** `POST /api/admin/leagues/seasons/{id}/map-pool/remove-map` mit `{map_id, mode?, reason,
expected_version?}` (Recht `season`). Ohne `mode` fällt die Map aus allen Modi. Der Server legt aus der geltenden Version eine neue an
(Snapshot ohne neue Prüfung gegen die Bibliothek, wie `copy_version`), überträgt sie auf alle Staffeln der Season (derselbe Weg wie
beim Übertragen, auch gesperrte und laufende Staffeln) und schreibt `league.season.map_pool.remove_map` mit Grund, Map, Modus, neuer
Version und je Staffel dem Ergebnis. Grund mindestens fünf Zeichen. 404 ohne Pool oder wenn die Map nie im Pool stand; 422, wenn der Pool
leer würde oder ein Modus der Reihenfolge keine Map mehr hätte; 409 bei einer älteren `expected_version`. Antwort:
`{pool, staffeln[], warnings[], unchanged}`. Alte Versionen, festgehaltene Pools und fertige Spiele bleiben.

- **Alles unter Sperren:** zuerst die Turnier-Sperren aller Staffeln der Season (feste Reihenfolge), dann die Sperre des Season-Pools
  (`mutation_lock.league_season_pool_resource`). Dieselbe Pool-Sperre halten `PUT` und `DELETE …/map-pool` und das Anlegen einer
  Staffel (`league_service.create_staffel`, die einzige Stelle, die einer Season eine Staffel hinzufügt; belegt: 409 „bitte gleich noch
  einmal“). Ist eine Sperre belegt oder kommt währenddessen eine Staffel dazu: 409, es wird nichts geschrieben.
- **Genau diese Version:** Übertragen wird die gerade angelegte Version, nie eine, die danach entsteht (`league_service.transfer_pool`
  mit `pool`). Eine Staffel mit denselben Maps bekommt keine neue Version.
- **Erneut ausführen:** Steht die Map schon nicht mehr im geltenden Pool, aber in einer früheren Version, entsteht keine neue Version
  (`unchanged: true`); übertragen wird nur, was einer Staffel noch fehlt. Das Protokoll trägt `new_version`.

**`season_readiness`** (`GET /api/admin/leagues/seasons/{id}/readiness`, jede Zuständigkeit der Liga):
`{ok, problems: [{code, text}], warnings: [{code, text}], requirements: [{mode, label, derived, override, needed, have}], max_maps,
superadmin}`.

| Code | Art | Wann |
| --- | --- | --- |
| `pool_missing` | Problem | kein geltender Pool der Season |
| `pool_stale` | Problem | der Pool gehört zu einem anderen Spiel |
| `pool_too_small` | Problem | ein Modus oder die Modi zusammen haben zu wenige Maps (Mindestgröße oben) |
| `mode_order_length` | Problem | Reihenfolge nicht leer und nicht `max_maps` lang |
| `mode_order_missing` | Problem | ein Modus der Reihenfolge fehlt im Pool |
| `rules_missing` | Problem | kein gültiges Regelwerk (B.2), ein Regeltext allein reicht nicht |
| `rules_upcoming` | Warnung | es gibt nur eine Fassung, die erst später gilt (kein Problem, wenn eine schon gilt) |
| `divisions_missing` | Problem | keine aktive Liga N |
| `staffel_missing` | Problem | eine aktive Liga N ohne Staffel |
| `application_after_start` | Problem | das Anmeldefenster (B.4) endet nach dem Beginn der Season |
| `application_closed` | Warnung | das Anmeldefenster ist schon vorbei |
| `application_none` | Warnung | kein Anmeldefenster: keine Selbstanmeldung |
| `inactive_mode` | Warnung | ein inaktiver oder archivierter Modus im Pool oder in der Reihenfolge |
| `inactive_map` | Warnung | eine inaktive, archivierte oder gelöschte Map im Pool |

**Veröffentlichen:** Wechselt die Sichtbarkeit einer Season von `off` oder `admins` auf `members` oder `public` (auch beim Anlegen mit
einer dieser Sichtbarkeiten), prüft der Server vor dem Schreiben auf dem neuen Stand. `admins` („Nur Liga-Leitung“) ist **Vorschau** und
wird nicht geprüft (Entscheidung zu #2207). Probleme: 409 „Veröffentlichen geht noch nicht: …“, nichts wird gespeichert. Warnungen halten
nichts auf. Notausnahme nur für den Superadmin mit `readiness_override_reason` (mindestens fünf Zeichen, sonst 409) im selben Aufruf;
Protokoll `league.season.readiness_override` mit Grund und den Codes. Von `members` auf `public` (schon veröffentlicht) und zurück auf
`admins` oder `off` prüft nichts. Bekannte Grenze: Prüfen und Schreiben sind zwei Schritte.

**Verwaltung:** Season-Seite mit Abschnitt „Prüfung vor der Veröffentlichung“ (Probleme, Warnungen, Mindestgröße je Modus mit Feld
zum Überschreiben, beim Superadmin das Feld für den Grund), „Map sperren“ und „Versionen vergleichen“ am Map-Pool. Maps einer
Bibliothek: Knopf „Deaktivieren“ mit Rückfrage, die betroffene Seasons nennt.

**App:** liest nur den Snapshot `map_pool.modes` und keine Map-Zustände. Antworten bekommen nur Felder dazu.

**Audit-Aktionen neu:** `league.season.map_pool.remove_map`, `league.season.readiness_override`.

### C.3 Ergebnisregeln (#1617)

C.3 wendet die Ergebnisregel der Modi (C.1) auf Liga-Meldungen an. Nur Staffeln sind betroffen: Andere Turniere, Seasons und
Staffeln ohne die neuen Felder und Maps ohne Regel verhalten sich wie vorher. Logik in `services/league_result_rules.py`, Verwaltung
in `routes/league_result_rule_routes.py`, Prüfung in `league_games.normalize_games`. Keine Werte eines Titels im Code.
**Migration: keine.**

**Season** (`league_seasons`, beide Felder optional):

| Feld | Typ | Fehlt | Bedeutung |
| --- | --- | --- | --- |
| `result_rules` | `{mode: result_rule}` | keine Prüfung | Festgehaltene Kopie der Regeln je Modus, Form wie C.1. Eine neue Season kopiert beim Anlegen die Regeln aller Modi des Spiels, die eine haben. Je Modus darf die Season abweichen; ein Modus ohne Eintrag hat in der Season keine Regel |
| `scores_required` | bool | `false` | Punkte je Map Pflicht, ein Feld für alle Modi (jede Map bekommt ihren Endstand). Neue Seasons: `true` |

- **Festgehalten wie ein Pool:** Ändert jemand später die Regel am Modus, bleibt die Season, wie sie ist. Die Verwaltung zeigt je
  Modus die Regel der Season und die des Spiels und markiert Abweichungen. „Vom Spiel übernehmen“ ist eine Handlung der Leitung.
- **API:** `GET /api/admin/leagues/seasons/{id}/result-rules` (jede Zuständigkeit der Liga) liefert `scores_required`, je Modus
  `{mode, label, status, season_rule, game_rule, differs}` und `staffeln`. `PUT` (Recht `season`) nimmt
  `{scores_required, rules: {mode: result_rule | null}}` und ersetzt die Kopie ganz. Neue Regeln nur für Modi des Spiels, die
  schon in der Season stehenden bleiben speicherbar; geprüft wie C.1 (`GameModeResultRule`), sonst 422 mit deutschem Satz.
  Protokoll `league.season.result_rules` mit den geänderten Modi und `scores_required`, ohne Werte.
- **Staffel:** `staffel_fields` kopiert beide Felder, wenn die Season sie trägt. Übertragen in der eigenen Gruppe `result_rules`
  („Ergebnisregeln und Punktepflicht“), die wie **laufend** wirkt (auch nach Start und Ergebnis, nicht bei gesperrten Staffeln): Die
  Regel prüft nur neue Eingaben, gespeicherte Ergebnisse bleiben. Der Turnierkern liest nur `tournaments.result_rules` und
  `tournaments.scores_required`. Tests, die nicht diese Regel prüfen, schalten die Punktepflicht mit
  `league_match_world.without_score_duty` aus.

**Prüfung je Map** (Melden, Bestätigen, Ergebnis und Korrektur der Leitung; Regel = `result_rules[mode]` der Staffel):

| Fall | Regel | Satz (Beispiel) |
| --- | --- | --- |
| Punktepflicht | beide Seiten haben Punkte | „Map 1: bitte die Punkte beider Seiten eintragen – in dieser Liga sind sie Pflicht.“ |
| Mit Regel | Punkte beider Seiten oder keine; bei `score` und `rounds` ganze Zahlen | „Map 1: bitte die Punkte beider Seiten eintragen.“ |
| Sieger | der Sieger hat mehr Punkte; Gleichstand nur mit `draw_allowed` | „Map 1: Der Endstand 100:250 passt nicht zum Sieger – mehr Punkte hat Horst.“ |
| `score` ohne `overtime` | Sieger höchstens `target`, Verlierer unter `target` | „Map 1: höchstens 250 Punkte – die Map endet beim Ziel (Endstand 251:240).“ |
| `rounds` ohne `overtime` | Runden zusammen höchstens `round_limit`, Sieger höchstens `target` | „Map 1: höchstens 11 Runden – 7:5 sind 12.“ |
| `score`, `rounds` ohne `time_limit_minutes` | der Sieger erreicht `target` (die Map endet nur dort) | „Map 1: Die Map endet erst bei 6 gewonnenen Runden – der Sieger hat 5.“ |
| `highest` | nur „Sieger hat mehr“ | – |

Mit `overtime` dürfen Ziel und Rundenlimit überschritten werden. Gleichstand mit `draw_allowed` wird angenommen; die Serie braucht
trotzdem einen Sieger der Map (Datenmodell ohne Map-Remis, offene Fachfrage). Beispiele: S&D mit Ziel 6 und Limit 11: 6:5 geht,
7:5 nicht.

- **Bestätigen:** Es zählen die Punkte der ersten Meldung (unverändert). Schickt die bestätigende Seite keine Punkte, prüft der
  Server mit denen der Gegenseite – sonst scheiterte jede Bestätigung an der Punktepflicht. Die App bestätigt ohne Maps wie bisher.
- **Regelstand der Erstmeldung:** Jede Meldung mit Maps hält fest, mit welchem Regelstand sie geprüft wurde
  (`reports[].result_rule_snapshot = {result_rules, scores_required}`). Es gilt die Regel, die bei der Erstmeldung galt: Die
  Bestätigung im Browser prüft mit dem Schnappschuss der Meldung der Gegenseite, App-Bestätigung und 48-h-Automatik übernehmen deren
  schon geprüfte Maps. Ein Regelwechsel dazwischen (Übertragen) ändert daran nichts. Meldungen ohne Schnappschuss (Altbestand)
  prüfen nichts Neues. Die Matchseite zeigt der bestätigenden Seite den Regelstand der Erstmeldung. Die Korrektur der Leitung
  (`/result`) prüft immer die aktuelle Regel der Staffel.
- **Best of** (unverändert): Siegschwelle ⌊N/2⌋+1, keine Map nach der Entscheidung; im BO5 ohne Remis nur 3:0, 3:1, 3:2.
- **Korrektur der Leitung** (`/result`, auch mit `force`): dieselben Prüfungen. Übergehen darf die **Liga-Leitung mit der
  Zuständigkeit „Ergebnisse“** (`results`, Bereich Ligen oder Zuständigkeit dieser Liga; Entscheidung des Obmanns 03.11.) mit
  `rule_override_reason` (Pflichtgrund, mindestens fünf Zeichen, sonst 422; ohne Recht 403) – nur Ergebnisregel und Punktepflicht,
  nie Best of, Pool oder Aufstellung. Im eigenen Spiel entscheidet wie überall eine zweite Person (Befangenheit wie B.1,
  `require_no_conflict`); der Superadmin bleibt Notausnahme mit `conflict_reason`. Captains nie (`/result` ist Leitung). Protokoll
  `match.games.rule_override` mit Grund. Die Matchseite meldet es mit `league.can_override_rules` (wer Ergebnisse eintragen darf).

**`games[]` erweitert** (alle optional, geschrieben nur wenn gesetzt; `same_outcome`, `derived_results`, Konsens, Tabelle und App
lesen sie nicht):

| Feld | Typ | Regel |
| --- | --- | --- |
| `status` | `played` \| `replayed` | fehlt = gespielt (`played` wird nicht geschrieben). `replayed`: Endstand und Sieger stammen aus einer Wiederholung der Map |
| `replay_reason` | str 5–200 | Pflicht bei `replayed`, sonst nicht erlaubt |
| `decision` | `awarded` | Wertung: Map von der Leitung zugesprochen (nur `/result`), ohne Punkte; Regel und Punktepflicht entfallen |
| `host_registration_id` | str | Seite bzw. Host der Map, eine der beiden Anmeldungen |
| `proof_id` | str | Nachweis: ein Foto dieses Spiels (`match_proof_photos`), schon angehängt oder mit derselben Meldung angehängt |

- **`not_played`** steht nie in `games` – alle Leser zählen dort gespielte Maps. Die Matchseite liefert im Block `league`
  `not_played: [Position]`: die Positionen nach dem Serienende bis `best_of`.
- Matchseite: „wiederholt“ und „zugesprochen“ an der Map; `proof_id` sehen nur Beteiligte und Leitung (wie Aufstellungen).
- Öffentlich: `status`, `replay_reason`, `decision` und `host_registration_id` stehen (nur wenn gesetzt) in beiden
  `PUBLIC_GAME_FIELDS` (`match_public_view`, `league_page`), `proof_id` nie. Die Ligaseite (`StaffelPanel`) zeigt „wiederholt“,
  „zugesprochen“ und je Spiel `not_played` wie die Matchseite.

**Meldeformular und Ergebnis-Fenster:** zeigen je Map die Regel („bis 250 Punkte“, „6 Runden, höchstens 11“), bei Punktepflicht
die Punktefelder ohne „freiwillig“ und prüfen vorab mit denselben Sätzen (`leagueResultRules.js`). Der Server bleibt maßgeblich.
Der Block `league` der Matchseite trägt dazu `result_rules` (nur Modi des Pools) und `scores_required`.

**Map-Wiederholung** (Nr. 15) gibt es seit #2096 (`map_repeat` an Season und Staffel, Vorgabe `other_mode`); C.3 baut nichts dazu.

### C.4 Ausrüstung (#2218)

Waffen, Aufsätze und übrige Ausrüstung stehen einmal je Spiel in einer Bibliothek (Muster `game_maps`), die Season wählt daraus eine
**Sperrliste** in unveränderlichen Versionen (Muster `map_pools`). Alles ist erlaubt außer dem, was auf der Sperrliste steht. Logik in
`services/game_equipment.py` (Kategorien, Bibliothek, Import) und `services/loadout_bans.py` (Versionen, Vergleich, Staffel und Spiel,
Baustein). Routen in `routes/game_equipment_routes.py` und `routes/league_loadout_routes.py`. Kein Wert eines Titels steht im Code.
Verwaltung: Reiter **Ausrüstung** der Spielseite (`/admin/games/<Spiel>#ausruestung`, #2249; `…/equipment` leitet dorthin) und Abschnitt
„Sperrliste“ der Season.
**Migration: keine.** Ohne Sperrliste verhält sich alles wie vorher.

**Grenze:** Das System prüft nicht, was im Spiel benutzt wird. Verstöße laufen über Protest und Strafe.

**Kategorien je Spiel** (`game_equipment_categories`, eine Zeile je Spiel: `{game_id, categories[], updated_at, updated_by}`):

| Feld | Typ | Regel |
| --- | --- | --- |
| `key` | str ≤ 40 | Kennung aus dem Namen beim Anlegen, ändert sich nie |
| `label` | str 1–40 | Name, je Spiel nur einmal (ohne Groß und klein) |
| `role` | `weapon` \| `attachment` \| `item` | Waffe (kann Aufsätze haben), Aufsatz (passt zu Waffen), sonstige Ausrüstung |

Höchstens 20 Kategorien. Ohne Kategorien bietet die Verwaltung einen Vorschlag an (Waffen, Aufsätze, Perks, Ausrüstung,
Abschussserien); gespeichert wird er erst auf Knopfdruck. Eine Kategorie mit Einträgen lässt sich nicht entfernen und ihre Rolle nicht
ändern (409), umbenennen geht.

**Einträge** (`game_equipment`):

| Feld | Typ | Regel |
| --- | --- | --- |
| `id`, `game_id` | str | Kennung, Spiel |
| `category` | str | Kennung einer Kategorie des Spiels |
| `name` | str 1–80 | je Spiel und Kategorie nur einmal (ohne Groß und klein, Leerraum zusammengefasst; 409) |
| `image_url` | str \| `null` | nur eigener Upload (`game_maps.IMAGE_URL`) mit Eintrag in `media_uploads`; ohne Medienrolle (`ADMIN_MEDIA_ROLES`) nur eigene mit `media_scope: "user"` – wie im Regelwerk (#2230), auch beim Import; ein Bild, das der Eintrag schon trägt oder aus der Quelle mitbringt, braucht nur den Eintrag. Sonst 422. Frühere stehen in `image_history` |
| `note` | str ≤ 500 | nur für die Verwaltung |
| `weapon_ids` | [str] | nur Rolle `attachment`: Waffen dieses Spiels, zu denen der Aufsatz passt. **Leer = passt zu keiner Waffe** (Obmann, 03.11.): Speichern geht, an einer Waffe sperren lässt er sich erst mit Zuordnung. `GET …/equipment` nennt sie in `attachments_without_weapon`, `POST …/equipment/assign-weapons {weapon_ids}` ordnet allen nicht archivierten auf einmal Waffen zu (Protokoll `game.equipment.assign_weapons`) |
| `status` | `active` \| `inactive` \| `archived` | Zustand wie bei Maps (C.2), fehlt = aktiv |
| `archived_at`, `created_at`, `created_by`, `updated_at`, `updated_by` | | |

Höchstens 1000 Einträge je Spiel, archivierte zählen mit. Indizes: `id` eindeutig; (`game_id`, `category`, `name_key`) eindeutig.

| Zustand | Neu auf eine Sperrliste | Verwaltung | Bestehendes |
| --- | --- | --- | --- |
| `active` | ja | sichtbar | – |
| `inactive` | nein. Steht er in der geltenden Version derselben Season (gleiche Art, bei Aufsätzen an derselben Waffe), bleibt er beim nächsten Speichern erlaubt | sichtbar mit „inaktiv“ | bleibt gültig |
| `archived` | nein, auch nicht in derselben Liste | nur mit „Archivierte zeigen“; der Editor nimmt ihn mit Hinweis heraus | bleibt gültig |

**Löschen** nur, wenn der Eintrag in keiner Version einer Sperrliste steht (auch nicht als Aufsatz), sonst 409 „… bitte archivieren
statt löschen“. Wird eine unbenutzte Waffe gelöscht, fällt sie aus den `weapon_ids` der Aufsätze.

**Aus einer anderen Spielversion übernehmen:** wie bei Maps. Die Kategorie passt über Kennung oder Namen; fehlt sie im Ziel, wird sie
mit Name und Rolle angelegt (wenn noch Platz ist). Aufsätze bekommen die Waffen des Ziels mit gleichem Namen; gibt es keine davon, kommen sie
ohne Zuordnung (passen dann zu keiner, Hinweis in der Bibliothek). Das Bild wird mitverwendet. Was schon da ist oder nicht passt, steht mit
Grund in `skipped`.

**Sperrliste** (`loadout_bans`): jedes Speichern legt eine neue, unveränderliche Version an. `scope` `league_season` (Vorlage) oder
`tournament` (Kopie der Staffel). Felder: `id`, `scope`, `scope_id`, `tournament_id`, `game_id`, `version`, `cleared`, `note`,
`created_at`, `created_by`, `entries[]`. Index (`scope`, `scope_id`, `version`) eindeutig wie bei Pools: gleichzeitiges Speichern wird 409.

| Feld je Eintrag | Inhalt |
| --- | --- |
| `kind` | `item`: der Eintrag ist gesperrt. `attachments`: nur bei Waffen – die Waffe bleibt erlaubt, die genannten Aufsätze sind an ihr gesperrt |
| `item_id`, `name`, `category`, `category_label`, `role`, `image_url` | Schnappschuss des Eintrags von damals |
| `modes`, `mode_labels` | Modi, in denen die Sperre gilt; leer = alle Modi |
| `attachments[]` | nur bei `attachments`: `{item_id, name, image_url}`, mindestens einer |

Je Eintrag höchstens eine Zeile je Art, höchstens 500 Zeilen. Prüfung beim Speichern (422 mit deutschem Satz): Eintrag gehört zum Spiel,
Zustand wie oben, Modi des Spiels (`game_modes.choice_problem`, ein schon gesetzter inaktiver Modus bleibt), `attachments` nur an Waffen,
jeder Aufsatz ist der Waffe zugeordnet (`weapon_ids` mit der Waffe; leer: „keiner Waffe zugeordnet“), keine Aufsatz-Zeile an einer Waffe, die in allen Modi ganz gesperrt
ist. Leere Liste: 422 „… oder die Sperrliste entfernen“. `expected_version` schützt wie beim Pool (0 = bisher keine).

**Season → Staffel → Spiel:** Eine neue Staffel bekommt die geltende Version als eigene (`copy_version`, unter der Pool-Sperre der
Season). „Vorgaben auf Staffeln übertragen“ überträgt sie immer, auch auf gesperrte und laufende Staffeln (eigene Gruppe `loadout_bans`
„Sperrliste“). Hat die Season keine mehr, fällt die Kopie der Staffel nur vor dem ersten Ergebnis und nicht gesperrt weg. Das Spiel hält
seine Version fest: `matches_v2.loadout_ban_id` (optional) setzt das erste Festschreiben eines Ergebnisses einer Staffel, zusammen mit
`rule_version_id` – die Kennung der geltenden Version oder ausdrücklich `null` für „keine Liste“. Eine Korrektur lässt es stehen,
„Rückgängig“ nimmt es mit. Ein Fehler beim Ermitteln wird nicht verschluckt. Gilt für ein Spiel: Vermerk vorhanden → diese Version bzw.
keine; ohne Vermerk und fertig (`completed`, `forfeit`, Altbestand vor C.4) → keine; sonst die Version der Staffel → keine. Andere Formate
schreiben das Feld nie.

**Regelwerk:** Baustein `[[baustein:loadout_bans]]` „Sperrliste“ (für Anlage A gedacht, steht überall). Je Kategorie eine Tabelle mit
Bild, Name und „Gilt in“, danach die Aufsätze an erlaubten Waffen. Ohne Sperrliste: „Für diese Season ist keine Sperrliste hinterlegt –
alles ist erlaubt.“ **Eingefroren wird strukturiert im Klartext** (Folge-Review): je Baustein `{label, source, data}` – für die Sperrliste
`data = {list, groups: [{label, entries: [{name, image_url, modes}]}], weapons: [{name, image_url, attachments, modes}]}`, für den Map-Pool
`{rows: [{label, maps}]}`, für die Modusfolge `{labels}`. Markdown entsteht erst beim Darstellen (`league_rule_blocks.value`): `markdown`
mit Bildern (Web, Vorschau) und `text` ohne Bilder (PDF, Wort-Vergleich). Ältere Fassungen tragen statt `data` das fertige `markdown`/`text`
und werden so weiter gelesen. Namen aus Bibliothek und Modus sind Text: Beim Darstellen ersetzt `markdown_text.text_cell` jedes Steuerzeichen
(`` \`*_[]()!~+ ``, „|“ wird „/“) durch ein Zeichen aus dem privaten Unicode-Bereich (`U+E000`…), das keine Markdown-Regel trifft – in
allen Bausteinen. Dieses Zwischenformat bleibt auf dem Server: Das PDF (`pdf_rules_inline`) setzt das echte Zeichen ein, und `sections[].body_md`
von Regelseite und Vorschau geht durch `markdown_text.served` – Namen mit Markdown-Backslash-Escapes, ein Backslash im frei geschriebenen
Text verdoppelt. Das Web (`renderRulesSection`, `markdownLite` mit `escapes`, auch in Codeblöcken und Adressen) zeigt so beides, wie es
geschrieben ist; der Editor zeigt den Text ohne `escapes`. Gespeicherte Fassungen, die Antwort des Veröffentlichens, „Daten geändert“
(`before`, `after`, `ops`) und der Vergleich sind Klartext (`markdown_text.plain`). Altbestand mit Schutzzeichen wird beim Lesen
zurückgewandelt bzw. ausgeliefert wie neu; in keiner API-Antwort steht ein Zeichen aus `U+E000`…`U+E00F`. Eingegeben (freier Text,
Titel, Namen im Baustein) fällt ein Zeichen aus diesem Bereich weg (`strip_protected`). Ein Name wird so nie Link oder Formatierung, und
der frei geschriebene Regeltext bleibt unberührt, auch ein Backslash darin. Jede Fassung friert so ihre Liste ein. Eine geänderte Sperrliste ergibt den Hinweis „Daten geändert“ (B.2) mit markierten
Unterschieden; die Leitung bereitet daraus eine neue Fassung vor, gibt sie frei und wählt `requires_consent`. Bilder eingefrorener
Bausteine stehen zusätzlich in `league_rules.frozen_images` (nur veröffentlichte Fassungen): Die Mediathek dreht und löscht sie nicht.

**Rechte und Routen** (Protokoll je Änderung, ohne Werte aus der Anfrage):

| Route | Recht | Zweck |
| --- | --- | --- |
| `GET /api/games/{id}/equipment` | Bereich `tournaments` (wie Maps) | Spiel mit Modi, Kategorien, Einträge mit `in_lists`, `limit`, `suggested_categories` |
| `PUT /api/games/{id}/equipment/categories` | ebenso | `{categories: [{key?, label, role}]}`; Protokoll `game.equipment.categories` |
| `POST`, `PATCH`, `DELETE /api/games/{id}/equipment[/{item}]` | ebenso | Eintrag anlegen, ändern (auch `status`), löschen; `game.equipment.create/.update/.delete` |
| `GET …/equipment/import-sources[/{source}]`, `POST …/equipment/import` | ebenso | aus anderer Spielversion; `game.equipment.import` |
| `GET /api/admin/leagues/seasons/{id}/loadout-bans` | jede Zuständigkeit der Liga | Spiel, Kategorien, Bibliothek (aktiv und inaktiv), geltende Version mit `stale` und `outdated_item_ids`, Versionen, Stand im Regelwerk |
| `PUT …/loadout-bans` | `season` | neue Version; Antwort mit `staffeln_to_sync`; `league.season.loadout_bans.save` |
| `DELETE …/loadout-bans` | `season` | entfernen (Version mit `cleared`); `league.season.loadout_bans.clear` |
| `GET …/loadout-bans/compare?base=<Nr>&target=<Nr>` | jede Zuständigkeit der Liga | `{base, target, added[], removed[], changed[], same}` je Zeile (`kind`, `item_id`) |

**Öffentlich** nur, was die Season zeigt: `GET /api/leagues/{liga}/{season}` trägt `loadout_bans` (Lesevertrag `{id, version, saved_at,
entries[]}` ohne `note` und Autor, `null` ohne Liste), die Regelseite den Baustein. Die Bibliothek selbst ist nie öffentlich.

**Datenschutz:** Alle drei Sammlungen sind Vereinsinhalt (`personal_data.CLUB_CONTENT`), nur die Kennung, wer angelegt oder gespeichert
hat. Bilder: `game_equipment.image_url` und `.image_history`, `loadout_bans.entries.image_url` und `.entries.attachments.image_url`
stehen in den Verwendungsstellen der Mediathek (`media_audit`); die Kontolöschung behält sie, solange sie dort stehen. Jede Version einer
Sperrliste ist unveränderlich (`media_audit.FROZEN_COLLECTIONS`): Ein Bild darin lässt sich nicht drehen und nicht löschen (409), Duplikat-
Ersetzen und Bild-Migration schreiben sie nicht um. In der Bibliothek darf sich ein Bild ändern.

**App:** liest nichts davon, Antworten bekommen nur Felder dazu.

### E.1 Tabelle (#1625)

Tabellen-Regeln einer Liga-Staffel: direkter Vergleich mit Mini-Tabelle, Default-Win, beide nicht erschienen, Ausscheiden
(Austritt, Auflösung, Disqualifikation), Punktabzug und Entscheid der Leitung. Das ist der Tiebreaker-Teil von #1559 für
Liga-Staffeln; Swiss, Playoffs und Heimrecht bleiben dort. Rechenkern in `services/competition_standings.py` (`_league_rows`),
Regeln in `services/scoring_rules.py`, Entscheide und „beide nicht erschienen“ in `services/league_table.py`, Routen in
`routes/league_table_routes.py`. **Migration: keine.** Kein Wert eines Titels steht im Code.

**Weiche:** Ohne `scoring_rules` am Turnier rechnet die Tabelle wie bisher (`_round_robin_rows`). Mit `scoring_rules`
(nur Liga-Staffeln, `format` `league` oder `round_robin`) rechnet `_league_rows`; mit den Vorgaben für fehlende Felder
ergibt das genau die alte Reihenfolge (Regressionstest). Gruppen, Swiss, K.-o. und FFA bleiben unverändert. Alle Leser gehen
über `standings_for_structure` bzw. `public_standings`: Turnierseite, Ligaseite (`/api/leagues/…/staffeln/…`), TV, PDF,
App (`/api/tournaments/{id}/standings`), Plätze (`placements_for_structure`) und Discord.

**Neue Felder in `scoring_rules`** (je Season, Liga N überschreibt wie bisher, Übertragen in der Gruppe `before_result`):

| Feld | Werte | Fehlt (alte Seasons) | Vorgabe neuer Liga-Seasons |
| --- | --- | --- | --- |
| `table_tiebreakers` | Liste aus `head_to_head`, `score_diff`, `score_for`, `wins`, `lead_decision` | `score_diff`, `score_for` | `head_to_head`, `score_diff`, `score_for`, `lead_decision` (Nr. 25) |
| `head_to_head_criteria` | Liste aus `points`, `score_diff`, `score_for`, mindestens eines | `points`, `score_diff`, `score_for` | ebenso (Nr. 42) |
| `allow_draws` | bool | `true` | `false` – die Tabelle zeigt keine Spalte „U“; Ergebnis der Leitung, Meldung und App-Bestätigung lehnen einen geteilten Platz mit 422 ab (`match_v2_results.checked_results` → `match_rules.match_allows_draw`). Das gilt für die Serie; ob eine einzelne Map unentschieden enden darf, sagt die Ergebnisregel des Modus (`draw_allowed`, C.3, `league_games.normalize_games`) – beide Prüfungen laufen nacheinander |
| `forfeit_score` | `recorded` \| `best_of` | `recorded` (wie eingetragen) | `best_of`: Sieger bekommt ⌊Best of/2⌋+1 Maps, der andere 0 (BO5 3:0, Nr. 26) |
| `exit_rule` | `half` \| `all_for_opponents` | `half` (50-%-Regel) | `all_for_opponents` (Kommentar 02.11., Nr. 43, Nr. 48) |
| `match_points` | wie bisher | 3/1/0 | 3/0/0 |

Punkte zählen immer zuerst. `points`, `score_diff`, `score_for` und `wins` meinen Punkte, Map-Differenz, gewonnene Maps und Siege.

**Reihenfolge bei Punktgleichheit** – die Kriterien in der Reihenfolge von `table_tiebreakers`:

- Ein Gesamtkriterium (`score_diff`, `score_for`, `wins`) teilt die Gruppe nach dem Wert über alle Spiele.
- `head_to_head`: Mini-Tabelle nur aus den Spielen der Gruppe untereinander (zwei Teams: direkter Vergleich), sortiert nach
  `head_to_head_criteria`. Teilt sie die Gruppe, wird für jede Restgruppe mit mindestens zwei Teams die Mini-Tabelle neu
  gerechnet, nur mit den Spielen der Restgruppe. Teilt sie nicht mehr, geht es mit dem nächsten Kriterium weiter (Gesamtwerte).
  Der direkte Vergleich zählt nur, wenn **alle** Spiele der Gruppe untereinander gespielt sind (Entscheidung des Obmanns,
  03.11.); steht eines noch aus, wird das Kriterium übersprungen und es geht mit dem nächsten weiter. Maßgeblich ist der ganze
  Spielplan der Staffel, auch für die Tabelle des vorigen Spieltags (Bewegung). Annullierte Spiele zählen nicht mit.
- `lead_decision`: steht ein echter Gleichstand nach allen Kriterien, gilt die Reihenfolge der Leitung, wenn sie für genau diese
  Gruppe besteht (siehe unten). Ohne Entscheid teilen sich die Teams den Platz (1, 2, 2, 4), wie bisher.
- Nie entscheidet der Name oder die Reihenfolge der Anmeldung.

**Spiele in der Tabelle** (nur Spiele mit Stand `completed` oder `forfeit`):

| Fall | Erkennung | Wertung |
| --- | --- | --- |
| Kampflos (Default-Win) | Stand `forfeit`, eine Seite mit `forfeit` | Sieg/Niederlage; mit `forfeit_score: best_of` Maps ⌊Best of/2⌋+1 : 0 (Best of am Spiel, sonst am Turnier). Zeile zählt `forfeit_won` bzw. `forfeit_lost` |
| Beide nicht erschienen (Nr. 27) | `double_forfeit: true`, beide Seiten mit `forfeit` | beide verlieren: Niederlagenpunkte, keine Maps, `forfeit_lost` +1; Form „N“ für beide |
| Ausgeschiedenes Team (`exit_rule: all_for_opponents`) | Anmeldung `withdrawn` oder `disqualified` | **jedes** Spiel des Teams, auch gespielte, zählt wie ein Default-Win für den Gegner. Das echte Ergebnis bleibt am Spiel und auf Spielplan und Matchseite sichtbar |
| Zwei ausgeschiedene Teams gegeneinander (Nr. 48) | beide `withdrawn`/`disqualified` | zählt für keinen, auch nicht als gespielt |

**Tabellenende (Nr. 43, nur mit `all_for_opponents`):** Ausgeschiedene stehen unter allen anderen, ohne Rücksicht auf Punkte.
Zuerst Ausgetretene und Aufgelöste, darunter Disqualifizierte; innerhalb jeweils wer später ausschied (`removal.at`) weiter
oben. Eine Auflösung trägt die Leitung als Austritt ein (Grund „Team aufgelöst“). Mit `half` bleibt alles wie bisher
(annulliert oder kampflos verloren, Platz nach Punkten).

**Ausscheiden (`tournament_events.plan_removal`):** Mit `all_for_opponents` gibt es in Staffeln keine Annullierung mehr: alle
offenen Spiele werden kampflos verloren gewertet (wie bisher ab der Hälfte), die gespielten bleiben unverändert am Spiel; den Rest
macht die Tabelle. Modus des Plans `opponents`, Satz „alle Spiele zählen für die Gegner, das Team steht am Tabellenende“.
Andere Formate und Staffeln mit `half` unverändert.

**Punktabzug (vorbereitet für E.3):** `tournaments.point_deductions: [{id, registration_id, points > 0, reason, source,
sanction_id?, created_at, created_by}]`. Die Tabelle zieht die Summe je Anmeldung von den Punkten ab (`deducted_points`), in der
Mini-Tabelle zählt er nicht. Gelesen wird nur mit `scoring_rules`. Geschrieben wird es in E.1 nirgends; den Grund zeigt die
Tabelle nicht öffentlich.

**Entscheid der Leitung** (`tournaments.table_decisions: [{id, registration_ids, reason, decided_by, decided_at}]`):

- `GET /api/admin/leagues/staffeln/{tid}/table` (jede Zuständigkeit der Liga): Tabelle wie öffentlich, dazu `ties` (Gruppen mit
  geteiltem Platz, die die Leitung ordnen darf), `decisions` (mit `applies`: gilt gerade) und `can_decide`
  (`lead_decision` in den Regeln). Je Gleichstand und Entscheid `own_team` (die Person gehört zu einer Seite) und
  `superadmin`: Die Verwaltung zeigt bei `own_team` ohne Superadmin „Über dein eigenes Team entscheidet eine andere Person.“
  statt der Knöpfe, dem Superadmin das Feld „Grund für die Notausnahme“ (ab fünf Zeichen, geht als `conflict_reason` mit).
  Die Matchseite nimmt dafür ihr `conflict` (`{kind, override}`) – ebenso bei „beide nicht erschienen“.
- `PUT /api/admin/leagues/staffeln/{tid}/table-decision` `{registration_ids, reason, conflict_reason?}` – Zuständigkeit
  `results`. Nur für einen echten Gleichstand: die Menge muss genau einer Gruppe mit geteiltem Platz entsprechen (ein älterer
  Entscheid für dieselbe Menge zählt dabei nicht), sonst 409. Grund mindestens fünf Zeichen. Befangen ist, wer zu einer der
  Seiten gehört (`require_no_side_conflict`, Notausnahme Superadmin mit Grund). Ersetzt einen Entscheid für dieselbe Menge.
  Protokoll `league.table.decision`.
- `DELETE /api/admin/leagues/staffeln/{tid}/table-decision/{decision_id}` `{reason, conflict_reason?}` – `results`,
  Befangenheit wie beim Festlegen (Seiten des Entscheids, Notausnahme `table_decision_remove`), Protokoll
  `league.table.decision.remove`.
- Ein Entscheid gilt nur, solange genau diese Teams nach allen Kriterien gleich stehen. Ändert ein Ergebnis das, gilt er nicht mehr
  (`applies: false`) und bleibt zur Nachvollziehbarkeit stehen.
- Öffentlich trägt die Zeile `tiebreak: "lead_decision"` und `lead_decision: {reason, decided_at}`; die Tabelle zeigt
  „Platz durch Entscheid der Leitung“ mit dem Grund.

**Beide nicht erschienen** (`POST /api/admin/leagues/staffeln/{tid}/matches/{mid}/double-no-show` `{note, conflict_reason?}`,
Zuständigkeit `results`, Befangenheit wie beim Ergebnis): nur in einer Staffel, nur für ein Spiel mit zwei Seiten **vor dem
Spiel** – Stand `pending`, `ready` oder `scheduled`, ohne `started_at`, ohne Meldung (`reports`), ohne gehaltenes Ergebnis
(`pending_result`) und ohne Ergebnis, sonst 409.
Schreibt `status: "forfeit"`, `double_forfeit: true`, `results` beide mit `rank: 2, forfeit: true`, `games: []`, Begründung wie
beim Forfeit (mindestens fünf Zeichen) und je Seite den Eintrag „nicht erschienen“. Protokoll `match.forfeit.double`. Danach
dieselben Folgen wie beim kampflos (`league_table.after_change`): Station und Aufruf frei, Discord-Baum vorgemerkt,
Anzeige-Ereignis, Stand der Wettbewerbsstruktur; beim Neu ansetzen ebenso (ohne Station).
**Neu ansetzen:** `DELETE` auf dieselbe Adresse `{reason, conflict_reason?}` (Befangenheit wie beim Werten, Notausnahme
`double_no_show_undo` im Protokoll) setzt das Spiel zurück (ohne Ergebnis, Stand `scheduled` mit Termin,
sonst `ready`), Protokoll `match.forfeit.double.undo`; den Termin setzt die Leitung danach wie gewohnt.

**Antworten (nur zusätzlich, die App bleibt ohne Build lauffähig):** Jede Zeile einer Staffel-Tabelle trägt dazu `tiebreak`
(`head_to_head`, `score_diff`, `score_for`, `wins`, `lead_decision` oder `null`), `forfeit_won`, `forfeit_lost`,
`deducted_points`, `exit` (`{kind, at}` oder `null`) und `lead_decision`. Die Staffel der Ligaseite trägt `table_rules`
(`allow_draws`, `tiebreakers`, `head_to_head_criteria`, `forfeit_score`, `exit_rule`).

**Darstellung (Entscheidung 15.10.):** Platz und Zone, kein öffentliches Rating, Hervorhebung in Cyan (Gold bleibt dem
Season-Meister, F.1). Bei Gleichstand ein kleiner Hinweis, was entschied („Direkter Vergleich“, „Map-Differenz“, „Mehr Maps“,
„Mehr Siege“, „Entscheid der Leitung“), „kampflos“ bei Default-Wins, am Tabellenende „Ausgetreten“ bzw. „Disqualifiziert“.

### Darf nicht beschädigt werden

Jedes Paket prüft das per Regressionstest:

- Unveränderliche `map_pools`, `effective_pool`, `map_pools.allowed`.
- Vertrag von `games[]`, Konsens `same_outcome`, App-Bestätigung ohne Maps.
- Dauerplanung an `games.match_modes[]` (`minutes`, `per_game`).
- Getrennte Referenz-Ligen (`team_league_maps.py`, `reference_round_results`).
- Turnierkern und andere Formate, `league_scope.py`, `staffel_guard.py`.

### Abgeschlossen heißt

Datenmodell und API passen zusammen, Rechte greifen, die Oberfläche trägt den ganzen Ablauf, Fehler sind verständlich,
Daten bleiben erhalten. Dazu Tests für Haupt- und Fehlerfälle, gleichzeitige Aktionen, Protokoll, Lauf gegen echtes MongoDB,
Browserlauf mit echter API bei 390 und 1440 px, App kompatibel, Doku und Handbuch aktuell. Mongomock allein reicht nicht.

### D.1 Termine (#2194)

Regelwerk § 7, Entscheidungen Nr. 17, 18 und 28. Logik in `services/league_schedule.py` (Regeln, Verschiebung, Historie, Matchseite),
`services/league_schedule_sweep.py` (Zeit-Job), Routen in `routes/league_schedule_routes.py`. **Migration: keine.** Ohne `schedule_rules`
an der Staffel verhält sich alles wie vorher (Heimrecht sofort, keine Verschiebung, keine Erinnerung). Nur Staffeln tragen die Regeln.

**Einstellung `schedule_rules`** an `league_seasons` und `tournaments` (Staffel), ein Objekt. Neue Seasons bekommen die Vorgabe, ältere
nichts. Gepflegt unter `GET|PUT /api/admin/leagues/seasons/{id}/schedule-rules` (Zuständigkeit `season`), das Speichern schreibt sofort
auf alle nicht gesperrten Staffeln der Season (eigene Gruppe `schedule` beim Übertragen, wie `running` auch nach dem Start, `staffel_fields` beim Anlegen). Protokoll
`league.season.schedule_rules` mit altem und neuem Wert.

| Feld | Typ | Vorgabe | Bedeutung |
| --- | --- | --- | --- |
| `home_rule` | bool | `true` | Nr. 17: unbeantworteter Vorschlag des Heimteams gilt nach der Frist |
| `home_rule_hours` | int 1–336 | 72 | Frist ab dem Vorschlag, Sperrzeiten zählen nicht (`response_deadline`) |
| `reschedule_notice_hours` | int 0–336 | 24 | Nr. 18: Antrag spätestens so viele Stunden vor dem geltenden Termin |
| `reschedule_max` | int 0–10 | 2 | Verschiebungen je Spiel durch beide Teams, 0 = nur die Leitung |
| `reschedule_same_week` | bool | `true` | Der neue Termin liegt in der Spielwoche des Spiels |
| `result_reminder_hours` | int 1–336 | 24 | Nr. 28: so lange nach dem Termin ohne Meldung geht die Erinnerung an beide Seiten |
| `result_overdue_hours` | int 1–720 | 48 | danach ist das Spiel bei der Leitung „überfällig“; nie kleiner als die Erinnerung |

**Fester Termin:** Ein Termin steht fest, wenn das Spiel `scheduled_at` hat und `schedule_source` `accepted` (Einigung, 72-h-Regel,
Verschiebung) oder `manual` (Leitung) ist. Davor gilt die Ersteinigung über Terminvorschläge wie bisher (der Standardtermin ist kein
fester Termin). Steht er fest, nimmt eine Staffel mit Regeln keinen neuen Vorschlag, keinen Gegenvorschlag und keine Annahme mehr an
(409 „Der Termin steht fest – für einen anderen Termin bitte eine Verschiebung beantragen.“); `can_propose_schedule` ist dann `false`.
Ablehnen und Zurückziehen gehen weiter. Wird ein Vorschlag angenommen, schließen die übrigen offenen dieses Spiels mit `declined`
(`decision_rule: "agreed_elsewhere"`).

**72-h-Regel (Nr. 17)** im Fristen-Job (`match_deadline_sweep.sweep` ruft `league_schedule_sweep.sweep`): Ein offener Vorschlag der
Heimseite (`slots[0]`) gilt, wenn `home_rule` an ist, die Frist ab `created_at` abgelaufen ist, der Termin in der Spielwoche liegt,
nicht in einer Sperrzeit, noch in der Zukunft ist, und das Spiel noch keinen festen Termin hat und nicht begonnen ist. Dann:
Vorschlag `accepted` mit `decision_rule: "home_rule"`, Spiel `scheduled_at`, `schedule_source: "accepted"`, `schedule_status: "accepted"`,
Historie `home_rule`, Nachricht an die Verantwortlichen beider Seiten (Art `match_schedule`, `meta.reason` `schedule_home_rule`,
Schlüssel `schedule-home-rule:<vorschlag>`). Sonst gilt der Standardtermin. Mit Regeln zählt ein offener Heimvorschlag im Spieltag-Lauf
nicht mehr sofort (`resolve_matchday_time` ohne Zweig „home“); ohne Regeln bleibt es beim Heimrecht wie bisher. Idempotent: geschrieben
wird nur, solange der Vorschlag `pending` ist, unter der Turniersperre.

**Verschiebung (Nr. 18)** – eigene Art am Spiel, getrennt von `match_schedule_proposals`:

| Feld an `matches_v2` | Inhalt |
| --- | --- |
| `reschedule_requests[]` | `{id, status, from_at, to_at, reason, requested_by, requested_registration_id, requested_at, approvals[{registration_id, user_id, at}], decided_by, decided_registration_id, decided_at, decision_note}` |
| `status` je Antrag | `pending`, `accepted`, `declined`, `withdrawn`, `expired` (alter Termin vorbei), `superseded` (Termin anders gesetzt) |
| `reschedule_count` | angenommene Verschiebungen der Teams |
| `schedule_history[]` | `{id, at, kind, by, registration_id, from, to, reason, request_id}`, höchstens 50, neueste zuletzt |

Arten der Historie: `agreement` (Einigung), `home_rule` (72-h-Regel), `default` (Standardtermin), `reschedule` (Verschiebung), `lead`
(Leitung). Beide Felder und `result_reminded_at`, `result_overdue_at` sind intern (`match_public_view.INTERNAL_KEYS`); die Matchseite gibt sie
mit Namen im Block `schedule_block` an Beteiligte und Leitung.

| Route | Wer | Prüfung |
| --- | --- | --- |
| `POST /api/matches/{id}/reschedule` `{scheduled_at, reason}` | Captain oder Vertreter einer Seite | Staffel mit Regeln, fester Termin, nicht begonnen, kein offener Antrag, `reschedule_count < reschedule_max`, jetzt ≤ Termin − `reschedule_notice_hours`, neuer Termin in der Zukunft (5 Minuten), nicht in einer Sperrzeit, anders als der alte, bei `reschedule_same_week` in der Spielwoche, Grund 5–500 Zeichen |
| `POST /api/matches/{id}/reschedule/{rid}/decision` `{action, note?}` | `accept`, `decline`: Captain oder Vertreter der **anderen** Seite; `withdraw`: die beantragende Seite | Antrag offen, Termin unverändert seit dem Antrag (sonst `superseded`, 409), alter Termin noch nicht erreicht (sonst `expired`, 409), beim Annehmen Grenze und Sperrzeit noch einmal |

Jede Grenze antwortet 409 mit deutschem Satz; was darüber geht, sagt der Satz: „Das entscheidet die Liga-Leitung – bitte im Matchchat
@leitung schreiben.“ Annehmen setzt `scheduled_at`, `schedule_source: "accepted"`, erhöht `reschedule_count` mit Bedingung auf den alten
Termin und den Zähler, schreibt Historie `reschedule` mit Grund und beiden Zustimmungen. Gleichzeitige Anträge oder Annahmen: Turniersperre
plus Bedingung im Schreiben, die zweite Anfrage bekommt 409. Nachrichten an die andere Seite (Art `match_schedule`, `meta.reason`
`reschedule_requested|accepted|declined|withdrawn`, Schlüssel `match-reschedule:<antrag>:<schritt>`). Protokoll `match.reschedule.request`,
`.accept`, `.decline`, `.withdraw` mit Grund, ohne Personen außer `actor_id`.

**Leitung:** Alles darüber (später, öfter, wochenübergreifend) setzt die Leitung über `PATCH /api/matches/{id}` (`matches`, Befangenheit wie
Nr. 62, Superadmin-Notausnahme mit `conflict_reason`). Neu ist das freiwillige Feld `schedule_reason` (≤ 500): Es steht in der Historie
(`lead`) und im Protokoll `match.plan.change`. Ein neuer Termin der Leitung beendet offene Anträge (`superseded`) und hebt `result_reminded_at`
und `result_overdue_at` auf. Die Matchseite bietet der Leitung dafür ein eigenes Feld mit Grund (`schedule_block.can_lead_set`).

**Überfällig (Nr. 28)** im selben Job: Ein Spiel einer Staffel mit Regeln, beide Seiten fest, Termin vorbei, ohne Meldung und ohne Ergebnis
(Status `ready` oder `scheduled`): nach `result_reminder_hours` einmal `result_reminded_at` und Nachricht an die Verantwortlichen beider Seiten
(`meta.reason` `result_missing_reminder`, Schlüssel `result-reminder:<spiel>:<termin>`), nach `result_overdue_hours` `result_overdue_at`,
Nachricht an die Liga-Leitung (`matches`, `results`; Art `match_attention`, `meta.reason` `result_overdue`) und Protokoll
`match.result.overdue`. In einer Sperrzeit läuft nichts. Erledigt ist der Fall mit Ergebnis, Wertung oder neuem Termin der Leitung.
Für F.1: `league_schedule.open_overdue(db, season_id)` liefert die offenen Fälle einer Season; ohne Entscheidung darüber kein Saisonabschluss.

**Matchseite** `schedule_block` (nur Staffeln mit Regeln, nur Beteiligte und Leitung, sonst `null`): `rules`, `fixed`, `source`,
`scheduled_at`, `window {start, end}`, `remaining`, `request_until`, `can_request`, `request_hint` (warum nicht), `requests[]` mit Namen und
`can_answer`/`can_withdraw`, `history[]` mit Namen, `home_rule_at` (wann ein offener Heimvorschlag gilt), `can_lead_set`, `own_registration_id`.

**Datenschutz:** Anträge und Historie stehen nur in `matches_v2` (keine eigene Sammlung). Auskunft `league_schedule` (`league_schedule.export_snapshot`): je Spiel die eigenen Anträge mit Grund, als Seite entschiedene nur mit der eigenen Antwort, als Leitung nur Vorgang, Stand und Zeit; Historie ebenso, Einträge der Leitung nur Art und Zeit. Kontolöschung (`league_schedule.scrub_person`): `requested_by`, `decided_by`, `approvals[].user_id`, `schedule_history[].by` und `.requested_by` werden `null`, Termin und Grund bleiben.

**Aufgaben:** `me.actions[]` `type: "match_reschedule"` („Verschiebung beantworten“, `target_type: "match"`) für die andere Seite eines offenen
Antrags. **Mein Dienst** (`/api/users/me/duty`): `overdue_matches[]` für Liga-Leitung mit `matches` oder `results` (Spiel, Staffel, Termin,
seit wann) und `ended_live[]` (siehe unten).

**Turnier nach dem Ende noch „Live“ (für alle Turniere):** Der Fristen-Job hält am Turnier `running_past_end` (bool) aktuell: `true`, solange
der Stand `live` ist, das Ende vorbei und noch offene Spiele da sind; sonst fällt das Feld weg. `derive_public_phase` zeigt dann weiter
„Läuft“ (Karte, Band, Detailseite), ohne eigene Abfrage. Sind alle Spiele fertig, zeigt die Seite „Beendet“, der Stand bleibt `live`: Die
Leitung sieht in Mein Dienst (`ended_live[]`: `{id, title, end_date, open_matches, admin_url, league}`) und in der Turnierliste den Hinweis
„Läuft laut Stand noch, Ende war am … – beenden?“ mit Weg in die Verwaltung. Umgestellt wird nie automatisch. Turnierleitung sieht Turniere
ohne Liga, Liga-Leitung mit `manage` die Staffeln ihrer Ligen.

### D.2 Check-in und Start (#1652)

Regelwerk § 8 (Nr. 19, 40, 46; § 8.4 und 8.5) und die Regelwerks-Sperre des Obmanns vom 03.11. Logik in `services/checkin_rules.py`
(Blatt-Modul ohne Datenbank: Regeln, Fenster, Stand, Vorschlag – lesen `league_service`, `match_deadlines` und der Regelwerk-Baustein) und
`services/match_flow.py` (Check-in, Start, Matchseite, Aufgaben, Datenschutz), `services/league_checkin_sweep.py` (Zeit-Job: Erinnerungen),
Routen in `routes/league_checkin_routes.py`. **Migration: keine.** Ohne `checkin_rules` an der Staffel verhält sich alles wie vorher: kein Check-in, kein
Vorschlag „nicht erschienen“, `started_at` setzt online niemand. Andere Formate, die App und der TV bleiben unverändert.

**Einstellung `checkin_rules`** an `league_seasons` und `tournaments` (Staffel), ein Objekt. Gepflegt unter
`GET|PUT /api/admin/leagues/seasons/{id}/checkin-rules` (Zuständigkeit `season`); das Speichern schreibt sofort auf alle nicht gesperrten
Staffeln der Season (eigene Gruppe `checkin` beim Übertragen, wirkt wie `schedule`; `staffel_fields` beim Anlegen). Neue Seasons bekommen die
Vorgabe, ältere nichts, bis die Leitung einmal speichert. Protokoll `league.season.checkin_rules` mit altem und neuem Wert.

| Feld | Typ | Vorgabe | Bedeutung |
| --- | --- | --- | --- |
| `opens_minutes_before` | int 1–240 | 15 | Nr. 19: der Check-in öffnet so viele Minuten vor dem Termin |
| `closes_minutes_after` | int 0–240 | 15 | und schließt so viele Minuten nach dem Termin |
| `min_present` | int 1–50 | 3 | Nr. 46: mindestens so viele berechtigte Anwesende je Seite. Vorgabe einer neuen Season: `lineup_min_players` (Teilnehmerliste), sonst Teamgröße − 1, mindestens 1 |
| `remind_minutes_before_close` | int 0–60 | 5 | zweite Erinnerung an Seiten ohne Check-in, so viele Minuten vor Schluss; 0 = keine |

**Fenster** (`match_flow.window_of`): nur mit `scheduled_at`; öffnet `scheduled_at − opens_minutes_before`, schließt
`scheduled_at + closes_minutes_after`. „Verlängern“ der Leitung (`no_show_extended_until`, bestehender Knopf) schiebt das Ende. Gerechnet wird
in UTC, Wiener Zeit steht nur in Texten; die Sommerzeit ändert am Fenster nichts.

**`matches_v2.flow`** (optional; nur Staffeln mit Regeln schreiben es, intern wie `lineups`):

| Feld | Inhalt |
| --- | --- |
| `checkin.<registration_id>` | `{at, updated_at, user_id, present: [user_id], via: "side" \| "lead", by, reason, rule_version_id, for_at}` – wer wann für die Seite eingecheckt hat, die Anwesenden, bei der Leitung Person und Grund, die Regelfassung von damals, der Termin, für den der Check-in gilt |
| `ready_at`, `ready_for` | ISO, einmal je Termin gesetzt, sobald beide Seiten eingecheckt sind (Nr. 40); `ready_for` = der Termin, für den es galt |
| `start` | `{at, by, registration_id, via: "side" \| "lead"}` – der festgehaltene Beginn; zugleich `started_at` und `status: "in_progress"` am Spiel |
| `notices` | `{open: <Termin>, closing: <Termin>}` – welche Erinnerung für welchen Termin schon ging |

**Stand** (`match_flow.state(match, tournament, now)`, abgeleitet, kein neuer globaler `status`): `none` (keine Regeln, kein Termin, keine zwei
Seiten), `waiting` (Termin da, Fenster noch zu), `open` (Fenster offen, mindestens eine Seite fehlt), `closed` (Fenster zu, eine Seite fehlt –
Fall bei der Leitung), `veto` (beide da, Veto offen – Haken `match_flow.veto_pending`, heute immer `False`, D.3 ersetzt ihn), `ready` (beide
da, spielbereit – Map 1 darf sofort beginnen, auch vor dem Termin), `running` (`started_at`), `finished` (entschieden, abgesagt). Der Start
schreibt wie der Stationsstart `in_progress` – App und TV zeigen „Läuft“ aus `status` und `started_at` wie bisher.

**Check-in** `POST /api/matches/{id}/checkin` `{present: [user_id], registration_id?, reason?, conflict_reason?}`:

- Für die eigene Seite: Captain oder Vertreter, ohne beide die Hauptteam-Leitung (`acting_registration`). Die Liga-Leitung mit „Spiele betreuen“
  (`matches`) trägt im Notfall für eine Seite ein (`registration_id`, `reason` mindestens fünf Zeichen), auch nach Fensterende, solange nichts
  begonnen und nichts gemeldet ist; Befangenheit wie B.1 (403, Superadmin mit `conflict_reason`), Protokoll `match.checkin.lead`.
- Prüfungen mit deutschem Satz: Staffel mit Regeln und zwei Seiten (409), nicht begonnen und keine Meldung (409), Fenster offen – „Der Check-in
  öffnet erst um …“ bzw. „Der Check-in ist seit … geschlossen – das entscheidet die Liga-Leitung“ (409, nur Seiten); Anwesende: nur Kader,
  jede Person einmal, mindestens `min_present`, nur spielberechtigt (`league_eligibility.check_participants`, Grund im Klartext, 422).
- **Regelwerks-Sperre:** Hat das Co-Team der Seite der geforderten Fassung (B.2, `requires_consent`) nicht zugestimmt, gibt es keinen Check-in
  – auch nicht durch die Leitung (Entscheidung Nr. 86): 409 „Das Regelwerk hat sich geändert – bitte erst zustimmen.“ mit dem Weg zur Fassung
  (`rules_url`). Die Matchseite zeigt denselben Satz vor dem Klick.
- **Ergänzen bis Fensterende:** ein erneuter Aufruf derselben Seite ersetzt die Liste (`updated_at`), `at` bleibt; dieselbe Liste antwortet
  `idempotent_replay`. Nach Fensterende ergänzt nur die Leitung.
- Geschrieben wird unter der Turniersperre (`_serialized_match_write`) mit Bedingung auf den gelesenen Stand der Seite, `started_at` und `status`;
  gleichzeitige Klicks beider Seiten gehen beide durch, `ready_at` setzt genau einmal je Termin (Bedingung „beide da und `ready_for` ≠ Termin“). Ein zweiter
  gleichzeitiger Klick derselben Seite bekommt 409 „Gerade hat sich am Check-in etwas geändert – bitte neu laden.“
- Protokoll `match.checkin` (`registration_id`, `count`, `via`, `rule_version_id`, bei der Leitung `reason`). Nachrichten (Art `match_schedule`,
  Thema Match-Erinnerungen): an die Verantwortlichen der Gegenseite „… ist eingecheckt“ (`meta.reason` `checkin_side`, Schlüssel
  `checkin-side:<spiel>:<seite>:<at>`), sobald beide da sind an beide Seiten „Beide Seiten eingecheckt – ihr könnt starten“ (`checkin_ready`,
  `checkin-ready:<spiel>:<ready_at>`).

**Start** `POST /api/matches/{id}/checkin/start` (ohne Inhalt, `conflict_reason?` für die Leitung): Captain oder Vertreter einer Seite oder die
Leitung mit `matches` (Befangenheit wie oben). Nur im Stand `ready`; die Regelwerks-Sperre gilt für beide Seiten (409 nennt die Seite, die noch
zustimmen muss – ändert sich das Regelwerk zwischen Check-in und Start, hält das den Start auf). Setzt `started_at`, `status: "in_progress"` und
`flow.start` mit Bedingung `started_at: null`; der zweite Klick antwortet `idempotent_replay`. Protokoll `match.checkin.start`, Nachricht
„Match startet jetzt“ an die Verantwortlichen beider Seiten (`checkin_started`, `checkin-start:<spiel>:<at>`). Ab hier gelten alle Regeln für
begonnene Spiele (D.1: keine Verschiebung; kein Vorschlag „nicht erschienen“; „Ergebnis fehlt“ wie bisher).

**Nach Ablauf (§ 8.4, 8.5 – kein automatischer Nichtantritt):** Der Fristen-Job (`match_deadline_sweep`, Regel `check_in` in
`match_deadlines.no_show_deadline`) legt nach Fensterende genau einen Vorschlag an das Spiel: `no_show_proposal`
`{rule: "check_in", minutes, due_at, registration_ids, missing_registration_ids}`, Protokoll `match.no_show.proposed`, Nachricht „Nicht
erschienen?“ an die Liga-Leitung mit `results` oder `disputes` (Art `match_attention`, `no-show:<vorschlag>`), Eintrag in Mein Dienst
(`checkin_proposals[]`) und Karte in der Leitungsansicht (Teilnehmer = fehlende Seiten). Eine Wertung schreibt nie der Job. Die Leitung
entscheidet wie bisher über `POST /api/tournaments/{tid}/lead/no-show/{match}`: `confirm` wertet kampflos über den Forfeit-Weg (Notiz „Nicht
erschienen – Check-in bis … nicht erfolgt“, Teamstrafe wie bei jedem Kampflos), `extend` verlängert das Fenster und nimmt den Vorschlag zurück
(nach Ablauf kommt er neu). Trägt die Leitung die fehlende Seite nach, räumt der Job den Vorschlag ab (`match.no_show.cleared`, Grund
`checked_in`). Ein begonnenes Spiel (`started_at`) oder eins mit Meldung bekommt nie einen Vorschlag (laufendes BO5 ist kein Nichtantritt).
Alte Vorschläge ohne Regel `check_in` räumt der Job wie seit #2201 ab.

**Neuer Termin, „Beide nicht erschienen“ (E.1):** Jeder Check-in trägt den Termin, für den er galt (`for_at`); setzt die Leitung einen
anderen Termin (`PATCH`, auch nach „Neu ansetzen“), zählen die alten Check-ins nicht mehr, beide Seiten checken für den neuen Termin neu ein,
„beide da“ gilt wieder einmal (`ready_for`). Ein offener Vorschlag aus dem alten Fenster zeigt keine Karte mehr (die Karte prüft das Fenster
live) und fällt im nächsten Lauf weg (`match.no_show.cleared`, Grund `rescheduled`); nach dem neuen Fenster kommt er neu. Fehlen beide Seiten,
nennt der Vorschlag beide; die Leitung wertet dann über „Beide nicht erschienen“ (E.1, Nr. 27) oder trägt nach. Eine Wertung „beide nicht
erschienen“ oder „kampflos“ beendet den Stand (`finished`); nach „Neu ansetzen“ ist das Spiel wieder offen, die Check-ins gelten erst mit dem
neuen Termin.

**Erinnerungen** (`league_checkin_sweep.sweep`, im Fristen-Job mit denselben laufenden Turnieren): bei Öffnung des Fensters „Check-in offen“ an
die Verantwortlichen beider Seiten, die noch nicht eingecheckt sind (Art `match_call` – Push mit Vibration wie „Du bist dran“, Schlüssel
`checkin-open:<spiel>:<termin>`), `remind_minutes_before_close` Minuten vor Schluss „Noch … Minuten“ an Seiten ohne Check-in
(`checkin-closing:<spiel>:<termin>`). Merker `flow.notices` je Termin: ein neuer Termin erinnert neu, ein zweiter Lauf findet nichts mehr.
In einer Sperrzeit läuft nichts.

**Matchseite** `checkin` (nur Staffeln mit Regeln, nur Beteiligte und Leitung, sonst `null`): `rules`, `state`, `scheduled_at`, `window
{opens_at, closes_at}`, `ready_at`, `started_at`, `sides[]` je Seite `{registration_id, name, own, checked_in, at, via, present: [{id, name}],
present_count, consent_open, rules_url, lead_reason}` (die Anwesenden sehen beide Seiten mit Namen und die Leitung, wie Aufstellungen –
Entscheidung Nr. 85; einen Eignungsgrund sieht nur die eigene Seite), `own_registration_id`, `can_checkin`, `checkin_hint` (warum nicht), `roster[]` der eigenen Seite
`{id, name, blocked}` (Grund im Klartext, nicht wählbar), `min_present`, `can_start`, `start_hint`, `proposal` (`{due_at, missing: [name]}` oder
`null`), `lead {can_enter, conflict, rosters: {registration_id: [{id, name, blocked}]}}` für die Leitung.

**Aufgabe** `me.actions[]` `type: "match_checkin"` („Jetzt einchecken“, `target_type: "match"`) für die Verantwortlichen einer Seite ohne
Check-in, solange das Fenster offen ist; ältere Apps öffnen damit die Matchseite, eingecheckt wird im Web.

**Datenschutz:** `flow` ist intern (`match_public_view.INTERNAL_KEYS`), die Matchseite gibt die Namen im Block `checkin`. Auskunft
`league_checkin` (`match_flow.export_snapshot`): je Spiel der eigene Check-in (Zeit, Anzahl, Grund als Leitung nur Vorgang und Zeit), die eigene
Anwesenheit, der eigene Start. Kontolöschung (`match_flow.scrub_person`): `user_id`, `by` und `start.by` werden `null`; Anwesenheitslisten
bleiben wie Aufstellungen (Sportdaten, das Konto heißt dort „Gelöschter User“).

**Rechte** (Ergänzung der Matrix in B.1):

| Route | Liga-Recht | Befangenheit | Helfer |
| --- | --- | --- | --- |
| `GET …/seasons/{id}/checkin-rules` | jede Zuständigkeit der Liga | – | – |
| `PUT …/seasons/{id}/checkin-rules` | `season` | – | – |
| Spiel: `POST /checkin` mit `registration_id` (für eine Seite), `POST /checkin/start` als Leitung | `matches`; Beteiligte als Captain oder Vertreter wie jede Seite | ja (Notausnahme `conflict_reason`) | – |

**Regelwerk:** Baustein `[[baustein:checkin]]` (`league_rule_blocks`) nennt Fenster und Mindestzahl der Season im Text; eingefroren beim
Veröffentlichen wie jeder Baustein. Der dynamische Umbau des Regelwerks ist #2269.

**Audit-Aktionen neu:** `match.checkin`, `match.checkin.lead`, `match.checkin.start`, `league.season.checkin_rules`.

**Haken für D.3:** `match_flow.veto_pending(match, tournament)` – zwischen `ready_at` und Start; liefert heute `False`. D.3 setzt dort den
Zustandsautomaten des Vetos ein, der Start bleibt der Schritt danach.

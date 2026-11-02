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
| `scoring_rules` | dict | ja | `normalize_rules({})` aus `services/scoring_rules.py`; gelesen werden nur `match_points` (3/1/0) und `table_tiebreakers` |
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
| Punkte Sieg/Remis/Niederlage, Gleichstand | Season (`scoring_rules`), Liga N überschreibt | 3/1/0 · `score_diff`, `score_for` |
| Modus je Position | Season | frei |
| Bestätigungsfrist, Aufstellungs-Nachtrag | Season | 48 h · 48 h |
| Antwortfrist auf Terminvorschläge (#2106) | Season, Liga N überschreibt | 72 h |
| Map-Pool | Season (`league_season`) | keiner = keine Liga-Meldung möglich |
| Regeltext, Meldeschluss, Sichtbarkeit | Season | leer · leer · aus |

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
| Anmeldung, Spiel-Antworten | Eine Staffel hat auf keinem Weg eine Selbstanmeldung; `schedule_proposals` an Unbeteiligte nur mit `scheduled_at`, `status`, `actor_registration_id`; Notizen höchstens 500, Einspruch höchstens 1000 Zeichen | `self_register`, `access_link_routes`, `_match_page_payload`, `models.py` |

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
| Gastteams anderer Vereine | #1665 (ab Season 2) |
| Solo-Ligen (`participant_kind="solo"`) | #1629 |
| Direkter Vergleich als Gleichstandsregel | #1559 |
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
| `league_eligibility.py` | B.3 | Eine Prüfung für Anmeldung, Aufstellung, Check-in | `league_roster.py`, `league_games._lineup` |
| `league_applications` | B.4 | Antrag je Season, die Staffel steht erst nach Genehmigung fest | `squad_problems`, `build_registration` |
| Modus-Felder | C.1 | Status, Ergebnisregel | `games.match_modes[]`, Dauerplanung bleibt |
| `season_readiness` | C.2 | Vorab-Prüfung vor der Veröffentlichung | `map_pools`, `game_mode_order` |
| Ergebnisregeln | C.3 | Prüfung in `normalize_games`, nur mit gesetzter Regel | `games[]` |
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
| `POST …/seasons/{id}/divisions`, `PATCH`, `DELETE …/divisions/{id}`, `GET …/delete-plan` | `season` | – | – |
| `POST …/divisions/{id}/staffeln`, `DELETE …/staffeln/{tid}` | `season` | – | – |
| `GET …/seasons/{id}/roster`, `POST …/roster/{uid}/approve`, `PUT …/roster-settings` | `roster` | – | – |
| `GET …/{id}/staff` | `manage` | – | – |
| `GET`, `PUT …/draft`, `DELETE …/draft`, `POST …/draft/from-version`, `…/preview`, `…/publish` unter `/api/admin/league-rules/{league\|league_season}/{id}` | `rules`; die Liga kommt aus der Adresse, bei einer Season aus der gespeicherten Season | – | – |
| `PATCH`, `PUT …/roles`, `DELETE /api/teams/{id}/squads/{sid}` eines Co-Teams in nicht beendeter Staffel | `roster` oder eigenes Team | – | – |
| `PUT`, `DELETE …/{id}/staff/{uid}` | nur Bereich | – | – |
| Staffel: `PATCH`, `POST /lock`, `/unlock`, `/status`, `PUT /pause`, `/round-sponsors`, `/onsite-access` | `manage` | – | – |
| Staffel: `DELETE`, `bracket/*`, `reset-bracket`, `stages*`, `swiss/*`, `groups/generate`, `heat-rebuild/*`, Map-Pool | `season` | – | – |
| Staffel: `POST`, `PUT`, `DELETE /staff` | `manage` | – | – |
| Staffel: `GET /staff`, `/lead`, `/planning-check`, `/match-plan.csv`, `/bracket/display`, `/schedule/deadlines`, Chat, Teilnehmer intern | jede Zuständigkeit | – | lesen |
| Staffel: `squad-candidates`, `squad-registrations`, `registrations` schreiben, `removal*`, `assignable-users` | `applications` | – | – |
| Staffel: `registrations/{id}/checkin`, `print/checkin`, `schedule/plan`, `/apply`, `/release`, `live-queue/*`, Team-Tag `lineups` | `matches` | – | – |
| Spiel: `PATCH` (Termin und Betreuung), `schedule/apply` und `/release` mit eigenem Spiel | `matches` | ja, im Sammellauf ohne Notausnahme | – |
| Spiel: Terminvorschläge entscheiden und zurückziehen | `matches`; Beteiligte nur als Captain oder Vertreter wie jede Seite | ja | – |
| Spiel: `POST /result`, `/result/undo`, `/forfeit`, `PUT /lineups` als Leitung, `POST …/lead/no-show/{id}` | `results` | ja | – |
| Spiel: `POST /dispute/decision` | `disputes` | ja | – |
| Spiel: `POST /result` bei offenem Streitfall | `results` und `disputes` | ja | – |
| Spiel: `POST /dispute` (ohne eigene Seite) | `disputes` | nein | – |
| Spiel: `POST /proof-photos` als Leitung, `matches-v2/recalculate-advancement` | `results` | nein | – |
| PDF-Exporte und Ergebnis-Vorabzug einer Staffel | jede Zuständigkeit | – | – |
| Zugangslinks, TV-Schlüssel, Stationen, Gewinne an einer Staffel | zusätzlich zum Bereich `tournaments`: `manage` | – | – |
| Öffentliche Ligaseite, Staffel, Spielplan, Tabelle, Matchseite | nach Sichtbarkeit; Sichtbarkeit `admins` nur mit Liga-Recht | – | lesen |

**Co-Teams in nicht beendeten Staffeln** (`PATCH`, `PUT …/roles`, `DELETE /api/teams/{id}/squads/{sid}`): Kader, Captain, Vertreter, Status und
Löschen ändern nur die Leitung und Co-Leitung des eigenen Teams und die Liga-Leitung mit `roster`, bei mehreren Ligen in jeder. Die Rolle
`tournament_admin` und die Freigabe `tournaments` nicht mehr. `GET …/squads` sagt je Co-Team `can_edit`; wer nur `roster` hat, liest nur die Co-Teams
seiner Liga. Die Liga-Leitung bearbeitet aus der Kaderübersicht der Season („Kader bearbeiten“), Protokoll `league.squad.edit`. Die eigene Rolle
abgeben geht weiter. Alle anderen Teams und Co-Teams, auch nach dem Ende der Staffel, bleiben wie bisher.

**Bewusst unverändert:** Die übrige Team-Verwaltung (`team_routes.py`, Team-Admin-Rollen) bleibt ein eigener Rechtebereich.
Jahreswertung, Spiele und Map-Bibliothek bleiben beim Bereich `tournaments`. Die Moderation bleibt getrennt.

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
`game_mode_order` mit den Namen der Modi). Unbekannte lehnt das Veröffentlichen mit 422 ab. Neue Bausteine stehen in
`league_rule_blocks.BLOCKS` (für #2218 die Waffenliste). Beim Veröffentlichen wird das Markdown des Bausteins eingefroren; alte
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
`league_rule_consents`. An Anmeldungen liest beide Felder kein Code; alte Zeilen bleiben unberührt, andere Anmeldewege auch.

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

**Bilder:** Im Regelwerk nur eigene Uploads (`game_maps.IMAGE_URL`). Der Server lehnt alles andere beim Speichern und Veröffentlichen mit 422 ab, die Vorschau nennt es
(`foreign_images`), das Web lädt es nicht (`markdownLite`, Option `imageAllowed`; andere Nutzer ohne Option bleiben unverändert) und zeigt einen Link. Die CSP bleibt.
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

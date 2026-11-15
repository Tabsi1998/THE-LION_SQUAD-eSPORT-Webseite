# Regelwerksabgleich Liga (G.3)

Paket G.3 des Liga-Masterplans (#2211), Abschnitt 26 G des Auftrags vom 02.11.: Gegenüberstellung der fachlichen Regeln und der
gebauten Funktionen. Stand 15.11.2026, Branch `docs/liga-g3-abschluss` auf `main` 4f59cfcb6 (mit G.1, #2423).

Grundlage:

- **Das erzeugte Regelwerk:** die Bausteine aus `backend/services/league_rule_facts.py` und `backend/services/league_rule_blocks.py`, die
  Variablen aus `backend/services/league_rule_vars.py`, die Regelwerk-Seite mit Anlagen (`league_rules.py`, `league_rules_text.py`). Den
  Fließtext mit Paragrafen und Anlagen (Regelwerk-Entwurf v0.15) schreibt die Liga-Leitung in der Verwaltung, er liegt nicht im Repo.
  Abgeglichen werden darum die Sätze, die das System selbst erzeugt, und die Regeln, auf die sich der Fließtext stützt.
- **Die Entscheidungen Nr. 1 bis 180** aus der Entscheidungsliste (Fabian, 02.11. bis 15.11.).

**Status:**

| Status | Heißt |
| --- | --- |
| umgesetzt, getestet | Funktion gebaut, automatischer Test vorhanden (Fundstelle nennt Code und Test) |
| teilweise | Kern gebaut, ein benannter Teil fehlt oder weicht ab |
| fehlt | nicht gebaut |
| bewusst nicht | absichtlich ohne Funktion: Einrichtung durch Fabian, abgelöst durch eine spätere Entscheidung oder bewusst ausgelassen |

„G.1“ heißt: zusätzlich in der Gesamtabnahme ([abnahme.md](abnahme.md)) mit echtem MongoDB und Browser geprüft. Testdateien liegen
unter `backend/tests/`, Specs unter `frontend/e2e/`.

## 1. Bausteine des erzeugten Regelwerks

Jeder Satz eines Bausteins gegen die Funktion, die ihn trägt.

| Baustein · Satz | Funktion im Code | Test | Status |
| --- | --- | --- | --- |
| Modi: Ergebnisregel je Modus in Klartext (Ziel, Runden, Verlängerung, Remis), Zeit, Spieler je Seite | `league_rule_facts.rule_sentence`, Prüfung `league_result_rules.py`, `models.normalize_rule` | `test_league_rule_facts_unit.py`, `test_league_result_rules_flow.py` | umgesetzt, getestet |
| Spielformat: „Best of N – gewonnen hat, wer X Maps gewinnt“ | `league_games` (Serie), `scoring_rules` | `test_league_bo5_flow.py`, G.1 Szenario 9 | umgesetzt, getestet |
| Spielformat: Teamgröße je Map, Kader mindestens/höchstens | `league_eligibility.py`, `league_roster.py` | `test_league_squad_rules_flow.py`, `test_league_season_rules_flow.py` | umgesetzt, getestet |
| Spielformat: Map-Wiederholung („nur in einem anderen Modus“ …) | `league_games` (Prüfung der Maps), `league_pool_check.py` | `test_league_games_repeat_flow.py` | umgesetzt, getestet |
| Spielformat: Teilnehmerliste einmal je Spiel, mindestens N | `league_games._lineup`, `lineup_mode` | `test_league_participants_flow.py` | umgesetzt, getestet |
| Modusfolge: Map 1, 2, 3 …, „bei mehr Maps beginnt die Folge von vorn“ | `league_games.py:394`, `league_veto_rules.py:322` (Modulo) | `test_league_mode_order_flow.py` | umgesetzt, getestet |
| Map-Pool: Maps je Modus | `map_pools.py` (Versionen, festgehalten am Spiel) | `test_map_pools_flow.py`, `test_league_pools_flow.py` | umgesetzt, getestet |
| Tabelle: Punkte Sieg/Remis/Niederlage oder je gewonnene Map | `scoring_rules.py`, `competition_standings.py` | `test_league_map_points_unit.py`, `test_league_table_e1_flow.py`, G.1 Szenario 11 | umgesetzt, getestet |
| Tabelle: Beispiel zu den Map-Punkten („3:2 ergibt 3 und 2 Punkte, 3:0 ergibt 3 und 0“ bei Best of 5) | `league_rule_facts.map_points_example` aus dem Best of der Season bzw. Liga N (#2424) | `test_league_rule_facts_unit.py::test_map_points_example_follows_the_best_of_of_season_and_division` | umgesetzt, getestet (A5) |
| Tabelle: Reihenfolge bei Punktgleichheit, direkter Vergleich mit Kriterien | `competition_standings.py` (Mini-Tabelle, Nr. 42, 78) | `test_league_tiebreak_unit.py`, G.1 Szenario 16 | umgesetzt, getestet |
| Tabelle: Kampflos – Sieger bekommt die zum Sieg nötigen Maps | `scoring_rules.forfeit_score`, `league_table_routes.py` | `test_league_forfeit_maps_flow.py`, G.1 Szenario 15 | umgesetzt, getestet |
| Tabelle: Beide nicht erschienen – beide verlieren, keine Maps | `league_table_routes.py` (Doppel-Nichtantritt), `competition_standings.py` | `test_league_table_e1_flow.py` (`double_no_show`) | umgesetzt, getestet |
| Tabelle: Ausscheiden – alle Spiele für den Gegner, Tabellenende (bzw. 50-%-Regel) | `tournament_events.py:204`, `competition_standings.py:383, 647` | `test_league_sanctions_table_flow.py`, `test_league_tiebreak_unit.py` | umgesetzt, getestet |
| Termine: Spielwochen, Zeitraum, Standardtermin, Sperrzeiten | `league_calendar.py`, `matchday_schedule.py` | `test_league_weeks_unit.py`, `test_league_default_time_unit.py`, `test_league_schedule_blocked_flow.py` | umgesetzt, getestet |
| Termine: Antwortfrist auf Vorschläge | `matchday_schedule.response_deadline` | `test_league_schedule_response_flow.py` | umgesetzt, getestet |
| Termine: 72-h-Regel (Frist einstellbar) | `league_schedule.home_rule_at`, `league_schedule_sweep.home_rule_problem` | `test_league_schedule_flow.py`, `test_league_rule_facts_unit.py` | umgesetzt, getestet – **Satz in G.3 korrigiert** (siehe 4.) |
| Termine: Verschiebung höchstens N je Spiel, Antrag spätestens X h vorher, Spielwoche | `league_schedule.py` (Anträge, Historie) | `test_league_schedule_flow.py`, `test_league_schedule_rules_unit.py` | umgesetzt, getestet |
| Termine: Erinnerung „Ergebnis fehlt“, überfällig nach X h | `league_reminders.py`, `league_schedule_sweep.py` | `test_league_reminders_flow.py`, `test_league_no_show_flow.py` | umgesetzt, getestet |
| Check-in: Fenster vor/nach dem Termin, Mindestzahl, ergänzen bis Fensterende | `match_flow.py`, `checkin_rules.py` | `test_league_checkin_flow.py`, G.1 Szenario 7 | umgesetzt, getestet |
| Check-in: Start auch vor dem Termin, Fehlen → Entscheid der Leitung, nie automatisch | `match_flow.py`, `league_checkin_sweep.py` | `test_league_checkin_flow.py`, `test_league_no_show_flow.py`, G.1 Fristen-Job | umgesetzt, getestet |
| Veto: Team A Heimteam oder per Los | `league_veto_rules.py` (`team_a`) | `test_league_veto_rules_unit.py`, `test_league_veto_flow.py` | umgesetzt, getestet |
| Veto: Zeit je Schritt, nach Ablauf Zufall aus zulässigen Maps | `league_veto_sweep.py` | `test_league_veto_flow.py`, G.1 Szenario 8 | umgesetzt, getestet |
| Veto: beginnt, sobald beide eingecheckt sind; Map 1 direkt danach | `league_veto.ensure_started`, Prüfung „Veto braucht Check-in“ in `league_readiness.py:125` | `test_league_veto_flow.py`, G.1 Szenario 7 | umgesetzt, getestet |
| Veto: Vorgabe der Woche, ohne sie kein Start | `league_veto._wait_for_preset`, `league_veto_rules.preset_steps` | `test_league_veto_preset_flow.py`, `test_league_veto_preset_unit.py` | umgesetzt, getestet – **Satz in G.3 ergänzt** (Bereit-Start, siehe 4.) |
| Veto: Schrittfolge nummeriert | `league_veto_rules.step_sentence` | `test_league_veto_rules_unit.py` | umgesetzt, getestet |
| Erlaubte Ausrüstung je Kategorie, „nur erlaubt“/„gesperrt“, je Modus und Waffe | `loadout_bans.py` | `test_loadout_bans_rules_flow.py`, `test_loadout_allowed_table_unit.py`, `test_loadout_class_bans_flow.py`, `ausruestung-*.spec.js` | umgesetzt, getestet |
| Einstellungen je Modus (Zeitlimit, Regeltext) | `league_rule_blocks._mode_settings` | `test_league_rules_dynamic_flow.py` | umgesetzt, getestet |
| Spielberechtigung: Zulassung alle Konten / nur Mitglieder | `league_applications.py` (`entry_policy`) | `test_league_application_flow.py` | umgesetzt, getestet |
| Spielberechtigung: Annahme automatisch oder durch die Leitung | `league_applications.py` (`application_auto_accept`) | `test_league_application_auto_flow.py` | umgesetzt, getestet |
| Spielberechtigung: Mindestalter laut Geburtsdatum | `league_eligibility.py` | `test_league_eligibility_flow.py`, `test_league_birth_date_guard_unit.py` | umgesetzt, getestet |
| Spielberechtigung: Spiel-IDs, „jede Spiel-ID nur einmal je Season“ | `league_roster.py`, `league_eligibility.py` | `test_league_roster_flow.py`, `test_league_eligibility_race_flow.py` | umgesetzt, getestet |
| Spielberechtigung: Plattform, Crossplay, Eingabegerät je Season und Liga N | `league_platform.py` | `test_league_platform_flow.py`, `league-platform.spec.js` | umgesetzt, getestet |
| Spielberechtigung: ein Co-Team je Season, Wechsel nur als Transfer | `league_eligibility.py`, `league_transfers.py` | `test_league_transfers_flow.py` | umgesetzt, getestet |
| Spielberechtigung: Wartezeit nach Spielwoche 1, nach Transfer immer | `league_eligibility.py` (`wait_until`) | `test_league_wait_until_unit.py`, `test_league_eligibility_flow.py`, `test_league_rule_facts_unit.py::test_rule_blocks_say_matchweek_not_matchday` | umgesetzt, getestet (A6, #2424) |
| Spielberechtigung: Stichtag – danach Freigabe der Leitung | `league_roster.py:90, 878` (`late_squad_ids`) | `test_league_roster_rules_flow.py` | umgesetzt, getestet |
| Spielberechtigung: Transferfenster | `league_transfers.py` | `test_league_transfers_flow.py` | umgesetzt, getestet |
| Regelwerk: Versionen, PDF, Änderungsmarkierung, Vergleich, Zustimmung | `league_rules.py`, `league_rules_store.py`, `league_rules_text.py` | `test_league_rules_flow.py`, `test_league_rules_pdf_unit.py`, `test_league_rules_consent_flow.py`, `test_league_rules_review_flow.py` | umgesetzt, getestet |
| Regelwerk: Variablen, leere Variable „(nicht festgelegt)“, unbekannte lehnen ab | `league_rule_vars.py` | `test_league_rule_facts_unit.py`, `test_league_rules_dynamic_flow.py` | umgesetzt, getestet |
| Regelwerk: Änderung der Daten schlägt neue Fassung vor | `league_rules.data_changes` | `test_league_rules_dynamic_flow.py`, `test_league_rules_tasks_flow.py` | umgesetzt, getestet |

## 2. Entscheidungen Nr. 1 bis 180

Nicht vergebene Nummern gibt es keine; Nr. 33 ist durch 11c, Nr. 35 durch 68, Nr. 74 durch 118 abgelöst.

### Vor Phase B (Rechte, Kader, Anmeldung)

| Nr. | Regel | Fundstelle Code · Test | Status |
| --- | --- | --- | --- |
| Zentrale | Website ist das Liga-System, Discord nur Ergänzung | alle Liga-Module; Discord nur `league_reminder_rules` (`discord`) | umgesetzt, getestet |
| Anmeldung | Selbstanmeldung mit Co-Team, Admin-Zuteilung bleibt | `league_applications.py`, `tournament_registration_routes.py` · `test_league_application_flow.py`, G.1 Szenario 3, 4 | umgesetzt, getestet |
| Architektur | Bestehendes erweitern, keine CoD-Werte im Code | Vorgaben in `league_service.SEASON_DEFAULTS`, `league_presets.py` · `test_league_admin_flow.py` | umgesetzt, getestet |
| Liga-Rechte | Bereich `leagues` mit 2FA, Zuständige je Liga, Befangenheit, Superadmin-Notausnahme | `league_permissions.py`, `permissions.py` · `test_league_rights_matrix_flow.py`, `test_league_conflict_flow.py` | umgesetzt, getestet |
| 1 | Datenschutztext für Externe, Fabian gibt frei und lässt prüfen | Feld `application_privacy_text`, Anzeige und Speicherung bei der Anmeldung · `test_league_application_flow.py` | teilweise: Technik fertig, **Wortlaut fehlt** (Fabian) |
| 2 | In der Liga keine Ergebniskorrektur durch Helfer, nur Zuständige mit 2FA | `league_permissions.py` · `test_league_rights_matrix_flow.py`, `test_league_games_staff_flow.py` | umgesetzt, getestet |
| 3 | Kader mindestens 3, höchstens 50, je Season | `league_service.SEASON_RULE_DEFAULTS`, `league_eligibility.py` · `test_league_squad_rules_flow.py` | umgesetzt, getestet |
| 4 | Kein Ersatz-Konzept, jeder im Kader einsetzbar | `league_games._lineup` · `test_league_participants_flow.py` | umgesetzt, getestet |
| 5 | Ein Team je Season, in anderen Ligen andere Teams | `league_eligibility.py` (`one_team_per_season`) · `test_league_eligibility_flow.py` | umgesetzt, getestet |
| 6 | Stichtag optional, sperrt Neuzugänge, Abgänge frei | `league_roster.py` (`roster_deadline`, `late_squad_ids`) · `test_league_roster_rules_flow.py` | umgesetzt, getestet |
| 7 | Transferfenster, Leitung genehmigt, Protokoll | `league_transfers.py` · `test_league_transfers_flow.py` | umgesetzt, getestet |
| 8 | Spiel-ID-Format je Spiel, eindeutig je Season, Selbstauskunft | `league_roster.py`, `games.player_id_fields` · `test_league_eligibility_race_flow.py`, `league-ids.spec.js` | umgesetzt, getestet |
| 9 | Plattform Pflichtfeld je Spiel, je Season festgehalten | `league_platform.py` · `test_league_platform_flow.py` | umgesetzt, getestet |
| 10 | Warnung bei Unterschreiten des Mindestkaders, Abgang bleibt möglich | `league_roster.py`, `squad_problems` · `test_league_roster_added_notice_flow.py`, `test_league_squad_rules_flow.py` | umgesetzt, getestet |
| 11 | Erneute Zustimmung wählt die Leitung je Änderung | `league_rules.py` (`requires_consent`) · `test_league_rules_consent_flow.py` | umgesetzt, getestet; **geändert durch D.2:** ohne Zustimmung kein Check-in (Nr. 86), nicht „Spiel läuft weiter“ |
| 11a | Bis Ende Spieltag 1 sofort, danach 7 Tage Wartezeit, Aufhebung mit Grund | `league_eligibility.py` · `test_league_wait_until_unit.py`, `test_league_eligibility_flow.py` | umgesetzt, getestet |
| 11b | Mit 3 antreten ohne Nachteil | `lineup_min_players`, `checkin_rules.py` · `test_league_participants_flow.py`, `test_league_checkin_flow.py` | umgesetzt, getestet |
| 11c | Aufgelöst, ausgetreten, disqualifiziert: alle Spiele für die Gegner, Tabellenende | `tournament_events.py`, `competition_standings.py` (`exit_rule`) · `test_league_sanctions_table_flow.py`; Auflösung läuft über „Austritt eintragen“ (`team_dissolve.py`) | umgesetzt, getestet |

### Vor Phase C (Ergebnisse)

| Nr. | Regel | Fundstelle Code · Test | Status |
| --- | --- | --- | --- |
| 12 | Punkte je Map Pflicht in der Liga | `scores_required`, `league_result_rules.py` · `test_league_result_rules_season_flow.py` | umgesetzt, getestet |
| 13 | Ergebnisgrenzen am Modus, Season kann abweichen | `game_modes.py`, `result_rules` an der Season · `test_league_result_rules_flow.py`, `test_league_result_rules_snapshot_flow.py` | umgesetzt, getestet |
| 14 | Dritter Modus und Poolgröße trägt Fabian ein | Daten | bewusst nicht (Einrichtung) |
| 15 | Gleiche Map nur in anderem Modus, je Season | `map_repeat` · `test_league_games_repeat_flow.py` | umgesetzt, getestet |

### Vor Phase D (Matchablauf)

| Nr. | Regel | Fundstelle Code · Test | Status |
| --- | --- | --- | --- |
| 16 | Standardtermin trägt Fabian ein | Daten (`default_match_weekday`, `default_match_time`) | bewusst nicht (Einrichtung) |
| 17 | Heimvorschlag gilt nach 72 h, wenn er in der Spielwoche liegt; abschaltbar | `league_schedule.home_rule_at`, `league_schedule_sweep.py` · `test_league_schedule_flow.py` | umgesetzt, getestet (Regelwerk-Satz in G.3 korrigiert) |
| 18 | Verschiebung: beide, Grund, bis 24 h vorher, höchstens zweimal, in der Spielwoche | `league_schedule.py` · `test_league_schedule_flow.py`, `test_league_schedule_rules_unit.py` | umgesetzt, getestet |
| 19 | Check-in 15 min vor bis 15 min nach dem Termin | `checkin_rules.py`, `match_flow.py` · `test_league_checkin_flow.py`, G.1 Szenario 2, 7 | umgesetzt, getestet |
| 20 | Nichtantritt: Leitung entscheidet, nie automatisch | `league_checkin_sweep.py` (`no_show_proposal`) · `test_league_no_show_flow.py`, G.1 Fristen-Job | umgesetzt, getestet |
| 21 | Veto Pflicht im System, Vorlage je Season, abschaltbar | `league_veto_rules.py`, `league_veto.py` · `test_league_veto_flow.py` | umgesetzt, getestet |
| 22 | Team A = Heimteam, je Season auf Los | `league_veto_rules.py` (`team_a`) · `test_league_veto_rules_unit.py` | umgesetzt, getestet |
| 23 | 60 s je Schritt, Zufall bei Ablauf, Leitung kann pausieren | `league_veto_sweep.py`, `league_veto.py` · `test_league_veto_flow.py` (`veto_pause`) | umgesetzt, getestet |
| 24 | Vorfall erfassen, Einigung, sonst Leitung, Map zählt nie doppelt | `league_incidents.py` · `test_league_incidents_flow.py`, `test_league_incidents_unit.py` | umgesetzt, getestet |

### Vor Phase E (Wertung, Proteste, Strafen)

| Nr. | Regel | Fundstelle Code · Test | Status |
| --- | --- | --- | --- |
| 25 | Punkte, direkter Vergleich (Mini-Tabelle), Map-Differenz, gewonnene Maps, Leitung | `scoring_rules.LEAGUE_TABLE_DEFAULTS`, `competition_standings.py` · `test_league_tiebreak_unit.py`, G.1 Szenario 16 | umgesetzt, getestet |
| 26 | Default-Win mit den Maps des Best of, als kampflos markiert | `forfeit_score: best_of` · `test_league_forfeit_maps_flow.py`, G.1 Szenario 15 | umgesetzt, getestet |
| 27 | Beide nicht erschienen: beide verlieren, 0 Punkte, Leitung kann neu ansetzen | `league_table_routes.py`, `DoubleNoShowAction.jsx` · `test_league_table_e1_flow.py` | umgesetzt, getestet |
| 28 | Nie gemeldete Spiele: Erinnerung, überfällig, ohne Entscheidung kein Abschluss | `league_reminders.py`, `league_desk.py`, `league_final.py` · `test_league_reminders_flow.py`, `test_league_final_flow.py` | umgesetzt, getestet |
| 29 | Protestfrist 48 h, ruht in Sperrzeiten, Beweise nachreichbar | `league_procedures._hours`, `protest_hours` · `test_league_procedures_flow.py`, `test_league_dispute_window_flow.py` | umgesetzt, getestet |
| 30 | Angefochtener Sieg zählt vorläufig und ist markiert | `competition_standings.py` · `test_league_procedures_hold_flow.py`, G.1 Szenario 12 | umgesetzt, getestet |
| 31 | Beweise bis Season-Ende plus 30 Tage, länger bei Verfahren oder Strafe | `match_proof_retention.py`, `league_sanction_bans.py` · `test_match_proofs_retention_flow.py` | umgesetzt, getestet |
| 32 | Alle Strafarten technisch, Katalog im Regelwerk, Leitung wählt von Hand | `league_sanctions.py` · `test_league_sanctions_flow.py`, G.1 Szenario 14 | umgesetzt, getestet |
| 33 | Disqualifikation (50-%-Regel) | – | bewusst nicht (abgelöst durch 11c) |
| 34 | Discord nur im Liga-Kanal, je Season | – | bewusst nicht (abgelöst durch 148: Direktnachricht statt Kanal) |

### Belohnungen F.4 (34a bis 34d)

| Nr. | Regel | Fundstelle Code · Test | Status |
| --- | --- | --- | --- |
| 34a | Empfänger je Belohnung einstellbar, Vorgabe Team und Spieler mit Einsatz | `league_rewards.py` (`recipients`, `reward_players`) · `test_league_rewards_flow.py` | umgesetzt, getestet |
| 34b | „Alle Teilnehmer“ = regulär beendet, ohne Ausgeschiedene | `league_rewards.grant` (Zeilen ohne `exit`) · `test_league_rewards_flow.py` | umgesetzt, getestet |
| 34c | 1 Banner, bis zu 3 Embleme/Medaillen neben dem Namen, Rest in der Vitrine | Banner (`featured_award_id`) und Titel (`featured_title_award_id`) · `test_awards_flow.py`, `test_league_rewards_flow.py` | teilweise: Banner und ein Titel wählbar, **drei Embleme neben dem Namen fehlen** |
| 34d | Keine XP, keine Erfolge | `kind: reward` zählt nirgends · `test_league_rewards_flow.py` | umgesetzt, getestet |

### Einrichtung

| Nr. | Regel | Fundstelle Code · Test | Status |
| --- | --- | --- | --- |
| 35 | Name „Tiroler Liga MW4“ | – | bewusst nicht (abgelöst durch 68) |
| 36 | MW4 als Version unter Call of Duty | Spiele-Verwaltung (Daten) | bewusst nicht (Einrichtung) |
| 37 | Kalender Season 1 trägt Fabian ein; Tests mit erfundenen Daten | `scripts/seed_liga_g1.py` (relative Daten) | bewusst nicht (Einrichtung) |

### Aus dem Regelwerk-Abgleich v0.11 und später

| Nr. | Regel | Fundstelle Code · Test | Status |
| --- | --- | --- | --- |
| 38 | Mindestalter je Season, Vorgabe 18, Geburtsdatum als Selbstauskunft | `league_eligibility.py` (`min_age`) · `test_league_eligibility_flow.py` | umgesetzt, getestet |
| 39 | Teilnehmerliste einmal je Spiel, mindestens 3, je Season umstellbar auf je Map | `lineup_mode`, `league_games.py` · `test_league_participants_flow.py`, G.1 Altdaten | umgesetzt, getestet |
| 40 | Veto startet nach beidem Check-in, Map 1 direkt danach | `league_veto.ensure_started` · `test_league_veto_flow.py` | umgesetzt, getestet |
| 41 | Einspruch gegen Strafen: einmal, 48 h, andere Person, Strafe gilt weiter | `league_sanctions.py:92` · `test_league_sanctions_flow.py`, G.1 Szenario 14 | umgesetzt, getestet |
| 42 | Mini-Tabelle: Punkte, Map-Differenz, gewonnene Maps, dann Gesamtwerte, Leitung | `competition_standings.py` · `test_league_tiebreak_unit.py` | umgesetzt, getestet |
| 43 | Tabellenende: später Ausgeschiedene oben, Disqualifizierte ganz unten | `competition_standings.py:596` · `test_league_tiebreak_unit.py`, `test_league_sanctions_table_flow.py` | umgesetzt, getestet |
| 44 | Vorläufige Sperre bei Cheating-Verdacht | `league_sanction_bans.py` (`provisional`) · `test_league_sanctions_flow.py` | umgesetzt, getestet |
| 45 | Einspruch gegen Strafen, Protestentscheide, kampflos, Korrekturen; nicht Termine, Kader, Anmeldung | `league_procedures.py:325` · `test_league_procedures_flow.py` | umgesetzt, getestet |
| 46 | Check-in mindestens 3 Berechtigte, ergänzen bis Fensterende | `checkin_rules.py`, `match_flow.py` · `test_league_checkin_flow.py` | umgesetzt, getestet |
| 47 | Teilnehmerliste fehlt: Ergebnis gilt, Aufgabe, nach 48 h Fall bei der Leitung | `league_desk.py`, `lineup_amend_hours` · `test_league_participants_flow.py`, `test_league_desk_flow.py` | umgesetzt, getestet |
| 48 | Spiel zwischen zwei Ausgeschiedenen zählt für keinen | `competition_standings.py` · `test_league_tiebreak_unit.py` | umgesetzt, getestet |
| 49 | Gesamtwertung: Punkte nach Season-Platz, je Liga einstellbar | `league_overall.py`, `league_overall_rules.py` · `test_league_overall_flow.py`, `test_league_overall_unit.py` | umgesetzt, getestet |
| 50 | Co-Team und Spielerwertung bei Einsatz | `league_overall.py` · `test_league_overall_flow.py` | umgesetzt, getestet |
| 51 | Zählende Seasons an der Liga, Abschluss durch die Leitung, öffentlich | `league_overall.py` (`league_overall_finals`) · `test_league_overall_flow.py`, `league-overall.spec.js` | umgesetzt, getestet |
| 52 | Eigene Gesamtwertung je Stufe | `league_overall.py` (`level`) · `test_league_overall_flow.py` | umgesetzt, getestet |
| 53 | Eigene Regelwerk-Seite mit Inhalt, Suche, Paragrafen-Links, PDF je Version | `league_rules.py`, `league_rules_text.py` · `test_league_rules_flow.py`, `test_league_rules_pdf_unit.py`, `league-rules.spec.js` | umgesetzt, getestet |
| 54 | Geänderte Paragrafen markiert, „Neu in Version X“, Vergleich | `league_rules_text.py` · `test_league_rules_review_flow.py`, `test_league_rules_text_unit.py` | umgesetzt, getestet |
| 55 | Maps, Modi, Waffen als Bausteine, Änderung schlägt neue Version vor, Version friert ein | `league_rule_blocks.py`, `league_rules.data_changes` · `test_league_rules_dynamic_flow.py` | umgesetzt, getestet |
| 56 | Ausrüstungs-Bibliothek je Spiel, Sperrliste je Season, je Modus und Aufsatz | `loadout_bans.py`, `game_equipment` · `test_game_equipment_flow.py`, `test_loadout_bans_flow.py` | umgesetzt, getestet |
| 57 | Waffen in Phase C, vor dem Start | C.4 (#2218, PR #2272) | umgesetzt, getestet |
| 58 | Belohnungsbild: Design hochladen, Textfelder, System beschriftet | `RewardArt.jsx` (Vorlage mit Beschriftung), `image_url` | teilweise: abgelöst durch 164 (Lionsquad-Vorlage plus eigenes Bild); frei gestaltete Textfelder fehlen |
| 59 | Reiter „Trophäen“ an Team und Profil mit Karten, Links, Filtern | Reiter **Auszeichnungen** (`PublicProfilePage.jsx`), `RewardCollection` | teilweise: Sammlung je Season ohne Filter |
| 60 | Rankingbanner: Live-Bild mit Platz und Bilanz, fester Link zum Einbinden | – | **fehlt** |
| 61 | Co-Teams in laufenden Staffeln: nur eigenes Team und Zuständigkeit Kader | `team_routes.py`, `league_permissions.py` · `test_league_squad_rights_flow.py` | umgesetzt, getestet |
| 62 | Termin im eigenen Spiel: zweite Person setzt | `league_schedule.py` · `test_league_own_match_schedule_flow.py` | umgesetzt, getestet |
| 63 | Protestfrist 48 h ab Bestätigung, vorher Beanstandung | `league_procedures.kind_now` · `test_league_procedures_flow.py` | umgesetzt, getestet |
| 64 | Gesamtpunkte 25-20-17-…, je Liga einstellbar | `points_mode: table` (eigene Tabelle) | bewusst nicht als Vorgabe (abgelöst durch 171); als eigene Tabelle einstellbar |
| 65 | Gleichstand Gesamtwertung: mehr 1./2./3. Plätze … | – | bewusst nicht (abgelöst durch 175) |
| 66 | Season zählt nur, wenn die Stufe genau eine Staffel hat | `league_overall.compute` rechnet „N je Staffel“ | **teilweise: weicht ab** (Abweichung A3) |
| 67 | Teilnehmerliste nachtragen durch Captain oder Vertreter | `league_games.py` · `test_league_participants_flow.py` | umgesetzt, getestet |
| 68 | Name „Tiroler Liga MW4 Allmode“, Adresse `tiroler-liga-mw4-allmode` | – | bewusst nicht (Einrichtung durch Fabian) |
| 69 | Je Format eine eigene Liga mit eigenem Regelwerk | Regelwerk je Liga und Season (`league_rules`) · `test_league_rules_flow.py` | umgesetzt, getestet |
| 70 | Allmode 4v4 Core, Hardcore getrennt | Daten | bewusst nicht (Einrichtung) |
| 71 | Transfer hat immer die Wartezeit, Aufhebung mit Grund | `league_transfers.py` · `test_league_transfers_flow.py` | umgesetzt, getestet |
| 72 | Bild im Regelwerk bleibt, Personenbezug fällt bei Kontolöschung | #2230 (PR #2241) · `test_league_rules_media_flow.py` | umgesetzt, getestet; Satz im Datenschutztext fehlt (Nr. 1) |
| 73 | Anmeldung des eigenen Teams entscheidet eine zweite Person | `league_applications.py` · `test_league_application_conflict_flow.py` | umgesetzt, getestet |
| 74 | Fehlende Spiel-IDs blockieren erst unter Mindestkader | – | bewusst nicht (abgelöst durch 118) |
| 75 | Captain oder Vertreter stimmt zu, Version und Wortlaut gespeichert | `league_applications.py` (`consent`) · `test_league_application_decision_flow.py` | umgesetzt, getestet; rechtliche Prüfung offen (Nr. 1) |
| 76 | Eigene Spielseite mit Reitern | `AdminGamePage.jsx` (#2249, PR #2263) · `AdminGamePage.test.jsx` | umgesetzt, getestet |
| 77 | Ergebnisregel übergehen: Liga-Leitung mit Grund, protokolliert | `rule_override` · `test_league_result_rules_flow.py`, `test_league_conflict_flow.py` | umgesetzt, getestet |
| 78 | Direkter Vergleich nur, wenn in der Gruppe alle Spiele gespielt sind | `competition_standings.py` · `test_league_tiebreak_unit.py` | umgesetzt, getestet |
| 79 | Turniere und Liga getrennt, Liga-Pakete ändern Turniere nicht | `league_scope.py`, `staffel_guard.py` · `test_league_stage_guard_flow.py`, `test_league_side_effects_flow.py` | umgesetzt, getestet |
| 80 | Eigene Staffel-Seite in der Liga-Verwaltung, Turnierverwaltung ohne Staffeln | – (Staffeln laufen weiter über die Turnierverwaltung) | **fehlt** (#2262) |
| 81 | Aufsatz ohne Waffe passt zu keiner | `loadout_bans.py` · `test_loadout_bans_rules_flow.py` | umgesetzt, getestet |
| 82 | Eine Modus-Auswahl je Sperrzeile | `loadout_bans.py` · `test_loadout_bans_flow.py` | umgesetzt, getestet |
| 83 | Ein quadratisches Symbol je Modus | `mode_icons.py` · `test_mode_icons_flow.py` | umgesetzt, getestet |
| 84 | Season-Seite mit Reitern | `seasonTabs.js`, `AdminLeagueSeasonPage.jsx` · `AdminLeagueSeasonPage.test.jsx`, `league-season-tabs.spec.js` | umgesetzt, getestet |
| 85 | Gegenseite sieht die Anwesenden mit Namen, Gründe nur die eigene Seite | `match_flow.py` · `test_league_checkin_flow.py` | umgesetzt, getestet |
| 86 | Regelwerks-Sperre gilt auch für den Notfall-Eintrag der Leitung | `match_flow.py` · `test_league_checkin_flow.py`, `test_league_rules_lock_flow.py` | umgesetzt, getestet |
| 87 | Plattform: Aufnahme geht, Spieler nicht spielberechtigt | `league_platform.py` · `test_league_platform_flow.py` | umgesetzt, getestet |
| 88 | Plattform je Season festgehalten | `league_platform.py` · `test_league_platform_flow.py` | umgesetzt, getestet |
| 89 | Leere Variable: Vorschau nennt sie, Veröffentlichen nach Bestätigung, „(nicht festgelegt)“ | `league_rule_vars.py` · `test_league_rules_dynamic_flow.py` | umgesetzt, getestet |
| 90 | Freigabe nach Änderung: Vorschlag mit Markierung, Freigabe in einem Schritt | `league_rules.py` · `test_league_rules_tasks_flow.py` | umgesetzt, getestet |
| 91 | „Regelwerk muss freigegeben werden“ gesammelt mit E.5 | `league_rules.py`, `duty.py` · `test_league_rules_tasks_flow.py` | umgesetzt, getestet |
| 92 | Keine Seitenwahl durch die Teams | `league_veto_rules.py` (keine Schrittart Seite) | umgesetzt, getestet; Seitenwahl für andere Spiele: #2402 |
| 93 | Veto nur Liga; Voting und Solo für Turniere später | – | bewusst nicht (später, ohne Vorrang) |
| 94 | Leitung trägt Schritte ein, „Vorschlag aus Modusfolge und Pools“ | `league_veto_rules.py` · `test_league_veto_rules_unit.py` | umgesetzt, getestet |
| 95 | Eine Ebene Unterkategorien | `game_equipment` · `test_equipment_subcategories_flow.py` | umgesetzt, getestet |
| 96 | Ganze Unterkategorie sperren, auch je Modus | `loadout_bans.py` · `test_loadout_class_bans_flow.py` | umgesetzt, getestet |
| 97 | Aufsätze passen zu Unterkategorien und Waffen | `loadout_bans.py` · `test_loadout_allowed_by_weapon_unit.py` | umgesetzt, getestet |
| 98 | Sperrliste gruppiert (Web), Tabelle (PDF) | `loadout_bans.py` · `test_loadout_bans_grouped_unit.py` | umgesetzt, getestet |
| 99 | Regelwerk zeigt, was erlaubt ist | `loadout_bans.allowed_data` · `test_loadout_allowed_table_unit.py` | umgesetzt, getestet |
| 100 | Veto-Folge Anlage B | `league_rule_facts.render_veto` (Anlage B aus der Vorlage, #2426), `league_rules_text.sections_of(empty_block=…)` · `test_league_rule_facts_unit.py`, `test_league_veto_flow.py::test_annex_b_comes_from_the_template_on_page_pdf_and_compare` | teilweise: Anlage B entsteht aus der Veto-Vorlage; **offen:** Fabian prüft die Folge gegen die CDL und trägt die Vorlage ein |
| 101 | Spielsperre mindestens ein Spiel, höchstens bis Season-Ende | `league_sanctions.py`, `league_sanction_bans.py` · `test_league_sanctions_flow.py` | umgesetzt, getestet |
| 102 | Lobby-Details in den Modus-Einstellungen | `league_rule_blocks._mode_settings` · `test_league_rules_dynamic_flow.py` | umgesetzt, getestet |
| 103 | Frühe Abbrüche: S&D ab erster Runde, Respawn ab erstem Punkt | `league_incident_rules.py` (Vorschlag „Neustart frühe Phase“) · `test_league_incidents_unit.py` | umgesetzt, getestet: Das System prüft die Schwelle bewusst nicht (die Teams wählen den Vorschlag); der Baustein `[[baustein:lead_rulings]]` sagt, dass sonst die Leitung von Hand wertet (#2424, A7) |
| 104 | Externe Sperren wegen Cheating: nicht spielberechtigt, Leitung prüft | `league_sanctions.py` (Art externe Sperre) · `test_league_sanctions_flow.py` | umgesetzt, getestet |
| 105 | Veto bei neuen Seasons an, Vorlage per Vorschlag | `league_service.py` · `test_league_veto_flow.py` | umgesetzt, getestet |
| 106 | Liga N mit anderem Best of: kein Veto, Warnung | `league_veto.outlook` (`skipped`), `league_readiness.py` · `test_league_veto_flow.py` | umgesetzt, getestet |
| 107 | Leitung wählt nie für eine Seite | `league_veto_routes.py` · `test_league_veto_flow.py`, G.1 Rechte | umgesetzt, getestet |
| 108 | Unberührte Veto-Vorlage folgt dem Pool | `league_veto_rules.py` · `test_league_veto_flow.py`, `test_league_admin_flow.py` | umgesetzt, getestet |
| 109 | MOSS-Pflicht am PC, Upload binnen 24 h | `league_procedures.py` (MOSS anfordern) · `test_league_procedures_flow.py` | umgesetzt, getestet; die Wertung bei fehlender Datei entscheidet die Leitung von Hand – so steht es im Baustein `[[baustein:lead_rulings]]` (#2424, A8) |
| 110 | Aufsätze je Waffe aufklappbar, „für Klasse übernehmen“ | `loadout_bans.py`, `SeasonLoadoutBansPanel.jsx` · `test_loadout_by_weapon_flow.py`, `ausruestung-je-waffe.spec.js` | umgesetzt, getestet |
| 111 | Modus-Hinweis „nur in …“ / „nicht in …“ | `loadout_bans.py` · `test_loadout_bans_rules_flow.py` | umgesetzt, getestet |
| 112 | „An keiner Waffe erlaubt: …“ als eigene Zeile | `loadout_bans.py` · `test_loadout_allowed_by_weapon_unit.py` | umgesetzt, getestet |
| 113 | „Für alle Klasse übernehmen“ ersetzt, wirkt mit Speichern | `SeasonLoadoutBansPanel.jsx` · `SeasonLoadoutBansPanel.test.jsx` | umgesetzt, getestet |
| 114 | Ausrüstung im Regelwerk als Tabelle, kürzere Form | `loadout_bans.py` · `test_loadout_allowed_table_unit.py`, `ausruestung-tabelle.spec.js` | umgesetzt, getestet |
| 115 | „Gesperrt“ im Kasten ganz oben | `AllowedEquipmentView.jsx` · `AllowedEquipmentView.test.jsx` | umgesetzt, getestet |
| 116 | Punkte nach gewonnenen Maps je Season | `scoring_rules.py` (`match_points_mode: maps`) · `test_league_map_points_flow.py` | umgesetzt, getestet |
| 117 | Map-Punkte: mehr Siege, direkter Vergleich, Map-Differenz, Leitung | `scoring_rules.MAPS_TABLE_TIEBREAKERS` · `test_league_map_points_unit.py` | umgesetzt, getestet |
| 118 | Anmeldung geht immer, Sperre erst bei Check-in und Aufstellung | `league_applications.py`, `league_eligibility.py` · `test_league_application_auto_flow.py` | umgesetzt, getestet |
| 119 | Erinnerung an fehlende Angaben bei Anmeldung und vor dem ersten Spiel | `league_open_points.py` · `test_league_open_points_flow.py` | umgesetzt, getestet |
| 120 | „Zu wenige Spielberechtigte“ misst die Check-in-Mindestzahl | `league_eligibility.py` · `test_league_open_points_unit.py` | umgesetzt, getestet |
| 121 | DeSBL-Abgleich: eigenes System, nur echte Lücken | Regeltext (Fabian) | bewusst nicht (Text, keine Funktion) |
| 122 | Veto-Schrittart „Vorgabe je Spielwoche“ | `league_veto_rules.py` · `test_league_veto_preset_unit.py` | umgesetzt, getestet |
| 123 | Keine Wechsel-Grenze, keine Strafe je Runde | – | bewusst nicht |
| 124 | Nach nachgetragener Vorgabe: „Vorgabe da – Veto kann starten“ | `league_veto.announce_ready` · `test_league_veto_preset_flow.py` | umgesetzt, getestet |
| 125 | „Spielwoche N“ mit Datum | Oberfläche (`leagueVeto.js`, Ligaseite) · `test_league_veto_preset_flow.py` | umgesetzt, getestet (Regelwerk sagt „Spielwoche“, A6, #2424) |
| 126 | Anmeldung automatisch annehmen je Season | `league_applications.py` · `test_league_application_auto_flow.py` | umgesetzt, getestet |
| 127 | Beide Seiten „Bereit zum Veto“, Leitung im Notfall mit Grund | `league_veto.set_ready`, `lead_start` · `test_league_veto_preset_flow.py`, `test_league_rights_matrix_flow.py` | umgesetzt, getestet (Regelwerk-Satz in G.3 ergänzt) |
| 128 | Wer zuerst kommt, wird zuerst bedient; Rückzug vor festem Spielplan | `league_applications.py` · `test_league_application_auto_flow.py`, `test_league_application_race_flow.py` | umgesetzt, getestet |
| 129 | Liga: `protest_hours` 48 h ab Bestätigung; Turniere 30 min | `league_procedures.py`, `match_disputes.py` · `test_league_dispute_window_flow.py` | umgesetzt, getestet |
| 130 | Ein Verfahren mit Art Beanstandung oder Protest | `league_procedures.py` · `test_league_procedures_flow.py` | umgesetzt, getestet |
| 131 | Vorfall mit Vorschlag, Zustimmung, „in Klärung“ nach N min, Kontingent | `league_incidents.py` · `test_league_incidents_flow.py` | umgesetzt, getestet |
| 132 | Serie bei Map „in Klärung“: unter Vorbehalt oder pausiert | `league_incident_rules.py` · `test_league_incident_settings_flow.py` | umgesetzt, getestet |
| 133 | Sichtbarkeit im Verfahren, Stellungnahme 48 h | `league_procedures.py` · `test_league_procedures_leak_flow.py` | umgesetzt, getestet |
| 134 | Ein offenes Verfahren je Seite, Zurückziehen, Gründe-Liste | `league_procedures.py`, `league_protest_settings.py` · `test_league_procedures_flow.py`, G.1 Szenario 12 | umgesetzt, getestet |
| 135 | Übernehmen, Zielfrist 72 h, Eskalation, keine Automatik | `league_procedure_sweep.py` · `test_league_procedures_review_flow.py` | umgesetzt, getestet |
| 136 | MOSS nach Verfahrensende löschen, übrige Beweise bis Season-Ende plus Frist | `match_proof_retention.py` · `test_match_proofs_retention_flow.py` | umgesetzt, getestet |
| 137 | MOSS sehen nur Hochladende, eigene Captains, nicht befangene Leitung | `league_procedures.py` · `test_league_procedures_leak_flow.py` | umgesetzt, getestet |
| 138 | Keine Map auf Vorrat, Leitung setzt fehlende Map an | `league_incidents.py` · `test_league_incidents_flow.py` | umgesetzt, getestet |
| 139 | Team B orange, Team A blau | `VetoLive.jsx` · `VetoLive.test.jsx` | umgesetzt, getestet |
| 140 | „Map-Veto wartet“ einstellbar, Vorgabe 20 s / 5 s | `league_presets.py`, `league_reminder_rules.py` · `test_league_reminders_flow.py` | umgesetzt, getestet |
| 141 | MOSS bei Kontolöschung pseudonym bis Verfahrensende | `match_proof_retention.delete_for_user` · `test_match_proofs_retention_flow.py` | umgesetzt, getestet; Satz im Datenschutztext fehlt (Nr. 1) |
| 142 | Gegenseite sieht das abweichende Ergebnis | `league_procedures.py` (`claimed`) · `test_league_procedures_leak_flow.py` | umgesetzt, getestet |
| 143 | Eskalation je Season (`protest_escalate_hours`) | `league_protest_settings.py` · `test_league_procedures_flow.py` | umgesetzt, getestet |
| 144 | MOSS-Grenze 200 MB, sonst 50 MB | `league_procedures.py` (`moss_max_mb`) · `test_league_procedures_flow.py` | umgesetzt, getestet |
| 145 | Reiter „Proteste“ auf der Season-Seite | `seasonTabs.js`, `SeasonProtestsTab.jsx` · `SeasonProtestsTab.test.jsx` | umgesetzt, getestet |
| 146 | Offener Vorschlag hält das Ergebnis an; kampflos bei offenem Vorfall gesperrt | `league_incident_rules.py`, `match_routes.py` · `test_league_incidents_flow.py` | umgesetzt, getestet |
| 147 | Nach Neustart oder Wiederholung nur neue Meldungen | `league_incidents.py` · `test_league_incidents_flow.py` | umgesetzt, getestet |
| 148 | Discord-Direktnachricht mit Opt-in, Schalter je Season, Vorgabe aus | `league_reminder_rules.py` (`discord`) · `test_league_reminders_flow.py` | umgesetzt, getestet |
| 149 | Öffentlich nur „Map wiederholt“, Grund nur Teams und Leitung | `LeagueSeasonMatchdaysPage.jsx`, `MatchPage.jsx` · `LeagueSeasonMatchdaysPage.test.jsx` | umgesetzt, getestet |
| 150 | Laufende Season: Tabellen gleich unter „Was gespielt wird“ | `LeagueSeasonPage.jsx` · `test_league_public_flow.py`, `league-public.spec.js` | umgesetzt, getestet |
| 151 | Erinnerung 24 h/1 h auch in einer Sperrzeit | `league_reminders.py` · `test_league_reminders_flow.py` | umgesetzt, getestet |
| 152 | Reiter „Leitstand“ je Season | `league_desk.py`, `SeasonDeskTab.jsx` · `test_league_desk_flow.py`, `league-desk.spec.js` | umgesetzt, getestet |
| 153 | Rundnachricht an Captains oder alle Spieler | `league_desk.py` · `test_league_desk_flow.py`, `SeasonBroadcastSheet.test.jsx` | umgesetzt, getestet |
| 154 | Kein Abschluss bei offenen Spielen, Vorfällen, Verfahren, Fristen | `league_final.py` · `test_league_final_flow.py`, G.1 Szenario 17 | umgesetzt, getestet |
| 155 | Wiederöffnen durch zweite Person mit Grund | `league_final.py` · `test_league_final_flow.py`, G.1 Sperren | umgesetzt, getestet |
| 156 | Echter Gleichstand auf entscheidendem Platz verlangt Entscheid | `league_final.py` · `test_league_final_flow.py` | umgesetzt, getestet |
| 157 | F.1 merkt Auf- und Abstieg nur vor | `league_final.py` | umgesetzt, getestet (seit F.2 erledigt, Nr. 158) |
| 158 | Zonen je Liga N, Vorgabe 1/1 | `league_zones.py` · `test_league_zones_unit.py` | umgesetzt, getestet |
| 159 | Auf- und Abstieg automatisch aus dem Endstand | `league_successor.py` · `test_league_successor_flow.py` | umgesetzt, getestet |
| 160 | Teams automatisch übernommen, Abmelden möglich, Zustimmung vor dem ersten Spiel | `league_successor.py`, `league_applications.py` · `test_league_successor_flow.py`, `league-successor.spec.js` | umgesetzt, getestet |
| 161 | Übernahme aller Einstellungen als Entwurf | `league_successor.py` · `test_league_successor_flow.py`, G.1 Szenario 18 | umgesetzt, getestet |
| 162 | „Übernahme neu berechnen“ nach Korrektur | `league_successor.py` · `test_league_successor_flow.py`, `SeasonCloseTab.test.jsx` | umgesetzt, getestet |
| 163 | Spieler-Belohnung: Vorgabe Einsatz, umstellbar auf Kader | `league_rewards.py` · `test_league_rewards_flow.py` | umgesetzt, getestet |
| 164 | Lionsquad-Vorlagen, automatisch beschriftet, eigenes Bild möglich | `RewardArt.jsx`, `league_rewards.py` · `RewardArt.test.jsx` | umgesetzt, getestet |
| 165 | Vergabe sofort mit dem Abschluss | `league_final.close` → `league_rewards.grant` · `RewardMoment.test.jsx`, G.1 Szenario 17 | umgesetzt, getestet |
| 166 | Belohnungen ruhen beim Wiederöffnen, ohne Doppel neu | `league_rewards.py` · `test_league_rewards_flow.py` | umgesetzt, getestet |
| 167 | Ohne Aufstellungen bekommt der Kader die Spieler-Belohnung | `league_rewards.py` (`roster_fallback`) · `test_league_rewards_flow.py` | umgesetzt, getestet |
| 168 | Kampflose Spiele zählen nicht als Einsatz | `league_rewards.py` · `test_league_rewards_flow.py` | umgesetzt, getestet |
| 169 | Belohnungen am TV später | – | bewusst nicht (eigenes Issue #2410) |
| 170 | Eigene Gesamtwertung je Liga N | `league_overall.py` · `test_league_overall_flow.py` | umgesetzt, getestet |
| 171 | Punkte N bis 1, Meister +2, je Liga einstellbar | `league_overall_rules.DEFAULTS` · `test_league_overall_unit.py` | umgesetzt, getestet |
| 172 | Spielerwertung mit den Punkten des Co-Teams bei Einsatz | `league_overall.py` · `test_league_overall_flow.py` | umgesetzt, getestet |
| 173 | Anzahl zählender Seasons, Abschluss, Belohnungen auf Liga-Ebene | `league_overall.py` · `test_league_overall_flow.py` | umgesetzt, getestet |
| 174 | +2 für Platz 1 jeder Liga N | `league_overall.py:174` · `test_league_overall_unit.py` | umgesetzt, getestet |
| 175 | Gleichstand: Staffelsiege, beste Platzierung, jüngste Season, Leitung; nur Platz 1 sperrt | `league_overall_rules.DEFAULT_TIEBREAKERS` · `test_league_overall_unit.py` | umgesetzt, getestet |
| 176 | Private Profile als „Spieler mit privatem Profil“ | `league_overall.py` · `test_league_overall_flow.py`, `league-overall.spec.js` | umgesetzt, getestet |
| 177 | Spieler-Belohnung der Gesamtwertung nur bei Einsatz in einer Season mit Punkten | `league_overall.py` · `test_league_overall_flow.py::test_player_reward_needs_a_counted_season_with_points_for_that_co_team` | umgesetzt, getestet |
| 178 | Gesamtabnahme nächtlich in GitHub Actions | `.github/workflows/liga-abnahme-nacht.yml` · `liga-gesamtabnahme.spec.js`, `liga-grenzfaelle.spec.js` | umgesetzt, getestet (G.1, #2423) |
| 179 | App parallel in 1.9.x-Patch-Stufen | LionsAPP 1.7.10 (PR #2419) | umgesetzt (G.2) |
| 180 | Nachmeldung: Fenster über den Start, nur Hinweis | `league_readiness.py` (`application_after_start`), `league_applications.py` · `test_league_application_late_flow.py`, `test_league_pools_flow.py`, G.1 Nachmeldung | teilweise: Anmeldung geht, **Spiele für Nachrücker fehlen** (#2422) |

## 3. Abweichungen zwischen Regel und Funktion (Vorschläge für Issues)

Nicht still behoben. Je Punkt der Vorschlag; Fabian legt die Issues an.

| Nr. | Abweichung | Vorschlag |
| --- | --- | --- |
| A1 | **Nr. 80:** Staffeln laufen weiter in der Turnierverwaltung; die eigene Staffel-Seite in der Liga-Verwaltung fehlt (#2262). Laut Entscheidung „Paket nach Phase D, vor der Gesamtabnahme“. | #2262 vor Season 1 einplanen oder bewusst auf Season 2 schieben und so in der Entscheidungsliste vermerken. Das Handbuch beschreibt heute den Weg über die Turnierverwaltung. |
| A2 | **Nr. 180:** Ein nachgemeldetes Co-Team steht mit 0 Spielen in der Tabelle, der feste Spielplan bekommt keine Spiele dazu. | In #2422 entscheiden: Nachrücker-Spiele anhängen (Nachholwochen) oder Nachmeldung nur bis zum Start der Staffel. |
| A3 | **Nr. 66:** Entschieden war „eine Season zählt in der Gesamtwertung nur, wenn die Stufe genau eine Staffel hat“. Gebaut ist „N je Staffel“: Jede Staffel zählt, Platz 1 jeder Staffel bekommt so viele Punkte, wie seine Staffel Teams hat. | Entweder Nr. 66 als abgelöst vermerken (F.5-Rechnung bestätigen) oder eine Prüfung „nur bei genau einer Staffel“ als Schalter je Liga nachrüsten. |
| A4 | **Nr. 60:** Rankingbanner (Live-Bild mit Platz und Bilanz, fester Link zum Einbinden) fehlt. Nr. 34c: drei Embleme neben dem Namen fehlen, nur Banner und Titel sind wählbar. Nr. 59: Sammlung ohne Filter. | Ein Issue „Belohnungen: Rankingbanner, Embleme neben dem Namen, Filter der Sammlung (Rest aus F.4)“. |
| A5 | **Regelwerk, Baustein Tabelle:** Das Beispiel „3:2 ergibt 3 und 2 Punkte, 3:0 ergibt 3 und 0“ steht fest im Satz, auch bei Best of 3 oder 7. | **Erledigt (#2424):** Das Beispiel entsteht aus dem Best of der Season bzw. Liga N (BO3 „2:1 ergibt 2 und 1“, BO7 „4:3 ergibt 4 und 3“); Fassungen ohne eingefrorenes Best of nennen keine Zahlen. Auch der Hinweis unter der Tabelle der Staffel und die Hilfe in der Verwaltung folgen dem Best of. |
| A6 | **Regelwerk, Baustein Spielberechtigung und Veto:** „nach dem Ende von Spieltag 1“ und „alle Spiele dieses Spieltags“ – Nr. 125 nennt die Woche „Spielwoche“. Inhaltlich gleich (Spielwoche = Spieltag), nur das Wort weicht ab. | **Erledigt (#2424):** Bausteine, Spielberechtigung auf der Ligaseite, Hilfen der Verwaltung und Handbuch sagen „Spielwoche“. Im Fließtext (Verwaltung) passt Fabian „Ende des ersten Spieltags“ selbst an. |
| A7 | **Nr. 103:** Die Schwelle für frühe Abbrüche (S&D ab erster Runde, Respawn ab erstem Punkt) prüft das System nicht; die Teams wählen „Neustart in der frühen Phase“ selbst, die Leitung entscheidet bei Streit. | **Erledigt (#2424):** Neuer Baustein `[[baustein:lead_rulings]]` „Wertung durch die Leitung“: Die frühe Phase prüft das System nicht, die Teams einigen sich, sonst wertet die Liga-Leitung von Hand. Fabian setzt ihn in Anlage C ein. |
| A8 | **Nr. 109:** Fehlt eine MOSS-Datei, gelten laut Regel die Maps des Spielers als verloren. Das System meldet nur den Hinweis an die Leitung, gewertet wird von Hand. | **Erledigt (#2424):** Derselbe Baustein sagt: Fehlt die Datei nach der Frist, bekommt nur die Leitung einen Hinweis, gewertet wird von Hand. Fabian setzt ihn bei § 9a ein. |
| A9 | **Nr. 11:** Entschieden war „ohne Zustimmung Aufgabe und Hinweis, das Spiel läuft weiter“. Seit D.2 sperrt die fehlende Zustimmung Check-in, Start und erste Meldung (Nr. 86 setzt das voraus). | Nr. 11 in der Entscheidungsliste als geändert durch D.2 vermerken. |
| A10 | **Nr. 1, 72, 141:** Der Datenschutztext für externe Teilnehmer fehlt; er muss Bilder im Regelwerk nach Kontolöschung und MOSS-Aufbewahrung nennen. Ohne Text steht bei der Anmeldung ein Platzhalter-Satz. | Vor Season 1: Wortlaut freigeben und rechtlich prüfen lassen, in der Season eintragen (Reiter Anmeldung und Kader → Selbstanmeldung). |
| A11 | **Nr. 100:** Veto-Folge Anlage B ist offen, bis Fabian sie gegen die CDL geprüft hat. | **Teilweise (#2426):** `[[baustein:veto]]` erzeugt die ganze Anlage B aus der Vorlage (Regeln, Schritte als Tabelle, Ligen N ohne Veto); steht er allein in der Anlage, entfällt sie ohne Vorlage. **Offen:** Fabian prüft die Folge gegen die CDL und trägt die Vorlage vor Season 1 ein. |

## 4. In G.3 korrigierte Regelwerk-Sätze

Kleine, eindeutige Textfehler im erzeugten Regelwerk, je mit Test. Sie ändern die Anzeige aller Fassungen, weil die Bausteine ihre Daten
einfrieren und den Satz beim Anzeigen bilden.

| Baustein | Vorher | Nachher | Test |
| --- | --- | --- | --- |
| Termine | „72-h-Regel: Ein unbeantworteter Terminvorschlag des Heimteams gilt nach 72 Stunden.“ | „… gilt nach 72 Stunden, wenn er in der Spielwoche liegt.“ – wie die Matchseite und `home_rule_at` | `test_league_rule_facts_unit.py::test_home_rule_line_names_the_week_condition` |
| Veto | „… Solange sie für eine Woche fehlt, beginnt das Veto nicht.“ | „… beginnt das Veto nicht; wird sie nachgetragen, beginnt es, sobald beide Teams „Bereit zum Veto“ getippt haben.“ (Nr. 124, 127) | `test_league_rule_facts_unit.py::test_veto_block_with_preset_names_the_ready_start` |

## 5. Nach G.3 korrigiert (#2424, #2426)

Wie in Abschnitt 4: Die Sätze entstehen beim Anzeigen, darum zeigen auch schon veröffentlichte Fassungen die neue Formulierung (mit
ihren eingefrorenen Werten). Variablen sind als Wert eingefroren und bleiben in alten Fassungen, wie sie waren.

| Baustein | Vorher | Nachher | Test |
| --- | --- | --- | --- |
| Tabelle (A5) | „je gewonnene Map ein Punkt (3:2 ergibt 3 und 2 Punkte, 3:0 ergibt 3 und 0)“ bei jedem Best of | Beispiel aus dem Best of der Season bzw. Liga N; ohne eingefrorenes Best of „… – jedes Team bekommt so viele Punkte, wie es Maps gewonnen hat“ | `test_league_rule_facts_unit.py::test_map_points_example_follows_the_best_of_of_season_and_division` |
| Spielberechtigung, Veto (A6) | „nach dem Ende von Spieltag 1“, „alle Spiele dieses Spieltags“ | „nach dem Ende von Spielwoche 1“, „alle Spiele dieser Spielwoche“ | `test_league_rule_facts_unit.py::test_rule_blocks_say_matchweek_not_matchday` |
| neu: Wertung durch die Leitung (A7, A8) | – | frühe Phase und fehlende MOSS-Datei wertet die Liga-Leitung von Hand | `test_league_rule_facts_unit.py::test_lead_rulings_say_the_lead_rules_by_hand` |
| Veto = Anlage B (A11) | Liste mit nummerierten Sätzen | Regeln (Team A/B, Start, Zeit, Zeitüberschreitung, Seitenwahl, Eingriffe, Bereit-Start) und Tabelle der Schritte, je Liga N „kein Veto“; allein in einer Anlage entfällt sie ohne Vorlage | `test_league_rule_facts_unit.py::test_annex_b_*`, `test_league_rules_text_unit.py::test_an_annex_of_only_empty_blocks_is_left_out`, `test_league_veto_flow.py::test_annex_b_comes_from_the_template_on_page_pdf_and_compare` |

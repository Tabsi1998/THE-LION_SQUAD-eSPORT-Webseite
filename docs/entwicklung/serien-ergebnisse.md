# Serien: Ergebnisse eintragen – API (#1744)

Vertrag zwischen Server (P5a) und Oberfläche (P5b) zum Eintragen eines Ergebnisblatts einer externen Serie. Die
vollständige Beschreibung mit allen Feldern steht im Docstring von `backend/routes/reference_result_routes.py`, die
Zuordnung und Plausibilität in `backend/services/series_results.py`. Der Text-Parser zum Einfügen einer Liste
(„1. Name“, „Name;Platz“ …) gehört ins Web (`lib/resultPaste.js`) – der Server nimmt nur strukturierte Zeilen.

Pfad: `/api/reference-series/admin/series/{series_id}/rounds/{round_id}/results`. Rechte: Vorstand (Bereich
Redaktion) und gültige Captains dieser Saison ([Rollen](../ROLLEN.md)); ein Termin einer anderen Saison antwortet 404.

| Aufruf | Zweck | Antwort |
| --- | --- | --- |
| `GET …/results` | Ausgangsstand: Termin, Serie (Art, eigenes Team, Regeln), `access`, `version`, Blatt samt `pending_draft`, `target`, Teilnehmer zur Auswahl | 200 |
| `POST …/results/preview` | Prüfen und rechnen, **ändert nichts** | Fehler, Warnungen, Zeilen mit Punkten, unbekannte Namen, erkannte Vereinsmitglieder, Zwischenstand mit Bewegung, Finalgrenze |
| `PUT …/results` | Übernehmen mit `status` und `expected_version` | 200; 409 bei veraltetem Stand; 422 mit Fehlern; 403 beim Veröffentlichen ohne Recht |
| `POST …/results/approve` | Vorstand: Entwurf daneben (oder Blatt im Entwurf) veröffentlichen | 200; 409 ohne Entwurf oder bei veraltetem Stand |
| `POST …/results/discard` | Vorstand: Entwurf daneben verwerfen | 200; 409 ohne Entwurf oder bei veraltetem Stand |
| `GET …/results/image` | Ob ein Ergebnis-Bild gelesen werden kann und mit welcher Vorlage (#1756) | `{template, available, max_mb, formats}` |
| `POST …/results/image` | Ergebnis-Bild lesen (Body = das Bild), **speichert nichts** | Zeilen mit unsicheren Feldern, Kopf des Bilds; 409 ohne Vorlage, 413/400 bei Größe oder Format, 422 ohne Tabelle oder ohne Zeiten (Saisontabelle, Kalender) und bei mehr als 500 Zeilen, 429 Rate-Limit, 503 ohne Tesseract |

**Captains** sehen nur, wer in der Saison bekannt ist und wer neu (`rows[].match`, `is_new`) – keine Zuordnung, keinen
Alias, keine Vereinsmitgliedschaft. Diese Felder bekommt nur der Vorstand: `participants[].is_club_member` und
`.link_status` (GET), `rows[].is_club_member`, `unknown_names[].auto_assigned`, `.alias`, `.suggestions`,
`club_members` und `is_club_member` in den Ständen (Vorschau), `created_participants[].link` und `.link_status` (PUT).

## Zeilen

Eine Zeile nennt den Teilnehmer über `participant_id`, `name` (wie beim Veranstalter) oder `start_number`; dazu
`place`, `team` (Team in diesem Rennen), `points` mit `points_source` (`scheme`, `organizer`, `manual`), `marks`
(`dnf`, `dns`, `dsq`, `fastest_lap`, `pole`), `penalty_points` und optional `official_total` (offizieller Gesamtstand
nach der Runde). Team-Liga: `matches` mit `home`, `away`, Ergebnis, `maps` und `lineup` (Teilnehmer wie oben), dazu
`official_table` (Tabelle laut Veranstalter nach dem Spieltag) und `official_team_totals`.

**Rennergebnis (#1927)** – alles optional, genau die Felder der Texterkennung (#1756): je Zeile `start_number`, `grid`
(Startplatz), `time` (Rennzeit) und `gap` (Abstand, Text wie „+5.204“ oder „+1 Runde“) sowie `dnf: true` (wird zur
Marke `dnf`); je Rennen `fastest_lap: {name | participant_id | start_number, time}` und `driver_of_the_day` (Name als
Text oder wie eine Zeile). Schnellste Runde und Fahrer des Tages müssen in der Liste stehen (sonst die Fehler
`fastest_lap_not_in_list`, `driver_of_the_day_not_in_list`); die schnellste Runde setzt die Marke an ihrer Zeile (ein
Bonus zählt), eine Zeit ohne Namen gehört zur markierten Zeile, zwei Markierungen ergeben die Warnung
`fastest_lap_twice`. Gespeichert wird im Blatt `fastest_lap: {participant_id, time}` und `driver_of_the_day`
(Kennung); in den Ständen tragen die Ergebnisse je Rennen `start_number`, `grid`, `time`, `gap`, `fastest_lap_time`
und `driver_of_the_day` – nur, wo angegeben. Dazu je Zeile `penalty_seconds` (Zeitstrafe 0–3600 s, #1950) – nur zur
Anzeige in der Ergebnistabelle der Runde, es ändert keine Punkte.

**Ergebnistabelle je Runde (#1950):** `GET /api/reference-series/public/<spur>/<saison>/rounds/<nr>` (nur Rennliga,
Sichtbarkeit wie die Serienseite, `routes/reference_round_page_routes.py`, Aufbau in `services/round_page.py`) liefert
`round` (Nummer, Gesamtzahl, Kürzel, Ort, Land, Tag), `previous`/`next`, `sessions` (je Lauf `key` für `?lauf=`,
`label`, `kind`, `state`, `columns` – nur Spalten mit Werten –, `rows`, `pole`, `best_club`, `original` = Platz für
#1933), `main` (Hauptrennen), `summary` (`winner`, `pole`, `fastest_lap`, `driver_of_the_day` als Kennung) und
`club_drivers` (wer außerhalb der Tabelle mit Namen stehen darf). Eine Zeile: `key`, `place`, `status`
(`finished`/`dnf`/`dns`/`dsq`), Name nach den Regeln der Serienseite (ausgeblendet ohne Startnummer), `team`,
`team_color`, `own`, `grid` (aus dem Blatt, sonst wie gerechnet aus Qualifying bzw. umgekehrter Wertung), `gained`,
`time`, `gap`, `penalty_seconds`, `points` (aus dem Stand, nur bei zählenden Läufen), `marks`, `fastest_lap(_time)`,
`driver_of_the_day`. `GET …/statistics` zählt je Fahrer und Team Siege, Podien, Poles (je Runde einmal), schnellste
Runden, Fahrer des Tages, Ausfälle, Ø Start, Ø Ziel und gutgemachte Plätze (`services/season_statistics.py`);
`metrics` nennt nur Kennzahlen, die vorkommen. **Teamfarben:** `GET/PUT /api/reference-series/admin/series/<id>/team-colors`
(Vorstand; `{colors: {Team: "#rrggbb" | null}}`, gespeichert als `reference_series.team_colors`) und
`POST …/team-colors/suggestions` (Vorstand und Captains; der Vorschlag aus dem Ergebnis-Bild,
`team_color_suggestions`).

**Team-Liga (#1931)** – alles optional, gespeichert nur, was angegeben ist:
- `matches` hält das eigene Spiel und die übrigen Spiele des Spieltags; welches das eigene ist, sagen die eigenen Teams.
  Die Warnung `own_team_missing` kommt nur, wenn in keinem Spiel ein eigenes Team spielt; die Tabelle rechnet aus allen
  Spielen.
- Je Spiel `day`/`time` (Wiener Tag und Uhrzeit, gespeichert als `club_day`, `time`, `starts_at`; Fehler `match_time`,
  wenn es die Uhrzeit nicht gibt).
- `maps` in der Reihenfolge des Vetos: `name`, optional `map_id` (spätere Map-Bibliothek, #1616), `role` (`banned`,
  `picked`, `decider`, `played` – ohne Rolle gespielt), `by` (`own`/`opponent`, nur bei Bann und Wahl), bei gespielten
  Maps `home_score`/`away_score` und optional `lineup`. Gespielt ist eine Map mit Ergebnis: `played` (oder ohne Rolle)
  braucht beide Stände, Wahl und Decider beide oder keinen (ein Decider bei 2:0 bleibt leer), eine Aufstellung je Map
  nur mit Ergebnis – sonst Fehler `map_score_missing` bzw. `map_lineup_unplayed` mit `match`, `map` (Index) und
  `map_field`. Nichts wird still 0:0. Die Aufstellung des Spiels ist die Vereinigung mit denen der Maps (das Formular
  nimmt eine im Spiel abgewählte Person auch aus allen Maps); `maps_differ` zählt nur Maps mit Ergebnis.
- Mehrere eigene Teams am selben Spieltag: jedes Spiel eines eigenen Teams zählt (Karte, Bilanz, Form, Einsätze);
  `matchdays[].matches` listet sie, `match` bleibt das erste.
- Mit `official_table` gilt sie für Teams und Plätze: Teams aus den Spielen in anderer Schreibweise zählen für ihre
  Zeile (wörtlich, gleiche Normalform oder – eindeutig – dieselben ganzen Wörter plus Zusätze wie „e.V.“, „eSports“,
  „Gaming“ oder ein Kürzel in Klammern, in beide Richtungen; „Team A“ ist nicht „Team Alpha“, `services/team_names.py`),
  ohne passende Zeile bekommen sie keine eigene (Warnung `table_team_unknown`); offizielle Plätze werden nie neu
  gerechnet, Teams ohne Platz stehen dahinter nach Punkten.
- GET liefert dazu `series.own_team_list` (eigene Teams samt Schreibweisen) und `series.map_names` (schon verwendete
  Map-Namen der Saison, häufigste zuerst). Der Kader eines eigenen Teams sind die Teilnehmer mit diesem `default_team`
  (`participants/batch` mit `team`).
- Die Serienseite liefert `team_league.record` (Bilanz je eigenem Team), je Spieltag `others` und in `lineup.players`
  `of`, `bench_round_ids`, `in_roster` und `team`; das Mitgliederprofil je verknüpfter Referenz `appearances`
  (`{played, of, unit, team}`, `services/series_appearances.py`).
- Je eigenem Spiel `veto`: das ganze Veto in seiner Reihenfolge (`name`, `role`, `played`, `by?`, `map_id?`, `picked?`,
  bei gespielten Maps dazu `score_for`, `score_against`, `outcome`). Eine Wahl bzw. ein Decider ohne Ergebnis steht dort
  mit `played: false` – die Web-Karte zeigt sie abgeschwächt mit „nicht gespielt“. `maps` bleibt bei den gespielten
  Maps (so liest es die App), `bans` bei den gesperrten.

**Eigene Teams (#1926):** Die Serie hat `own_teams` (`[{name, aliases}]`, `team_name` = das erste). Ein Team aus der
Liste, aus `matches` oder der Tabelle zählt als eigenes, wenn Name oder Alias ohne Groß/klein, Leer- und Satzzeichen
passt; die Stände führen es unter seinem Namen.

- **Punkte:** In einer Serie mit Punkteschlüssel zählt der Schlüssel. Nur `points_source: "manual"` (Haken „Punkte
  zählen statt Schlüssel“) überschreibt ihn mit dem eingetragenen Wert. `organizer` speichert den Wert des
  Veranstalters und vergleicht ihn nur – weicht er ab, kommt die Warnung `points_differ`, gezählt wird weiter der
  Schlüssel. In einer Serie „Punkte laut Veranstalter“ zählt der eingetragene Wert.

- **Zuordnen:** Name vor Startnummer – erst der volle Name, dann ohne Clan-Tag; bei mehreren Treffern entscheidet die
  Startnummer. Unbekannte Namen heißen in der Vorschau `neu:<Schlüssel>` und werden beim Übernehmen als offene
  Teilnehmer angelegt (Dialog „Unbekannte Namen“); ein bestätigter Alias ordnet sie sofort zu. Verwirft der Vorstand
  einen Entwurf daneben, gehen die Teilnehmer wieder, die nur dieser Entwurf angelegt hat – solange sie offen sind
  (keine Zuordnung, kein Alias) und in keinem anderen Blatt der Saison stehen. Beim Freigeben gilt dieselbe Regel für
  Teilnehmer, die nur ein ersetzter Entwurf angelegt hat. Gelöscht wird unter der Sperre der Saison (siehe unten);
  „offen und ohne Alias“ steht im Löschfilter selbst, weil die Zuordnung (#1743) ohne diese Sperre läuft.
- **Fehler** (halten das Übernehmen auf): Teilnehmer doppelt, unbekannte Kennung oder Startnummer, Name fehlt,
  unbrauchbar oder mehrdeutig, leeres Blatt, abgesagter oder archivierter Termin, schnellste Runde oder Fahrer des
  Tages nicht in der Liste.
- **Warnungen:** Platz doppelt, Lücke oder fehlend, Nichtstart mit Platz, Punkte passen nicht zum Schlüssel oder
  fehlen bei „laut Veranstalter“, Abweichung zum offiziellen Wert, Maps passen nicht zum Ergebnis, kein eigenes Team
  im Spiel, Team doppelt in der Tabelle, schnellste Runde mehrfach markiert, Termin in der Zukunft oder ohne Wertung.

## Runde mit Läufen (#1930)

Logik ohne Datenbank in `backend/services/race_weekend.py`, das Einfügen in `race_weekend_paste.py`, die Regel „ab
Runde X“ allgemein in `round_phases.py` (wiederverwendbar, etwa für Regeländerungen je Runde, #1960).

- **Termin:** `session` (Lauf, freier Text bis 30 Zeichen, leer = Rennen). Die Art (`session_kind`: `qualifying`,
  `sprint`, `race`) kommt aus dem Namen. Termine mit gleichem Kürzel (ohne Leerraum, Groß/klein egal) sind eine Runde –
  aber nur, wenn ein Termin einen Lauf hat oder die Serie einen Ablauf je Runde (`race_weekend.by_code`); sonst ist jeder
  Termin seine eigene Runde (alte Saisons mit zweimal „R1“ bleiben, wie sie sind; im Web `groupWeekends`).
  Der Kalender liefert je Termin `weekend` (Nummer der Runde in Kalender-Reihenfolge, abgesagte zählen mit, archivierte
  nicht), `session` und `session_kind` – Verwaltung, Serienseite und `/public/running` (`next.session`,
  `next.sessions`). „Shootout“ (Sprint-Qualifying) ist ein Qualifying ohne Pole (`race_weekend.is_main_qualifying`).
- **Wertung je Termin:** `counts` folgt der Vorgabe seines Laufs (`race_weekend.planned_config`, ein Qualifying ohne
  Punkte zählt nicht), solange `counts_manual` `false` ist – neue Termine ohne `counts` und die eingefügte Liste.
  `recompute_standings` gleicht sie nach jeder Änderung des Ablaufs an (`race_weekend.counts_updates`, erhöht
  `calendar_version`). `counts` am Termin (POST oder PATCH) setzt `counts_manual: true`, `PATCH {counts: null}` gibt die
  Wertung an die Vorgabe zurück. Termine ohne das Feld (vor #1930) bleiben unverändert.
- **Ablauf je Runde:** Serie `weekend = {formats: [{from_round, sessions: [{label, offset, counts, points, dnf,
  fastest_lap, grid}]}]}`. `points`: `series` (Schema der Saison = wie das Rennen), `none` oder Liste je Platz – ein
  Qualifying mit Liste zählt ohne Angabe von `counts`; `dnf`: `series`, `place` (Punkte nach Platz trotz DNF) oder `none`
  (0); `fastest_lap`: `null` (wie die Saison) oder Bonuspunkte; `grid`: `manual`, `qualifying`,
  `reverse_standings_before_round` (Fahrerwertung vor dem ersten Lauf der Runde; der alte Wert `reverse_standings` ist
  ein Alias dafür) oder `reverse_standings_after_previous_session` (Fahrerwertung nach dem Lauf davor, also samt Sprint
  derselben Runde). Eine Änderung rechnet neu und steht im Protokoll (`reference_series.weekend_change`). Die
  eingefügte Terminliste legt je Zeile ohne Lauf alle Läufe des gültigen Abschnitts an (`offset` in Minuten ab der
  Uhrzeit der Zeile, ohne Uhrzeit nur ganze Tage, ein negativer Versatz bleibt am Tag); `R1S`, `R1 Sprint`, `R1 Q` …
  nur diesen Lauf. Ein Lauf-Wort zählt nur vor einem Trenner, Tab, entferntem Datum (`race_weekend.GAP`) oder dem
  Zeilenende (`R1 Race of Champions` ist ein Titel). Eine Zeile ohne Kürzel mit mehreren Läufen bekommt ein freies
  (`R{n}`, sonst `Runde {n}`, `R{n}a` …). Doppelte Läufe einer Runde sind ein Fehler der Zeile. Die Antwort der
  Vorschau hat je Zeile `sessions` und `count` (Termine gesamt).
- **Rechnen** (`race_weekend.standings` statt `compute_standings`, gleiche Ausgabe): Punkte je Lauf über `round_rules`
  in `compute_standings`. Mit `units` (Termin → Runde, nur bei `by_code`) zählen Streichergebnisse, „beste N“,
  Aktivitätspunkte und `rounds_played` je Runde: gestrichen wird eine ganze Runde (Summe ihrer Läufe), `counted` und
  `dropped` nennen weiter Termine. Ein leerer Startplatz kommt aus dem Hauptqualifying derselben Runde (der Sprint aus
  dem Shootout, wenn es einen gibt) bzw. aus der umgekehrten Fahrerwertung nach `grid` (wer dort fehlt, bekommt
  keinen). Die Pole (`race_weekend.pole_holder`: der erste gültige Platz des Hauptqualifyings ohne DSQ/DNS – eine
  Marke `pole` auf einer anderen Zeile zählt nicht) zählt am ersten Rennen der Runde, das seinen Startplatz aus dem
  Hauptqualifying nimmt (sonst am Sprint) – nur, wenn das Qualifying nicht selbst zählt. In jedem Lauf mit Startplatz
  aus dem Hauptqualifying fällt eine Pole-Marke auf einer anderen Zeile weg, ohne gültigen Platz im Qualifying jede.
  Gespeichert wird davon nichts im Blatt; es
  steht nur im gerechneten Stand. Ein Rennen ohne Qualifying behält seine Marke von Hand (Bestand #1927).
- **Blatt eines Qualifyings:** `round.session_kind` im Ausgangsstand; beim Prüfen setzt `race_weekend.mark_pole` die
  Marke `pole` nach derselben Regel, eine Marke auf einer anderen Zeile fällt weg – mit der Warnung `pole_moved` an
  dieser Zeile („Pole hat Platz 1 – Marke entfernt“, ohne gültigen Platz `race_weekend.NO_POLE`: „Kein gültiger
  Platz im Qualifying – Pole-Marke entfernt“); die Warnung `round_not_counted` entfällt. Der Ausgangsstand
  liefert die Regeln des Laufs (`series.rules` mit seinem Punkteschema).
- **Blatt eines Rennens:** Nimmt es Startplatz und Pole aus einem veröffentlichten Hauptqualifying derselben Runde
  (`race_weekend.quali_pole`; `(None, None)`, wenn darin kein Platz gültig ist), fällt beim Prüfen eine Pole-Marke
  auf einem anderen Fahrer weg, ohne gültigen Platz jede (`clear_race_pole`,
  Warnung `pole_moved`: „Pole hat Platz 1 im Qualifying – Marke entfernt“).
- **Serienseite (Rennliga):** `progress` zählt Runden (gewertet, wenn alle zählenden Läufe gewertet sind),
  `series.weekend` für „Punkte je Lauf“, `racing.qualifying` = je veröffentlichtem Qualifying fürs Rennen die Plätze der
  Fahrer der Fahrerwertung (nur Kennungen) und `pole` (`pole_holder`) für Poles und Quali-Duell; „Ø Start“ nur in
  Saisons mit Läufen. Die Tabellen je Lauf („Gesamt · Rennen · Sprint ·
  Quali“) zählt das Web aus den Punkten je Lauf im gespeicherten Stand (`lib/raceWeekend.js`, `sessionTables`). Zwei
  Ligen als gemeinsame Fälle für Server und Web: `frontend/src/lib/raceWeekendLeagues.json`.

## Turniertage (#1961)

Mehrere Runden an einem Termin (etwa TFT-Lobbys R1–R5), gerechnet in `services/tournament_days.py`:

- **Regeln:** `day_rounds: {count, points_by_place}` (Spalten R1…Rn als Vorgabe, `0` = aus; Rundenpunkte je Platz in
  der Lobby, Vorgabe 8…1), `custom_bonuses: [{key, label, points}]` (Name frei, Kennung aus dem Namen, bleibt beim
  Umbenennen) und `tiebreak_top_n` für den Vorrang `top_n` („mehr Plätze unter den besten N“, Plätze = Tagesplätze).
  Saison-Feld `hide_name_tags`: die Serienseite zeigt „Name#TLS“ als „Name“.
- **Zeile:** `day_rounds: [{place?, points?, lobby?} | null]` – Punkte gelten wie gelesen (Bots verschieben sie), sonst
  aus dem Platz samt Bots; `null` = nicht gespielt (0, etwa nach Marke `left` „Ausgestiegen“). `day_points` = GES P des
  Veranstalters (gilt vor der Summe, Warnung `day_points_differ`). `partner: {participant_id | name}` (Double Up, muss
  in der Liste stehen; Fehler `partner_not_in_list`, `partner_self`, `partner_conflict`; die Gegenseite bekommt ihn
  mit). `bonus_keys` (unbekannte fallen weg: `bonus_unknown`). Am Blatt `double_up: true` (Warnungen
  `partner_missing`, `partner_place_differs`).
- **Platz:** Ohne Platz bestimmt die Tagessumme ihn – Wettbewerbsrang (4, 4, 6), ein Paar ist eine Einheit (1, 1, 2, 2).
  Zweimal „4.“ mit gleicher Tagessumme oder mit „6.“ danach und Paare im Double Up geben keine Warnung `place_twice`,
  der übersprungene Platz keine `place_gap`. Die Saisonpunkte kommen wie bisher aus dem Platz (oder laut Veranstalter).
- **Stand:** Ergebnisse tragen `day_rounds` (mit den Punkten, die zählen), `day_points`, `partner_id`, `bonus`,
  `bonus_keys`; die Zeile `bonus_points`. Sonderboni zählen wie Aktivitätspunkte getrennt und nie gestrichen.
- **Vorschau:** je Zeile `day_rounds`, `day_points` (Tagessumme), `bonus`, `partner_id`, `bonus_keys`.
- **Serienseite:** `rules` mit `day_rounds`, `custom_bonuses`, `tiebreak_top_n`; Ergebnisse mit `day_rounds`,
  `day_points`, `bonus`, `bonus_keys` und `partner` (Person wie in der Tabelle, ohne Kennung).
- **Einfügen** (`lib/resultPaste.js`): mit Kopfzeile Spalten „R 1“ … „R n“, „GES P“ und je Sonderbonus seine Spalte.
- **Spielkennung mit Tag:** `series_identity.without_game_tag` – „Name#TAG“ (3–5 Buchstaben oder Ziffern direkt am
  Namen) zählt wie ein Clan-Tag: ohne Tag gleicher Name = dieselbe Person (Treffer `name_untagged`). Eine Startnummer
  mit Leerzeichen davor („Max Muster #123“) bleibt Teil des Namens. Mit `hide_name_tags` zeigen Serienseite, Rundenseite
  und Statistik (#1950) die Namen ohne Tag; Team-Namen (`team_names`, #1931) nutzen nur `normalize_name` und bleiben
  unberührt.

## Version, Entwurf daneben und Protokoll

- **Nacheinander je Saison:** Ergebnis speichern, freigeben, verwerfen und zurücknehmen sowie alle Kalender-Änderungen
  (anlegen, ändern, verschieben, absagen, wieder ansetzen, archivieren, zurückholen, ordnen, einfügen) laufen unter der
  Sperre `series:<id>` (`services/mutation_lock.py`, `reference_series.series_write`, Wartezeit wie bei Turnieren).
  Darin: Versionsprüfung, Schreiben, Termin-Status, Teilnehmer aufräumen und einmal Neurechnen. Ist die Sperre zu
  lange besetzt: 409 „In dieser Saison wird gerade schon etwas gespeichert …“. Ebenso unter der Sperre: Teilnehmer
  anlegen, bearbeiten und zuordnen (#1743), Regeln der Saison ändern und die Saison archivieren oder zurückholen -
  alles, was Stände rechnet oder die Saison schließt, läuft also nacheinander.
- **Zuordnung in anderen Saisons:** Zieht ein Alias andere Saisons mit, ändert die Zuordnung dort erst nach Freigabe
  der eigenen Sperre etwas – je Saison unter deren Sperre, Teilnehmer folgen und Neurechnen zusammen
  (`reference_series.follow_aliases_elsewhere`), nie zwei Sperren ineinander. Ist eine Saison gerade besetzt, bleibt die
  eigene Zuordnung gültig, die andere Saison bleibt ganz unverändert und merkt sich den Nachtrag (`alias_followups`);
  der nächste Vorgang unter ihrer Sperre zieht ihn nach. Die Antwort nennt das (`other_series: {updated, pending}`,
  `notice`), das Protokoll ebenso (`also_assigned_in`, `pending_series`).
- **Teilnehmer nachträglich bearbeiten (#1929, nur Vorstand):** `PATCH …/participants/{id}` (Name, Startnummer, Team)
  schreibt `reference_series.participant_update` mit altem und neuem Wert und rechnet neu; ein Name, den es in der
  Saison schon gibt, bekommt 409 (zusammenführen). `POST …/participants/bulk-assign` (`participant_ids`, `link` „guest“
  oder „external“) ordnet alle unter einer Sperre zu und rechnet einmal neu; andere Saisons ziehen danach je einmal
  nach (`reference_series.follow_aliases_elsewhere`). `POST …/participants/{id}/merge` (`duplicate_id`) schreibt die
  Kennung in Blättern, Entwürfen daneben und offiziellen Werten um (je Blatt eine Revision mit Grund `merge` und
  Version +1) und rechnet neu – nennt ein Inhalt beide, 409 und nichts geändert. Die Aliase der anderen Schreibweise
  ziehen zum behaltenen um (`extra_alias_ids`) und folgen seiner Zuordnung, auch in anderen Saisons.
  `DELETE …/participants/{id}` nur ohne Ergebnis (sonst 409). Protokoll: `.participant_bulk_assign`,
  `.participant_merge`, `.participant_delete`.
- **Alle Aliase eines Teilnehmers:** der seiner Zuordnung (`alias_id`), der seines Namens und weitere aus
  Zusammenführen oder einem früheren Namen (`extra_alias_ids`). Zuordnen gleicht alle an: „Extern“ nimmt alle zurück,
  Mitglied und Gast lassen alle auf dieselbe Person zeigen – je Saison unter ihrer Sperre.
- `expected_version` ist Pflicht (0 ohne Blatt); ein veralteter Stand der Seite bekommt 409. Zwei gleichzeitige
  Übernahmen auf denselben Stand: eine gewinnt, die andere bekommt 409.
- Ist das Blatt veröffentlicht und die Person darf nicht veröffentlichen (`target: "pending_draft"`), landet die
  Änderung als `pending_draft` neben dem Blatt; das veröffentlichte bleibt sichtbar, bis der Vorstand freigibt.
- Jede Änderung legt den alten Stand in `reference_round_result_revisions` ab und steht im Adminprotokoll
  (`reference_result.save`, `.pending_draft`, `.approve`, `.discard`). Veröffentlichen oder Zurücknehmen rechnet die
  Stände der Serie neu und setzt den Termin auf „gewertet“ bzw. zurück.

## Ergebnis-Bild auslesen (#1756)

Ein Screenshot des Veranstalters wird **auf dem eigenen Server** gelesen (Tesseract im Backend-Image, kein externer
Dienst) und landet als Zeilen im Blatt – gespeichert wird beim Lesen nichts, auch das Bild nicht. Route:
`backend/routes/reference_result_image_routes.py`, Lesen: `services/result_image_ocr.py`, Werte aus Text:
`services/result_image_values.py`, Entscheiden und Abgleich: `services/result_image_match.py`, Vorlagen: `services/result_image_templates.py`, Web: `lib/resultImage.js` und
`pages/admin/referenceSeries/ResultImageImport.jsx`.

- **Vorlage je Veranstalter-Layout:** Spalten (Überschriften, Ausrichtung, ungefähre Lage) und Kopf des Bilds sind
  einmal festgelegt. Der Vorstand wählt sie je Spur und – abweichend – je Saison (`result_image_template`); ohne Wahl
  gilt die Standard-Vorlage der Art („Rennliga-Ergebnis (dunkel)“ für Rennligen), `none` schaltet ab.
- **Lesen:** hellster Farbkanal (farbige Schrift bleibt kräftig), bei dunklem Grund umgekehrt, Trennlinien und
  farbige Kästen entfernt, auf etwa 40 Pixel Schrifthöhe vergrößert (die Höhe wird vorab mit einer groben Lesung
  geschätzt). Einmal die ganze Seite, dann jede Spalte als Streifen – Zahlen mit Zeichen-Whitelist.
- **Spalten aus den Daten:** `result_image_ocr.plan_columns` sucht die Spalten des Bilds an den gelesenen Zeilen und
  ordnet sie den Spalten der Vorlage nach Inhalt (Platz, Zahl, Text, Zeit, Abstand) und Reihenfolge zu; Überschriften
  geben nur einen Bonus. Fehlt eine Spalte im Bild (etwa Grid im Qualifying, Punkte), bleibt sie leer. Erst wenn das
  nicht aufgeht, gelten `align`/`at` der Vorlage.
- **Werte:** OUT/DNF/DNS/DSQ statt Platz oder Zeit sind ein Ausfall; Platzhalter wie `--:--.---` heißen „keine Zeit“.
  Überrundete („+1 Runde“) stehen in Zeit oder Abstand.
- **Unsicher (gelb)** ist eine Zelle, wenn die beiden Lesungen sich widersprechen oder die Sicherheit unter der Schwelle
  der Vorlage liegt – außer eine Gegenprobe bestätigt sie: Plätze und Zeit des Ersten nach der Mehrheit der Zeilen
  (ein verlesener erster Platz zieht die Spalte nicht mit), Zeit = Zeit des Ersten + Abstand, Grid einmalig,
  **Startnummer als Anker** (Nummer und Name zeigen auf denselben Teilnehmer). Namen und Teams sind nur sicher, wenn
  beide Lesungen Zeichen für Zeichen gleich und je für sich sicher sind - oder der Abgleich sie sicher einem
  Teilnehmer bzw. bekannten Team zuordnet und beide Lesungen dorthin zeigen (sonst gelb, `read` nennt beide).
  Abgeglichen wird unscharf mit den Teilnehmern der Saison (für den Vorstand auch über deren Aliase), Teams mit den
  Standard-Teams; jeder Teilnehmer höchstens einmal - die Zeile, die ihn an eine andere verliert, ist gelb. Leere Zellen
  in sonst gefüllten Spalten sind gelb, ein nie gelesener Platz ebenso.
- **Kopf:** `track` (oberste Zeile ohne Beschriftung), `session {name, kind}` (Rennen, Sprint, Qualifying - nur ein
  Hinweis, bis es Läufe je Termin gibt, #1930), `pole` und `fastest_lap {name, time}`, `driver_of_the_day`; der Wert
  darf hinter oder unter der Beschriftung stehen. Passt die Strecke zu einem anderen Termin der Saison, nennt die
  Warnung `other_track` ihn (`suggested_round`).
- **Antwort:** `rows` mit `place`, `dnf`, `marks`, `start_number`, `name`, `participant_id`, `team`, `grid`, `time`,
  `gap`, `points`, `color` (Schriftfarbe von Startnummer oder Team), `uncertain` (Felder) und `read` (was im Bild
  stand, wenn es abweicht); dazu der Kopf, `team_colors {Team: "#rrggbb"}` (Vorschlag für Teamfarben, #1950 - das
  Blatt schickt ihn nach dem Lesen an `…/team-colors/suggestions`, übernommen wird er in der Verwaltung),
  `uncertain_rows` und `warnings`.
- **Im Blatt:** die Zeilen ersetzen die Liste, die Vorschau prüft gleich. Startnummer, Startplatz, Zeit und Abstand
  gehen in die Zeile (#1927; „Mehr“ steht offen, wenn eines davon gelb ist), die Pole wird Marke; schnellste Runde
  (Fahrer, Zeit) und Fahrer des Tages füllen die Felder des Rennens (`imageFormFields`, gelbe davon in `raceOcr`).
  Gelbe Felder verlieren die Markierung, wenn jemand sie ändert oder die Zeile bzw. das Rennen mit „Passt so“
  bestätigt; übernommen wird erst, wenn nichts mehr gelb ist (`openImageItems`). Welche Felder gelb werden können,
  steht in `SHOWN_FIELDS` und `RACE_FIELDS` (`lib/resultImage.js`).
- **Sicherheit:** Rechte wie beim Eintragen; Größe am Kopf der Anfrage, Pixel am Kopf der Bilddatei; jeder
  Dekodierfehler (Pillow wirft auch `SyntaxError`) ist 400 mit fester Meldung; das Bild kommt als Body (keine
  Zwischendatei) und geht über stdin an Tesseract (ohne Shell, leere Umgebung, Zeitlimit je Aufruf und Zeitbudget je
  Bild - danach bleibt der Rest ungeprüft und gelb, `Reading.unchecked`); Rate-Limit je Konto, je Konto ein Bild zur
  Zeit, dekodiert wird erst mit freiem Platz (`_gate`); Meldungen sind feste Texte. Einstellungen in [Betrieb](../BETRIEB.md). Für das Original am Termin (#1933)
  liefert `result_image_ocr.encode_original(opened)` das neu kodierte Bild (gedreht, ohne EXIF) - gespeichert wird es
  erst dort.
- **Tests:** synthetische Screenshots mit erfundenen Namen (`backend/tests/result_image_fixture.py`). Ohne Tesseract
  werden die Lese-Tests übersprungen; die CI installiert es und setzt `REQUIRE_TESSERACT=1`.

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
und `driver_of_the_day` – nur, wo angegeben.

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
`backend/routes/reference_result_image_routes.py`, Lesen: `services/result_image_ocr.py`, Werte und Abgleich:
`services/result_image_match.py`, Vorlagen: `services/result_image_templates.py`, Web: `lib/resultImage.js` und
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
  Teilnehmer zuordnet. Abgeglichen wird unscharf mit den Teilnehmern der Saison (für den Vorstand auch über deren
  Aliase), Teams mit den Standard-Teams. Leere Zellen in sonst gefüllten Spalten sind gelb, ein nie gelesener Platz
  ebenso.
- **Kopf:** `track` (oberste Zeile ohne Beschriftung), `session {name, kind}` (Rennen, Sprint, Qualifying - nur ein
  Hinweis, bis es Läufe je Termin gibt, #1930), `pole` und `fastest_lap {name, time}`, `driver_of_the_day`; der Wert
  darf hinter oder unter der Beschriftung stehen. Passt die Strecke zu einem anderen Termin der Saison, nennt die
  Warnung `other_track` ihn (`suggested_round`).
- **Antwort:** `rows` mit `place`, `dnf`, `marks`, `start_number`, `name`, `participant_id`, `team`, `grid`, `time`,
  `gap`, `points`, `color` (Schriftfarbe von Startnummer oder Team), `uncertain` (Felder) und `read` (was im Bild
  stand, wenn es abweicht); dazu der Kopf, `team_colors {Team: "#rrggbb"}` (Vorschlag für Teamfarben, #1950 - nur in
  der Antwort), `uncertain_rows` und `warnings`. Felder, die das Blatt (noch) nicht zeigt (`grid`, `time`, `gap`, siehe
  `PENDING_FIELDS` in `lib/resultImage.js`), gehen in die Zeile, werden aber nicht gelb angezeigt.
- **Im Blatt:** die Zeilen ersetzen die Liste, die Vorschau prüft gleich. Gelbe Felder verlieren die Markierung, wenn
  jemand sie ändert oder die Zeile mit „Passt so“ bestätigt; übernommen wird erst ohne gelbe Zeilen.
- **Sicherheit:** Rechte wie beim Eintragen; Größe am Kopf der Anfrage, Pixel am Kopf der Bilddatei; das Bild kommt als
  Body (keine Zwischendatei) und geht über stdin an Tesseract (ohne Shell, leere Umgebung, Zeitlimit); Rate-Limit je
  Konto; Meldungen sind feste Texte. Einstellungen in [Betrieb](../BETRIEB.md). Für das Original am Termin (#1933)
  liefert `result_image_ocr.encode_original(opened)` das neu kodierte Bild (gedreht, ohne EXIF) - gespeichert wird es
  erst dort.
- **Tests:** synthetische Screenshots mit erfundenen Namen (`backend/tests/result_image_fixture.py`). Ohne Tesseract
  werden die Lese-Tests übersprungen; die CI installiert es und setzt `REQUIRE_TESSERACT=1`.

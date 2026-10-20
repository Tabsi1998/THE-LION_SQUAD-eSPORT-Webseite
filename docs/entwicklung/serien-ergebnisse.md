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
  unbrauchbar oder mehrdeutig, leeres Blatt, abgesagter oder archivierter Termin.
- **Warnungen:** Platz doppelt, Lücke oder fehlend, Nichtstart mit Platz, Punkte passen nicht zum Schlüssel oder
  fehlen bei „laut Veranstalter“, Abweichung zum offiziellen Wert, Maps passen nicht zum Ergebnis, eigenes Team fehlt
  im Spiel, Team doppelt in der Tabelle, Termin in der Zukunft oder ohne Wertung.

## Version, Entwurf daneben und Protokoll

- **Nacheinander je Saison:** Ergebnis speichern, freigeben, verwerfen und zurücknehmen sowie alle Kalender-Änderungen
  (anlegen, ändern, verschieben, absagen, wieder ansetzen, archivieren, zurückholen, ordnen, einfügen) laufen unter der
  Sperre `series:<id>` (`services/mutation_lock.py`, `reference_series.series_write`, Wartezeit wie bei Turnieren).
  Darin: Versionsprüfung, Schreiben, Termin-Status, Teilnehmer aufräumen und einmal Neurechnen. Ist die Sperre zu
  lange besetzt: 409 „In dieser Saison wird gerade schon etwas gespeichert …“. Ebenso unter der Sperre: Teilnehmer
  anlegen, bearbeiten und zuordnen (#1743) und Regeln der Saison ändern - alles, was Stände rechnet, rechnet also
  nacheinander.
- **Zuordnung in anderen Saisons:** Zieht ein Alias andere Saisons mit, ändert die Zuordnung dort erst nach Freigabe
  der eigenen Sperre etwas – je Saison unter deren Sperre, Teilnehmer folgen und Neurechnen zusammen
  (`reference_series.follow_alias_elsewhere`), nie zwei Sperren ineinander. Ist eine Saison gerade besetzt, bleibt die
  eigene Zuordnung gültig, die andere Saison bleibt ganz unverändert und merkt sich den Nachtrag (`alias_followups`);
  der nächste Vorgang unter ihrer Sperre zieht ihn nach. Die Antwort nennt das (`other_series: {updated, pending}`,
  `notice`), das Protokoll ebenso (`also_assigned_in`, `pending_series`).
- `expected_version` ist Pflicht (0 ohne Blatt); ein veralteter Stand der Seite bekommt 409. Zwei gleichzeitige
  Übernahmen auf denselben Stand: eine gewinnt, die andere bekommt 409.
- Ist das Blatt veröffentlicht und die Person darf nicht veröffentlichen (`target: "pending_draft"`), landet die
  Änderung als `pending_draft` neben dem Blatt; das veröffentlichte bleibt sichtbar, bis der Vorstand freigibt.
- Jede Änderung legt den alten Stand in `reference_round_result_revisions` ab und steht im Adminprotokoll
  (`reference_result.save`, `.pending_draft`, `.approve`, `.discard`). Veröffentlichen oder Zurücknehmen rechnet die
  Stände der Serie neu und setzt den Termin auf „gewertet“ bzw. zurück.

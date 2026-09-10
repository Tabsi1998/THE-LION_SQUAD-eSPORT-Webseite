# Umbauplan: Turniere, Übersichtlichkeit und die offenen Wünsche

Stand: 9. September 2026.

Dieser Plan führt das in [RESTPLAN.md](RESTPLAN.md) als **R5** angekündigte Turnierpaket
aus und nimmt die später dazugekommenen Themen auf (Spielwochen, PDF, Live-Aktualisierung,
Galerie, App). Fachliche Regeln und Abnahmematrix der Wettbewerbslogik stehen weiterhin
in [COMPETITION_ENGINE.md](COMPETITION_ENGINE.md); dieser Plan sagt nur, **was in welcher
Reihenfolge passiert und wo wir gerade stehen**.

## Wie du das liest

Drei Zustände, die nicht dasselbe sind:

| Zustand | Bedeutung |
| --- | --- |
| **umgesetzt** | Im Quellstand, in CI grün gemergt. Läuft damit noch nicht auf deinem Server. |
| **auf dem Server** | Von dir ausgerollt. |
| **abgenommen** | Von dir im Betrieb geprüft und für gut befunden. |

Ein grüner Block unten heißt **umgesetzt**. Was du selbst prüfen musst, steht in
[Was von dir kommen muss](#was-von-dir-kommen-muss).

## Stand der Blöcke

| Block | Thema | Stand | PRs |
| --- | --- | --- | --- |
| 0 | Sicherheitsnetz vor dem Umbau | umgesetzt | #164 |
| 1 | Doppelten Match-Router entfernt, Plan/Apply entschieden | umgesetzt | #165 |
| 2 | Gameserver zeigen ihre Daten | umgesetzt | #166 |
| 3 | Graph-System: Ergebnislücken, Schweizer System, Gruppen | umgesetzt | #167, #168 |
| 4 | Ein Ergebnisweg statt drei, kein stiller Speicherwechsel | umgesetzt | #169, #172, #173 |
| 5 | Migrations-Trockenlauf (nur lesend) | umgesetzt, **Migration entfiel** | #170, #171 |
| 6 | Ablauf-Tests: echte Anwendung gegen Datenbank im Speicher | umgesetzt | #174 |
| 7 | Ein Turnierbaum statt zwei, Spieltage als Spieltage | umgesetzt | #176 |
| 8 | Klassischer Schreibweg stillgelegt | umgesetzt | #177 |
| 9 | **Übersichtlichkeit** (läuft) | teilweise | #178, #179, #181, #182 |
| 10 | Spielwochen und Terminfindung | offen | — |
| 11 | PDF-Ausgabe | offen | — |
| 12 | Galerie und Medien: Tempo, Videos überall | offen | — |
| 13 | Entflechtung und Tempo | offen | — |
| 14 | LionsAPP in den Store | offen | — |
| 15 | Abschluss | offen | — |

### Warum Block 5 die Migration erledigt hat, ohne zu migrieren

Der Trockenlauf auf deinem Server hat gezählt: **`matches`: 0 Dokumente, `matches_v2`: 108**.
Der klassische Speicher war leer. Damit gab es nichts zu migrieren, und Block 8 wurde
billig — es musste nur ein Schreibweg stillgelegt werden, der ohnehin nichts mehr schrieb.
Das Werkzeug bleibt: `bash scripts/tournament-dryrun.sh <datei.json>`, beschrieben in
[TOURNAMENT_MIGRATION_DRYRUN.md](TOURNAMENT_MIGRATION_DRYRUN.md).

Eine Sache ist dabei **nicht** systemunabhängig und deshalb ausdrücklich festgehalten:
**Platzierungen**. Sie speisen Preise, Profilhistorie, Abzeichen und Saisonpunkte. Der
Trockenlauf meldet sie als Hinweis, statt sie blind umzuschreiben.

## Block 9 — Übersichtlichkeit (läuft)

Dein Befund: „das Admin-Config- und Bearbeitungsmenü ist einfach zu unübersichtlich".
Ziel ist eine logische, wartbare Struktur, die auf **PC-Browser, Handy-Browser und in der
App** funktioniert.

| Schritt | Was | Stand |
| --- | --- | --- |
| 9.1 | Turnier anlegen: erst das Nötige, dann der Rest | umgesetzt (#178) |
| 9.2 | Dashboard: erst was ansteht, dann die Zahlen | offen zum Mergen (#179) |
| 9.3 | Formatwechsel: aus einer Liga wurde eine Einzelausscheidung | offen zum Mergen (#181) |
| 9.4 | Turnierseite: dreizehn Knöpfe im Kopf werden vier | offen zum Mergen (#182) |
| 9.5 | Turnier bearbeiten aufteilen — `AdminTournamentEditPage.jsx`, **2175 Zeilen** | offen |
| 9.6 | Adminmenü — **34 Einträge in 6 Gruppen** | offen |
| 9.7 | Einstellungen — **13 Reiter, davon 5 rund um Mail** | offen |
| 9.8 | Handy-Browser gleichwertig zum PC | angefangen |
| 9.9 | `backend/routes/tournament_routes.py` aufteilen — **3623 Zeilen** | offen |

### Was hinter 9.3 steckte

Dein Befund „die Bearbeitung des Brackets, dann z. B. auf Einzelausscheidung umstellen
geht nicht sauber" war ein echter Fehler, kein Bedienproblem. Das Bearbeiten-Formular
setzte hinter dem sichtbaren Feld „Turnierstruktur" einen zweiten, unsichtbaren Wert —
mit einer Zuordnung, die **drei von zwölf** Formaten kannte. Die übrigen neun landeten
auf `single_elimination`. Wer eine Liga bearbeitete und „Speichern & Struktur anwenden"
drückte, baute einen Einzelausscheidungs-Baum.

**Praktische Folge für dich:** falls du zuletzt Liga-, Gruppen- oder FFA-Turniere über
„Struktur anwenden" neu gebaut hast, können deren Turnierbäume falsch angelegt sein. Bei
laufenden Turnieren erst nachsehen — das Anwenden ersetzt den Baum.

### Was 9.8 heißt

Die Turnierseite ist am Telefon (390 px) nachgemessen: die Reiter, über die die Arbeit
läuft, begannen bei **1290 px**. Grund war nicht der Kopf (301 px), sondern die
Speziallink-Tafel mit **696 px** dazwischen. Eingeklappt sind es 78 px, die Reiter
beginnen bei 673 px, die Seite ist 1688 statt 2305 px hoch. Die übrigen Adminseiten sind
noch nicht vermessen.

## Block 10 — Spielwochen und Terminfindung

Nach dem Vorbild von desbl.de. Deine Regeln, damit sie nicht verlorengehen:

- Ein **Spieltag ist eine Woche**. Startet die Liga am Dienstag, läuft der Spieltag eine
  Woche.
- **Beide Seiten schlagen Zeiten vor.** Was die Gegenseite annimmt, gilt.
- Schlägt **nur eine Seite** vor, gilt der Vorschlag der **Heimseite**. Deshalb soll jeder
  im Verlauf einmal Heimrecht haben.
- Wählt **niemand**, greift eine **einstellbare Standardzeit** (z. B. Sonntag 20:00).
- Spieltage werden **mit Pfeilen durchgeblättert**, mit Wochendatum von–bis — nicht mehr
  alle untereinander.

Der letzte Punkt betrifft auch die bereits gebaute Spieltagsansicht aus Block 7: die
Erzeugung läuft sauber, die Darstellung stapelt aber noch.

## Block 11 — PDF-Ausgabe

Deine Punkte:

- **Nichts überlappt.** Weder Striche noch Texte.
- **Urkunden nicht im schwarzen Stil.** Stattdessen das **Spiel-Banner leicht gezoomt als
  helles Wasserzeichen** über die ganze Seite, der Urkundeninhalt sauber darübergelegt.
- **Druckbar.** Viel Schwarz und satte Farbflächen sind zum Ausdrucken schlecht.
- **Stations-PDFs** gehören dazu.

Betrifft `backend/pdf_service.py` (1030 Zeilen, reportlab + Pillow).

## Block 12 — Galerie und Medien

- Bilder und Videos **laden schnell**, keine langen Wartezeiten.
- Videos laufen sauber auf **PC-Web, Handy-Web und in der App**.

Heute werden nur Originale bis 4096 px vorgehalten; es fehlen kleinere Varianten und
Vorschaubilder. Das ist die Hauptursache der Wartezeiten.

## Block 13 — Entflechtung und Tempo

Die großen Dateien, die Änderungen langsam und riskant machen:

| Datei | Zeilen |
| --- | --- |
| `backend/routes/tournament_routes.py` | 3623 |
| `frontend/src/pages/admin/AdminTournamentEditPage.jsx` | 2175 |
| `frontend/src/pages/admin/AdminSettingsPage.jsx` | 2101 |
| `frontend/src/pages/user/ProfilePage.jsx` | 1803 |
| `backend/routes/news_routes.py` | 1453 |

## Block 14 — LionsAPP in den Store

- Chat: **Tastatur, Emojis, GIFs** und Einfügen müssen sauber funktionieren.
- **Animationen** und **Achievements** in der App.
- Umstellung der App vom Abfragen (Polling) auf den bestehenden **SSE-Änderungsstrom**.

## Block 15 — Abschluss

Alle CI-Prüfungen grün, automatischer App-Build, README auf Stand.

## Querschnitt: Live-Aktualisierung überall

Läuft ein Turnier und wird ein Ergebnis eingetragen, muss sich **alles sofort
aktualisieren, ohne die Seite neu zu laden** — PC-Web, Turnierbaum, Handy-Web und App.

Die Grundlage steht: der Änderungsstrom `/api/changes/stream` mit Wiederaufnahme über
`Last-Event-ID` und der Haken `useApiInvalidation`. Was fehlt, ist die **flächendeckende
Anwendung**: jede Ansicht, die Ergebnisse zeigt, muss daran hängen. Das wird in den
Blöcken 9 bis 12 jeweils mitgezogen und in Block 14 für die App abgeschlossen.

## Noch offen und bewusst getrennt

**Klassischen Leseweg entfernen.** Der Schreibweg ist mit Block 8 stillgelegt; gelesen
wird noch. Das Entfernen berührt die DSGVO-Anonymisierung und bekommt deshalb einen
eigenen, sorgfältigen Schritt — nicht nebenbei.

## Was von dir kommen muss

Software kann keine Zugänge, echten Vereinsdaten oder einen Serverzugriff erfinden.

| Was | Warum |
| --- | --- |
| **AMP-Zugangsdaten** | Für die Gameserver-Anbindung. Von dir bewusst ans Ende gestellt. |
| **Ausgangs-Trockenlauf** | `bash scripts/tournament-dryrun.sh vorher.json` einmal laufen lassen, damit es eine Vergleichsbasis gibt. Ohne Ausgabedatei kann später nicht verglichen werden. |
| **Praxistest mit mehreren Nutzern** | Turnierabläufe mit echten Anmeldungen lassen sich als einzelner Nutzer im Livesystem nicht prüfen. |
| **Abnahme nach Ausrollen** | Siehe [STAGING_ABNAHME.md](STAGING_ABNAHME.md). |

Zum Testen ohne Livesystem gibt es seit Block 6 den Weg über die echte Anwendung gegen
eine Datenbank im Speicher (`backend/tests/flow_harness.py`) — damit lassen sich vollständige
Turnierabläufe durchspielen, ohne deine Produktivdaten anzufassen.

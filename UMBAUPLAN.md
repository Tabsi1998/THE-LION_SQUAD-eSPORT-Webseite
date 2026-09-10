# Umbauplan: Turniere, Übersichtlichkeit und die offenen Wünsche

Stand: 10. September 2026.

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
| 9 | **Übersichtlichkeit** | umgesetzt | #178, #179, #181, #183, #185, #186, #188 |
| 10 | **Spielwochen und Terminfindung** | offen zum Mergen | #189 |
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

## Block 9 — Übersichtlichkeit

Dein Befund: „das Admin-Config- und Bearbeitungsmenü ist einfach zu unübersichtlich".
Ziel ist eine logische, wartbare Struktur, die auf **PC-Browser, Handy-Browser und in der
App** funktioniert.

| Schritt | Was | Stand |
| --- | --- | --- |
| 9.1 | Turnier anlegen: erst das Nötige, dann der Rest | umgesetzt (#178) |
| 9.2 | Dashboard: erst was ansteht, dann die Zahlen | umgesetzt (#179) |
| 9.3 | Formatwechsel: aus einer Liga wurde eine Einzelausscheidung | umgesetzt (#181) |
| 9.4 | Turnierseite: dreizehn Knöpfe im Kopf werden vier | umgesetzt (#183) |
| 9.5 | Adminmenü: 34 Einträge, von denen zwölf sichtbar waren | umgesetzt (#185, #188) |
| 9.6 | Einstellungen: dreizehn gleiche Chips, fünf davon Mail | umgesetzt (#186) |
| 9.7 | Handy-Browser: Turnierseite und Einstellungen vermessen | umgesetzt |

**Das Aufteilen der großen Dateien war ursprünglich Teil dieses Blocks und steht jetzt in
Block 13.** Es ist Umbau ohne sichtbare Änderung und gehört deshalb nicht in einen Block,
der Übersichtlichkeit herstellt.

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

### Was gemessen wurde

Nicht geschätzt, sondern im Browser nachgemessen — zweimal lag die Ursache woanders, als
sie aussah.

| Ort | vorher | nachher |
| --- | --- | --- |
| Turnierseite am Telefon: Reiter beginnen bei | 1290 px | **673 px** |
| davon die Speziallink-Tafel | 696 px | **78 px** |
| Turnierseite gesamte Höhe | 2305 px | **1688 px** |
| Adminmenü: Höhe der Liste | 1689 px | zuklappbar, gemerkt |
| Adminmenü: gleichzeitig sichtbar | 12 von 34 | unverändert 34, vier Gruppen zugeklappt halbieren sie |

Beim Adminmenü kam ein zweiter Befund dazu: auf `/admin/mobile-push` stand die Liste bei
`scrollTop: 0` — man war auf „Push-Tests" und sah im Menü nur „Übersicht". Der aktive
Eintrag wird jetzt in den Blick geholt.

Die Voreinstellung im Menü ist **offen** (#188): eine Voreinstellung, die etwas wegräumt,
trifft genau die Leute, die das Zuklappen noch nicht kennen.

Die übrigen Adminseiten sind noch nicht vermessen.

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

### Was davon schon da war

Vor dem Bauen nachgesehen — es war mehr vorhanden, als dieser Plan behauptet hat.
`match_routes.py` konnte bereits **vorschlagen, annehmen, ablehnen und gegenvorschlagen**,
samt Frist. Auch die Regel „der eigene Vorschlag muss von der Gegenseite bestätigt werden"
war dort schon erzwungen.

Und das **Heimrecht steckte schon im Spielplan**: der Ligagenerator schreibt jede Paarung
als `[heim, auswärts]` und dreht sie in der Rückrunde um. Deine Regel „jeder soll einmal
heim sein" war strukturell erfüllt — nur benutzte sie niemand.

### Was gefehlt hat und mit #189 kommt

- Das **Wochenfenster** je Spieltag, Dauer einstellbar (Vorgabe 7 Tage).
- Die **Standardzeit** je Turnier: Wochentag und Uhrzeit, Vorgabe Sonntag 20:00.
- Das **Heimrecht** als Entscheidungsregel — auch gegen einen unbeantworteten
  Auswärtsvorschlag, sonst wäre es wertlos.
- Der **Spielplan blättert** statt zu stapeln, mit Zeitraum in der Kopfzeile, und öffnet
  auf der Woche, die gerade läuft.
- An jeder Partie steht, **warum** dieser Termin gilt: vereinbart, Heimrecht oder
  Standardzeit.

### Bewusst offen geblieben

Die Termine werden **berechnet, nicht geschrieben**. Damit wirkt die Regel sofort überall,
ohne Datenwanderung und ohne Hintergrundjob, der an laufenden Turnieren schreibt.

Wenn der berechnete Termin auch in `scheduled_at` landen soll — für Erinnerungen,
Stationen und die TV-Anzeigen — ist das ein eigener kleiner Schritt. Er schreibt an
Bestandsdaten und braucht deshalb deine Zustimmung.

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

| Datei | Zeilen | Lohnt sich das Aufteilen? |
| --- | --- | --- |
| `backend/routes/tournament_routes.py` | 3623 | **Ja.** Jeder weitere Block fasst sie an |
| `frontend/src/pages/admin/AdminTournamentEditPage.jsx` | 2175 | **Nebenbei**, wenn ohnehin daran gearbeitet wird |
| `frontend/src/pages/admin/AdminSettingsPage.jsx` | 2101 | **Eher nicht.** Unabhängige Reiter, die selten gemeinsam geändert werden |
| `frontend/src/pages/user/ProfilePage.jsx` | 1803 | **Eher nicht**, aus demselben Grund |
| `backend/routes/news_routes.py` | 1453 | **Eher nicht** |

### Die Empfehlung

Aufteilen bringt dir als Betreiber **nichts Sichtbares**. Es senkt das Risiko künftiger
Änderungen und macht sie schneller — mehr nicht. Deshalb nicht als eigenes Projekt,
sondern dort, wo es Arbeit tatsächlich blockiert.

Die eine Ausnahme ist `tournament_routes.py`. Sie mischt Struktur, Anmeldungen, Tabellen,
Exporte und jetzt Spielwochen, und **jeder verbleibende Block fasst sie erneut an**. Dafür
gibt es im Projekt bereits ein erfolgreiches Vorbild: PR #163 hat `extras_routes` nach
Domänen aufgeteilt.

**Vorschlag für die Reihenfolge:** erst die Blöcke, die du siehst — PDF und Galerie —, dann
`tournament_routes.py` aufteilen, bevor App und Abschluss kommen. Die übrigen Dateien nur
anfassen, wenn ohnehin dort gearbeitet wird.

## Block 14 — LionsAPP in den Store

- Chat: **Tastatur, Emojis, GIFs** und Einfügen müssen sauber funktionieren.
- **Animationen** und **Achievements** in der App.
- Umstellung der App vom Abfragen (Polling) auf den bestehenden **SSE-Änderungsstrom**.

## Block 15 — Abschluss

Alle CI-Prüfungen grün, automatischer App-Build, README auf Stand.

## Querschnitt: Live-Aktualisierung überall

Läuft ein Turnier und wird ein Ergebnis eingetragen, muss sich **alles sofort
aktualisieren, ohne die Seite neu zu laden** — PC-Web, Turnierbaum, Handy-Web und App.

**Im Web ist das erledigt.** Nachgeprüft statt vermutet — dieser Plan hat die Lücke
vorher überzeichnet:

| Prüfung | Ergebnis |
| --- | --- |
| Hängen die Ansichten am Änderungsstrom? | Praktisch alle |
| Sendet das Backend beim Ergebniseintrag? | Ja, für jeden erfolgreichen schreibenden Aufruf |
| Erreicht das auch Zuschauer, nicht nur Personal? | Ja — `matches`, `matches-v2` und `tournaments` sind öffentliche Ressourcen |
| Vorbedingung „genau ein API-Arbeiter"? | Eingehalten, `--workers 1` steht fest im Entrypoint |

Dabei fiel ein Filtereintrag auf, der nie zutreffen konnte (`matches_v2` mit Unterstrich
statt `matches-v2`); folgenlos, aber eine Falle für die nächste Ansicht. Behoben mit #187,
samt Prüftest über alle Filternamen.

**Offen ist die App.** Sie hat keine SSE-Anbindung und fragt in Intervallen ab: Chat alle
7 s, Dashboard und Turnierdetail alle 10 s, Turnierliste alle 30 s. „Sofort live" heißt
dort also bis zu einer halben Minute. Das ist Block 14.

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

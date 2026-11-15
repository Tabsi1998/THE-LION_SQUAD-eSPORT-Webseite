# Liga-Gesamtabnahme (G.1)

Paket G.1 des Liga-Masterplans (#2211), Freigabeprüfung #1632. Die Abnahme prüft das Zusammenspiel aller Liga-Pakete an einem
Stück: echtes Backend, echtes MongoDB, Browser bei 390 und 1440 px. Sie läuft jede Nacht in GitHub Actions
([`liga-abnahme-nacht.yml`](../../.github/workflows/liga-abnahme-nacht.yml)) und von Hand per `workflow_dispatch`.

Grundlage sind die 18 Szenarien aus Abschnitt 24 („Phase G – Gesamtabnahme“) des Auftrags vom 02.11. Dazu kommen Abbrüche,
Fehleingaben, gleichzeitige Aktionen, Sperren, Rechte und historische Daten.

## Aufbau

| Teil | Datei | Aufgabe |
|---|---|---|
| Ablauf | [`scripts/run_liga_g1.sh`](../../scripts/run_liga_g1.sh) | `up` startet das Backend (uvicorn), `seed` legt die Testwelt an, `run` startet die Specs, `down` stoppt das Backend |
| Testwelt | [`scripts/seed_liga_g1.py`](../../scripts/seed_liga_g1.py) | Leitung (Superadmin, zwei Liga-Leitungen, eine befangene Leitung, Turnierleitung ohne Bereich Ligen), 16 erfundene Teams mit Co-Team, ein Spieler ohne Team, das Spiel. Je Lauf ein eigenes Kürzel |
| Zeit-Helfer | `seed_liga_g1.py --job …` | `deadlines` (Fristen-Job mit späterem „jetzt“), `veto` (Zeitüberschreitung im Veto), `age` (Ergebnisse einer Staffel um Tage zurückdatieren), `legacy` (Season ohne neue Felder) |
| Hauptweg | [`liga-gesamtabnahme.spec.js`](../../frontend/e2e/liga-abnahme/liga-gesamtabnahme.spec.js) | Szenarien 1 bis 15, 17 und 18, dazu Belohnungen, Gesamtwertung und Profil |
| Grenzfälle | [`liga-grenzfaelle.spec.js`](../../frontend/e2e/liga-abnahme/liga-grenzfaelle.spec.js) | Szenario 16, Rechte, Gleichzeitigkeit, Fehleingaben, Fristen-Job, Abbrüche, Sperren, Altdaten |
| Hilfen | [`g1.js`](../../frontend/e2e/liga-abnahme/g1.js) | Anmelden (Sitzungen aus `e2e/abnahme/abnahmeSession.js`), API-Aufrufe mit CSRF, Liga anlegen, Serien und Veto |

Die Specs nutzen keine nachgestellte API. Alles, was sie tun, läuft über die Routen, die auch das Web aufruft. Konten und Teams
schreibt nur der Seed direkt in die Datenbank, wie bei den anderen Abnahme-Seeds.

**Zeit:** Im Testbetrieb gibt es keine einstellbare Uhr. Darum gilt:
- Termine legt die Leitung auf „in fünf Minuten“, dann ist das Check-in-Fenster offen.
- Fristen stößt die Spec über die Zeit-Helfer mit verschobenem „jetzt“ an: Veto-Timer (Zeitüberschreitung per Los) und
  Fristen-Job (Meldung gilt nach 48 Stunden, fehlender Check-in wird ein Vorschlag an die Leitung).
- Die 48-Stunden-Protestfrist vor dem Abschluss überbrückt `age`.
- Alle Daten sind relativ zu heute. Kein festes Datum läuft in Zukunft ab.

**Rangfolge:** Bei jedem Spiel gewinnt das Co-Team mit dem kleineren Index der Testwelt. So ist der Endstand vorhersagbar:
Meister ist Index 0 mit 45 Punkten.

**Nicht in der normalen CI:** `playwright.config.js` blendet `e2e/liga-abnahme/` aus. Nur mit `LIGA_ABNAHME=1` sind die
Specs gelistet, das setzt `run_liga_g1.sh`. Die Browser-Teile der CI werden dadurch nicht langsamer.

## Nachts in GitHub Actions

Ablauf des Laufs:
- Mongo-Dienst (`mongo:7.0.40-jammy`) und Backend mit `APP_ENV=test`, `DISABLE_SCHEDULER=true`, `OUTBOUND_DISABLED=true`.
- Frontend über den Vite-Server. Den startet Playwright selbst und leitet `/api` an das Backend weiter.
- Läuft um 01:30 UTC, also 02:30 Wiener Winterzeit und 03:30 Sommerzeit. Dazu jederzeit von Hand.
- Laufzeit-Grenze: 45 Minuten für den Job, 30 Minuten für die Specs.

Bei Rot:
- Artefakt `liga-abnahme` mit Bildern, Playwright-Bericht und Backend-Protokoll, 7 Tage.
- Ohne Traces, Stand-Datei, Sitzungen und Uploads, denn das Repo ist öffentlich.
- Der Job „Meldung“ legt das Issue „Liga-Gesamtabnahme rot“ an (Labels `testing`, `bug`) oder kommentiert ein offenes.
- Die erste grüne Nacht danach kommentiert und schließt es.
- Das Issue enthält nur Ergebnis, Commit und Link zum Lauf.
- Von Hand meldet der Lauf nur mit `melden: true`.

## Lokal

Nur zur Entwicklung, kein eigener Docker-Stand nötig. Vorher prüfen, dass kein Spiel läuft, und dann nur headless arbeiten.

```bash
docker run --detach --name flow-mongo-g1 --publish 127.0.0.1:27318:27017 --tmpfs /data/db:size=2g mongo:7.0.40-jammy --wiredTigerCacheSizeGB 1
export PYTHON=C:/Programmieren/lsw-venv/Scripts/python G1_MONGO_URL=mongodb://127.0.0.1:27318
bash scripts/run_liga_g1.sh up && bash scripts/run_liga_g1.sh seed && bash scripts/run_liga_g1.sh run
bash scripts/run_liga_g1.sh down && docker rm -f flow-mongo-g1
```

Vor jedem neuen `run` frisch seeden: Die Specs verbrauchen ihre Testdaten (Abschluss, Nachfolger). Bilder speichert der Lauf
mit `ABNAHME_SHOTS=<Ordner>`, nur einzelne Specs mit `G1_SPECS="liga-grenzfaelle"`.

## Szenarien

Ziel, Schritte und erwartetes Ergebnis je Szenario, dazu der Test, der es abdeckt.

| Nr. | Szenario | Schritte | Erwartet | Abgedeckt durch |
|---|---|---|---|---|
| 1 | Neue Liga und Season erstellen | Leitung legt Liga, Season (Best of 5, Modusfolge Stellung, S&D, Kontrolle, Stellung, S&D), Liga 1 und Staffel A an, veröffentlicht das Regelwerk, schaltet öffentlich | Season trägt alle Vorgaben, Veröffentlichen ohne Notausnahme, Verwaltung bei 390/1440 px fehlerfrei | Hauptweg „Szenario 1 und 2“ |
| 2 | Spielmodi und Map-Pools konfigurieren | Modi mit Ergebnisregel am Spiel, sieben Test-Maps, Pool je Modus | Season übernimmt die Ergebnisregeln, Veto-Vorlage passt ohne Hinweis, Check-in 15/15 min, mindestens 3 Anwesende | Hauptweg „Szenario 1 und 2“ |
| 3 | Co-Team über die Website anmelden | Zwei Captains im Browser (390 und 1440 px), 14 über dieselbe Route, einer zieht zurück und reicht neu ein | Status „Eingereicht“, 16 offene Anträge; das Fenster läuft über den Season-Start hinaus, Ligaseite und Verwaltung sagen „Anmeldung läuft nach Season-Start weiter (bis …)“ (Nachmeldung, Entscheidung Nr. 180) | Hauptweg „Szenario 3 und 4“; Grenzfälle „Anmeldung …“ |
| 4 | Anmeldung genehmigen | Leitung nimmt im Eingang an und teilt Staffel A zu (Browser und Route) | 16 Zuteilungen, keine doppelt; letzter Platz bei zwei gleichzeitigen Annahmen nur einmal vergeben | Hauptweg „Szenario 3 und 4“; Grenzfälle „Anmeldung …“ |
| 5 | Spielplan mit 16 Teams erzeugen | Staffel auf live | 120 Spiele in 15 Runden, jedes Team spielt jedes einmal, Spieltage bei 390/1440 px | Hauptweg „Szenario 5“ |
| 6 | Matchtermin vereinbaren | Heim-Captain schlägt im Browser vor (390 px), Gast nimmt an (1440 px) | Vorschlag „angenommen“, Termin gilt | Hauptweg „Szenario 6 bis 10“ |
| 7 | Check-in durchführen | Beide Seiten haken im Browser drei Anwesende an | Veto startet von selbst | Hauptweg „Szenario 6 bis 10“; Grenzfälle „Gleichzeitig …“, „Abbrüche …“ |
| 8 | Map-Veto vollständig durchspielen | Die Seite am Zug wählt im Browser, bis die Spielreihenfolge steht; Zeitüberschreitung per Job | Fünf Maps in Modusfolge, keine Map doppelt im selben Modus; Zug per Los bei Ablauf | Hauptweg „Szenario 6 bis 10“, „Szenario 9“ |
| 9 | BO5 mit 3:0, 3:1 und 3:2 abschließen | 3:0 im Meldeformular (Maps laut Veto), 3:1 und 3:2 über die Route | Gespeichert mit 3, 4 und 5 Maps | Hauptweg „Szenario 6 bis 10“, „Szenario 9“ |
| 10 | Ergebnis bestätigen | Gegenseite bestätigt mit Teilnehmerliste | Spiel abgeschlossen | Hauptweg „Szenario 6 bis 10“, „Szenario 9“ |
| 11 | Tabelle automatisch aktualisieren | Tabelle nach den drei Serien | 3 Punkte, Maps 3:0/3:1/3:2, Rang nach Map-Differenz; Ligaseite bei 390/1440 px | Hauptweg „Szenario 11“ |
| 12 | Protest einreichen | Unterlegene Seite protestiert nach der Bestätigung, Gegenseite nimmt Stellung, Leitung übernimmt | Sieg zählt vorläufig und ist markiert; zweiter Protest 409 | Hauptweg „Szenario 12 und 13“ |
| 13 | Ergebnis korrigieren | Leitung korrigiert 3:2 auf 3:1 mit Grund; Einspruch, über den eine zweite Person entscheidet | Ohne Grund 422, Tabelle korrigiert; Entscheiderin selbst 403; zweiter Einspruch 409 | Hauptweg „Szenario 12 und 13“ |
| 14 | Sanktion anwenden | Punktabzug, Spielsperre, Einspruch, Widerruf | Abzug in der Tabelle, Gesperrter im Check-in blockiert (422), Ausstellerin entscheidet den Einspruch nicht (403), Widerruf hebt auf | Hauptweg „Szenario 14“ |
| 15 | Default-Win korrekt werten | Leitung wertet kampflos | Sieger 3:0 mit 3 Punkten, „kampflos“ in der Tabelle; Notiz zu kurz 422 | Hauptweg „Szenario 15“ |
| 16 | Gleichstand mehrerer Teams auflösen | (a) Drei Teams mit je 6 Punkten im Kreis (A–B 3:0, B–C 3:1, C–A 3:2). (b) Drei Teams im Kreis je 3:1, gleich in allem | (a) Mini-Tabelle nach Punkten, Map-Differenz, gewonnenen Maps: A, C, B (Kennung `head_to_head`). (b) Geteilter Platz 1, ein offener Gleichstand; Entscheid der Leitung ohne Verfahren 422, mit Los 1, 2, 3 (Kennung `lead_decision`) | Grenzfälle „Szenario 16“ |
| 17 | Season abschließen | Belohnungen festlegen, alle Spiele eintragen, Protestfrist verstreichen lassen, zwei Leitungen schließen gleichzeitig | Abschluss erst ohne Blocker; genau ein Abschluss gilt; danach gesperrt (409); Meister Index 0 mit 45 Punkten; Gold einmal, Banner für alle | Hauptweg „Szenario 17“ |
| 18 | Neue Season aus Vorgänger erstellen | Vorschau, Anlegen mit Bestätigung, Doppelklick | Neue Season im Entwurf mit Best of 5, Modusfolge und Veto-Vorlage; Teams vorgemerkt; Vorgängerin und Endstand unverändert | Hauptweg „Szenario 18“ |

Weitere Prüfungen:

| Thema | Prüfung | Abgedeckt durch |
|---|---|---|
| Belohnungen, Gesamtwertung, Profil | Zeitraum mit Season 1, Stufe 1 doppelt abgeschlossen (eine gilt), öffentliche Gesamtwertung, Team- und Spielerprofil zeigen die Goldmedaille (390/1440 px) | Hauptweg „Gesamtwertung über Seasons und Profil“ |
| Rechte, auch negativ | Turnierleitung ohne Bereich Ligen 403, Fremde 403, Mitglied ohne Rolle 403, Leitung zieht nie im Veto (403); befangene Leitung: Ergebnis und Strafe am eigenen Team 403; Mitglied reicht keine Anmeldung ein | Grenzfälle „Rechte …“, „Anmeldung …“ |
| Gleichzeitige Aktionen | Check-in beider Seiten im selben Moment; Captain und Vertreter ziehen gleichzeitig (ein Zug zählt); beide Bestätigungen gleichzeitig (einmal gezählt); doppelter Abschluss (Staffel, Gesamtwertung); zwei Annahmen auf den letzten Platz | Grenzfälle, Hauptweg „Szenario 17“ |
| Fehleingaben | Stand passt nicht zu den Maps, Map nicht laut Veto, Punkte fehlen, Ziel nicht erreicht, zu wenig Anwesende, Gründe zu kurz | Grenzfälle „Gleichzeitig und Fehleingaben …“, „Anmeldung …“ |
| Abbrüche | Rückzug einer Anmeldung, Terminänderung macht den Check-in ungültig, Veto pausiert und fortgesetzt, Einwand zurückgezogen | Grenzfälle „Abbrüche und Sperren …“, „Gleichzeitig …“ |
| Fristen-Job | Meldung ohne Antwort: nach 47 Stunden offen, nach 49 bestätigt (`auto_confirmed`), ein zweiter Lauf bestätigt nichts doppelt. Eine Seite checkt nicht ein: nach dem Fenster nur ein Vorschlag „nicht erschienen“ an die Leitung, keine Wertung, kein zweiter Vorschlag | Grenzfälle „Fristen-Job: …“ (zwei Tests) |
| Nachmeldung | Erstes Veröffentlichen mit Fenster über den Season-Start: Hinweis `application_after_start`, keine Sperre | Grenzfälle „Anmeldung …“; Flow `test_league_pools_flow.py`, `test_league_application_late_flow.py` |
| Sperren | Gesperrtes Konto im Check-in blockiert (D-4), abgeschlossene Staffel nimmt nichts mehr an, Wiederöffnen nur durch eine zweite Person | Grenzfälle „Abbrüche und Sperren …“ |
| Altdaten | Season ohne die Felder des Masterplans: melden ohne Check-in und Veto mit Aufstellung je Map, Tabelle, Protest-Vorgaben inaktiv, Seiten fehlerfrei | Grenzfälle „Altdaten …“ |

## Außerhalb des Umfangs

Diese Punkte aus der Testmatrix von #1632 betreffen Funktionen, die es noch nicht gibt. Die Abnahme baut sie nicht nach.

| Punkt aus #1632 | Grund | Issue |
|---|---|---|
| Solo-Ligen (Solo-Parität, EA-FC-Solo), Partien ohne Maps | Ligen gibt es heute nur für Co-Teams | #2401, #1627 |
| Relegation, Playoffs aus dem Endstand (Gruppen → Playoffs) | Noch nicht gebaut, nur in `docs/liga/erweiterbarkeit.md` vorbereitet | #2404 |
| Sportlicher Auf- und Abstieg über mehrere Ligen N | Folge-Season übernimmt die Stufe, eine Regel je Spiel fehlt | #1627 |
| Zusammenlegen und Entflechten von Divisionen | Noch nicht gebaut | #1628 |
| Titelwechsel je Season, freier Name je Liga N | Noch nicht gebaut | #2400, #2405 |
| Veto-Seitenwahl, Aufstellungsgröße je Modus | Noch nicht gebaut | #2402 |
| Vorfallarten und MOSS je Season schaltbar | Noch nicht gebaut | #2403 |
| App (Check-in, Veto, Anmeldestatus) | Paket G.2 | #2173 |
| Benachrichtigungen über echte Dienste, Backup und Restore | Versandsperre im Testbetrieb, Betriebsprüfung auf dem Server | #1632 (Freigabe-Gates) |

## Offene Punkte aus der Abnahme

- **Nachmeldung nach dem Start (Entscheidung Nr. 180):** Die Leitung nimmt ein nachgemeldetes Co-Team an und teilt es einer
  laufenden Staffel zu. Es steht dann mit 0 Spielen in der Tabelle. Spiele bekommt es nicht von selbst, der feste Spielplan
  bleibt, wie er beim Start war (`backend/tests/test_league_application_late_flow.py`). Wie Nachrücker Spiele bekommen, ist noch
  offen.

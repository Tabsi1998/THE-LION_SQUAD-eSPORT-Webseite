# Probelauf: der Event-Abend einmal ganz

Drehbuch für die Generalprobe vor einem Vor-Ort-Event – zuerst für **Samstag, 24.10., nachmittags** (das Event ist am
31.10.), danach wiederverwendbar eine Woche vor jedem Event. Ziel: der ganze Abend einmal echt durchgespielt, auf dem
lokalen Abnahme-Stand ([Abnahme lokal](abnahme-lokal.md)) mit Testdaten, Punkt für Punkt abgehakt.

**Rollen:**

| Wer | Rolle | Womit |
| --- | --- | --- |
| **Turnierleitung** (Fabian) | bedient alles, was am Abend die Turnierleitung tut | PC (Verwaltung), Handy (Turnierleitung am Handy, Begleitperson), zweiter Bildschirm (TV) |
| **Claude** | spielt 16 Spieler, den Helfer am Einlass und an den Stationen, den Helfer am Simulator, Fahrer | [`scripts/probelauf_mitspieler.py`](../../scripts/probelauf_mitspieler.py), Phase für Phase auf Zuruf |

Das Skript läuft nur gegen einen lokalen Abnahme-Stand (Projektname `lsw-abnahme…`, im Container dieselbe Prüfung wie
`seed_abnahme.py`) und nennt nie Passwörter, Codes oder Cookies. Kurzform in diesem Drehbuch:

```bash
PM="python scripts/probelauf_mitspieler.py"   # aus dem Repo-Ordner, ABNAHME_PROJECT wie der Stand (Vorgabe lsw-abnahme)
$PM stand                                     # jederzeit: Status, Anmeldungen, Spiele, Stationen
```

**Abhaken:** eine Abhakliste mit allen Prüfpunkten dieses Drehbuchs (je Punkt Phase, Erwartung, Notiz) bekommt die
Turnierleitung als Seite fürs Handy. Befunde werden danach einzelne Issues im Meilenstein „Turniersystem I“; bis zum
Event nur noch Fixes, keine neuen Funktionen.

## Ablauf und Zeitbedarf

| # | Phase | Dauer | Beispiel Sa 24.10. |
| --- | --- | --- | --- |
| 0 | [Vorbereitung](#0-vorbereitung-am-vorabend) (Claude, am Vorabend) | 30 Min. | Fr 23.10. abends |
| 1 | [Aufbau: Geräte, Anmelden, TV](#1-aufbau-geräte-anmelden-tv) | 15 Min. | 14:00 |
| 2 | [Anmeldung und Vor-Ort-QR mit Begleitperson](#2-anmeldung-und-vor-ort-qr-mit-begleitperson) | 15 Min. | 14:15 |
| 3 | [Check-in](#3-check-in) | 10 Min. | 14:30 |
| 4 | [Check-in-Ende](#4-check-in-ende) | 5 Min. | 14:40 |
| 5 | [Vorplanen im Matchplan](#5-vorplanen-im-matchplan) | 10 Min. | 14:45 |
| 6 | [Turnier starten, Live-Warteschlange](#6-turnier-starten-live-warteschlange) | 15 Min. | 14:55 |
| 7 | [Ergebnisse und Rückgängig](#7-ergebnisse-und-rückgängig) | 10 Min. | 15:10 |
| 8 | [Weiterkommen: Show-Auslosung und sofort zufällig](#8-weiterkommen-show-auslosung-und-sofort-zufällig) | 15 Min. | 15:20 |
| 9 | [Austritt und nicht erschienen](#9-austritt-und-nicht-erschienen) | 10 Min. | 15:35 |
| 10 | [Lasttest-Fenster](#10-lasttest-fenster) (isoliert, in der Pause) | 15 Min. | 15:45 |
| 11 | [TV durchsehen](#11-tv-durchsehen) | 10 Min. | 16:00 |
| 12 | [Fast Lap am Simulator](#12-fast-lap-am-simulator) | 15 Min. | 16:10 |
| 13 | [Cup zu Ende, Sieger-Moment](#13-cup-zu-ende-sieger-moment) | 15 Min. | 16:25 |
| 14 | [Abschluss und Befunde](#14-abschluss-und-befunde) | 15 Min. | 16:40 |

**Gesamt rund 2 Stunden 55 Minuten** ab Phase 1 (dazu die Vorbereitung am Vorabend); Phase 10 ist zugleich die
Pause. Der Cup selbst läuft schneller als am Abend: das Skript trägt Ergebnisse sofort ein, statt 12 Minuten zu
spielen.

**Was anders ist als am Abend** (gewollt, sonst dauert die Probe Stunden):

- Im Abnahme-Stand laufen nur die Server-Jobs `result_holds` und `draw_show`. Das **Check-in-Ende zur eingestellten
  Zeit** und die **Fristen** („nicht erschienen“ vorschlagen) stößt deshalb das Skript an (`checkin-ende`, `fristen`) –
  mit denselben Funktionen, die am Abend der Server jede Minute aufruft.
- „Nicht erschienen“ greift nach **3** statt 10 Minuten ab dem Aufruf, die Show-Auslosung erinnert nach 3 Minuten und
  lost nach 6 Minuten selbst.
- Mails, Push und Discord sind aus (`OUTBOUND_DISABLED`): „Du bist dran“ landet nur im Postfach der Website.

---

## 0. Vorbereitung am Vorabend

**Wer:** Claude, Freitag 23.10. abends. Der gemeinsame Stand `lsw-abnahme` wird frisch aus `main` gebaut – vorher
prüfen, dass niemand darauf prüft (`docker ps --filter name=lsw-abnahme`, Regel in [Abnahme lokal](abnahme-lokal.md)).

```bash
docker info                                     # Docker Desktop läuft
git fetch origin
git worktree add --detach ../lsw-probelauf origin/main    # sauberer Ordner ohne frontend/node_modules
docker compose -p lsw-abnahme --env-file .env.abnahme.example \
  -f docker-compose.yml -f docker-compose.abnahme.yml down --volumes      # alter Stand samt Testdatenbank weg
ABNAHME_SOURCE=../lsw-probelauf docker compose -p lsw-abnahme --env-file .env.abnahme.example \
  -f docker-compose.yml -f docker-compose.abnahme.yml up -d --build
curl -fsS http://127.0.0.1:23000/health && curl -fsS http://127.0.0.1:28001/api/health/ready
python scripts/seed_abnahme.py                  # Konten, Spiel, Seed-Turniere (Online-Abend für Phase 7)
```

Erwartung: beide Health-Abrufe antworten, der Seed schreibt `.local-testing/abnahme/state.json`. Den Aufbau des
Probelaufs (`$PM aufbau`) **nicht** am Vorabend: Start, Check-in und Fristen rechnet er ab dem Moment des Aufrufs.

**Adressen bleiben auf diesem Rechner:** `BACKEND_BIND` und `FRONTEND_BIND` stehen in `.env.abnahme.example` auf
`127.0.0.1` und bleiben dort. Der Stand hat bekannte Testpasswörter – im WLAN hätte ihn jeder im Netz. Das Handy kommt
trotzdem dran, über ein Kabel (Abschnitt 1).

**Einmalig für die Turnierleitung:** In der Authenticator-App einen Eintrag „Lionsquad Abnahme“ mit dem Test-Geheimnis
aus `scripts/seed_abnahme.py` (`TEST_TOTP_SECRET`) anlegen. Konto: `turnierleitung@abnahme.lionsquad.at`, Passwort
ebenfalls aus dem Skript. Für die Begleitperson das Konto `gast@abnahme.lionsquad.at` (ohne Zwei-Faktor).

---

## 1. Aufbau: Geräte, Anmelden, TV

| Wer | Was | Erwartung |
| --- | --- | --- |
| Turnierleitung | Android-Handy per USB an den PC, am Handy **Entwickleroptionen → USB-Debugging** an (oder **Kabelloses Debugging**, dann `adb pair`/`adb connect`) | `adb devices` zeigt das Handy als `device` |
| Claude | `adb reverse tcp:23000 tcp:23000` | Handy-Chrome öffnet `http://127.0.0.1:23000` – die Startseite des Abnahme-Stands |
| Claude | `$PM aufbau` | Event „Probelauf (…)“, Probelauf-Cup, Sofort-Cup, Fast Lap; die Adressen stehen in der Ausgabe |
| Turnierleitung | Am PC `http://127.0.0.1:23000` als Turnierleitung anmelden (Zwei-Faktor aus der App), am Handy dasselbe | Admin-Menü sichtbar, kein „2FA einrichten“ |
| Turnierleitung | **Admin → eSports → TV & Beamer**: Link **Turnierbaum** für den Probelauf-Cup mit Anzeige-Schlüssel („Beamer Probelauf“), dazu **Aufrufe** (Event „Probelauf“) und **Fast Lap** | drei Links; der Schlüssel steht nur jetzt im Link – gleich kopieren |
| Turnierleitung | Bei **Aufrufe** einen **Namen des Bildschirms** eintragen („Aufruf-Tafel Probelauf“) und **Link mit Schlüssel** – ein Event-Schlüssel (#1822), weil der Cup „Nur Mitglieder“ ist | Link mit Schlüssel; unten unter **Aktive Anzeige-Schlüssel** steht er mit Event „Probelauf“. Ohne Schlüssel zeigt die Aufruf-Tafel den Cup nicht ([TV-Handbuch](../handbuch/tv.md), 2.3) |
| Turnierleitung | Zweiter Bildschirm: zwei Browserfenster im Vollbild (`F11`), links Turnierbaum, rechts Aufruf-Tafel; Fast Lap später | TV zeigt den Cup mit „Anmeldung“ und QR-Code |

**Was angelegt wird** (`aufbau`): ein Event „Probelauf“ (live, öffentlich) mit
**Probelauf-Cup** – vor Ort, nur Mitglieder, 16 Plätze, FFA zu viert mit Winner und Loser Bracket (Schema wie im
Seed), **Show-Auslosung**, vier Stationen „Station 1–4“, Anmeldung offen, Check-in ab in 20 Minuten (gestartet wird
er in Phase 3 von Hand), Start in rund 45 Minuten, „nicht erschienen“ nach 3 Minuten, 5 Minuten Mindestpause, Gewinne
für Platz 1–3 (Testwerte „Pokal“, „Medaille“, „Urkunde“); Turnierleitung als Organisation und der Helfer als
Schiedsrichter eingeteilt –
**Sofort-Cup** – K.-o. 8, **sofort zufällig**, schon live und geplant, zwei Stationen – und **Probelauf Fast Lap** mit
Strecke Spielberg, 3 Versuchen, Simulator 1 und 2, Helfer und Turnierleitung im Fast-Lap-Team.

**Warum nicht übers WLAN?** Probiert am 19.10.: Mit `FRONTEND_BIND` auf der Adresse des PCs im Heimnetz (und
`PUBLIC_BACKEND_URL`/`CORS_ORIGINS` darauf, neu gebaut) bleibt die Seite im Browser weiß. Das Frontend schickt dieselbe
Sicherheitsrichtlinie wie die echte Seite (`upgrade-insecure-requests` in `frontend/nginx.conf`): Der Browser holt jedes
Skript und jede Anfrage über `https://` – das gibt es lokal nicht (`ERR_SSL_PROTOCOL_ERROR`). Nur `127.0.0.1` und
`localhost` nimmt der Browser davon aus. Mit `adb reverse` ist `127.0.0.1:23000` am Handy der PC – sicher (nichts
offen im Netz) und ohne Umbau. Danach: `adb reverse --remove-all`, USB-Debugging aus. Ein iPhone geht so nicht; dann
die Handy-Schritte im Chrome des PCs mit der Geräteansicht (`F12`, Handy-Symbol) machen.

**QR-Codes:** Aushang und TV bauen den QR-Code aus der Adresse, unter der die Turnierleitung die Seite geöffnet hat –
hier `http://127.0.0.1:23000/vor-ort#…`. Den kann nur ein Handy mit `adb reverse` öffnen. Am Abend ist es
`https://lionsquad.at/…`.

---

## 2. Anmeldung und Vor-Ort-QR mit Begleitperson

| Wer | Was | Erwartung |
| --- | --- | --- |
| Turnierleitung | Probelauf-Cup öffnen (`/admin/tournaments/<Cup>`), Kasten **Vor-Ort-Anmeldung über QR** | „An – gilt gerade“ |
| Claude | `$PM anmelden --gleichzeitig` | 15 Spieler scannen den QR-Code und tippen **im selben Moment** auf **Mitspielen** (eine Gruppe am Einlass): je „Bestätigt“, jede Antwort unter 3 Sekunden (#1859), keine doppelten Plätze; „Frei: 1“ |
| Turnierleitung | Reiter **Teilnehmer** neu laden | 15 Zeilen, jede mit dem Zeichen **Vor Ort** |
| Turnierleitung | **Aushang drucken** öffnen | A4-Blatt mit Turnier, Termin, Spiel, großem QR-Code; der Code steht nirgends lesbar im Text |
| Turnierleitung (Handy als Begleitperson) | Privates Fenster in Chrome, QR-Code vom Aushang am PC-Bildschirm scannen | schlanke Turnierseite: Titel, Termin, Spiel, „1 von 16 Plätzen frei“, **Mitspielen** |
| Turnierleitung (Handy) | **Mitspielen** → Anmelden als `gast@abnahme.lionsquad.at` → zurück → **Mitspielen** | Bestätigungs-Blatt von unten (#1261): Start, Check-in, Ort „Vor Ort“, Regeln kurz, unten fest **Verbindlich anmelden** |
| Turnierleitung (Handy) | **Verbindlich anmelden** | Anmeldung bestätigt, danach das ganze Turnier (Baum, Spielplan); Abbrechen oder ein Tipp daneben meldet nicht an |
| Claude | `$PM anmelden --warteliste` | Spieler 16 (ZickZackZoe): „Warteliste“ – der Cup ist voll |
| Turnierleitung | TV ansehen | Anmelde-Bildschirm mit QR-Code und Zahl der Plätze |

Klappt das Scannen nicht (kein Android, kein Kabel): `$PM gast` meldet die Begleitperson an, und die Turnierleitung
prüft nur die schlanke Ansicht in der Geräteansicht des PCs.

---

## 3. Check-in

| Wer | Was | Erwartung |
| --- | --- | --- |
| Turnierleitung | Oben im Cup **Check-in starten** (laut Aufbau öffnet er erst in 20 Minuten – wie am Abend, wenn die Gruppe früher da ist) | Status „Check-in offen“, der Baum ist noch Vorschau |
| Claude (Helfer am Einlass) | `$PM checkin` | die ersten 8 eingecheckt; beim Helfer kein Fehler (Rolle Schiedsrichter darf einchecken) |
| Turnierleitung | Reiter **Teilnehmer**: PistenPaul **Nicht erschienen** | ZickZackZoe rückt von der Warteliste nach (Status „Bestätigt“), Hinweis bzw. Nachricht an sie |
| Turnierleitung | Den Rest per **Check-in** einchecken (auch Begleitung Gast und ZickZackZoe), einen davon am Handy (Teilnehmer-Karte) | 16 eingecheckt, 1 nicht erschienen |
| Turnierleitung | **PDF Check-in** öffnen | Liste zum Abhaken mit allen Anmeldungen |

Abkürzung, wenn die Zeit drängt: `$PM checkin --alle` checkt alle Bestätigten außer PistenPaul ein.

---

## 4. Check-in-Ende

| Wer | Was | Erwartung |
| --- | --- | --- |
| Turnierleitung | **Bearbeiten → Weitere Zeiten → Check-in endet** auf jetzt stellen, speichern | Zeit gespeichert, Status bleibt „Check-in offen“ |
| Claude | `$PM checkin-ende` | „Check-in zu: 14 Spiele im festen Baum“, dazu die vier Läufe der Runde 1 mit Namen |
| Turnierleitung | Reiter **Turnierbaum**, öffentliche Turnierseite, TV | fester Baum aus den 16 Eingecheckten (PistenPaul fehlt), öffentlich „Anmeldung geschlossen“; TV zeigt den Baum |

Am Abend schließt der Server den Check-in zur eingestellten Zeit von selbst. Ist keine Zeit gesetzt, setzt
`checkin-ende` sie auf „vor einer Minute“ und sagt das.

---

## 5. Vorplanen im Matchplan

| Wer | Was | Erwartung |
| --- | --- | --- |
| Turnierleitung | Reiter **Matchplan**: oben **Turnierstart** auf die nächste Viertelstunde stellen (der echte Start) | Spieldauer „vom Spiel: 12 Min. (Grand Prix …)“, vier Stationen |
| Turnierleitung | **Automatisch planen** | Vorschau: 14 Spiele mit Zeit und Station, keine Konflikte, spätere Runden „voraussichtlich“, Show-Runden „wartet auf Auslosung“ |
| Turnierleitung | **Übernehmen** | alle 14 Spiele geplant; Zeitleiste je Station (Winner blau, Loser violett, Finale gold) |
| Turnierleitung | Matchplan am Handy | Liste je Station statt Zeitleiste, nichts ragt über den Rand |

**Stolperstein:** Liegt der Turnierstart (vom Aufbau: in rund 45 Minuten) später als der echte Start, hält die
Warteschlange die geplanten Zeiten ein: ein bereites Spiel wartet hinter einer belegten Station, obwohl eine andere frei
ist, und beim Aufruf steht „antreten bis <Planzeit>“, aber „nicht erschienen ab <Aufruf + 3 Min.>“. Darum vor dem Planen
den Turnierstart auf den echten Start stellen.

**Hinweis Pause:** Der Aufbau stellt **5 Minuten Mindestpause** zwischen zwei Spielen eines Spielers ein (Kasten
„Mindestpause zwischen zwei Spielen“). Die Vorschau setzt die Läufe von Runde 2 darum frühestens 5 Minuten nach dem
Ende ihrer Vorläufe an, auch wenn eine Station früher frei ist – das ist gewollt, kein Planungsfehler.

---

## 6. Turnier starten, Live-Warteschlange

| Wer | Was | Erwartung |
| --- | --- | --- |
| Turnierleitung | **Turnier starten** | ggf. Rückfrage „Mit Hinweisen live schalten?“, dann Status „Live“; TV schaltet auf den Baum; öffentlich „Läuft“ auch vor der Planzeit (#1881), Hallen-Tafel mit Pille „Live“ und „läuft“ im Tagesplan (#1888) |
| Turnierleitung (Handy) | Turnier → **Turnierleitung** → Reiter **Stationen** | je Station „Als Nächstes“ mit **Aufrufen**; oben der Verzug |
| Turnierleitung (Handy) | An Station 1 **Aufrufen** | „Aufgerufen · antreten bis … · nicht erschienen ab …“; Aufruf-Tafel und TV zeigen den Aufruf mit Countdown |
| Turnierleitung (Handy) | **Gestartet** | Spielzeit-Uhr läuft ohne Neuladen („0:12 / 12 Min.“) |
| Claude (Helfer an den Stationen) | `$PM station` | Stationen 2–4: aufgerufen und gestartet; am Handy der Turnierleitung und am TV ohne Neuladen sichtbar |
| Turnierleitung | Öffentlicher **Spielplan → Nach Stationen** (als Begleitperson am Handy) | „Jetzt“ mit Spielzeit je Station; „Du bist dran“/„Läuft an Station …“ bei der Begleitperson |

Nur aufrufen, ohne zu starten (für Phase 9): `$PM station --nur-aufrufen --anzahl 1`.

---

## 7. Ergebnisse und Rückgängig

| Wer | Was | Erwartung |
| --- | --- | --- |
| Turnierleitung (Handy) | Reiter **Ergebnisse** → am Lauf von Station 1 **Eintragen** → Reihenfolge antippen | Satz in Worten („Weiter: … und …“) |
| Turnierleitung (Handy) | **Ergebnis speichern**, dann sofort **Rückgängig** | Leiste mit Sekunden; nach Rückgängig läuft das Spiel weiter, nichts im Baum |
| Turnierleitung (Handy) | Noch einmal eintragen und 10 Sekunden warten | danach rückt der Baum weiter (auch am TV), die Station wird frei |
| Claude (Helfer) | `$PM ergebnisse` | die übrigen laufenden Läufe gewertet, nach etwa 12 Sekunden veröffentlicht |
| Turnierleitung | Ein Ergebnis **Korrigieren** (Grund mindestens fünf Zeichen) | Protokoll-Eintrag, Folgespiel nur zurückgesetzt, wenn ein anderer weiterkommt |
| Claude (Spieler online) | `$PM melden` | ein Spieler meldet im Online-Abend des Seeds 3:1; die Ausgabe nennt die Gegenseite und die Matchseite |
| Turnierleitung (Handy, privates Fenster) | Als Gegenseite anmelden (Konto aus der Ausgabe, Passwort aus dem Seed), Matchseite → **Stimmt** | Ergebnis steht fest, beide sehen es |

Ist Runde 1 fertig und noch ein Lauf offen: `$PM spielen` (ruft auf, startet, trägt ein – bis nichts mehr bereit ist).

---

## 8. Weiterkommen: Show-Auslosung und sofort zufällig

| Wer | Was | Erwartung |
| --- | --- | --- |
| Claude | `$PM spielen` (falls Runde 1 noch nicht fertig) | endet mit „Nichts mehr bereit: wartet auf die Show-Auslosung …“ |
| Turnierleitung (Handy) | Reiter **Braucht Aufmerksamkeit** | zwei Karten „Auslosung bereit · 8 Namen“ (Winner Runde 2, Loser Runde 1) mit Topf und „automatisch in 6 Min.“ |
| Turnierleitung (PC) | Verwaltung des Cups → Reiter **Spiele** → Kasten **Auslosung** | zwei Zeilen „Winner Runde 2 – Auslosung bereit“ und „Loser Runde 1 – Auslosung bereit“, je mit **Jetzt auslosen** (#1860) |
| Turnierleitung (Handy) | **Jetzt auslosen**, TV dabei ansehen | TV-Moment „Auslosung · … · 8 Namen auf 2 Spiele“, die Namen fahren in ihre Läufe; im Kasten „Auslosung“ „Winner Runde 2 – ausgelost am …“ |
| Turnierleitung (Handy) | Die zweite Karte (Loser Runde 1) **liegen lassen**, Reiter **Stationen** | zwei freie Stationen mit **Aufrufen** für E und F, Prognose „jetzt“ (#1858, #1872); LA und LB stehen an den anderen Stationen mit „wartet auf die Auslosung“ und nehmen keiner Station das Aufrufen |
| Turnierleitung | Bis zur Frist warten (Zeit für den Sofort-Cup unten) | nach 3 Min. Erinnerung „Auslosung wartet“ im Postfach, nach 6 Min. lost der Server selbst, TV-Moment „Auslosung · Loser Runde 1“; danach vier Stationen mit **Aufrufen** für E, F, LA und LB. Lost er nicht: läuft der Stand schon lange (viele Seeds, über 200 Turniere „live“), erreicht der Job den Cup nicht – Stand frisch bauen (Phase 0) oder von Hand auslosen |
| Claude | `$PM spielen --turnier sofort --anzahl 2` | zwei Viertelfinale im Sofort-Cup gewertet |
| Turnierleitung | Sofort-Cup: Baum am PC (oder TV-Link dafür) | jeder Sieger steht **sofort** auf einem zufälligen freien Platz im Halbfinale, die anderen Plätze zeigen „Sieger aus Viertelfinale“ |
| Turnierleitung | Im Sofort-Cup selbst ein Viertelfinale eintragen | nach 10 Sekunden fährt der Name in Runde 2 |

---

## 9. Austritt und nicht erschienen

| Wer | Was | Erwartung |
| --- | --- | --- |
| Claude | `$PM station --nur-aufrufen --anzahl 1` | ein Lauf aufgerufen, nicht gestartet (ein schon aufgerufener wird übersprungen) |
| Turnierleitung | Reiter **Teilnehmer**: bei einem Spieler aus einem noch wartenden Lauf **Austritt** | Umbauplan in Worten („… der Platz wird frei, 3 bleiben.“), Grund optional |
| Turnierleitung | **Austritt eintragen** | Status „Ausgetreten“; der Lauf spielt mit 3 weiter, Baum und TV zeigen es |
| Claude (nach 3 Minuten) | `$PM fristen` | „1 neuer Vorschlag ‚nicht erschienen‘“ |
| Turnierleitung (Handy) | Kommt keiner: den Lauf in **Stationen** ansehen | lag seine Planzeit beim Aufruf noch vorn (der Cup läuft schneller als geplant), gilt „nicht erschienen ab <Planzeit>“ – bis dahin warten oder `$PM station --nur-aufrufen --anzahl 1` für einen Lauf, dessen Planzeit vorbei ist |
| Turnierleitung (Handy) | **Braucht Aufmerksamkeit**: Fall „Nicht erschienen?“ – er nennt den Lauf wie Baum und Stationen („Loser Runde 1 · Durchgang LA“, #1860) –, mit „<Name> nicht erschienen“ und „+5 Min. verlängern“ | ein Tipp auf einen Namen: der Lauf bleibt offen, die Person ist markiert (Baum durchgestrichen, TV „nicht angetreten“, Strafe im Protokoll); im Ergebnis-Fenster ist **Nicht erschienen** schon gesetzt – nach dem Eintragen der Anwesenden steht sie hinten, die zwei Besten kommen weiter (#1823) |

---

## 10. Lasttest-Fenster

Der Lasttest aus #1683 (`scripts/lasttest_abnahme.py`: Zuschauer mit Änderungsstrom, TVs, Helfer, Fast-Lap-Eingaben,
Vor-Ort-Anmeldungen zugleich) läuft **isoliert**, rund 10 Minuten: allein auf dem PC, während die Turnierleitung Pause
macht. Seine Zahlen gelten nur so – laufen daneben ein zweiter Stand, Testläufe oder der Probelauf selbst, teilen sie
sich Rechner und Datenbank, und die Antwortzeiten wirken mehrfach so lang (Durchlauf 2, 20.10.). Darum vorher prüfen
(`docker ps`): außer `lsw-abnahme` (der ruht in der Pause) und dem Lasttest-Stand läuft kein Stand, kein Test, kein
Build. Er trägt selbst Ergebnisse ein und fasst darum den gemeinsamen Stand `lsw-abnahme` nicht an – er bekommt einen
eigenen Stand auf demselben PC:

```bash
export ABNAHME_PROJECT=lsw-abnahme-last FRONTEND_PORT=24600 BACKEND_PORT=29601 \
  ABNAHME_STATE=$PWD/.local-testing/abnahme/state-last.json ABNAHME_SOURCE=../lsw-probelauf
bash scripts/run_abnahme_all.sh up        # eigener Stand, gleicher Code wie lsw-abnahme
python scripts/seed_abnahme.py
python scripts/lasttest_abnahme.py --minutes 10 --viewers 150
```

Den Stand dafür baut Claude vor Phase 10 (dauert einige Minuten, stört den Probelauf nicht). Die genauen Aufrufe stehen
im Kopf des Skripts (#1683); der Bericht nennt Antwortzeiten und Engpässe.

| Wer | Was | Erwartung |
| --- | --- | --- |
| Claude | Vorher `docker ps`: nur `lsw-abnahme` und der Lasttest-Stand, keine Tests oder Builds daneben | nichts anderes läuft |
| Claude | Lasttest starten, Ausgabe beobachten | läuft ohne Abbruch, Bericht in `.local-testing/abnahme/lasttest-…` |
| Claude | Danach `python scripts/lasttest_abnahme.py --minutes 3 --viewers 25 --onsite 20` (Einlass: 20 Vor-Ort-Anmeldungen in einer Sekunde) | Gruppe „Vor-Ort-Anmeldung“ ohne Fehler, p95 unter 3 Sekunden (#1859) |
| Turnierleitung | Pause – am Probelauf nichts bedienen, bis Claude fertig meldet | – |
| Claude | Danach: `lsw-abnahme-last` mit `bash scripts/run_abnahme_all.sh down` entfernen | nur das Lasttest-Projekt weg, `lsw-abnahme` unberührt |

---

## 11. TV durchsehen

| Wer | Was | Erwartung |
| --- | --- | --- |
| Turnierleitung | Turnierbaum-TV ein paar Minuten laufen lassen | Wiedergabeliste wechselt (Baum, Live-Spiele, Aufrufe), Schrift aus 5 Metern lesbar, kein Rand abgeschnitten |
| Turnierleitung | Momente ansehen, während Claude `$PM spielen --anzahl 2` laufen lässt | Ergebnis-Moment, Namen rücken nach; bei einer Show-Runde der Auslosungs-Moment |
| Turnierleitung | Warteschlange am TV | bei Läufen die Namen (bis 4), sonst „N Spieler“, Station und Zeit |
| Turnierleitung | Aufruf-Tafel (`/display/event/<Event>/calls`) | nur Aufrufe, mit Station und Countdown, aus beiden Cups |
| Turnierleitung | Stations-Ansicht (TV & Beamer → Ansicht **Station**, Station 1) – optional | nur, was an Station 1 läuft oder als Nächstes kommt |
| Turnierleitung | Grundwerte: **Kontrast-Modus** an und wieder aus | kommt ohne Neuladen an allen Bildschirmen an |

---

## 12. Fast Lap am Simulator

| Wer | Was | Erwartung |
| --- | --- | --- |
| Turnierleitung | Dritter TV-Link (Fast Lap) auf dem zweiten Bildschirm | Podium leer bzw. Rangliste, Strecke Spielberg |
| Turnierleitung (Handy) | Fast Lap öffnen → **Schnelleingabe**, Simulator 1: Fahrer **Gast** „Probe Anna“ **Anlegen**, Zeit `1:24,587`, **Eintragen & nächster Fahrer** | „= 1:24.587“, Versuch 1 von 3; TV zeigt Gast in der Rangliste |
| Turnierleitung (Handy) | Zweite Runde **Ungültig → Strecke verlassen** | zählt als Versuch („2 von 3“), keine Zeit in der Wertung |
| Turnierleitung (Handy) | **Am Start / Als Nächstes**: zwei Fahrer in die Liste, **Ersten starten** | TV zeigt „Am Start“ mit Station und Versuch, darunter „Als Nächstes“ |
| Claude (Helfer am Simulator 2) | `$PM fastlap` | drei Fahrer nacheinander „Am Start an Simulator 2“, je eine Zeit; der letzte (ein Gast) fährt **neue Bestzeit** |
| Turnierleitung | TV beim letzten Fahrer | Moment „Neue Bestzeit!“, Platz 1 leuchtet, Abstand zur Spitze |
| Turnierleitung | Dritten Versuch eines Fahrers eintragen, dann einen vierten versuchen | „Alle 3 Versuche gefahren“, Eintragen geht nicht mehr |

---

## 13. Cup zu Ende, Sieger-Moment

| Wer | Was | Erwartung |
| --- | --- | --- |
| Claude | `$PM spielen`, bei „wartet auf die Show-Auslosung“ lost die Turnierleitung, dann wieder `$PM spielen` | bis „Offen: 0“ (14 Spiele, Grand Final zuletzt) |
| Turnierleitung | Status **Beendet** | Podest mit „Stand vorläufig“; TV „Turnier entschieden“ mit Champion |
| Turnierleitung | Status **Ergebnisse veröffentlicht** | Punkte und Auszeichnungen angelegt; unter **Admin → eSports → Gewinne** drei Gewinne des Cups für Platz 1–3 („Pokal“, „Medaille“, „Urkunde“ – Testwerte aus dem Aufbau), Status offen |
| Turnierleitung (Handy, privates Fenster) | Als Platz-1-Spieler anmelden (Name aus dem TV, Konto `spielerNN@abnahme.lionsquad.at` laut Seed) und die Turnierseite öffnen | einmal die Karte „Champion“ mit **Teilen** und **Turnierbaum**; beim zweiten Öffnen nicht mehr |

---

## 14. Abschluss und Befunde

| Wer | Was | Erwartung |
| --- | --- | --- |
| Turnierleitung | Abhakliste durchgehen: jeder Punkt abgehakt oder mit Notiz | nichts offen ohne Notiz |
| Turnierleitung | Bilder von App, Web und TV für die Doku (nur Testdaten, keine echten Namen) | im Ordner der Abnahme |
| Claude | Je Befund ein Issue im Meilenstein „Turniersystem I“ (Blocker zuerst), danach nur Fixes bis zum Event | Liste der Issues an die Turnierleitung |
| Claude | `adb reverse --remove-all`; den Stand `lsw-abnahme` laufen lassen (für die Fixes) oder `stop` | Handy wieder normal |

---

## Bekannt aus dem Testlauf (19.10.)

Das Drehbuch lief einmal ganz gegen einen eigenen Stand (`lsw-abnahme-1635`): Aufbau, 15 Anmeldungen über den QR-Code,
Begleitperson am Handy (375 px), Warteliste und Nachrücker, Check-in, Check-in-Ende, Planen und Übernehmen, Start,
Aufrufen und Gestartet in der Oberfläche, Ergebnis mit Rückgängig, Show-Auslosungen mit TV-Moment, Austritt, „nicht
erschienen“, alle 14 Läufe bis zum Grand Final, Veröffentlichen, Sieger-Moment, Sofort-Cup, Spieler-Meldung mit
„Stimmt“, Fast Lap mit „Am Start“ und Bestzeit-Moment am TV – ohne Konsolenfehler und ohne Antwort 4xx/5xx. Dabei
aufgefallen (in diesem Drehbuch schon berücksichtigt):

- Das Handy erreicht den Stand nicht übers WLAN (Sicherheitsrichtlinie, Abschnitt 1) – deshalb `adb reverse`.
- Check-in-Ende und Fristen laufen im Abnahme-Stand nicht von selbst – deshalb `checkin-ende` und `fristen`.
- Wer vor der Planzeit aufruft, sieht „antreten bis <Planzeit>“, aber „nicht erschienen ab <Aufruf + Frist>“, und ein
  bereites Spiel wartet hinter einer belegten Station – deshalb in Phase 5 den Turnierstart stellen.
- Die Auslosung der ersten Loser-Runde heißt am TV-Moment und in der Warteschlange „Loser Runde 2“, im Baum steht die
  Spalte „Loser Runde 1“ (ebenso der letzte Loser-Lauf LF: „Loser Runde 5“ gegenüber „Loser Runde 4“ im Baum).
- Der Umbauplan beim Austritt sagt „1 Spiele betroffen“.
- Stationen mit Namen „Switch 1“ und Gerät „Switch 2“ heißen in der Warteschlange „Switch 1 · Switch 2“ – der Aufbau
  nennt sie darum „Station 1–4“.

## Bekannt aus Durchlauf 2 (20.10.)

Die Generalprobe lief ein zweites Mal mit allen Fixes. Ins Drehbuch übernommen:

- Phase 1: Die Aufruf-Tafel braucht einen Event-Schlüssel, weil der Cup „Nur Mitglieder“ ist.
- Phase 2: 15 Anmeldungen im selben Moment (`anmelden --gleichzeitig`) – vorher warteten sie bis zu 12 Sekunden (#1859).
- Phase 3: Der Check-in öffnet laut Aufbau erst nach 20 Minuten; die Turnierleitung startet ihn selbst.
- Phase 5: Die Mindestpause von 5 Minuten verschiebt Runde 2 nach hinten – gewollt.
- Phase 8: Beide Show-Auslosungen sofort losen, bis #1858 behoben ist (sonst blockiert ein wartender Loser-Lauf die
  freien Stationen). Kasten „Auslosung“ und Fall „Nicht erschienen?“ nennen den Baumteil (#1860).
- Phase 10: Der Lasttest misst nur allein auf dem PC Verlässliches.
- Phase 13: Der Aufbau setzt Gewinne für Platz 1–3, sonst legt das Veröffentlichen keine an.

## Bekannt aus Durchlauf 3 (21.10.)

Die Generalprobe lief ein drittes Mal (Stand 1.17.0, eigener Stand `lsw-abnahme-gp3`). Ins Drehbuch übernommen:

- Phase 2: Jede Anmeldung geht über das Bestätigungs-Blatt (#1261), auch „Mitspielen“ in der schlanken Vor-Ort-Ansicht.
- Phase 6: „Turnier starten“ vor der Planzeit zeigt öffentlich und auf der Hallen-Tafel „Läuft“ (#1881, #1888).
- Phase 8: #1858 ist behoben – die zweite Auslosungskarte bleibt liegen, die bereiten Läufe sind derweil aufrufbar; nach
  3 Minuten Erinnerung, nach 6 Minuten lost der Server. Der Job liest höchstens 200 laufende Turniere: auf einem Stand
  mit sehr vielen Seeds erreicht er den Cup nicht (darum in Phase 0 frisch bauen).
- Phase 9: `station --nur-aufrufen` überspringt schon aufgerufene Läufe; ruft man vor der Planzeit auf, gilt „nicht
  erschienen“ erst ab der Planzeit.

# Umbauplan: Turniere, Übersichtlichkeit und die offenen Wünsche

Stand: 15. September 2026, abends (App 0.4.0-beta vorbereitet, Build 61 noch nicht gebaut;
Web: Profil I begonnen, #253 umgesetzt).

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
| 10 | **Spielwochen und Terminfindung** | umgesetzt | #189 |
| 11 | PDF-Ausgabe | umgesetzt | #193, #194 |
| 12 | Galerie und Medien: Tempo, Videos überall | umgesetzt | #196 |
| 13 | Entflechtung: `tournament_routes.py` aufgeteilt | umgesetzt | #200 |
| 14 | LionsAPP in den Store | in Arbeit: 14.1 bis 14.4 umgesetzt, v0.3.1-beta (Build 60), v0.4.0-beta (Build 61) und v0.4.1-beta (Build 62) und v0.5.0-beta (Build 63) veröffentlicht | #201, #206, #207, #208, #209, #220, #237, #262, #264, #286, #304, #306 |
| 15 | Abschluss: Abfrage-Intervalle im Web weg, große Dateien nebenbei teilen | #221 umgesetzt, #223 offen | #261 |
| 16 | **Turnier-Leitfaden im Adminbereich** | offen (#228) | — |
| 17 | **Markenbilder hell und dunkel überall richtig** | teilweise (#229) | #193, #195 |
| 18 | **Auszeichnungen: Banner und Trophäen** | offen (#230) | — |
| 19 | **Web-Profil: Aufbau, Nachrichten, Dashboard** | umgesetzt: Profil I (#253, #257, #258) und Profil II (#254, #255, #256, #259); Nachtrag Kopfzeile und Mitgliederbereich (#282, #283, #284 umgesetzt) | #267, #275, #276, #278, #279, #280, #281, #285, #294, #298 |
| 20 | **Dynamik im Web: Startseite, Turnierseiten, Ladezustände** | offen (#224, #225, #226) | — |
| 21 | **Admin-Tageszentrale erweitern** | offen (#227) | — |
| 22 | **Tempo und Betrieb: Bilder über nginx, Messung, Fehler- und Tempo-Logs, Auto-Checks, Alarme** | umgesetzt: #232, #233 Teil 1, #265 Betrieb II | #263, #266, #299 |
| 23 | **Rollen und Rechte: Bereiche statt Rangfolge** | umgesetzt: #287 Zielbild und Matrix, #288 Turnierleitung ohne Redaktion, #289 Redaktion, #290 Vereinsvorstand, #291 Zwei-Faktor überall, #292 Rechte sichtbar | PR zum Meilenstein |

Reihenfolge ab hier, abwechselnd App und Web, damit beides vorankommt: 14.4 → 15 → 22 → 14.5 →
19 → 14.6 → 20 → 14.7 → 21 → 16 → 14.8 → 17 (Rest) → 18. Block 22 steht früh, weil die
Langsamkeit im Handy-Browser heute stört und weil die Fehler-Logs jeden weiteren Block
absichern. Der klassische Leseweg (#231) läuft als eigener kleiner Schritt dazwischen, sobald
der Trockenlauf auf dem Server wiederholt ist.

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

**Umgesetzt mit #196.** Bilder gibt es in drei Breiten (400, 800, 1600 px). Sie entstehen
beim ersten Abruf, auch für alles, was schon hochgeladen ist; zu migrieren war nichts.
Videos spielen im Raster nicht mehr von selbst, sondern zeigen ein Standbild. Das Standbild
erzeugt der Browser beim Hochladen, der Container braucht dafür kein ffmpeg.

Noch nicht geprüft: ob die App die Bildbreiten und Standbilder schon nutzt. Das gehört zu
Block 14. Was eure echten Bilder wiegen, zeigt nach dem Ausrollen `scripts/media-report.py`
(siehe [Was von dir kommen muss](#was-von-dir-kommen-muss)).

## Block 13 — Entflechtung

Die großen Dateien, die Änderungen langsam und riskant machen:

| Datei | Zeilen | Lohnt sich das Aufteilen? |
| --- | --- | --- |
| `backend/routes/tournament_routes.py` | 3653 | **Ja. Erledigt**, siehe unten |
| `frontend/src/pages/admin/AdminTournamentEditPage.jsx` | 2175 | **Nebenbei**, wenn ohnehin daran gearbeitet wird |
| `frontend/src/pages/admin/AdminSettingsPage.jsx` | 2101 | **Eher nicht.** Unabhängige Reiter, die selten gemeinsam geändert werden |
| `frontend/src/pages/user/ProfilePage.jsx` | 1803 | **Eher nicht**, aus demselben Grund |
| `backend/routes/news_routes.py` | 1453 | **Eher nicht** |

Aufteilen bringt dir als Betreiber **nichts Sichtbares**. Es senkt das Risiko künftiger
Änderungen, mehr nicht. Deshalb wurde nur `tournament_routes.py` aufgeteilt: Jeder
verbleibende Block fasst sie an. Die übrigen Dateien werden nur angefasst, wenn ohnehin
dort gearbeitet wird.

### Wie die Turnierrouten jetzt liegen

| Modul | Inhalt |
| --- | --- |
| `tournament_crud_routes.py` | Turniere anlegen, auflisten, ansehen, ändern, löschen |
| `tournament_registration_routes.py` | Anmeldungen, Check-in, zuweisbare Nutzer |
| `tournament_structure_routes.py` | Turnierbaum planen, übernehmen, neu aufbauen, zurücksetzen |
| `tournament_lifecycle_routes.py` | Status wechseln, sperren, entsperren |
| `tournament_stage_routes.py` | Phasen und Matches des Graph-Systems |
| `tournament_view_routes.py` | Turnierbaum-Anzeige, Spieltage, Tabelle, Planungsprüfung, Spielplan-CSV |
| `tournament_chat_routes.py`, `tournament_staff_routes.py`, `tournament_format_routes.py` | Chat, Turnierteam, Schweizer System und Gruppen |
| `tournament_common.py` | Helfer, die mehrere Module brauchen |

Alle Endpunkte hängen an **einem** gemeinsamen Router (`tournament_router.py`).
`tournament_routes.py` importiert nur noch die Module. Die Routentabelle ist vor und
nach dem Umbau identisch: 46 Endpunkte, keine Route verdeckt eine andere, und keine
hängt von der Reihenfolge ab.

Für künftige Tests gilt: **Ein Patch gehört an das Modul, in dem die Funktion nachschlägt.**
`tournament_routes.py` reicht bewusst keine Helfer mehr durch. Ein Patch am falschen Ort
scheitert laut, statt still daneben zu greifen.

Beim Umbau aufgefallen und **bewusst nicht entfernt**, weil ein Umzug nichts löschen soll:
`_rebuild_checkin_bracket_after_staff_change` (mit `_legacy_match_can_be_rebuilt`) und
`MATCH_PLAN_ACTIVE_STATUSES` werden nirgends aufgerufen. `_competition_engine` und
`_can_create_initial_legacy_preview` benutzen nur noch Tests.

## Block 14 — LionsAPP in den Store

- Chat: **Tastatur, Emojis, Bilder, Videos, Sticker** und Einfügen müssen sauber funktionieren.
  **Keine GIFs**, entschieden am 14.09.2026: kein externer Anbieter ([#202](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/202)).
- **Animationen** und **Achievements** in der App.
- Umstellung der App vom Abfragen (Polling) auf den bestehenden **SSE-Änderungsstrom**.

| Schritt | Was | Stand |
| --- | --- | --- |
| 14.1 | Live statt Abfragen, auch für private Meldungen | umgesetzt (#201) |
| 14.2 A | Chat: Bilder und Videos, geschützt abgelegt, Backend und Web | umgesetzt (#206) |
| 14.2 B | Chat in der App: Bilder und Videos senden und ansehen | umgesetzt (#207) |
| 14.2 C | Sticker: Startpaket und eigene Pakete aus dem Adminbereich, in Web und App | umgesetzt (#208) |
| 14.3 | App-Feinschliff I: Tastatur-Fehler im Chat, Rohbegriffe, Uhrzeiten (#210, #211) → `0.2.1-beta` | umgesetzt (#220) |
| 14.4 | App-Feinschliff II: Startseite, Profil, „Mehr“, Teams (#212–#215) → `0.3.0-beta` | umgesetzt (#237, Build 59) |
| 14.5 | Erfolge mit Symbolen, Fortschritt, Freischalt-Moment; sanfte Übergänge (#218) | offen |
| 14.6 | Kalender in App und Web, „In meinen Kalender“ (#216) | offen |
| 14.7 | Fingerabdruck-Sperre und Passkey-Login in der App (#217) | offen |
| 14.8 | Store-Reife: Play Internal Testing, Absturzberichte, Bildgrößen (#219) | offen |

Die Nummern sind die Reihenfolge: zuerst der Fehler und die Texte als kleine Version, dann der
Umbau der vier Hauptseiten, danach die neuen Funktionen, zuletzt der Store. Grundlage sind die
Screenshots und das Feedback vom 15. September (siehe „Neu aufgenommen am 15. September“).

### Was 14.1 gefunden hat

Der Änderungsstrom kannte nur „öffentlich“ und „Staff“. Direktnachrichten, Team-Chat und
Benachrichtigungen sind nicht öffentlich. Ein normales Mitglied bekam davon deshalb **nie**
eine Live-Meldung, weder in der App noch im Web. Das Web hat die Lücke mit Intervallen
überdeckt: Direktnachrichten alle 8 s, Glocke alle 30 s.

Jetzt gibt es gezielte Meldungen. Nur die Beteiligten bekommen sie, Staff nicht, und sie
nennen nur die Art der Änderung: keinen Text, keine Kennung.

| Ansicht in der App | vorher | jetzt |
| --- | --- | --- |
| Benachrichtigungen | alle 5 s abgefragt | sofort |
| Chats (direkt, Team, Turnier) | alle 7 s | sofort |
| Dashboard, Match, Turnierdetail | alle 10 s | sofort |
| Turnierliste | alle 30 s | sofort |

Ohne Verbindung (kein Netz, Server startet neu) fragt die App wie bisher ab. Im Hintergrund
ist der Strom geschlossen; beim Zurückkehren laden offene Ansichten einmal neu.

Nicht in 14.1: Einige öffentliche Turnierseiten im Web fragen zusätzlich im Intervall ab,
obwohl sie am Strom hängen. Das Aufräumen gehört zu Block 15.

### Was 14.2 A gefunden hat

Alle Uploads lagen bisher im öffentlichen Ordner und waren unter `/api/static/uploads/…`
**ohne Anmeldung** abrufbar. Für Galerie und Banner ist das richtig, für Bilder aus privaten
Chats nicht. Chat-Anhänge liegen deshalb in einer eigenen Ablage und kommen nur über
`/api/chat-attachments`, nach derselben Prüfung wie der Chat:

| Chat | Wer den Anhang sehen darf |
| --- | --- |
| Direktnachricht | nur die zwei Beteiligten |
| Team-Chat | Teammitglieder |
| Turnier-Chat | Teilnehmer und Turnierleitung |
| Match-Chat | wer das Match sehen darf; bei öffentlichen Turnieren wie der Chat selbst öffentlich |

Wer keinen Zugriff hat, bekommt „nicht gefunden“, damit nicht einmal die Existenz eines
Anhangs erkennbar ist. Hochgeladene, aber nie gesendete Anhänge verschwinden nach 24 Stunden.

Dabei fiel eine Datenschutzlücke auf: Die Kontolöschung anonymisierte Direkt-, Team- und
Match-Chat, **aber nicht den Turnier-Chat**. Behoben; Anhänge verschwinden jetzt mit.

Grenzen (per Umgebungsvariable änderbar): Bilder bis 25 MB vor dem Verkleinern, Videos bis
100 MB, höchstens 4 Anhänge pro Nachricht. Die Videolänge lässt sich nicht prüfen, weil es im
Container kein ffmpeg gibt; das Standbild erzeugt der Browser.

### Was 14.2 B umfasst

Dieselben Anhänge in **allen Chats der App**: Direktnachricht, Team, Turnier und Match.

- **Senden:** Bilder und Videos aus der Galerie auswählen, bis zu vier auf einmal. Jede Datei
  wird sofort hochgeladen. Zu große Dateien (Bild über 25 MB, Video über 100 MB) fallen schon
  auf dem Gerät auf. Das Standbild eines Videos entsteht auf dem Handy.
- **Ansehen:** Bilder erscheinen in der 800-px-Fassung; antippen öffnet sie groß. Videos
  spielen nach dem Antippen im Vollbild. Jede Quelle trägt die Anmeldung, sonst liefert der
  Server private Anhänge nicht aus.
- **Bewusst nur Galerie, keine Kamera:** Die App fragt nicht nach Kamera- und
  Mikrofonzugriff, auf Android werden diese Rechte ausdrücklich entfernt. Fotografieren und
  dann auswählen geht trotzdem.

Dafür kommen drei native Module dazu: `expo-image-picker`, `expo-video` und
`expo-video-thumbnails`. Auf dem Handy wirkt das erst mit einer **neuen APK**. Wie diese
lokal gebaut und hochgeladen wird, beschreibt `mobile/RELEASES.md` (#205). Lokal geprüft ist, dass Metro die App
mit den neuen Modulen für Android bündelt (`expo export`).

### Was 14.2 C umfasst

Sticker in **allen Chats**, im Web und in der App. Wie im Messenger geht ein Sticker allein
raus: antippen, fertig. GIFs gibt es bewusst nicht.

- **Startpaket:** 71 Sticker aus Microsoft Fluent Emoji (3D) in vier Paketen: Reaktionen,
  Hände, eSports & Party, Symbole. Lizenz MIT; der Lizenztext liegt bei den Bildern und ist
  im Adminbereich verlinkt.
- **Eigene Pakete:** unter *Admin → Content → Sticker* anlegen, Bilder hochladen oder aus der
  Mediathek wählen, Suchwörter vergeben. Eigene Pakete stehen in der Auswahl vorn. Das
  Startpaket lässt sich paketweise abschalten, aber nicht ändern.
- **Suche** nach Name und Suchwort; Umlaute muss man nicht tippen.
- **Alte Nachrichten bleiben lesbar:** Die Nachricht speichert den Sticker mit. Ist ein Paket
  abgeschaltet oder ein Sticker gelöscht, lässt er sich nicht mehr senden, steht aber weiter
  im Verlauf. Benachrichtigungen zeigen „[Sticker]“.

Die Bilder des Startpakets liefert das Backend unter `/api/stickers/files/…` aus, mit sieben
Tagen Browser-Cache. So gilt dieselbe Adresse im Web und in der App. Eigene Sticker kommen nur
aus dem eigenen Upload: Eine fremde Adresse lehnt der Server ab, sonst würde jedes Anzeigen
die Chatteilnehmer bei Dritten abrufen lassen. Die App braucht dafür kein neues natives Modul.

Dabei gefunden: **Team- und Turnier-Chat in der App luden ohne Pause neu.** Die Chat-Ansicht
erzeugte bei jedem Rendern eine neue Standardfunktion. Dadurch entstand ein neues `load`, und
nach jeder Serverantwort wurde sofort wieder geladen. Direktnachrichten waren nicht betroffen.
Gesehen im Test, als der Mock wie ein echter Server neue Antworten lieferte; auf dem Gerät
nicht gemessen, im Code aber eindeutig. Behoben, und ein Test prüft jetzt, dass beim Öffnen
genau einmal geladen wird.

### Was 14.3 gefunden hat

**Warum die Chat-Eingabe schwebte.** Die Eingabezeile hing in einer `KeyboardStickyView`, die
sie um die volle Tastaturhöhe nach oben schiebt. In der Tab-Ansicht endet der Bildschirm aber
über der Tab-Leiste, und die Nachrichtenliste dahinter bekam nur den Abstand der Eingabezeile.
Jetzt stehen Liste und Eingabezeile in einem Block, der bei offener Tastatur genau um die
überdeckte Höhe eingerückt wird; die Bibliothek misst dafür die Lage am Bildschirm. Der
Match-Chat nutzte noch die Tastatur-Ansicht von React Native, die auf Android nichts tat, und
bekommt dieselbe Lösung. Ob es am Gerät passt, zeigt erst Build 58.

**Rohwerte auch im Web.** Ältere Events tragen den Typ `clubevening` statt `club_evening`.
Die Webseite zeigte dafür ebenso den Rohwert wie die App; beide legen solche Schreibweisen
jetzt auf den bekannten Begriff. News-Kategorien standen im Web auf fünf Seiten roh.

### Was 14.4 gefunden hat

**Die Startseite zeigte Vergangenes.** `/api/mobile/dashboard` lieferte alle eigenen Turniere
und Events, auch abgeschlossene und abgesagte; deshalb stand „Meine nächsten Termine“ voll
mit alten Einträgen. Das Backend filtert jetzt auf heute und später (Wiener Zeit) und liefert
die Jahreswertung als Kurzfassung mit, damit die Startseite sie ohne zweiten Aufruf zeigt.

**Der Discord-Link in „Mehr“ war falsch.** Er stand fest im Code (`discord.gg/thelionsquad`).
Die App holt die Vereinskanäle jetzt aus `/api/settings/public`, denselben Daten wie der
Web-Footer; wer im Adminbereich einen Kanal ändert, ändert ihn damit auch in der App.

**Die Einstellungen im Profil speicherten erst auf Knopfdruck.** Unter 24 Schaltern stand ein
„Speichern“-Knopf, den man leicht vergaß; die Schalter speichern jetzt kurz nach dem letzten
Tipp von selbst.

**Tests für Bildschirme.** Die Testbibliothek der App (Version 14) macht `render` und
`fireEvent` asynchron; ohne `await` ist der Baum beim ersten Zugriff noch leer und die Meldung
(„render function has not been called“) führt in die Irre. Die neuen Tests für „Mehr“ und
Teams sind die Vorlage für weitere Bildschirm-Tests.

### Was 14.5 gefunden hat (App 0.5.0-beta: #249, #250, #251, #277, PR #304)

**Das Repo ist privat – die App kommt nicht an GitHub.** Deshalb hält der Vereinsserver je Build
eine Kopie der APK und liefert sie angemeldeten Nutzern; das Release-Skript legt sie nach dem
Veröffentlichen ab (Token aus der Server-Umgebung, nie im Repo), sonst der Admin von Hand unter
System → App-Versionen. Die App prüft Größe und MD5 – SHA-256 kann `expo-file-system` auf einer
Datei nicht rechnen, MD5 schon – und öffnet den Android-Installer über einen Intent. Für das
Installieren aus einer fremden Quelle fragt Android einmal nach (`REQUEST_INSTALL_PACKAGES`).

**„Was ist neu“ ohne Server.** Der Changelog-Abschnitt der Version wird beim Versionssprung in
die App gebündelt (`src/whatsnew.json`); der Preflight bricht ab, wenn die Datei veraltet ist.
Die Karte erscheint genau einmal nach einem Update – beim allerersten Start nicht, da kennt
niemand „neu“.

**Banner waren Stapel.** Drei Meldungen lagen übereinander und blieben stehen. Jetzt ein Banner,
gebündelt („2 neue Benachrichtigungen“), fünf Sekunden, wegwischbar; im offenen Chat mit
derselben Person kommt keiner – die Nachricht steht ja schon da. Die Entscheidungen liegen in
`lib/popups.ts`, damit sie ohne Gerät testbar sind.

**Nickname weg** wie im Web (#258): ein Anzeigename, ein Satz dazu.

**Der erste echte Upload scheiterte mit 401 (#305).** Das Token stand in der Server-`.env`, aber
`docker-compose.yml` reicht nur aufgezählte Variablen an den Backend-Container weiter – die neue
fehlte dort. Behoben in #306; dazu `npm run release:local -- --upload-only`, das die zuletzt
gebaute APK ohne neuen Build nachreicht. Lehre: eine neue Umgebungsvariable braucht drei
Stellen – `.env.example`, `docker-compose.yml`, `update.sh`-Hinweis – und einen Test durch den
Container-Lauf, nicht nur durch die Anwendung.

## Block 15 — Abschluss

Alle CI-Prüfungen grün, automatischer App-Build, README auf Stand. Seit dem 15. September läuft
die Arbeit nach Issues mit Meilensteinen (siehe „Meilensteine“ unten); Block 15 sind die Issues
#221 (Abfrage-Intervalle) und #223 (große Admin-Dateien).

### Was 15.1 gefunden hat (#221, PR #261)

**Der Strom und der Takt liefen nebeneinander.** 19 Ansichten im Web hatten ein eigenes
`setInterval` (6 bis 60 Sekunden) *und* hingen am Änderungsstrom – jede Änderung wurde
doppelt geladen, und ohne Änderung fragte jede offene Seite trotzdem alle paar Sekunden nach.
Jetzt gibt es einen Hook `useLiveRefresh` wie in der App: laden bei passender Änderung, im Takt
nur, solange die Verbindung zum Strom fehlt, und einmal nachladen, wenn sie wieder steht. Die
Brücke zum Strom meldet dafür erstmals, ob sie verbunden ist. Reine Uhren, der Wechsel der
TV-Ansichten und die Update-Prüfung des Service Workers bleiben bei `setInterval`; sie fragen
keinen Server.

**Twitch ist der Ausnahmefall.** Ob ein Kanal live ist, erfährt der Server nur durch eigenes
Nachfragen; der Strom meldet nur Änderungen aus dem Adminbereich. Der Live-Stream-Slider fragt
deshalb weiter einmal pro Minute – als `pollMs` im selben Hook, damit die Ausnahme sichtbar ist
und im versteckten Tab ruht.

**Die Admin-Einstellungen hatten zwei Wege zum selben Laden.** `useApiInvalidation` für
`settings` plus ein Takt auf den Reitern Warteschlange und Twitch. Jetzt ein Hook, dessen
Rückfall-Takt nur auf diesen Reitern aktiv ist. Die Datei hat weiter 2.100 Zeilen – #223 bleibt
eigener Schritt.

## Meilensteine

Angelegt am 15. September, jedes offene Issue hängt an einem. App-Issues sammeln sich je
Version und werden zusammen als Beta veröffentlicht.

| Meilenstein | Inhalt |
| --- | --- |
| App 0.3.1-beta | Nur Fehler aus Build 59: #246 Rohwerte II, #247 Umbrüche im Profil, #252 Referenzen leer (#262, Build 60); #238 Bild schwarz bekommt damit einen sichtbaren Fehlergrund und bleibt offen |
| App 0.4.1-beta | #238 Chat-Bild: seit Build 61 steht der Grund in der Kachel („Unexpected HTTP Code“); #286 holt das Bild über den API-Client und nennt sonst den HTTP-Status – Build 62 veröffentlicht (16.09.) |
| App 0.4.0-beta | Seiten aufräumen II: #241 Events-Tab, #242 Mehr/Gaming, #243 eigene Seiten, #244 Sponsoren, #248 Startseite II (#264; Build 61 noch nicht gebaut) |
| App 0.5.0-beta | Tester-Komfort: #249 „Was ist neu“, #250 Update aus der App, #251 In-App-Banner, #277 Nickname-Feld weg – umgesetzt in #304, Build 63 nach Merge und Server-Update |
| App 0.6.0-beta | #218 Erfolge (14.5): Symbole, Fortschritt zugeklappt, Freischalt-Moment bei offener App, sanfte Übergänge – umgesetzt in #354, Build 64 |
| App 0.7.0-beta: Mitgliederbereich | #340 Einstieg und Aufbau wie im Web, #339 Meine Mitgliedschaft mit Beitragsstand und Belegen, #341 Vereinsdokumente (privater App-Speicher), #342 Intern-Kennzeichen und Meldungen nur an Berechtigte, #346 digitale Mitgliedskarte mit QR-Code (Web und App) – umgesetzt in #357, Build 65 (Block 27) |
| App 0.8.0-beta | #216 Kalender (14.6), #236 Galerie – umgesetzt in #374 (Block 33), Build 66 nach dem Merge |
| App 0.9.0-beta | #240 Freunde, #245 Laufbanner – umgesetzt in #377 (Block 35), Build 67 am 23.09. gebaut; #239 Tastatur-Sticker bleibt offen (natives Modul) |
| App 1.0.0 | #217 Stufe 1 App-Sperre und #219 Teil 1 (AAB-Option, Bilder in passender Breite) – umgesetzt in #380 (Block 38), Build 69 nach dem Merge; Stufe 2 Passkey in der App (14.7) wartet auf den Server-Teil; der Rest von #219 (14.8) wartet auf das Play-Console-Konto |
| Web: Anmeldung und Teilen | Block 26, Wünsche des Betreibers vom 21.09.: #348 angemeldet bleiben, Passkey anbieten, Zwei-Faktor für alle einrichtbar; #347 neutrale Link-Vorschau für Vereinsinhalte – umgesetzt in #353 |
| Web: Tempo und Betrieb | Block 15 und 22: #221, #232, #233, #265 (#299) umgesetzt; #223, #231 offen; dazu #310 Livestreams der Mitglieder fehlen auf der Startseite (Bug vom 16.09.) |
| Web: Profil I – Aufbau | Block 19: #253 Layout für PC/Tablet/Handy (#267: Seitenmenü, volle Breite, eine Datei je Reiter, umgesetzt), #257 Privatsphäre und Benachrichtigungen (#275, umgesetzt), #258 Grunddaten und Sicherheit (#276, umgesetzt) – Meilenstein abgeschlossen |
| Web: Profil II – Nachrichten und Dashboard | Block 19: #254 Inbox als Chat (#278, umgesetzt), #255 Benachrichtigungen anklickbar (#279, umgesetzt), #256 Dashboard (#280, umgesetzt), #259 Freunde (#281, umgesetzt; #222 ist darin aufgegangen) – Meilenstein abgeschlossen |
| Web: Mitgliederbereich und Kopfzeile | Nachtrag zu Block 19 aus dem Betreiber-Test vom 16.09.: #282 Benutzermenü im Kopf, Weg ins Profil (#285, umgesetzt), #283 „Interne Events“ aus der Event-Liste statt Platzhalter (#285, umgesetzt), #284 Mitgliederbereich aufräumen (#298, umgesetzt) – Meilenstein abgeschlossen |
| Dolibarr I: Anbindung und Mitgliedschaft | Hieß bis 21.09. „Mitgliederbereich II: Dolibarr“. Block 24: #295 Mitgliedschaft und Beitragsstand automatisch, #297 Vereinsrechte aus Funktionen – umgesetzt in #338, zusammen mit dem ersten Teil von #316 (Adapter, Konto-Zuordnung) und #330 (Vertragstests, Vorschau, Anleitung) |
| Dolibarr II: Eigene Rechnungen und PDF | Block 24.3: #296 eigene Rechnungen mit PDF und Zahlungsweg, #325 PDF-Betrachter – umgesetzt in #356 |
| Abrechnung I: Grundlage und Events | Epic #314. Teil 1 in #363 (Block 29.1): #315, #318. Teil 2 in #365 (Block 29.2): #316 Kunden, #317 Belege ohne Dubletten, Stand zurücklesen. #370 Konditionen und Belegtexte in #372 (Block 32). #320 eigene Rechnungen für alle in #381 (Block 39). Offen: #321 im Detail |
| Abrechnung II: Turniere | Block 31: #319 Startgelder für Solo- und Team-Anmeldungen – umgesetzt in #371; damit schließt das Epic #314 |
| Dolibarr III: Dokumente, Vereinsseiten, Mitgliedschaft online | #324 Dokumente, #326 Vereinsdaten, Vorstand und Statuten, #328 Beitrittsantrag, #329 Einwilligungen, eigene Daten, Austritt – wartet auf das Vereinsmodul (dolibarr-vereine#156–#158 und v0.7) |
| Discord I: Kanäle und Meldungen | Hieß bis 21.09. „Discord: Kanäle und Bot“. Block 25: #300 ein Webhook je Zweck mit Schaltern je Ereignis, #301 Erfolge sofort und gebündelt, #303 Meldungen mit Bild, Link und Vorschau – umgesetzt in #350 |
| Discord II: Konto-Verknüpfung und Bot | #260 Plattform-Konten verknüpfen – umgesetzt in #376 (Block 34); #302 Discord-Bot im Backend für Aktivitätszähler, Rollenabgleich und Befehle – umgesetzt in #378 (Block 36), Einrichtung durch den Betreiber im Admin |
| Web: Rollen und Rechte | Block 23: #287–#292 in einem PR umgesetzt – Meilenstein abgeschlossen |
| Web: Dynamik | Block 20: #224, #225, #226 – umgesetzt in #360 (Block 28) |
| Admin und Turniere | Block 16 und 21: #203, #204, #227, #228, #235 – umgesetzt in #369 (Block 30); #368 Leitfaden Schritt 2 – umgesetzt in #375 (Block 30.2) |
| Auszeichnungen und Marke | #229 Block 17 Rest – umgesetzt in #379 (Block 37), Build 68 nach dem Merge; #230 Block 18 Banner und Trophäen – wartet auf die drei Entscheidungen aus Block 18 (Kommentar an #230) |
| Später | Ohne Termin: #309 GitHub-Releases automatisch abgleichen; #323 Preisgelder, #327 Generalversammlung und Stimmabgabe, #331 Helferdienste – die drei warten auf das Vereinsmodul („Später“ bzw. v0.8) |

## Block 22 — Tempo und Betrieb

Zwei Issues: #232 (Bilder und Tempo) und #233 (Fehler- und Tempo-Logs, Auto-Checks, Alarme im
Adminbereich).

### Was 22.1 gefunden hat (#232, PR #263)

**Kein Browser durfte ein Bild behalten.** nginx reicht alles unter `/api/` an das Backend
weiter und hängt jeder Antwort `Cache-Control: no-store` an – auch den Bildern unter
`/api/static/uploads/…`. Jeder Besuch der Galerie lud also jede Kachel neu, auch am Handy
und auch, wenn man nur zurück und wieder vor ging. Das ist der größere Teil der
„Langsamkeit“, nicht die Bildgröße: die kleineren Fassungen gab es seit Block 12.

**Jedes Bild lief durch den einen API-Prozess.** Das Backend läuft mit einem Worker
(Voraussetzung für den Änderungsstrom); eine Galerieseite mit 40 Kacheln schickte 40
Dateiabrufe durch denselben Prozess, der auch alle Aufrufe und Live-Verbindungen bedient.

**Jetzt:** Das Upload-Volume hängt nur lesend auch im Web-Container. nginx liefert die
öffentlichen Uploads direkt von der Platte, 30 Tage im Browser-Cache (die Dateinamen sind
Zufallskennungen), mit Bereichsanfragen für Videos. Für `?w=400|800|1600` versucht nginx die
fertige Fassung; gibt es sie noch nicht, baut sie das Backend beim ersten Abruf wie bisher –
und neue Uploads bekommen ihre Fassungen sofort beim Hochladen. Der Kopf `X-TLS-Media`
sagt, wer geliefert hat (`nginx` oder `backend`); der Container-Smoke prüft das mit einem
echten Bild (`scripts/check-media-serving.py`).

**Messung** (lokaler Produktions-Stack, 40 Fotos mit 3000×2000 Pixeln, 8 parallel): Original
je Bild 0,07–0,11 s → 0,03 s; fertige 400er-Fassung je Bild 0,086 s → 0,003 s; `Cache-Control`
`no-store` → 30 Tage. Das Erzeugen einer Fassung beim ersten Abruf dauert in beiden Fällen rund
1 s je Bild (Rechenzeit) – deshalb entstehen sie jetzt beim Upload. Nebenbefund: `HEAD` auf ein
Bild lieferte vorher JSON (405), jetzt das Bild.

**Nicht geändert:** private Chat-Anhänge bleiben beim Backend (Zugriffsprüfung), ebenso
Dokumente. Bilder, die schmaler sind als die verlangte Fassung, liefert weiter das Backend
(es gibt dafür keine Datei); das betrifft Logos und kleine Grafiken.

### Was 22.2 gefunden hat (#233 Teil 1, PR #266)

**Server-Fehler standen nur in Container-Logs.** Wer im Web einen Fehler sah, musste am
Server `docker logs` lesen; nichts fasste gleiche Fehler zusammen. Jetzt fängt eine
Middleware jeden Fehler (Starlette packt ihn in eine `ExceptionGroup`, `unwrap_exception`
holt ihn heraus), bildet aus Fehlerart, Route, Methode und Stelle einen Fingerabdruck und
zählt gleiche Fehler als Gruppe in `ops_errors` (30 Tage). Admin → Betrieb zeigt die
Gruppen; jede lässt sich als erledigt markieren und ist beim nächsten Auftreten wieder offen.

**Langsame Anfragen waren unsichtbar.** Jede Anfrage über `SLOW_REQUEST_MS` (Standard 1 s)
landet mit Route und Dauer in `ops_slow_requests` (30 Tage) und erscheint unter Betrieb je
Route.

**Die Web-Fehlersammlung war standardmäßig aus.** Jetzt ist sie an; nur
`VITE_CLIENT_LOGGING="false"` schaltet sie ab (Compose: `CLIENT_LOGGING_ENABLED`, Standard
`true`).

**Offen als #265 (Betrieb II):** Web Vitals je Seite, Auto-Checks mit Ampel, Alarme per
Discord.

### Was 22.3 gefunden hat (#265, PR #299)

**Web Vitals brauchen keinen Dienst.** `web-vitals` misst im Browser, die Seite schickt am Ende
des Besuchs ein paar Zahlen per `sendBeacon` – Route als Vorlage, Wert, Geräteklasse, sonst
nichts. Kein Cookie, keine Adresse, kein Nutzer; wer Do Not Track gesetzt hat, sendet nichts.
Damit steht unter Betrieb → Vitals „/galerie/:slug am Handy: LCP p75 6,1 s“ statt eines Gefühls.

**Die Auto-Checks messen, was still kaputtgeht.** Datenbank-Latenz, freier Speicher, Upload-
Volume, Mail-Queue (hängende Sendungen), Änderungsstrom, fehlende Bildvarianten, offene
Fehlergruppen, Scheduler – alle fünf Minuten, sieben Tage Verlauf. Die Bewertung liegt getrennt
von der Messung, damit die Schwellen testbar sind. Die In-Memory-Datenbank der Tests kennt
kein `ping`; die Prüfung weicht dort auf ein Lesen aus.

**Nachtrag #310 (21.09., PR #337): Livestreams fehlten, und nichts sagte warum.** Das
Twitch-Client-Secret war weg; die Abfrage lief alle 90 Sekunden weiter und übersprang still
(„no credentials or disabled“ stand nur im Rückgabewert), im Twitch-Reiter stand trotzdem
nichts Rotes. Jetzt hält jeder Lauf sein Ergebnis fest – fehlt etwas, ist das Secret nicht mehr
lesbar, lehnt Twitch ab (mit HTTP-Status) – und die neunte Auto-Prüfung „Twitch-Abfrage“ zeigt
es gelb unter Betrieb. Antwortet Twitch einmal nicht, bleiben laufende Streams stehen; vorher
hätte eine Störung dort alle Streams beendet und die Minuten zu früh verbucht. Zweite stille
Stelle: Auf die Startseite kommen nur aktive Mitglieder, deren Mitgliederprofil mit dem
Plattform-Konto verknüpft ist. Die Regel steht jetzt einmal (`services/stream_visibility.py`),
und der Twitch-Reiter nennt je Kanal den Grund. Mitgliedschaft und Kontostatus sind
Vereinsdaten: den genauen Grund sieht nur die Vereinsverwaltung, die Redaktion liest „nicht
freigeschaltet“ – mit Test.

**Alarme über einen eigenen Webhook, gedrosselt.** Der erste Entwurf schickte Alarme über den
Community-Webhook – dort gehören nur News, Turniere und Erfolge hin (Einwand des Betreibers).
Jetzt gibt es in den Discord-Einstellungen einen zweiten, privaten Betriebs-Webhook; fehlt er,
gibt es keine Alarme, und auf den Community-Kanal fällt der Betrieb nie zurück. Rote Prüfungen
und neue 5xx-Gruppen gehen dorthin, höchstens eine Meldung je Schlüssel und Stunde. Die Fehlergruppen-Meldung läuft als Hintergrund-Aufgabe, damit der
Anfrage-Pfad nicht auf Discord wartet. Push an Admins bleibt aus – der Webhook reicht.

**p75 mit Interpolation.** Bei wenigen Messwerten liefert der nächste Rang (wie bei Tempo)
Sprünge; die Vitals rechnen linear zwischen den Rängen.

## Block 23 — Rollen und Rechte

Wunsch des Betreibers vom 16.09.: Wer welche Informationen bekommt und wer was darf, muss zu
100 % stimmen. Die Rechte-Matrix steht in `docs/ROLLEN.md`.

### Was 23.1 gefunden hat (#287–#292)

**Rangfolge statt Zuständigkeit.** Sechs Rollen in einer Leiter, vier Wächter: `require_admin()`
schützte 137 Routen – Turniere genauso wie News, Galerie und Sponsoren. Eine Turnierleitung
konnte die Startseite umschreiben; wer Dokumente pflegen sollte, brauchte den Club-Admin samt
Einstellungen und Game-Servern. Eine Redaktionsrolle gab es nicht, „Vorstand“ war ein Freitext.

**Bereiche.** Turnierleitung, Redaktion, Vereinsverwaltung, System, Moderation. Die Rollen
bleiben als Grundstufe; dazu kommen Freigaben je Person (Superadmin, mit Audit) und der
Vorstand: wer einen aktiven Posten hält oder vertritt, hat die Vereinsverwaltung von selbst –
so wollte es der Betreiber, und so kann die Besetzung später aus Dolibarr kommen (#297).
System lässt sich nicht freigeben.

**Zwei-Faktor fehlte genau bei den sensibelsten Daten.** `require_club_admin()` prüfte keine
Zwei-Faktor-Anmeldung, `require_admin()` schon: Mitglieder, Dokumente und Einstellungen waren
schwächer geschützt als Turniere. Jetzt gilt sie für jeden Bereich außer Moderation, auch für
die PDF-Exporte.

**Pro Turnier gab es das Modell schon.** Staff-Zuweisungen mit organizer, referee,
scorekeeper … – ohne globale Rolle. Neu: ein organizer verwaltet auch die Gewinne seines
Turniers, fremde nicht.

**Sichtbar machen.** Das Adminmenü zeigt nur, wofür ein Bereich da ist; die 403-Seite und die
Antwort des Servers nennen den fehlenden Bereich und wer ihn vergibt; „Alle Benutzer“ sagt je
Rolle „darf / darf nicht“. Die Rolle `team_leader` prüfte nie etwas – Teamleitung läuft pro
Team –, sie ist weg, bestehende Konten wurden per Migration Spieler.

## Block 39 — Abrechnung I, Teil 3: Eigene Rechnungen für alle

### Was 39.1 gefunden hat (#320 – PR #381)

**„Meine Rechnungen“ gab es nur für Mitglieder.** Der Lesedienst aus #296 holte die Belege über das
Mitglied im Vereinsmodul. Wer kein Mitglied ist, aber ein Startgeld oder eine Event-Teilnahme
bezahlt, bekam „nicht zugeordnet“ – obwohl die Website die Rechnung selbst angelegt hatte. Der
Grund war kein Versehen, sondern eine Grenze: Ein Geschäftspartner in Dolibarr kann eine Familie
sein. „Alle Rechnungen des Geschäftspartners“ wäre zu viel gewesen.

**Die Website weiß, welche Belege wem gehören.** Jeder Vorgang (Block 29) trägt seinen Beleg. Genau
diese Belege – einzeln nachgelesen, nie der Geschäftspartner im Ganzen – bekommt ein Nicht-Mitglied
zu sehen, das PDF über Dolibarrs Dokument-API. Entwürfe gibt es nach außen nicht, gelöschte Belege
verschwinden, und was dem Konto nicht ausdrücklich zugeordnet ist, antwortet mit 404 wie ein
unbekannter Beleg. Online bezahlen geht dabei nicht – den Zahlungslink kennt nur das Vereinsmodul;
die Seite sagt das und verweist auf die Überweisung laut Rechnung.

**Jeder Beleg trägt seine Quelle.** Mitgliedsbeitrag, Event oder Turnier – mit Name, Datum,
Personen oder Team – steht am Beleg, in Web und App gleich; Filter nach Quelle und Stand gibt es
erst, wenn es mehr als eine Quelle gibt. Der Einstieg „Meine Rechnungen“ steht jetzt im Konto-Menü
für alle, in der App unter „Mehr → Konto“; der Mitgliederbereich behält seinen Link. Was #321
bleibt: Teilzahlung, Korrektur, Storno und Erstattung als eigene Vorgänge.

## Block 38 — App 1.0.0, Teil 1: App-Sperre, Bildgrößen, App Bundle

### Was 38.1 gefunden hat (#217 Stufe 1, #219 Teil 1 – PR #380)

**Die Sitzung bleibt gespeichert – also liegt die App offen da.** Wer sein Handy weitergibt oder
verliert, gibt Chats, Profil und Mitgliederkarte mit. Die Website hat Passkeys, die App hatte
nichts dergleichen. Stufe 1 braucht keinen Server: ein Schalter im Profil, und die App fragt beim
Start und nach einer Minute im Hintergrund nach Fingerabdruck, Gesicht oder Gerätesperre, bevor
sie etwas zeigt. Kurz in eine andere App wechseln bleibt ohne Frage – sonst nervt die Sperre, und
Nerven heißt: ausschalten.

**Sich aussperren muss unmöglich sein.** Einschalten verlangt einmal den Fingerabdruck – dann ist
bewiesen, dass die Methode am Gerät geht. Ohne eingerichtete Bildschirmsperre lässt sich der
Schalter nicht setzen, und eine gespeicherte Sperre gilt dann nicht (das Gerät wurde inzwischen
zurückgesetzt). „Abmelden“ geht auch gesperrt; danach ist nichts mehr zu schützen. Der Schalter
liegt nur am Gerät, nicht am Server – ein anderes Handy fängt bei „aus“ an.

**Stufe 2 bleibt offen.** Passkey-Login in der App selbst braucht ein natives Modul für den
Android Credential Manager, den APK-Schlüssel als erlaubte Herkunft im Backend und die Datei
`/.well-known/assetlinks.json` auf der Website – ein eigener Schritt mit dem Betreiber, weil der
Server-Teil ausgerollt werden muss.

**Nur die Galerie lud kleine Bilder.** Block 22 hat die 400/800/1600-Fassungen für alle Uploads
gebracht, aber in der App nutzten sie nur Galerie und Chat; Karten, Kacheln und Profilbilder holten
das Original – am Handy oft drei Megabyte für eine Kachel von 120 Pixeln. Statt jeden Aufruf
anzufassen, misst das Bild-Element sich jetzt selbst und lädt die kleinste Fassung, die seine
Fläche in Gerätepixeln füllt. Das gilt damit überall auf einmal, und ein neuer Bildschirm bekommt
es von selbst.

**Die Play Console nimmt keine APK.** Das Release-Skript baut auf Wunsch (`--aab`) zusätzlich das
App Bundle, signiert mit demselben Schlüssel, und hängt es ans GitHub-Release. Die APK bleibt für
den Vereinsserver und Sideload. Konto, Store-Eintrag und Absturzberichte sind Sache des Betreibers
– ohne Play-Console-Konto geht dort nichts weiter.

## Block 37 — Marke: Standard-Favicon und Markenbilder in der App

### Was 37.1 gefunden hat (#229 – PR #379)

**Der Standard-Favicon des Vereins war das weiße Maskottchen.** Die Fassungen für hell und dunkel
stimmen – aber Browser ohne Hell/Dunkel-Erkennung, Lesezeichen und der Home-Bildschirm nehmen nur
den Standard, und der war beim Verein dieselbe Datei wie die dunkle Fassung. Weiß auf einer hellen
Tableiste zeigt nichts. Statt ein drittes Bild zu verlangen, baut der Server auf Knopfdruck eine
Fassung, die überall trägt: das weiße Logo auf einem Kreis in der Akzentfarbe. Der Admin sagt
vorher, ob der Standard nur die dunkle Fassung ist. Das Ergebnis ist ein normaler Upload – in der
Medienliste, mit Varianten – und wird als Standard gesetzt; die hell/dunkel-Fassungen bleiben.

**Die App brachte ihre Marke fest mit.** Wordmark und Vereinsname standen im Code; ein neues
Logo in den Einstellungen hätte ein neues App-Update gebraucht. Jetzt holt die App Logo,
Maskottchen und Namen aus `/settings/public` – beim Start und live, wenn der Admin etwas
ändert – mit derselben Reihenfolge wie das Web (die App ist dunkel, also zuerst die Fassung für
dunklen Hintergrund). Fehlt ein Bild oder lädt es nicht, bleibt das eingebaute; der Boot-Screen
zeigt immer das eingebaute, weil er vor dem ersten Laden kommt. Ohne Netz ändert sich nichts.

## Block 36 — Discord II, Teil 2: Der Bot

### Was 36.1 gefunden hat (#302 – PR #378)

**Ein Bot ist ein Prozess, der immer läuft – und der Betreiber will keinen zweiten Server pflegen.**
Die naheliegende Lösung wäre ein eigener Container mit eigenem Token in der `.env`. Der Betreiber
hat sich am 22.09. für das Gegenteil entschieden: Der Bot läuft als Hintergrundaufgabe im
Backend, der Token liegt verschlüsselt in den Einstellungen und wird im Admin eingetragen wie das
Twitch-Secret. Eine Änderung startet den Bot neu, „Bot verbinden“ aus hält ihn an; `update.sh`
bleibt der einzige Weg auf den Server, und die `.env` bleibt, wie sie ist.

**Zählen heißt zählen, nicht lesen.** Für die Erfolge „Discord-Aktiv“ reicht die Zahl der
Nachrichten. Der Bot bekommt deshalb das Recht, Nachrichten zu lesen, erst gar nicht (Message
Content Intent aus); er merkt sich je verknüpftem Konto einen Zähler und einen Tageswert. Wer sein
Konto nicht verknüpft hat, existiert für den Bot nicht – das ist die Verbindung zu Block 34, und
sie ist auch die Datenschutzgrenze: Ohne eigene Anmeldung bei Discord wird nichts zugeordnet.

**Der Bot fasst nur seine drei Rollen an.** Mitglied, Vorstand, Turnierleitung kommen aus der
Website (Beitragsstand und Bereiche); alles andere im Discord – Moderatoren, Spiel-Rollen,
Farben – bleibt unberührt, auch beim Entfernen. Der Abgleich ist idempotent und läuft alle zehn
Minuten, damit ein Austritt oder ein neuer Vorstandsposten nicht Tage im Discord nachhängt. Fehlt
eine Rolle im Discord oder steht die Bot-Rolle zu weit unten, sagt der Stand-Kasten das, statt
still nichts zu tun.

**Befehle antworten mit dem, was die Website ohnehin öffentlich zeigt.** `/naechstes-event` und
`/turniere` nennen nur öffentliche Termine; `/meine-erfolge` und `/status` antworten nur dem, der
fragt, und nur mit verknüpftem Konto beziehungsweise Vorstandsrecht. Die reine Logik – welche
Rollen, was zählt, welcher Text – liegt ohne die Discord-Bibliothek in Funktionen und ist ohne
Netz getestet; die Bibliothek ist eine dünne Schale darum.

## Block 35 — App 0.9.0-beta: Freunde und Laufbanner

### Was 35.1 gefunden hat (#240, #245 – PR #377)

**Das Backend konnte alles, die App nichts davon.** Freundschaftsanfragen gab es seit #259 –
aber nur im Web. Die App bekommt den Knopf im öffentlichen Profil und die Karte „Freunde“ in
der Übersicht; der Zustand kommt vom Server, nie aus dem Text. Neu ist nur eins im Backend: Der
Änderungsstrom kennt „friends“ nicht als öffentliche Ressource, deshalb sagt jede Änderung jetzt
beiden Seiten je Nutzer Bescheid – sonst käme eine Anfrage erst beim nächsten Neuladen an.

**Ein Banner läuft dort, wo man ihn freigibt.** Bestehende Banner bleiben Website-only, damit
sich für niemanden etwas ändert; automatische Hinweise (Wartung, Anmeldung offen) laufen überall.
Die App fragt `?channel=app` und zeigt den wichtigsten Banner über den Tabs. Wegwischen merkt
sich Kennung und Text – ändert sich der Text, kommt der Banner wieder; das ist gewollt.

**Tastatur-Sticker (#239) sind ein natives Thema.** Android reicht Sticker und GIFs über
`InputConnection.commitContent` an das Eingabefeld; Reacts `TextInput` meldet keine Bildtypen.
Das braucht ein eigenes Modul um das Eingabefeld – nicht in einem Release, das sonst nur
JavaScript ändert. Bleibt offen, eigener Schritt.

## Block 34 — Discord II, Teil 1: Plattform-Konten verknüpfen

### Was 34.1 gefunden hat (#260 – PR #376)

**Getippte Namen beweisen nichts.** Discord-Name, Twitch-Name und Steam-ID standen als Freitext im
Profil; ob der Tag echt ist, sah niemand. Jetzt meldet man sich einmal bei der Plattform an, die
Plattform sagt, wer man ist, und die Website trägt Wert und Häkchen ein – im Profil, im
öffentlichen Profil und bei Turnieren. Der Text bleibt weiter tippbar; wer ihn von Hand ändert,
verliert das Häkchen, nicht den Eintrag.

**Der Rückruf kennt keinen angemeldeten Nutzer.** Die Plattform ruft den Browser zurück, ohne
unsere Sitzung zu kennen. Deshalb trägt der Start einen signierten `state` (zehn Minuten, Nutzer
und Plattform), und der Rückruf glaubt nur ihm. Jeder Ausgang ist eine Weiterleitung ins Profil
mit einem Grund – abgebrochen, schon vergeben, nicht bestätigt, ungültig – nie eine nackte
Fehlerseite. Bei Steam wird die Antwort bei Steam gegengeprüft, sonst könnte jeder eine SteamID
in die Adresse schreiben.

**Ein Konto, ein Profil.** Ein Discord-Konto kann nur an einem Profil hängen; das zweite bekommt
„schon vergeben“. Die Zugangsdaten liegen wie bei Twitch in den Einstellungen (Discord-App,
optionaler Steam-Schlüssel für den Anzeigenamen), die Rückrufadressen stehen dort zum Kopieren.
Was die Plattform liefert, steht als Text an der Plattform und daher im Profil und im
Datenschutz – Kennung und Name, keine Freunde, keine Nachrichten. Der Bot (#302) baut darauf auf:
gezählt wird nur, wer verknüpft ist.

## Block 33 — App 0.8.0-beta: Kalender und Galerie

### Was 33.1 gefunden hat (#216, #236 – PR #374)

**Der Kalender ist eine zweite Sicht, keine zweite Liste.** Der Events-Tab lädt Events, Turniere
und Fast Laps ohnehin; der Kalender legt sie auf ein Monatsraster – Punkte je Art, ein goldener
Rahmen, wo man angemeldet ist. Ein Termin, der über mehrere Tage geht, steht an jedem Tag; ein
offenes Ende wird bei 31 Tagen gekappt, sonst füllt eine Saison das Jahr. Die Filter (Art,
Verein) gelten in beiden Sichten. Vergangenes ist im Kalender einfach der Vormonat – die Liste
braucht ihren Schalter weiter, weil sie sortiert, was ansteht.

**„In meinen Kalender“ fragt erst beim Antippen.** Die Berechtigung für den Gerätekalender kommt
nicht beim Start der App, sondern wenn jemand den Knopf drückt; verweigert oder ohne
beschreibbaren Kalender öffnet sich Google Kalender mit dem vorausgefüllten Termin – das geht
ohne jede Berechtigung. Im Web dasselbe als .ics-Download und Google-Link. Der persönliche
Kalender-Feed zum Abonnieren bleibt der spätere Schritt aus #216.

**Die Galerie nimmt die Fassungen, die es gibt.** Kacheln laden 400 px, die Großansicht 1600 px
– nur für eigene Uploads, fremde Adressen bleiben, wie sie sind (Block 12 im Web). Videos laufen
im Player aus dem Chat, Einbettungen (YouTube) öffnen sich draußen. Teilen und Speichern ist ein
System-Teilen mit der heruntergeladenen Datei – kein eigener Speicherdialog, keine
Fotos-Berechtigung. Sichtbarkeit entscheidet der Server, die App zeigt, was er liefert.

## Block 30.2 — Leitfaden, Schritt 2: der Weg ins Formular

### Was 30.2 gefunden hat (#368 – PR #375)

**Ein Leitfaden, der nur beschreibt, bleibt Dokumentation neben der Software.** Jede Turnierform
hat jetzt den Knopf „Voreinstellung übernehmen“: er öffnet „Turnier anlegen“ mit Format,
Teilnahme, Teamgröße, Best of und der Spielregel-Vorgabe (online: Spieler melden; vor Ort: die
Turnierleitung wertet und plant) – als `?preset=` in der Adresse, damit der Weg auch als Link
weitergegeben werden kann. Die Werte stehen bei der Turnierform selbst; eine Voreinstellung darf
nur diese sieben Felder setzen, und ein Test hält das fest. Alles bleibt änderbar, ein Hinweis
oben nennt die Turnierform; ein unbekannter Schlüssel ändert nichts.

## Block 32 — Rechnungskonditionen und lesbare Belege

### Was 32.1 gefunden hat (#370 – PR #372)

**Ein Beleg ohne Zahlungsziel ist kein fertiger Beleg.** Die Website legte Rechnungen ohne
Zahlungsziel, Zahlungsart und Bankkonto an – Dolibarr nahm dann seine Vorgaben oder gar nichts.
Solange Belege Entwürfe waren, fiel das beim Prüfen auf; mit „gleich freigeben“ wären Rechnungen
ohne Zahlungsziel hinausgegangen. Jetzt stehen die drei Konditionen in den Einstellungen
(Listen aus Dolibarr, Vorschlag 30 Tage / Überweisung), und ohne alle drei gibt die Website
nichts automatisch frei – der Haken lässt sich gar nicht erst setzen.

**„Kostenbeitrag“ allein sagt dem Kunden nichts.** Auf der Rechnung stand die Leistung, nicht der
Anlass. Jede Zeile nennt jetzt den Vorgang – Event oder Turnier mit Datum, Personen und
Begleitpersonen, Team und Spielerzahl – aus den Daten, die die Buchung ohnehin hat. Was die
Buchung nicht weiß (Tisch, Menü, Sonderwunsch), ergänzt die Finanzverwaltung als Zusatz, solange
der Beleg noch nicht existiert; danach ist Dolibarr die Stelle für Änderungen, nicht die Website.

## Block 31 — Abrechnung II: Startgelder für Turniere

### Was 31.1 gefunden hat (#319 – PR #371)

**Dasselbe Preismodell, derselbe Rechnungsweg.** Ein Turnier trägt ein Angebot wie ein Event
(Positionen, Preisbasis, Steuerprofil, Leistung aus Dolibarr); die Anmeldung friert den Preis
ein, der Auftrag geht denselben Weg nach Dolibarr. Neu ist nur, was am Turnier anders ist – und
das sind drei Entscheidungen, keine zweite Abrechnung.

**Wer zahlt: die anmeldende Person.** Bei Teams hätte man je Spieler eine Rechnung stellen
können; dafür bräuchte jeder Spieler ein Konto mit Kundendaten und die Teamleitung müsste warten,
bis alle bezahlt haben. Die erste Stufe stellt eine Rechnung an die Teamleitung, die beim Anmelden
ausdrücklich die Kostenübernahme bestätigt; Team und Roster sind Bezug auf der Rechnung. Ohne
Haken nimmt der Server die Anmeldung nicht an – nicht das Formular allein, sonst käme die
Bestätigung über die App oder einen Zugangslink nie an.

**Was „je Person“ zählt.** Der Turnier-Roster, nie die Mitgliederliste des Community-Teams –
ein Team mit zwölf Mitgliedern schickt fünf. Ersatzspieler zählen nur auf Wunsch. Steht bei der
Freigabe noch kein Roster, gilt die Teamgröße; das ist ehrlich, weil das Turnier sie verlangt.

**Wann bezahlt wird: mit der verbindlichen Teilnahme.** Warteliste und offene Freigabe kosten
nichts – anders als beim Event, wo die Anmeldung selbst verbindlich ist. Die Freigabe durch die
Turnierleitung setzt den Preis; Ablehnung, „nicht erschienen“ und Abmeldung vor dem Beleg
schließen den Auftrag. Ein Turnier im Event mit „im Eventbeitrag enthalten“ zeigt kein Startgeld
– sonst bekäme die Person zwei Rechnungen für denselben Abend.

## Block 30 — Admin und Turniere

### Was 30.1 gefunden hat (#203, #204, #227, #228, #235 – PR #369)

**Der geltende Termin stand nirgends.** Bei Ligen mit Spielwochen rechnete die Plattform beim
Anzeigen aus, welcher Termin gilt – vereinbart, Heimrecht, Standardzeit –, schrieb ihn aber nicht
in die Partie. Erinnerungen, Stationen und TV-Anzeigen lesen aber genau dieses Feld. Jetzt schreibt
ein Lauf alle 15 Minuten den geltenden Termin samt Quelle in jede Spieltag-Partie; eine Annahme
schreibt sofort. Ein von der Turnierleitung gesetzter Termin trägt die Quelle „manual“ und wird
nie überschrieben; erledigte und laufende Partien auch nicht. Beim ersten Lauf nach dem Update
werden bestehende Partien nachgetragen.

**Ein Event, viele Orte – ohne Migration.** Ein Vereinsausflug hat Treffpunkt, Halle und Lokal,
jeder mit eigener Zeit und Adresse. Statt die bisherigen Felder umzubauen, gibt es eine
Standortliste; ein Event ohne Liste ist ein Event mit genau einem Standort aus den alten Feldern,
und der erste Standort einer Liste wird in die alten Felder gespiegelt, damit Listen, Erinnerungen
und die App weiter dieselben Felder lesen. Die Anmeldung bleibt je Event – ein Limit je Standort
wäre ein zweites Anmeldesystem, das kein Event heute braucht.

**„Ort“ war zweideutig.** Das Feld hieß „Ort“ und stand neben „Stadt“, deshalb stand zweimal
„Telfs“ drin. Es heißt jetzt „Veranstaltungsort (Name, optional)“, und die Karte sucht nur nach
der Adresse – „Vereinsheim, Telfs“ ließ die Kartensuche danebenliegen.

**Die Tageszentrale kannte nur Konflikte.** Gemeldete Ergebnisse, die auf Bestätigung warten,
Moderationsmeldungen, Kontaktanfragen und verfallende Terminvorschläge lagen auf anderen Seiten
ohne Zähler; „Spiele heute“ war nur eine Zahl. Jetzt sind es Aufgaben-Karten nach demselben
Muster, und „Termine heute“ ist eine Liste – nach dem Wiener Tag, nicht dem UTC-Tag des Servers
(die Falle aus #355).

**Der Leitfaden hängt an den Feldern.** Drei Teile – Ablauf unabhängig vom Spiel, Turnierformen
mit Teamgröße und Serie, welches Format wofür – als Text im Code, damit er zu den Feldern passt;
jede Empfehlung nennt ihre Felder. Der Knopf „Diese Voreinstellung übernehmen“ ist Schritt 2
(#368), damit der Leitfaden nicht Dokumentation neben der Software bleibt, sondern der Weg hinein.

## Block 29 — Abrechnung I, Teil 1: Preis, Buchung, Aufträge

### Was 29.1 gefunden hat (#315, #318 – PR #363)

**Kein Preisfeld je Eventtyp.** Der Wunsch war „20 € pro Person inkl. Essen, bei einer
Begleitperson 40 €, danach automatisch die Rechnung“. Statt eines Preisfelds am Event gibt es
ein Angebot mit typisierten Positionen: Bezeichnung, Betrag in Cent, Preisbasis (je Anmeldung,
je Person, je Team), Steuerprofil, wählbar oder Pflicht, optional die Dolibarr-Leistung. Keine
Formeln, kein Geld aus Freitext, kein Gleitkomma. Turniere (#319) nutzen dasselbe Modell später.

**Der Preis gehört zur Buchung, nicht zum Angebot.** Bei der verbindlichen Anmeldung wird
gerechnet und eingefroren (Snapshot mit Version des Angebots und Prüfwert). Ändert der Kassier
danach die Positionen, zählt das nur für neue Anmeldungen. Die Warteliste zahlt nichts, bis sie
nachrückt; eine Änderung der Begleitpersonen vor dem Beleg rechnet neu und ersetzt den Auftrag.
Das ist die Grenze zu #321: Ein angelegter Beleg wird nie still ersetzt.

**Geld sieht nur, wen es angeht.** Die Anmeldeseite zeigt Positionen und Summe vor dem Absenden,
die eigene Anmeldung ihren Betrag – die Teilnehmerliste kein Geld, das Angebot keine
Dolibarr-Nummern. Pflegen darf Kosten nur der neue Bereich **Finanzen** (#322): Die
Turnierleitung bearbeitet Events weiter, ohne den Abschnitt zu sehen; der Server lehnt Änderungen
daran mit 403 ab.

**Ein Postfach statt eines Hintergrundgedankens.** Jede kostenpflichtige Anmeldung schreibt einen
Rechnungsauftrag in dieselbe Datenbank (#317). Ein Job sortiert ein, was fehlt – Anbindung,
Schreibzugriff, Geschäftspartner –, ohne in diesem Teil einen Beleg anzulegen. Die Finanzübersicht
zeigt, wo es hakt, und gibt zurückgehaltene Aufträge frei. Nichts geht verloren, nichts wird
doppelt.

**Schreiben braucht einen Schalter.** Vorgeschlagen war ein zweiter Dolibarr-Benutzer nur fürs
Schreiben; der Betreiber hat am 22.09. entschieden, dass **ein** Website-Benutzer alles macht.
Der Haken „Schreibzugriff einschalten“ (nur im Modus „Live“) ist die Sicherung; ein eigener
Schlüssel bleibt möglich.

### Was 29.2 gefunden hat (#316, #317 – PR #365)

**Kunde ist nicht Mitglied.** In Dolibarr hängt eine Rechnung am Geschäftspartner, nicht am
Mitglied. Bei Mitgliedern mit bestätigter Zuordnung liest die Website den am Mitglied verknüpften
Geschäftspartner (`fk_soc`); fehlt er, legt sie ihn an und merkt sich die Nummer an der Zuordnung.
Nicht-Mitglieder bekommen einen Kunden in einer eigenen Sammlung je Installation. Gibt es in
Dolibarr schon jemanden mit derselben E-Mail (Familien teilen Adressen), entscheidet die
Finanzverwaltung – Zuordnen oder bewusst neu anlegen –, nie die Website aus einer E-Mail.

**Nie zwei Rechnungen.** Zwischen „Beleg in Dolibarr angelegt“ und „Nummer bei uns gespeichert“
kann der Prozess sterben. Deshalb trägt jeder Beleg die Auftragskennung als externe Referenz, und
vor jedem Anlegen fragt die Website danach; schreibende Aufrufe werden nie automatisch
wiederholt. Ein Auftrag, bei dem Dolibarr fünfmal nicht antwortet, wird „gescheitert“ und lässt
sich von Hand neu starten – nichts geht still verloren.

**Entwurf zuerst.** Neue Belege sind Entwürfe zur Prüfung in Dolibarr (Steuer, Leistung, Text).
Erst ein bewusster Haken gibt sie sofort frei. Zahlungen bucht der Kassier in Dolibarr; die
Website liest Freigabe und Zahlung alle zehn Minuten nach und zeigt sie der Person an der
Anmeldung und dem Kassier in der Finanzübersicht. Dolibarr ist führend für den Beleg, die Website
für die Buchung.

**Test-Dolibarr mit Kern-API.** Das Vereinsmodul hat keine Schreibwege, die Kern-API schon.
Der Test-Dolibarr kennt jetzt Geschäftspartner, Belege, Mitglieder und Leistungen in den Formen
der Dolibarr-REST-API 22–24 – ohne Vertrag des Moduls, aber mit denselben Prüfungen (nur https,
Schlüssel nur im Header, Schreiben nur mit dem Schreib-Schlüssel, Rechnung nur für bestehende
Kunden).

## Block 28 — Web: Dynamik

### Was 28.1 gefunden hat (#224, #225, #226 – PR #360)

**Die Seiten waren live, sahen aber still aus.** Seit dem Änderungsstrom (Block 15) laden
Startseite, Rangliste, Turnierbaum und Spielplan bei jeder Änderung von selbst nach – nur merkte
das niemand: Eine Zeile sprang, ein Match trug plötzlich ein Ergebnis, eine Karte stand da wie
vorher. Jetzt vergleicht jede Seite den neuen Stand mit dem alten (nach Schlüssel und einer
Signatur dessen, was man sieht) und zeigt den Unterschied ein paar Sekunden: Karten leuchten und
tragen „Neu“, Zeilen der Rangliste gleiten auf ihren neuen Platz, das geänderte Match im Baum
bekommt einen Rahmen, im Spielplan steht „gerade eingetragen“ und unten ein Hinweis mit dem
Ergebnis – auch für Zuschauer. Der erste Stand zählt nie als Änderung; ein Neuladen ohne
Unterschied macht nichts neu.

**Zahlen statt Adjektive.** Die Karten auf der Startseite sagen jetzt „12 von 16 angemeldet“
oder „3 Matches laufen“; der Server hängt die Zahlen je Karte an (ein Aggregat je Sammlung, nicht
eine Abfrage je Karte). Dazu ein Countdown in Worten zum nächsten Termin, der noch nicht läuft.

**Keine Dauer-Animation.** Alles ist endlich (ein Leuchten, ein Gleiten, ein Einblenden) und
über die Web-Animations-API, nicht über Klassen, die ein Neuaufbau bräuchte. „Bewegung
reduzieren“ des Systems schaltet jede Bewegung ab; die Hervorhebung bleibt, sonst sähe man mit der
Einstellung gar nichts mehr.

**„Lade …“ an 21 Stellen.** Ein Satz Skelette in der Form des späteren Inhalts (Zeilen, Karten,
Liste, Tabelle, Detailkopf) ersetzt die Texte auf den Seiten für Mitglieder und Besucher und in
den wichtigsten Admin-Listen; Knöpfe, die während einer Aktion „Lade …“ sagen, bleiben. Der
Seitenwechsel blendet kurz ein, ohne die Seite neu aufzubauen – ein Wechsel von `/news/a` nach
`/news/b` verliert also nichts.

## Block 27 — App 0.7.0-beta: Mitgliederbereich

### Was 27.1 gefunden hat (#340, #339, #341, #342, #346 – PR #357)

**Die App kannte den Verein nur als „Mitgliedervorteile“.** Alles, was der Mitgliederbereich der
Website seit Block 23 zeigt – interne Events, interne News, Dokumente, Ansprechpartner, der
eigene Beitragsstand aus Dolibarr –, fehlte im Handy. Jetzt steht unter „Mehr“ für Mitglieder
eine goldene Karte, dahinter derselbe Aufbau wie im Web; wer kein Mitglied ist, sieht „Mitglied
werden“ mit dem Weg auf die Website. Die Auswahl (was ist intern, wer steht im Vorstand) ist
derselbe Code wie im Web, nur nach TypeScript übertragen und getestet – der Server filtert, die
App sortiert.

**Dokumente sind persönlich.** Ein Statut oder Protokoll darf nicht im Downloads-Ordner oder in
der Galerie landen, wo es das nächste Backup oder eine Foto-App mitnimmt. Die App lädt die Datei
mit Anmeldung in ihren privaten Cache, öffnet sie über den PDF-Betrachter des Geräts und löscht
den Ordner, sobald jemand sich abmeldet oder das Konto wechselt – derselbe Mechanismus wie bei
Chat-Bildern. Klappt es nicht, steht der Grund beim Dokument (kein Zugriff, Datei fehlt, Server
antwortet nicht) statt eines stummen Nichts.

**Belege ja, bezahlen nein.** „Meine Mitgliedschaft“ zeigt Beitrag, Nummer, Funktion und die
eigenen Belege als PDF – aber kein „Bezahlen“: Der Zahlungslink führt auf eine fremde Seite
(Stripe, PayPal), das gehört in den Browser, nicht in eine WebView. Der Hinweis sagt, wo es geht.

**Interne Meldungen gingen bisher nirgendwohin.** Wurde ein internes Event angelegt, erfuhr das
kein Mitglied, außer es schaute nach. Ein Job meldet jetzt jedes veröffentlichte interne Stück
genau einmal – Push in der App, Glocke im Web – und zwar **nur** an die, die es sehen dürfen:
`members` an aktive Mitglieder, `internal` an die Vereinsverwaltung (Rolle, Freigabe,
Vorstandsposten oder Dolibarr-Funktion – dieselbe Regel wie der Wächter). Öffentliches hat
Newsletter und Discord und läuft hier nicht. Eine leere Empfängerliste bleibt leer; es gibt
keinen Rückfall auf „alle“. Damit die Meldung nicht am Newsletter-Haken hängt, hat sie ein
eigenes Thema „Vereinsintern“ (Standard an). Was älter als einen Tag ist, wird beim ersten Lauf
nur markiert – sonst hätte das Update jedes interne Event von 2024 nachgemeldet.

**Die Mitgliedskarte verrät nichts.** Der QR-Code trägt weder Name noch Nummer, nur eine
Adresse mit einem Zufallscode, der fünf Minuten gilt und sich vor Ablauf von selbst erneuert.
Wer ihn scannt, sieht: gültig, Vorname mit Initial, Mitgliedsart, gültig bis – oder „nicht
gültig“, ohne Grund. Ein abfotografierter Code ist nach fünf Minuten wertlos, ein Austritt in
Dolibarr macht auch einen frischen Code sofort ungültig; ein offener Beitrag ist kein Austritt.
Apple und Google Wallet sind vorbereitet (neutrales Kartenmodell), brauchen aber ein Zertifikat
bzw. Issuer-Konto – das ist eine Entscheidung des Betreibers, keine Codefrage.

**Nummerierung.** Das Paket kam vor Kalender und Galerie an die Reihe und bekam die 0.7.0-beta;
die beiden folgenden App-Meilensteine sind um eins gerückt.

## Block 26 — Anmeldung und Teilen

### Was 26.1 gefunden hat (#348, #347 – PR #353)

**Die Rechte nach Bereichen hatten ein Loch im Login.** Seit Block 23 kann ein Konto mit der Rolle
„Spieler“ einen Adminbereich haben – per Freigabe, Vorstandsposten oder, seit Block 24, über eine
Funktion in Dolibarr. Jeder Adminbereich verlangt Zwei-Faktor. Einrichten durften ihn aber nur
Konten mit Admin-*Rolle*, und nur sie fragte der Login nach dem Code. Der Kassier aus Dolibarr
wäre also nie in die Vereinsverwaltung gekommen – und die Weiterleitung „Zwei-Faktor fehlt“
zeigte obendrein auf den Reiter, in dem es seit Block 19 gar nicht mehr steht. Jetzt: für alle
freiwillig einrichtbar, beim Login gefragt, wer es hat, Pflicht nur für Adminbereiche.

**„Angemeldet bleiben“ gab es nicht.** Die Sitzung hielt 14 Tage, gleitend. Für jemanden, der
alle drei Wochen aufs Handy schaut, fühlt sich das an wie „die Seite vergisst mich“. Jetzt 90
Tage gleitend mit Haken (Standard an), ohne Haken bis zum Schließen des Browsers. Niemand wird
durch die Umstellung abgemeldet: Sitzungen ohne Kennzeichen gelten als „bleiben“.

**Eine Sicherheitsgrenze blieb zunächst, wie sie war.** Ein Test hielt fest, dass ein Konto mit
Zwei-Faktor auch nach dem Passkey-Login den Code eingibt. Ein Passkey mit Gerätesperre wäre als
zweiter Faktor vertretbar – aber das entscheidet der Betreiber, nicht ein Komfort-PR (Frage an
#348). Am 22.09. entschieden (#358, Variante B): Der Passkey zählt als zweiter Faktor, weil der
Server die Gerätesperre ohnehin verlangt – nach dem Passkey kein Code mehr, die Sitzung ist
bestätigt, auch für Adminbereiche; die Code-Einrichtung bleibt dort Pflicht als Rückweg (#359).

**Gar keine Vorschau sieht kaputt aus.** Für alles Nicht-Öffentliche bekam WhatsApp ein 404. Der
Schutz dahinter war richtig; die Lösung ist eine neutrale Karte, die nichts verrät – und ein
Haken je News und Event, mit dem der Autor Titel und Bild bewusst freigibt. Internes bekommt den
Haken nie.

## Block 25 — Discord I: Kanäle und Meldungen

Wunsch des Betreibers vom 16.09.: Discord soll News, Events und Erfolge zeigen – aber nur, was
für die Community ist – und Erfolgsmeldungen sollen schneller kommen. Anleitung:
`docs/DISCORD.md`.

### Was 25.1 gefunden hat (#300, #301, #303 – PR #350)

**News und Events wurden gar nicht gemeldet.** Die Issues gingen davon aus; im Code meldeten
nur Turnierstatus, Fast-Lap-Bestzeit, Erfolge und der Betrieb. Jetzt sieht ein Job jede Minute
nach – dieselbe Stelle für „sofort“ und „geplant für 18 Uhr“, jede News und jedes Event genau
einmal. Die neuen Schalter sind aus, bis der Betreiber sie einschaltet, und wer einschaltet,
bekommt nicht das Archiv in den Kanal.

**Erfolge gingen mit Namen in den Community-Kanal – auch bei nicht öffentlichem Profil und für
nicht öffentliche Gruppen** (etwa die Vereinsmitgliedschaft). Jetzt erfährt der Discord nur, was
öffentlich sein darf; die Person selbst wird immer benachrichtigt. Und die Auswertung hängt
nicht mehr am Profilbesuch: Ein bestätigtes Ergebnis und ein Turnierabschluss merken alle
Beteiligten vor. Auf die Frage des Betreibers, ob alle Erfolge erreichbar sind: Ja – 204
automatische Stufen, jede mit einem Zähler, der berechnet wird; ein Test hält das fest.

**Privat fällt nie zurück.** Öffentliche Ziele dürfen ohne eigenen Webhook in die Community;
Vorstand und Betrieb nicht – fehlt ihr Webhook, passiert nichts. Und Discord ist ein fremder
Dienst: In den Vorstands-Kanal geht nur „neuer Antrag“, nie ein Name.

**Ein Punkt im Feldnamen ist für MongoDB ein Unterordner.** Die Schalter heißen
`news.published` – gespeichert als `events.news.published` wären sie still ins Leere gegangen.
Der erste Testlauf fand es; die Schlüssel liegen jetzt mit `__` in der Datenbank.

## Block 24 — Dolibarr I: Anbindung und Mitgliedschaft

Wunsch des Betreibers: Dolibarr mit dem eigenen Vereinsmodul führt Mitglieder, Beiträge und
Funktionen – die Website soll das nicht ein zweites Mal von Hand pflegen. Anleitung für den
Betrieb: `docs/DOLIBARR.md`.

### Was 24.1 gefunden hat (#295, #297, #316, #330 – PR #338)

**Das Vereinsmodul kann schon mehr, als die Issues annahmen – und weniger, als sie verlangten.**
Zusammenfassung je Mitglied mit Beitragsstand und Funktionen, Suche über E-Mail oder Nummer,
`changed_since`, ein Webhook ohne Personendaten: alles da (Modul 0.5.12-beta). Verifizierte
Identitäten, ein Änderungsfeed mit Löschhinweisen und signierte Webhooks fehlen noch
(dolibarr-vereine#153–#155). Die Website setzt deshalb nur voraus, was im festgehaltenen Vertrag
steht, und löst das Fehlende selbst: Bestätigung der Zuordnung durch die Vereinsverwaltung statt
Identitätsnachweis aus dem Modul; täglicher vollständiger Lauf mit einzelnem Nachlesen statt
Löschhinweisen; Token in der Adresse und „nur Anlass zum Nachlesen“ statt Signatur.

**E-Mail und Mitgliedsnummer beweisen nichts.** Familien teilen sich Adressen, eine Nummer kann
jeder abschreiben. Eine Zuordnung gilt erst, wenn sie bestätigt ist; ein eindeutiger Index sorgt
dafür, dass zwei Konten nie dasselbe Mitglied beanspruchen. Die Zuordnung über die bestätigte
E-Mail gibt es, aber nur, wenn der Betreiber sie einschaltet, und nur bei genau einem Treffer.

**Die gefährlichen Fälle sind die stillen.** Ein Lauf, dem eine Seite fehlt, darf niemanden
austragen; ein altes Ereignis darf keinen neuen Stand überschreiben; Beitragsrückstand ist kein
Austritt; ein Abgleich darf keine Mails und keine Discord-Meldungen auslösen. Jeder dieser Fälle
hat einen Test. Dazu die alte Falle im eigenen Code: Das Anlegen eines Mitgliederprofils setzte
die Mitgliedschaft auf „aktiv“ – im geführten Betrieb hätte Profilpflege einen Austritt
rückgängig gemacht.

**Rechte aus einem fremden System brauchen eine Schwelle.** Welche Funktion was öffnet, legt der
Superadmin einmal fest, mit Vorschau „wer bekäme was“, versioniert und im Audit. Ableitbar ist
nur die Vereinsverwaltung. Ist die Freigabe aktiv, verleiht der lokale Vorstandsposten nichts
mehr – er ließe sich sonst redaktionell als Hintertür benutzen. Nach 48 Stunden ohne gelungenen
Abgleich ruhen die abgeleiteten Rechte; die Mitgliedschaft bleibt.

**Vertragstests ohne Dolibarr im CI.** Das Modul prüft seine echten Antworten in Dolibarr 22–24
gegen seine `openapi.json`. Die Website hält dieselbe Datei fest, und ihr Test-Dolibarr prüft
jede eigene Antwort dagegen – weicht eine Testannahme vom Vertrag ab, scheitert der Test. Beim
ersten Lauf fand die Oberflächen-Prüfung gleich einen echten Fehler: Die ungespeicherten Haken der
Funktions-Freigabe verschwanden, sobald die Seite nachlud.

### Was 24.2 gefunden hat (#345, PR #349 – das erste Einrichten beim Betreiber)

„Verbindung testen“ sagte bei einem Buchstabendreher in der Adresse nur „nicht erreichbar“ –
jetzt nennt der Adapter den Grund (Adresse gibt es nicht, Zertifikat, Zeitüberschreitung,
abgelehnt, Umleitung, keine API, Modul fehlt), weiter ohne Adresse oder Schlüssel in der Meldung.
Die Vorschau sagte „nur von Hand zuordnen“, aber von Hand ging nirgends; Konten mit
unbestätigter E-Mail wurden gar nicht gesucht; beendete Mitgliedschaften standen zwischen den
aktiven. Und ein Fund für „wer sieht was“: Das Admin-Feld heißt „Interne Notizen“, „Meine
Mitgliedschaft“ zeigte sie dem Mitglied aber an – `/api/membership/me` liefert sie nicht mehr aus.

### Was 24.3 gefunden hat (#296, #325 – PR #356)

**Der Zahlungslink gehört nicht in die Liste.** Dolibarr liefert je Rechnung eine Zahlungs-URL
mit Sicherheitsschlüssel. Stünde sie in der Antwort der Liste, läge sie in jedem Browser-Speicher
und jeder Ausfall-Kopie. Sie bleibt am Server; wer klickt, bekommt sie frisch – geprüft auf
eigenen Beleg, noch offen, https und die eigene Installation. Ein Beleg, der zwischen Anzeige und
Klick bezahlt wurde, wird abgelehnt.

**Ein Ausfall darf nicht wie „nichts offen“ aussehen.** Antwortet Dolibarr nicht, zeigt die Seite
den letzten Stand mit Datum, aber ohne Bezahlen – bezahlt wird nur gegen frische Daten.

**Kein 303 für eine API.** Die Zahlungsweiterleitung war zuerst eine Weiterleitung; der API-Client
im Browser hätte sie als fremden Aufruf verfolgt und wäre an CORS gescheitert, ein HTML-Formular
kann den CSRF-Header nicht setzen. Der Server nennt das Ziel als JSON, der Browser wechselt die
Seite selbst.

**PDFs im eigenen Haus.** pdf.js liegt lokal im Bundle samt Worker und wird erst geladen, wenn
jemand ein Dokument öffnet. Nichts geht an einen fremden Betrachter; der Service Worker cacht
nichts unter `/api/`. Vereinsdokumente öffnen im selben Betrachter statt in einem neuen Tab.

**Was offen bleibt:** #316 für die Kundenanlage bei kostenpflichtigen Buchungen (Abrechnung I),
#330 für die Durchläufe der späteren Pakete (Dolibarr III), die App-Seite „Meine Mitgliedschaft“
(#339).

## Block 19 — Web-Profil

Aus den PC-Screenshots vom 15. September: Profil I – Aufbau (#253, #257, #258) und
Profil II – Nachrichten und Dashboard (#254, #255, #256, #259).

### Was 19.1 gefunden hat (#253, PR #267)

**Eine Datei, neun Reiter, 1.828 Zeilen.** `ProfilePage.jsx` trug Grunddaten, Gaming, Socials,
Teams, Freunde, Inbox, Achievements, Sitzungen und Privatsphäre samt Formularzustand. Jetzt
hält die Seite nur noch Rahmen, Zustand und Speichern (290 Zeilen); jeder Reiter liegt unter
`src/pages/user/profile/` in einer eigenen Datei. Verschoben wurde zeilengenau per Skript,
das die Importe je Datei berechnet – abtippen wäre die sichere Quelle für neue Fehler gewesen.
Die kommenden Umbauten (#257, #258, #254) fassen damit je eine kleine Datei an.

**Das Menü ist ein Element mit drei Lagen.** Am PC Seitenleiste links (klebt beim Scrollen),
am Tablet und Handy eine waagrecht scrollbare Reihe – dieselben Knöpfe, nur per CSS anders
gelegt. Zwei getrennte Menüs hätten jeden Reiter doppelt ins Dokument gestellt (Tests,
Screenreader). Der Inhalt nutzt am PC die Breite (`max-w-7xl`), die Formularzeilen sind
zweispaltig.

**`/profile?tab=…` bleibt.** Mails und Benachrichtigungen aus dem Backend verlinken so an elf
Stellen; ein Pfad wie `/profile/socials` brächte nichts außer Umstellungsarbeit. Neu ist nur,
dass ein Reiterwechsel ein eigener Verlaufseintrag ist – „Zurück“ führt zum vorigen Reiter.

**Vier Lint-Unterdrückungen waren versteckt.** `eslint-suppressions.json` erlaubte der alten
Datei vier Kästchen-Labels ohne zugänglichen Text; in den neuen Dateien griff die Regel wieder.
Die Labels haben jetzt ein `aria-label`, die Unterdrückung ist überflüssig.

### Was 19.2 gefunden hat (#257, PR #275)

**Vier Themen auf einer Seite, der Knopf ganz unten.** „Privatsphäre“ trug öffentliches Profil,
Newsletter, Direktnachrichten, die Benachrichtigungstabelle und 20 einzelne Auswahlfelder;
gespeichert wurde erst mit dem Knopf am Ende. Jetzt zwei Reiter: Privatsphäre (Profil,
Direktnachrichten, Sichtbarkeit) und Benachrichtigungen (Kanäle, Tabelle, Newsletter – der
gehört zu den Mails, nicht zur Privatsphäre). Die vier Mail-Links „Einstellungen ändern“ im
Backend zeigten auf `?tab=privacy` und zeigen jetzt auf `?tab=notifications`.

**Sichtbarkeit in fünf Gruppen.** Kontakt, Persönliches, Gaming-IDs, Social, Sonstiges; je Gruppe
eine Schnellwahl für alle Felder, die Einzelfelder darunter aufklappbar, jede Stufe mit einem
Satz („Verein: nur eingeloggte Vereinsmitglieder“). Unterschiedliche Stufen heißen „gemischt“.
Die Logik ist reine Funktion (`visibility.js`) und einzeln getestet.

**Speichern von selbst, wie in der App.** Schalter und Auswahlfelder speichern 0,7 s nach dem
letzten Klick; mehrere Klicks ergeben genau einen PATCH, und was während des Speicherns noch
umgeschaltet wird, bleibt stehen. Die Text-Reiter behalten eine feste Speicherleiste mit
„Ungespeicherte Änderungen“.

**Zwei Kleinigkeiten am Werkzeug.** Die Radix-Switch braucht `ResizeObserver` (fehlt in jsdom)
und Design-Tokens, die die Webseite nicht setzt – deshalb ein eigener Schalter. Ein klebender
Tabellenkopf und ein seitlich scrollender Rahmen schließen sich aus: am PC klebt der Kopf, am
Handy scrollt die Tabelle seitwärts.

### Was 19.3 gefunden hat (#258, PR #276)

**Der Nickname war ein totes Feld.** Backend und App speichern `nickname`, gelesen wird es nirgends
(Modelle, Registrierung, DSGVO-Export, Turniere geprüft). Im Web ist das Feld weg; der Anzeigename
sagt jetzt, wo er erscheint. Feld und App-Eingabe bleiben, bis ein App-Issue sie abräumt.

**Land als Auswahl ohne Namensliste.** `lib/countries.js` hält nur die ISO-Codes; die deutschen
Namen liefert `Intl.DisplayNames`, den jeder aktuelle Browser hat. Österreich, Deutschland und
Schweiz stehen vorne. Ein alter Freitextwert bleibt als „Bisher: …“ wählbar.

**Passwort ändern gab es nur als Endpunkt.** `/auth/change-password` war da, eine Oberfläche nicht;
jetzt im Reiter Sicherheit. Das Backend meldet danach alle Geräte ab, auch das aktuelle, deshalb
führt der Weg direkt zur Anmeldung. Google-Konten ohne Passwort bekommen den Hinweis auf
„Passwort vergessen“.

**Der Google-Knopf war schon der offizielle.** Login und Registrierung rendern ihn über Google
Identity Services (Logo, Schrift, Abstände, deutsch). Selbst gebaut war nur die Profil-Karte mit
einem handgezeichneten Logo-Ausschnitt; die steht jetzt unter Sicherheit ohne ihn.

**Eingefügte Adressen werden zu Nutzernamen.** `profile/socials.js` kennt je Plattform die
Adressformen (Instagram, X/Twitter, Twitch, TikTok, YouTube mit `@`, `c/`, `user/`; Steam mit
`/id/` und `/profiles/`). Beim Tippen bleibt der Text, eine Adresse wird sofort bereinigt, beim
Verlassen des Felds fällt ein führendes `@`. Dateinamen unter Bildern sind weg, dafür gibt es
„Ansehen“ und „Entfernen“ – in jedem `ImageUpload`, auch im Adminbereich.

### Was 19.4 gefunden hat (#254, PR #278)

**Die Unterhaltung war eine Seite, kein Chat.** Der Reiter im Profil lud bis zu 250 Nachrichten
auf einmal und stellte sie untereinander; das Neueste stand ganz unten, die Eingabe auch. Jetzt
ist `/messages` eine eigene Seite: Liste links, die Unterhaltung rechts in fester Höhe mit
eigener Scrollleiste, beim Öffnen unten, die Eingabe klebt. Am Handy Liste und Gespräch als zwei
Ansichten mit Zurück.

**Nachladen gab es im Backend nicht.** `GET /api/messages/direct/{id}` kennt jetzt
`?before=<id>&limit=50` (höchstens 100) und meldet `has_more`; gelesen markiert nur das Öffnen.
Die Seite hält beim Einfügen älterer Nachrichten die Scrollposition, indem sie um die neue Höhe
nachrückt. Neue Nachrichten kommen über den Änderungsstrom; wer nicht unten ist, sieht
„N neue Nachrichten“ statt eines Sprungs.

**Die App liest den Pfad der Benachrichtigung.** `rootNavigation.ts` öffnet bei
`/profile?tab=inbox` ihren Chat. Deshalb behält die Web-Benachrichtigung diesen Pfad (plus
`to=<absender>`), und das Web leitet `?tab=inbox` auf `/messages/<id>` um. Nur der Mail-Link,
den keine App liest, zeigt direkt auf `/messages/<absender>`.

**Der Browser-Test läuft ohne Backend.** Wie die Chat-Tests stellt er den Server mit
`page.route` nach: 120 Nachrichten, davon zuerst 50; Hochscrollen holt 50 und dann 20, und die
Seitenhöhe des Dokuments bleibt gleich – der Beweis, dass nur der Verlauf scrollt.

### Was 19.5 gefunden hat (#255, PR #279)

**Dreimal dieselbe Zeile, nirgends hin.** Das Dashboard zeigte Titel und Uhrzeit, nicht
anklickbar; die Glocke hatte zwar Links, aber keine Bündelung. Jetzt teilen Glocke, Dashboard
und die neue Seite `/notifications` eine Zeile (`NotificationRow`) und einen Feed
(`useNotificationFeed`): Titel, eine Zeile Vorschau, Klick führt ans Ziel und markiert das
Bündel als gelesen.

**Bündeln nach Schlüssel, nicht nach Titel.** Nachrichten desselben Absenders bündeln über
`meta.thread_user_id`, Team-, Turnier- und Match-Chats über ihre IDs; innerhalb einer Stunde ab
der neuesten. Der Titel wird daraus gebaut („3 neue Nachrichten von X“, „4 neue Teamnachrichten
[GRD]“); unbekannte Titel bekommen einen Zähler. Reine Funktionen in `lib/notifications.js`,
einzeln getestet.

**Zwei Backend-Pfade führten ins Leere.** Gewinne verlinkt das Backend mit `/me/prizes`, die
Seite heißt `/my/prizes`; Turnier-Chats mit `/tournaments/<slug>/chat`, das es im Web nicht gibt
(der Chat steht auf der Turnierseite). Beides fängt die Zielzuordnung im Web ab; die Pfade im
Backend bleiben, weil die App nach Art und Metadaten navigiert und den Pfad nur als Rückfall
liest.

### Was 19.6 gefunden hat (#256, PR #280)

**Die App-Startseite hatte längst, was dem Web fehlte.** `/api/mobile/dashboard` liefert eigene
Termine ab heute (Wiener Zeit, `_still_relevant`), offene Aktionen, Matches und die Jahreswertung
– und prüft nur die Anmeldung, nicht den Client. Das Web ruft ihn jetzt auch auf; die Aufteilung
in „Heute und Live“ und „Danach“ ist aus `mobile/src/lib/dashboard.ts` nach `lib/dashboard.js`
übertragen und läuft als zweites Netz auch im Browser. Die zwei Match-Aufrufe des Dashboards
entfallen, weil dieselben Übersichten in der Antwort stecken.

**Zehn Kacheln, fünf davon Menü.** Mitgliederbereich, Einstellungen, öffentliches Profil,
Teamverwaltung, Achievements, Turniere, Fast Lap – alles über Menü oder Profil erreichbar. Geblieben
sind Mitgliedervorteile, Strafen und Daten; „Mitglied werden“ ist ein Text-Link im Kopf, Gewinne
sind eine offene Aktion. Matches und Turnierleitung erscheinen nur, wenn es welche gibt.

### Was 19.7 gefunden hat (#259, PR #281)

**Die Suche gab es schon, nur nicht hier.** `/api/messages/users?q=` findet jeden aktiven Spieler
nach Name oder @nutzername; der Reiter Freunde nutzt sie jetzt und rechnet den Stand zu mir
(befreundet, gesendet, offen, blockiert) aus der eigenen Freundesliste – ohne neuen Endpunkt.

**Keine Anwesenheit im Backend.** „Online“ oder „zuletzt gesehen“ ließe sich nicht anzeigen, weil
kein Feld dafür gepflegt wird; die Zeile zeigt Avatar, Name, Profil-Link, Schreiben und Entfernen.

**Zähler ohne den Reiter zu öffnen.** Das Profil lädt die Freundesliste einmal und bei jeder
Änderung über den Änderungsstrom und hängt „Freunde (n)“ und einen Punkt für offene Anfragen an
den Reiter. Damit ist Block 19 (Web-Profil) komplett: Profil I und Profil II sind abgeschlossen.

### Was 19.8 gefunden hat (#282, PR #285)

**Der Weg ins Profil war weg.** 19.6 hat die Kachel „Einstellungen“ aus dem Dashboard genommen,
und der Name im Kopf führte nur ins Dashboard – seit dem Server-Update kam niemand mehr zu
Grunddaten, Privatsphäre oder Passwort. Der Betreiber hat es im ersten Test bemerkt.

**Sechs Knöpfe nebeneinander.** Mitgliederbereich, Admin, Glocke, Nachrichten, Name, Logout –
auf einem Laptop lief die Kopfzeile über. Jetzt gibt es einen Knopf mit Avatar und Name und
dahinter ein Menü: Dashboard, Mein Profil, Nachrichten, Mitgliederbereich (nur Mitglieder),
Admin (nur Admins), Abmelden. Im Kopf bleiben Suche, Glocke und Nachrichten; den blauen
Admin-Knopf wollte der Betreiber nach dem ersten Blick auch weg haben – Admin steht im Menü.
Am Handy hat das Klappmenü dieselben Einträge; das Dashboard bekommt „Profil bearbeiten“.

**Kein Radix.** Wie die Glocke ist das Menü ein eigener Knopf (Klick daneben und Escape
schließen es), damit die Tests in jsdom laufen. Der Browser-Test für das Abmelden öffnet
seit dem zuerst das Menü. Nebenbei: die Profilseite stürzte ab, wenn `/api/games` keine
Liste liefert – der neue Browser-Test hat es gezeigt, jetzt wird die Antwort geprüft.

### Was 19.9 gefunden hat (#283, PR #285)

**Die Karte war nie angeschlossen.** „Interne Events“ im Mitgliederbereich war ein fester
Platzhalter; die Seite rief keine Events ab, obwohl die Halloween Gaming Night als
Mitglieder-Event ausgeschrieben war. „Interne News“ daneben filterte längst echte Daten.

**Kein neuer Endpunkt.** `GET /api/events?upcoming=true` liefert schon, was der Angemeldete
sehen darf (Sichtbarkeit public/community/members/internal, Entwürfe und Vergangenes weg).
Die Seite behält davon Mitglieder- und interne Events und zeigt die nächsten drei mit
Termin, Ort und Link; eine Kachel zählt sie. Die Auswahl steckt in `lib/memberArea.js`.

**Was bleibt (#284):** Kacheln und Karten zeigen dieselben Themen doppelt, und drei Karten
sind meist leer. Der Vorschlag steht im Issue und wartet auf das OK des Betreibers.

### Was 19.10 gefunden hat (#284, PR #298)

**Doppelt und leer.** Vier Kacheln oben, darunter dieselben Themen als Karten, drei davon mit
„Keine …“. Jetzt: Kopf mit Mitgliedschaft, eine Zeile Verweise (Mitgliedschaft, Vorteile,
Dokumente, Interne News, Vorstand, Discord aus den Einstellungen), darunter nur Karten mit
Inhalt. Ist nichts freigeschaltet, steht ein Satz.

**Ansprechpartner gab es schon – auf der Vorstandsseite.** `/api/board?active_only=true`
liefert die Posten mit Person und Titel je Geschlecht; der Mitgliederbereich zeigt die
besetzten Posten als Karte mit Link ins Mitgliedsprofil. Kein neuer Endpunkt.

**Dolibarr ist der nächste Schritt, nicht dieser.** Beitrag bezahlt bis, Rechnungen als PDF,
Zahlungslink und die Vorstandsbesetzung aus der Vereinsverwaltung stehen als eigener
Meilenstein „Dolibarr I: Anbindung und Mitgliedschaft“ (#316, #295, #297, #330; Rechnungen in
„Dolibarr II“, #296 und #325) – nach Rollen und Rechten, weil
der Vorstand dort an die Rechte gehängt wird (#290).

## Block 16 — Turnier-Leitfaden im Adminbereich

Dein Wunsch: eine Anleitung im Adminbereich, die sagt, **welches Turnier man wie einstellt**,
mit einem Teil je Spiel und Bildern, damit Online-Turniere sauber laufen.

### Warum das mehr sein soll als ein Text

Ein Leitfaden, den man nur liest, veraltet. Diese Plattform hat bereits **Voreinstellungen**:
im Formular „Turnier anlegen" und in `RulePresetPicker`. Der Leitfaden soll daran hängen —
jede Empfehlung mit einem Knopf **„Diese Voreinstellung übernehmen"**, der Turnierstruktur,
Teamgröße, Best-of, Ergebniserfassung und Terminplanung auf einmal setzt.

Damit ist die Anleitung nicht Dokumentation neben der Software, sondern der Weg hinein.

### Was verglichen wurde

Angesehen habe ich Toornament, Challonge, Battlefy, start.gg, ESL Play, die Regelwerke von
Call of Duty Challengers, Valorant, CS2, Rainbow Six und Age of Empires, dazu desbl.de.

**Zu desbl.de:** die Übersichtsseite selbst gibt wenig her — Ligen mit Seasons und Ewiger
Tabelle, Cups getrennt davon, und die Abläufe stehen in den Regelwerken und den Spiele-Foren.
Die Zweiteilung **Liga (Saison, Spieltage, Tabelle) neben Cup (K.-o., an einem Tag)** ist
aber genau die Trennung, die auch hier gilt.

### Was in den Leitfaden gehört

**Erstens: der Ablauf, unabhängig vom Spiel.** Aus den Regelwerken der großen Anbieter, und
jeweils übersetzt auf die Felder dieser Plattform:

| Empfehlung | Feld hier |
| --- | --- |
| Regelwerk, Format, Seeding und Qualifikationsweg **vor** der Anmeldung veröffentlichen | Regeln, Sichtbarkeit, Anmeldung öffnet |
| Check-in 30 bis 60 Minuten vor Start | Check-in öffnet / Check-in endet |
| Nicht erschienen: nach 10 bis 15 Minuten Forfeit | Walkover durch die Turnierleitung |
| Ab etwa 32 Teilnehmern Gruppen zu 4 bis 8, dann Bracket | Gruppen, danach Turnierbaum |
| Streitfall-Ablauf und Verhaltensregeln festlegen | Regeln, Ergebnis-Konflikte |
| Termine bei Ligen über Spielwochen statt starrer Uhrzeit | Block 10 |

**Zweitens: ein Teil je Spiel** mit dem, was dort üblich ist — Teamgröße, Serienlänge,
Besonderheiten:

| Spiel | Teamgröße | Übliche Serie | Besonderheit |
| --- | --- | --- | --- |
| Rocket League | 3v3 | Gruppen und Playoffs Best of 5, Finale Best of 7 | kurze Spiele, viele Runden an einem Abend möglich |
| Rainbow Six Siege | 5v5 | Best of 1 bis Best of 3 | Map-Veto, die Heimseite hostet |
| Call of Duty | 4v4 | Best of 5 | feste Modusfolge, etwa Hardpoint, Search & Destroy, Control |
| Counter-Strike 2 | 5v5 | Best of 1 in Gruppen, Best of 3 in Playoffs | Schweizer System für die Gruppenphase, Double Elimination danach |
| Valorant | 5v5 | Best of 3, Finale Best of 5 | Schweizer System für Qualifikation |
| League of Legends | 5v5 | Best of 1 in Gruppen, Best of 3 bis 5 in Playoffs | — |
| EA SPORTS FC | 1v1 | Hin- und Rückspiel | passt gut auf Liga mit Spielwochen |
| Age of Empires | 1v1 | Best of 3 | fester Map-Pool ohne Wiederholung; ELO-Grenze für Amateurturniere |

Die Liste ist der Anfang, nicht das Ende — sie wächst mit den Spielen, die der Verein
tatsächlich spielt.

**Drittens: welches Format wofür.** Einzelausscheidung für einen Abend, Double Elimination
wenn eine Niederlage nicht sofort ausscheiden soll, Schweizer System für viele Teilnehmer
ohne festen Baum, Gruppen mit anschließendem Baum ab etwa 32 Teilnehmern, Liga über eine
Saison mit Spielwochen.

### Wo es liegt

Ein eigener Eintrag im Adminmenü, sichtbar für die Turnierleitung. Bilder über die
vorhandene Medienverwaltung. Der Text wird mit der Software ausgeliefert, damit er nicht
auseinanderläuft, wenn sich Felder ändern.

### Entschieden: universell, nach Turnierform sortiert

Der Betreiber will **vorbereitet sein, nicht abbilden, was gerade gespielt wird**. Der
Leitfaden deckt deshalb alles ab, was sich als Turnier eignet — unabhängig davon, ob der
Verein den Titel heute spielt.

Sortiert wird nicht nach Spiel, sondern nach **Turnierform**, denn die entscheidet, welches
Format hier passt. Ein Battle Royale gehört nicht in einen Turnierbaum, ein Zeitfahren
ebenso wenig:

| Form | Beispiele | Passendes Format hier |
| --- | --- | --- |
| Team-Shooter 5v5 | CS2, Valorant, Rainbow Six, Overwatch 2 | Gruppen oder Schweizer System, dann Double Elimination |
| MOBA 5v5 | League of Legends, Dota 2 | Gruppen, dann Turnierbaum |
| Arcade-Sport 3v3 | Rocket League | Round Robin oder Gruppen, Playoffs Best of 5 |
| Team-Shooter 4v4 | Call of Duty | Best of 5 mit fester Modusfolge |
| Squad-Battle-Royale | Fortnite, Apex Legends, PUBG, Warzone | **kein Baum** — Battle Royale mit Punkten über mehrere Runden |
| 1v1 Sport | EA SPORTS FC, NBA 2K, Madden | Liga mit Spielwochen, Hin- und Rückspiel |
| 1v1 Strategie | Age of Empires II und IV, StarCraft II | Best of 3, Map-Pool ohne Wiederholung |
| 1v1 Fighting | Street Fighter 6, Tekken 8, Super Smash Bros. | Double Elimination, kurze Sätze |
| Rennen auf Zeit | F1, Trackmania, Gran Turismo, iRacing | Fast Lap beziehungsweise Grand Prix — über Rundenzeiten, nicht über Paarungen |
| Mobil | Clash Royale, Brawl Stars | Einzelausscheidung an einem Abend |
| Party und LAN | Mario Kart, Fall Guys | Free for All mit Rangwertung |

Diese Zuordnung ist der eigentliche Wert des Leitfadens: sie verbindet die Welt draußen mit
den **zwölf Formaten**, die diese Plattform kennt. Wer „Fortnite" sucht, landet nicht im
Turnierbaum, sondern bei Battle Royale mit Punktewertung — und wer „F1" sucht, bei den
Rundenzeiten statt bei Spielpaarungen.

Die Liste wächst weiter; neue Titel sind eine Zeile, kein Umbau.

## Block 17 — Markenbilder hell und dunkel überall richtig

Der Branding-Bereich führt jedes Logo doppelt: eine Fassung für dunklen und eine für
hellen Hintergrund, dazu Favicons je Modus. Der Wunsch: **überall die richtige nehmen**.

### Bestandsaufnahme

Nachgesehen statt vermutet. Das meiste stimmt bereits:

| Ort | Nimmt | Urteil |
| --- | --- | --- |
| Weboberfläche (`Logo.jsx`) | `logo_dark_url` zuerst | **richtig** — die Oberfläche ist dunkel |
| Favicons (`BrandingHead.jsx`) | je Variante mit `prefers-color-scheme` plus Rückfall | **richtig** |
| SEO und Teilen-Vorschau | `share_banner_url`, dann Logofassungen | **stimmig** |
| PDF-Export | nahm `logo_dark_url` zuerst | **war falsch**, behoben mit #193 |
| QR-Code-Mitte | Rückfallkette nur aus Dunkel-Fassungen | **war falsch**, siehe unten |
| Mobil-App | liest die Markenbilder gar nicht, bringt eigene mit | **offen** |

### Der Fund im QR-Code

Das Logo in der Mitte eines QR-Codes sitzt auf einem **weißen Kreis**. Die Rückfallkette
bestand aber ausschließlich aus Bildern für dunklen Hintergrund — `mascot_url`,
`favicon_dark_url`, `logo_dark_url`. War `qr_logo_url` nicht gesetzt, blieb der Kreis
**leer**: das Maskottchen des Vereins ist rein weiß, und Weiß auf Weiß zeigt nichts.

Beim Verein fällt das nicht auf, weil `qr_logo_url` dunkel gesetzt ist. Bei einem
Verein ohne diesen Eintrag wäre jeder gedruckte QR-Code ohne Logo.

Behoben: helle Fassungen zuerst, und ohne solche wird die **Silhouette** gezeichnet —
dann trägt auch ein weißes Logo.

### Was offen bleibt

- **Die App** liest die Markenbilder aus den Einstellungen nicht. Ändert der Verein sein
  Logo, ändert sich die App nicht mit. Gehört zu Block 14.
- **Der Standard-Favicon** ist bei euch weiß. Browser ohne Unterstützung für
  `prefers-color-scheme` zeigen ihn auf hellen Tableisten nicht. Kleinigkeit, aber
  vermeidbar: dort gehört eine Fassung hin, die auf beidem trägt.

## Block 18 — Auszeichnungen: Banner und Trophäen

Der Wunsch, ausdrücklich für später: **Gewinnerbanner und Trophäen**, die ein Turnier
vergibt und die im Profil sichtbar bleiben.

### Wie es gedacht ist

- **Für alle Teilnehmer** ein automatisch erzeugtes Banner mit der eigenen Bilanz aus
  diesem Turnier: Siege, Niederlagen, Unentschieden, Platzierung.
- **Für die ersten drei** eine eigene, gestaltete Fassung, die der Betreiber selbst
  entwerfen kann und dem Turnier zuhängt.
- **Trophäen**, die vergeben werden und die man ansehen kann.
- Spieler und Teams **getrennt**: es gibt Team- und Einzelturniere, und ein Team-Banner
  gehört ins Teamprofil, ein Spielerbanner ins Spielerprofil.
- Eine verliehene Auszeichnung soll sich **als Profil- oder Teambanner einstellen**
  lassen.
- Spielbezug: bei FIFA das Spiel-Symbol, dazu Saison oder Liga.

### Was daran zu klären ist

Das ist kein kleiner Block. Vor dem Bauen zu entscheiden:

- **Wie entsteht die Gestaltung?** Ein Vorlagensystem, in dem der Betreiber Hintergrund,
  Schrift und Felder wählt, ist etwas anderes als fertige Bilder zum Hochladen. Beides ist
  möglich; das zweite ist deutlich schneller.
- **Wo werden die Bilder erzeugt?** Serverseitig zum Zeitpunkt der Vergabe, oder erst beim
  Ansehen. Für Block 12 gilt ohnehin: Bilder brauchen kleinere Varianten.
- **Was passiert bei Korrekturen?** Wird ein Ergebnis nachträglich geändert, stimmt eine
  bereits vergebene Bilanz nicht mehr.

Der Zusammenhang zu Block 12 ist eng: erzeugte Banner sind Medien und brauchen dieselben
Vorschaubilder und Größen.

## Querschnitt: alles auch in der App

Nicht als eigener Block, sondern als Zusage über alle: was im Browser geht, muss **auch in
der App** gehen — einschließlich der Einstellungen, etwa denen eines Teams. Bei jedem Block
gehört die App-Seite dazu, nicht als Nachtrag.

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

**Die App hängt seit Block 14.1 ebenfalls am Strom.** Dabei fiel eine Lücke auf, die auch
das Web hatte: Direktnachrichten, Team-Chat und Benachrichtigungen erreichten normale
Mitglieder nie live. Details stehen bei Block 14.

## Neu aufgenommen am 14. September

Als GitHub-Issues festgehalten, damit der laufende Block nicht unterbrochen wird:

- [#203](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/203) Events an mehreren
  Standorten, jeder mit Datum, Zeiten, Adresse und eigener Karte
- [#204](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/204) Event-Formular:
  „Ort“ und „Stadt“ – die Karte kommt künftig nur aus der Adresse
- [#205](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/205) App-Releases lokal
  bauen und hochladen, Versionsschema `v0.x-beta` bis `v1.0.0`. Entschieden am 15. September:
  neu bei 0.x anfangen, der Build-Zähler läuft weiter (57). Umgesetzt mit `npm run release:local`.
  Der alte Signaturschlüssel lag nur als GitHub-Secret vor; seit Build 57 gibt es einen neuen

## Neu aufgenommen am 15. September

Feedback zur App nach Build 57, mit Screenshots. Als Issues festgehalten, Reihenfolge wie in
Block 14:

- [#210](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/210) **Fehler:** Die
  Chat-Eingabe schwebt bei offener Tastatur mitten im Bildschirm, Nachrichten sind darunter
  sichtbar. Vermutlich schieben `resize`-Modus und `KeyboardStickyView` doppelt.
- [#211](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/211) Rohbegriffe
  („clubevening“, „events“), „Telfs · Telfs“, Chat ohne Uhrzeit, wiederholte Absenderköpfe.
- [#212](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/212) Startseite:
  „Heute und Live“ zeigt jede offene Anmeldung, Termine doppelt, Vergangenes und Abgesagtes unter
  „nächste Termine“, Schnellzugriff doppelt die Tab-Leiste.
- [#213](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/213) Profil: 14 Knöpfe
  vor dem Inhalt, vier doppelt; Einstellungen hinter ein Zahnrad.
- [#214](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/214) „Mehr“: Zeilen
  statt Riesenkarten, Vereins-Links als Logos aus den Einstellungen. Der Discord-Link in der App
  ist fest im Code und weicht von dem in den Einstellungen ab.
- [#215](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/215) Teams-Ansicht
  wirkt leer, „Squads“ unerklärt.
- [#216](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/216) Kalender mit
  Monatsansicht, „In meinen Kalender“, später abonnierbarer Feed.
- [#217](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/217) Fingerabdruck-
  Sperre und Passkey-Login in der App. Die Webseite hat Passkeys bereits.
- [#218](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/218) Erfolge: Symbole
  statt Punkte, Fortschritt sichtbar, Freischalt-Moment wie im Web.
- [#219](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/219) Store-Reife.

### Web-Check vom 15. September

Alle Seiten im Code durchgesehen, Vorschlagsliste vom Betreiber bestätigt. Die Webseite am
Handy ist dabei nur über Code und Browser-Tests beurteilt, nicht auf einem Gerät.

- [#221](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/221) 25 Stellen
  fragen im Takt nach, obwohl der Änderungsstrom alles liefert; die meisten laden doppelt.
  Block 15.
- [#222](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/222) Profil hat
  neun Reiter, Nachrichten stecken unter `/profile?tab=inbox`. Block 19.
- [#223](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/223) Große
  Admin-Dateien beim nächsten Anfassen aufteilen. Regel, kein Umbau.
- [#224](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/224) Startseite:
  Countdown, Live-Zahlen, Änderungen sichtbar. Block 20.
- [#225](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/225) Turnierseiten:
  Änderungen an Tabelle, Baum und Spielplan hervorheben. Block 20.
- [#226](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/226) 50-mal
  „Lade …“ auf 39 Seiten; Skelette und sanfte Übergänge. Block 20.
- [#227](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/227) Tageszentrale
  im Admin um gemeldete Ergebnisse, Meldungen, Kontakt und Termine heute erweitern. Block 21.
  Korrektur meiner ersten Einschätzung: Die Aufgabenliste gibt es seit Block 9.2, es fehlen
  nur Einträge.
- [#228](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/228) Turnier-
  Leitfaden. Block 16.
- [#229](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/229) Block 17
  Rest: Standard-Favicon, Markenbilder in der App.
- [#230](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/230) Block 18:
  Banner und Trophäen.
- [#231](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/231) Klassischen
  Leseweg entfernen.
- [#232](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/232) Tempo: Galerie
  im Handy-Browser langsam. Im Code auffällig: Alle Bilder laufen durch den API-Prozess mit
  einem Worker, das Upload-Volume hängt nur im Backend-Container. Erst messen, dann Bilder
  über nginx ausliefern. Block 22.
- [#233](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/233) Betrieb:
  Server-Fehler mit Stack, langsame Anfragen, Web-Fehler standardmäßig an, Web Vitals,
  Auto-Checks, Alarme per Discord. Block 22.
- Kalender auch im Web als Monatsansicht, nicht nur `.ics`: in #216 ergänzt.
- Der Discord-Link in der App ist falsch; richtig ist `discord.com/invite/thelionsquadesports`.
  In #214 vermerkt.

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
| **Build 58 am Handy prüfen** | Tastatur im Team-Chat und in einer Direktnachricht: Klebt die Eingabezeile an der Tastatur? Dazu Uhrzeiten im Chat und „Vereinsabend · Telfs“ in der Events-Liste. Foto, Video, Sticker und Push sind mit Build 57 bestätigt. |
| **Entscheidung zu Block 10** | Soll der berechnete Termin (vereinbart, Heimrecht oder Standardzeit) in die Partie geschrieben werden? Ohne das können Erinnerungen, Stationen und TV-Anzeigen ihn nicht nutzen. |
| **Play-Console-Konto** | Für 14.8. Einmalige Gebühr, Konto des Vereins. Erst nötig, wenn die Feinschliff-Blöcke fertig sind. |
| **Neuen App-Schlüssel sichern** | Seit Build 57 ist die App mit einem neuen Schlüssel signiert; er liegt in `%USERPROFILE%\.lionsapp-release`. Den ganzen Ordner auf einen USB-Stick oder in den Passwortmanager sichern. Geht er verloren, muss jede installierte App wieder neu installiert werden. |
| **Alte App einmal löschen** | Build 57 lässt sich wegen des neuen Schlüssels nicht über Build 56 installieren: alte LionsAPP löschen, neue installieren, neu anmelden. Das gilt für alle, die die App schon haben. |
| **Eigene Sticker anlegen** | Nach dem Ausrollen unter *Admin → Content → Sticker* ein Paket „Lion Squad“ anlegen und Löwe oder Maskottchen als PNG mit durchsichtigem Hintergrund hochladen. Ein leeres Paket erscheint im Chat nicht. |
| **Medienbericht nach Block 12** | `docker compose exec backend python3 scripts/media-report.py` (nur lesend). Zeigt, was eure Bilder und ihre Fassungen wiegen, und ob 400/800/1600 px die richtigen Breiten sind. |

Zum Testen ohne Livesystem gibt es seit Block 6 den Weg über die echte Anwendung gegen
eine Datenbank im Speicher (`backend/tests/flow_harness.py`) — damit lassen sich vollständige
Turnierabläufe durchspielen, ohne deine Produktivdaten anzufassen.

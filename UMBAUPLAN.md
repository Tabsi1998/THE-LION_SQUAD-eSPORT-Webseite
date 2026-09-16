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
| 14 | LionsAPP in den Store | in Arbeit: 14.1 bis 14.4 umgesetzt, v0.3.1-beta (Build 60) veröffentlicht, v0.4.0-beta (Build 61) vorbereitet | #201, #206, #207, #208, #209, #220, #237, #262, #264 |
| 15 | Abschluss: Abfrage-Intervalle im Web weg, große Dateien nebenbei teilen | #221 umgesetzt, #223 offen | #261 |
| 16 | **Turnier-Leitfaden im Adminbereich** | offen (#228) | — |
| 17 | **Markenbilder hell und dunkel überall richtig** | teilweise (#229) | #193, #195 |
| 18 | **Auszeichnungen: Banner und Trophäen** | offen (#230) | — |
| 19 | **Web-Profil: Aufbau, Nachrichten, Dashboard** | in Arbeit: Profil I (#253, #257, #258) und #254 umgesetzt; #255, #256, #259 (Profil II) offen | #267, #275, #276, #278 |
| 20 | **Dynamik im Web: Startseite, Turnierseiten, Ladezustände** | offen (#224, #225, #226) | — |
| 21 | **Admin-Tageszentrale erweitern** | offen (#227) | — |
| 22 | **Tempo und Betrieb: Bilder über nginx, Messung, Fehler- und Tempo-Logs, Auto-Checks, Alarme** | #232 und #233 Teil 1 umgesetzt, Rest als #265 offen | #263, #266 |

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
| App 0.4.0-beta | Seiten aufräumen II: #241 Events-Tab, #242 Mehr/Gaming, #243 eigene Seiten, #244 Sponsoren, #248 Startseite II (#264; Build 61 noch nicht gebaut) |
| App 0.5.0-beta | Tester-Komfort: #249 „Was ist neu“, #250 Update aus der App, #251 In-App-Banner |
| App 0.6.0-beta | #218 Erfolge (14.5) |
| App 0.7.0-beta | #216 Kalender (14.6), #236 Galerie |
| App 0.8.0-beta | #240 Freunde, #239 Tastatur-Sticker, #245 Laufbanner |
| App 1.0.0 | #217 Passkey (14.7), #219 Store (14.8) |
| Web: Tempo und Betrieb | Block 15 und 22: #221, #232, #233 umgesetzt; #223, #231, #265 offen |
| Web: Profil I – Aufbau | Block 19: #253 Layout für PC/Tablet/Handy (#267: Seitenmenü, volle Breite, eine Datei je Reiter, umgesetzt), #257 Privatsphäre und Benachrichtigungen (#275, umgesetzt), #258 Grunddaten und Sicherheit (#276, umgesetzt) – Meilenstein abgeschlossen |
| Web: Profil II – Nachrichten und Dashboard | Block 19: #254 Inbox als Chat (#278, umgesetzt), #255 Benachrichtigungen anklickbar, #256 Dashboard, #259 Freunde (#222 ist darin aufgegangen) |
| Web: Dynamik | Block 20: #224, #225, #226 |
| Admin und Turniere | Block 16 und 21: #203, #204, #227, #228, #235 |
| Auszeichnungen und Marke | Block 17 und 18: #229, #230 |
| Später | Ideen ohne Termin: #260 Plattform-Konten verknüpfen |

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

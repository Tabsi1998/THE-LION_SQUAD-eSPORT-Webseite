# Discord – Handbuch

Was der Vereins-Bot und die Website mit Discord können, was ihr dafür einstellt und was ihr im
Discord selbst einrichtet: Hauptserver, Unterserver, Kanäle, Rollen und die Rechte des Bots.

**Wo im Admin:**

- **Admin → Verbindungen → Discord** (`/admin/integrations/discord`) mit sechs Reitern:
  **Meldungen** · **Einbettungen & Termine** · **Gestaltung** · **Willkommen** · **Bot & Aktivität** · **Server**
- **Admin → Verbindungen → Konten verknüpfen** – die Discord-Anmeldung für Mitglieder
- **Admin → Spiele → Spiel bearbeiten → Discord-Server** – welcher Server zu welchem Spiel gehört

Technische Details für die Entwicklung: [docs/DISCORD.md](../DISCORD.md).

---

## Inhalt

1. [Überblick: was alles geht](#1-überblick-was-alles-geht)
2. [Einrichten Schritt für Schritt](#2-einrichten-schritt-für-schritt)
3. [Die Rechte des Bots – was wofür](#3-die-rechte-des-bots--was-wofür)
4. [Die Funktionen einzeln](#4-die-funktionen-einzeln)
5. [Hauptserver und Unterserver](#5-hauptserver-und-unterserver)
6. [Wenn etwas nicht klappt](#6-wenn-etwas-nicht-klappt)
7. [Was die Website nie tut](#7-was-die-website-nie-tut)
8. [Häufige Fragen](#8-häufige-fragen)

---

## 1. Überblick: was alles geht

Ein einziger Bot macht alles – auch auf mehreren Servern. Er läuft im Backend der Website mit;
es gibt keinen eigenen Container und nichts in der `.env`.

| Funktion | Was passiert | Einstellen unter | Von Anfang an |
| --- | --- | --- | --- |
| **Meldungen** | News, Events, Turnier-Meldungen, Fast-Lap-Bestzeiten, Vereinsgeburtstag, Hinweise an den Vorstand, Betriebsalarme | Reiter „Meldungen“ | Turniere und Fast Lap an, der Rest aus |
| **Turnier-Thread** | Je Turnier eine Meldung im Kanal, alles Weitere (Check-in, live, Streams, Bracket, Endstand) im Thread darunter | Reiter „Meldungen“ | an |
| **Bracket im Discord** | Das Bracket eines laufenden Turniers, angeheftet und nach jedem Ergebnis aktualisiert | automatisch im Turnier-Thread | an |
| **Einbettungen, die sich aktualisieren** | Je eine angeheftete Nachricht: Rangliste, Nächste Events, Erfolg der Woche | Reiter „Einbettungen & Termine“ | aus |
| **Stream-Meldungen** | Je Stream eine Meldung mit Vorschaubild, sobald jemand aus dem Verein live geht; am Ende gelöscht – so zeigt der Kanal, wer gerade live ist | Reiter „Einbettungen & Termine“ | aus |
| **Gestaltung** | Aussehen der Stream-Meldungen und Einbettungen frei gestalten – mit Live-Vorschau | Reiter „Gestaltung“ | Standard-Design |
| **Discord-Termine** | Jedes öffentliche Event und Turnier als Discord-Event mit „Interessiert“-Knopf | Reiter „Einbettungen & Termine“ | aus |
| **Willkommensnachricht** | Wer neu auf den Server kommt, bekommt eine Direktnachricht mit „Anmelden“ und „Konto verknüpfen“ | Reiter „Willkommen“ | aus |
| **Rollen** | Mitglied, Vorstand, Turnierleitung werden automatisch vergeben und entzogen | Reiter „Bot & Aktivität“ | an, sobald der Bot verbunden ist |
| **Befehle** | `/naechstes-event`, `/turniere`, `/rangliste`, `/bracket`, `/wer-streamt`, `/meine-erfolge`, `/mitglied`, `/verknuepfen`, `/status` | – | an |
| **Aktivität zählen** | Jede Nachricht eines verknüpften Mitglieds zählt für die Erfolge „Discord-Aktiv“ – nie der Inhalt | Reiter „Bot & Aktivität“ | an |
| **Persönliche Benachrichtigungen** | Mitglieder bekommen ihre Benachrichtigungen auf Wunsch als Direktnachricht vom Bot | jedes Mitglied selbst im Profil | aus |
| **Konto verknüpfen** | Mitglieder verbinden ihr Discord-Konto mit dem Website-Profil | Admin → Verbindungen → Konten verknüpfen | – |
| **Discord auf der Website** | „42 online · 5 im Voice“ unten im Block „Dabei sein“, im Mitgliederbereich die belegten Sprachkanäle | Discord: Server-Widget einschalten | – |
| **Mehrere Server** | Ein Hauptserver, beliebig viele Unterserver (z. B. je Spiel), auf der Website bei Spielen und Turnieren | Reiter „Server“ | – |

---

## 2. Einrichten Schritt für Schritt

Einmalig. Reihenfolge einhalten – jeder Schritt baut auf dem vorigen auf.

### 2.1 Die Discord-Anwendung (Developer Portal)

Eine Anwendung genügt für beides: die Anmeldung der Mitglieder („Konto verknüpfen“) und den Bot.

1. **discord.com/developers/applications** → „New Application“ → Name eingeben.
2. **Name und Bild des Bots:** Reiter **Bot** → „Username“ und Icon. So heißt der Bot überall im
   Discord (mit dem Abzeichen „APP“). Tippfehler hier sieht jeder – den Namen genau prüfen.
   Einen anderen Namen nur auf einem Server gibt es über den Spitznamen (Discord → Server →
   Mitgliederliste → Bot → „Server-Profil bearbeiten“).
3. **Anmeldung für Mitglieder:** Reiter **OAuth2** → „Client ID“ und „Client Secret“ kopieren →
   Website: **Admin → Verbindungen → Konten verknüpfen → Discord** eintragen und speichern.
   Unter OAuth2 → „Redirects“ die Adresse eintragen, die dort zum Kopieren steht:
   `https://lionsquad.at/api/platform-links/discord/callback`
4. **Bot-Token:** Reiter **Bot** → „Reset Token“ → Token kopieren → Website: **Admin →
   Verbindungen → Discord → Reiter „Bot & Aktivität“ → „Bot-Token“** eintragen und speichern.
   Der Token wird verschlüsselt gespeichert und nie wieder angezeigt; das Feld leer lassen heißt
   „behalten“. Den Token niemals weitergeben oder in einen Chat kopieren – wer ihn hat, steuert den Bot.
5. **Privileged Gateway Intents** (Reiter Bot, weiter unten):
   - **Server Members Intent: an** – nötig für Rollen, Willkommensnachricht und „Du bist dabei“.
   - Presence Intent: aus – wird nicht gebraucht.
   - Message Content Intent: aus – der Bot liest nie, was geschrieben wird.
   - „Save Changes“ nicht vergessen.
6. **Empfehlung:** Reiter Bot → „Public Bot“ **aus**. Dann kann nur, wem die Anwendung gehört,
   den Bot auf Server holen.

### 2.2 Den Bot verbinden und auf den Hauptserver holen

1. **Reiter „Bot & Aktivität“ → „Bot verbinden“ anhaken** (der Token aus 2.1 ist gespeichert).
   Darunter steht der Stand: online, Servername, letzte Aktion, letzter Fehler. Lehnt Discord ab
   (Intent aus, Token falsch), steht der Grund mit Klickweg dort, und der Bot versucht es alle fünf
   Minuten von selbst wieder. Solange er auf keinem Server ist, steht das dort in Worten.
2. **Reiter „Server“ → „Bot auf einen weiteren Server holen“.** Der Knopf erscheint, sobald der Bot
   einmal verbunden war. Der Link enthält schon alle Rechte aus
   [Abschnitt 3](#3-die-rechte-des-bots--was-wofür) und die Befehle. Discord öffnet sich → Server
   auswählen → „Autorisieren“.
   *(Ohne den Knopf: Developer Portal → OAuth2 → URL Generator → Scopes `bot` und
   `applications.commands`, dazu die zehn Rechte aus Abschnitt 3 anhaken, Link öffnen.)*
3. Ist der Bot auf mehreren Servern, legt der Reiter „Server“ fest, welcher der **Hauptserver** ist
   ([Abschnitt 5](#5-hauptserver-und-unterserver)).

### 2.3 Rollen im Discord anlegen

1. Discord → **Servereinstellungen → Rollen** → drei Rollen anlegen: **Mitglied**, **Vorstand**,
   **Turnierleitung**. Andere Namen gehen auch – dann dieselben Namen auf der Website unter
   Reiter „Bot & Aktivität“ → Rollen eintragen.
2. **Die Rolle des Bots in der Rollenliste über diese drei ziehen.** Discord lässt einen Bot nur
   Rollen vergeben, die unter seiner eigenen stehen.
3. Fertig – der Bot gleicht alle zehn Minuten ab, sofort mit „Rollen jetzt abgleichen“.

Wer welche Rolle bekommt:

| Rolle im Discord | Bekommt, wer … | Gepflegt in |
| --- | --- | --- |
| Mitglied | eine aktive Mitgliedschaft hat | Mitgliederverwaltung (Dolibarr) |
| Vorstand | den Bereich „Vereinsverwaltung“ hat – durch einen Vorstandsposten, eine Freigabe oder als Club-Admin | Admin → Vorstand, Admin → Alle Benutzer ([Rollen](../ROLLEN.md)) |
| Turnierleitung | den Bereich „Turnierleitung“ hat – als Turnierleitung, durch eine Freigabe oder als Club-Admin | Admin → Alle Benutzer |

Club-Admins und der Superadmin haben alle Bereiche – sie bekommen im Discord deshalb sowohl
„Vorstand“ als auch „Turnierleitung“.

Der Bot gleicht diese drei Rollen auf dem **Hauptserver und jedem eingeschalteten Unterserver** ab –
überall, wo die verknüpfte Person ist. Er fasst **nur diese Rollen und die Spiel-Rollen** (unten) an,
nur bei **verknüpften** Konten. Alle anderen Rollen (Farben, Moderation …) vergebt ihr wie gewohnt
selbst oder mit Discords eigenem „Onboarding“.

**Spiel-Rollen** (seit Oktober 2026): Wer ein Spielprofil mit Spieler-ID hat oder in einem aktiven
Team-Kader eines Spiels steht, bekommt dessen Rolle, etwa „CoD-Spieler“ – auf dem Server des Spiels
und am Hauptserver.

- Der Name steht im Spielformular (Admin → Spiele → „Discord-Rolle“); leer heißt „<Kurzname>-Spieler“.
  Editionen zählen für ihr Hauptspiel – es gibt eine Rolle je Hauptspiel.
- Vergeben wird nur, was es im Discord gibt: Legt die Rolle mit genau diesem Namen an, oder hakt beim
  Server **„Fehlende Rollen anlegen“** an (Reiter „Server“, Vorgabe aus). Dann legt der Bot fehlende
  Vereinsrollen und die Spiel-Rollen an, die jemand bekäme – Spiel-Rollen erwähnbar.
- Wer keine Spiel-Rollen will, schaltet sie im Profil aus (Profil → Socials → „Spiel-Rollen im
  Discord“, in der App unter Konten). Die Vereinsrollen bleiben.
- Der Reiter „Server“ zeigt je Server den letzten Abgleich, was fehlt und was angelegt wurde. Ein Lauf
  ändert höchstens 500 Rollen; der Rest kommt im nächsten.
- Achtung: Eine Rolle mit dem Namen einer Spiel-Rolle gilt als verwaltet – von Hand vergebene passt der
  Bot beim nächsten Abgleich an.

### 2.4 Kanäle anlegen und zuordnen

Vorschlag für den Hauptserver – Namen frei wählbar:

| Zweck auf der Website | Vorschlag | Wer sieht den Kanal | Was hineinkommt | Ohne eigenen Kanal |
| --- | --- | --- | --- | --- |
| **Community** | `#ankündigungen` | alle | Öffentliches ohne eigenen Kanal, Vereinsgeburtstag | – (ohne Community geht nichts Öffentliches hinaus) |
| **News** | `#news` | alle | veröffentlichte News | geht in Community |
| **Events und Turniere** | `#events-und-turniere` | alle | Events, Turnier-Meldungen (Thread je Turnier), Fast-Lap-Bestzeiten | geht in Community |
| **Mitglieder** | `#mitglieder` | nur Rolle „Mitglied“ | News und Events nur für Mitglieder | **nichts** wird gesendet |
| **Vorstand** | `#vorstand` | nur Rolle „Vorstand“ | neue Mitgliedsanträge und Kontaktanfragen (nur der Hinweis), interne News und Events (nur Titel, Zeit, Ort) | **nichts** wird gesendet |
| **Betrieb** | `#betrieb` | nur Vorstand/Technik | rote Auto-Checks, neue Serverfehler | **nichts** wird gesendet |
| **Test** | `#bot-test` | nur Vorstand | Vorschau- und Testnachrichten | **nichts** wird gesendet |

**Wichtig bei privaten Kanälen:** Macht ihr einen Kanal privat („Kanal ansehen“ für @everyone aus),
sieht ihn auch der Bot nicht mehr. Darum beim Kanal: **Bearbeiten → Berechtigungen → Rolle oder
Mitglied hinzufügen → die Rolle des Bots** → „Kanal ansehen“, „Nachrichten senden“, „Links
einbetten“ erlauben. Sonst fehlt der Kanal in der Auswahl auf der Website.

Dann auf der Website: **Reiter „Meldungen“ → „Kanäle je Zweck“** → je Zweck den Kanal wählen →
Speichern → „Test“. Ausgegraute Kanäle darf der Bot nicht beschreiben – der Grund steht daneben.
Ist der Bot gerade nicht verbunden, lässt sich die Kanal-ID eintragen (Discord → Einstellungen →
Erweitert → Entwicklermodus an → Rechtsklick auf den Kanal → „Kanal-ID kopieren“).

### 2.5 Festlegen, was gemeldet wird

**Reiter „Meldungen“ → „Was gemeldet wird“** – ein Schalter je Ereignis:

| Ereignis | Kanal | Von Anfang an |
| --- | --- | --- |
| News veröffentlicht | News | aus |
| Event angekündigt | Events und Turniere | aus |
| News für Mitglieder / Event für Mitglieder | Mitglieder | aus |
| News intern / Event intern (nur Titel, Zeit, Ort) | Vorstand | aus |
| Turnier: Anmeldung offen, Check-in offen, jetzt live, Teilnehmer streamt, beendet, Ergebnisse veröffentlicht | Events und Turniere (im Turnier-Thread) | an |
| Fast Lap: neue Bestzeit | Events und Turniere | an |
| Neuer Mitgliedsantrag, neue Kontaktanfrage | Vorstand | aus |
| Vereinsgeburtstag | Community | aus |

Wer einen Schalter einschaltet, bekommt **nicht das Archiv** in den Kanal – gemeldet wird nur, was
ab dann erscheint.

**Spiel-Rolle anpingen** (seit Oktober 2026): Bei Meldungen mit Spielbezug (Turniere, Fast Lap) steht
unter der Regel ein Haken „Spiel-Rolle anpingen“. Ist er gesetzt, beginnt die Meldung mit der Rolle des
Spiels, etwa „@CoD-Spieler“ – wer die Rolle trägt, bekommt eine Benachrichtigung. Von Anfang an ist er
aus. Gepingt wird höchstens eine Rolle je Meldung, immer die des Hauptspiels (ein MW3-Turnier ruft die
„CoD-Spieler“), nur an der vollen Meldung – der kurze Querverweis am Hauptserver pingt nie – und nie in
einem privaten Kanal. Gibt es die Rolle auf einem Server nicht, geht die Meldung ohne Ping hinaus.
Damit Discord wirklich benachrichtigt, muss die Rolle „erwähnbar“ sein (Servereinstellungen → Rollen);
Rollen, die der Bot anlegt, sind es.

### 2.6 Prüfen

- **Reiter „Meldungen“ → „Vorschau: so sehen die Meldungen aus“** zeigt jede Meldungsart so, wie sie
  im Discord aussieht, mit dem Kanal, in den sie ginge – und schickt sie auf Wunsch in den
  Testkanal.
- **Reiter „Server“ → „Prüfen“** sagt je Server, ob der Bot da ist und welche Rechte fehlen.
- Im Formular jeder News und jedes Events zeigt **„So sieht die Meldung aus“**, ob und wohin sie
  ginge – oder warum nicht.

---

## 3. Die Rechte des Bots – was wofür

Der Einladungslink aus dem Reiter „Server“ setzt genau diese zehn Rechte. **Administrator braucht
der Bot nicht** – und sollte es auch nicht haben.

| Recht (so heißt es im Discord-Menü) | Wofür | Fehlt es … |
| --- | --- | --- |
| Kanäle ansehen | Der Bot sieht die Kanäle überhaupt | sieht er keinen Kanal – nichts geht |
| Nachrichten senden | Alle Meldungen | keine Meldung in diesem Kanal |
| Links einbetten | Meldungen kommen als Einbettung (Kasten mit Bild, Link, Feldern) | nur nackter Text oder gar nichts |
| Nachrichtenverlauf anzeigen | Eigene Einbettungen wiederfinden und bearbeiten | Rangliste & Co. werden jedes Mal neu gepostet |
| Öffentliche Threads erstellen | Thread je Turnier | Turnier-Meldungen einzeln im Kanal |
| Nachrichten in Threads senden | Thread je Turnier | Turnier-Meldungen einzeln im Kanal |
| Nachrichten anheften | Angeheftete Rangliste, Einbettungen und Brackets | nicht angeheftet (ältere Discord-Versionen: „Nachrichten verwalten“) |
| Rollen verwalten | Mitglied, Vorstand, Turnierleitung | keine automatische Rollenvergabe |
| Events verwalten | Discord-Termine | keine Discord-Termine |
| Einladung erstellen | Einladungslink vom Bot erzeugen lassen | Einladungslink von Hand eintragen |

**Rechte gibt es auf zwei Ebenen:** für den ganzen Server (die Rolle des Bots) und je Kanal
(Kanal bearbeiten → Berechtigungen). Eine Kanal-Einstellung kann ein Server-Recht wieder wegnehmen.
Der Knopf „Prüfen“ im Reiter „Server“ prüft die Server-Rechte; die Kanalauswahl unter „Kanäle je
Zweck“ zeigt je Kanal, was der Bot dort darf.

Für Befehle braucht der Bot beim Einladen zusätzlich den Bereich **`applications.commands`** – der
Einladungslink aus dem Reiter „Server“ enthält ihn.

---

## 4. Die Funktionen einzeln

### 4.1 Meldungen zu News und Events

- Ein Job sieht jede Minute nach – „sofort veröffentlicht“ und „geplant für 18 Uhr“ gehen gleich.
  Jede News, jedes Event wird genau einmal gemeldet; Entwürfe und Vergangenes nie.
- Die Meldung trägt Bild, Link, bei Events Zeit (Wiener Zeit), Ort, Anmeldeschluss und Plätze,
  darunter einen Knopf („Event ansehen“, „Weiterlesen“ …).
- **Wohin, entscheidet die Sichtbarkeit:** öffentlich → News bzw. Events und Turniere; „nur
  Mitglieder“ → Mitgliederkanal; „intern“ → Vorstand, dort nur Titel, Zeit, Ort und Link.
- Haken **„Ohne Discord veröffentlichen“** im Formular: genau dieser Eintrag geht nicht hinaus.

### 4.2 Turniere: Thread und Bracket

- Die erste Meldung eines Turniers (meist „Anmeldung offen“) steht im Kanal – mit Spiel, Format,
  Plätzen, Banner. Darunter öffnet der Bot einen Thread „🏆 Turniername“.
- Alles Weitere steht im Thread: Check-in offen, live, Streams von Teilnehmern, **das Bracket**
  (angeheftet, nach jedem Ergebnis aktualisiert), beendet, Ergebnisse. Der **Endstand** mit Podium
  ist die letzte Nachricht im Thread. Der Kanal zeigt je Turnier genau eine Meldung.
- **Das Bracket als Bild:** Hat das Turnier eine K.-o.-Phase, hängt der ganze Turnierbaum als Bild an der
  Nachricht – wie auf der Website: Runden als Spalten, Sieger in Gold, die laufende Partie cyan umrandet,
  Termine darunter. Die Felder darüber zeigen weiter die aktuelle Runde in Worten. Gruppen, Liga und Swiss
  bleiben eine Tabelle in Textform; sehr große Bäume (mehr als 32 Partien in einer Runde) ebenfalls.
- Discord archiviert den Thread nach einer Woche Ruhe; die nächste Meldung öffnet ihn wieder.
- **„Ohne Discord“** im Turnier-Formular hält das Turnier ganz heraus (keine Meldung, kein Thread,
  kein Termin).
- **Spielserver:** Hat das Spiel einen eigenen Server, steht das Bracket im Turnier-Thread **dort**. Am
  Hauptserver steht es nur, wenn die Meldung „Turnier: jetzt live“ auf **„Spielserver und Hauptserver“**
  steht (Reiter „Meldungen“ → „Was gemeldet wird“) – sonst hat der Hauptserver den Querverweis. Nimmt der
  Spielserver das Bracket nicht an (Kanal weg, kein Recht), kommt es voll an den Hauptserver.
- **Turniere „nur Mitglieder“** melden sich genauso, aber im Kanal **„Mitglieder (privat)“** am
  Hauptserver – mit eigenem Thread, darin Check-in, live, Streams und das Bracket. Nie in „Events und
  Turniere“, nie auf einem Spielserver, kein Querverweis. Ist kein Mitgliederkanal gewählt, kommt
  nichts an (kein Rückfall auf einen öffentlichen Kanal). Turniere „intern“ (nur Vorstand) und
  versteckte Turniere bleiben ganz draußen.

### 4.3 Einbettungen, die sich aktualisieren

**Reiter „Einbettungen & Termine“.** Je Einbettung postet der Bot **eine** Nachricht, heftet sie an
und bearbeitet sie danach – statt immer neuer Nachrichten.

| Einbettung | Inhalt |
| --- | --- |
| Rangliste | Top 10 der Jahreswertung der laufenden Saison |
| Nächste Events | die nächsten fünf Events und Turniere mit Zeit und Stand der Anmeldung |
| Erfolg der Woche | die seltenste Freischaltung der letzten Woche (nur öffentliche Profile) |

Je Einbettung: Kanal wählen, einschalten, speichern. Aktualisiert wird bei Änderungen (höchstens
einmal pro Minute), die Fußzeile „Stand: …“ alle zehn Minuten. Wird die Nachricht gelöscht, postet
der Bot sie neu. „Zuletzt geprüft“ zeigt, ob der Lauf noch kommt; kann er nichts schreiben (Bot aus,
Discord aus, Fehler beim Aufbauen), steht dort der Grund.

Wer gerade streamt, zeigt seit Oktober 2026 keine angeheftete Übersicht mehr, sondern die Stream-Meldungen (4.4):
Mit „Meldung löschen“ steht im Kanal immer genau, wer live ist. Die alte Übersicht „Live jetzt“ hat der Bot
einmal selbst gelöscht und ihren Kanal den Stream-Meldungen vorgeschlagen.

Aussehen und Texte gestaltet ihr im Reiter „Gestaltung“ ([4.12](#412-gestaltung-der-meldungen)).

**Auf Spielservern** (Unterserver, Kapitel 5) gibt es die **Rangliste** und die **nächsten Termine**
noch einmal – nur mit den Spielen dieses Servers. Sie stehen im selben Reiter unter „Spielserver“, je
Server mit eigener Kanal-Liste:

- **Rangliste:** nur Saisonpunkte aus Turnieren und Fast-Lap-Challenges dieser Spiele; der Name des
  Spiels steht hinter dem Saisonnamen („Saison 2026 · Call of Duty“).
- **Nächste Termine:** nur Turniere und Fast-Lap-Challenges dieser Spiele. Vereins-Events tragen kein
  Spiel – sie stehen nur am Hauptserver.
- Der **Erfolg der Woche** gilt für den ganzen Verein und bleibt am Hauptserver.
- Ist dem Server noch kein Spiel zugeordnet, postet der Bot nichts und sagt es: „Diesem Server ist noch
  kein Spiel zugeordnet“ (Spiele → Spiel bearbeiten → Discord-Server).
- Der Hauptserver zeigt weiter alles.

### 4.4 Stream-Meldungen je Stream

**Reiter „Einbettungen & Termine“ → „Stream-Meldungen“.** Sobald jemand aus dem Verein live geht, postet der
Bot eine Meldung – wie Stream-Bots: Text über dem Kasten („🔴 Paula ist jetzt live auf Twitch!“), Autor mit
Bild aus dem Mitgliederprofil, Titel des Streams als Link, Spiel und Zuschauer, Logo rechts, großes
Vorschaubild, Fußzeile mit Uhrzeit, Knopf „Zuschauen“.

- **Kanal** wählen, **„an“**, Speichern.
- **Rolle erwähnen** (optional, z. B. `@Stream-Ping`): pingt einmal beim Start – nie @everyone. Discord pingt
  eine Rolle nur, wenn sie erwähnt werden darf: Servereinstellungen → Rollen → die Rolle → „Jedem erlauben,
  diese Rolle zu @erwähnen“. Das Panel sagt es, wenn das fehlt.
- **Alle zehn Minuten** aktualisiert: Zuschauer, Titel, Spiel, neues Vorschaubild.
- **Wenn der Stream endet:** die Meldung wird **gelöscht** (Vorgabe – dann zeigt der Kanal immer, wer gerade live ist)
  oder zu „war live“ mit Dauer und Höchstzahl.
- Gemeldet wird, wer auch auf der Startseite erscheint: aktive Mitgliedschaft und Mitgliederprofil mit
  verknüpftem Twitch. Höchstens fünf neue Meldungen auf einmal (etwa nach einem Ausfall).
- Rechte im Kanal: wie bei allen Meldungen, dazu „Nachrichtenverlauf anzeigen“ zum Aktualisieren.

### 4.5 Discord-Termine

**Reiter „Einbettungen & Termine“ → „Discord-Termine“ → „Termine anlegen“.** Jedes öffentliche Event
und Turnier mit Beginn in der Zukunft bekommt **einen** Discord-Termin (Name, Beschreibung,
Beginn/Ende, Ort oder Link). Ändert sich etwas, wird der Termin angepasst; wird das Event abgesagt
oder auf „Ohne Discord“ gesetzt, wird er abgesagt. Abgleich alle fünf Minuten.

„Auch interne Events“ nur einschalten, wenn der Server selbst intern ist – Discord-Termine sieht
jeder auf dem Server.

**Spielserver:** Ein Turnier, dessen Spiel einen eigenen, eingeschalteten Server hat, bekommt seinen
Termin **dort**. Am Hauptserver steht er zusätzlich, solange beim Server **„Auch am Hauptserver“**
angehakt ist (Vorgabe; im selben Reiter unter „Spielserver“, mit der Zahl der Termine je Server).
Änderungen und Absagen gehen an beide. Hakt ihr „Auch am Hauptserver“ ab, sagt der nächste Abgleich
die Termine am Hauptserver ab; wird ein Spielserver ausgeschaltet, wandern seine Termine zurück an den
Hauptserver. Vereins-Events und alles, was nur für Mitglieder ist, kommt nie auf einen Spielserver.

### 4.6 Willkommensnachricht

**Reiter „Willkommen“.** Wer neu auf den Server kommt, bekommt **einmal** eine Direktnachricht vom
Bot mit den Knöpfen „Auf der Website anmelden“ und „Konto verknüpfen“ – egal, über welchen eurer
Server er beitritt.

- Platzhalter: `{name}` (Name im Discord), `{verein}` (Vereinsname).
- „Vorschau“ und „An mich senden“ zum Prüfen; **aus**, bis ihr den Text geprüft habt.
- Lässt jemand keine Direktnachrichten zu, passiert nichts.

### 4.7 Befehle

Tippt man `/` auf dem Hauptserver oder einem eingeschalteten Spielserver, erscheinen die Befehle des
Bots. **Jede Antwort sieht nur, wer fragt.**

| Befehl | Antwort | Für |
| --- | --- | --- |
| `/naechstes-event` | das nächste Event | alle |
| `/turniere` | offene Turnier-Anmeldungen | alle |
| `/rangliste` | Top 10 der Saison | alle |
| `/bracket` | Bracket eines laufenden Turniers (Auswahl) | alle |
| `/wer-streamt` | wer aus dem Verein live ist | alle |
| `/verknuepfen` | der Weg zum Verknüpfen | alle |
| `/meine-erfolge` | eigene Erfolge | verknüpfte Konten |
| `/mitglied` | eigener Stand im Verein (Art, seit wann – nie Beitrag oder Zahlungsdaten) | verknüpfte Konten |
| `/status` | Stand des Bots | Vorstand |

**Auf einem Spielserver** zeigen `/turniere`, `/naechstes-event` und `/bracket` nur die Spiele dieses
Servers (wie im Reiter „Server“ unter „Spiele auf diesem Server“):

- `/turniere spiel: Rocket League` zeigt ein anderes Spiel, `/turniere alle: True` alles – beides geht
  auf jedem Server. Gefilterte Antworten sagen klein darunter, wofür sie gelten.
- `/naechstes-event` nennt dort das nächste Event, bei dem ein Turnier dieser Spiele dabei ist (Events
  selbst haben kein Spiel).
- `/bracket` bietet die laufenden Turniere des Servers an; ein ausdrücklich gewähltes geht überall.
- `/status` nennt zusätzlich, welcher Server das ist, seine Spiele, seine Kanäle und wann die
  Einbettungen zuletzt aktualisiert wurden.
- Alle anderen Befehle antworten auf jedem Server gleich.
- Schaltest du einen Unterserver ein, hat er die Befehle sofort; schaltest du ihn aus, verschwinden sie
  dort. „Prüfen“ im Reiter „Server“ sagt, ob sie registriert sind.

### 4.8 Aktivität zählen

**Reiter „Bot & Aktivität“ → „Nachrichten zählen“.** Jede Nachricht eines verknüpften Kontos zählt
eins hoch – auf allen Servern, auf denen der Bot ist. Gezählt wird die **Zahl**, nie der Inhalt.
Die Zähler stehen darunter und lassen sich je Person korrigieren. Sie zählen für die Erfolge
„Discord-Aktiv“.

### 4.9 Persönliche Benachrichtigungen per Direktnachricht

Jedes Mitglied entscheidet selbst: **Profil → Benachrichtigungen → Kanal „Discord“**. Dann kommen
dieselben Benachrichtigungen wie in der App als Direktnachricht vom Bot. Voraussetzungen: Konto
verknüpft, mit dem Bot auf einem Server, und in Discord „Direktnachrichten von Servermitgliedern“
erlaubt. Nie in einer Direktnachricht: Texte anderer Personen, Moderation, Zahlungsdaten.

### 4.10 Konto verknüpfen (für Mitglieder)

**Profil → Socials → Discord verknüpfen** – Anmeldung bei Discord, fertig. Erst damit gibt es
Rollen, `/meine-erfolge`, `/mitglied`, Direktnachrichten und das Zählen. Die Website bekommt nur
Kennung und Name des Kontos – keine Passwörter, Freundeslisten oder Nachrichten. Trennen geht
jederzeit im Profil.

### 4.11 Discord auf der Website

Damit die Website zeigen kann, dass im Discord etwas los ist: Discord → **Servereinstellungen →
Widget → „Server-Widget aktivieren“**.

- **Jede Seite, unten im Block „Dabei sein“:** „42 online · 5 im Voice“ neben „Discord beitreten“.
- **Mitgliederbereich (Web und App):** „Discord jetzt“ mit den belegten Sprachkanälen.
- **Nie Namen von Personen** – nur Zahlen. Private Sprachkanäle bleiben unsichtbar.

Den Stand zeigt **Reiter „Bot & Aktivität“ → „Discord auf der Website“** mit „Jetzt prüfen“.

### 4.12 Gestaltung der Meldungen

**Reiter „Gestaltung“.** Jede Meldungsart ist eine Vorlage:

| Gruppe | Vorlagen |
| --- | --- |
| Streams | *Stream gestartet*, *Stream beendet*, *Antwort auf /wer-streamt* |
| Angeheftete Einbettungen | *Nächste Events und Turniere*, *Rangliste*, *Erfolg der Woche* |
| Meldungen | *News*, *Event*, *Turnier: Ankündigung* (die erste Meldung im Kanal), *Turnier: im Thread* (Check-in, live, beendet, Ergebnisse) |

Die Meldungen gehen genau so hinaus, wie die Vorschau sie zeigt – im News-, Events- und Mitgliederkanal, im
Turnier-Thread und auf Spielservern; „erneut senden“ schickt dieselbe Fassung. Der Standard sieht aus wie früher,
dazu Autorzeile, Fußzeile mit Logo und Uhrzeit; Felder ohne Wert (etwa „Plätze“ ohne Anmeldung) fallen weg.
Interne Meldungen an den Vorstand haben keine Vorlage: dort steht nie Text, nur Titel und Link.

- **Formular** (Farbe, Text über dem Kasten, Autorzeile mit Bild, Titel mit Link, Text, Felder, Bild rechts,
  großes Bild, Fußzeile mit Symbol, Uhrzeit) oder **JSON** im Discord-Format.
- **Platzhalter** wie `{streamer}`, `{title}`, `{viewers}` anklicken – sie landen im zuletzt gewählten Feld.
  Was in `[[ … ]]` steht, erscheint nur, wenn jeder Platzhalter darin einen Wert hat:
  `🎮 {game}[[ · seit {started}]]`.
- **Listen** (Antwort auf /wer-streamt, Nächste Events, Rangliste): je Eintrag ein Feld oder eine Zeile im Text.
- **Vorschau** rechts – mit Beispieldaten oder den **echten Daten von jetzt**. So sieht es im Discord aus.
- **Speichern** geht nur, wenn die Vorlage passt; was nicht passt, steht in Worten unter der Vorschau.
  **Testnachricht** schickt den Entwurf in den Testkanal (ohne jemanden zu erwähnen),
  **Standard wiederherstellen** holt das eingebaute Design zurück.
- Formatierung wie im Discord: `**fett**`, `*kursiv*`, `__unterstrichen__`, `[Text](https://…)`. Bilder
  brauchen eine volle Adresse mit https:// oder einen Platzhalter.

---

## 5. Hauptserver und Unterserver

Ein Bot kann auf beliebig vielen Servern sein – **ein zweiter Bot ist nie nötig.** Alles dazu im
**Reiter „Server“**.

### 5.1 Was jeder Server bekommt

| | Hauptserver | Unterserver |
| --- | --- | --- |
| Meldungen (News, Events, Turniere …) | ja | **mit Spielbezug** – je Meldung einstellbar, siehe 5.4 |
| Private Kanäle (Mitglieder, Vorstand, Betrieb, Test) | ja | gibt es dort nie |
| Einbettungen und Discord-Termine | ja | Rangliste, nächste Termine und Turnier-Termine – nur seine Spiele (4.3, 4.5) |
| Rollen Mitglied/Vorstand/Turnierleitung | ja | ja, sobald eingeschaltet (2.3) |
| Spiel-Rollen (z. B. „CoD-Spieler“) | alle Spiele | die Spiele dieses Servers (2.3) |
| Befehle (`/turniere` …) | ja | ja, sobald eingeschaltet – mit seinen Spielen als Vorgabe (4.7) |
| Willkommensnachricht | ja | ja (einmal je Person, egal über welchen Server) |
| Aktivität zählen | ja | ja |
| Auf der Website gezeigt | im Footer und auf der Kontaktseite | bei seinen Spielen („Über uns“), auf Turnierseiten, im Mitgliederbereich |

### 5.2 Einen Unterserver einrichten

1. **Reiter „Server“ → „Bot auf einen weiteren Server holen“** → Server wählen → „Autorisieren“.
2. Der Server erscheint von selbst – **als ausgeschalteter Unterserver**. Bei ihm:
   - Haken **„an“** setzen. Erst dann erscheint er irgendwo.
   - **Einladungslink:** „Erzeugen“ lässt den Bot einen unbegrenzt gültigen Link anlegen; ein
     eigener Link geht auch.
   - **Kanäle auf diesem Server:** Community, News, Events und Turniere – für die Meldungen mit
     Spielbezug (5.4).
   - **Notiz** – wofür der Server ist.
3. **„Prüfen“:** Bot da? Welche Rechte fehlen – in Worten mit Klickweg.
4. **„Test“:** schreibt in den Systemkanal des Servers – öffentlich, darum mit Rückfrage.
5. **Spiele zuordnen:** **Admin → Spiele → Spiel bearbeiten → „Discord-Server“.** Leer heißt
   *erben*: eine Spielversion nimmt den Server ihres Hauptspiels, ohne alles gilt der Hauptserver.
   Der Reiter „Server“ zeigt je Server, welche Spiele dort sind.

**Zum Hauptserver** macht einen anderen Server zum Hauptserver; der bisherige wird Unterserver.
Die öffentlichen Kanäle ziehen mit um, die privaten (Mitglieder, Vorstand, Betrieb, Test) sind am
neuen Hauptserver neu zu wählen. Verlässt der Bot einen Server, bleibt er im Reiter mit Hinweis
sichtbar und bekommt nichts mehr.

### 5.3 Was Mitglieder davon sehen

- **Über uns → Spiele:** Spielkarten mit dem eigenen Server des Spiels und „Beitreten“.
- **Turnierseite:** Kachel „Discord-Server für …“ mit Name, Symbol, Mitgliederzahl und Einladung.
- **„Du bist dabei“** sieht nur die angemeldete Person selbst, und nur mit verknüpftem Discord.
- **Mitgliederbereich (Web und App):** alle eingeschalteten Server mit dem eigenen Status.
- **Nach dem Verknüpfen** schickt der Bot einmal eine Direktnachricht mit den Servern, die zu den
  eigenen Spielen passen.
- Ausgeschaltete Server erscheinen nirgends.

### 5.4 Meldungen auf Unterservern

Eine Meldung mit **Spielbezug** – ein Turnier, sein Live-Stream, eine Fast-Lap-Challenge, ein Event
oder eine News mit Spiel – kann auf den Server des Spiels gehen. Welcher das ist, steht beim Spiel
(5.2). Was genau passiert, stellt ihr **je Meldung** ein: **Reiter „Meldungen“ → „Was gemeldet
wird“**, unter dem Schalter steht die Regel.

| Regel | Spielserver | Hauptserver |
| --- | --- | --- |
| **Spielserver + Querverweis** (Vorgabe mit Spielbezug) | die volle Meldung | ein kurzer Querverweis: Titel, ein Satz, Knöpfe „Zum Server …“ und „Beitreten“ |
| Spielserver und Hauptserver | voll | voll |
| nur Spielserver | voll | nichts |
| nur Hauptserver (Vorgabe ohne Spielbezug) | nichts | voll |

- Unter jeder Auswahl steht, wohin es geht, z. B. „geht an: CoD-Server (Events und Turniere),
  Hauptserver (Querverweis)“.
- Der **Querverweis** enthält nie den vollen Inhalt. Der Knopf zur Nachricht öffnet nur, wer auf
  beiden Servern ist; darum steht immer auch „Beitreten“ dabei.
- Hat das Spiel keinen eigenen Server, ist der Server aus, verlassen oder hat er keinen Kanal für
  die Meldung, geht sie **voll an den Hauptserver**. Scheitert der Versand am Spielserver, ebenso –
  statt eines Verweises ins Leere.
- **Private Meldungen** (Mitglieder, Vorstand, Betrieb, Test) gehen immer nur an den Hauptserver;
  dafür gibt es keine Auswahl.
- Im **Versandprotokoll** (Admin → Betrieb & Logs → Ereignisse) steht je Discord-Meldung der Server,
  ab zwei Servern mit Filter.

---

## 6. Wenn etwas nicht klappt

Erste Anlaufstelle: **Admin → Betrieb & Logs → Ereignisse, Quelle Discord.** Dort steht jede
Meldung mit „gesendet“, „nicht gesendet“ oder „fehlgeschlagen“ **und dem Grund in Worten**.
Fehlgeschlagene lassen sich dort erneut senden – immer an dasselbe Ziel.

| Fehlerbild | Ursache | Lösung |
| --- | --- | --- |
| Bot bleibt „offline“, Fehler nennt „Privileged intents“ | Server Members Intent im Developer Portal aus | Developer Portal → Bot → Server Members Intent an → Save |
| Bot bleibt „offline“, Fehler nennt den Token | Token falsch oder zurückgesetzt | neuen Token erzeugen und im Reiter „Bot & Aktivität“ eintragen |
| Keine Meldung, Log: „Der Bot ist aus“ | „Bot verbinden“ nicht angehakt | Reiter „Bot & Aktivität“ |
| Keine Meldung, Log: „Kein Kanal gewählt“ | Zweck ohne Kanal | Reiter „Meldungen“ → Kanäle je Zweck |
| Mitglieder-Turnier wird nicht gemeldet, Log: „Kein Mitgliederkanal gewählt“ | Kanal „Mitglieder (privat)“ fehlt | Reiter „Meldungen“ → Kanäle je Zweck → Mitglieder (4.2) |
| Keine Meldung, kein Eintrag im Log | Schalter für das Ereignis aus | Reiter „Meldungen“ → Was gemeldet wird |
| Kanal in der Auswahl ausgegraut | Bot darf dort nicht schreiben | Kanal → Bearbeiten → Berechtigungen → Rolle des Bots: Kanal ansehen, Nachrichten senden, Links einbetten |
| Privater Kanal fehlt in der Auswahl | Bot sieht den Kanal nicht | Rolle des Bots dem Kanal hinzufügen (2.4) |
| Turnier-Meldungen stehen einzeln im Kanal statt im Thread | Thread-Rechte fehlen | „Öffentliche Threads erstellen“ und „Nachrichten in Threads senden“ |
| Einbettung am Spielserver: „Diesem Server ist noch kein Spiel zugeordnet“ | kein Spiel zeigt auf diesen Server | Spiele → Spiel bearbeiten → „Discord-Server“ |
| Kein Termin am Spielserver | Recht „Events verwalten“ fehlt dort, oder der Server ist aus | Reiter „Server“ → „Prüfen“; Haken „an“ |
| Rollen werden nicht vergeben | Bot-Rolle steht unter den Rollen / Rollenname weicht ab / Person nicht verknüpft / Unterserver aus | Bot-Rolle nach oben ziehen; Namen im Reiter „Bot & Aktivität“ angleichen; Person verknüpft ihr Konto; Reiter „Server“: Haken „an“ und der Stand unter „Rollen“ |
| Spiel-Rolle fehlt | keine Rolle mit dem Namen im Discord / Person hat Spiel-Rollen ausgeschaltet | Rolle anlegen oder „Fehlende Rollen anlegen“; Name unter Admin → Spiele |
| Befehle erscheinen nicht | Unterserver aus; Einladung ohne `applications.commands` | Reiter „Server“: Haken „an“; „Prüfen“ sagt, ob sie registriert sind; sonst den Bot mit dem Link aus dem Reiter neu einladen |
| Direktnachrichten kommen nicht an | Datenschutz-Einstellung der Person | Discord → Einstellungen → Datenschutz → „Direktnachrichten von Servermitgliedern erlauben“ |
| Auf der Website keine Discord-Zahl | Server-Widget aus, oder niemand online | Servereinstellungen → Widget → aktivieren; „Jetzt prüfen“ |
| Unterserver bekommt keine Meldungen | Regel „nur Hauptserver“, Spiel ohne eigenen Server, Server aus oder ohne Kanal | Regel unter „Was gemeldet wird“, Spiel → „Discord-Server“, Kanäle im Reiter „Server“ (5.4) |
| „Einladung erstellen“ scheitert | Recht „Einladung erstellen“ fehlt | Recht geben oder Link von Hand eintragen |

---

## 7. Was die Website nie tut

- **Privates geht nie in einen öffentlichen Kanal**, und ein privater Kanal fällt nie auf einen
  öffentlichen zurück. Fehlt der Mitglieder- oder Vorstandskanal, wird nichts gesendet.
- **Bot aus = keine Meldung.** Es gibt keinen Umweg über andere Wege.
- **Nie @everyone oder @here.** Erwähnt wird höchstens die eine Rolle, die ihr bei den Stream-Meldungen wählt.
- **Der Bot liest keine Nachrichten.** Er zählt nur, dass jemand geschrieben hat.
- **Keine Namen aus dem Widget:** Die Website verwirft sie beim Abruf; gezeigt werden nur Zahlen.
- **In Direktnachrichten keine Texte anderer Personen**, keine Moderation, keine Zahlungsdaten.
- Auch in den privaten Vorstandskanal gehen keine Namen, Adressen oder Nachrichtentexte von
  Anträgen und Kontaktanfragen – nur der Hinweis mit Link in den Admin.

---

## 8. Häufige Fragen

**Brauche ich für jeden Server einen eigenen Bot?**
Nein. Ein Bot, beliebig viele Server – einladen über den Reiter „Server“.

**Kann der Vereins-Bot andere Bots ersetzen?**
Für Meldungen, Stream-Meldungen je Stream (wie bei Twitch-Bots), Rollen (die drei Vereinsrollen), Termine,
Willkommensnachricht und die Befehle: ja – das Aussehen gestaltet ihr im Reiter „Gestaltung“. Musik,
Moderation, Reaktionsrollen, Tickets kann er nicht.

**Wo ändere ich Name und Bild des Bots?**
Developer Portal → eure Anwendung → Bot → Username und Icon. Einen anderen Namen nur auf einem
Server: Spitzname im Server-Profil des Bots.

**Muss der Bot Administrator sein?**
Nein. Die zehn Rechte aus Abschnitt 3 genügen.

**Kann ich die Rollennamen ändern?**
Ja – im Discord und gleichlautend im Reiter „Bot & Aktivität“ → Rollen.

**Was passiert mit Rollen, die der Bot nicht kennt?**
Nichts. Der Bot fasst nur Mitglied, Vorstand und Turnierleitung an.

**Was passiert, wenn ich den Bot von einem Server entferne?**
Der Server bleibt im Reiter „Server“ als „verlassen“ sichtbar und bekommt nichts mehr. Holt ihr den
Bot zurück, ist alles wieder da.

**Ich habe den Token versehentlich gezeigt – was nun?**
Sofort im Developer Portal → Bot → „Reset Token“ und den neuen Token im Reiter „Bot & Aktivität“
eintragen. Der alte gilt danach nicht mehr.

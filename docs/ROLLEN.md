# Rollen und Rechte

Stand: Meilenstein „Web: Rollen und Rechte“ (#287–#292), Rollen nach Bereichen (#1300), Rollen II (#1350). Quelle der Wahrheit für
das, was eine Person im Adminbereich darf. Der Code dazu: `backend/services/permissions.py`
(Bereiche, Rollen, Vorstand), `backend/auth.py` (`require_area`), Web `frontend/src/lib/permissions.js`.

## Bereiche

Rechte hängen an Bereichen, nicht an einer Rangfolge. Eine Person kann mehrere haben.

| Bereich | Schlüssel | Was dazugehört |
| --- | --- | --- |
| Turnierleitung | `tournaments` | Turniere, Events, Stationen, Fast Lap, Saisons, Spiele, Gewinne, Strafen, Zugangslinks, PDF-Exporte |
| Redaktion | `content` | News, Galerie, Medien, Sponsoren, Partner, Referenzen, Serien (externe Wettbewerbe), Navigation, Sticker, Erfolge (Achievements), Seiten-Banner, Newsletter, Twitch-Streams |
| Vereinsverwaltung | `club` | Mitglieder und öffentliche Profile, Anträge, Dokumente, Vorteile, Vorstand, Kontakt-Inbox, Benutzerliste (lesen, bannen mit Grund – Konten mit Adminbereich oder Admin-Rolle bannt nur der Superadmin, Superadmin-Konten niemand), Discord-Zähler |
| Finanzen | `finance` | Kosten und Abrechnung an Events (später Turnieren), Finanzübersicht mit Rechnungsaufträgen, Freigaben (#322, docs/ABRECHNUNG.md), Rechnungsangaben: Zahlungsziel, Zahlungsart, Bankkonto, Sprache der PDFs, „Steuersätze geprüft“, „gleich freigeben“ (#1358), Vereinsshop: Produkte, Preise, Varianten, Bestellungen (#1704, docs/SHOP.md) – die übrige Dolibarr-Technik bleibt bei System |
| System | `system` | Einstellungen (Mail, Branding, Discord, Auth), Game-Server, Betrieb, Logs, Audit, App-Logs, Push-Tests, App-Versionen, E-Mail-Vorlagen, Wartungsläufe für Uploads |
| Moderation | `moderation` | Moderationsseite: Meldungen, Wortfilter, Bildprüfung, Verwarnungen und Chat-Sperren (bei Konten mit Adminbereich nur der Superadmin, siehe unten); Direktnachrichten an jede Person. Keine Turnierrechte – wer zusätzlich als Helfer eingetragen ist, hat dort genau die Rechte des Einsatzes |

## Wer hat welchen Bereich

| Rolle | Bereiche | Zwei-Faktor |
| --- | --- | --- |
| Superadmin | alle; vergibt Rollen und Freigaben | Pflicht |
| Club-Admin | alle | Pflicht (seit #291 auch für Mitgliederdaten und Einstellungen) |
| Turnierleitung (`tournament_admin`) | Turnierleitung, Moderation | Pflicht |
| Moderator | Moderation | nicht nötig |
| Spieler | keiner – außer Freigaben oder Vorstandsposten | – |

**Freigaben:** Der Superadmin kann einer Person einzelne Bereiche geben (Admin → Alle Benutzer):
Turnierleitung, Redaktion, Vereinsverwaltung, Finanzen. System bleibt an Club-Admin und Superadmin gebunden.
Jede Freigabe steht im Audit-Log. Eine Freigabe zählt überall genauso wie die Rolle (#1350): Wer die
Turnierleitung über eine Freigabe hat, arbeitet in jedem Turnier, jeder Fast Lap, an den Stationen und bei
den Events wie mit der Rolle (Status, Turnierbaum, Anmeldungen, Check-in, Ergebnisse). Der Server prüft dafür
den Bereich (`services/permissions.is_tournament_lead`), nicht eine Rollenliste.

**Vorstand:** Wer einen aktiven Vorstandsposten hält oder vertritt (Admin → Vorstand), hat die
Vereinsverwaltung von selbst. Die Besetzung der Posten ist damit eine Rechtevergabe – deshalb (#1355): besetzt
wird über die Personensuche nur mit Vereinsmitgliedern (der Server lehnt andere ab), vorher nennt ein Satz die Rechte
(„… wird Kassier:in und bekommt damit die Vereinsverwaltung: Mitgliederdaten, Anträge, Dokumente, Benutzer.“), eine
Rückfrage bestätigt, und jede Besetzung steht im Protokoll (`board.assign`). Kommen die Rechte aus Dolibarr-Funktionen,
sagt der Satz „Der Posten ist nur für die Anzeige – die Rechte kommen aus Dolibarr.“ Führt Dolibarr den Vorstand,
lässt sich hier nichts ändern (Server: 409). Besetzen dürfen Vereinsverwaltung und System.

**Vorstand aus Dolibarr (#297):** Ist die Mitgliederverwaltung angebunden (Modus „Live“) und hat der
Superadmin unter Admin → Dolibarr → Bereiche freigegeben, welche Funktion die Vereinsverwaltung
öffnet, dann gilt **nur noch das**: Beginnt die Funktion in Dolibarr, ist der Bereich da; endet sie,
ist er beim nächsten Abgleich weg – ohne neues Anmelden. Der lokal gepflegte Vorstandsposten
verleiht dann nichts mehr, weil er sich redaktionell ändern lässt. Ableitbar ist allein die
Vereinsverwaltung, nie System, Moderation, Rollenvergabe oder Geldfreigaben; Rechnungsprüfung ist
eine Funktion, aber kein Vorstand. Zwei-Faktor bleibt Pflicht. Liegt der letzte gelungene Abgleich
mehr als 48 Stunden zurück, ruhen diese Rechte – die Mitgliedschaft nicht. Ausdrücklich vergebene
Freigaben bleiben davon unberührt. Anleitung: `docs/DOLIBARR.md`.

**Pro Turnier:** Unabhängig von der Rolle kann eine Person je Turnier zugewiesen werden
(Turnierseite → Staff: organizer, referee, scorekeeper, station_manager, stream_operator).
Ein `organizer` darf in seinem Turnier alles – Struktur, Ergebnisse, Check-in, Stationen und die
Gewinne dieses Turniers (#288). Ergebnisse eintragen dürfen außerdem `referee`, `scorekeeper` und die Station-Crew
(`station_manager`, Entscheidung zu #1139 – alles steht im Protokoll, die Turnierleitung kann korrigieren); sie alle
bekommen Dispute und abweichende Ergebnis-Meldungen ihres Bereichs sofort gemeldet (#1132, #1134). Das braucht
keinen Bereich und keine Zwei-Faktor-Anmeldung.
Die Ansicht „Turnierleitung“ (`/tournaments/<slug>/leitung`, in der App „Turnierleitung öffnen“, #1156) sehen alle
Helfer des Turniers; eintragen, „Rückgängig“ (nur der letzte Eintrag) und Streitfälle entscheiden (#1158) darf je Spiel
nur, wer dort Ergebnis-Recht hat – die Station-Crew nur an ihrer Station. „Braucht Aufmerksamkeit“ (#1160: Ergebnis
fehlt, Station defekt) geht an genau diese Leute. Fotos vom Ergebnis (#1157) sehen nur die Spieler des Spiels und die
Turnierleitung dieses Turniers; Moderatoren nur, wenn die Bildprüfung ein Foto zur Prüfung vorlegt.
Dasselbe gilt je Fast Lap (Challenge → Staff). Turnierrechte, Fast-Lap-Zeiten, Events und Exporte
kommen nur aus dem Bereich Turnierleitung (Rolle oder Freigabe), Club-Admin, Superadmin oder einem solchen
Einsatz – auch für Moderatoren.

## Shop (#1704)

Der Vereinsshop hängt am Bereich **Finanzen** – kein eigener Bereich, Zwei-Faktor Pflicht. Der Server prüft jede
Route mit `require_area("finance")`; `scripts/check-code-patterns.py` (Regel 3) lässt keine Shop-Route ohne diesen
Wächter und keine öffentliche Shop-Route außer den dort einzeln freigegebenen durch. Jede Änderung steht mit Person und Grund in den Adminaktionen, nie mit
Anschrift (docs/SHOP.md).

| Shop-Admin (`/api/admin/shop/…`) | Spieler | Mitglied | Turnierleitung | Finanzen (Freigabe) | Club-Admin | Superadmin |
| --- | --- | --- | --- | --- | --- | --- |
| Produkte und Bestellungen lesen | – | – | – | ja | ja | ja |
| Produkt anlegen, ändern (Preis, Sichtbarkeit) | – | – | – | ja, mit Grund | ja, mit Grund | ja, mit Grund |
| Variante anlegen, ändern | – | – | – | ja, mit Grund | ja, mit Grund | ja, mit Grund |
| Einstellungen lesen (#1706) | – | – | – | ja | ja | ja |
| Stufe Aus / Nur Admins / Vereinsmitglieder, Notschalter, Preise | – | – | – | ja, mit Grund | ja, mit Grund | ja, mit Grund |
| Stufe „Öffentlich“ einschalten (nur mit „Steuer geklärt“) | – | – | – | – | – | ja, mit Grund |
| Freigabe „Steuer geklärt“ (#1701) | – | – | – | – | – | ja, mit Grund |
| Printful-Schlüssel hinterlegen, entfernen (braucht zusätzlich System) | – | – | – | – | ja, mit Grund | ja, mit Grund |
| Printful-Verbindung testen (nur lesen) | – | – | – | ja | ja | ja |
| Designs und Druckbereiche lesen (#1708) | – | – | – | ja | ja | ja |
| Druckdatei hochladen, Shirtfarben, Druckbereich ändern (#1708) | – | – | – | ja, mit Grund | ja, mit Grund | ja, mit Grund |
| Produkt aufbauen: Printful-Produkt, Farben und Größen, Platzierungen, Designs, Preise übernehmen (#1707) | – | – | – | ja | ja | ja |
| Prüfen, zurückziehen, archivieren (#1707) | – | – | – | ja | ja | ja |
| Veröffentlichen (nur nach bestandener Prüfung, #1707) | – | – | – | ja, mit Grund | ja, mit Grund | ja, mit Grund |
| Mit Printful abgleichen (#1709) | – | – | – | ja | ja | ja |
| ohne bestätigte Zwei-Faktor-Anmeldung | – | – | – | – | – | – |

Moderator und Vereinsverwaltung (Vorstand) haben keinen Zugriff, solange ihnen Finanzen nicht ausdrücklich
freigegeben ist. Einzige öffentliche Shop-Route ist die Druckdatei für Printful
(`/api/shop/print-files/<Zufallsschlüssel>/<design>-v<version>.png`, #1708) - ohne Anmeldung, aber nur mit dem
256-Bit-Schlüssel der Version; bewusst in Regel 3 freigegeben. Shop-Seiten für Mitglieder und Öffentlichkeit gibt es noch nicht (#1712); wer sie sehen darf,
entscheidet dann die Stufe (`services/shop_access.py`):

| Stufe | Gast | Spieler | Mitglied | Turnierleitung | Finanzen | Club-Admin | Superadmin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Aus (Vorgabe) | – | – | – | – | – | – | – |
| Nur Admins (Test) | – | – | – | – | ja | ja | ja |
| Vereinsmitglieder | – | – | ja | – | ja | ja | ja |
| Öffentlich | ja | ja | ja | ja | ja | ja | ja |

Finanzen, Club-Admin und Superadmin zählen nur mit bestätigter Zwei-Faktor-Anmeldung; als Mitglied geht es ohne.

## Bannen, Strikes und Chat-Sperren (#1300, #1350)

1. **Superadmin-Konten lassen sich nicht bannen** – auch nicht von einem anderen Superadmin. Wer gebannt
   werden soll, verliert zuerst die Rolle; danach gilt der normale Weg. Der Server antwortet: „Superadmin-Konten
   lassen sich nicht bannen. Zuerst die Rolle ändern.“
2. **Konten mit Adminbereich oder Admin-Rolle** – aus Rolle, Freigabe, Vorstandsposten oder Dolibarr-Funktion –
   bannt und entbannt nur der Superadmin. Derselbe Schutz gilt in der Moderation: Strikes, Chat-Sperren
   (Hinweis, Verwarnung, Sperre), eine Meldung als „berechtigt“ (zählt als Strike), Aufheben, Zurücknehmen und
   Einsprüche bei solchen Konten setzt nur der Superadmin – bei einem Strike mit Grund, der im Protokoll steht.
   Die Moderation sieht in „Personen“ statt der Knöpfe den Satz „Konto mit Adminbereich – Strikes und
   Chat-Sperren setzt und nimmt nur der Superadmin zurück.“, die Benutzerliste den passenden Satz zum Bannen.
3. Das eigene Konto bannt niemand. Gebannt wird immer mit Grund (mindestens fünf Zeichen); der Grund steht im
   Protokoll.
4. **Team-Chats bleiben zu:** Moderatoren öffnen Team-Chats nicht ohne Meldung; gemeldete Nachrichten sehen sie
   in der Moderation.
5. Normale Konten sperrt und verwarnt die Moderation wie bisher. Automatische Strikes (Wortfilter, Bildprüfung)
   kommen vom System, nicht von einer Person.

## Alle Benutzer (#1357)

Die Liste ist nur zum Lesen: Name, Konto-Art, Rolle als Wort, Bereiche als Schilder, gesperrt ja/nein. „Bearbeiten“
öffnet ein Seitenblatt (am Handy als ganze Seite):

- **Superadmin:** ändert Rolle und Freigaben – erst mit „Speichern“ und einer Rückfrage, die in einem Satz sagt, was die
  Person bekommt oder verliert („Erika Beispiel bekommt damit Zugriff auf Vereinsverwaltung (Mitgliederdaten, Anträge,
  Dokumente und Benutzer).“). Unter „Mehr“: „Zugangs-Mail erneut senden“ (mit Rückfrage) und „Konto löschen“ (erst
  nach Eintippen des Namens).
- **Club-Admin und Vereinsverwaltung:** sehen Rolle und Bereiche als Text, ohne Auswahl, und sperren Spieler-Konten mit
  Grund. Die Person bekommt den Grund per Mail („Konto gesperrt“); er steht auch im Protokoll.
- Zum Mitgliedsantrag eingeladen wird auf „Bewerbungen“ (#1356); das Blatt zeigt nur den Stand („eingeladen am …“).

## Bewerbungen (#1356)

Oben steht „+ Zum Antrag einladen“ mit der Personensuche (nur Konten ohne Mitgliedschaft; wer schon eingeladen ist,
steht mit „ist schon eingeladen – offen seit …“ da). Einladen darf nur die Vereinsverwaltung; ein Mitglied bekommt
einen Hinweis statt einer Einladung, eine zweite Einladung ist die bestehende. Jeder Stand steht als Satz mit dem
nächsten Schritt („Wartet auf Dolibarr – dort annehmen oder ablehnen, hier erscheint es von selbst“, „Offen – annehmen
oder ablehnen“, „Aufgenommen am …“); Annehmen und Ablehnen gibt es nur, wo die Website entscheidet – Anträge über
Dolibarr öffnet „In Dolibarr öffnen“.

## Newsletter am Beitrag (#1359)

Der Kasten „Verteilen“ im News- und Event-Editor zeigt, was hinausgeht: den Newsletter mit der Zahl der Empfänger (nie
Namen oder Adressen) und „Jetzt senden“ bzw. „gesendet am … an …“, die Meldung an Mitglieder oder Vorstand und die
Discord-Vorschau. Den Newsletter einer **News** schicken Redaktion und System, den eines **Events** auch, wer das Event
bearbeiten darf (Turnierleitung; Entscheidung vom 07.10.2026). **Ein zweites Mal** senden nur Redaktion und System, immer
mit Rückfrage. Entwürfe und „Nur intern“ gehen nicht als Newsletter hinaus und gelten nicht als gesendet. Unter
E-Mail → Newsletter steht für System nur noch der Verlauf.

## Adventkalender und Ostereiersuche schalten (#1360)

Wer den Adventkalender oder die Ostereiersuche füllt – **Redaktion und Vereinsverwaltung** (und System) –, schaltet sie
oben auf der eigenen Seite ein und aus und wählt, wo sie erscheinen (Website, App). Der Server-Weg
(`PUT /api/seasonal/switch/{key}`) kennt nur diese zwei; jede Änderung steht im Protokoll (`seasons.switch`). Unter
Auftritt → Jahreszeiten stehen beide nur noch zum Lesen; den Hauptschalter, Deko, Wetter und alle anderen Jahreszeiten
schaltet weiter System.

## Anmeldungen & Einlass (#1372)

Die Arbeitsseite `/events/<slug>/leitung` (`GET /api/events/{id}/lead`) und **„Nachricht an alle Angemeldeten“**
(`POST /api/events/{id}/lead/message`) sind **Turnierleitung** mit Zwei-Faktor – wie Liste und Ändern der Anmeldungen
bisher. Vorstand (Vereinsverwaltung), Moderation und Angemeldete bekommen 403; der Vorstand sieht die Teilnehmer weiter
auf der Event-Seite (#397). Eine Zeile trägt Name, Status, Plätze, Begleitpersonen, den Merker „hat Notiz“ und die Mail-Adresse nur
gekürzt (`p***@…`) – keine Konto-Kennung, kein Geld; die Notizen holt die Detailansicht je Anmeldung
(`GET /api/events/{id}/lead/registrations/{rid}`, ebenfalls Turnierleitung). Geändert wird über den vorhandenen Weg
`PATCH /api/events/{id}/registrations/{rid}` (Plätze, Preis, Belohnung). Die Nachricht geht nur mit der bestätigten
Empfängerzahl hinaus, je Person einmal an alle mit „angemeldet“ oder „da“ (ohne gesperrte, deaktivierte und gelöschte Konten), als Benachrichtigung und – wenn die Person
Mails zu „Turnier-Updates“ zulässt – als Mail über die Warteschlange; höchstens eine je Minute und Event und je Absender. Protokoll:
`event_messages` und Audit `event.message.send`. Ein Einlass-Helfer mit eingeschränkter Sicht (nur Suchen und
Einchecken) folgt mit #1375. Code: `services/event_lead.py`.

## Fotos vom Event (#1185, #1186)

**Einsenden** dürfen Mitglieder (wer Mitglieder-Inhalte sieht, siehe unten) – nur ins Album eines Events, vom ersten
Event-Tag bis sieben Tage nach dem letzten, höchstens 20 Bilder je Person und Album und nur mit dem Haken „Die Personen
auf den Fotos sind einverstanden“. Gäste sehen den Knopf nicht. Jedes Bild wird neu gespeichert (ohne EXIF und GPS-Ort),
liegt bis zur Freigabe privat und geht durch die Bildprüfung. **Freigeben oder ablehnen** dürfen Redaktion und
Vereinsverwaltung (also auch der Vorstand) – an einem Ort, Admin → Content → Galerie (Kasten „Eingesandte Fotos“); wer nur die Vereinsverwaltung hat, sieht
dort nur die Einsendungen, nicht die Alben-Verwaltung. Freigeben geht erst, wenn die Bildprüfung nichts gefunden hat;
abgelehnte Bilder werden gleich gelöscht. Jede Entscheidung steht im Protokoll (`gallery.submission_approve`,
`gallery.submission_reject`). **„Die Fotos sind da“** geht einmal je Album an die Angemeldeten des Events (Event und
Turniere, Teams mit allen Mitgliedern) unter „Turnier-Updates“ – bei Mitglieder-Alben nur an Mitglieder, unter
„Vereinsintern“. Code: `services/event_photos.py`.

## Mitglieder-Inhalte (#1350)

Inhalte mit der Sichtbarkeit „Nur Mitglieder“ – News, Events, Galerie, Dokumente wie Protokolle, Spielserver,
Seiten-Banner – und der Mitgliederbereich (Discord-Kanäle, Steam-Status) sehen **aktive Mitglieder und
Ehrenmitglieder** sowie, wer den Bereich **Vereinsverwaltung oder System** hat (über Rolle, Freigabe,
Vorstandsposten oder Dolibarr-Funktion). Die Rolle Turnierleitung allein reicht dafür nicht; Moderatoren und die
Turnierleitung sehen Mitglieder-Inhalte als Mitglied. Code: `services/visibility.sees_member_content`.

Ausnahme mit Grund: **Events, Turniere und Fast Laps** gehören zur Turnierleitung – sie legt sie an, checkt beim
Einlass ein und wertet aus. Mit dem Bereich Turnierleitung (Rolle oder Freigabe) sieht man sie deshalb auch mit
„Nur Mitglieder“ (Listen, Event-Seite, Kalender, Suche, App), Alben und News am Event dagegen nur als Mitglied
oder mit Vereinsverwaltung/System. Code: `services/visibility.lead_can_see`.

Im **Kalender** (`GET /api/calendar`, Web `/calendar`, App-Monat im Tab Events) stehen seit #1190 auch
**Versammlungen und die eigenen Helferschichten** (Art `club`, grün) – nur für Konten mit Weg zur Vereinsakte, und nur
die Sitzungen, zu denen die Person im Vereinsmodul eingeladen ist (der Vorstand so auch seine Vorstandssitzungen),
sowie die Schichten, für die sie eingetragen ist. Ohne Namen anderer, Tagesordnung oder Einwahl-Link; ein Tipp führt
in den Mitgliederbereich. Der öffentliche Abo-Feed bleibt ohne sie. Interne Events stehen nicht mehr zusätzlich im
Mitgliederbereich, sondern bei den Events und im Kalender. Code: `services/club_calendar.club_items`.

**„Nur meine“ und persönlicher Kalender-Link (#1189):** `GET /api/calendar/mine` sagt nur der angemeldeten Person, wofür
sie dabei ist (Event-Anmeldung, Turnier selbst oder mit einem eigenen Team, Fast Lap gefahren). Den privaten Abo-Link
erzeugt, erneuert und schaltet jede Person nur für sich selbst (`/api/calendar/personal`); gespeichert ist nur der Hash
des Tokens, die Adresse zeigt die Website einmal. Der Feed `GET /api/calendar/personal/{token}.ics` enthält nur, was die
Person selbst sehen darf und wofür sie angemeldet ist, dazu ihre zugesagten Versammlungen und eigenen Schichten – ohne
Sitzung gilt dort keine Zwei-Faktor-Ausnahme der Turnierleitung. Gesperrte oder abgeschaltete Konten bekommen nichts,
beim Löschen des Kontos fällt der Link weg. Code: `services/personal_calendar.py`.

Die Team-Seite in Web und App folgt dem Server: Team bearbeiten und Squads dürfen Leitung, Co-Leitung, Turnierleitung,
Club-Admin und Superadmin; Mitglieder entfernen Leitung, Co-Leitung, Club-Admin und Superadmin; auflösen Leitung,
Club-Admin und Superadmin. Moderatoren sehen auf fremden Team-Seiten keine Verwaltungs-Knöpfe. Die Admin-Rollen zählen
dabei – wie überall – nur mit bestätigter Zwei-Faktor-Anmeldung (#1469); Leitung und Co-Leitung brauchen sie für ihr
Team nicht. Seit #1479 schickt der Server das fertige Ergebnis mit (`can_manage`, `can_remove_members`,
`can_dissolve`); fehlt einer Admin-Rolle nur die Zwei-Faktor-Anmeldung (`admin_needs_second_factor`), steht statt der
Knöpfe „2FA einrichten“ da.

**„Spielst du auch mit?“ (#1184):** nach der Event-Anmeldung meldet `POST /api/events/{id}/play-along` die gewählten
Einzel-Turniere des Events an – nur mit Konto, nur für die Person selbst. Je Turnier läuft die normale Selbstanmeldung
mit allen Regeln (Sichtbarkeit, Frist, Event-Pflicht #875, Startgeld #319, voll → Warteliste); es gibt keine Abkürzung.
Team-Turniere meldet weiter die Teamleitung auf der Turnierseite an, Turniere anderer Events lehnt der Weg ab. Die
Auswahl (`GET …/play-along`) zeigt nur Turniere und Fast Laps, die die Person sehen darf. Code:
`services/event_play_along.py`.

**Event als Klammer in der Verwaltung (#1371):** Turniere und Fast Laps verbindet nur noch das Event – Abschnitt
„Programm“ (`GET/POST /api/events/{id}/program`, `DELETE …/program/{kind}/{id}`, Anlegen mit Vorbelegung über
`POST /api/events/{id}/tournaments` und `…/fastlaps`). Das ist Turnierleitung mit Zwei-Faktor wie das Bearbeiten des Events;
Helfer eines Turniers (auch Organisation) ordnen nichts zu. Turnier- und Fast-Lap-Formular ändern das Event nicht. Welche
Sponsoren bei welchem Event erscheinen, legt nur die **Redaktion** beim Sponsor fest (bei allen oder bei ausgewählten Events);
das Event zeigt sie an und nimmt keine eigene Auswahl mehr an. Code: `services/event_program.py`.

In der App fragt die Team-Seite dieselben Rollen wie der Server: Team bearbeiten und Squads dürfen Leitung,
Co-Leitung, Turnierleitung, Club-Admin und Superadmin; Mitglieder entfernen Leitung, Co-Leitung, Club-Admin und
Superadmin. Moderatoren sehen auf fremden Team-Seiten keine Verwaltungs-Knöpfe. Die Admin-Rollen zählen dabei –
wie überall – nur mit bestätigter Zwei-Faktor-Anmeldung (#1469); Leitung und Co-Leitung brauchen sie für ihr Team nicht.

## Personen, Teams und Sponsoren wählen (#1354)

Wo die Verwaltung eine Person wählt, sucht sie nach dem Namen (`GET /api/admin/people/search?purpose=…`). Treffer
tragen nur Kennung, Name, Bild und eine Zeile Zusammenhang („Mitglied“, „Team Lions Rocket“, „angemeldet“) –
höchstens zehn, nie E-Mail-Adresse oder Rolle; eine E-Mail-Adresse als Suchbegriff findet nichts. Die volle
Kontoliste mit E-Mail-Adressen bleibt bei „Alle Benutzer“ (Vereinsverwaltung).

| Zweck | Wo | Wer darf suchen | Wen findet die Suche |
| --- | --- | --- | --- |
| `tournament` | Turnier: Teilnehmer hinzufügen, Helfer | Turnierleitung (Rolle oder Freigabe) und Helfer dieses Turniers mit Organisation, Schiedsrichter oder Ergebnisdienst – nicht Stationsleitung oder Stream-Betreuung | aktive Konten |
| `fastlap` | Fast Lap: Fahrer, Fast-Lap-Team | Turnierleitung und Helfer dieser Fast Lap | aktive Konten (mit „Vereinsmitglied ja/nein“ für die Wertung) |
| `access_links` | Speziallinks | Turnierleitung | aktive Konten |
| `board` | Vorstand besetzen | Vereinsverwaltung, System | nur Vereinsmitglieder (und gepflegte Mitgliederprofile ohne Konto) |
| `invite` | Bewerbungen: zum Antrag einladen | Vereinsverwaltung | Konten ohne aktive Mitgliedschaft, mit „ist schon eingeladen“ |
| `reference_series` | Serien: Captain einer Saison hinzufügen (#1749) | Redaktion | nur aktive Vereinsmitglieder |

Teams kommen als kleine Auswahl (`GET /api/admin/choices/teams?tournament_id=…`, wie `tournament`), Event-Sponsoren
mit dem Haken „Events“ nur mit Name und Logo (`GET /api/admin/choices/sponsors`: Turnierleitung, Redaktion, System).
Jede Liste lädt für sich: fehlt ein Recht, steht an der Stelle ein Satz, der Rest der Seite geht weiter.

## Externe Serien: Vorstand und Captains (#1749)

Ergebnisse externer Serien trägt der Vorstand ein – der Bereich Redaktion darf jede Serie. Zusätzlich kann der Vorstand
je Saison Captains eintragen, die nur für diese eine Saison Ergebnisse und Scoreboards hochladen.

| Was | Redaktion (Vorstand) | Captain dieser Saison | Captain einer anderen Saison, alle anderen |
| --- | --- | --- | --- |
| Spur und Saison anlegen, bearbeiten, archivieren, Regeln ändern | ja | nein | nein |
| Captains hinzufügen, Ablauf und Veröffentlichen-Recht ändern, entfernen | ja | nein | nein |
| Saison in der Verwaltung öffnen | ja | ja | nein |
| Kalender der Saison ansehen (#1742) | ja | ja, nur lesen | nein |
| Termine anlegen, einfügen, verschieben, absagen, ordnen (#1742) | ja | nein | nein |
| Ergebnisse eintragen (Entwurf, #1744) | ja | ja | nein |
| Ergebnisse veröffentlichen | ja | nur wenn die Saison auf „Captain veröffentlicht direkt“ steht oder der Captain das Recht „Darf veröffentlichen“ hat | nein |
| Entwurf eines Captains freigeben oder verwerfen (#1744) | ja | nein | nein |
| Original-Bilder je Termin hochladen und einordnen (#1933) | ja | ja – als Entwurf, eigene Entwürfe einordnen; direkt freigegeben mit Recht zum Veröffentlichen | nein |
| Original-Bild einzeln freigeben oder löschen (#1933, Löschen im Adminprotokoll) | ja | nein | nein |
| Partner-Plattform einstellen, Turniertage holen und als Entwurf übernehmen (#1964) | ja | nein | nein |
| Saisontabelle einlesen, vergangene Runden als Entwurf nachtragen (#1928) | ja | nein | nein |
| Saison- und Teamtabelle per Bild lesen, Teamwertung laut Veranstalter übernehmen (#1999) | ja | nein | nein |

- **Zwei-Faktor ist Pflicht** – für den Vorstand wie für Captains (Entscheidung 7 des Obmanns). Ohne bestätigte
  Zwei-Faktor-Anmeldung antwortet der Server mit dem Hinweis darauf; das Web führt zur Einrichtung.
- **Nur Vereinsmitglieder:** Captain kann nur werden, wer aktives Vereinsmitglied ist (aktiv oder Ehrenmitglied).
  Endet die Mitgliedschaft, endet das Captain-Recht beim nächsten Aufruf; der Vorstand sieht den Eintrag mit Hinweis.
- **Ablauf:** jeder Captain hat einen letzten Tag (`valid_until`, Wiener Tag, einschließlich, Pflicht – ein Recht ohne
  Ende gibt es nicht). Ab dem Tag danach gilt es nicht mehr, ohne neue Anmeldung: der Server prüft bei **jedem** Aufruf.
  In einer archivierten Saison haben Captains kein Recht mehr.
- **Standard:** Einträge eines Captains sind Entwürfe, der Vorstand gibt frei. Direkt veröffentlichen geht nur, wenn
  der Vorstand es je Saison (`publish_mode`) oder je Captain (`can_publish`) einschaltet.
- **Veröffentlichte Ergebnisse:** Wer nicht veröffentlichen darf, ändert ein veröffentlichtes Ergebnisblatt nie
  direkt. Die Änderung wird ein neuer Entwurf daneben, den der Vorstand freigibt; bis dahin bleibt das veröffentlichte
  Blatt sichtbar (`SeriesAccess.edit_target`).
- **Kennungen:** Termine, Ergebnisblätter und Teilnehmer gehören zur Saison aus dem Pfad; eine Kennung aus einer
  anderen Saison antwortet mit 404 – auch für den Vorstand.
- **Wo:** Captains verwaltet der Vorstand auf der Seite der Saison (Admin → Serien → Saison → „Captains“). Ein Captain
  sieht seine Saisons unter „Mein Dienst“ → „Meine Serien“ (`/admin/dienst`); `/admin` führt Captains ohne
  Verwaltungsbereich dorthin. Die Seite der Saison zeigt ihm keine Knöpfe des Vorstands.
- **Protokoll:** Hinzufügen, Ändern und Entfernen stehen im Adminprotokoll (`reference_series.staff_add`,
  `reference_series.staff_update`, `reference_series.staff_remove`) mit Vorher und Nachher; Ergebnisse mit
  `reference_result.save`, `.pending_draft`, `.approve` und `.discard`, der alte Stand als Revision
  ([API zum Eintragen](entwicklung/serien-ergebnisse.md)).
- **Code:** `services/reference_series_access.py` (`require_series_editor`, `SeriesAccess`), Verwaltung in
  `routes/reference_staff_routes.py`.

## Liga: Co-Team mit Captain und Vertreter (#1649)

In der Liga spielt ein **Co-Team** (Squad eines Vereinsteams) – Vertrag in [`LIGA.md`](LIGA.md). Jedes Co-Team hat
höchstens einen **Captain** und einen **Vertreter**; beide stehen im Kader des Co-Teams und sind verschiedene Personen.

| Was | Turnierleitung (mit Zwei-Faktor) | Teamleitung, Co-Leitung des Hauptteams | Captain | Vertreter | Kader des Co-Teams |
| --- | --- | --- | --- | --- | --- |
| Co-Team einer Staffel zuteilen oder herausnehmen | ja | nein | nein | nein | nein |
| Kader pflegen, Captain und Vertreter vergeben | ja (Team-Admin-Rollen) | ja | nein | nein | nein |
| Termin vorschlagen, annehmen; einchecken | ja | nur ohne Captain und Vertreter | ja | ja | nein |
| Ergebnis melden, bestätigen, Einspruch | ja | nur ohne Captain und Vertreter | ja | ja | nein |
| Matchchat schreiben, Spiel-Hinweise (Aufruf, Erinnerung, Ergebnis) | ja | ja | ja | ja | ja |

- **Rückfall:** Hat ein Co-Team weder Captain noch Vertreter, handeln Leitung und Co-Leitung des Hauptteams – niemand
  sperrt sich aus. Sobald eine Rolle vergeben ist, gilt sie ohne neue Anmeldung.
- **Kader:** Wer Captain oder Vertreter ist, verlässt Kader und Team erst, wenn die Rolle neu vergeben ist (in derselben
  Änderung geht es). Übrige Mitglieder des Hauptteams bekommen zu Liga-Spielen ihres Teams keine Nachrichten.
- **Löschen:** Ein Co-Team mit Anmeldung in einer laufenden Staffel lässt sich nicht löschen.
- **Zuteilen** (Admin → Turnier → Teilnehmer → „Co-Team zuteilen“, `POST /api/tournaments/{tid}/squad-registrations`,
  Bereich Turniere): Co-Team gehört zum Hauptteam, ist aktiv und fürs Spiel der Staffel, Kader mindestens Mindestkader,
  alle im Hauptteam, Staffel nicht voll, zwei Co-Teams desselben Teams nie in derselben Staffel, ein Co-Team je Season
  nur in einer Staffel. Die Anmeldung heißt „Team · Co-Team“; die Teamleitung meldet sie nicht selbst ab.
- **Protokoll:** `team.squad.roles` (vorher und nachher), `league.squad.assign`, `league.squad.remove`.
- **Code:** Regel in `services/match_audience.py` (`responsible_ids`, `player_ids`, `responsible_registration`),
  Zuteilen in `services/squad_registration.py`, Rollen in `routes/team_routes.py`.

## Zwei-Faktor und Anmeldung (#348)

- **Pflicht** ist Zwei-Faktor für jeden Adminbereich außer Moderation – egal, ob der Bereich aus
  der Rolle, einer Freigabe, einem Vorstandsposten oder einer Dolibarr-Funktion kommt.
- **Freiwillig** kann ihn jedes Konto einrichten (Profil → Sicherheit). Wer ihn eingerichtet hat,
  wird beim Anmelden mit Passwort nach dem Code gefragt.
- **Passkey zählt als zweiter Faktor** (Entscheidung vom 22.09., #358): Ein Passkey-Login verlangt
  immer die Gerätesperre (Fingerabdruck, Gesicht oder Geräte-PIN) – Gerät plus Sperre sind zwei
  Faktoren, so wie bei Google, Apple und GitHub. Nach dem Passkey kommt deshalb kein Code mehr, und
  die Sitzung gilt als bestätigt, auch für Adminbereiche. Die Einrichtung des Codes bleibt für
  Adminbereiche Pflicht (Rückweg, wenn das Gerät weg ist).
- Wer einen Adminbereich betritt und noch keinen hat, landet unter Profil → Sicherheit mit der
  Erklärung, warum. Das gilt auch für die Turnierleitung auf den Turnierseiten (Turniere, Fast Lap,
  Stationen, Turnierbaum-TV, #1028); Helfer mit Einsatz kommen dort ohne Zwei-Faktor hinein. Menü und
  Knöpfe zeigen ohne bestätigte Zwei-Faktor-Anmeldung keine Verwaltungs-Einträge, sondern „2FA einrichten“.
  Die Verwaltungsliste der Turniere zeigt Helfern nur die Turniere ihres Einsatzes.
- Knöpfe in Turnier, Fast Lap und Stationen (#1353) richten sich nach dem, was der Server je Turnier schickt
  (`tournament_rights` in `services/tournament_permissions.py`): `can_manage_results` (irgendwo im Turnier – öffnet die
  Turnierleitung am Handy), `can_manage_all_results` und `can_plan_matches` (alle Spiele, nur mit Einsatz für das ganze
  Turnier), `can_manage_structure`, `can_check_in`, `can_manage_participants`, `can_assign_stations`,
  `can_use_staff_tools` – dieselben Rollen und Scopes wie die Wächter der Routen. Einsätze für einzelne Spiele, Phasen,
  Gruppen oder Stationen stehen in `staff_scopes`; das Web zeigt Ergebnis- und Termin-Knöpfe nur bei den Spielen, die
  sie abdecken (`lib/tournamentRights.js`). „Neues Turnier“, „Löschen“, Team, Einstellungen und der Reiter „Bearbeiten“
  nur mit der Turnierleitung über alle Turniere (`isTournamentLead`).
- Die Startseite der Verwaltung (`/admin/dashboard`, #1353) schickt jeden Block nur dem Bereich, dem er gehört:
  Turnier-Zahlen und Termine heute der Turnierleitung, Mitgliederzahlen und Anträge der Vereinsverwaltung, Meldungen der
  Moderation, Sponsoring der Redaktion, Abrechnung und Belege den Finanzen, Betrieb, Push, App-Logs, Discord und das
  ganze Protokoll System. Die Liste „Letzte Adminaktionen“ (nur was wann) bekommen Turnierleitung, Redaktion und
  Vereinsverwaltung, der Kassier nicht; das Wachstum (`/admin/growth-stats`) nur Vereinsverwaltung und System. Ein Wächter-Test (`frontend/src/lib/adminRights.test.js`) meldet `isAdmin` in
  `pages/admin`; die Bereichslisten von Web und Server vergleicht `frontend/src/lib/permissions.parity.test.js`.
- **Angemeldet bleiben** (Haken im Login, Standard an): 90 Tage, die mit jeder Nutzung neu
  beginnen. Ohne Haken endet die Sitzung mit dem Browser.

## Wer bekommt interne Meldungen (App 0.7.0-beta)

Wird ein internes Event oder eine interne News veröffentlicht, meldet der Server
das einmal – als Push in der App und in der Glocke der Website – und nur an die,
die den Inhalt sehen dürfen:

| Sichtbarkeit | Empfänger |
| --- | --- |
| Nur Mitglieder | aktive Mitglieder und Ehrenmitglieder |
| Nur intern (Vorstand) | wer die Vereinsverwaltung hat – über Rolle, Freigabe, Vorstandsposten oder Dolibarr-Funktion |
| Öffentlich / Community | niemand über diesen Weg (dafür gibt es Newsletter und Discord) |

Wer die Meldung nicht will, schaltet das Thema „Vereinsintern“ unter Profil →
Benachrichtigungen ab. Es hängt nicht am Newsletter.

## Was nicht mehr gilt

- Eine Turnierleitung darf keine News, Galerie, Sponsoren oder Partner mehr bearbeiten.
- Die Rolle `team_leader` gibt es nicht mehr; Teamleitung läuft pro Team (Teamseite). Bestehende
  Konten wurden beim Start auf `player` gesetzt, mit Audit-Eintrag.
- Mitgliederdaten, Dokumente und Einstellungen sind ohne bestätigte Zwei-Faktor-Anmeldung nicht
  erreichbar – auch nicht für Club-Admins.
- Auch wo der Server noch nach der Rolle fragt (#1469), reicht die Admin-Rolle allein nicht mehr: fremde Teams
  verwalten, private Teams sehen, News-Entwürfe (Liste, Beitrag, Suche), Erfolge und Saison-Fundstücke privater
  Profile, geheime Erfolgs-Gruppen, die Verein-Kategorie fremder Profile, gesperrte Dokument-Downloads, Admin-Medien
  und das Upload-Protokoll sowie die Live-Aktualisierungen für die Verwaltung gehen nur mit bestätigter
  Zwei-Faktor-Anmeldung. Ohne gilt, was jede angemeldete Person sieht. Moderation bleibt ohne Zwei-Faktor.
- Inhalte „Nur intern“ und „Nur Mitglieder“ öffnet ein Adminbereich (Rolle, Freigabe, Vorstandsposten, Dolibarr)
  nur mit bestätigter Zwei-Faktor-Anmeldung; als Mitglied sieht man Mitglieder-Inhalte weiter ohne. Dasselbe gilt
  für Profilfelder mit der Stufe „Nur Admins“ (Moderation ausgenommen). Meldungen an Empfänger hängen nicht davon ab.
- Öffentliche Seiten, die Verwaltenden mehr zeigen (#1479), tun das ebenfalls nur mit bestätigter
  Zwei-Faktor-Anmeldung: die Kosten-Konfiguration an Events und Turnieren (Finanzen; die Preisangabe sehen alle),
  leere Alben in Galerie und Event-Seite und die Vorschau des Jahresrückblicks (Redaktion), Banner für „Admins“
  (Moderation ausgenommen) und der Helfer-Aufruf (Vorstand). Code: `can_use_area` in `services/permissions.py`, im Web
  `canUseArea`.

## Benutzermenü und Konto-Seiten (#516)

Das Benutzermenü im Kopf (am Handy im Hauptmenü, in der App unter „Mehr → Konto“) hat je Eintrag
genau ein Ziel, in der Reihenfolge, wie oft man es braucht:

| Eintrag | Ziel | Wer |
| --- | --- | --- |
| Dashboard | `/dashboard` | jedes Konto |
| Mein Profil | `/profile` (Reiter, darunter „Benachrichtigungen einstellen“) | jedes Konto |
| Öffentliches Profil | `/u/<name>` – so, wie andere es sehen | jedes Konto |
| Nachrichten | `/messages` | jedes Konto |
| Benachrichtigungen | `/notifications` (die Liste) | jedes Konto |
| Meine Mitgliedschaft | `/members/membership` | Mitglieder |
| Mitglied werden | `/membership/join` | wer kein Mitglied ist |
| Rechnungen | `/profile?tab=invoices` | jedes Konto |
| Meine Strafen (n) | `/my/penalties` – nur, wenn es Strafen oder eine laufende Maßnahme gibt | betroffene Konten |
| Gewinne (n) | `/my/prizes` – nur mit offenem Gewinn | Gewinner |
| Hilfe & Kontakt | `/contact` | jedes Konto |
| Mitgliederbereich | `/members/area` (Mitgliedschaft, Karte, Vorteile, Dokumente, interne News, Vorstand, Discord) | Mitglieder |
| Admin | `/admin` | wer einen Verwaltungsbereich hat (nicht Moderation allein) |
| Abmelden | – | jedes Konto |

Gäste sehen statt des Menüs „Anmelden“ und „Mitglied werden“. Die Profil-Seitenleiste führt nur
die Reiter des Profils - die Konto-Seiten stehen nicht ein zweites Mal dort.

## Wer sieht was im Adminbereich

Das Menü zeigt nur Gruppen und Einträge, für die ein Bereich vorhanden ist. Menüname = Seitentitel,
jede Adresse genau einmal (#512). Rollenbild des Betreibers: Vorstand pflegt Verein, Mitglieder und
Finanzen; die Turnierleitung Turniere, Stationen, Strafen und Gewinne; der Admin die Technik.

| Gruppe | Einträge | Wer |
| --- | --- | --- |
| Übersicht | Dashboard (Turnierleitung, Redaktion, Vereinsverwaltung, Finanzen, System) · Mein Dienst (Helfer mit Einsatz, Captains externer Serien, Moderation ohne Verwaltungsbereich) | Dashboard mit einem dieser Bereiche und Zwei-Faktor (Server: `require_dashboard`, #992, #1353); „Mein Dienst“ (#1352) für Helfer und reine Moderation – im Benutzermenü statt „Admin“, `/admin` führt Helfer nach `/admin/dienst`, Moderation nach `/admin/moderation`, Konten ohne Dienst auf „Kein Zugriff“ mit dem Satz „Die Verwaltung ist für Vereinsdienste …“ |
| Verein | Vereinsdaten (System) · Über uns, Sponsoren, Partner, Referenzen, Serien (Redaktion) · Vorstand, Kontakt-Inbox (Vereinsverwaltung) | je Eintrag |
| Mitglieder | Mitglieder (mit dem Reiter Öffentliche Profile), Bewerbungen, Mitgliedervorteile, Dokumente, Alle Benutzer (Vereinsverwaltung) · Dolibarr (Vereinsverwaltung und System) | Vereinsverwaltung |
| Finanzen | Finanzübersicht · Shop (Reiter Einstellungen: Stufe, Notschalter, Preise, Printful-Zugang, #1706; Reiter Produkte: Aufbau, Prüfung, Abgleich mit Printful, #1707/#1709; Reiter Designs: Druckdateien, #1708) | Finanzen |
| eSports | Turniere, Fast Lap, Stationen (Turnierleitung, Helfer) · Turnier-Leitfaden, Jahreswertung, Spiele, Gewinne, Strafen (Turnierleitung) · Game-Server (System) | Turnierleitung |
| Content | Events (Turnierleitung) · News, Galerie, Medien, Navigation, Erfolge, Sticker (Redaktion) · Downloads & QR (Turnierleitung, Redaktion, Vereinsverwaltung, System) | Redaktion |
| Verbindungen | Alle Verbindungen (Übersicht mit Zustand: aktiv, aus, fehlt, nicht lesbar, Fehler) · je Dienst eine Seite (Google, Resend, SMTP, Discord, Twitch, Steam, …) | System |
| E-Mail | Newsletter, Mail-Queue, E-Mail-Vorlagen (Versandlogs: Betrieb & Logs → Ereignisse, Quelle E-Mail) | System |
| Auftritt | Branding, Socials, SEO & Analytics | System |
| System | Betrieb & Logs (mit Ereignissen, Adminaktionen/Audit, App-Logs und Versandlogs als Reiter bzw. Quellen), Status, Push-Tests, App-Versionen, Zugang, Einrichtung & FAQ (System) · Moderation (Moderation) | System |

Seit #546 gibt es keine Seite „Einstellungen“ mehr: jeder frühere Reiter ist ein Menüeintrag
(`/admin/settings/<seite>`), alte Links mit `?tab=` leiten dorthin um. Die Reiter der Dolibarr-Seite
sind nur über die Suche im Menü erreichbar (Wegweiser), damit das Menü nicht länger wird. Eine Seite ohne
Bereich führt auf `/403` mit dem fehlenden Bereich und dem Hinweis, wer ihn vergibt. Die Antwort
des Servers sagt dasselbe („Dafür fehlt der Bereich „Redaktion“ …“).

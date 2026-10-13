# Rollen und Rechte

Stand: Meilenstein „Web: Rollen und Rechte“ (#287–#292), Rollen nach Bereichen (#1300), Rollen II (#1350). Quelle der Wahrheit für
das, was eine Person im Adminbereich darf. Der Code dazu: `backend/services/permissions.py`
(Bereiche, Rollen, Vorstand), `backend/auth.py` (`require_area`), Web `frontend/src/lib/permissions.js`.

## Bereiche

Rechte hängen an Bereichen, nicht an einer Rangfolge. Eine Person kann mehrere haben.

| Bereich | Schlüssel | Was dazugehört |
| --- | --- | --- |
| Turnierleitung | `tournaments` | Turniere, Events, Stationen, Fast Lap, Saisons, Spiele, Gewinne, Strafen, Zugangslinks, PDF-Exporte |
| Redaktion | `content` | News, Galerie, Medien, Sponsoren, Partner, Referenzen, Navigation, Sticker, Erfolge (Achievements), Seiten-Banner, Newsletter, Twitch-Streams |
| Vereinsverwaltung | `club` | Mitglieder und Mitgliederprofile, Anträge, Dokumente, Vorteile, Vorstand, Kontakt-Inbox, Benutzerliste (lesen, bannen mit Grund – Konten mit Adminbereich oder Admin-Rolle bannt nur der Superadmin, Superadmin-Konten niemand), Discord-Zähler |
| Finanzen | `finance` | Kosten und Abrechnung an Events (später Turnieren), Finanzübersicht mit Rechnungsaufträgen, Freigaben (#322, docs/ABRECHNUNG.md), Rechnungsangaben: Zahlungsziel, Zahlungsart, Bankkonto, Sprache der PDFs, „Steuersätze geprüft“, „gleich freigeben“ (#1358) – die übrige Dolibarr-Technik bleibt bei System |
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

Teams kommen als kleine Auswahl (`GET /api/admin/choices/teams?tournament_id=…`, wie `tournament`), Event-Sponsoren
mit dem Haken „Events“ nur mit Name und Logo (`GET /api/admin/choices/sponsors`: Turnierleitung, Redaktion, System).
Jede Liste lädt für sich: fehlt ein Recht, steht an der Stelle ein Satz, der Rest der Seite geht weiter.

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
| Übersicht | Dashboard (Turnierleitung, Redaktion, Vereinsverwaltung, System) | wer einen dieser Bereiche hat; Moderation allein hat weder Menüeintrag „Admin“ noch `/admin`, nur `/admin/moderation` |
| Verein | Vereinsdaten (System) · Über uns, Sponsoren, Partner, Referenzen (Redaktion) · Vorstand, Kontakt-Inbox (Vereinsverwaltung) | je Eintrag |
| Mitglieder | Mitglieder, Mitgliederprofile, Bewerbungen, Mitgliedervorteile, Dokumente, Alle Benutzer (Vereinsverwaltung) · Dolibarr (Vereinsverwaltung und System) | Vereinsverwaltung |
| Finanzen | Finanzübersicht | Finanzen |
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

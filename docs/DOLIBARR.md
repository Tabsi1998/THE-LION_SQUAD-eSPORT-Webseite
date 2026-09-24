# Dolibarr-Anbindung

Dolibarr mit dem Modul **Vereine** führt Mitgliedschaft, Beiträge und
Vereinsfunktionen. Die Website übernimmt den Stand – für Konten, deren
Zuordnung zu einem Mitglied **bestätigt** ist. Dieses Dokument ist die
Anleitung für den Betrieb: einrichten, umstellen, Fehler lesen, zurückdrehen.

Stand: Dolibarr I (#316 Teil 1, #295, #297, #330 Teil 1). Rechnungen und PDF
folgen mit „Dolibarr II“, Abrechnung mit „Abrechnung I/II“.

## Grundsätze

- **Dolibarr führt, die Website bildet ab.** Status, Mitgliedsart, Nummer,
  Beginn, Beitragsstand und Funktionen kommen aus Dolibarr. Login, Profil und
  Gaming-Daten bleiben bei der Website.
- **Eine Zuordnung gilt erst, wenn sie bestätigt ist.** E-Mail und
  Mitgliedsnummer finden Kandidaten, beweisen aber nichts: Familien teilen sich
  Adressen, und eine Nummer kann jeder abschreiben.
- **Ein Mitglied, ein Konto.** Zwei Konten können nie dasselbe Mitglied
  beanspruchen. Mitglied und Geschäftspartner (für Rechnungen) sind getrennte
  Angaben; der Geschäftspartner kommt erst mit der Abrechnung dazu.
- **Der Abgleich schreibt niemanden an.** Keine Mails, keine Discord-Meldungen,
  keine Erfolge – auch nicht bei der Umstellung.
- **Ein Ausfall kündigt niemanden.** Fehlt eine Antwort, bleibt alles stehen.
  Beitragsrückstand ist kein Austritt; ein eingetragener Austritt wirkt erst
  mit dem Tag, den Dolibarr nennt.

## Wer sieht was

| Wer | Was |
| --- | --- |
| **System** (Club-Admin, Superadmin) | Adresse, API-Schlüssel (nur „gespeichert“, nie der Wert), Modus, Webhook |
| **Vereinsverwaltung** | Stand des Abgleichs, Zuordnungen Konto ↔ Mitglied, Vorschau der Umstellung |
| **Superadmin** | Freigabe „Funktion → Bereich“, weil sie Rechte vergibt |
| Redaktion, Turnierleitung, Moderation | nichts davon |
| Das Mitglied selbst | eigener Beitragsstand und eigene Funktionen unter „Meine Mitgliedschaft“ |

## Einrichten (einmalig)

**In Dolibarr**

1. Module *API REST* und *Vereine* sind aktiv.
2. *Start → Benutzer & Gruppen → Neuer Benutzer*: Login `website`, kein
   Administrator.
3. Reiter *Berechtigungen*, Modul *Vereine*: **Vereinsübersicht und Vereinsdaten
   lesen** und **Mitglieder-Zusammenfassung für die Website über die API lesen**
   anhaken. Sonst nichts – der Benutzer kann weder Mitglieder noch Rechnungen
   direkt lesen.
4. *Ändern* auf der Benutzerkarte: **API-Schlüssel** erzeugen.

**Auf der Website** (Admin → Mitglieder → Dolibarr, Reiter *Verbindung*)

5. Adresse von Dolibarr (nur `https://`), API-Schlüssel, eine Kennung der
   Installation (z. B. `verein`) eintragen, *Speichern*, dann *Verbindung
   testen*. Der Schlüssel wird verschlüsselt gespeichert und nie wieder gezeigt.
6. Modus **Vorschau** wählen. Jetzt wird gelesen, aber nichts übernommen.

## Umstellen

7. Reiter *Umstellung* → **Vorschau erstellen**. Die Liste zeigt je Konto:
   - *Treffer über die bestätigte E-Mail* → mit **Bestätigen** zuordnen;
   - *Treffer über die E-Mail – am Konto nicht bestätigt* → die Adresse stimmt,
     aber das Konto hat sie nie bestätigt (ältere Konten). Kurz prüfen, ob es
     wirklich diese Person ist, dann **Bestätigen**;
   - *kein Treffer* → rechts in der Zeile das **Mitglied aus der Liste wählen**
     und **Zuordnen** (z. B. wenn das Konto eine andere E-Mail-Adresse hat als
     das Mitglied in Dolibarr);
   - *mehrere Mitglieder teilen sich die E-Mail* → in Dolibarr nachsehen, wer
     gemeint ist, dann von Hand zuordnen;
   - *lokal Mitglied, in Dolibarr nicht gefunden* → in Dolibarr anlegen oder
     die E-Mail-Adresse dort angleichen;
   - *Status ändert sich* → z. B. hier noch „aktiv“, in Dolibarr gekündigt.
     Nach der Zuordnung gilt Dolibarr.
8. **Mitgliedsarten zuordnen.** Eine Art ohne Zuordnung bleibt Mitglied, aber
   ohne Mitgliedsart – nie still „ordentlich“.
9. Reiter *Funktionen* (Superadmin): anhaken, welche Funktion die
   Vereinsverwaltung öffnet (üblich: Obmann/Obfrau, Kassier:in, Schriftführung
   samt Stellvertretungen; **nicht** Rechnungsprüfung). *Wer bekäme was?*
   ansehen, dann *Freigeben*.
10. Reiter *Verbindung* → Modus **Live**. Das geht erst nach einem gelungenen
    Abgleich in der Vorschau.

Mitglieder, die noch nicht zugeordnet sind, bleiben, wie sie sind, und werden
weiter hier gepflegt. Niemand verliert durch das Umschalten seinen Zugang.

### Was braucht es, damit ein Konto von selbst erkannt wird?

1. Im Dolibarr-Mitglied steht **dieselbe E-Mail-Adresse** wie im Website-Konto
   (Groß- und Kleinschreibung egal).
2. Diese Adresse hat in Dolibarr **genau ein** Mitglied. Teilen sich zwei die
   Adresse (Familie), wird nie geraten – von Hand zuordnen.
3. Für die Zuordnung **ohne** Zutun der Vereinsverwaltung zusätzlich: Das Konto
   hat seine E-Mail bestätigt, und der Schalter *Konten über die bestätigte
   E-Mail von selbst zuordnen* ist an.

Alles andere geht von Hand: In der Vorschau steht bei jedem Konto ohne Treffer
die Auswahl aller Mitglieder ohne Konto.

**Mitgliedsnummern** kommen nach der Zuordnung aus Dolibarr (dort die *Ref.Nr.*)
und lassen sich hier nicht mehr ändern. Soll die Nummer ein Format wie
`TLS-2026-0007` haben, stellt man das in Dolibarr ein (*Einstellungen → Module →
Mitglieder → Nummerierung*) – die Website übernimmt, was dort steht.

**Beendete Mitgliedschaften** stehen in der Vorschau in einem eigenen Kasten.
Ein zugeordnetes Konto, dessen Mitgliedschaft in Dolibarr beendet ist, wird im
Live-Betrieb „ehemalig“ und verliert den Mitgliederzugang.

## Eigene Rechnungen (Dolibarr II)

Jedes Konto sieht unter **Profil → Rechnungen** (auch im Konto-Menü und unter
`/account/invoices`; in der App im Profil und unter Mehr → Konto) seine Belege aus
Dolibarr – der Mitgliederbereich bleibt Verein und verweist nur dorthin: offene und überfällige
oben, bezahlte, Gutschriften und aufgegebene im Archiv. „Ansehen“ öffnet das PDF
im Betrachter der Website, „Bezahlen“ führt auf Dolibarrs Zahlungsseite (Stripe,
PayPal oder was dort eingerichtet ist) – ohne zweite Anbieter-Einrichtung auf der
Website. Jeder Beleg trägt seine Quelle – Mitgliedsbeitrag, Event oder Turnier
mit Datum, Personen oder Team –, und sobald es mehr als eine Quelle gibt, lässt
sich danach filtern (Abrechnung I, #320).

- **Wer sieht was:** nur das eigene Konto. Mitglieder sehen alle Belege ihres
  Mitglieds (bestätigte Zuordnung; Ehemalige behalten ihre alten Belege).
  **Nicht-Mitglieder** sehen genau die Belege ihrer eigenen Vorgänge – Startgeld,
  Event-Teilnahme –, einzeln nachgelesen; nie „alle Rechnungen des
  Geschäftspartners“, denn den kann eine Familie teilen. Für diese Belege gibt
  es keinen Online-Zahlungsweg (den kennt nur das Vereinsmodul): bezahlt wird
  per Überweisung, die Bankdaten stehen auf der Rechnung. Kein Admin sieht hier
  fremde Rechnungen; dafür gibt es Dolibarr.
- **Bezahlen** prüft der Server im Moment des Klicks neu: eigener Beleg, noch
  offen, Ziel auf der eigenen Dolibarr-Installation. Keine Gutschrift, nichts
  Bezahltes, kein fremdes Ziel. Ob eine Zahlung angekommen ist, sagt Dolibarr –
  die Website liest es beim nächsten Abgleich.
- **PDFs** werden durchgereicht und nie gespeichert; die Bytes bleiben, wie
  Dolibarr sie liefert, der SHA-256 steht im Betrachter.
- **Ausfall:** Antwortet Dolibarr nicht, zeigt die Seite den letzten bekannten
  Stand mit Datum und ohne Bezahlen-Knopf – nie „keine Rechnungen“.
- Voraussetzung im Modul: `GET /vereine/members/{id}/invoices` und `…/pdf`
  (Vereine ab 0.3). Der Website-Benutzer braucht dafür keine Rechnungsrechte.

## Mitgliedskarte (App 0.7.0-beta)

Aktive Mitglieder sehen unter **Meine Mitgliedschaft** (Web) und in der LionsAPP
unter **Mehr → Mitgliederbereich → Mitgliedskarte** eine digitale Karte mit
QR-Code. Ein Partner (Shop, Lokal, Einlass) scannt den Code mit der Handykamera
und landet auf `lionsquad.at/karte/pruefen/…` – ohne Anmeldung.

- **Was der Partner sieht:** gültig oder nicht, Vorname mit Anfangsbuchstaben des
  Nachnamens, Mitgliedsart, gültig bis. Keine Nummer, keine E-Mail, kein
  Beitragsstand. Warum eine Karte nicht gilt, sagt die Seite nicht.
- **Warum ein Foto nichts nützt:** Der Code gilt fünf Minuten und erneuert sich
  von selbst. Ein Screenshot von gestern zeigt „nicht gültig“.
- **Wann die Karte gilt:** solange die Mitgliedschaft aktiv ist (aktiv oder
  Ehrenmitglied). Ein offener Beitrag beendet sie nicht; ein in Dolibarr
  eingetragener Austritt beendet sie mit dem letzten Tag. „Gültig bis“ zeigt
  das Austrittsdatum, sonst „bezahlt bis“, sonst „solange die Mitgliedschaft
  besteht“.
- **Wallet:** Apple Wallet und Google Wallet sind vorbereitet (die Karte hat
  ein neutrales Modell mit Feldern, Farben und Barcode), brauchen aber ein
  Apple-Entwicklerkonto mit Pass-Zertifikat bzw. ein Google-Wallet-Issuer-Konto.
  Ohne diese Konten gibt es die Karte in App und Web – das reicht zum Vorzeigen.

## Im Betrieb

- **Abgleich:** alle 10 Minuten das Geänderte, einmal am Tag alles. *Jetzt
  abgleichen* stößt einen Lauf von Hand an.
- **Webhook (optional):** Reiter *Verbindung* → *Neue Adresse erzeugen*. In
  Dolibarr Modul *Webhooks*: Ziel mit dieser Adresse, Ereignis *Vereine:
  Mitglieds-Zusammenfassung geändert*, Typ *Nicht blockierend*. Das Ereignis
  trägt keinen Stand – die Website liest ein paar Sekunden später nach. Ohne
  Webhook dauert eine Änderung bis zu 10 Minuten.
- **Neue Mitglieder:** Auf „Meine Mitgliedschaft“ gibt es *Zuordnung anfragen*.
  Die Anfrage steht unter *Zuordnungen*; bestätigt wird sie unter *Umstellung*.
  Wer es bequemer will, schaltet *Konten über die bestätigte E-Mail von selbst
  zuordnen* ein: nur bei genau einem Treffer und wenn das Mitglied noch keinem
  Konto gehört.
- **Vereinsrechte:** Beginnt eine Funktion in Dolibarr, öffnet sich die
  Vereinsverwaltung beim nächsten Abgleich; endet sie, ist sie weg – ohne neues
  Anmelden. Zwei-Faktor bleibt Pflicht. Ist die Freigabe aktiv, verleiht der
  lokal gepflegte Vorstandsposten keine Rechte mehr.
- **Gesperrt in der Website:** Für zugeordnete Mitglieder lassen sich Status,
  Art, Nummer und Beginn hier nicht mehr ändern (Meldung „wird in Dolibarr
  geführt“). Notiz, interne Rolle und Sichtbarkeit der Nummer bleiben.

## Fehler lesen

Betrieb → Checks zeigt **Dolibarr-Abgleich**; die Seite *Dolibarr* nennt den
Grund. Es steht nie ein Schlüssel oder ein Antworttext darin.

| Meldung | Bedeutung | Was tun |
| --- | --- | --- |
| kennt den API-Schlüssel nicht (401) | Schlüssel falsch oder Benutzer deaktiviert | neuen Schlüssel erzeugen und eintragen |
| fehlt ein Recht im Modul Vereine (403) | dem Benutzer `website` fehlt ein Haken | Schritt 3 prüfen |
| Modul Vereine ist deaktiviert (501) | in Dolibarr abgeschaltet | Modul aktivieren |
| Diese Adresse gibt es nicht | Tippfehler im Namen | Adresse Buchstabe für Buchstabe prüfen |
| Zertifikat wird nicht akzeptiert | abgelaufen, selbst signiert oder für einen anderen Namen | Zertifikat in Dolibarr bzw. am Proxy erneuern |
| antwortet nicht rechtzeitig / nimmt keine Verbindung an | Dolibarr steht, Firewall, falscher Port – oder Dolibarr steht im selben Heimnetz und der Router leitet die öffentliche Adresse nicht zurück | prüfen, ob Dolibarr **vom Webserver aus** erreichbar ist; im Heimnetz den Host-Eintrag in `docker-compose.override.yml` anlegen (`UPDATE.md`, einmalig – `update.sh` fasst die Datei nie an) |
| Dolibarr leitet um | `http` statt `https`, fehlender Unterordner | Adresse so eintragen, wie sie im Browser steht |
| keine Dolibarr-API unter dieser Adresse | Modul *API REST* aus, oder Dolibarr liegt in einem Unterordner | Modul aktivieren bzw. Unterordner in die Adresse |
| Modul „Vereine“ bietet keine Schnittstelle | Modul aus oder zu alt | aktivieren, aktualisieren |
| antwortet etwas, aber nicht die API | Anmeldeseite, Wartungsseite | Adresse prüfen |
| nicht erreichbar | sonstiger Netzfehler | später läuft es von selbst weiter; nichts wird ausgetragen |
| Schlüssel lässt sich nicht entschlüsseln | `SETTINGS_ENCRYPTION_KEY` am Server geändert | Schlüssel neu eintragen |
| gelb: „steht seit … min“ | der letzte gelungene Lauf ist über eine Stunde her | Ursache oben suchen |
| rot | Live und seit über einem Tag kein gelungener Lauf | **nach 48 Stunden ruhen die Rechte aus Funktionen**; Mitgliedschaften bleiben |

Niemals bei einer unklaren Lage blind etwas doppelt anlegen: Die Anbindung
schreibt in dieser Ausbaustufe **nichts** nach Dolibarr.

## Zurückdrehen

- **Modus Aus:** Die Übernahme stoppt sofort. Der zuletzt übernommene Stand
  bleibt stehen; die Rechte aus Funktionen enden, der lokale Vorstandsposten
  zählt wieder.
- **Eine Zuordnung lösen** (Reiter *Zuordnungen*): Der Stand bleibt und wird
  wieder hier gepflegt; Rechte aus Funktionen enden sofort.
- **Freigabe zurücknehmen:** alle Haken entfernen und freigeben.
- In Dolibarr wird dabei nie etwas gelöscht oder geändert.

## Vereinsdaten und Vorstand aus Dolibarr (Rechtliches II)

Seit Vereinsmodul 0.7.0 liefert Dolibarr den Verein (`/vereine/organization`: Name, ZVR,
Vereinsbehörde, Anschrift, Kontakt, Gründung, Zweck) und die Funktionen mit ihren heutigen
Inhabern (`/vereine/board`; Namen nur, wo die Person der Nennung zugestimmt hat). Die Website
liest beides stündlich und hält den Stand mit Zeitpunkt. Ein Ausfall ändert nichts: Der letzte
Stand bleibt, der Fehler steht daneben.

**Einschalten:** Admin → Einstellungen → Rechtliches → „Jetzt nachlesen“ (zeigt, was Dolibarr
liefert), dann Haken **„Vereinsdaten aus Dolibarr übernehmen“** und speichern. Danach kommen
Name, ZVR, Vereinsbehörde, Anschrift, Telefon und die vertretungsbefugte Person aus Dolibarr –
die Felder stehen im Reiter nur lesbar da. Von Hand bleiben: Rechtsform, Sitz, Bundesland,
inhaltlich Verantwortlicher, Datenschutz-E-Mail, Hosting, UID, Zusatztexte.

**Vertretungsbefugte Person:** Die Vorstandsfunktion mit „vertritt den Verein nach außen“
(bevorzugt Obmann/Obfrau). Liefert Dolibarr keinen Namen (keine Einwilligung), bleibt der
Handeintrag – die Website rekonstruiert nie einen Namen aus anderen Quellen. Ist der letzte
Stand älter als zwei Tage, hält die Website Personennamen zurück, damit ein Widerruf in
Dolibarr zeitnah wirkt; die Vereinsdaten selbst bleiben.

**Kanäle:** Pflegt der Verein seine öffentlichen Kanäle im Modul unter *Einrichtung > Vereine >
Kanäle und Konten* (Twitch, YouTube, Discord, Instagram …), nimmt die Website sie mit dem Haken
**„Kanäle aus Dolibarr übernehmen“** (Einstellungen → Social Links) für den Footer und die
Social-Erkennung der Suchmaschinen – in der Reihenfolge des Vereins, stündlich nachgelesen. Stehen
dort keine Kanäle, gilt weiter die Liste von Hand; sie bleibt auch der Rückfall bei einem Ausfall.

**Datenschutzerklärung:** `/privacy` baut ihre Abschnitte aus den Schaltern, die wirklich an
sind (Statistik-Anbieter, Google-Login, Discord-Webhooks und -Bot, Twitch-Einbettung,
E-Mail-Versand über Resend oder eigenen Mailserver, Dolibarr und Rechnungen, App mit Push und
Absturzberichten). Wer einen Dienst ein- oder ausschaltet, ändert damit die Erklärung – ohne
Text zu pflegen. Was die Website nicht kennt, gehört weiterhin in „Zusätzliche
Datenschutzhinweise“.

**Statuten:** Gibt der Verein seine Statuten im Modul unter *Einrichtung > Statuten* für die
Öffentlichkeit frei, zeigt die Vorstandsseite mit demselben Schalter die geltende Fassung (Nummer,
beschlossen am, gültig seit) mit PDF sowie frühere und künftige Fassungen. Das PDF holt die Website
aus Dolibarr und prüft es gegen die Prüfsumme der Vereinsakte – passt es nicht, gibt es die Datei
nicht (Fehler 502). Den Entwurf, an dem der Vorstand arbeitet, kennt die Website nie. Ohne Freigabe
oder mit einem Modul vor 0.11 bleibt der Hinweis auf den Mitgliederbereich; im Reiter Rechtliches
steht, was Sache ist.

## Mitgliederverzeichnis aus der Einwilligung

Das Mitgliederverzeichnis auf der Website (*Verein → Mitglieder*) kann der Abgleich füllen, ohne
dass ein Mitglied etwas tun muss:

1. Im Vereinsmodul unter *Einrichtung > Vereine > Einwilligungen* einen Text anlegen, etwa
   „Nennung im Mitgliederverzeichnis“, und ihn den Mitgliedern zur Zustimmung geben (beim
   Beitritt oder in der Mitgliederverwaltung).
2. Auf der Website unter *Dolibarr → Verbindung → Mitgliederverzeichnis aus der Einwilligung*
   diesen Text auswählen.

Ab dann legt jeder Abgleich für ein Mitglied mit bestätigter Zuordnung und erteilter Einwilligung
den Eintrag an: Name aus der Mitgliederverwaltung, Foto und Spiele vom Website-Konto. Alles
Weitere – Foto, Bio, Spiele, Anzeigename – pflegt der Vorstand unter *Verein → Mitgliederprofile*;
der nächste Abgleich lässt es stehen. Der Klarname folgt der Mitgliederverwaltung nur, solange der
Vorstand ihn nicht selbst gesetzt hat – soll bei jemandem der Nachname nicht öffentlich stehen,
trägt der Vorstand nur den Vornamen ein; ein leeres Feld holt den Namen wieder aus Dolibarr. Ein
Widerruf in Dolibarr nimmt den Eintrag beim nächsten Abgleich offline – auch einen Eintrag, den das
Mitglied selbst per Opt-in angelegt hat; eine neue Zustimmung holt ihn samt Pflege zurück. Ein vom
Vorstand gesperrter Eintrag bleibt gesperrt. Ohne ausgewählte Einwilligung ändert der Abgleich am
Verzeichnis nichts.

**Profil in Dolibarr pflegen (ab Vereine 1.1):** Auf der Mitgliedskarte, Reiter *Verein*, Abschnitt
*Website-Profil*, pflegt der Vorstand wahlweise Gamertag, Kurztext, Spiele und Plattformen; das Foto
ist das Foto der Mitgliedskarte. Was dort steht, führt – die Website übernimmt es beim nächsten
Abgleich (das Foto als Datei unter den Uploads, nur wenn es sich geändert hat); was dort leer bleibt,
pflegt ihr weiter auf der Website. Die Einwilligung dafür wählt ihr im Modul unter *Einrichtung >
Einwilligungen*; die Website nimmt dieselbe für das Verzeichnis, wenn hier keine eigene gewählt ist.
Ein Modul ohne diese Funktion ändert nichts – dann gilt nur, was auf der Website steht.

**Keine Doppelten, kein Konto nötig:** Der Abgleich sucht zuerst nach der Mitgliedsnummer am Profil,
dann nach dem zugeordneten Konto, dann nach Gamertag oder Klarname – eine Karte, die der Vorstand
schon von Hand angelegt hat, wird also weitergeführt (Einwilligung und Nummer kommen dazu, Foto und
Kurztext bleiben), nie verdoppelt. Hat ein früherer Lauf doch eine zweite Karte angelegt, geht sie
beim nächsten Abgleich in der gepflegten auf. Ein Website-Konto braucht es nicht: Wer in Dolibarr
zugestimmt hat, bekommt seine Karte aus der Vereinsakte allein („Mitglied Nr. … · ohne Konto“ im
Admin); das Konto verknüpft der Vorstand später.

## Vereinsakte verbinden (Dolibarr III, #324 Teil 1)

Der API-Schlüssel der Website liest Mitgliedsdaten **mehrerer** Personen – er beweist nicht, wer
gerade angemeldet ist. Für **persönliche Unterlagen** (Beitrittsbestätigung, Schreiben, Beschlüsse,
Protokolle für Mitglieder) verlangt das Vereinsmodul deshalb eine Verbindung je Person:

1. Im Vereinsmodul dem technischen Benutzer der Website das Recht **„Für Personen handeln“**
   geben (Benutzer → Rechte → Vereine).
2. Für ein Mitglied unter *Einrichtung > Externe Identitäten* eine **Einladung** für die
   Website erzeugen, Fähigkeit „Dokumente“ anhaken. Der Code wird einmal angezeigt, gilt eine
   Stunde und genau einmal – ihn dem Mitglied persönlich geben (nicht in einen offenen Kanal).
3. Das Mitglied löst den Code auf der Website unter *Meine Mitgliedschaft → Vereinsakte* ein.
   Ab dann stehen seine Unterlagen unter *Vereinsdokumente* (Web und App) mit dem Hinweis
   „Vereinsakte“ bzw. „nur für dich“; das PDF holt die Website je Abruf aus Dolibarr, das dabei
   selbst prüft, ob die Person es sehen darf, und prüft die Datei gegen die Prüfsumme.

Die Statutenfassungen stehen für Mitglieder ebenfalls unter *Vereinsdokumente* (Kategorie
„Statuten“, geltende Fassung angepinnt): öffentlich freigegebene für jedes Mitglied, nur für
Mitglieder freigegebene über die Verbindung.

Ohne Verbindung sehen Mitglieder nur, was der Verein unter *Mitglieder > Verein > Vereinsakte* für
die **Öffentlichkeit** veröffentlicht hat. Widerruft ihr eine Verbindung im Modul, wirkt das beim
nächsten Abruf: die Website merkt sich „widerrufen“, das Mitglied sieht wieder nur Öffentliches und
kann mit einem neuen Code neu verbinden. E-Mail-Adresse, Mitgliedsnummer oder die bestätigte
Zuordnung der Website ersetzen den Code nie – so will es das Modul, und so bleibt es.

**Eigene Daten und Austritt (#329 Teil 2):** Trägt die Einladung auch die Fähigkeit **„eigene
Daten“**, zeigt *Meine Mitgliedschaft* den Kasten „Meine Daten“ aus der Vereinsakte: Anschrift,
Telefon, Mobil und E-Mail lassen sich ändern (Name und Geburtsdatum nicht). Felder, die der Verein
im Modul als „sofort“ führt (in der Regel Telefon und Mobil), sind gleich übernommen; alles andere
und jede neue E-Mail-Adresse prüft der Vorstand in Dolibarr – der Stand jeder Einreichung steht
darunter. Hat sich der Datensatz in Dolibarr inzwischen geändert, wird nichts still überschrieben,
die Person lädt neu. Der Austritt geht mit heutigem Eingang ein; den letzten Tag der Mitgliedschaft
ergibt eure Kündigungsregel im Modul – ein früheres Wunschdatum wird nicht übernommen, ein späteres
schon. Einmal erklärt, lässt er sich auf der Website nicht zurücknehmen (das macht der Vorstand).

## Was das Modul heute kann – und worauf gewartet wird

Die Seite *Dolibarr* zeigt es unter *Stand*. Die Website setzt nur voraus, was
das Modul ausliefert (festgehalten in `backend/tests/contracts/manifest.json`):

| Vorhanden (Vereine ab 0.5, API-Version 1) | Noch offen im Modul |
| --- | --- |
| Zusammenfassung je Mitglied mit Beitragsstand und Funktionen | Änderungsfeed mit Revisionen und Löschhinweisen (#154) |
| Suche über E-Mail oder Nummer | signierte Webhooks (#155) |
| nur geänderte Mitglieder (`changed_since`) | |
| Benachrichtigung bei Änderung (ohne Personendaten) | |
| Rechnungen mit PDF (Dolibarr II) | |
| Vereinsdaten, Vorstand, Statuten (Rechtliches II, ab Vereine 0.11) | |
| persönlicher Zugriff und Dokumente aus der Vereinsakte (ab Vereine 0.11) | |

Bis #154 da ist, bemerkt die Website ein **gelöschtes** Mitglied erst beim
täglichen vollständigen Lauf – und liest vor dem Austragen jedes fehlende
Mitglied einzeln nach.

## Für die Entwicklung

- Ein Adapter für alles: `backend/services/dolibarr_client.py` (feste Wege,
  nur https, maskierte Fehler, Wiederholen nur beim Lesen). Zuordnungen in
  `dolibarr_links.py`, Übernahme in `dolibarr_sync.py`, Rechte in
  `dolibarr_policy.py`, Routen in `routes/dolibarr_routes.py`.
- **Vertragstests:** `backend/tests/contracts/vereine-openapi.json` ist die
  API-Beschreibung des Moduls; das Test-Dolibarr (`tests/dolibarr_fake.py`)
  prüft jede seiner Antworten dagegen. Das Modul prüft seine echten Antworten
  in Dolibarr 22, 23 und 24 gegen dieselbe Datei. Bei einer neuen Modulversion:
  Datei und `manifest.json` ersetzen, Tests laufen lassen.
- Keine produktiven Schlüssel oder Personendaten in Tests; nie gegen die
  Produktion testen.

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

Jedes zugeordnete Konto sieht unter **Meine Mitgliedschaft → Meine Rechnungen**
(`/account/invoices`) seine Belege aus Dolibarr: offene und überfällige oben,
bezahlte, Gutschriften und aufgegebene im Archiv. „Ansehen“ öffnet das PDF im
Betrachter der Website, „Bezahlen“ führt auf Dolibarrs Zahlungsseite (Stripe,
PayPal oder was dort eingerichtet ist) – ohne zweite Anbieter-Einrichtung auf der
Website.

- **Wer sieht was:** nur das eigene Konto. Es zählt die bestätigte Zuordnung,
  nicht der Mitgliedsstatus – Ehemalige behalten ihre alten Belege. Kein
  Admin sieht hier fremde Rechnungen; dafür gibt es Dolibarr.
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

## Was das Modul heute kann – und worauf gewartet wird

Die Seite *Dolibarr* zeigt es unter *Stand*. Die Website setzt nur voraus, was
das Modul ausliefert (festgehalten in `backend/tests/contracts/manifest.json`):

| Vorhanden (Vereine ab 0.5, API-Version 1) | Noch offen im Modul |
| --- | --- |
| Zusammenfassung je Mitglied mit Beitragsstand und Funktionen | verifizierte Identitäten (dolibarr-vereine#153) |
| Suche über E-Mail oder Nummer | Änderungsfeed mit Revisionen und Löschhinweisen (#154) |
| nur geänderte Mitglieder (`changed_since`) | signierte Webhooks (#155) |
| Benachrichtigung bei Änderung (ohne Personendaten) | Dokumente (#156/#157) |
| Rechnungen mit PDF (kommt mit „Dolibarr II“) | |

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

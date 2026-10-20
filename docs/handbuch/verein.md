# Verein und Mitglieder – Handbuch

Alles rund um die Mitgliedschaft: wie jemand Mitglied wird, was Mitglieder im Mitgliederbereich finden (Karte, Versammlungen,
Helferdienste, Unterlagen), wie ihr den Vorstand auf der Website zeigt und wer was pflegt. Die Technik dahinter
(Anbindung an die Mitgliederverwaltung Dolibarr) steht im [Dolibarr-Kapitel](../DOLIBARR.md); hier steht, was ihr klickt.

**Wo im Admin:**

- **Admin → Mitglieder → Mitglieder** (`/admin/members`) – Reiter **Mitgliedschaften** und **Öffentliche Profile** (die Profile im öffentlichen Verzeichnis, direkt: `/admin/members?tab=profiles`)
- **Admin → Mitglieder → Bewerbungen** (`/admin/membership-applications`) – Anträge, Einladungen, die Seite „Mitglied werden“
- **Admin → Mitglieder → Mitgliedervorteile** (`/admin/benefits`) – Vorteile für Mitglieder
- **Admin → Mitglieder → Dokumente** (`/admin/documents`, Seitenname „Dokumente & Downloads“) – Vereinsdokumente wie Statuten und Protokolle
- **Admin → Mitglieder → Einlass (Versammlung)** (`/admin/einlass`) – Mitgliedskarte am Eingang scannen
- **Admin → Mitglieder → Alle Benutzer** – Konten, Rollen, Sperren, (siehe Kapitel „Erste Schritte im Admin“)
- **Admin → Mitglieder → Dolibarr** – Verbindung zur Mitgliederverwaltung, siehe [Dolibarr](../DOLIBARR.md)
- **Admin → Verein → Vorstand** (`/admin/board`) – Posten und Stellvertretungen
- **Admin → Verein → Kontakt-Inbox** (`/admin/contact`) – Nachrichten aus dem Kontaktformular

Wer das sieht: der Bereich **Vereinsverwaltung** (auch, wer einen aktiven Vorstandsposten hält). Dolibarr sehen zusätzlich
„System“, die Vereinsdaten nur „System“.

Öffentlich: **/verein** (alles vom Verein an einem Ort), **/about**, **/board** (Vorstand), **/members** (Verzeichnis),
**/membership/join** („Mitglied werden“), **/membership/apply** (Antrag).

---

## Inhalt

1. [Überblick: was alles geht](#1-überblick-was-alles-geht)
2. [Einrichten Schritt für Schritt](#2-einrichten-schritt-für-schritt)
3. [Die Funktionen einzeln](#3-die-funktionen-einzeln)
4. [Wenn etwas nicht klappt](#4-wenn-etwas-nicht-klappt)
5. [Häufige Fragen](#5-häufige-fragen)

---

## 1. Überblick: was alles geht

| Funktion | Was passiert | Einstellen unter |
| --- | --- | --- |
| **Mitglied werden** | Seite mit vier Vorteilen, Beiträgen aus Dolibarr und dem Knopf „Antrag stellen“ | Admin → Mitglieder → Bewerbungen, Kasten „Seite „Mitglied werden““ |
| **Antrag** | Online-Antrag mit Mitgliedsart, Nachricht und Einwilligungen | Bewerbungen |
| **Einladung zum Antrag** | Der Vorstand lädt ein Konto gezielt ein | Bewerbungen, „+ Zum Antrag einladen“ |
| **Mitgliederbereich** | Karte, Versammlungen, Helferdienste, News, Dokumente, Vorteile | `/members/area` (für Mitglieder) |
| **Mitgliedskarte** | Karte mit Prüfcode, auch als Bild und ohne Netz | Meine Mitgliedschaft |
| **Vorstand** | Posten, Stellvertretung, „Wir suchen …“ | Admin → Verein → Vorstand |
| **Statuten** | Geltende Fassung als PDF für alle oder nur für Mitglieder | Dolibarr → Funktionen bzw. Dokumente |
| **Versammlungen** | Einladung, Tagesordnung, Anträge, Abstimmung; Einlass per Karte | Dolibarr (Vereinsakte), Einlass |
| **Helferdienste** | Schichten bei Veranstaltungen, Anfrage und Bestätigung | Dolibarr (Vereinsakte), Mitgliederbereich → Helfen |
| **Persönliche Unterlagen** | Bestätigungen und Schreiben nur für dich | Profil → „Nur für dich“ → Deine Unterlagen |
| **Mitgliederverzeichnis** | Öffentliche Profile mit Foto, Spielen, Plattformen | Mitgliederprofile, oder aus Dolibarr per Einwilligung |

---

## 2. Einrichten Schritt für Schritt

1. **Dolibarr anbinden**, wenn ihr eine Mitgliederverwaltung habt: [Dolibarr](../DOLIBARR.md). Ohne Anbindung geht alles
   auch von Hand, aber Beiträge, Versammlungen, Helferdienste und persönliche Unterlagen kommen nur mit Dolibarr.
2. **Seite „Mitglied werden“ füllen:** Admin → Mitglieder → Bewerbungen, Kasten **Seite „Mitglied werden“**: vier Vorteile
   (Symbol und ein Satz) und ein Satz, wofür der Beitrag verwendet wird. **Speichern**. Die Beiträge selbst kommen aus Dolibarr
   und werden nur dort gepflegt.
3. **Vorstand besetzen:** Admin → Verein → Vorstand (3.4).
4. **Statuten bereitstellen:** entweder in Dolibarr freigeben, oder Admin → Mitglieder → Dokumente → **Neues Dokument** in der
   Kategorie **Statuten** (3.5).
5. **Öffentliche Profile:** Admin → Mitglieder → Mitglieder → Reiter **Öffentliche Profile** → **Profil erstellen** (3.10). Mit Dolibarr entstehen sie über
   die Einwilligung von selbst.
6. **Testen:** mit einem Test-Konto den Weg „Mitglied werden“ bis zum Antrag durchgehen (3.1).

---

## 3. Die Funktionen einzeln

### 3.1 Mitglied werden: der Weg für Interessierte

1. Wer neu ist, **registriert** sich und ist damit Community-Spieler.
2. Auf **Mitglied werden** (`/membership/join`) stehen eine Mitgliedskarte als Muster, der Knopf **Antrag stellen**, vier
   Vorteile, **Was kostet das?** (die Mitgliedsarten mit Beitrag aus Dolibarr; antwortet Dolibarr nicht, der letzte Stand mit
   Datum, sonst „Die Beiträge nennen wir dir im Antrag“) und **Was wir vom Rudel erwarten**.
3. Im **Antrag** (`/membership/apply`) wählt die Person die **Mitgliedsart**, füllt die Felder aus, die der Verein in Dolibarr
   verlangt (ohne Dolibarr: eine Nachricht mit mindestens 20 Zeichen), und setzt die Haken **Vereinsstatuten** und
   **Datenschutzerklärung**. Freiwillige Einwilligungen sind getrennt und nie Pflicht. Dann **Antrag einreichen**.
4. Danach sieht die Person den Stand: **Antrag in Prüfung**, **Antrag wird übermittelt**, **Du bist Mitglied** oder
   **Antrag abgelehnt**. Mit **Antrag zurückziehen** nimmt sie ihn zurück und kann später einen neuen stellen. Es gibt pro
   Konto einen Antrag.
5. Entscheiden kann der Vorstand in der **Mitgliederverwaltung (Dolibarr)**. Die Person bekommt eine Mail. Nach der Aufnahme
   erscheinen Mitgliedsnummer und Karte.

Ohne Mitgliedschaft schickt eine Seite des Mitgliederbereichs auf **Mitglied werden** und sagt, warum.

### 3.2 Anträge bearbeiten und einladen

**Admin → Mitglieder → Bewerbungen.** Reiter: **Offen**, **Aufgenommen**, **Abgelehnt**, **Zurückgezogen**, **In Übermittlung**.

- Jeder Antrag zeigt den Stand und den nächsten Schritt in einem Satz.
- **Annehmen** und **Ablehnen** (mit Begründung, die per Mail geht) gibt es nur, wo **die Website entscheidet**. Läuft der
  Antrag über Dolibarr, öffnet **In Dolibarr öffnen** den Eintrag; dort wird entschieden, die Website zeigt den Stand von selbst.
- **In Übermittlung** heißt: gespeichert, aber noch nicht bei Dolibarr. Die Website versucht es weiter.
- **+ Zum Antrag einladen:** Konto suchen (nur Konten **ohne** Mitgliedschaft), optional eine persönliche Zeile, **Einladen**. Die
  Person bekommt einen Hinweis auf der Website und in der App (und eine Mail, wenn sie Mitgliedschafts-Mails zulässt). Eine
  Einladung läuft nach **30 Tagen** ab; offene lassen sich in der Liste der Einladungen **zurückziehen**. Wer schon eingeladen
  ist, steht mit Datum da.
- Einladen darf nur die Vereinsverwaltung.

### 3.3 Der Mitgliederbereich

Für aktive Mitglieder und Ehrenmitglieder: Benutzermenü → **Mitgliederbereich** (`/members/area`). Oben die Karte mit
Name, Nummer, „Mitglied seit“ und Beitragsstand, darunter die **Sprungleiste**: **Karte**, **Versammlung**, **Helfen**,
**News**, **Dokumente**, mit der Zahl dessen, was offen oder neu ist („Versammlung · 1 offen“). „Neu“ heißt: in den letzten
zwei Wochen erschienen. Weiter unten stehen nur Abschnitte, in denen etwas ist: Versammlung, offene Abstimmung, freie
Helferdienste, Vereinsdokumente, Mitgliedervorteile, Ansprechpartner, „Gerade in Steam“ (nur Mitglieder mit verknüpftem Konto
und Einwilligung), „Discord jetzt“ (nur Zahlen, nie Namen) und die Discord-Server des Vereins.

Dieselben Zahlen stehen an den Kacheln auf **/verein** und im Tab „Verein“ der App. Interne Events stehen nicht hier, sondern
unter Events (gold markiert) und im Kalender. Eigene Rechnungen und eigene Unterlagen gehören zum Konto (Profil → „Nur für dich“).

**Wer ist Mitglied?** Aktive Mitglieder und Ehrenmitglieder sowie, wer Vereinsverwaltung oder System hat. Ein Konto muss dafür
einem Mitgliedseintrag zugeordnet sein (Dolibarr → Zuordnungen, oder das Mitglied nutzt auf „Meine Mitgliedschaft“ **Zuordnung
anfragen** bzw. den Einladungscode vom Vorstand). Eine Mitgliedsnummer allein reicht nicht.

**Meine Mitgliedschaft** (`/members/membership`): Karte, Mitgliedsart, „Mitglied seit“, Funktion im Verein, **Austritt
erklären** (mit Wunschdatum, der letzte Tag wird in der Mitgliederverwaltung gerechnet), **Meine Einwilligungen**
(auch in der App; **Ich stimme zu** erst nach dem Lesen der Fassung, **Widerrufen** jederzeit, der Text der zugestimmten Fassung bleibt lesbar), der eigene Eintrag im Mitgliederverzeichnis
(**Im Mitgliederverzeichnis zeigen**, Gamertag, Spiele, Plattformen, Kurztext, **Eintrag speichern**) und **Nummer öffentlich**.

### 3.4 Vorstand und Stellvertretungen

**Admin → Verein → Vorstand.** Eine Liste der Posten mit **Besetzen** bzw. **Ändern**.

- **Besetzen** über die Personensuche – nur **Vereinsmitglieder**. Vorher steht ein Satz, welche Rechte der Posten bringt (wer
  einen aktiven Posten hält oder vertritt, bekommt die **Vereinsverwaltung**), und eine Rückfrage bestätigt. Jede Besetzung steht
  im Protokoll. Besetzen dürfen Vereinsverwaltung und System.
- **Stellvertretung:** Bei Posten mit „Vertretung erlaubt“ lässt sich eine Vertretung eintragen und mit **Vertretung entfernen** wieder
  streichen. Offene Stellvertretungen zeigt die Vorstandsseite nicht.
- **Posten bearbeiten:** Bezeichnung (männlich, weiblich optional – „Obmann“ oder „Obfrau“ richtet sich nach dem Geschlecht im
  Profil), Beschreibung, Aktiv/Inaktiv, **Vertretung erlaubt**. Löschen steht unter „Mehr“.
- **Wir suchen …:** Ist ein Posten offen, zeigt die Vorstandsseite „Wir suchen …“ mit dem Satz zum Aufwand, den ihr je Posten
  eintragt (zum Beispiel „Zwei Stunden im Monat, Einschulung inklusive.“).
- **Fotos** kommen aus den Mitgliederprofilen; am schönsten freigestellt, sonst stehen sie einheitlich in Vereinsfarben.
- **Mit Dolibarr:** Führt Dolibarr den Vorstand („Vereinsdaten aus Dolibarr übernehmen“, Schalter unter Admin → Dolibarr →
  Funktionen), ist die Liste nur zum Lesen. Kommen die Rechte aus den Funktionen in Dolibarr, ist ein Posten hier nur für die
  Anzeige. Details: [Dolibarr](../DOLIBARR.md), [Rollen](../ROLLEN.md).

### 3.5 Statuten

- **Mit Dolibarr:** Gibt der Verein die Statuten im Modul für die Öffentlichkeit frei, zeigt die Vorstandsseite die geltende
  Fassung als PDF, dazu frühere und künftige Fassungen. Den Entwurf kennt die Website nie.
- **Ohne Dolibarr:** Ein Dokument der Kategorie **Statuten** unter Admin → Mitglieder → Dokumente (angepinnt oder das neueste,
  nie ein internes).
- Der Schalter **Statuten öffentlich zeigen** steht unter Admin → Dolibarr → Funktionen, ab Werk an. Aus: Die Statuten stehen nur im
  Mitgliederbereich unter Vereinsdokumente.
- Der Link **Vereinsstatuten** im Antrag führt auf genau diese Fassung.

### 3.6 Vereinsdokumente, Vorteile und Persönliches

- **Dokumente:** Admin → Mitglieder → Dokumente → **Neues Dokument**: Datei, Titel, Kategorie (Statuten, Protokolle, Formular,
  Regelwerk, Leitlinie, Download, Media Kit, Präsentation, Vorlage, Sonstiges), **Sichtbarkeit**, Tags und der Haken **Download
  erlauben** (Standard ist nur die Ansicht im Browser). Mitglieder finden sie unter **Vereinsdokumente**.
- **Mitgliedervorteile:** Admin → Mitglieder → Mitgliedervorteile: Titel, Text, Link, Gültigkeit, **Sichtbar für Mitgliedsarten**
  (leer = alle), **Aktiv**. Mitglieder sehen sie im Mitgliederbereich und in der App.
- **Persönliche Unterlagen** (Bestätigungen, Schreiben) legt der Vorstand in der Vereinsakte in Dolibarr ab; das Mitglied
  findet sie im eigenen Profil unter **Nur für dich → Deine Unterlagen** (`/account/documents`). Voraussetzung ist die bestätigte
  Zuordnung des Kontos zum Mitgliedseintrag. Ohne sie steht dort, wie die Verbindung klappt.

### 3.7 Versammlungen, Abstimmungen und Einlass

Alles kommt aus der Vereinsakte in Dolibarr; die Website zeigt und reicht durch, sie hat keine eigene Wahl.

- **Mitglieder:** Mitgliederbereich → **Versammlungen & Abstimmungen**: Einladung, Tagesordnung, **Ich komme** / **Vielleicht** /
  **Ich komme nicht**, Anträge zur Tagesordnung (mit Frist der Statuten), das eigene Stimmrecht, Abstimmung (die Stimme wird vor
  dem Senden bestätigt und lässt sich danach nicht ändern; welche Antwort jemand gab, speichert die Website nirgends) und das
  Ergebnis, sobald die Versammlungsleitung es bestätigt. Zu- oder Absage ist keine Anwesenheit. Ein Knopf trägt die Versammlung
  in den Kalender ein.
- **Einlass:** Admin → Mitglieder → **Einlass (Versammlung)** am Handy öffnen und die Mitgliedskarte scannen, ohne Karte die
  Mitgliedsnummer tippen. Einlassen darf, wer am Tag im Vorstand ist. Einrichtung und Grenzen: [Dolibarr](../DOLIBARR.md).

### 3.8 Helferdienste

Mitgliederbereich → **Helfen** (`/members/helfen`): Veranstaltungen mit Schichten aus der Vereinsakte. **Ich helfe** fragt an,
**Anfrage zurückziehen** nimmt sie zurück. „Angefragt“ heißt: Der Vorstand bestätigt; gezählt wird, was als geleistet
bestätigt ist. Absagen nach der Bestätigung gehen an den Vorstand. Die eigene Schicht lässt sich in den Kalender eintragen.
Schichten und Plätze legt der Verein in Dolibarr an. Ein Helfer-Aufruf führt direkt zur Veranstaltung.

### 3.9 Mitgliedskarte

Unter **Meine Mitgliedschaft** (Web) und in der App unter Mehr → Mitgliederbereich → Mitgliedskarte. Ein Partner scannt den
QR-Code; die Prüfseite zeigt ohne Anmeldung nur: gültig oder nicht, Vorname mit Anfangsbuchstabe, Mitgliedsart, gültig bis.
Der Code gilt fünf Minuten und erneuert sich, ein Foto davon nützt nichts. **Als Bild speichern** legt die Karte ohne Prüfcode
ins Album; ohne Netz zeigt die Seite die zuletzt geladene Karte mit „Stand“. Die Karte gilt, solange die Mitgliedschaft aktiv ist.
Apple und Google Wallet gibt es noch nicht. Mehr: [Dolibarr](../DOLIBARR.md).

### 3.10 Mitgliederverzeichnis und Profile

**Admin → Mitglieder → Mitglieder → Reiter Öffentliche Profile** (seit #1365 die einzige Stelle; die alte Adresse
`/admin/member-profiles` öffnet den Reiter, die Menüsuche „Profile“ findet ihn): Redaktionelle Profile mit großem Bild, Bio, Games und
Plattformen. **Profil erstellen** legt nur das Vereinsprofil an; ein Profil ist **kein Konto und keine Mitgliedschaft**. Das
Website-Konto verknüpft ihr im Profil im Kasten **Konto** (optional). Funktionen wie Obmann oder Kassier kommen automatisch aus
dem Vorstand. Mit Dolibarr kommen Mitglieder mit Einwilligung von selbst ins Verzeichnis (`/members`).

**Admin → Mitglieder → Mitglieder** (Reiter **Mitgliedschaften** und **Öffentliche Profile**): Suche
nach Name, E-Mail oder Mitgliedsnummer; **Mitgliedschaft bearbeiten**. Führt Dolibarr die Mitgliedschaft, kommen Status, Art,
Nummer und Beginn von dort und lassen sich hier nicht ändern; **interne Notizen** (sieht das Mitglied nicht) und
**Mitgliedsnummer auf öffentlichem Profil anzeigen** bleiben hier.

### 3.11 Kontakt-Inbox

**Admin → Verein → Kontakt-Inbox:** Nachrichten aus dem Kontaktformular mit Status; **Per E-Mail antworten**; Löschen ist endgültig.
Dazu die Benachrichtigung „Kontaktanfragen“ in der Kommandozentrale.

---

## 4. Wenn etwas nicht klappt

| Fehlerbild | Ursache | Lösung |
| --- | --- | --- |
| „Gerade nicht möglich – die Mitgliederverwaltung ist im Moment nicht erreichbar“ beim Antrag | Dolibarr antwortet nicht | Später noch einmal; der Antrag geht nicht verloren |
| Antrag steht auf „In Übermittlung“ | Gespeichert, aber noch nicht bei Dolibarr | Warten, die Website versucht es weiter; Stand unter Bewerbungen → In Übermittlung |
| Bei einem Antrag fehlt **Annehmen** | Der Antrag läuft über Dolibarr | **In Dolibarr öffnen** und dort entscheiden |
| Eine Person findet ihre Unterlagen nicht | Konto ist keinem Mitgliedseintrag zugeordnet | Dolibarr → Zuordnungen bestätigen, oder Einladungscode unter Meine Mitgliedschaft |
| „Die Website darf im Vereinsmodul noch nicht im Namen der Mitglieder handeln“ | Recht beim API-Benutzer fehlt | In Dolibarr einrichten ([Dolibarr](../DOLIBARR.md)) |
| Mitgliederbereich leitet auf „Mitglied werden“ | Das Konto ist kein aktives Mitglied | Mitgliedschaft und Zuordnung prüfen |
| In „Zum Antrag einladen“ findet die Suche niemanden | Gesucht werden nur Konten ohne Mitgliedschaft | Anderen Namen versuchen |
| Einladung ist weg | Sie ist nach 30 Tagen abgelaufen | Neu einladen |
| Eine Person lässt sich nicht als Vorstand eintragen | Es geht nur mit Vereinsmitgliedern | Erst Mitgliedschaft klären |
| Vorstandsliste ist nur lesbar | Dolibarr führt den Vorstand | In Dolibarr ändern |
| Statuten fehlen auf der Vorstandsseite | Nicht freigegeben, oder der Schalter ist aus | Freigabe in Dolibarr oder Dokument „Statuten“ prüfen |
| Karte zeigt „Prüfcode braucht Netz“ | Kein Netz | Gewollt, der Code braucht Verbindung |
| Beim Einlass „nicht eingeladen“ oder „kein Vorstand heute“ | Das Vereinsmodul entscheidet das | Einladung und Funktion in Dolibarr prüfen |

---

## 5. Häufige Fragen

**Können Mitglieder ohne Dolibarr verwaltet werden?**
Ja, mit der Mitgliederverwaltung der Website. Beiträge, Versammlungen, Helferdienste und persönliche Unterlagen gibt es aber nur mit Dolibarr.

**Wer entscheidet über Anträge?**
Der Vorstand. Mit Dolibarr in Dolibarr; sonst über Annehmen oder Ablehnen unter Bewerbungen.

**Wo ändere ich die Beiträge?**
In Dolibarr. Die Seite „Mitglied werden“ liest sie nur.

**Sieht die Turnierleitung Mitgliederdaten?**
Nein, das ist die Vereinsverwaltung.

**Kann die Website in Wallets speichern?**
Noch nicht, nur Karte in App und Web.

**Wer sieht „Nur Mitglieder“-Inhalte?**
Aktive Mitglieder, Ehrenmitglieder und Vereinsverwaltung oder System. Die Turnierleitung als Rolle allein reicht nicht.

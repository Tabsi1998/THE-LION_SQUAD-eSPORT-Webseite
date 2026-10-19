# Inhalte: News, Galerie und Seiten – Handbuch

Was auf der Website steht und wer es pflegt: News schreiben und verteilen, Galerie und Alben (mit den Fotos, die
Mitglieder von Events einsenden), die Medien-Bibliothek, „Über uns“ mit Zeitstrahl, Werten und Vereinsfoto, Sponsoren
und Partner, die Seite „Sponsor werden“, die Referenzen und die Serien (externe Wettbewerbe über eine Saison).

**Wo im Admin:**

- **Admin → Content → News** (`/admin/news`) – Beiträge, **Neuer Beitrag** (`/admin/news/new`)
- **Admin → Content → Galerie** (`/admin/gallery`) – Alben und **Eingesandte Fotos**
- **Admin → Content → Medien** (`/admin/media`, Seitenname „Medien-Browser“) – alle hochgeladenen Dateien
- **Admin → Verein → Über uns** (`/admin/about`) – die Texte der Seite „Über den Verein“
- **Admin → Verein → Sponsoren** (`/admin/sponsors`) – Sponsoren und die Seite „Sponsor werden“
- **Admin → Verein → Partner** (`/admin/partners`) – befreundete Vereine, Veranstalter, Communitys
- **Admin → Verein → Referenzen** (`/admin/references`) – Turnierteilnahmen des Vereins
- **Admin → Verein → Serien** (`/admin/reference-series`) – Turnierserien, Rennligen und Team-Ligen über eine Saison

Öffentlich: **/news**, **/gallery**, **/about**, **/sponsors**, **/partners**, **/references**.

Wer das darf: der Bereich **Redaktion**. Zwei Ausnahmen: **Eingesandte Fotos** in der Galerie geben auch die
**Vereinsverwaltung** (der Vorstand) frei, ohne Alben pflegen zu dürfen; **Events** und deren Newsletter gehören zur
Turnierleitung. Die Turnierleitung allein darf keine News, Galerie, Sponsoren oder Partner bearbeiten.

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
| **News** | Beitrag mit Bild, Video, Verknüpfungen, geplantem Termin, Newsletter und Discord-Meldung | Content → News |
| **Galerie** | Alben mit Abschnitten, Bildern und Videos, an ein Event gehängt | Content → Galerie |
| **Eingesandte Fotos** | Mitglieder schicken Fotos vom Event, ihr gebt frei oder lehnt ab | Content → Galerie, oben |
| **Medien** | Eine Bibliothek für alles Hochgeladene, mit Drehen, Zuschneiden, Prüfen | Content → Medien |
| **Über uns** | Leitbild, Zeitstrahl, Werte und Ziele, Vereinsfoto, Zahlen | Verein → Über uns |
| **Sponsoren** | Logo, Stufe, Laufzeit, wo der Sponsor erscheint | Verein → Sponsoren |
| **Sponsor werden** | Zahlen, Leistungen je Stufe, Mappe als PDF | Verein → Sponsoren, Kasten unten |
| **Partner** | Eigene Seite je Partner mit Kanälen, Tools und gemeinsamen News | Verein → Partner |
| **Referenzen** | Turnierteilnahmen mit Platzierung, für den Auftritt des Vereins | Verein → Referenzen |
| **Serien** | Externe Wettbewerbe über eine Saison: Spur, Saisons und ihre Regeln | Verein → Serien |

---

## 2. Einrichten Schritt für Schritt

1. **Über uns** füllen: Admin → Verein → Über uns (3.5). Das Vereinsfoto, ein paar Zeitstrahl-Einträge, Werte und Ziele.
2. **Sponsoren und Partner** anlegen (3.6, 3.7), sofern ihr welche habt. Mit Dolibarr-Anbindung kommen Name und Art von dort
   ([Dolibarr](../DOLIBARR.md)).
3. **Referenzen** eintragen (3.8), sobald es Turnierteilnahmen gibt.
4. **Erste News** schreiben (3.1) und veröffentlichen.
5. Für jedes Event ein **Album** anlegen (3.3), wenn die Fotos da sind.

---

## 3. Die Funktionen einzeln

### 3.1 News schreiben

1. **Admin → Content → News → Neuer Beitrag**.
2. **Titel**, **Kurzbeschreibung** (steht in der Liste, in Suchmaschinen und beim Teilen), **Inhalt**. Der Text ist
   Markdown; HTML wird nicht roh gezeigt. Mit `[[fastlap:name]]`, `[[tournament:name]]` und `[[event:name]]` setzt ihr Karten
   hinein.
3. **Banner** (das Bild oben und beim Teilen). Optional **Video (YouTube-Link)**: erscheint oben als Player, statt des
   Banners, und erst nach Zustimmung zu externen Medien.
4. **Kategorie**: Verein, Turniere, Events, Community, Sponsoren, Mitglieder, Teams, Ankündigung, Rückblick, Wartung.
5. **Sichtbarkeit**: **Öffentlich**, **Nur registrierte Community**, **Nur Vereinsmitglieder**, **Nur intern (Admins)**.
6. **Veröffentlicht** anhaken. Ohne **Veröffentlichungsdatum** erscheint der Beitrag sofort beim Speichern; mit einem Datum in der
   Zukunft ist er **geplant** und geht dann online. **Anpinnen** hält ihn oben in der News-Liste und auf der Startseite.
7. **Personen und Verknüpfungen**: Benutzer markieren (nur aktive öffentliche Profile; ein Klick setzt den Profil-Link in den
   Text) und **Verknüpfte Events**, **Turniere** und **Fast-Lap Challenges** – ein Klick setzt die Karte in den Text.
8. Die **Checkliste** rechts zeigt, was noch fehlt (Titel, Kurzbeschreibung, Bild, Text, Sichtbarkeit, SEO). Ohne Banner nimmt
   die Seite ein allgemeines Bild.
9. Speichern.

Die Liste unter Content → News hat Suche, Filter nach Kategorie und Sichtbarkeit; Löschen ist endgültig.

**Verteilen** (Kasten am Beitrag; am Handy zugeklappt): Zeigt, was hinausgeht – den **Newsletter** mit der Zahl der Empfänger
(nie Namen), die Meldung an Mitglieder oder Vorstand und die Discord-Vorschau.

- Veröffentlicht ihr, geht der Newsletter von selbst an die Abonnenten: „Geht beim Veröffentlichen von selbst an …“. Mit
  **Jetzt senden** schickt ihn die Redaktion von Hand. Danach steht dort „gesendet am … an …“.
- Ein **zweites Mal** senden nur Redaktion und System, immer mit Rückfrage.
- **Entwürfe** und **Nur intern** gehen nicht als Newsletter hinaus.
- Die Meldung „intern“ geht per Benachrichtigung nur an die, die den Inhalt sehen dürfen: bei **Nur Vereinsmitglieder** an aktive
  Mitglieder und Ehrenmitglieder, bei **Nur intern** an die Vereinsverwaltung. Öffentliche Beiträge melden so niemanden
  (dafür sind Newsletter und Discord da). Wer das nicht will, schaltet das Thema „Vereinsintern“ ab, siehe [Mails und
  Benachrichtigungen](mails.md).
- Discord: Öffentliche News gehen über den Bot in den Kanal, den ihr unter Verbindungen → Discord gewählt habt
  ([Discord](discord.md)). Alles Nicht-Öffentliche geht nie in einen öffentlichen Kanal.

### 3.2 Die Medien-Bibliothek

**Admin → Content → Medien** (Seite „Medien-Browser“). Hier liegt alles Hochgeladene: News-Bilder, Galerie, Sponsoren, Banner.

- **Medien hochladen** (Bilder und Videos, Größenlimit steht an der Auswahl) und Suche nach Dateinamen.
- Ein Klick auf eine Datei öffnet ein Blatt mit Vorschau, Angaben und **Verwendet in** (wo sie eingebaut ist), dazu **Drehen**,
  **Zuschneiden**, **URL kopieren** und **Löschen**. „Datei endgültig löschen?“ fragt vorher nach.
- Der **Qualitätscheck** zeigt unter anderem Kaputte Referenzen (Bildfelder zeigen auf Dateien, die es nicht mehr gibt), defekte
  Metadaten, doppelte Dateien und Dateien ohne Verwendung. **Scopes reparieren** sortiert alte Uploads ohne saubere Kategorie ein.
  Das braucht ihr nur bei Bedarf.
- Überall, wo ein Bild gewählt wird (Banner, Album, Sponsorenlogo …), könnt ihr neu hochladen **oder aus den schon hochgeladenen
  Medien wählen**.

### 3.3 Galerie und Alben

**Admin → Content → Galerie.** Oben **Neues Album**.

- Ein Album hat **Titel**, **Slug** (der Name in der Adresse), **Beschreibung**, **Cover-Bild**, **Aufgenommen am**, **Verknüpftes
  Event**, **Sichtbarkeit** (Öffentlich, Community, Nur Mitglieder), **Sortierung** und den Haken **Veröffentlicht**.
- Im Album: Bilder aus der **Medienbibliothek** wählen (**Auswahl hinzufügen**) oder hochladen; **Videos** als Link (YouTube,
  Twitch, Kick, Vimeo oder direkte MP4/WebM-Adresse) mit **Vorschaubild**; **Titel / Caption** je Medium.
- **Abschnitte** gliedern ein Album (zum Beispiel „Aufbau, Tag 1, Tag 2“). Löscht ihr einen Abschnitt, bleiben die Medien im
  Album unter „Ohne Abschnitt“.
- Ein Album, das an ein Event hängt, zeigt dort seine Kachel; das Album verweist mit „Vom Event: …“ zurück.
- Löschen eines Albums entfernt es und die zugeordneten Medien.

**Hinweis „Die Fotos sind da“:** Veröffentlicht ihr ein Event-Album, meldet ein Job das **einmal je Person** an die Angemeldeten
des Events (Event-Anmeldung, Turniere des Events, Teams mit allen Mitgliedern). Er wartet, bis zehn Minuten lang keine Fotos
mehr dazukommen; alte Alben melden nichts. Bei Alben mit „Nur Mitglieder“ erfahren es nur Mitglieder. Mehr: [Mails und
Benachrichtigungen](mails.md).

### 3.4 Fotos vom Event einsenden und freigeben

**Einsenden:** Mitglieder (wer Mitglieder-Inhalte sieht) sehen im Album eines Events **Fotos einsenden** („Warst du dabei?“),
vom ersten Event-Tag bis **sieben Tage nach dem letzten**. Bis zu **20 Bilder** je Person und Album, aus der Galerie oder vom PC, am
Handy auch mit der Kamera. Pflicht ist der Haken **Die Personen auf den Fotos sind einverstanden, dass die Bilder in der
Galerie erscheinen**. Mit **Mit meinem Namen zeigen („Foto: …“)** wählt die Person, ob ihr Name dabeisteht. Gäste sehen den Knopf
nicht. Jedes Bild wird neu gespeichert (ohne Ort und Kamera-Daten), liegt bis zur Freigabe privat und geht durch die Bildprüfung.

**Freigeben:** **Admin → Content → Galerie**, Kasten **Eingesandte Fotos** (nach Album sortiert). Der einzige Ort dafür.
Freigeben dürfen **Redaktion und Vereinsverwaltung**; wer nur die Vereinsverwaltung hat, sieht dort nur die Einsendungen, nicht
die Alben.

- **Freigeben** (einzeln oder alle) geht erst, wenn die Bildprüfung fertig ist. Steht ein Foto bei **Bildprüfung läuft**, wartet ihr; steht
  es bei **Bei der Moderation** oder **Von der Bildprüfung entfernt**, ist es ein Fall für die [Moderation](../MODERATION.md).
- **Ablehnen** löscht das Foto sofort, auf Wunsch mit einem **Grund (freiwillig)**.
- Die einsendende Person bekommt in beiden Fällen Bescheid. Jede Entscheidung steht im Protokoll.

### 3.5 Über uns

**Admin → Verein → Über uns.** Die Seite „Über den Verein“ besteht aus euren Texten und aus Daten, die sie selbst zieht
(Zahlen, Spiele, Vorstand, Events, Vereinsdaten). Rechts im Formular steht „Was die Seite sonst zeigt“, damit niemand danach sucht.

- **Texte:** Kopf, Spiele-Text, Aktivitäten (eine je Zeile) und der Aufruf.
- **Vereinsfoto:** Ein Foto für den ganzen Verein, steht im Kopf von „Über uns“. Nur eines, mit dem alle Abgebildeten einverstanden
  sind. Mit **Fokuspunkt setzen** (ins Bild klicken) legt ihr fest, welcher Punkt beim Zuschneiden immer sichtbar bleibt.
- **Zeitstrahl „So sind wir gewachsen“:** je Eintrag Jahr, ein Satz und auf Wunsch ein Bild (Gründung, erste LAN, erster
  Podestplatz …).
- **Werte & Ziele:** je Wert ein Satz mit Beispiel („Nach jedem Match ein GG“), dazu **Unsere Ziele** (eines je Zeile). Die alte
  Seite `/values` leitet auf diesen Abschnitt weiter.
- **Der Verein in Zahlen:** Haken je Zähler mit dem echten Stand, die Pfeile bestimmen die Reihenfolge. Gezählt, nicht getippt;
  Zähler mit null bleiben weg.
- **Gründung, Zweck, gemeinnützig:** kommen mit Dolibarr aus der Mitgliederverwaltung (Schalter **Vereinsdaten aus Dolibarr
  übernehmen**). Die Felder hier sind nur der Rückfall. Mit dem **Gründungstag** feiern Web und App jedes Jahr den Vereinsgeburtstag.

### 3.6 Sponsoren und „Sponsor werden“

**Admin → Verein → Sponsoren.** Je Sponsor ein Blatt (**Sponsor bearbeiten**):

- **Name**, **Logo**, **Link (URL)**, **Tier** (main, platinum, gold, silver, bronze), **Beschreibung**, **Reihenfolge**, **Aktiv**.
- **Vertrag:** **Vertragsstatus**, **Start**, **Ende**. Status und Laufzeit entscheiden, ob der Sponsor öffentlich erscheint; die
  Vorschau „Ausspielung“ sagt „Wird ausgespielt“ oder „Nicht öffentlich“.
- **Wo er erscheint:** **Auf Home**, **Im Footer**, **Events**, **TV / Anzeige**, **PDFs**, **E-Mails**. Das Tier ist nur eine Vorlage; die
  Haken entscheiden. Mit dem Haken **Events** wählst du **Bei allen Events** oder **Bei ausgewählten Events** (dann
  mindestens eines). Nur hier wird das festgelegt – das Event zeigt die Sponsoren nur an (#1371).
- **Ansprechpartner**, **Kontakt E-Mail**, **Telefon**, **Interne Notizen** (nie öffentlich).
- Sponsoren am TV: Haken **TV / Anzeige**, siehe [TV und Beamer](tv.md).
- Mit Dolibarr-Anbindung kommen Name, Stufe, Laufzeit und Kontakt von dort (diese Felder sind gesperrt); Link, Platzierungen,
  Reihenfolge und Texte bleiben hier. Logo und Banner kommen ab Vereinsmodul 1.9 aus Dolibarr. Technik: [Dolibarr](../DOLIBARR.md).
- Pflegeknöpfe für Bilder (**Bilder migrieren**, **URLs reparieren**, **Fehlende leeren**) braucht ihr nur bei Bedarf, jeweils mit Rückfrage.
- Auf der Kommandozentrale erinnert „Sponsoring läuft aus“ 30 Tage vorher.

**Sponsor werden** (Kasten **Sponsor werden** unten auf derselben Seite): Einleitung, **Zahlen – nur echte** (selbst eingetragen
oder von der Website gezählt, zum Beispiel „Besuche im Monat“), **Stufen in der Tabelle**, **Was jede Stufe bekommt** (Leistungen
je Stufe) und eine **Mappe als PDF** zum Hochladen. Interessierte sehen auf der Sponsoren-Seite die Tabelle, **Unterlagen anfordern** (führt ins Kontaktformular, Betreff vorbelegt; die Nachricht landet in der Kontakt-Inbox, siehe
[Verein und Mitglieder](verein.md)). Bleibt der Kasten leer, steht dort nur die kleine Karte „Sponsor werden“ zum Kontaktformular.

### 3.7 Partner

**Admin → Verein → Partner.** Jeder Partner hat eine eigene Seite unter `/partners/<Name>` (die alte Adresse leitet weiter).

- **Name**, Art (Verein, Messe, Community), **Kurzbeschreibung** (Partnerliste und Kopf der Seite), **Über den Partner**
  (längerer Text), Logo/Bild.
- **Kanäle:** **Discord-Einladung** und **Discord-Server-ID** (für „x gerade online“ muss der Partner im Discord das Widget
  einschalten: Servereinstellungen → Widget), **Twitch-Kanal** (Live-Anzeige läuft über die Twitch-App unter Verbindungen → Twitch),
  und eine Liste **Socials**: mit „+ Social“ eine Zeile, Plattform aus der Liste, Adresse; bei „Eigener Link“ eine Beschriftung.
- **Tools & Projekte:** Seiten des Partners; **Auf der Partnerseite einbetten** zeigt sie direkt, wenn die Seite des Partners
  das zulässt – sonst bleibt der Link.
- Partner können Referenzen und News mit ihrem Namen verknüpfen; sie erscheinen auf der Partnerseite unter „Gemeinsam“.
- Mit Dolibarr kommen Name und Art von dort.

### 3.8 Referenzen

**Admin → Verein → Referenzen.** Eine Referenz ist eine **Turnierteilnahme des Vereins**: **Titel** (nur der Turniername),
**Plattform**, **Format**, **Liga**, **Saison** als eigene Felder, Spiele (Mehrfachauswahl), Turnier-Webseite, Bracket/Tabelle,
Highlights/Notizen. Dazu **Einträge**: ein **Team** mit gemeinsamer Platzierung oder mehrere **Einzelstarter** mit je eigener
Platzierung, beides in derselben Teilnahme möglich. Spieler wählt ihr aus den Vereinsprofilen; externe Spieler tragt ihr als Namen ein.
Mit **Vorschläge speichern** pflegt ihr die Auswahllisten für Formate und Platzierungen. Einen Partner als Veranstalter oder per Haken
zu nennen, zeigt die Referenz auch auf seiner Seite.

Öffentlich ordnet **/references** unter **Jahr für Jahr** jede Teilnahme nach dem Jahr ihres **Startdatums** ein (Wiener Zeit;
ohne Start zählt das Enddatum). Teilnahmen ganz ohne Datum stehen am Ende unter **Ohne Datum** – tragt also ein Datum ein.
Die Filter darüber wählen dieselben Jahre („Alle Jahre“, „2026“ …); die **Saison** steht weiter als Text auf der Karte.
Neben jeder Teilnahme steht das **Logo des Spiels** (Admin → Spiele); hat das Spiel keins, zeigt die Kachel unter
**Wo wir antreten** sein **Kürzel** und die Karte einen Pokal neben dem Namen.
Die Medaillenzahlen oben zählen wie bisher je Eintrag.

### 3.9 Serien

**Admin → Verein → Serien** (`/admin/reference-series`). Für externe Wettbewerbe, die über eine ganze Saison laufen:
monatliche **Turnierserien**, **Rennligen** mit Fahrer- und Teamwertung und **Team-Ligen**. Der Aufbau hat zwei Stufen:

- Eine **Spur** ist die Klammer, etwa „Lion Racing F1“: Titel, Art, Bezeichnung (F1, 4vs4 …), Veranstalter, Spiel und
  Sichtbarkeit. **Neue Spur** öffnet das Blatt.
- Darunter je **Saison und Stufe** eine Serie: an der Spur **Saison**. Saison und Stufe (etwa „2026“ und „Division 1“)
  ergeben die Adresse. Dazu Status, Standard-Wochentag und -Uhrzeit (Wiener Zeit), das eigene Team, Links und wie
  Einträge eines Captains erscheinen – Standard: als Entwurf, den der Vorstand freigibt.

<table>
<tr>
<td><img src="../assets/serien/serien-liste.png" alt="Serien: eine Spur mit ihrer Saison, Status, Freigabe und Regel-Version" width="420"></td>
<td><img src="../assets/serien/serien-saison-anlegen.png" alt="Blatt Neue Saison mit Vorlage, Saison, Stufe und den Regeln" width="420"></td>
</tr>
</table>

**Regeln:** Die **Punkteschema-Vorlage** füllt alle Regeln vor. Sie werden kopiert – eine spätere Änderung der Vorlage
ändert die Saison nicht. Einstellbar ist alles: Punkte je Platz oder **laut Veranstalter**, Boni für schnellste Runde und
Pole (bis Platz X), Punkte bei Ausfall, Nichtstart und Disqualifikation, **alle Runden**, **beste N** oder **N
Streichergebnisse** (es zählen die besten „Runden im Kalender minus N“), Aktivitätspunkte ab Runde X, die Finalgrenze,
der Vorrang bei Gleichstand (der Reihe nach, sonst teilen sich beide den Platz) und die Teamwertung (wie viele Fahrer je
Rennen zählen, ob Gäste zählen). Eine Team-Liga hat stattdessen Punkte für Sieg, Unentschieden und Niederlage.

Ändert ihr eine Regel mitten in der Saison, steigt die **Version**, der **Hinweis zur Regeländerung** steht bei der Saison
und im Protokoll, und alle Tabellen der Saison werden neu gerechnet.

<img src="../assets/serien/serien-saison-seite.png" alt="Seite einer Saison mit Regeln, Version und Hinweis zur letzten Änderung" width="560">

**Archivieren statt Löschen:** Spur und Saison lassen sich nur archivieren; **Archivierte zeigen** blendet sie ein,
**Zurückholen** macht es rückgängig. Ein Klick auf die Saison öffnet ihre Seite mit Regeln, Version und Kalender.
Teilnehmer und Ergebnisse kommen dort in den nächsten Schritten dazu, Captains stehen weiter unten. Die bestehenden
Referenzen bleiben, wie sie sind.

**Kalender der Saison.** Auf der Seite der Saison stehen alle Termine in ihrer Reihenfolge, jeder mit Status:
**Geplant**, **Heute**, **Ergebnis fehlt** (Tag vorbei, nichts eingetragen), **Verschoben**, **Abgesagt** und
**Gewertet**. Gezählt wird immer nach dem Wiener Kalendertag.

- **Liste einfügen:** je Zeile ein Termin, etwa `R1 · 05.11. · Strecke` – Kürzel, Datum (TT.MM. oder TT.MM.JJJJ),
  optional Uhrzeit und Ort; trennen mit Leerzeichen, `·`, `|` oder `;`. Ohne Jahr gilt das erste Jahr der Saison, über
  Neujahr zählt es weiter. Eine Zeile ohne Datum bekommt den nächsten **Standard-Wochentag** nach der Zeile davor,
  ohne Uhrzeit gilt die **Standard-Uhrzeit**. **Vorschau** zeigt, was daraus wird; hat eine Zeile einen Fehler, steht
  er mit Zeilennummer da, und übernommen wird erst eine fehlerfreie Liste.
- **Termin:** einzeln anlegen; Tag und Uhrzeit sind mit dem nächsten Standard-Wochentag und der Standard-Uhrzeit
  vorbefüllt. Art **Finale**, **Zählt zur Wertung** (aus: steht im Kalender, geht aber nicht in die Tabelle) und bei
  einer Team-Liga der Gegner. Die Notiz sieht nur die Verwaltung.
- **Verschieben** (Kalender-Symbol): neuer Tag und Uhrzeit. Der ursprüngliche Tag bleibt beim Termin stehen, auch wenn
  ihr noch einmal verschiebt.
- **Absagen** (Verbotszeichen): ein abgesagter Termin fehlt nie und zählt nicht zur Rundenzahl der Wertung;
  **Wieder ansetzen** nimmt es zurück.
- **Reihenfolge:** mit den Pfeilen oder **Nach Datum ordnen**. **Archivieren** nimmt einen Termin aus dem Kalender,
  unter **Archiviert** lässt er sich zurückholen. Gewertete Termine lassen sich weder absagen noch archivieren.

Hat ein Termin kein Ergebnis, obwohl danach schon gewertet ist, steht oben der Hinweis **Lücke im Kalender** – meist
fehlt das Ergebnis, oder der Termin wurde abgesagt.

<table>
<tr>
<td><img src="../assets/serien/serien-kalender-einfuegen.png" alt="Blatt Terminliste einfügen mit der Vorschau der erkannten Termine" width="420"></td>
<td><img src="../assets/serien/serien-kalender-verwaltung.png" alt="Kalender der Saison mit verschobenem und abgesagtem Termin" width="420"></td>
</tr>
</table>

**Öffentlich** steht der Kalender unter `/references/series/<spur>/<saison>` – mit der Sichtbarkeit von Spur und Saison
(eine Saison „Nur Mitglieder“ sehen Gäste nicht), ohne Notizen; statt „Ergebnis fehlt“ steht dort „Ergebnis folgt“. Die volle Serienseite mit Tabelle kommt in einem
späteren Schritt; bis dahin ist die Seite nicht für Suchmaschinen gedacht.

**Captains:** Auf der Seite der Saison steht unten **Captains**. Dort tragt ihr Mitglieder ein, die für genau diese
Saison Ergebnisse hochladen dürfen – nur aktive Vereinsmitglieder, die Suche findet nur sie. Namen tippen, **Gilt bis** wählen (Pflicht, meist das Saisonende) und – wenn der
Captain ohne Freigabe veröffentlichen darf – **Darf veröffentlichen** anhaken; dann **Captain hinzufügen**. In der Liste
lassen sich der Ablauf verlängern (**Ablauf speichern**), das Recht umschalten und der Captain entfernen. Abgelaufene
Captains stehen blass am Ende. Fehlt einem Captain noch die Zwei-Faktor-Anmeldung oder ist er kein aktives Mitglied mehr,
steht es dabei – so lange kommt er nicht in die Saison. Steht die Saison unter **Einträge eines Captains** auf „Captain veröffentlicht direkt“, gilt das für
alle ihre Captains.

<img src="../assets/serien/serien-captains.png" alt="Abschnitt Captains einer Saison mit einem Captain, Ablauf, Recht zum Veröffentlichen und dem Formular zum Hinzufügen" width="560">

Ein Captain findet seine Saisons unter **Mein Dienst → Meine Serien** (im Benutzermenü, oder `/admin`). **Saison
öffnen** zeigt die Seite der Saison ohne die Knöpfe des Vorstands; oben steht, bis wann sein Recht gilt und ob seine
Einträge Entwürfe sind. Nach dem letzten Tag verschwindet die Saison aus der Liste.

<img src="../assets/serien/serien-meine-serien.png" alt="Mein Dienst eines Captains mit der Liste Meine Serien" width="560">

---

## 4. Wenn etwas nicht klappt

| Fehlerbild | Ursache | Lösung |
| --- | --- | --- |
| Beitrag ist gespeichert, aber nicht zu sehen | **Veröffentlicht** nicht gesetzt, Datum liegt in der Zukunft („geplant“) oder Sichtbarkeit zu eng | Haken, Datum und Sichtbarkeit prüfen |
| Newsletter ging nicht hinaus | Entwurf oder **Nur intern**, oder keine Abonnenten | Veröffentlichen, Kasten **Verteilen** ansehen |
| „Newsletter ein zweites Mal senden?“ erscheint nicht für dich | Das dürfen nur Redaktion und System | Dort fragen |
| Kein Banner beim Teilen | Kein Bild gesetzt | **Banner** wählen |
| Video-Player zeigt nichts | Besucher haben externen Medien nicht zugestimmt | Gewollt |
| Admin → Galerie zeigt nur Einsendungen | Du hast nur die Vereinsverwaltung | Gewollt, Alben pflegt die Redaktion |
| **Freigeben** ist grau | Die Bildprüfung läuft noch | Warten |
| Mitglied sieht „Fotos einsenden“ nicht | Außerhalb des Zeitfensters (bis sieben Tage nach dem Event), kein Mitglied, oder Album nicht an ein Event gehängt | Verknüpftes Event und Datum prüfen |
| „Fotos sind da“ kam nicht | Album nicht veröffentlicht, oder noch Fotos in den letzten zehn Minuten dazugekommen | Veröffentlichen und kurz warten |
| Bild ist plötzlich weg („Kaputte Referenzen“) | Die Datei wurde gelöscht | Medien → Qualitätscheck, neues Bild wählen |
| Upload scheitert („zu groß oder Reverse Proxy blockiert“) | Datei über dem Limit | Verkleinern; Limit steht an der Auswahl |
| Sponsor ist angelegt, aber nicht zu sehen | Status nicht aktiv, Laufzeit abgelaufen oder keine Platzierung | Vorschau „Ausspielung“ am Sponsor |
| Sponsor-Felder lassen sich nicht ändern | Dolibarr führt sie | In Dolibarr ändern |
| Partner zeigt „x online“ nicht | Das Widget ist im Discord des Partners aus | Partner bitten, es einzuschalten |
| Seite „Über uns“ zeigt keine Zahl | Zähler mit null bleiben weg | Gewollt |
| `/references/series/…` zeigt „Hier ist kein Rudel“ | Saison oder Spur archiviert, Adresse falsch, oder die Sichtbarkeit ist enger (etwa „Nur Mitglieder“) | Sichtbarkeit und Status prüfen |
| Termin steht auf **Ergebnis fehlt**, fand aber nie statt | Nicht abgesagt | **Absagen** – dann fehlt er nicht mehr |

---

## 5. Häufige Fragen

**Kann die Turnierleitung News schreiben?**
Nein, das ist die Redaktion.

**Kann ich eine Serie löschen?**
Nein – Spur und Saison werden archiviert und lassen sich zurückholen. So gehen Termine, Ergebnisse und Tabellen nie verloren.

**Wo stelle ich ein, dass eine News nur Mitglieder sehen?**
Im Beitrag unter **Sichtbarkeit**: **Nur Vereinsmitglieder**.

**Wie verschicke ich eine News als Newsletter?**
Beim Veröffentlichen geht er von selbst hinaus; sonst im Kasten **Verteilen** mit **Jetzt senden**.

**Kann ich ein Foto nachträglich entfernen?**
Im Album das Medium löschen. In den Medien gibt es **Löschen** für die Datei selbst.

**Wo steht das Vereinsfoto?**
Admin → Verein → Über uns, Abschnitt Vereinsfoto.

**Wie viele Fotos darf ein Mitglied einsenden?**
20 je Album.

**Was ist die „Mediathek“?**
Die Seite **Admin → Content → Medien**.

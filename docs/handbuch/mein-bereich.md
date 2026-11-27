# Mein Bereich

Alles, was eine Person selbst betrifft – Profil, Mitgliedschaft, Rechnungen, Verein, Benachrichtigungen, Konto und
Datenschutz – liegt an **einem Ort**: **Mein Bereich** unter `/mein-bereich` (#2059). Vorher gab es vier Namen für fast
dasselbe („Mein Profil“, „Einstellungen“, „Mitgliederbereich“, „Meine Mitgliedschaft“); die alten Adressen leiten
weiter, auch aus Mails, Benachrichtigungen und der App.

## Überblick

| Gruppe | Adresse | Was dort steht |
| --- | --- | --- |
| Übersicht | `/mein-bereich` | **Zu tun** als große Knöpfe, **Häufig gebraucht**, am Handy die Liste aller Gruppen |
| Profil | `/mein-bereich/profil` | Reiter Grunddaten (Anzeigename, Bild, Banner, Bio), Gaming & Spiel-IDs, Socials; Knopf **So sehen andere mich** |
| Mitgliedschaft | `/mein-bereich/mitgliedschaft` | Status, Ausweis, Beitrag, Wunschnummer, **Meine Daten** (Anschrift und Telefon ändern), Austritt; ohne Mitgliedschaft der Weg zum Antrag |
| Rechnungen & Unterlagen | `/mein-bereich/rechnungen` | Reiter Rechnungen, Unterlagen, Gewinne, Strafen |
| Verein | `/mein-bereich/verein` | Nur für Mitglieder: nächste Versammlung, Helferdienste, interne News, Dokumente, Vorteile; Unterseiten `…/verein/versammlungen`, `helfen`, `dokumente`, `news`, `vorteile` |
| Benachrichtigungen | `/mein-bereich/benachrichtigungen` | Was wie kommt (Glocke, Push, Mail, Discord), Newsletter, Ruhezeit – siehe [Mails und Benachrichtigungen](mails.md) |
| Konto & Sicherheit | `/mein-bereich/konto` | Reiter Sicherheit (Passwort, Passkeys, Zwei-Faktor, Google, Geräte), Darstellung, Kalender-Abo, App & Rechtliches; Knopf **Abmelden** |
| Datenschutz | `/mein-bereich/datenschutz` | Reiter Sichtbarkeit (mit blockierten Konten), Einwilligungen, **Daten herunterladen**, **Konto löschen** |

Am PC steht links die Seitenleiste mit den Gruppen, rechts der Inhalt. Am Handy ist `/mein-bereich` die Liste; jede
Gruppe öffnet sich als eigene Seite mit dem Knopf **Mein Bereich** zurück.

## So kommt man hin

- **Benutzermenü** (Name oben rechts): Dashboard, dann **Mein Bereich** und jede Gruppe direkt. Der eigene Name ganz
  oben im Menü öffnet das öffentliche Profil („So sehen andere mich“).
- **Untere Leiste am Handy**: **Profil** führt nach Mein Bereich.
- **Dashboard**: Knopf **Mein Bereich** oben und die Liste der Gruppen unten.
- Die Seite **Verein** (`/verein`): für Mitglieder ein Knopf nach Mein Bereich → Verein. Im Hauptmenü Verein und in der
  Fußzeile steht Mein Bereich nicht (Fabian 27.11.) – dafür gibt es das Benutzermenü.

Ab dem Start (Dashboard, „Start“ in der unteren Leiste) ist jede Funktion mit höchstens zwei Klicks erreichbar: die
Gruppe, dann – wo nötig – der Reiter. Jede Gruppe ist von jeder Seite aus mit zwei Klicks erreichbar (Benutzermenü bzw.
untere Leiste). Der Test dafür steht in `frontend/e2e/mein-bereich.spec.js`.

## Die Funktionen einzeln

### Übersicht: Zu tun

„Zu tun“ kommt aus Daten, die es schon gibt – nichts Neues am Server:

| Knopf | Wann | Führt nach |
| --- | --- | --- |
| Offene Rechnung bezahlen | eine Rechnung ist offen (orange, wenn überfällig) | Rechnungen & Unterlagen |
| Mitgliedsbeitrag offen | der Beitrag ist offen und es gibt dafür noch keine Rechnung | Mitgliedschaft → Beitrag |
| Einwilligung geändert – bitte neu lesen | du hast einer Einwilligung zugestimmt und ihr Text hat sich seither geändert – die Zustimmung deckt den neuen Text nicht. Nie beantwortete oder widerrufene freiwillige Einwilligungen stehen nur unter Datenschutz → Einwilligungen | Datenschutz → Einwilligungen |
| Nummer wählen | die Wunschnummer ist frei wählbar und noch nicht gewählt | Mitgliedschaft → Meine Nummer |
| Abstimmung offen / Zur Versammlung antworten | eine Abstimmung läuft oder eine Einladung wartet auf Antwort | Verein → Versammlungen |
| Gewinn abholen | ein Gewinn ist offen oder bereit | Rechnungen & Unterlagen → Gewinne |
| Zwei-Faktor einrichten | eine Verwaltungsrolle ohne Zwei-Faktor | Konto & Sicherheit |

Die Zahl steht zusätzlich an der Gruppe in der Seitenleiste („1 offen“). Ist nichts offen, steht „Alles erledigt“.

### Begriffe

- **Konto löschen** heißt überall so (vorher „Konto anonymisieren“). Was passiert, steht auf der Karte: persönliche
  Daten werden überschrieben, Ergebnisse bleiben ohne Namen.
- **Daten herunterladen** (vorher „Datenexport“): eine Datei mit allem, was gespeichert ist.
- **Meine Daten** steht nur noch für Anschrift und Telefon in der Mitgliedschaft.

## Alte Adressen

Alte Adressen leiten weiter; Suche (`?invoice=`, `?meeting=`, `?event=`, `?link=` …) und Anker (`#versammlung`,
`#mitgliedskarte`, `#dieser-browser`) gehen mit. Die Zuordnung steht in `frontend/src/lib/meinBereich.js`
(`legacyTarget`).

| Alte Adresse | Neu |
| --- | --- |
| `/profile`, `/profile?tab=basic` | `/mein-bereich/profil` |
| `/profile?tab=gaming`, `?tab=socials` | `/mein-bereich/profil?tab=gaming` bzw. `?tab=socials` |
| `/profile?tab=notifications` | `/mein-bereich/benachrichtigungen` |
| `/profile?tab=security`, `?tab=sessions` | `/mein-bereich/konto` |
| `/profile?tab=appearance`, `?tab=calendar`, `?tab=about` | `/mein-bereich/konto?tab=…` |
| `/profile?tab=privacy` | `/mein-bereich/datenschutz` |
| `/profile?tab=invoices`, `/account/invoices` | `/mein-bereich/rechnungen` |
| `/account/documents` | `/mein-bereich/rechnungen?tab=unterlagen` |
| `/my/prizes` | `/mein-bereich/rechnungen?tab=gewinne` |
| `/my/penalties` | `/mein-bereich/rechnungen?tab=strafen` |
| `/privacy-account` | `/mein-bereich/datenschutz?tab=daten` |
| `/members/area`, `/mitgliederbereich`, `/member-area` | `/mein-bereich/verein` |
| `/members/membership` | `/mein-bereich/mitgliedschaft` |
| `/members/meetings`, `/members/helfen`, `/members/documents`, `/members/news`, `/members/benefits` | `/mein-bereich/verein/versammlungen`, `…/helfen`, `…/dokumente`, `…/news`, `…/vorteile` |
| `/profile?tab=teams`, `friends`, `achievements`, `honours`, `inbox` | unverändert: Teams, Spieler, eigenes Profil, Chats |

Das öffentliche Profil bleibt öffentlich unter `/u/<name>` (`/u/me` führt zum eigenen).

**Mails und Benachrichtigungen** nennen bewusst noch die alten Adressen: Die App öffnet Links wie `/profile?tab=…` und
`/members/membership` direkt im passenden Bildschirm, `/mein-bereich` kennt sie noch nicht. Im Browser leiten die
alten Adressen weiter. Umgestellt wird zusammen mit der App (Mein Bereich in der LionsAPP).

## Wenn etwas nicht klappt

| Fehlerbild | Ursache | Lösung |
| --- | --- | --- |
| „Verein“ fehlt in der Seitenleiste | Das Konto ist kein Vereinsmitglied (oder noch nicht zugeordnet). | Unter Mitgliedschaft steht der Weg zum Antrag; die Zuordnung macht der Vorstand. |
| Ein alter Link landet in der Übersicht | Die Adresse ist unbekannt (Tippfehler). | Gruppe in der Seitenleiste wählen; fehlt eine Weiterleitung, im Issue melden. |
| „Zu tun“ zeigt nichts, obwohl eine Rechnung offen ist | Die Mitgliederverwaltung antwortet gerade nicht. | Rechnungen & Unterlagen zeigt den letzten Stand mit Hinweis; später neu laden. |

## Häufige Fragen

**Wo stelle ich die Saison-Deko ein?** Konto & Sicherheit → Darstellung.

**Wo finde ich mein Kalender-Abo?** Konto & Sicherheit → Kalender-Abo.

**Wo sehe ich, wie andere mein Profil sehen?** Profil → Knopf **So sehen andere mich**, oder im Benutzermenü auf den
eigenen Namen.

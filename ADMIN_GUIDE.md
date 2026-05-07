# Admin-Handbuch

Dieses Dokument beschreibt die wichtigsten Admin-Ablaeufe fuer die THE LION SQUAD eSPORT Webseite.

## Grundprinzip

- Inhalte werden im Adminbereich gepflegt.
- Oeffentliche Seiten zeigen nur veroeffentlichte und sichtbare Inhalte.
- Uploads sind getrennt: normale Profil-Uploads landen im User-Medienbereich, Admin/CMS-Uploads im Admin-Medienbereich.
- Vereinsmitglieder sind getrennt von normalen Plattform-Accounts. Ein Vereinsmitglied kann aber mit einem Plattformkonto verknuepft werden.

## Nach jedem Deployment

1. `https://lionsquad.at` oeffnen.
2. Login als Admin.
3. `Admin -> Einstellungen -> Status` pruefen.
4. `Admin -> Einstellungen -> Twitch` pruefen, falls Twitch genutzt wird.
5. `Admin -> Einstellungen -> Discord` pruefen, falls Webhooks oder Discord-Counter genutzt werden.
6. Einen kleinen Upload-Test im Medienbereich oder Branding machen.
7. Startseite, Community, Verein, Events und ein Profil oeffnen.

## E-Mail und Benachrichtigungen

Das System trennt Pflichtmails und optionale Benachrichtigungen.

Pflichtmails:

- Registrierung
- Passwort-Reset
- Admin-Einladung
- Testmail

Diese Mails werden nicht durch Profil-Opt-outs blockiert.

Optionale Mails:

- Match-Erinnerungen
- Turnier-Updates
- Gewinn- und Abholhinweise
- Mitgliedschaftsinfos
- News und Events

Newsletter, News und Event-Hinweise gehen nur an Accounts mit expliziter Newsletter-Einwilligung. User verwalten das unter `Mein Profil -> Privatsphaere -> E-Mail-Benachrichtigungen`.

Regeln:

- Interne Inhalte werden nicht per Newsletter verschickt.
- Mitglieder-spezifische Newsletter gehen nur an aktive oder Ehren-Vereinsmitglieder.
- News/Event-Veröffentlichungen werden dedupliziert, damit dieselbe Person dieselbe Mail nicht mehrfach bekommt.
- Nach groesseren Veröffentlichungen `Admin -> Einstellungen -> Mail-Queue` und `Versandlogs` pruefen.

## Medien und Uploads

### User-Uploads

Normale Nutzer laden Bilder im eigenen Profil hoch. Auch wenn ein Admin seinen eigenen Account bearbeitet, gehoeren diese Bilder zum persoenlichen Medienbereich.

Wichtig:

- Profilbilder und Banner von normalen Accounts duerfen nicht automatisch in der Admin-Medienbibliothek auftauchen.
- `/api/media` zeigt den persoenlichen Medienbereich.
- `/api/admin/media` zeigt Admin-/CMS-Medien.

### Admin-/CMS-Uploads

Admin-Medien entstehen bei News, Events, Sponsoren, Branding, Galerie und aehnlichen CMS-Inhalten.

Empfohlene Pflege:

- Eventbilder als echtes Event-Cover hochladen.
- Sponsorenlogos moeglichst transparent oder sauber freigestellt hochladen.
- Vereinsmitgliederbilder mit transparentem Hintergrund funktionieren gut, weil die Karten darauf ausgelegt sind.

## Mitglieder, Vereinsmitglieder und Vorstand

### Normale Plattform-Accounts

Plattform-Accounts sind alle registrierten Nutzer. Sie koennen:

- Profile pflegen
- Social-/Gaming-Felder sichtbar machen oder verstecken
- Turniere/Fast-Lap-Challenges nutzen
- Teams anlegen oder beitreten
- Achievements sammeln

### Vereinsmitglieder

Vereinsmitglieder werden auf der Vereinsseite gepflegt und sind eine redaktionelle Darstellung des offiziellen Vereins.

Empfohlener Ablauf:

1. `Admin -> Mitgliederseite` oeffnen.
2. Profil fuer die Person anlegen.
3. Gamertag gross pflegen, Vor-/Nachname als echten Namen pflegen.
4. Foto, Games, Plattformen und Bio pflegen.
5. Optional ein Plattformkonto verknuepfen.

Wenn ein Plattformkonto verknuepft ist, kann dieses Konto fuer Mitgliedervorteile und Vereinsstatus genutzt werden.

### Vorstand

Der Vorstand sollte aus bestehenden Vereinsmitgliederprofilen gewaehlt werden.

Regel:

- Vorstand zeigt auf das Vereinsmitgliederprofil, nicht direkt auf ein Plattformkonto.
- Die Funktion im Vorstand ueberschreibt die normale Mitgliedsanzeige: z.B. Obmann, Kassierin, Schriftfuehrerin.
- Sonderrollen nur anlegen, wenn sie wirklich gebraucht werden.

## Achievements und Level

### Achievement-Typen

- Live-Achievements: werden aus echten Systemdaten berechnet.
- Counter-Achievements: werden aus gepflegten Zaehlern berechnet, z.B. Discord-Nachrichten.
- Manuelle Achievements: werden von Admins vergeben.
- Member-only-Achievements: nur aktive oder Ehren-Vereinsmitglieder koennen sie erhalten.
- Negative/Fun-Achievements: bleiben geheim, bis sie vergeben wurden. Danach sieht man nur die freigeschalteten geheimen Awards.

Der Systemkatalog hat mehr als 300 Achievements, davon mindestens 50 geheime Negative-/Fun-Awards. Nicht automatisch messbare Ziele sind bewusst manuell markiert, damit im oeffentlichen Profil keine kaputten oder unechten Progress-Balken erscheinen.

Nicht sinnvoll fuer normale User:

- Event-Gastgeber/Organisator-Achievements werden nicht oeffentlich angezeigt, weil Vereinsevents ein Admin-/Vereinsworkflow sind.

Negative/Fun-Awards werden ueber `Admin -> Achievements -> Vorfall` oder als manuelle Vergabe ausgelöst. Sie geben kleine Punkte, sind aber versteckt und sollen gezielt eingesetzt werden.

### Levelsystem

Account-Level ergeben sich aus Achievement-Punkten. Level-Progression selbst zaehlt nicht nochmal in die Punkte, damit es keine Punkte-Schleife gibt.

Empfehlung:

- Viele kleine Achievements fuer Aktivitaet.
- Wenige besondere Achievements fuer grosse Meilensteine.
- Animationen und starke Rahmen nur fuer hohe Level oder besondere Achievements verwenden.

Live angebundene Quellen:

- Turnier-Anmeldungen, Siege, Podestplaetze, Formate und Spiele
- abgeschlossene Matches und Siegesserien
- Fast-Lap-Zeiten, Strecken und Pole Positions
- Profilvollstaendigkeit und Plattformfelder
- Vereinsmitgliedschaftsdauer
- Teamgruendung und Teamzugehoerigkeit
- Season-Punkte und aktive Saisons
- Twitch Live-Sessions und Stream-Minuten
- Discord-Nachrichten-Counter

Manuelle Quellen:

- Community-Hilfe, Mentor, Creator, besondere Events
- faire/negative Sonderfaelle, wenn keine sichere automatische Messung existiert
- alle geheimen Fun-/Negative-Awards

## Discord

### Webhook

Unter `Admin -> Einstellungen -> Discord` kann ein Discord-Webhook gepflegt werden.

Nutzen:

- automatische Benachrichtigungen fuer wichtige Ereignisse
- Testnachricht senden
- letzter Discord-Status sichtbar

### Discord-Aktivitaet

Im gleichen Tab kann der Discord-Counter gepflegt werden.

Aktuell ist das ein manueller Counter:

- User suchen
- `+1`, `+10` oder festen Wert setzen
- danach werden `discord_active` Achievements automatisch neu bewertet

Spaeter kann ein echter Discord-Bot diesen Counter automatisch aktualisieren.

## Twitch

Unter `Admin -> Einstellungen -> Twitch` werden Twitch-Funktionen gepflegt.

Felder:

- TLS Twitch Channel
- Twitch Client ID
- Twitch Client Secret
- Live-Erkennung aktiv/inaktiv

Nutzen:

- Live-Slider auf der Startseite
- Twitch-Status in Profilen
- Streamer-Achievements
- erkannte Live-Sessions und Streamzeit

Das Client Secret wird nach dem Speichern nicht mehr im Klartext zurueckgegeben.

## Events, Turniere und Fast Lap

### Events

Events sollten ein klares Datum, Coverbild, Ort und Sichtbarkeit haben.

Die Home-Seite zeigt kommende/relevante Inhalte dynamisch. Vergangene Inhalte sollen nicht die Home-Seite dominieren.

### Turniere

Turniere koennen mit Events verknuepft werden. Wenn es sinnvoll ist, sollte das Bracket im Eventkontext sichtbar sein.

### Fast Lap

Fast-Lap-Challenges brauchen normalerweise keine Online-Anmeldung.

Wichtig:

- Wenn `online_registration_enabled` aus ist, darf oeffentlich nicht `Anmeldung offen` stehen.
- Dann soll die Challenge als angekuendigt/live/abgeschlossen erscheinen.
- Top 3 und Leaderboard sind wichtiger als ein klassischer Check-in.

## Sponsoren und Footer

Sponsorenlogos werden im Admin gepflegt. Der Footer zeigt die Logos als Slider.

Empfehlung:

- Keine Sponsorennamen im Footer erzwingen, wenn das Logo selbsterklaerend ist.
- Doppelte Logos vermeiden.
- Nur oeffentliche/aktive Sponsoren anzeigen.

## Profile und Sichtbarkeit

Nutzer koennen Socials und Gaming-IDs pflegen.

Sichtbarkeit:

- Oeffentlich
- Nur Community
- Nur Vereinsmitglieder
- Nur Admins
- Privat

Oeffentliche Profile zeigen nur Felder, die wirklich oeffentlich freigegeben sind.

## Was sparsam genutzt werden sollte

- zu viele Animationen
- zu viele negative/fun Achievements
- externe API-Integrationen ohne klaren Nutzen
- doppelte Call-to-Actions wie zu oft `Account erstellen` oder `Mitglied werden`

Das Ziel ist eine professionelle Vereins- und eSports-Plattform, nicht eine ueberladene Marketingseite.

# Verbindlicher Restplan

Stand: 8. September 2026. Sicherheitsbasis: PR #152, Wartung PR #153 (`e06e509`),
Login-Wiederherstellung PR #154 (`216eb6c`), Website-Stabilisierung PR #155 (`df4711e`).
Dokumentationsübersicht: [DOCS.md](DOCS.md).

## Beauftragte Erweiterung: Gameserver

Spielauswahl mit Icon-Vorschau und abschaltbarem Bild; optionaler Modded-Bereich
mit einzeln schaltbaren HTTPS-Links für Loader, Modpakete, Konfigurationen und
Anleitungen. Umsetzung und Regressionstests im Quellstand; echte Inhalte pflegt
der Betreiber gemäß [ADMIN_GUIDE.md](ADMIN_GUIDE.md#gameserver-spielelogos-und-modded-einrichtung).
Kein automatischer Download/Mod-Installationsdienst und kein Eingriff in laufende Gameserver.

## Aktuelle Priorität: gemeldete Produktivprobleme

| Paket | Quellstand | Abnahme |
| --- | --- | --- |
| U1 – MongoDB-Update | Authentifizierte Prüfung implementiert; Fehlerfälle lassen `.env` unverändert | Betreiber meldet erfolgreichen Build/Containerstart und lokale Healthchecks |
| U2 – Browser-Updates | Kein Cache für HTML/Update-Dateien, versionierter Worker, sichtbare Aktualisierung, öffentlicher Versionsvergleich implementiert | Proxy-Cache einmal korrigieren und Bestätigungslink ohne Strg+F5 testen |
| U3 – Dashboard | Drei Hinweise als Vorschau; vollständige Liste aufklappbar und in der Höhe begrenzt | Desktop-/Handy-Ansicht bestätigen |
| U4 – Passkeys | Einrichtung, Anmeldung, Entfernen, Signatur-/Origin-/Replay-Prüfung und Admin-MFA-Verknüpfung implementiert | Eigenen Passkey auf HTTPS einrichten, ausloggen und wieder anmelden |
| U5 – Dokumentation | README gekürzt, Unterseitenindex und automatische Linkprüfung; obsolete Auth-Anleitung entfernt | Aktuelle CI und reale Betreiberabnahmen im Release festhalten |

U1–U5 wurden mit PR #155 integriert; Main-CI und CodeQL erfolgreich. Der Betreiber
hat das Update ausgeführt. Lokale und öffentliche Release-Prüfung waren anschließend
für Version `56d3241fb190ac592630` erfolgreich; beide Update-Dateien lieferten
`no-store` und Cloudflare `BYPASS`. Das ersetzt nicht die persönliche Funktionsabnahme.
Ein Bestätigungslink wurde laut Betreiber zugestellt; das Öffnen und der anschließende
Login sind wegen des gemeldeten Seiten-/Cachefehlers noch nicht abgenommen.
Die native App ist ausdrücklich pausiert. Die dort begonnenen SDK-Änderungen bleiben
außerhalb dieses Website-Pakets.

Lokale Nachweise für U1–U5 am 8. September 2026:

- Backend: 434 Tests bestanden, 19 übersprungen, 277 Live-Tests abgewählt.
- Frontend: 24 Unit-Tests und Produktionsbuild erfolgreich.
- Browser: 64 Desktop-/Mobile-Tests bestanden; acht zugangspflichtige Live-Tests ausgelassen.
- Passkey-Prüfungen enthalten echte kryptografische Signaturen und einen virtuellen
  Browser-Authenticator; sie ersetzen nicht den Test mit deinem eigenen Gerät.
- Python-Abhängigkeitsaudit ohne bekannte Schwachstellen, Secret-Scan erfolgreich;
  30 Markdown-Dateien ohne fehlende lokale Linkziele.
- Linux-/Container-CI und CodeQL für PR #155 und Main erfolgreich; der finale
  Browserlauf enthält 68 bestandene Tests einschließlich der MFA-Speicherhärtung.

Dieser Plan bestimmt die Reihenfolge. Ältere Roadmaps bleiben als Historie erhalten;
ihre Checkboxen sind weder ein aktueller Release-Nachweis noch automatisch neue Aufträge.
**Quellcode umgesetzt, automatisch getestet und auf dem echten Server abgenommen sind
drei unterschiedliche Zustände.** Ein fertiger Quellstand ist noch kein Go-live.

## Reihenfolge und Abschlusskriterien

| Paket | Stand | Was ich umsetze | Wann abgeschlossen |
| --- | --- | --- | --- |
| R0 – Restplan | konsolidiert | Dieser Plan, eindeutige Verweise, historische Pläne kennzeichnen | Ein gemeinsamer Arbeitsstand ohne konkurrierende To-do-Listen |
| R1 – Sicherheitsupdates | abgeschlossen mit PR #152; Main-CI/CodeQL grün, beide Meldungen geschlossen | Tiptap-/CSS-Sicherheitsfix und Regressionstests | Erreicht; bei jedem Release neu prüfen |
| R1a – Routine-Wartung | abgeschlossen mit PR #153 | Vier Update-PRs zusammengeführt, Editor-Pins angeglichen, Java-Setup und Paketkompatibilität geprüft | Gemeinsame CI erfolgreich; ersetzte Update-PRs geschlossen |
| R2 – Staging | vorbereitet, noch nicht eingerichtet | Ressourcen und Proxy prüfen; getrennten Testbetrieb auf vorhandenem Server einrichten | Eigene HTTPS-Subdomain, DB, Volumes, Secrets und Testnutzer; Produktion unverändert gesund |
| R3 – Praxistest | offen | Testdaten/Abläufe vorbereiten, Fehler nachstellen und korrigieren | Du bestätigst die Pflichtfälle aus STAGING_ABNAHME.md; kritische Fehler behoben |
| R4 – Release/Betrieb | offen | Backup/Restore nachweisen, Release festhalten, kontrolliert deployen, Rollback und Monitoring prüfen | Abnahme dokumentiert, Backup extern gesichert, Produktiv-Smoke grün |
| R5 – Competition Engine | ausdrücklich nachgelagert | Getrenntes Umbaupaket nach COMPETITION_ENGINE.md | Parität, Dry Runs, reversible Migration und nachgewiesene Ablösung alter Schreibwege |

R2 startet erst nach R1. R3 verwendet ausschließlich Staging-Testdaten. R4 benötigt
deine fachliche Freigabe und ein vereinbartes Wartungsfenster. R5 verändert bis dahin
keine Bestandswettbewerbe und ist keine Voraussetzung für den Test der heutigen Plattform.

### Nachweise der Sicherheitsbasis PR #152

- Vollständige lokale Nicht-Live-Backend-Suite: 368 bestanden, 19 übersprungen,
  277 Live-Tests abgewählt; darunter 17 neue Backup-Zieltests.
- Frontend: 16 Unit-Tests, Frozen-Lockfile-Installation, Build und Kontrastprüfung bestanden.
- Vollständiger Yarn-Audit am 7. September 2026: 0 bekannte Schwachstellen in allen Stufen.
- Secret-Scan und Syntaxprüfung aller Shell-Skripte bestanden.
- Verbindliche Linux-/Docker-/Browser-/Mobile- und CodeQL-Nachweise:
  [PR #152 mit Checks](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/pull/152).
  Ein laufender/fehlgeschlagener Check ist keine Freigabe; nach dem Merge auch Main prüfen.
- Diese Nachweise ersetzen weder den echten Backup-/Restore-Drill noch deinen Praxistest.

## Bereits im Quellstand erledigt

- Plattform-Review P0–P12: eigene Integrationskonfiguration, Auth/MFA/Rollen,
  Datenschutzfunktionen, Container-/CI-Härtung, Betriebs- und Releasewerkzeuge;
  Details in [IMPROVEMENT_REPORT.md](IMPROVEMENT_REPORT.md).
- PR #151: abgesichertes Struktur-Plan/Apply für leere bzw. Preview-Strukturen,
  Team-Fortschritt und Level-up-Anzeige. Keine Migration laufender Turniere.
- Alte Arbeitsbranches bereinigt; nicht einfach ersetzbare Historie ist unter
  `archive/2026-09-07/*` gesichert. Routine-Updatebranches sind keine Altlasten.

Das ist kein Nachweis, dass diese Version bereits auf dem Produktivserver läuft,
alle Integrationen eingerichtet sind oder die Benutzerabnahme erfolgt ist.

## R1 – konkret begrenzte Sicherheitsarbeit

- Tiptap: alle direkt verwendeten Pakete gemeinsam auf 3.30.4; optionale Menüpakete
  ebenfalls auf diese Version begrenzen, damit keine inkompatiblen Peers einziehen.
- `postcss-selector-parser`: transitiven 6.x-Eintrag auf 6.1.4 aktualisieren.
- Regression: JSON-Prototype-Attribute dürfen nicht zu geerbten DOM-Attributen werden;
  normales Editieren und Serialisieren muss weiterhin funktionieren.
- Frozen-Lockfile-Installation, Unit-Tests, Produktionsbuild, Kontrastprüfung,
  Dependency-Audit, Desktop-/Mobile-Browser-Smoke sowie CI/CodeQL prüfen.
- Erst nach erfolgreicher Integration die durch diesen Stand ersetzten
  Sicherheits-PRs #144/#148 schließen, sofern GitHub das nicht selbst erledigt.

Die Sicherheits-PRs #144/#148 wurden nach Integration als ersetzt geschlossen und
ihre Branches entfernt. Sie sind keine offene Arbeit mehr.

### Anschließendes Wartungspaket R1a

Die zuvor offenen Routine-PRs #141 (Actions), #143 (Mobile), #149 (Python) und #150
(Frontend-Gruppe) sind in einem gemeinsamen Arbeitsstand zusammengeführt:

- `actions/setup-java` v6; Temurin 21 wird nun auch in der normalen Mobile-CI geprüft,
  ohne einen APK-Release oder eine Veröffentlichung auszulösen.
- Mobile-Navigation/Axios gemäß #143, ohne Expo-/React-Native-SDK-Wechsel.
- Neun Python-Updates gemäß #149, unter anderem Google Auth, Pydantic, PyMongo,
  HEIF/RAW-Verarbeitung, Resend und Uvicorn.
- Frontend-Gruppe gemäß #150; Tiptap einschließlich beider optionaler Menüpakete
  konsistent auf 3.31.3. Ein zusätzlicher Test verhindert unterschiedlich gesetzte
  Editor-/Menü-Versionen. CSS-Sicherheitsfix und Prototype-Regression bleiben erhalten.
- Rein lesender Servercheck mit eigenen Regressionstests für den nächsten Betreiberschritt.

Backend-/Frontend-/Mobile-/Container-CI und CodeQL waren für PR #153 erfolgreich;
die vier ersetzten Update-PRs wurden nach Integration geschlossen. Damit ist R1a erledigt.
Diese Paketprüfung ist kein neuer APK-Build oder Gerätetest.
Die Expo-SDK-Migration (#117) und der größere Competition-Umbau bleiben ausdrücklich
eigene, nachgelagerte Pakete. Neue Dependency-Meldungen vor jedem Release erneut prüfen.

## R2 – nur ein Server vorhanden

Der Betreiber hat bestätigt: Es gibt nur den Produktivserver. Daher zuerst
read-only prüfen: vorhandener Zugangsweg, tatsächlicher Installationspfad, freie RAM-/CPU-/Disk-
Kapazität, Docker/Compose, belegte Ports, Proxy/DNS/TLS und bestehende Backupziele.
Keine Serverzugänge oder Secrets in Git oder Testberichte schreiben. **Öffentliches SSH
ist nicht erforderlich und soll dafür nicht freigeschaltet werden.** Eine vorhandene
Hosting-/Serverkonsole oder ein privater Zugang reicht. Wenn ich keinen direkten Zugriff
habe, bereite ich die geprüften Befehle vor und der Betreiber führt sie dort aus.
Staging dient der Update-Abnahme und schaltet keine zusätzliche Website-Funktion frei.

Die erste Bestandsaufnahme wurde vom Betreiber bereits durchgeführt: LXC, acht CPUs,
8 GiB RAM, rund 27,8 GiB freier Speicher, Produktionscontainer gesund; noch kein
Staging-Stack. Die hohe Load allein belegt in dieser Umgebung keine lokale Überlast.
Eine aktuelle Prüfung vor einem Staging-Start bleibt erforderlich. Dafür in der
vorhandenen Serverkonsole ausführen:

```bash
bash scripts/staging-preflight.sh
```

Die Ausgabe an mich zurückgeben. Der Check benötigt weder öffentliches SSH noch neue
Ports, liest keine `.env`, installiert nichts und verändert keine Container/Daten.
Er zeigt verfügbare Ressourcen, Belegung der vorgesehenen Testports, Docker/Compose-
Verfügbarkeit und den Status der bekannten Plattformcontainer. Unbekannte Werte sind
keine Freigabe. Ein abweichender/entfernter Docker-Kontext wird nicht als lokaler Host
geprüft. Der Bericht enthält bewusst keine automatische Startentscheidung.

Falls der Befehl auf dem Server noch nicht vorhanden ist: keine laufende Installation
blind aktualisieren oder neu starten. Ich stelle dann nur die beiden Preflight-Dateien
für den vorhandenen Konsolenzugang bereit. Ein Windows-Aufruf prüft nicht den Server.

Bei ausreichender Reserve kann derselbe Host einen zweiten Stack betreiben:

- separates Checkout, zum Beispiel `/opt/the-lion-squad-staging`;
- Compose-Projekt `tls-staging`, eigene Container, Netzwerk, DB und Volumes;
- Loopback-Ports 13000/18001 und eigene, noch festzulegende HTTPS-Subdomain;
- `.env.staging` mit eigenen Secrets; hostgebundene Cookies, keine Domain-Cookies;
- nur synthetische Testdaten, Testpostfächer und eigene Test-Integrationen;
- Scheduler/Benachrichtigungen erst gezielt freischalten; keine Nachrichten an Mitglieder;
- RAM-/CPU-Limits auch für Staging-MongoDB vor Start festlegen; Image-Builds können
  zusätzlich Ressourcen verbrauchen. Gemeinsamer Host bleibt eine gemeinsame Ausfallzone.

Vor einem parallelen Start muss die aufgelöste Compose-Konfiguration nachweislich
getrennt sein. Die Backup-/Restore-Zielauswahl ist in diesem Paket auf das konkrete
Compose-Projekt begrenzt und mit Regressionstests abgesichert; der echte Restore-Drill
steht noch aus. Bei zu wenig Reserve wird nicht auf der laufenden
Produktion getestet: Dann braucht es einen separaten Host oder eine lokale Docker-Umgebung.

Technischer Ablauf: [RELEASE.md](RELEASE.md). Nachweise und Testercheckliste:
[STAGING_ABNAHME.md](STAGING_ABNAHME.md).

## R3/R4 – was du tun musst

Du musst nicht programmieren. Von dir brauche ich:

1. Vorhandenen Zugangsweg (zum Beispiel Hosting-Konsole), Installationspfad und gewünschte
   Staging-Subdomain nennen. Kein öffentliches SSH einrichten, keine Passwörter im Chat.
   Ohne direkten Agent-Zugriff nur die von mir vorbereiteten Befehle in deiner Konsole ausführen.
2. Eigene Betreiberkonten für Google/Mail und bei Nutzung Discord/Twitch. Geheime
   Werte nur direkt in die geschützte Konfiguration eingeben. Ich begleite die Einrichtung
   nach [CONFIGURATION.md](CONFIGURATION.md).
3. Echte Vereins-/Kontaktdaten und fachliche Prüfung/Freigabe der Rechtstexte.
4. Die beschriebenen Klicktests durchführen und Fehler mit Schritten/Screenshot melden.
5. Nach erfolgreichem Test Go-live und Wartungsfenster freigeben.

Ich übernehme Code, technische Konfiguration im freigegebenen Ziel, Tests,
Fehlerkorrekturen, Dokumentation sowie den vorbereiteten Deploymentablauf.
Externe Kontoanlage, rechtliche Freigabe und dein Nutzungstest lassen sich nicht
durch einen automatisierten Build ersetzen.

## R5 – späteres, klar abgegrenztes Turnierpaket

Die Reihenfolge bleibt: fehlende Consumer-/Write-Parität → versionierter Schreibkern
mit Dispute/Forfeit/Korrektur → Standardformate einzeln → neue Turniere per Flag →
Bestands-Dry-Run mit IDs/Counts/Hash/Diff und Backup-/Restore-Nachweis → Test/Draft,
Archive und aktive Turniere zuletzt → alte Writes read-only, Nullnutzung messen,
erst danach entfernen. Fachliche Details und Abnahmematrix stehen ausschließlich
in [COMPETITION_ENGINE.md](COMPETITION_ENGINE.md).

R5 wird seit dem 8. September 2026 in nummerierten Blöcken abgearbeitet. Der laufende
Arbeitsstand — welcher Block umgesetzt ist, welcher offen — steht in
[UMBAUPLAN.md](UMBAUPLAN.md). Dort sind auch die später hinzugekommenen Themen
aufgenommen: Spielwochen, PDF-Ausgabe, Live-Aktualisierung, Galerie und App.

Mobile-Gerätetests, SDK-Umstieg und weitere UX-/Feature-Wünsche bleiben sichtbar im
Backlog, werden aber nicht still in dieses Stabilisierungspaket hineingemischt.

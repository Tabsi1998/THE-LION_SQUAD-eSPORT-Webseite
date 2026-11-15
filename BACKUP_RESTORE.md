# Verschlüsseltes Backup und Restore

## Zielauswahl: Produktion und Staging niemals mischen

Die Skripte bestimmen Datenbank und Upload-Volume aus der aufgelösten Konfiguration
des **ausgewählten Compose-Projekts**. Es gibt keine globale Suche nach ähnlich benannten
Volumes und keinen geratenen Produktionsnamen mehr. Explizite `DB_NAME`-/`UPLOADS_VOLUME`-
Werte müssen zur Konfiguration passen, sonst wird vor dem Backup/Restore abgebrochen.
Benötigt werden Python 3 und Docker Compose mit `config --format json`.
Die Umgebungswahl folgt den [offiziellen Compose-Variablen](https://docs.docker.com/compose/how-tos/environment-variables/envvars/).

Für Staging im separaten Staging-Checkout eine eigene Shell verwenden:

```bash
export COMPOSE_PROJECT_NAME=tls-staging
export COMPOSE_FILE=docker-compose.yml:docker-compose.staging.yml
export COMPOSE_ENV_FILES=.env.staging
export COMPOSE_DISABLE_ENV_FILE=true
export DB_NAME=tls_arena_staging
export BACKUP_DIR=/opt/tls-arena-staging/backups
export BACKUP_ENCRYPTION_PASSWORD_FILE=/etc/tls-arena-staging/backup-password
bash scripts/backup.sh
```

Die Staging-Passwortdatei vorher separat und geschützt anlegen. `COMPOSE_ENV_FILES`
erfordert eine Compose-Version, die diese Einstellung unterstützt; vor Verwendung
mit `docker compose config --format json | python3 scripts/compose-backup-target.py
--db tls_arena_staging --volume tls-staging_uploads_data` prüfen (als eine Zeile).
Keine aus Produktion geerbten Shell-Secrets übernehmen. Für Restore-Drills dieselbe
Staging-Shell und Staging-Archive verwenden. Nie Produktions-Timer mit diesen Werten
überschreiben; Backupverzeichnisse und Offsite-Ziele pro Umgebung getrennt halten.

Die folgenden Beispiele gelten für Produktion im Produktions-Checkout. Nicht in der
Staging-Shell ausführen. Ein Restore ersetzt Daten und braucht weiterhin die explizite Bestätigung.

## Einmalige Vorbereitung

```bash
sudo install -d -m 700 /etc/tls-arena
sudo sh -c 'umask 077; openssl rand -base64 48 > /etc/tls-arena/backup-password'
sudo install -d -m 700 /opt/tls-arena/backups
```

Die Passwortdatei und `SETTINGS_ENCRYPTION_KEY` separat in einem vertrauenswürdigen Passwort-
oder Secret-Store sichern. Ohne diese Werte sind Backups beziehungsweise gespeicherte
Integrationszugänge nicht wiederherstellbar.

## Backup

```bash
BACKUP_DIR=/opt/tls-arena/backups bash scripts/backup.sh
```

Das Skript authentifiziert sich an MongoDB und erzeugt AES-256-CBC/PBKDF2-verschlüsselte Archive
für Datenbank und Uploads sowie ein Manifest mit Prüfsummen. Unverschlüsselte Zwischenarchive
werden nicht angelegt. `RETENTION_DAYS` ist standardmäßig 14.

### Datenbank und Uploads als Paar: kurze Schreibpause (#1009)

`mongodump` auf einem einzelnen MongoDB-Server ohne Replikat liefert keinen gemeinsamen Zeitpunkt mit dem
Upload-Ordner (ein `--oplog` gibt es dort nicht). Damit Dump und Upload-Archiv trotzdem zusammenpassen, schaltet
das Skript für die Dauer der Sicherung eine **Schreibpause** im Backend ein:

1. `python -m services.maintenance on` im Backend-Container: ein Dokument mit Lease (`ops_maintenance`). Danach
   wartet das Skript einige Sekunden, bis alle Prozesse die Pause sehen, und bis laufende Schreibvorgänge
   (Hintergrundjobs, Turnier-Änderungen mit Sperre) fertig sind.
2. **Lesen geht weiter.** Schreibende Anfragen bekommen `503` mit `Retry-After` und dem Text
   „Kurze Wartung: Wir sichern gerade die Daten. Lesen geht weiter, Speichern ist gleich wieder möglich.“
   Anmelden, Abmelden und Sitzung verlängern bleiben erlaubt. Die Website zeigt unter dem Kopf eine Leiste
   „gleich wieder da“, die nach `Retry-After` von selbst verschwindet; die App zeigt den Text der Antwort als
   Fehlermeldung. Die Antwort trägt die CORS-Kopfzeilen, damit auch der Upload-Host sie lesen kann, und zählt in
   der Betriebssicht nicht als Serverfehler. Eine Registrierung mit Google bekommt dieselbe Antwort, das Anmelden
   mit Google bleibt frei.
   Hintergrundjobs im Takt (Intervall) lassen ihn aus, der nächste holt nach. Jobs zu festen Uhrzeiten (etwa der
   Rangstand um 03:35) warten, bis die Pause vorbei ist, und laufen dann - sie fallen nicht bis zum nächsten Tag aus.
3. Zählen (Sammlungen, Summen, Uploads), `mongodump`, Upload-Archiv, noch einmal zählen. Solange das läuft,
   verlängert ein Hintergrundprozess die Lease alle TTL/3 Sekunden - auch ein langes Upload-Archiv lässt die Pause
   nicht mittendrin enden.
4. Pause beenden. Sie endet **immer**: am Ende, bei jedem Fehler oder Abbruch (trap) und spätestens nach Ablauf
   der Lease von selbst - auch wenn das Skript hart abgebrochen wird. Die Website kann also nie dauerhaft gesperrt
   bleiben. Fällt die Datenbank aus, gilt die Pause als aus. Beim Beenden meldet das Backend, ob die Lease bis
   zuletzt gehalten hat. Scheitert eine Verlängerung oder hielt die Lease nicht, bleiben die Dateien, das Manifest
   vermerkt `consistent: false`, `restore-check.sh` warnt, und `backup.sh` endet mit Rückgabewert 2 (der Timer zeigt
   den Fehler im Journal).

Üblich sind 10 bis 60 Sekunden. Steht das Backend (etwa beim Sicherheitsbackup im Restore), braucht es keine
Pause; das Manifest vermerkt `writers_stopped`.

**Was in der Pause trotzdem schreibt** - bewusst, und warum das Paar trotzdem stimmig bleibt:

- **Anmelden, Abmelden, Sitzung verlängern** (auch per App und Passkey) legen Sitzungen, Refresh-Tokens,
  Anmeldeversuche und Zähler gegen Missbrauch an.
- **Nebenwirkungen von Leseanfragen:** etwa Zähler und Bildfassungen (Vorschaubilder), die beim
  ersten Abruf eines Bildes entstehen.
- **Der Discord-Bot** schreibt Ereignisse aus dem Gateway (etwa Mitglieder-Zähler) und die Prozess-Überwachung des
  Bots gegebenenfalls einen Alarm.

Nichts davon legt Uploads an oder verweist neu auf Dateien: Anmeldungen, Rechnungen, Bestellungen, Medien und alle
Texte mit Bildern ändern sich nur über schreibende API-Anfragen, und die stehen still. Vorschaubilder sind aus dem
Original ableitbar und entstehen nach einem Restore von selbst neu. Ändert sich trotzdem eine Sammlung zwischen den
beiden Zählungen, steht sie in `unstable_collections`, und der Restore vergleicht sie nur als Hinweis.

| Variable | Standard | Bedeutung |
|---|---|---|
| `BACKUP_WRITE_PAUSE` | `true` | `false`: ohne Pause sichern (nicht empfohlen, das Paar kann dann abweichen) |
| `BACKUP_WRITE_PAUSE_TTL` | `120` | Lease in Sekunden (5 bis 1800); wird im Hintergrund alle TTL/3 Sekunden verlängert |
| `BACKUP_WRITE_PAUSE_SETTLE_SECONDS` | `3` | Wartezeit, bis alle Backend-Prozesse die Pause sehen |
| `BACKUP_WRITE_PAUSE_DRAIN_SECONDS` | `60` | so lange höchstens auf laufende Schreibvorgänge warten; sonst Warnung und Vermerk im Manifest |
| `BACKUP_REFERENCE_SCAN` | `true` | Datei-Verweise in der Pause mitzählen (für den fachlichen Vergleich beim Restore); `false` verkürzt die Pause |

Im Backend (Umgebung des Containers): `MAINTENANCE_RETRY_AFTER_SECONDS` (Standard 30, höchstens so lange wie die
restliche Lease), `MAINTENANCE_CACHE_SECONDS` (Standard 1) und `MAINTENANCE_EXEMPT_PATHS` (weitere Pfade, die auch in
der Pause schreiben dürfen, mit Komma).

Von Hand, etwa zum Prüfen oder wenn eine Pause nach einem abgebrochenen Lauf sofort enden soll:

```bash
docker compose exec -T backend python -m services.maintenance status
docker compose exec -T backend python -m services.maintenance off --force
```

`off --force` ist auch ohne Pause-Dokument erfolgreich (frische oder alte Datenbank). Der Restore ruft es nach dem
Einspielen der Datenbank auf; `ops_maintenance` gilt im Manifest-Vertrag als Betriebsdaten - fehlt es im Backup oder
im Ziel, hält das den Restore nicht auf.

Eine Route dafür gibt es absichtlich nicht.

### Manifest (#1010)

Zu jedem Paar entsteht `tls_backup_<zeit>.manifest.json` (früher `.manifest.txt`). Es enthält:

- `pair_id` (gemeinsame Paar-ID), `project` (Compose-Projekt), `db_name`, `timestamp`, `created_at`,
- `app_version` (Website-Version aus `.release-please-manifest.json`), `git_commit`, `mongo_version`,
  `schema_version` (höchste erledigte Migration der Datenbank) und `code_schema_version`,
- `files`: Name, Größe und SHA-256 von Dump und Upload-Archiv,
- `collections` mit Anzahl, `figures` (Anmeldungen zu Turnieren und Events, Rechnungen und Shop-Bestellungen je
  Stand mit Betrag, Mitgliedschaften), `uploads` (Anzahl, Bytes, Fingerabdruck aus dem Archiv), `references`
  (wie viele Dateien die Datenbank nennt und wie viele fehlen),
- `unstable_collections`/`unstable_figures`: was sich zwischen den beiden Zählungen in der Pause geändert hat
  (sollte leer sein), `ttl_collections` (Sammlungen, aus denen MongoDB Abgelaufenes selbst löscht),
- `write_pause`: Art, Dauer, ob laufende Schreibvorgänge fertig wurden und ob die Lease gehalten hat;
  `consistent`: `true` nur mit Pause (oder stehendem Backend), fertig gewordenen Schreibvorgängen und gehaltener Lease.

Ein Lauf, der abbricht, entfernt seine halb geschriebenen Dateien - ein halbes Paar ist kein Backup.

Für eine Offsite-Kopie zuerst ein rclone-Remote konfigurieren und danach zum Beispiel:

```bash
BACKUP_REMOTE=secure-remote:tls-production bash scripts/backup.sh
```

Ein Backup auf demselben Server ist kein ausreichender Schutz. Deshalb bricht das Skript
bei `APP_ENV=production` ohne `BACKUP_REMOTE` ab, bevor es überhaupt ein Archiv schreibt.
Wer bewusst nur lokal sichern will, muss das ausdrücklich erklären:

```bash
BACKUP_REMOTE_OPTIONAL=true bash scripts/backup.sh
```

Der Grund für diesen Abbruch steht in der Ausgabe; ausserhalb von `production` bleibt es
bei einer Warnung.

## Zeitplan mit systemd

Repository-Pfad in den Dateien unter `deploy/systemd/` anpassen und installieren:

```bash
sudo cp deploy/systemd/tls-backup.* /etc/systemd/system/
sudo cp deploy/systemd/tls-restore-drill.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tls-backup.timer tls-restore-drill.timer
systemctl list-timers 'tls-*'
```

Fehler prüfen:

```bash
journalctl -u tls-backup.service -u tls-restore-drill.service --since '7 days ago'
```

## Integrität und nicht-destruktiver Restore-Drill

```bash
bash scripts/restore-check.sh /opt/tls-arena/backups/tls_backup_YYYYMMDD_HHMMSS.manifest.json

bash scripts/restore-drill.sh \
  /opt/tls-arena/backups/tls_tls_arena_YYYYMMDD_HHMMSS.archive.gz.enc
```

`restore-check.sh` prüft gegen das Manifest (#1010), ohne etwas zu ändern: Manifest vollständig und in
bekannter Fassung, beide Dateinamen und SHA-256-Prüfsummen, Projekt und Datenbank wie im Ziel, beide Archive
entschlüsselbar, Inhalt des Upload-Archivs wie im Manifest. Es nimmt auch beide Archive (und optional das
Manifest) als Argumente; ohne Manifest-Argument sucht es `tls_backup_<zeit>.manifest.json` neben dem
Datenbank-Archiv. Abgewiesen werden: veränderte oder fehlende Dateien, zwei für sich gültige, aber
verschieden alte Archive (die Meldung nennt das Paar, zu dem die fremde Datei gehört), ein fremdes Projekt
oder eine fremde Datenbank.

Der Drill restauriert in eine temporäre Datenbank, prüft Collections und entfernt die
Drill-Datenbank wieder. Er verändert die Produktivdaten nicht.

### Nachweis, dass ein Restore wirklich geprüft wurde

Jeder Drill schreibt eine Zeile nach `${BACKUP_DIR}/restore-drills.log` — mit Zeitstempel,
Ergebnis, Archivname und Collection-/Nutzerzahl. Ein erfolgreicher Drill und ein nie
durchgeführter Drill sehen sonst gleich aus. Wie alt der letzte erfolgreiche Nachweis ist,
beantwortet:

```bash
bash scripts/restore-drill-status.sh
```

Rückgabewert `0` bedeutet: erfolgreicher Drill innerhalb der erlaubten Frist
(`RESTORE_DRILL_MAX_AGE_DAYS`, Standard 35 Tage). `1` bedeutet zu alt, fehlgeschlagen oder
nie durchgeführt, `2` bedeutet: das Protokoll ist nicht lesbar. Der Check ist rein lesend
und eignet sich damit auch für einen Monitoring-Job.

## Destruktiver Restore

Nur bei bestätigtem Datenverlust und in einem Wartungsfenster. Angegeben wird das Manifest des Paares
(die beiden Archive liegen daneben) - oder wie bisher beide Archive:

```bash
export DB_NAME=tls_arena
export RESTORE_CONFIRM=tls_arena
bash scripts/restore.sh /opt/tls-arena/backups/tls_backup_YYYYMMDD_HHMMSS.manifest.json
unset RESTORE_CONFIRM
```

Das Skript arbeitet in dieser Reihenfolge (#1008, #1010):

1. **Paar prüfen** (`restore-check.sh`, derselbe Manifest-Vertrag) – noch ohne Änderung.
2. **Versionen prüfen:** Ein Backup mit einer Migration, die der Code am Ziel nicht kennt (Backup neuer als
   Code), oder von einer neueren MongoDB-Hauptversion wird abgewiesen. Das Skript nennt Commit und Version des
   Backups. Ein älteres Backup ist in Ordnung - der Start holt die Migrationen nach.
3. **Zielbestand prüfen:** Sammlungen im Ziel, die nicht im Backup stehen, lässt `mongorestore --drop` stehen.
   Das Skript listet sie und bricht ab, bis entschieden ist: `RESTORE_EXTRA_COLLECTIONS=drop` (nach dem Restore
   entfernen; sie stecken im Sicherheitsbackup) oder `RESTORE_EXTRA_COLLECTIONS=keep` (stehen lassen, mit
   Hinweis). Nichts wird still gelöscht. Im Upload-Volume ersetzt der Restore ohnehin alles.
4. **Schreiber anhalten:** `docker compose stop backend` (API samt Scheduler, alle Container des
   Dienstes) und den Stopp mit `docker inspect` prüfen. Läuft noch etwas oder ist der Zustand unklar,
   bricht das Skript ab, bevor es etwas ändert. Weitere Schreiber – etwa ein zweiter Stack auf
   derselben Datenbank – kennt es nicht; die hält man vorher selbst an (`RESTORE_WRITER_SERVICES`
   nennt die Dienste, Standard `backend`).
5. **Sicherheitsbackup** des aktuellen Stands – jetzt stimmen Datenbank und Uploads zusammen, weil
   niemand mehr schreibt.
6. **MongoDB mit `--drop`** restaurieren, gegebenenfalls die zusätzlichen Sammlungen entfernen, die mit dem
   Dump zurückgekommene Schreibpause beenden, dann das **Upload-Volume** ersetzen.
7. **Prüfen, bevor jemand schreibt:** Sammlungen und Konten in der Datenbank, Dateien im Upload-Volume.
   Ein leeres Volume gilt nur mit `RESTORE_ALLOW_EMPTY_UPLOADS=true` als richtig. Danach der **fachliche
   Abgleich** gegen das Manifest: jede Sammlung mit Anzahl, die Summen (Anmeldungen, Rechnungen,
   Bestellungen, Mitgliedschaften), der Fingerabdruck der Uploads und die Datei-Verweise (nicht mehr fehlende
   Dateien als beim Backup). Sammlungen mit TTL-Index dürfen weniger Einträge haben (MongoDB löscht Abgelaufenes
   selbst), Sammlungen, die sich in der Pause geändert hatten, gelten als Hinweis.
8. **Freigabe:** Backend und Web starten und bis zu `RESTORE_READY_TIMEOUT_SECONDS` (Standard 180)
   warten, bis das Backend wieder „healthy“ meldet.

Scheitert ein Schritt nach dem Stopp, **bleibt das System gesperrt** (Backend aus) und das Skript
nennt den Weg: Ursache beheben und erneut starten – oder zurück zum Stand davor mit dem
Sicherheitsbackup aus Schritt 5 (`scripts/restore.sh <Manifest des Sicherheitsbackups>`).
Erst wenn Datenbank und Uploads nachweislich stimmen: `docker compose start backend frontend`.

Danach Readiness, Adminlogin, Uploads, ein historisches Turnier, Mailqueue und Auditlog prüfen.

**Abnahme auf einem Testsystem** (nie produktiv): während des Restores einen Schreibversuch gegen die
API schicken (muss scheitern, Backend steht), einen zweiten Backend-Container im Projekt starten
(der Stopp trifft alle), und je einen Abbruch nach Schritt 4 und vor dem Upload-Teil erzwingen – das
System muss gesperrt bleiben und den Rückweg ausgeben.

`SKIP_PRE_RESTORE_BACKUP=true` nur verwenden, wenn der aktuelle Zustand nachweislich unbrauchbar
ist und nicht mehr forensisch gesichert werden soll.

Schalter für Ausnahmen - jeder nur bewusst und mit Grund:

| Variable | Wirkung |
|---|---|
| `RESTORE_EXTRA_COLLECTIONS=drop\|keep` | zusätzliche Sammlungen im Ziel entfernen bzw. stehen lassen (siehe Schritt 3) |
| `RESTORE_ALLOW_FOREIGN_PROJECT=<projekt>` | Backup eines anderen Compose-Projekts annehmen, etwa Produktion in ein frisches Testziel; der Wert muss das Projekt aus dem Manifest nennen |
| `RESTORE_ALLOW_VERSION_MISMATCH=true` | Versionsprüfung übergehen (Backup neuer als Code oder MongoDB) |
| `RESTORE_ALLOW_LEGACY_MANIFEST=true` | Backup mit altem `.manifest.txt` (vor #1010): geprüft werden nur Dateinamen, Datenbank und Prüfsummen; Versionen, Zielbestand und fachlicher Abgleich fallen weg. Beide Archive als Argumente angeben |

**Frisches Ziel statt Überschreiben:** Wer nicht ins laufende System restaurieren will, startet einen zweiten
Stack mit eigenem Projektnamen und leeren Volumes (wie unter „Zielauswahl“ beschrieben), restauriert dorthin
(`RESTORE_ALLOW_FOREIGN_PROJECT=<quelle>`), prüft und schaltet erst danach um.

### Was am Server zu tun ist (#1009/#1010)

- **Timer und Cron bleiben unverändert** (`tls-backup.timer`, 03:15 mit bis zu 20 Minuten Versatz). Die
  Schreibpause steuert `scripts/backup.sh` selbst.
- **Reihenfolge beim Einspielen:** erst das Release mit dem neuen Backend deployen (es kennt
  `services.maintenance` und `services.backup_inventory`), dann läuft das nächste nächtliche Backup schon mit Pause
  und Manifest. Mit einem alten Backend-Image bricht `backup.sh` ab, bevor es ein Archiv schreibt.
- Am Host werden wie bisher `docker compose`, `openssl`, `gzip`, `tar` und `python3` gebraucht.
- Uptime-Prüfungen per GET (`/api/health/*`) merken von der Pause nichts. Webhooks, die in der Pause ankommen,
  bekommen 503 und werden von den Absendern üblicherweise wiederholt.
- Alte Backups mit `.manifest.txt` laufen mit der Aufbewahrung (`RETENTION_DAYS`) aus; bis dahin nur mit
  `RESTORE_ALLOW_LEGACY_MANIFEST=true` wiederherstellbar.

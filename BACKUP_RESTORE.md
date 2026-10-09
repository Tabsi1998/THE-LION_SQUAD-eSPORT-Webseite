# Verschlüsseltes Backup und Restore

## Zielauswahl

Die Skripte bestimmen Datenbank und Upload-Volume aus der aufgelösten Konfiguration
des **ausgewählten Compose-Projekts**. Es gibt keine globale Suche nach ähnlich benannten
Volumes und keinen geratenen Produktionsnamen mehr. Explizite `DB_NAME`-/`UPLOADS_VOLUME`-
Werte müssen zur Konfiguration passen, sonst wird vor dem Backup/Restore abgebrochen.
Benötigt werden Python 3 und Docker Compose mit `config --format json`.
Die Umgebungswahl folgt den [offiziellen Compose-Variablen](https://docs.docker.com/compose/how-tos/environment-variables/envvars/).

Die Beispiele gelten für den Produktions-Checkout. Ein Restore ersetzt Daten und braucht die
explizite Bestätigung.

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
bash scripts/restore-check.sh \
  /opt/tls-arena/backups/tls_tls_arena_YYYYMMDD_HHMMSS.archive.gz.enc \
  /opt/tls-arena/backups/tls_uploads_YYYYMMDD_HHMMSS.tar.gz.enc

bash scripts/restore-drill.sh \
  /opt/tls-arena/backups/tls_tls_arena_YYYYMMDD_HHMMSS.archive.gz.enc
```

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

Nur bei bestätigtem Datenverlust und in einem Wartungsfenster. Beide Dateien müssen aus demselben
Backup-Satz stammen:

```bash
export DB_NAME=tls_arena
export RESTORE_CONFIRM=tls_arena
bash scripts/restore.sh \
  /opt/tls-arena/backups/tls_tls_arena_YYYYMMDD_HHMMSS.archive.gz.enc \
  /opt/tls-arena/backups/tls_uploads_YYYYMMDD_HHMMSS.tar.gz.enc
unset RESTORE_CONFIRM
```

Das Skript arbeitet in dieser Reihenfolge (#1008):

1. **Archive prüfen** (`restore-check.sh`) – noch ohne Änderung.
2. **Schreiber anhalten:** `docker compose stop backend` (API samt Scheduler, alle Container des
   Dienstes) und den Stopp mit `docker inspect` prüfen. Läuft noch etwas oder ist der Zustand unklar,
   bricht das Skript ab, bevor es etwas ändert. Weitere Schreiber – etwa ein zweiter Stack auf
   derselben Datenbank – kennt es nicht; die hält man vorher selbst an (`RESTORE_WRITER_SERVICES`
   nennt die Dienste, Standard `backend`).
3. **Sicherheitsbackup** des aktuellen Stands – jetzt stimmen Datenbank und Uploads zusammen, weil
   niemand mehr schreibt.
4. **MongoDB mit `--drop`** restaurieren, dann das **Upload-Volume** ersetzen.
5. **Prüfen, bevor jemand schreibt:** Sammlungen und Konten in der Datenbank, Dateien im Upload-Volume.
   Ein leeres Volume gilt nur mit `RESTORE_ALLOW_EMPTY_UPLOADS=true` als richtig.
6. **Freigabe:** Backend und Web starten und bis zu `RESTORE_READY_TIMEOUT_SECONDS` (Standard 180)
   warten, bis das Backend wieder „healthy“ meldet.

Scheitert ein Schritt nach dem Stopp, **bleibt das System gesperrt** (Backend aus) und das Skript
nennt den Weg: Ursache beheben und erneut starten – oder zurück zum Stand davor mit dem
Sicherheitsbackup aus Schritt 3 (`scripts/restore.sh <Sicherheits-Archiv> <Sicherheits-Uploads>`).
Erst wenn Datenbank und Uploads nachweislich stimmen: `docker compose start backend frontend`.

Danach Readiness, Adminlogin, Uploads, ein historisches Turnier, Mailqueue und Auditlog prüfen.

**Abnahme auf einem Testsystem** (nie produktiv): während des Restores einen Schreibversuch gegen die
API schicken (muss scheitern, Backend steht), einen zweiten Backend-Container im Projekt starten
(der Stopp trifft alle), und je einen Abbruch nach Schritt 4 und vor dem Upload-Teil erzwingen – das
System muss gesperrt bleiben und den Rückweg ausgeben.

`SKIP_PRE_RESTORE_BACKUP=true` nur verwenden, wenn der aktuelle Zustand nachweislich unbrauchbar
ist und nicht mehr forensisch gesichert werden soll.

# Backup & Restore Guide

## Automated backup

Empfohlene Variante auf dem Server:

```bash
cd /root/THE-LION_SQUAD-eSPORT-Webseite
BACKUP_DIR=/opt/tls-arena/backups bash scripts/backup.sh
```

Das Skript erstellt:

- einen MongoDB-Dump als `tls_<db>_<timestamp>.archive.gz`
- ein Upload-Archiv als `tls_uploads_<timestamp>.tar.gz`
- ein Manifest mit Git-Commit, Dateinamen und optionalen SHA256-Pruefsummen

Standardwerte:

```bash
BACKUP_DIR=/opt/tls-arena/backups
RETENTION_DAYS=14
DB_NAME=aus .env oder tls_arena
UPLOADS_VOLUME=automatisch erkannt oder the-lion_squad-esport-webseite_uploads_data
```

Wenn dein Compose-Projektname vom Repository-Namen abweicht, setze das Upload-Volume explizit:

```bash
UPLOADS_VOLUME=deinprojekt_uploads_data bash scripts/backup.sh
```

Cron-Beispiel:

```cron
15 3 * * * cd /root/THE-LION_SQUAD-eSPORT-Webseite && BACKUP_DIR=/opt/tls-arena/backups bash scripts/backup.sh >> /var/log/tls-backup.log 2>&1
```

Optional vor einem Update:

```bash
PRE_UPDATE_BACKUP=true ./update.sh u
```

Die alte Minimalvariante ohne Projektskript:

```bash
# Daily MongoDB dump (put into /etc/cron.daily/tls-arena-backup)
#!/bin/bash
BACKUP_DIR=/opt/tls-arena/backups
mkdir -p $BACKUP_DIR
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
docker exec tls-mongodb mongodump --db tls_arena --archive --gzip > $BACKUP_DIR/tls_arena_$TIMESTAMP.archive.gz
tar -C /var/lib/docker/volumes -czf $BACKUP_DIR/tls_uploads_$TIMESTAMP.tar.gz the-lion_squad-esport-webseite_uploads_data
# Retention: keep last 14 days
find $BACKUP_DIR -name "tls_arena_*.archive.gz" -mtime +14 -delete
find $BACKUP_DIR -name "tls_uploads_*.tar.gz" -mtime +14 -delete
```

## Manual backup

```bash
docker exec tls-mongodb mongodump --db tls_arena --archive --gzip > tls_arena_backup.archive.gz
docker run --rm -v the-lion_squad-esport-webseite_uploads_data:/uploads -v "$PWD":/backup alpine tar -czf /backup/tls_uploads_backup.tar.gz -C /uploads .
```

## Restore

```bash
# Stop backend to avoid concurrent writes
sudo docker compose stop backend

# Wipe current database (dangerous — make sure your backup is valid)
docker exec tls-mongodb mongosh --eval "use tls_arena; db.dropDatabase()"

# Restore from archive
cat tls_arena_backup.archive.gz | docker exec -i tls-mongodb mongorestore --gzip --archive --db tls_arena

# Restart backend
sudo docker compose start backend
```

## Restore uploads

```bash
# Stop backend while restoring uploaded files
sudo docker compose stop backend

# Restore into the Docker volume
docker run --rm -v the-lion_squad-esport-webseite_uploads_data:/uploads -v "$PWD":/backup alpine sh -c "rm -rf /uploads/* && tar -xzf /backup/tls_uploads_backup.tar.gz -C /uploads"

sudo docker compose start backend
```

## Restore test

At least once after setup and after major releases:

```bash
bash scripts/restore-check.sh tls_arena_backup.archive.gz tls_uploads_backup.tar.gz
```

Also verify in the admin UI:

- `Einstellungen -> Status` shows Uploads as writable.
- Recent images still load.
- Mailqueue and users are present after database restore.

## Export individual collections (CSV)

Use the admin UI:
- F1 leaderboards → `/api/f1/challenges/:id/export.csv`
- More exports will be added over time.

## Off-site backups

Sync `/opt/tls-arena/backups` to S3 / Backblaze / rsync remote with `rclone` or `restic`.

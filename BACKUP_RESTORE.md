# Backup & Restore Guide

## Automated backup

```bash
# Daily MongoDB dump (put into /etc/cron.daily/tls-arena-backup)
#!/bin/bash
BACKUP_DIR=/opt/tls-arena/backups
mkdir -p $BACKUP_DIR
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
docker exec tls-mongodb mongodump --db tls_arena --archive --gzip > $BACKUP_DIR/tls_arena_$TIMESTAMP.archive.gz
# Retention: keep last 14 days
find $BACKUP_DIR -name "tls_arena_*.archive.gz" -mtime +14 -delete
```

## Manual backup

```bash
docker exec tls-mongodb mongodump --db tls_arena --archive --gzip > tls_arena_backup.archive.gz
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

## Export individual collections (CSV)

Use the admin UI:
- F1 leaderboards → `/api/f1/challenges/:id/export.csv`
- More exports will be added over time.

## Off-site backups

Sync `/opt/tls-arena/backups` to S3 / Backblaze / rsync remote with `rclone` or `restic`.

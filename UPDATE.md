# Update Guide

## Update TLS ARENA in place

```bash
cd /opt/tls-arena
sudo docker compose down
git pull
sudo docker compose up -d --build
sudo docker compose logs -f
```

## Preserve uploaded data

The MongoDB volume `mongo_data` is preserved across `down`/`up` cycles. Do not run `docker compose down -v` unless you want to wipe the database.

## Zero-downtime update

1. Build new backend image: `sudo docker compose build backend`
2. Restart: `sudo docker compose up -d --no-deps backend`
3. Repeat for frontend.

## Rollback

```bash
git checkout <previous-commit>
sudo docker compose up -d --build
```

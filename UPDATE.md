# Update-Anleitung

Der normale Server-Ablauf ist:

```bash
cd /root/THE-LION_SQUAD-eSPORT-Webseite
./update.sh u
```

Das Script zieht den neuesten Code, baut Frontend/Backend neu, startet die Container und prueft Backend, Frontend und wichtige SPA-Routen.

## Danach pruefen

```bash
docker compose ps
docker compose logs --tail=100 backend
curl -fsS http://localhost:8001/api/health
```

Oeffentlich pruefen:

- `https://lionsquad.at`
- `https://lionsquad.at/community`
- `https://lionsquad.at/events`
- `https://lionsquad.at/members`

Im Admin:

- `Einstellungen -> Status`
- `Einstellungen -> Discord`
- `Einstellungen -> Twitch`
- ein kleiner Upload-Test

## Daten behalten

MongoDB und Uploads liegen in Docker-Volumes bzw. persistenten Upload-Pfaden.

Nicht ausfuehren, ausser du willst Daten bewusst loeschen:

```bash
docker compose down -v
```

## Wenn public routes alte Assets liefern

`update.sh` prueft unter anderem `/community` und `/seasons/current`. Wenn dort alte `main.*.js` oder `main.*.css` Dateien auftauchen:

1. Reverse-Proxy-Cache leeren.
2. HTML-Caching fuer SPA-Routen deaktivieren.
3. `./update.sh u` nochmal laufen lassen.

Mehr Details: [OPERATIONS.md](OPERATIONS.md).

## Rollback

```bash
git log --oneline -5
git checkout <previous-commit>
docker compose up -d --build
```

Danach wieder auf `main`:

```bash
git checkout main
git pull --ff-only
```

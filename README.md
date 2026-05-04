# TLS ARENA — THE LION SQUAD eSports Tournament System

Production-ready, self-hosted Tournament Management System for esports clubs.
Built around the needs of **THE LION SQUAD eSports** (Toornament/Challonge-style, with a fully integrated F1 Fast Lap Challenge module).

## Features

- **Auth**: JWT (access + refresh as httpOnly cookies), role-based access (player / team_leader / moderator / tournament_admin / club_admin / superadmin), brute-force protection, password reset tokens.
- **Teams**: Create, join-code, leader / co-leader / members, team profiles.
- **Games & Events**: Multi-discipline with platforms, event pages aggregating tournaments + F1 challenges + stations.
- **Tournaments**: Wizard creation, registration, check-in, auto-bracket generation (Single Elim, Double Elim, Round Robin, League, plus structure for Swiss / Groups / FFA / BR / Time Trial / Grand Prix), score reporting with consensus auto-confirmation, dispute flow, forfeit, bronze match.
- **F1 Fast Lap Challenge (full integration)**: Per-track leaderboards, championship points across tracks, unlimited attempts, penalty seconds, invalid lap flag, CSV export, **TV/Beamer live mode** with auto-refresh.
- **Stations**: Switch / Switch 2 / PC / Racing Rig / Beamer / Stream / Admin Desk, status + assign to match.
- **Admin**: KPI dashboard, user/role management, ban/unban, audit log.
- **Display / TV views**: `/display/f1/:id`, `/display/bracket/:id` — optimized for projectors.
- **Public pages**: Landing, tournaments, brackets, standings, events, teams, news, login/register, privacy / imprint.
- **Exports**: CSV for F1 leaderboards.
- **Self-hostable**: Docker Compose (MongoDB + FastAPI + React/Nginx), plain Ubuntu 24.04 compatible, works behind Nginx Proxy Manager.

## Quickstart (development via Supervisor, pre-installed)

```bash
sudo supervisorctl restart backend
# frontend hot-reloads automatically
```

For local development, set `APP_ENV=development` and provide an `ADMIN_PASSWORD`
in `.env`. Demo users are created only when `SEED_DEMO=true`.

Change the admin password immediately in **/profile → change password** (or `/api/auth/change-password`).

## Production (Docker Compose)

1. `cp .env.example .env`
2. Set a strong `JWT_SECRET`, `ADMIN_PASSWORD`, `PUBLIC_BACKEND_URL`, `FRONTEND_URL`, `CORS_ORIGINS`.
3. `docker compose up -d --build`
4. Open `https://lionsquad.at/` and login with the admin credentials from your `.env`.
5. Change the admin password immediately.

Behind Nginx Proxy Manager, point `lionsquad.at` to `frontend:80` and `lionsquad.at/api/*` to `backend:8001/api/*` (or front the entire backend as a separate subdomain).

### Production checklist

- Use one canonical domain everywhere, preferably `https://lionsquad.at`.
- Set `CORS_ORIGINS` and `FRONTEND_URL` to the same public origin unless you intentionally split frontend/backend domains.
- Keep `SEED_DEMO=false` in production.
- Configure SMTP in the admin UI. For a local mailserver, use `host.docker.internal` or the host IP and set SMTP auth to "Ohne Anmeldung" when the server does not offer SMTP AUTH.
- For reliable mail delivery, configure SPF, DKIM, DMARC and PTR/rDNS for `lionsquad.at`.
- Run `docker compose logs -f backend frontend` after every update and check `/api/health`.

## Docs

- [INSTALL.md](INSTALL.md) — Full Ubuntu 24.04 install guide
- [UPDATE.md](UPDATE.md) — How to update safely
- [BACKUP_RESTORE.md](BACKUP_RESTORE.md) — MongoDB backup & restore
- `/app/memory/test_credentials.md` — Seeded credentials for development

## License

Proprietary — THE LION SQUAD eSports club.

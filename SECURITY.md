# Security baseline

## Production invariants

- `APP_ENV=production` is mandatory. Missing, misspelled, or unknown values stop startup.
- `JWT_SECRET` must be at least 32 characters and must not contain placeholder markers.
- `TLS_RESET`, `SEED_DEMO`, `SEED_GAME_SERVERS`, and insecure CORS are blocked in production.
- The API process never creates, promotes, unbans, or reactivates administrator accounts.
- Client error telemetry is disabled by default (`CLIENT_LOGGING_ENABLED=false`). If enabled
  deliberately, query strings, tokens, email addresses, and local paths are redacted and
  client-side deduplication/rate limits apply.

## First administrator

Use `./install.sh` or the explicit one-off command documented in `INSTALL.md`. The bootstrap
creates an account only when no superadmin exists and refuses to promote an existing user.
The installer removes `ADMIN_PASSWORD` from `.env` after a successful bootstrap.

## Secret rotation checklist

If a password or token was ever committed, logged, shared, or used as a test credential,
assume it is compromised even after the file is edited:

1. Rotate the production admin password through the authenticated profile/admin flow.
2. Revoke active refresh sessions and verify disabled accounts cannot log in.
3. Rotate JWT, SMTP, Resend, Discord, Twitch, and game-server secrets that may have been reused.
4. Store replacements only in the deployment secret store or a mode-`0600` server `.env`.
5. Rebuild/restart the affected services and perform an authenticated smoke test.
6. Review audit/login logs for unexpected use around the rotation time.

Never paste real secret values into issues, commits, CI logs, or chat transcripts.

## Development reset

The old startup reset was removed. Development/test data can only be cleared with the
explicit command below; production is always rejected and both database name and confirmation
must match:

```bash
APP_ENV=development python backend/reset_data.py \
  --database tls_arena_dev \
  --confirm RESET-ALL-DATA
```

## Dependency exception

`frontend/scripts/security-audit-allowlist.json` contains one time-limited React Router
advisory exception. The advisory affects only experimental React Server Components APIs,
which this client-only application does not use. The exception expires on 2026-10-31 and
must not be extended without a new review; the permanent resolution is a tested Router/Vite
migration.

## Reporting

Report suspected vulnerabilities privately to the repository owner. Do not open a public
issue containing exploit details, personal data, or credentials.

# Security baseline

## Production invariants

- `APP_ENV=production` is mandatory. Missing, misspelled, or unknown values stop startup.
- `JWT_SECRET` must be at least 32 characters and must not contain placeholder markers.
- `SETTINGS_ENCRYPTION_KEY` must be a valid stable Fernet key in production; integration secrets
  are encrypted before storage.
- `TLS_RESET`, `SEED_DEMO`, `SEED_GAME_SERVERS`, and insecure CORS are blocked in production.
- The API process never creates, promotes, unbans, or reactivates administrator accounts.
- Client error telemetry is disabled by default (`CLIENT_LOGGING_ENABLED=false`). If enabled
  deliberately, query strings, tokens, email addresses, and local paths are redacted and
  client-side deduplication/rate limits apply.
- Published container ports bind to Loopback by default for operation behind a reverse proxy.
- Forwarded client IP and HTTPS information is accepted only from `TRUSTED_PROXY_CIDRS`;
  wildcard/default-route trust is rejected. Rate limits and session audit records use the
  client address already validated by Uvicorn, never raw forwarding headers.
- Public Host headers are restricted to `FRONTEND_URL`, `CORS_ORIGINS`, optional
  `TRUSTED_HOSTS`, and the internal health-check names.
- Administrative roles require TOTP MFA, and sensitive settings use `club_admin`/`superadmin`
  boundaries instead of a generic admin check.
- Google credentials are verified server-side against the operator's configured OAuth client;
  stable Google subject identifiers are never returned to clients.
- Passwords, MFA seeds, recovery-code hashes and provider secrets are excluded from every public
  user response and DSGVO export.

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

Rotating `SETTINGS_ENCRYPTION_KEY` requires decrypting and re-encrypting all stored secrets with a
purpose-built maintenance migration. Never simply replace the key in `.env`, otherwise existing
SMTP, Discord, Twitch and server credentials become unreadable.

## Development reset

The old startup reset was removed. Development/test data can only be cleared with the
explicit command below; production is always rejected and both database name and confirmation
must match:

```bash
APP_ENV=development python backend/reset_data.py \
  --database tls_arena_dev \
  --confirm RESET-ALL-DATA
```

## Dependency exceptions

Audit exceptions must name an exact advisory, explain the exposure, and expire. CI continues
to fail for every unlisted or expired finding at the configured threshold (moderate for the
mobile app, high for the frontend runtime dependencies).

Both gates (`frontend/scripts/audit-high.js`, `mobile/scripts/audit-ci.cjs`) share one evaluator,
`scripts/dependency-audit-gate.cjs`, with a self-test (`scripts/dependency-audit-gate.test.mjs`)
that runs before every audit:

- No silent pass: if the audit cannot reach the registry, reports an error, or its JSON does not
  have the expected shape (summary, counts per severity, findings), the gate fails.
- Every entry in `security-audit-allowlist.json` needs `module`, `expires` (a real date, at most
  one year ahead) and a `reason`; an invalid list fails the gate.
- An exception that expires within 30 days is announced as a warning (also as a GitHub Actions
  annotation); an exception no longer needed is reported so it can be removed.

The current exceptions are listed in `mobile/scripts/security-audit-allowlist.json` together with
their reason and expiry date; none of them is part of the shipped app bundle.

## Reporting

Report suspected vulnerabilities privately to the repository owner via
[GitHub private vulnerability reporting](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/security/advisories/new)
("Security" tab → "Report a vulnerability"). Do not open a public issue containing exploit
details, personal data, or credentials.

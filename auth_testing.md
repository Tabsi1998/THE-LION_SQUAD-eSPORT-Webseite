# Auth Testing Playbook - TLS ARENA

## Test Credentials
- Superadmin: `admin@thelionsquad.at` / `TLSAdmin2026!`
- Demo player: `leon_king@demo.thelionsquad.at` / `demo123`

## MongoDB Verification
```
mongosh
use test_database
db.users.find({role: "superadmin"}).pretty()
db.users.countDocuments()  // should be 21 (1 admin + 20 demo)
db.games.countDocuments()  // should be 6
db.tournaments.countDocuments()  // should be 2
db.f1_challenges.countDocuments()  // should be 1
```

## API Tests
```
# Login (superadmin)
curl -c /tmp/c.txt -X POST $BACKEND/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@thelionsquad.at","password":"TLSAdmin2026!"}'

# /me
curl -b /tmp/c.txt $BACKEND/api/auth/me

# Dashboard
curl -b /tmp/c.txt $BACKEND/api/admin/dashboard

# Create tournament
curl -b /tmp/c.txt -X POST $BACKEND/api/tournaments \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","slug":"test-1","game_id":"<GAME_ID>","format":"single_elim"}'
```

## Expected Behavior
- Successful login sets `access_token` + `refresh_token` cookies
- `/api/auth/me` returns the user object without `password_hash`
- Admin endpoints return 403 for non-admins, 401 if unauthenticated
- 7 failed logins within 15 min = 429 Too Many Requests

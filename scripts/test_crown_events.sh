#!/bin/bash
# E2E: crown transition -> notifications (gained/changed/lost) + idempotency
set -u
API=$(grep REACT_APP_BACKEND_URL /app/frontend/.env | cut -d '=' -f2)
J=/tmp/tls_crown_admin.txt

curl -s -c $J -X POST "$API/api/auth/login" -H "Content-Type: application/json" -H "Origin: $API" \
  -d '{"email":"admin@lionsquad.at","password":"LionSquad2026!Admin"}' -o /dev/null -w "admin login: %{http_code}\n"
CSRF=$(grep csrf_token $J | awk '{print $7}')

echo "== leaderboard top4 =="
curl -s "$API/api/achievements/leaderboard?limit=4" | python3 -c "
import sys,json
rows=json.load(sys.stdin)
for r in rows: print(r['rank'], r['user_id'][:8], r['display_name'], r['points'])
"

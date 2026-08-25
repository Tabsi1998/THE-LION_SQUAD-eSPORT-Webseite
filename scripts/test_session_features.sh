#!/bin/bash
# E2E checks: sessions API, logout-all, parallel-refresh regression, growth stats, video upload
set -u
API=$(grep REACT_APP_BACKEND_URL /app/frontend/.env | cut -d '=' -f2)
EMAIL="admin@lionsquad.at"
PASS="LionSquad2026!Admin"
J1=/tmp/tls_j1.txt; J2=/tmp/tls_j2.txt

echo "== 1. Login (device A) =="
curl -s -c $J1 -X POST "$API/api/auth/login" -H "Content-Type: application/json" -H "Origin: $API" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" -o /tmp/login1.json -w "login A: %{http_code}\n"
CSRF1=$(grep csrf_token $J1 | awk '{print $7}')

echo "== 2. Login (device B, other UA) =="
curl -s -c $J2 -A "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit Safari" -X POST "$API/api/auth/login" \
  -H "Content-Type: application/json" -H "Origin: $API" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" -o /dev/null -w "login B: %{http_code}\n"
CSRF2=$(grep csrf_token $J2 | awk '{print $7}')

echo "== 3. Sessions list (device A) =="
curl -s -b $J1 "$API/api/auth/sessions" | python3 -c "
import sys,json
rows=json.load(sys.stdin)
print('sessions:',len(rows))
for r in rows: print(' -',r['client'],'| current:',r['current'],'| ua:',r['user_agent'][:40],'| id:',r['id'][:8])
assert any(r['current'] for r in rows), 'FAIL: no current session'
assert len(rows)>=2, 'FAIL: expected >=2 sessions'
print('PASS sessions list')
"

echo "== 4. Parallel refresh regression (device A) =="
cp $J1 /tmp/j1a.txt; cp $J1 /tmp/j1b.txt
curl -s -b /tmp/j1a.txt -c /tmp/j1a.txt -X POST "$API/api/auth/refresh" -H "X-CSRF-Token: $CSRF1" -H "Origin: $API" -o /dev/null -w "r1: %{http_code}\n" &
curl -s -b /tmp/j1b.txt -c /tmp/j1b.txt -X POST "$API/api/auth/refresh" -H "X-CSRF-Token: $CSRF1" -H "Origin: $API" -o /dev/null -w "r2: %{http_code}\n" &
wait
curl -s -b /tmp/j1a.txt "$API/api/auth/me" | python3 -c "
import sys,json
u=json.load(sys.stdin)
assert u and u.get('email'), 'FAIL: session lost after parallel refresh'
print('PASS parallel refresh, user:', u['email'])
"

echo "== 5. Access token survives rotation (old cookie jar A still valid) =="
curl -s -b $J1 "$API/api/auth/me" | python3 -c "
import sys,json
u=json.load(sys.stdin)
assert u and u.get('email'), 'FAIL: pre-rotation access token died'
print('PASS access token decoupled from rotation')
"

echo "== 6. Logout-all from device A (kills device B) =="
curl -s -b /tmp/j1a.txt -X POST "$API/api/auth/sessions/logout-all" -H "X-CSRF-Token: $(grep csrf_token /tmp/j1a.txt | awk '{print $7}')" -H "Origin: $API" | python3 -c "import sys,json; d=json.load(sys.stdin); print('revoked_sessions:', d['revoked_sessions']); assert d['ok']"
curl -s -b $J2 -o /dev/null -w "device B /auth/me after logout-all: %{http_code} (expect 200 body null or 401)\n" "$API/api/auth/me"
curl -s -b $J2 "$API/api/auth/me" | python3 -c "
import sys,json
u=json.load(sys.stdin)
assert not u, 'FAIL: device B still logged in'
print('PASS device B logged out')
"
curl -s -b /tmp/j1a.txt "$API/api/auth/me" | python3 -c "
import sys,json
u=json.load(sys.stdin)
assert u and u.get('email'), 'FAIL: current session was killed by logout-all'
print('PASS current session survived logout-all')
"

echo "== 7. Single session revoke =="
curl -s -c $J2 -A "TestDeviceC" -X POST "$API/api/auth/login" -H "Content-Type: application/json" -H "Origin: $API" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" -o /dev/null -w "login C: %{http_code}\n"
SID=$(curl -s -b /tmp/j1a.txt "$API/api/auth/sessions" | python3 -c "
import sys,json
rows=json.load(sys.stdin)
others=[r for r in rows if not r['current']]
print(others[0]['id'] if others else '')
")
echo "revoking session: $SID"
curl -s -b /tmp/j1a.txt -X DELETE "$API/api/auth/sessions/$SID" -H "X-CSRF-Token: $(grep csrf_token /tmp/j1a.txt | awk '{print $7}')" -H "Origin: $API" -w " revoke: %{http_code}\n"
curl -s -b $J2 "$API/api/auth/me" | python3 -c "
import sys,json
u=json.load(sys.stdin)
assert not u, 'FAIL: revoked device still logged in'
print('PASS single session revoke')
"

echo "== 8. Growth stats =="
curl -s -b /tmp/j1a.txt "$API/api/admin/growth-stats?days=30" | python3 -c "
import sys,json
d=json.load(sys.stdin)
days=d['days']
assert len(days)==30, f'FAIL: {len(days)} days'
last=days[-1]
print('PASS growth-stats · today:', last)
"

echo "== 9. Video upload E2E =="
python3 - <<'PY'
# minimal valid mp4 (ftyp box only header sniff needs ftyp) - use ffmpeg if available
PY
if command -v ffmpeg >/dev/null 2>&1; then
  ffmpeg -y -f lavfi -i testsrc=duration=1:size=320x240:rate=10 -pix_fmt yuv420p /tmp/tls_test.mp4 -loglevel error
else
  python3 -c "
import struct
ftyp = b'\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom'
open('/tmp/tls_test.mp4','wb').write(ftyp + b'\x00'*2048)
"
fi
UP=$(curl -s -b /tmp/j1a.txt -X POST "$API/api/uploads/video" -H "X-CSRF-Token: $(grep csrf_token /tmp/j1a.txt | awk '{print $7}')" -H "Origin: $API" -F "file=@/tmp/tls_test.mp4;type=video/mp4")
echo "$UP"
URL=$(echo "$UP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('url',''))")
if [ -n "$URL" ]; then
  curl -s -o /dev/null -w "video fetch $URL: %{http_code}\n" "$API$URL"
  echo "PASS video upload"
else
  echo "FAIL video upload"
fi

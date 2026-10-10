#!/bin/bash
# Moves the portal onto the Supabase database created through Vercel
# (`vercel integration add supabase --prefix NEWDB_`). The old database is left untouched.
# Keys are read from Vercel into a private temp folder, never printed, and deleted at the end.
set -euo pipefail
cd "$(dirname "$0")/.."
BIN=/Applications/Postgres.app/Contents/Versions/latest/bin
[ -x "$BIN/psql" ] || { echo "Postgres.app is missing (needed for psql)."; exit 1; }
V() { npx -y vercel@latest "$@"; }

TMP=$(mktemp -d); chmod 700 "$TMP"; trap 'rm -rf "$TMP"' EXIT

echo "1/7 Reading the new database's keys from Vercel…"
V env pull "$TMP/env" --environment production --yes >/dev/null 2>&1 || { echo "Couldn't read Vercel env. Is this folder linked to the portal project?"; exit 1; }
get() { python3 - "$TMP/env" "$@" <<'PY'
import sys
path, names = sys.argv[1], sys.argv[2:]
vals = {}
for line in open(path):
    line = line.rstrip("\n")
    if "=" not in line or line.startswith("#"): continue
    k, v = line.split("=", 1)
    if len(v) >= 2 and v[0] == v[-1] == '"': v = v[1:-1].encode().decode("unicode_escape")
    vals[k] = v
for n in names:
    if vals.get(n): print(vals[n]); break
PY
}
URL=$(get NEWDB_SUPABASE_URL NEWDB_NEXT_PUBLIC_SUPABASE_URL)
ANON=$(get NEWDB_NEXT_PUBLIC_SUPABASE_ANON_KEY NEWDB_SUPABASE_ANON_KEY NEWDB_NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY NEWDB_SUPABASE_PUBLISHABLE_KEY)
SERVICE=$(get NEWDB_SUPABASE_SERVICE_ROLE_KEY NEWDB_SUPABASE_SECRET_KEY)
DBURL=$(get NEWDB_POSTGRES_URL_NON_POOLING NEWDB_POSTGRES_URL)
missing=""; for n in URL ANON SERVICE DBURL; do [ -n "${!n}" ] || missing="$missing $n"; done
if [ -n "$missing" ]; then
  echo "The new database's keys aren't in Vercel yet (missing:$missing)."
  echo "Run first: npx vercel integration add supabase --name unifictional-portal --prefix NEWDB_ --no-env-pull"
  exit 1
fi
DBURL="${DBURL%%\?*}?sslmode=require"
export PGCONNECT_TIMEOUT=20 PGOPTIONS='-c client_min_messages=warning'
echo "   found the new database ($(sed -E 's#https://([a-z0-9]+)\..*#\1#' <<<"$URL"))"

echo "2/7 Checking it's empty…"
HAS=$("$BIN/psql" "$DBURL" -Atc "select to_regclass('public.clients') is not null")
if [ "$HAS" = "t" ]; then
  echo "   tables already exist; skipping structure and data (safe to re-run)."
else
  echo "3/7 Creating tables, rules and functions…"
  "$BIN/psql" "$DBURL" -q -v ON_ERROR_STOP=1 -f supabase/move/01_schema.sql >/dev/null
  echo "4/7 Loading your 9 companies…"
  "$BIN/psql" "$DBURL" -q -v ON_ERROR_STOP=1 -f supabase/move/02_data.sql >/dev/null
fi
echo "   companies in the new database: $("$BIN/psql" "$DBURL" -Atc 'select count(*) from public.clients')"

echo "5/7 Studio admin login…"
read -r -p "   Admin email [admin@unifictional.com]: " AEMAIL; AEMAIL=${AEMAIL:-admin@unifictional.com}
while true; do
  read -rs -p "   Choose a password (8+ characters, hidden): " P1; echo
  read -rs -p "   Type it again: " P2; echo
  [ "$P1" = "$P2" ] && [ ${#P1} -ge 8 ] && break
  echo "   didn't match or too short, try again."
done
# Headers and body go through files in the private temp folder (curl can't read both from stdin).
printf 'header = "apikey: %s"\nheader = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\n' "$SERVICE" "$SERVICE" > "$TMP/hdr"
python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2],"email_confirm":True}))' "$AEMAIL" "$P1" > "$TMP/body"
CODE=$(curl -s -o "$TMP/resp" -w '%{http_code}' -X POST "$URL/auth/v1/admin/users" -K "$TMP/hdr" --data-binary @"$TMP/body")
if [ "$CODE" != "200" ] && [ "$CODE" != "201" ]; then
  UID_EXIST=$("$BIN/psql" "$DBURL" -Atc "select id from auth.users where lower(email)=lower('$AEMAIL')")
  if [ -n "$UID_EXIST" ]; then
    CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$URL/auth/v1/admin/users/$UID_EXIST" -K "$TMP/hdr" --data-binary @"$TMP/body")
    echo "   that login already existed; password updated (HTTP $CODE)."
  else
    echo "   Supabase refused the login (HTTP $CODE): $(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("msg") or d.get("message") or d.get("error_description") or d)' "$TMP/resp" 2>/dev/null)"; exit 1
  fi
else
  echo "   created $AEMAIL"
fi
rm -f "$TMP/hdr" "$TMP/body" "$TMP/resp"
unset P1 P2 BODY
"$BIN/psql" "$DBURL" -q -c "insert into public.portal_admins (user_id) select id from auth.users where lower(email)=lower('$AEMAIL') on conflict do nothing" >/dev/null
echo "   $AEMAIL is a studio admin."

echo "6/7 Pointing the portal at the new database…"
# Public values need --no-sensitive --yes or the CLI stops to ask and silently keeps the old value.
setenv() { V env rm "$1" production --yes >/dev/null 2>&1 || true; printf '%s' "$2" | V env add "$1" production $3 --yes >/dev/null 2>&1 || { echo "   couldn't set $1"; exit 1; }; }
setenv NEXT_PUBLIC_SUPABASE_URL "$URL" --no-sensitive
setenv NEXT_PUBLIC_SUPABASE_ANON_KEY "$ANON" --no-sensitive
setenv SUPABASE_SERVICE_ROLE_KEY "$SERVICE" --sensitive
[ -f .env.local ] && cp .env.local .env.local.before-move
python3 - "$URL" "$ANON" <<'PY'
import sys, re, os
url, anon = sys.argv[1], sys.argv[2]
p = ".env.local"
s = open(p).read() if os.path.exists(p) else ""
for k, v in (("NEXT_PUBLIC_SUPABASE_URL", url), ("NEXT_PUBLIC_SUPABASE_ANON_KEY", anon)):
    s = re.sub(rf"^{k}=.*$", f"{k}={v}", s, flags=re.M) if re.search(rf"^{k}=", s, re.M) else s + f"\n{k}={v}\n"
open(p, "w").write(s)
PY
unset SERVICE

echo "7/7 Redeploying…"
for attempt in 1 2 3; do
  out=$(V deploy --prod --yes 2>&1)
  if grep -q 'Production URL' <<<"$out"; then echo "   live: https://unifictional-client-portal.vercel.app"; break; fi
  echo "   Vercel didn't take it (attempt $attempt), retrying…"; sleep 3
done
echo
echo "Done. Sign in at https://unifictional-client-portal.vercel.app/login with $AEMAIL and the password you just chose."
echo "The old database is untouched; nothing was deleted."

#!/bin/bash
# One pass to put every portal key into Vercel (Production) and redeploy.
# Each value is typed hidden, sent straight to Vercel, and never saved on this Mac.
# Press Enter on any line to skip it (keeps whatever Vercel already has).
set -uo pipefail
cd "$(dirname "$0")/.."
EXISTING=$(npx -y vercel@latest env ls production 2>/dev/null | grep -oE '^\s+[A-Z][A-Z0-9_]+' | tr -d ' ')

KEYS=(
  "SUPABASE_SERVICE_ROLE_KEY|Supabase (Unifictional org) > Project Settings > API keys > service_role. Starts with eyJ or sb_secret_"
  "SQUARE_ACCESS_TOKEN|developer.squareup.com > your app > Production > Access token. Starts with EAAA (not the sq0idp Application ID)"
  "PSI_API_KEY|Optional: Google Cloud > APIs > Credentials > API key with PageSpeed Insights API (speed scores)"
  "GOOGLE_OAUTH_CLIENT_ID|Optional for now: Google Cloud OAuth client ID (Analytics / Search Console / Business Profile)"
  "GOOGLE_OAUTH_CLIENT_SECRET|Optional for now: Google Cloud OAuth client secret"
  "META_APP_ID|Optional for now: Meta app ID (Facebook / Instagram)"
  "META_APP_SECRET|Optional for now: Meta app secret"
)

# Optional: only ask for the names given, e.g.  bash scripts/add-keys.sh SQUARE_ACCESS_TOKEN
ONLY=" $* "

added=0
for row in "${KEYS[@]}"; do
  name="${row%%|*}"; hint="${row#*|}"
  if [ -n "${1:-}" ] && [[ "$ONLY" != *" $name "* ]]; then continue; fi
  have=""; grep -qx "$name" <<<"$EXISTING" && have=" [already set; paste to replace]"
  echo
  echo "$name$have"
  echo "  $hint"
  printf "  Paste value (hidden), or Enter to skip: "
  read -rs value; echo
  if [ -z "$value" ]; then echo "  skipped"; continue; fi
  if printf '%s' "$value" | npx -y vercel@latest env add "$name" production --sensitive --force >/dev/null 2>&1; then
    echo "  saved"; added=$((added+1))
  else
    echo "  couldn't save $name. Run: npx vercel env add $name production --sensitive"
  fi
  unset value
done

echo
if [ "$added" -gt 0 ]; then
  echo "Redeploying so the new keys take effect…"
  for attempt in 1 2 3; do
    out=$(npx -y vercel@latest deploy --prod --yes 2>&1)
    if grep -q 'Production URL' <<<"$out"; then echo "  Live: https://unifictional-client-portal.vercel.app"; break; fi
    echo "  Vercel didn't take it (attempt $attempt), retrying…"; sleep 3
  done
else
  echo "Nothing new to save."
fi
echo "Done."

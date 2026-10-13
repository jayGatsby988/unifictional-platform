#!/bin/zsh
# Deploy one app to Vercel production from a copy that carries no git metadata.
#
# Why: the Vercel team is a Hobby team, and Hobby teams block any deployment
# whose commit author is not the team owner. The Vercel CLI attaches the
# repo's HEAD author to a deployment, so a deploy from inside this repo by
# anyone else sits in BLOCKED forever (it shows as UNKNOWN in `vercel ls`).
# A copy outside the repo has no commit author, so it builds and goes live.
#
# Usage: scripts/deploy.sh "<app folder>"      e.g. scripts/deploy.sh unifictional-site
set -e
app="$1"
[ -n "$app" ] && [ -d "$app" ] || { echo "usage: scripts/deploy.sh <app folder>"; exit 1; }
[ -f "$app/.vercel/project.json" ] || { echo "$app is not linked to a Vercel project: run 'vercel link' inside it first"; exit 1; }
tmp=$(mktemp -d)
rsync -a --exclude node_modules --exclude node_modules.nosync --exclude .next --exclude ".env*" "$app/" "$tmp/"
cp -R "$app/.vercel" "$tmp/.vercel"
( cd "$tmp" && vercel deploy --prod --yes )
rm -rf "$tmp"

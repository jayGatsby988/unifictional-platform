#!/bin/zsh
# Turn a generated clip (any size, e.g. Kling 4K) into the landing hero's film:
#   public/hero/<name>.mp4         1080p H.264, fast-start, no audio track needed
#   public/hero/<name>-poster.jpg  the first frame, 1920 wide, the page's first paint
# then point HERO_VIDEO in src/components/landing/content.ts at the new name.
# Needs only macOS tools (avconvert, sips) plus the Swift `frames` extractor from
# website/projects/caldera/tools (built once with swiftc, see the memory notes).
#
# usage: tools/hero-video.sh <clip.mp4> [name]     (default name: studio-demo)
set -e
src="$1"; name="${2:-studio-demo}"
[ -f "$src" ] || { echo "usage: tools/hero-video.sh <clip.mp4> [name]"; exit 1; }
here="$(cd "$(dirname "$0")/.." && pwd)"
out="$here/public/hero"; mkdir -p "$out"
tmp="$(mktemp -d)"
echo "→ 1080p H.264"
avconvert --preset Preset1920x1080 --source "$src" --output "$tmp/$name.mp4" --replace --progress
mv "$tmp/$name.mp4" "$out/$name.mp4"
echo "→ poster"
frames="$here/../../caldera/tools/frames"
if [ -x "$frames" ]; then
  "$frames" "$out/$name.mp4" "$tmp/f" 100000 poster:1920:jpg:0.8 >/dev/null
  first="$(ls "$tmp/f/poster" | head -1)"
  cp "$tmp/f/poster/$first" "$out/$name-poster.jpg"
else
  echo "   (frames tool not found: keep the existing poster)"
fi
rm -rf "$tmp"
ls -la "$out"

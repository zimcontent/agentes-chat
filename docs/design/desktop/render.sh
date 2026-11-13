#!/bin/sh
# Renders what the agents' desktops show (apps/server/runner/desktop-look.ts), from the DougBot identity's code:
#   desktop-wallpaper.png  wall.ts bundled with the identity's avatars, one headless Chromium screenshot of
#                          wall.html at 1280×900 (DESKTOP_SIZE), scale 1, sRGB
#   desktop-mark.png       the Doug close up (the browser tab's icon) at 32 px, the dock's icon size
#   desktop-browser.png, desktop-files.png, desktop-terminal.png
#                          the dock's own icons at 32 px (icons.ts), read from the text icons.html leaves
#   start/doug.svg.txt     the Doug of the agent browser's start page, a bust, as SVG (icons.ts too)
# into apps/server/runner/assets/, each PNG with its base64 text (`.png.b64`), which the runner embeds. Needs bun and
# chromium or Chrome (CHROMIUM=path). Two runs give byte-identical images.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
assets="$repo/apps/server/runner/assets"
out="$here/out"
bun=${BUN:-bun}
chromium=${CHROMIUM:-chromium}
# Git Bash on Windows: the browser and the font's resolver take the drive's own path.
native() { cygpath -m "$1" 2>/dev/null || printf %s "$1"; }
page="file:///$(native "$here" | sed 's|^/||')"
mkdir -p "$out"
"$bun" build "$here/wall.ts" --outfile "$out/wall.js" --format iife --target browser >/dev/null
"$bun" build "$here/icons.ts" --outfile "$out/icons.js" --format iife --target browser >/dev/null
# The name's font (Manrope, the identity's §5), from the web app's own dependency.
font=$(cd "$repo/apps/web" && "$bun" -e 'console.log(require.resolve("@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2"))')
cp "$font" "$out/manrope.woff2"
shot() {
  rm -rf "$out/profile"
  "$chromium" --headless --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --force-color-profile=srgb --allow-file-access-from-files --virtual-time-budget=5000 \
    --user-data-dir="$(native "$out/profile")" "$@" 2>/dev/null
}
rm -f "$assets/desktop-wallpaper.png"
shot --window-size=1280,900 --screenshot="$(native "$assets/desktop-wallpaper.png")" "$page/wall.html" >/dev/null
[ -s "$assets/desktop-wallpaper.png" ] || { echo "no wallpaper" >&2; exit 1; }
shot --dump-dom "$page/icons.html" > "$out/icons.txt"
rm -rf "$out/profile"
for name in desktop-mark desktop-browser desktop-files desktop-terminal; do
  text=$(sed -n "s|^$name \([A-Za-z0-9+/=]*\).*|\1|p" "$out/icons.txt")
  [ -n "$text" ] || { echo "no $name" >&2; exit 1; }
  printf %s "$text" | base64 -d > "$assets/$name.png"
done
doug=$(sed -n "s|^start-doug \([A-Za-z0-9+/=]*\).*|\1|p" "$out/icons.txt")
[ -n "$doug" ] || { echo "no start-doug" >&2; exit 1; }
printf %s "$doug" | base64 -d > "$assets/start/doug.svg.txt"
for png in "$assets"/desktop-*.png; do base64 < "$png" | tr -d '\n' > "$png.b64"; done

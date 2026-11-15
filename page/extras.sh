#!/bin/sh
# Writes everything next to the HTML that Next doesn't render, the styles,
# the i18n catalogs, the compatibility table and the repo files the page
# reuses under their repo paths. build.sh points it at the export, dev.sh
# at public/.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")
out=$(realpath -m "$1")

cd "$here"
npx sass --no-source-map --style=expanded "$here/styles/site.scss" "$out/css/site.css"

python3 -I "$here/tools/po2json.py" "$root/po" "$out/i18n" >/dev/null
python3 -I "$here/tools/po2json.py" "$here/po" "$out/i18n" page. >/dev/null
python3 -I "$here/tools/compat.py" "$root" "$out/compat.json"

# Page modules import src/shared by its repo path. A ../ chain that climbs past
# the site root stays at the root, so the same import works staged.
mkdir -p "$out/src" "$out/assets/icons/hicolor/scalable" "$out/assets/emoji" "$out/media/screenshots"
cp -R "$root/src/shared" "$out/src/"
cp "$root/assets/icon.png" "$root/assets/logo.svg" "$out/assets/"
cp -R "$root/assets/icons/hicolor/scalable/actions" "$out/assets/icons/hicolor/scalable/"
cp "$root/assets/icons/CREDITS.md" "$out/assets/icons/"
cp "$root/assets/emoji/CREDITS.md" "$root/assets/emoji/emoji.json" "$out/assets/emoji/"
cp -R "$root/media/page" "$out/media/"
# The og:image and twitter:image of SiteHead.jsx
cp "$root/media/screenshots/landing-page.png" "$out/media/screenshots/"

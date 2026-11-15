#!/bin/sh
# next dev serves only pages/ and public/, so the extras land in public/
# (gitignored) and sass rebuilds the stylesheet on every save
set -eu

here=$(cd "$(dirname "$0")" && pwd)
cd "$here"
sh "$here/extras.sh" "$here/public"
npx sass --no-source-map --watch "$here/styles/site.scss" "$here/public/css/site.css" &
trap 'kill $!' EXIT
NEXT_TELEMETRY_DISABLED=1 npx next dev --port 3000

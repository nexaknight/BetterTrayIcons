#!/bin/sh
# Builds the static site. The landing markup comes from Next, the demo runtime
# ships as the plain ES modules in public/, extras.sh adds the rest.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")
# Resolved before the cd below, so a relative path means the caller's folder
out=$(realpath -m "${1:-$root/_site}")
site=https://bti.nexaknight.com/

cd "$here"
NEXT_TELEMETRY_DISABLED=1 npx next build >/dev/null
rm -rf "$out"
cp -R "$here/out" "$out"
# The page renders without React on the client, so Next's runtime chunks and
# its 404 page have no reader
rm -r "$out/_next" "$out/404" "$out/404.html"
sh "$here/extras.sh" "$out"

printf 'User-agent: *\nAllow: /\n\nSitemap: %ssitemap.xml\n' "$site" >"$out/robots.txt"
cat >"$out/sitemap.xml" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>$site</loc>
    <lastmod>$(date -u +%F)</lastmod>
  </url>
</urlset>
XML

echo "Built site in $out"

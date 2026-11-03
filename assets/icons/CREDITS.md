# Icon Credits

Icons bundled so the preferences look the same under every user icon theme.
Every themed name the preferences use is in here. A themed name that slips
back in will silently change with the user's theme, and two of them were
broken before this: `low-vision-symbolic` rendered as `image-missing` on both
MacTahoe and Adwaita, and `emblem-favorite-symbolic` was missing from Adwaita.

## Lucide

**License:** ISC, [github.com/lucide-icons/lucide](https://github.com/lucide-icons/lucide)

- `bti-about` ← Lucide `info`
- `bti-actions` ← Lucide `mouse-pointer-click`
- `bti-add` ← Lucide `plus`
- `bti-apple` ← Lucide `apple`
- `bti-apps` ← Lucide `layout-grid`
- `bti-changelog` ← Lucide `list`
- `bti-clock` ← Lucide `clock`
- `bti-close` ← Lucide `x`
- `bti-code` ← Lucide `code`
- `bti-color` ← Lucide `palette`
- `bti-copy` ← Lucide `copy`
- `bti-download` ← Lucide `archive-restore`
- `bti-ellipsis-vertical` ← Lucide `ellipsis-vertical`
- `bti-export` ← Lucide `file-output`
- `bti-flag` ← Lucide `flag`
- `bti-folder` ← Lucide `folder-open`
- `bti-folder-search` ← Lucide `folder-search`
- `bti-gear` ← Lucide `settings-2`
- `bti-general` ← Lucide `settings`
- `bti-grid` ← Lucide `grid-2x2`
- `bti-hash` ← Lucide `hash`
- `bti-heart` ← Lucide `heart`
- `bti-help` ← Lucide `circle-question-mark`
- `bti-hidden` ← Lucide `eye-off`
- `bti-image` ← Lucide `image`
- `bti-import` ← Lucide `file-input`
- `bti-license` ← Lucide `scale`
- `bti-lightbulb` ← Lucide `lightbulb`
- `bti-link` ← Lucide `link`
- `bti-next` ← Lucide `chevron-right`
- `bti-other` ← Lucide `ellipsis`
- `bti-package-x` ← Lucide `package-x`
- `bti-paw-print` ← Lucide `paw-print`
- `bti-plane` ← Lucide `plane`
- `bti-previous` ← Lucide `chevron-left`
- `bti-properties` ← Lucide `sliders-horizontal`
- `bti-reset` ← Lucide `rotate-ccw`
- `bti-search` ← Lucide `search`
- `bti-select` ← Lucide `check`
- `bti-sidebar-hide` ← Lucide `panel-left-close`
- `bti-sidebar-show` ← Lucide `panel-left-open`
- `bti-smile` ← Lucide `face-slightly-smiling`
- `bti-star` ← Lucide `star`
- `bti-sync` ← Lucide `refresh-cw`
- `bti-tag` ← Lucide `tag`
- `bti-tag-x` ← Lucide `tag-x`
- `bti-trash` ← Lucide `trash-2`
- `bti-trophy` ← Lucide `trophy`
- `bti-unlink` ← Lucide `unlink`
- `bti-users` ← Lucide `users`
- `bti-warning` ← Lucide `triangle-alert`

The `bti-sample-*` icons stand in for typical tray applications in the live
previews, same pipeline:

- `bti-sample-browser` ← Lucide `globe`
- `bti-sample-camera` ← Lucide `camera`
- `bti-sample-chat` ← Lucide `message-circle`
- `bti-sample-game` ← Lucide `gamepad-2`
- `bti-sample-mail` ← Lucide `mail`
- `bti-sample-music` ← Lucide `music`
- `bti-sample-terminal` ← Lucide `terminal`
- `bti-sample-vault` ← Lucide `shield`

Lucide draws with strokes, GNOME recolors symbolic icons by forcing a fill on
rect, circle and path and never touches stroke. Dropped in unmodified, the
lines vanish and the rings fill in as solid discs. So every icon above was
outlined from stroke to fill with `scripts/outlineLucide.py` (Skia's stroker,
2 px, round caps and joins, from the `icons/<name>.svg` of `lucide-static`
1.66.0). That is the only modification, the shapes are Lucide's.

> ISC License
>
> Copyright (c) 2026 Lucide Icons and Contributors
>
> Permission to use, copy, modify, and/or distribute this software for any
> purpose with or without fee is hereby granted, provided that the above
> copyright notice and this permission notice appear in all copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
> WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
> MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
> ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
> WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
> ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
> OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## Feather

**License:** MIT, [github.com/feathericons/feather](https://github.com/feathericons/feather)

Fifteen of the Lucide icons above are derived from Feather, so its license
applies to them as well:

- `bti-about`
- `bti-add`
- `bti-code`
- `bti-next`
- `bti-previous`
- `bti-search`
- `bti-select`
- `bti-trash`
- `bti-link`
- `bti-help`
- `bti-close`
- `bti-ellipsis-vertical`
- `bti-clock`
- `bti-hash`
- `bti-smile`

> The MIT License (MIT)
>
> Copyright (c) 2013-present Cole Bemis
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## MoreWaita icon theme

**License:** GPL-3.0, [github.com/somepaulo/MoreWaita](https://github.com/somepaulo/MoreWaita)

- `bti-wine` ← MoreWaita `bottles_wine-symbolic`

## GitHub

**Trademark** of GitHub, Inc.

- `bti-github` ← Octocat mark

The Octocat is a registered trademark of GitHub, Inc., not original to this
project and not under its license. Bundled only so the About page can link to
the project's GitHub repository, which is a use GitHub's logo policy allows.

## Buy Me a Coffee

**Trademark** of Buy Me a Coffee

- `bti-buymeacoffee` ← cup mark from the Buy Me a Coffee logo (SeekLogo download)

The logo is a trademark of its owner, not original to this project and not
under its license. Only the cup outline is kept, in one colour so it follows
the theme like the other glyphs. Bundled only so the About page can show where
the donation link leads.

## Original to this project

**License:** GPL-3.0-or-later

- `bti-proton`, no icon set carries a generic glyph for it

## Not bundled

The external-link glyph on the sponsor row uses libadwaita's own
`adw-external-link-symbolic`. It lives in libadwaita's GResource rather than in
an icon theme, so no user theme can replace or break it, and the preferences
link against libadwaita anyway.

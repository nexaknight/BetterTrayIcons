<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/logo.svg" width="264">
    <source media="(prefers-color-scheme: light)" srcset="../media/logo-dark.svg" width="264">
    <img alt="Nexaknight" src="../assets/logo.svg" width="264">
  </picture>
</p>


<h1 align="center">
  <img src="../assets/icon.png" alt="" width="40" align="center">
  &nbsp;Better Tray Icons Website
</h1>

<p align="center">
  The home of Better Tray Icons on the web, with a demo of every single setting. Static, fast and entirely yours to edit.
</p>

<p align="center">
  <a href="https://bti.nexaknight.com"><img alt="Visit the site" src="https://img.shields.io/badge/bti.nexaknight.com-visit-4A86CF?style=flat-square&logo=gnome&logoColor=white"></a>
  <a href="https://github.com/nexaknight/BetterTrayIcons/actions/workflows/pages.yml"><img alt="Deploy" src="https://github.com/nexaknight/BetterTrayIcons/actions/workflows/pages.yml/badge.svg"></a>
  <a href="../LICENSE"><img alt="License: GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square"></a>
</p>

## About

This folder is the website at [**bti.nexaknight.com**](https://bti.nexaknight.com). It shows what the extension does and lets you try every setting in the browser before you install anything. The demo mirrors the real preferences in look and behavior, so what you see here is what you get in GNOME.


## What lives where

```text
page/
├── pages/              Next entry, index.jsx, build time only
├── sections/           the landing as React, Hero, Features, Install, ...
├── components/         the React pieces the sections share, Button, Icon, Tray, ...
├── styles/             SCSS, site.scss lists the partials in cascade order
│   ├── landing/        the landing page
│   ├── prefs/          the demo, one partial per Adwaita element
│   └── shared/         what both use
├── public/             copied into the export unchanged, this is what runs
│   ├── app.js          the landing runtime
│   ├── prefs.js        the demo runtime
│   ├── landing/        hero tray, drag and drop, menus, dialogs of the landing
│   ├── components/     the demo's Adwaita elements, one file each
│   ├── pages/          the five demo pages
│   ├── subpages/       the appearance subpages, tray icons, toggle button, overflow menu
│   ├── dialogs/        the demo dialogs
│   ├── scenes/         the placement scenes
│   ├── shared/         demo state, settings, i18n, the tray look
│   └── assets/, media/ pictures and icons
├── po/                 the page's own strings, the demo strings come from ../po
├── tools/              the i18n and compatibility generators
├── build.sh            builds the export
├── extras.sh           adds what Next does not render, styles, i18n JSON, compat.json
├── dev.sh              runs the live editing server
└── next.config.mjs
```

The demo modules import `src/shared/*.js` of the extension by their repo path. `extras.sh` copies that folder next to the page, so the site never carries a second copy of that code.

## Build and preview

Run these from the repo root. One build and you are done.

```bash
npm ci --prefix page
sh page/build.sh _site
python3 -m http.server --directory _site 3000
```

That builds the export into `_site/` and previews it at http://localhost:3000/.

Working on the markup or the styles? Start the live server instead.

```bash
npm run dev --prefix page
```

That runs `next dev` on http://localhost:3000/. Markup and SCSS changes show up on reload. Stop the export preview first, both want port 3000.

## Keep the demo honest

The demo promises one thing: what you see on the site is what you get in GNOME. A few habits keep that promise, and they are easy to keep.

&nbsp;✓&nbsp; **The extension leads, the demo follows.** Every row, dialog and color in the demo has its twin in `src/prefs/`. Change the extension first, then let the demo catch up.<br>
&nbsp;✓&nbsp; **One component per element.** Everything that looks like Adwaita comes from its file in `public/components/`, and every landing button from `components/Button.jsx`. Missing a knob? Add it to the component, and every place gets it.<br>
&nbsp;✓&nbsp; **Ids, classes and `data-*` attributes are the wiring.** `app.js` and `prefs.js` find their elements by them. Keep them, and the clicks, drags and dialogs keep working.<br>
&nbsp;✓&nbsp; **`data-i18n` is always `data-i18n=""`.** A bare `data-i18n` turns into `"true"` on the way through React, and the translator passes the element by.<br>
&nbsp;✓&nbsp; **A translation key is the element's own inner HTML**, whitespace collapsed. Keep an inline link on its text run and put the space next to it inside the string (`{' by MartinPL and '}`), so React adds no comment marker and the key still matches the catalog.<br>
&nbsp;✓&nbsp; **Look twice before you call it done.** Build the site, open the demo next to the real preferences and compare. Looks and behavior both count. A switch, a picker or a dialog reacts the way GTK does.

## Deploying

A push to `main` that touches the page, the shared modules or the app icon builds the site and publishes it through GitHub Pages, see [`pages.yml`](../.github/workflows/pages.yml). Nothing to click.

## Contributing

The site could be even better with your help. Found a typo, a broken layout on your screen, or a demo that behaves differently from the real thing? The [Contributing guide](../CONTRIBUTING.md) walks you through filing it and sending a change.

## License

The website is part of Better Tray Icons and available under the terms of the **GPL v3 or later** license. See [LICENSE](../LICENSE) for the full text.

<p align="center"><sub>Developed by <a href="https://github.com/nexaknight">NexaKnight</a>. If you like it, consider leaving a star.</sub></p>

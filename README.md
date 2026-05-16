<p align="center">
  <img src="media/logo.svg" alt="Better Tray Icons" width="264">
</p>

<h1 align="center">
  <img src="media/icon.png" alt="" width="48" align="center">
  &nbsp;Better Tray Icons
</h1>

<p align="center">
  A GNOME Shell extension that brings tray icons back to the top panel.
</p>

<p align="center">
  <img src="media/screenshots/panel-toggle.png" alt="Tray icons in the panel" width="500">
</p>

## About

Better Tray Icons puts tray icons back into the GNOME panel where they belong. You pick how many icons stay visible, and the rest tuck away into a popup behind a toggle button.

Every icon can be renamed, hidden, reordered or swapped out for a custom one. Clicks are fully configurable for Tray icons and Toggle Button, with double-click and long-press support. Spacing, padding, colors, the toggle button styling, all of it is up to you.

Settings can be exported, imported and even synced across devices through a shared JSON file with rotated backups.


## Features

| Feature | |
|---|:-:|
| Tray icons in the panel | ![](https://img.shields.io/badge/-✓-22c55e?style=flat-square) |
| Overflow popup with a configurable toggle button, in row or grid layout | ![](https://img.shields.io/badge/-✓-22c55e?style=flat-square) |
| Drag-and-drop reordering inside the panel and the popup | ![](https://img.shields.io/badge/-✓-22c55e?style=flat-square) |
| Right-click context menus | ![](https://img.shields.io/badge/-✓-22c55e?style=flat-square) |
| Hover tooltips with configurable side and delay | ![](https://img.shields.io/badge/-✓-22c55e?style=flat-square) |
| Rename, hide, reorder or override any icon per app | ![](https://img.shields.io/badge/-✓-22c55e?style=flat-square) |
| Click actions for left, middle and right click, each plus double-click and long-press | ![](https://img.shields.io/badge/-✓-22c55e?style=flat-square) |
| Extra toggle-button actions like open popup, cycle icons, action menu, open settings | ![](https://img.shields.io/badge/-✓-22c55e?style=flat-square) |
| Independent styling for tray icons, toggle button and overflow container | ![](https://img.shields.io/badge/-✓-22c55e?style=flat-square) |
| Symbolic icon mode (if the app supports it) | ![](https://img.shields.io/badge/-✓-22c55e?style=flat-square) |
| JSON export and import with optional cloud sync and rotated backups | ![](https://img.shields.io/badge/-✓-22c55e?style=flat-square) |

## Screenshots

| Panel | Overflow (row) | Overflow (grid) |
|:-:|:-:|:-:|
| ![Panel](media/screenshots/panel-toggle.png) | ![Row layout](media/screenshots/overflow-row-layout.png) | ![Grid layout](media/screenshots/overflow-grid-layout.png) |
| Toggle button in the panel. Click to reveal the rest. | Row layout, single line. | Grid layout with a configurable column limit. |

| Tooltip | Custom styling | Drag and Drop |
|:-:|:-:|:-:|
| ![Tooltip](media/screenshots/tray-tooltip.png) | ![Custom container styling](media/screenshots/overflow-custom-style.png) | ![Drag and Drop](media/screenshots/drag-and-drop.gif) |
| Hover tooltip with configurable side and delay. | Background, radius, padding and hover color, all overridable. | Drag icons around to reorder them, both in the panel and the popup. |

### Preferences

| General | Appearance | Actions |
|:-:|:-:|:-:|
| ![General](media/screenshots/prefs-general.png) | ![Appearance](media/screenshots/prefs-appearance.png) | ![Actions](media/screenshots/prefs-actions.png) |

| Applications | Icon picker | Sync |
|:-:|:-:|:-:|
| ![Applications](media/screenshots/prefs-applications.png) | ![Icon picker](media/screenshots/prefs-icon-picker.png) | ![Sync dialog](media/screenshots/prefs-sync-dialog.png) |

## Installation

The easiest way to install Better Tray Icons is from the [GNOME Extensions website](https://extensions.gnome.org/extension/9975/better-tray-icons/).

If you'd rather grab the development version from source, head over to the [Installation wiki page](../../wiki/Installation).

## Compatibility

Better Tray Icons targets the two most recent stable GNOME Shell releases. Check `metadata.json` for the exact versions of the current build. Wayland only, X11 sessions are not supported.

## Conflicts

Disable any other tray or AppIndicator extension before enabling this one, otherwise both will fight over the same DBus names. The Extensions app warns about this up front, because the conflicting UUIDs are declared in `metadata.json`:

- `appindicatorsupport@rgcjonas.gmail.com` (AppIndicator and KStatusNotifierItem Support)
- `ubuntu-appindicators@ubuntu.com`
- `trayIconsReloaded@selfmade.pl`

## Translating

Help with translations is very welcome, both new languages and improvements to existing ones. Have a look at the [translation guidelines](https://github.com/nexaknight/BetterTrayIcons/wiki/Translation-Guidelines) before opening a PR.

## Contributing

This extension could be even better with your help. The [Contributing guide](CONTRIBUTING.md) walks you through setting up the dev environment, filing bug reports and submitting changes.

## Credits

Better Tray Icons is inspired by [AppIndicator/KStatusNotifierItem support for GNOME Shell](https://github.com/ubuntu/gnome-shell-extension-appindicator) and uses the DBus interface XML files from the upstream specifications that project links to.

The preferences window, especially the About page layout, takes a few cues from [Dash to Panel](https://github.com/home-sweet-gnome/dash-to-panel) by Home Sweet GNOME.

## License

Better Tray Icons is available under the terms of the GPL v3 or later license. See [LICENSE](LICENSE) for the full text.

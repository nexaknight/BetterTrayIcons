<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo.svg" width="264">
    <source media="(prefers-color-scheme: light)" srcset="media/logo-dark.svg" width="264">
    <img alt="Nexaknight" src="assets/logo.svg" width="264">
  </picture>
</p>


<h1 align="center">
  <img src="assets/icon.png" alt="" width="40" align="center">
  &nbsp;Better Tray Icons
</h1>

<p align="center">
  A GNOME Shell extension that returns tray icons to the top panel. Tidy, configurable and entirely yours.
</p>

<p align="center">
  <a href="https://extensions.gnome.org/extension/9975/better-tray-icons/"><img alt="Get it on GNOME Extensions" src="https://img.shields.io/badge/GNOME%20Extensions-install-4A86CF?style=flat-square&logo=gnome&logoColor=white"></a>
  <a href="https://github.com/nexaknight/BetterTrayIcons/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/nexaknight/BetterTrayIcons?style=flat-square&color=8E44AD"></a>
  <img alt="GNOME Shell" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fnexaknight%2FBetterTrayIcons%2Fmain%2Fmetadata.json&query=%24%5B%22shell-version%22%5D&label=GNOME%20Shell&color=333333&style=flat-square">
  <img alt="Session" src="https://img.shields.io/badge/session-Wayland-2ECC71?style=flat-square">
  <a href="LICENSE"><img alt="License: GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square"></a>
</p>


<p align="center">
  <img src="media/screenshots/panel-toggle.png" alt="Tray icons in the panel" width="520">
</p>

## About

Better Tray Icons puts tray icons back into the GNOME panel where they belong. You decide how many stay visible, and the rest tuck neatly away into a popup behind a toggle button.

Every icon can be renamed, hidden, reordered or swapped out for a custom one. Clicks are fully configurable for both tray icons and the toggle button, with double-click and long-press support. Spacing, padding, colors, the toggle button styling, all of it is up to you.

Settings can be exported, imported and even synced across devices through a shared JSON file with automatic backups.


## Features

Everything you need to tame the tray, and nothing you do not.

&nbsp;✓&nbsp; **Icons in the panel** with an overflow popup in row or grid layout<br>
&nbsp;✓&nbsp; **Drag and drop** reordering, in the panel and inside the popup<br>
&nbsp;✓&nbsp; **Full click control** for left, middle and right, each with double-click and long-press<br>
&nbsp;✓&nbsp; **Toggle-button actions** like open popup, cycle icons, action menu and open settings<br>
&nbsp;✓&nbsp; **Per-app overrides** to rename, hide, reorder or replace any icon<br>
&nbsp;✓&nbsp; **Independent styling** for tray icons, toggle button and overflow container<br>
&nbsp;✓&nbsp; **Hover tooltips** with configurable side and delay<br>
&nbsp;✓&nbsp; **Symbolic icon mode** for a clean, native look where supported<br>
&nbsp;✓&nbsp; **Sync and backups** through JSON export and import with automatic backups

## Screenshots

<table>
  <tr>
    <th align="center">Panel</th>
    <th align="center">Overflow (row)</th>
    <th align="center">Overflow (grid)</th>
  </tr>
  <tr>
    <td align="center"><img src="media/screenshots/panel-toggle.png" alt="Panel" width="260"></td>
    <td align="center"><img src="media/screenshots/overflow-row-layout.png" alt="Row layout" width="260"></td>
    <td align="center"><img src="media/screenshots/overflow-grid-layout.png" alt="Grid layout" width="260"></td>
  </tr>
  <tr>
    <td align="center">Toggle button in the panel.<br>Click to reveal the rest.</td>
    <td align="center">Row layout, single line.</td>
    <td align="center">Grid layout with a<br>configurable column limit.</td>
  </tr>
  <tr>
    <th align="center">Tooltip</th>
    <th align="center">Custom styling</th>
    <th align="center">Drag and drop</th>
  </tr>
  <tr>
    <td align="center"><img src="media/screenshots/tray-tooltip.png" alt="Tooltip" width="260"></td>
    <td align="center"><img src="media/screenshots/overflow-custom-style.png" alt="Custom container styling" width="260"></td>
    <td align="center"><img src="media/screenshots/drag-and-drop.gif" alt="Drag and drop" width="260"></td>
  </tr>
  <tr>
    <td align="center">Hover tooltip with<br>configurable side and delay.</td>
    <td align="center">Background, radius, padding<br>and hover color, all overridable.</td>
    <td align="center">Reorder icons in the<br>panel and the popup.</td>
  </tr>
</table>

<details>
  <summary><b>Preferences window</b> (click to expand)</summary>
  <br>
  <table>
    <tr>
      <th align="center">General</th>
      <th align="center">Appearance</th>
      <th align="center">Actions</th>
    </tr>
    <tr>
      <td align="center"><img src="media/screenshots/prefs-general.png" alt="General" width="260"></td>
      <td align="center"><img src="media/screenshots/prefs-appearance.png" alt="Appearance" width="260"></td>
      <td align="center"><img src="media/screenshots/prefs-actions.png" alt="Actions" width="260"></td>
    </tr>
    <tr>
      <th align="center">Applications</th>
      <th align="center">Icon picker</th>
      <th align="center">Sync</th>
    </tr>
    <tr>
      <td align="center"><img src="media/screenshots/prefs-applications.png" alt="Applications" width="260"></td>
      <td align="center"><img src="media/screenshots/prefs-icon-picker.png" alt="Icon picker" width="260"></td>
      <td align="center"><img src="media/screenshots/prefs-sync-dialog.png" alt="Sync dialog" width="260"></td>
    </tr>
  </table>
</details>

## Installation

The easiest way to get Better Tray Icons is straight from the [**GNOME Extensions website**](https://extensions.gnome.org/extension/9975/better-tray-icons/). One click and you are done.

Prefer building from source? The [Installation wiki page](../../wiki/Installation) has the development version covered.

## Compatibility

Better Tray Icons targets the **two most recent stable GNOME Shell releases**. Check [`metadata.json`](metadata.json) for the exact versions of the current build.

> [!NOTE]
> Wayland only. X11 sessions are not supported.

## Conflicts

Disable any other tray or AppIndicator extension before enabling this one, otherwise both will fight over the same DBus names. The Extensions app warns about this up front, because the conflicting UUIDs are declared in [`metadata.json`](metadata.json):

- `appindicatorsupport@rgcjonas.gmail.com` (AppIndicator and KStatusNotifierItem Support)
- `ubuntu-appindicators@ubuntu.com`
- `trayIconsReloaded@selfmade.pl`

## Translating

Help with translations is very welcome, both new languages and improvements to existing ones. Have a look at the [translation guidelines](https://github.com/nexaknight/BetterTrayIcons/wiki/Translation-Guidelines) before opening a PR.

## Contributing

This extension could be even better with your help. The [Contributing guide](CONTRIBUTING.md) walks you through setting up the dev environment, filing bug reports and submitting changes.

## Credits

<table>
  <tr>
    <td valign="top" width="50%">
      <b>Project inspiration</b>
      <ul>
        <li><a href="https://github.com/ubuntu/gnome-shell-extension-appindicator">AppIndicator/KStatusNotifierItem support for GNOME Shell</a></li>
        <li><a href="https://github.com/MartinPL/Tray-Icons-Reloaded">Tray Icons: Reloaded</a> by MartinPL</li>
        <li><a href="https://github.com/cassidyjames/background-app-icons">Background App Icons</a> by cassidyjames, for the background app menu</li>
      </ul>
    </td>
    <td valign="top" width="50%">
      <b>DBus interfaces</b>
      <br><br>
      Interface XML files from the upstream specifications that <a href="https://github.com/ubuntu/gnome-shell-extension-appindicator">AppIndicator</a> links to.
    </td>
  </tr>
  <tr>
    <td valign="top" width="50%">
      <b>Preferences layout</b>
      <br><br>
      The About page takes a few cues from <a href="https://github.com/home-sweet-gnome/dash-to-panel">Dash to Panel</a> by Home Sweet GNOME.
    </td>
    <td valign="top" width="50%">
      <b>Preference icons</b>
      <ul>
        <li>Mostly <a href="https://github.com/lucide-icons/lucide">Lucide</a> (ISC)</li>
        <li>Some derived from <a href="https://github.com/feathericons/feather">Feather</a> (MIT) by Cole Bemis</li>
        <li>Wine glyph from <a href="https://github.com/somepaulo/MoreWaita">MoreWaita</a> (GPL-3.0)</li>
      </ul>
    </td>
  </tr>
</table>

Full per-icon attribution and the license texts live in [assets/icons/CREDITS](assets/icons/CREDITS).

## License

Better Tray Icons is available under the terms of the **GPL v3 or later** license. See [LICENSE](LICENSE) for the full text.

<p align="center"><sub>Made with care by <a href="https://github.com/nexaknight">NexaKnight</a>. If it makes your panel tidier, consider leaving a star.</sub></p>

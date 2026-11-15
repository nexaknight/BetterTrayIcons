# Media Credits

Files in `media/` are for the README and the project page. They are not
part of the extension, `make pack` does not ship this folder.

## Project's own work

- `logo-dark.svg`, dark variant of the NexaKnight logo in `assets/logo.svg`
- `screenshots/landing-page.png`, screenshot of the project page at bti.nexaknight.com

## Simple Icons

**License:** CC0-1.0, [github.com/simple-icons/simple-icons](https://github.com/simple-icons/simple-icons) ([license](https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md))

Brand names and marks belong to their respective owners.

- `page/battlenet.svg` ← Simple Icons Battle.net
- `page/discord.svg` ← Simple Icons Discord
- `page/nextcloud.svg` ← Simple Icons Nextcloud
- `page/obs.svg` ← Simple Icons OBS Studio
- `page/signal.svg` ← Simple Icons Signal
- `page/steam.svg` ← Simple Icons Steam
- `page/telegram.svg` ← Simple Icons Telegram
- `page/vlc.svg` ← Simple Icons VLC

## Remmina

**License:** GPL-2.0, full text in [`page/remmina-LICENSE.txt`](page/remmina-LICENSE.txt)

- `page/remmina.svg` ← upstream `data/desktop/scalable/apps/org.remmina.Remmina-symbolic.svg` from [github.com/FreeRDP/Remmina](https://github.com/FreeRDP/Remmina), the official mirror of [gitlab.com/Remmina/Remmina](https://gitlab.com/Remmina/Remmina)

## Pika Backup

**License:** GPL-3.0, full text in [`page/pika-backup-LICENSE.txt`](page/pika-backup-LICENSE.txt), copied from the repository's `LICENSE`. The repository gives no separate licence for its icons. Its `Cargo.toml` states `license = "GPL-3.0-only"` and `data/app.metainfo.xml.in` states `<project_license>GPL-3.0</project_license>`.

- `page/org.gnome.World.PikaBackup.svg` ← upstream `data/app.svg`, which its `data/meson.build` installs as `org.gnome.World.PikaBackup.svg`, from [gitlab.gnome.org/World/pika-backup](https://gitlab.gnome.org/World/pika-backup)

## GNOME

- `page/gnome.svg`, the GNOME foot logo, a registered trademark of the GNOME Foundation, used under the Foundation's trademark guidelines. The Foundation gives no license for the logo itself. Source: [foundation.gnome.org/legal-and-trademarks](https://foundation.gnome.org/legal-and-trademarks/)

## Adwaita icon theme

**License:** dual licensed, GNU LGPL v3 (`LGPL-3.0-or-later`) or Creative Commons Attribution-Share Alike 3.0 United States (`CC-BY-SA-3.0`), at your choice. Artwork by the GNOME Project, [gnome.org](https://www.gnome.org). Source: [gitlab.gnome.org/GNOME/adwaita-icon-theme](https://gitlab.gnome.org/GNOME/adwaita-icon-theme)

Copied unchanged from the theme's `symbolic/` folder, except the cursor:

- `page/audio-volume-high-symbolic.svg` ← `status/audio-volume-high-symbolic.svg`
- `page/audio-volume-medium-symbolic.svg` ← `status/audio-volume-medium-symbolic.svg`
- `page/audio-volume-low-symbolic.svg` ← `status/audio-volume-low-symbolic.svg`
- `page/audio-volume-muted-symbolic.svg` ← `status/audio-volume-muted-symbolic.svg`
- `page/network-wireless-signal-excellent-symbolic.svg` ← `status/network-wireless-signal-excellent-symbolic.svg`
- `page/system-shutdown-symbolic.svg` ← `actions/system-shutdown-symbolic.svg`
- `page/cursor-default.png` ← the 48px image of `cursors/default`, read out of the Xcursor file and saved as PNG

## Lucide

**License:** ISC, [github.com/lucide-icons/lucide](https://github.com/lucide-icons/lucide) ([license](https://github.com/lucide-icons/lucide/blob/main/LICENSE))

Downloaded from `icons/<name>.svg` of `lucide-static` 1.66.0 and outlined with `scripts/outlineLucide.py`, so the stroke became a fill, the same way as `assets/icons/`:

- `page/lucide-bluetooth.svg` ← Lucide `bluetooth`
- `page/lucide-coffee.svg` ← Lucide `coffee`
- `page/lucide-cog.svg` ← Lucide `cog`
- `page/lucide-ethernet-port.svg` ← Lucide `ethernet-port`
- `page/lucide-gauge.svg` ← Lucide `gauge`
- `page/lucide-ghost.svg` ← Lucide `ghost`
- `page/lucide-lock.svg` ← Lucide `lock`
- `page/lucide-sun-moon.svg` ← Lucide `sun-moon`

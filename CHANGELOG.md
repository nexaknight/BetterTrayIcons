# Changelog

## [2.2.0](https://github.com/nexaknight/BetterTrayIcons/compare/v2.1.0...v2.2.0) (2026-07-05)


### Features

* **i18n:** add Russian translation ([2ad6f33](https://github.com/nexaknight/BetterTrayIcons/commit/2ad6f33b092e12c23f1ae9565b439f1ef6dcd430))

## [2.1.0](https://github.com/nexaknight/BetterTrayIcons/compare/v2.0.3...v2.1.0) (2026-07-05)


### Features

* **tray:** add hover tooltips to xembed icons ([7f67c93](https://github.com/nexaknight/BetterTrayIcons/commit/7f67c9327a97ac24f4909335b50df85c6dadda91))


### Bug Fixes

* **build:** ship the compiled gsettings schema in the release asset ([5263b55](https://github.com/nexaknight/BetterTrayIcons/commit/5263b55db867f618be4f9217e80771d099341e39)), closes [#12](https://github.com/nexaknight/BetterTrayIcons/issues/12)

## [2.0.3](https://github.com/nexaknight/BetterTrayIcons/compare/v2.0.2...v2.0.3) (2026-07-04)


### Bug Fixes

* **tray:** parse the xembed background color with cogl ([c0fd41c](https://github.com/nexaknight/BetterTrayIcons/commit/c0fd41c881fdd028b9caf7ac07a2d20fe5fd36e5))

## [2.0.2](https://github.com/nexaknight/BetterTrayIcons/compare/v2.0.1...v2.0.2) (2026-07-04)


### Bug Fixes

* **tray:** keep auto-hide panels visible while a context menu is open ([0b43f1d](https://github.com/nexaknight/BetterTrayIcons/commit/0b43f1dba7fd2b04000f513a5184bc5be2527419))

## [2.0.1](https://github.com/nexaknight/BetterTrayIcons/compare/v2.0.0...v2.0.1) (2026-07-04)


### Bug Fixes

* **about:** correct the show-more card icon name ([3e4bcfb](https://github.com/nexaknight/BetterTrayIcons/commit/3e4bcfb8781de5aff1e970af03cc78bc17980adf))


### Performance Improvements

* generate the dbusmenu proxy class once per process ([9afa291](https://github.com/nexaknight/BetterTrayIcons/commit/9afa2914e8e45f4be170c29e1578a5a68c11b221))
* **prefs:** batch factory reset and import into one transaction ([60bfb59](https://github.com/nexaknight/BetterTrayIcons/commit/60bfb5922631c49c19b15cf2092813853d84b090))
* **prefs:** cache the system icon list across picker opens ([15686f0](https://github.com/nexaknight/BetterTrayIcons/commit/15686f0def91c4a60fcc4acf7274c59661b6d859))
* **prefs:** coalesce applications page rebuilds ([6c8fb3d](https://github.com/nexaknight/BetterTrayIcons/commit/6c8fb3d6bfc6a223a9e54de222f1b412376249a9))
* **prefs:** defer about page artwork until the page is shown ([16fca87](https://github.com/nexaknight/BetterTrayIcons/commit/16fca8793b3f7a40e8dcc8d87b22b8e7d4e71267))
* **prefs:** stop the sync dialog from stat-storming on keystrokes ([1177d86](https://github.com/nexaknight/BetterTrayIcons/commit/1177d8653125d4832329330b5376d27ecd79837f))
* **sync:** make backup rotation and writes fully async ([1a288d8](https://github.com/nexaknight/BetterTrayIcons/commit/1a288d87c154f8fa58884a55671cf30fb91194bc))
* **tray:** skip icon refetches for unrelated settings changes ([3286e25](https://github.com/nexaknight/BetterTrayIcons/commit/3286e253c4265e0386d0976b26272dc3545cf46c))
* **tray:** trim d-bus traffic per icon update ([af8ae48](https://github.com/nexaknight/BetterTrayIcons/commit/af8ae488569caae6000d4042ca719b91ef425d8b))
* **tray:** write reorders as a single app-configs update ([991ffce](https://github.com/nexaknight/BetterTrayIcons/commit/991ffcef1279dfe86369bab6b667d8630bb0accf))

## [2.0.0](https://github.com/nexaknight/BetterTrayIcons/compare/v1.999.999...v2.0.0) (2026-05-14)


### ⚠ BREAKING CHANGES

* version bump to align with EGO submission

### Features

* align versioning with EGO submission ([bc7ab77](https://github.com/nexaknight/BetterTrayIcons/commit/bc7ab775e16be963507d6bc1f00dd749f40bae33))
* Initial release of Better Tray Icons ([1ac8ebe](https://github.com/nexaknight/BetterTrayIcons/commit/1ac8ebebc645b3080c53ae67bd54cf3eb3f8e062))


### Bug Fixes

* convert /proc and Steam manifest reads to async file IO ([a33f316](https://github.com/nexaknight/BetterTrayIcons/commit/a33f31650b1f20623cb9c6ff522569fca5b028f4))
* keep overflow popup open when tray icon updates ([8a62426](https://github.com/nexaknight/BetterTrayIcons/commit/8a6242603c8d56f32dbfa1a4642091178e87acdc))
* prevent signal leak and use async file IO ([4a9fcf6](https://github.com/nexaknight/BetterTrayIcons/commit/4a9fcf6a58349846655c58712ffca4c2bf921689))

## Changelog

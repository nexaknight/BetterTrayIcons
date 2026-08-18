# Changelog

## [3.1.0](https://github.com/nexaknight/BetterTrayIcons/compare/v3.0.6...v3.1.0) (2026-08-18)


### Features

* **dnd:** rework icon reordering around live slides ([580a499](https://github.com/nexaknight/BetterTrayIcons/commit/580a499a48cf145df5b08bbeb43a9916c05b9bec))
* **popup:** keep the overflow menu open through context menus ([22f60e6](https://github.com/nexaknight/BetterTrayIcons/commit/22f60e63c693b3347087bdf87352ebfaa7ea6163)), closes [#49](https://github.com/nexaknight/BetterTrayIcons/issues/49)
* **style:** border color and width for icons, toggle and popup ([b814f20](https://github.com/nexaknight/BetterTrayIcons/commit/b814f201b4972d5d6bfec6fa0234609f77ad597a))

## [3.0.6](https://github.com/nexaknight/BetterTrayIcons/compare/v3.0.5...v3.0.6) (2026-08-02)


### Translations

* Update Russian translation ([#46](https://github.com/nexaknight/BetterTrayIcons/issues/46)) ([a93cb95](https://github.com/nexaknight/BetterTrayIcons/commit/a93cb95f280f1d594128a70a5e866913e838f017))

## [3.0.5](https://github.com/nexaknight/BetterTrayIcons/compare/v3.0.4...v3.0.5) (2026-07-30)


### Bug Fixes

* **prefs:** show contributors missing from github's cached list ([361153b](https://github.com/nexaknight/BetterTrayIcons/commit/361153b75bf9576c2b9798e122fcfee4f5f8af29))

## [3.0.4](https://github.com/nexaknight/BetterTrayIcons/compare/v3.0.3...v3.0.4) (2026-07-30)


### Translations

* add Italian translation ([#41](https://github.com/nexaknight/BetterTrayIcons/issues/41)) ([1b32db6](https://github.com/nexaknight/BetterTrayIcons/commit/1b32db64b3cbd587d446f234e111c9b686140443))

## [3.0.3](https://github.com/nexaknight/BetterTrayIcons/compare/v3.0.2...v3.0.3) (2026-07-29)


### Bug Fixes

* **tray:** multi-color status icons and the unread badge ([4046722](https://github.com/nexaknight/BetterTrayIcons/commit/404672286801f3377f8c28c63026c779ee608a46)), closes [#33](https://github.com/nexaknight/BetterTrayIcons/issues/33) [#35](https://github.com/nexaknight/BetterTrayIcons/issues/35)

## [3.0.2](https://github.com/nexaknight/BetterTrayIcons/compare/v3.0.1...v3.0.2) (2026-07-24)


### Bug Fixes

* clean up after a failed enable instead of only logging it ([f3239e3](https://github.com/nexaknight/BetterTrayIcons/commit/f3239e3b4bddb687fe5b5a8d6ba222dea0f148e7))

## [3.0.1](https://github.com/nexaknight/BetterTrayIcons/compare/v3.0.0...v3.0.1) (2026-07-23)


### Bug Fixes

* **tray:** keep the context menu alive when the panel auto-hides ([62ab18a](https://github.com/nexaknight/BetterTrayIcons/commit/62ab18af2665e79d149743b2a1a04d75a1fba2b3)), closes [#33](https://github.com/nexaknight/BetterTrayIcons/issues/33) [#34](https://github.com/nexaknight/BetterTrayIcons/issues/34)

## [3.0.0](https://github.com/nexaknight/BetterTrayIcons/compare/v2.4.0...v3.0.0) (2026-07-23)


### ⚠ BREAKING CHANGES

* **tray:** the tray detection core was reworked, so apps can be re-identified under new keys and settings synced from an older version may not apply cleanly. To be safe after updating, reset all settings and clear the backups under General so no stale or broken data is carried over.

### Features

* **actions:** touch gestures and scroll to cycle icons ([20511cb](https://github.com/nexaknight/BetterTrayIcons/commit/20511cbeb06498e54ec7a5f652140ef46e89dfcb)), closes [#30](https://github.com/nexaknight/BetterTrayIcons/issues/30)
* bundle the extension's own icon theme ([2aba319](https://github.com/nexaknight/BetterTrayIcons/commit/2aba319dfe1ff58a73db73bf6a8ea01f7d782396))
* **prefs:** sidebar redesign, live previews and cross-device merge ([470a996](https://github.com/nexaknight/BetterTrayIcons/commit/470a9965f79f14777b11f5660f14a8ea7fe73764))
* **shell:** hide background apps and proxy icons for windowless apps ([fff0954](https://github.com/nexaknight/BetterTrayIcons/commit/fff09545ad6d0b307435ec9c0336046f297a0469))
* **tray:** per-item identity, packaging split and status badges ([1e52b35](https://github.com/nexaknight/BetterTrayIcons/commit/1e52b359ac9a25ee93f17c3baed9bd65879bc7d3))


### Bug Fixes

* **prefs:** ship the svg assets the about page renders ([11f89d1](https://github.com/nexaknight/BetterTrayIcons/commit/11f89d1273909d17192357f57fab181a619b5f4d))
* **prefs:** stop scoped handlers from leaking their widget ([bb3d17f](https://github.com/nexaknight/BetterTrayIcons/commit/bb3d17f022ca256e081b5834ad5f698c5b7b76f5))
* **schema:** reject out-of-range values instead of storing them ([ed36840](https://github.com/nexaknight/BetterTrayIcons/commit/ed368406ac797aba2699cb0ab3c3af1a742b4ce6))
* **sync:** keep the settings import off the shell main loop ([1a980b5](https://github.com/nexaknight/BetterTrayIcons/commit/1a980b58297cc783c0d6fa3d2a20b9243d3ccfd3))

## [2.4.0](https://github.com/nexaknight/BetterTrayIcons/compare/v2.3.0...v2.4.0) (2026-07-12)


### Features

* **tray:** let selected colors follow the system accent ([558a8e8](https://github.com/nexaknight/BetterTrayIcons/commit/558a8e8414c16a96d53df1beb949f502b9eca7e6)), closes [#20](https://github.com/nexaknight/BetterTrayIcons/issues/20)

## [2.3.0](https://github.com/nexaknight/BetterTrayIcons/compare/v2.2.3...v2.3.0) (2026-07-10)


### Features

* **tray:** let a setting choose which menu opens on toggle hover ([6602996](https://github.com/nexaknight/BetterTrayIcons/commit/6602996d66730c5048c3d163263fe64364273746)), closes [#22](https://github.com/nexaknight/BetterTrayIcons/issues/22)

## [2.2.3](https://github.com/nexaknight/BetterTrayIcons/compare/v2.2.2...v2.2.3) (2026-07-08)


### Bug Fixes

* **tray:** cancel in-flight SNI registrations when their owner dies ([b553039](https://github.com/nexaknight/BetterTrayIcons/commit/b553039376d82aaeb900b3d789abf864bb4bef86)), closes [#14](https://github.com/nexaknight/BetterTrayIcons/issues/14)
* **tray:** identify Wine tray icons by launcher and prefix ([8ba83ae](https://github.com/nexaknight/BetterTrayIcons/commit/8ba83ae3d82a542ac7be917365190abeecbf5301))

## [2.2.2](https://github.com/nexaknight/BetterTrayIcons/compare/v2.2.1...v2.2.2) (2026-07-06)


### Bug Fixes

* **prefs:** correct button alignment styling ([d18d01f](https://github.com/nexaknight/BetterTrayIcons/commit/d18d01f8e4641135f745c2755d2fcc5fd0146acf))

## [2.2.1](https://github.com/nexaknight/BetterTrayIcons/compare/v2.2.0...v2.2.1) (2026-07-05)


### Bug Fixes

* **about:** lowercase the contributor opt-out entry ([3f7d41a](https://github.com/nexaknight/BetterTrayIcons/commit/3f7d41acde0e75be42f3af38c9b43189211b63cc))
* **tray:** expand context menu submenus on click ([79b2d63](https://github.com/nexaknight/BetterTrayIcons/commit/79b2d6374a58b4356a9f5102408241e544fb7d6d)), closes [#11](https://github.com/nexaknight/BetterTrayIcons/issues/11)

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

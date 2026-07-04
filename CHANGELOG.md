# Changelog

## [2.0.2](https://github.com/nexaknight/BetterTrayIcons/compare/v2.0.1...v2.0.2) (2026-07-04)


### Bug Fixes

* **tray:** keep auto-hide panels visible while a context menu is open ([ed91117](https://github.com/nexaknight/BetterTrayIcons/commit/ed91117d444b9009a59e634f62f86c3827e66622))

## [2.0.1](https://github.com/nexaknight/BetterTrayIcons/compare/v2.0.0...v2.0.1) (2026-07-04)


### Bug Fixes

* **about:** correct the show-more card icon name ([e219f05](https://github.com/nexaknight/BetterTrayIcons/commit/e219f052a60dc65db0e4e056b6258ac27e914c1b))


### Performance Improvements

* generate the dbusmenu proxy class once per process ([6e8f636](https://github.com/nexaknight/BetterTrayIcons/commit/6e8f6368e7f55e6cd553537562519e0f0021f369))
* **prefs:** batch factory reset and import into one transaction ([48abaf0](https://github.com/nexaknight/BetterTrayIcons/commit/48abaf09260fe60bf95e46b808a3ab86dd34a218))
* **prefs:** cache the system icon list across picker opens ([2a92fbc](https://github.com/nexaknight/BetterTrayIcons/commit/2a92fbc0586c7ba8c7c76df5a1e5a9da794ad2c1))
* **prefs:** coalesce applications page rebuilds ([1c84c9d](https://github.com/nexaknight/BetterTrayIcons/commit/1c84c9d9efc8e9d17963c24c3510462b6d60480f))
* **prefs:** defer about page artwork until the page is shown ([d118e6f](https://github.com/nexaknight/BetterTrayIcons/commit/d118e6f781ee1026db7344fbcd0486dbbe0fd016))
* **prefs:** stop the sync dialog from stat-storming on keystrokes ([792c830](https://github.com/nexaknight/BetterTrayIcons/commit/792c830d51555c5d7874f9632947cecafc3c1601))
* **sync:** make backup rotation and writes fully async ([5c5ff61](https://github.com/nexaknight/BetterTrayIcons/commit/5c5ff6135576e50cc359d86a35faad1b85e346e0))
* **tray:** skip icon refetches for unrelated settings changes ([24a868f](https://github.com/nexaknight/BetterTrayIcons/commit/24a868ffd52f054952ca458986d8a63dd9e8e25f))
* **tray:** trim d-bus traffic per icon update ([9200cb6](https://github.com/nexaknight/BetterTrayIcons/commit/9200cb67bd7a2edf8308a9810ba7f4919cfa5db0))
* **tray:** write reorders as a single app-configs update ([5a5e248](https://github.com/nexaknight/BetterTrayIcons/commit/5a5e24872139d2e494216d250024277605f0020e))

## [2.0.0](https://github.com/nexaknight/BetterTrayIcons/compare/v1.999.999...v2.0.0) (2026-05-14)


### ⚠ BREAKING CHANGES

* version bump to align with EGO submission

### Features

* align versioning with EGO submission ([db04175](https://github.com/nexaknight/BetterTrayIcons/commit/db041754a72819d1d6837008478a515a27eaae72))
* Initial release of Better Tray Icons ([3af1671](https://github.com/nexaknight/BetterTrayIcons/commit/3af167128fe890aa16a09645b071db67f98300f4))


### Bug Fixes

* convert /proc and Steam manifest reads to async file IO ([c9fe4b0](https://github.com/nexaknight/BetterTrayIcons/commit/c9fe4b0b13e64ebedfb2a9f052180a715980df53))
* keep overflow popup open when tray icon updates ([06b6936](https://github.com/nexaknight/BetterTrayIcons/commit/06b6936c5a3d0ce9787a11ad587243ab8e3ccd7e))
* prevent signal leak and use async file IO ([8a29670](https://github.com/nexaknight/BetterTrayIcons/commit/8a29670f339626cdb8987238705c4ca877542665))

## Changelog

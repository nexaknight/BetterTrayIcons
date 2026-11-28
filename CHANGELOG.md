# Changelog

## [3.5.2](https://github.com/nexaknight/BetterTrayIcons/compare/v3.5.1...v3.5.2) (2026-11-28)


### Bug Fixes

* show the tooltip of tray items that set no title ([#103](https://github.com/nexaknight/BetterTrayIcons/issues/103)) ([6193dd4](https://github.com/nexaknight/BetterTrayIcons/commit/6193dd4b90f9d867813c70e9be76f41986370470))

## [3.5.1](https://github.com/nexaknight/BetterTrayIcons/compare/v3.5.0...v3.5.1) (2026-11-18)


### Translations

* Update Russian translation ([#100](https://github.com/nexaknight/BetterTrayIcons/issues/100)) ([a2df150](https://github.com/nexaknight/BetterTrayIcons/commit/a2df150c5fa36afca901075ac158a723298e7cb3))

## [3.5.0](https://github.com/nexaknight/BetterTrayIcons/compare/v3.4.1...v3.5.0) (2026-11-15)


### Features

* add background blur to icons, toggle and overflow menu ([2d50d9a](https://github.com/nexaknight/BetterTrayIcons/commit/2d50d9acb9fe282b206aa49646309756abd2c7fc))
* drawer and quick settings modes, the tray on every monitor and per-app click actions ([087b89a](https://github.com/nexaknight/BetterTrayIcons/commit/087b89aa22225428a5a5adbb05b8d545a3482599)), closes [#96](https://github.com/nexaknight/BetterTrayIcons/issues/96) [#98](https://github.com/nexaknight/BetterTrayIcons/issues/98)
* **prefs:** copy button on code blocks, a plainer icon picker and shared helpers for the website ([4481523](https://github.com/nexaknight/BetterTrayIcons/commit/44815239dbdcb06f514712ecc8c034ae17cdfb7e))
* **prefs:** credits viewer, donation links and the about footer ([64ecd34](https://github.com/nexaknight/BetterTrayIcons/commit/64ecd349d9f7849714a8cb28c5a06fd5c717abbe))
* **prefs:** dialog, row and page polish ([9423ad4](https://github.com/nexaknight/BetterTrayIcons/commit/9423ad42a5fcf4339745fbb3ed21ffaf1a0b2e72))
* **prefs:** filter, search and quick actions on the applications page ([4ae6c0c](https://github.com/nexaknight/BetterTrayIcons/commit/4ae6c0c334d4c50bb0676be0c598eb46f15339af))
* **prefs:** rebuild the icon picker as a dropdown with emoji and icon packs ([3339597](https://github.com/nexaknight/BetterTrayIcons/commit/33395972b5344b10175d458079133fdb1d57e7ce))
* **prefs:** rework the cloud sync dialog ([37088ca](https://github.com/nexaknight/BetterTrayIcons/commit/37088ca0b491671a1c8afe8bf41e87777e66e949))


### Bug Fixes

* bound icon file reads and menu image sizes ([8d3736b](https://github.com/nexaknight/BetterTrayIcons/commit/8d3736b724409a8a53835dfdf5337018fda8d3ab))
* import string-list settings and survive a quick disable and enable ([3139c15](https://github.com/nexaknight/BetterTrayIcons/commit/3139c1509504ede98610e1d5409771de3fe8e896))
* **prefs:** step the icon size by one pixel and cap it at 40 ([a3f0ef0](https://github.com/nexaknight/BetterTrayIcons/commit/a3f0ef0886e7196c74e4d0abd8d9d66398896260))
* tray icon size zero, scaled embeds and menu teardown on gnome 51 ([904c3a2](https://github.com/nexaknight/BetterTrayIcons/commit/904c3a255bfdf8758f18df07ddcb0d216c693704))


### Translations

* translate the new strings and drop the unused ones ([5c054f2](https://github.com/nexaknight/BetterTrayIcons/commit/5c054f235aa52148c43fbfd7812d80e5d7b50e5d))

## [3.4.1](https://github.com/nexaknight/BetterTrayIcons/compare/v3.4.0...v3.4.1) (2026-11-01)

### Translations

* Update Russian translation ([#94](https://github.com/nexaknight/BetterTrayIcons/issues/94)) ([f7dd025](https://github.com/nexaknight/BetterTrayIcons/commit/f7dd025494f007f213ab1191ebd9ee995abba1bd))

## [3.4.0](https://github.com/nexaknight/BetterTrayIcons/compare/v3.3.7...v3.4.0) (2026-11-01)

### Features

* **prefs:** Add a General switch that makes a tray click minimize any app whose window is already in front, and help texts behind a question mark on settings rows ([9b27e81](https://github.com/nexaknight/BetterTrayIcons/commit/9b27e817a53a1ba80d8c6affa6e726fb4fa1b271))
* **prefs:** Add title bar buttons to settings pages, starting with one that shows or hides the app badges on the Applications page ([9e940da](https://github.com/nexaknight/BetterTrayIcons/commit/9e940dad4aabb5b876825eaa344bbbbee394c1f6))
* **prefs:** Scroll the contributors sideways in one row ([63d98d9](https://github.com/nexaknight/BetterTrayIcons/commit/63d98d91bc1a640b1576dca697f66ff0471cd7a9))

### Bug Fixes

* **icons:** Honour fill and stroke from inline SVG styles when tinting, so icons drawn in Inkscape no longer tint as a solid square ([3db3fbc](https://github.com/nexaknight/BetterTrayIcons/commit/3db3fbce1d28020dfafcc5cec88fc63d142e55dc)), closes [#92](https://github.com/nexaknight/BetterTrayIcons/issues/92)
* **prefs:** Let the Tab key reach the title bar buttons ([3ddd00a](https://github.com/nexaknight/BetterTrayIcons/commit/3ddd00a92114aa743a7e2584c6be34952b3d24e9))
* **sni:** Close a kept-open popup before a click reaches the app, so apps that toggle their window hide it instead of showing it again ([82495f1](https://github.com/nexaknight/BetterTrayIcons/commit/82495f1cad65e5ac549eafd001c227061410472f))
* **sni:** Stop duplicate tray icons after login and unlock, and remove an icon as soon as its app releases its bus name ([0f0b435](https://github.com/nexaknight/BetterTrayIcons/commit/0f0b435177253b0702dee70c3b088e836aaff33e))
* **sni:** Give apps an activation token on click, so they can focus the window they open under Wayland ([504e0cf](https://github.com/nexaknight/BetterTrayIcons/commit/504e0cf9730bf2eb469b07f9c0281a5bcb9ac1cd))
* **sync:** Import only settings whose type and range match, and keep settings this version doesn't know when pushing to the sync file ([dfcf001](https://github.com/nexaknight/BetterTrayIcons/commit/dfcf00140feaacae5c6204b7d1709b64ade58442))
* **ui:** Keep Blur my Shell off the custom styled popup ([a66031d](https://github.com/nexaknight/BetterTrayIcons/commit/a66031dc6760a5069c2ec64f1a4d6664a3e9ece7))
* **ui:** Keep inline icon clicks from opening the overflow popup ([52b25ff](https://github.com/nexaknight/BetterTrayIcons/commit/52b25ffc2034ce92b1da78295990e026736667e8)), closes [#89](https://github.com/nexaknight/BetterTrayIcons/issues/89)

## [3.3.7](https://github.com/nexaknight/BetterTrayIcons/compare/v3.3.6...v3.3.7) (2026-10-30)

### Bug Fixes

* **sni:** Track tray items by their bus connection to avoid duplicate icons ([#90](https://github.com/nexaknight/BetterTrayIcons/issues/90)) ([d25c28c](https://github.com/nexaknight/BetterTrayIcons/commit/d25c28cf2673a9afe4ee330d45beb26fa741096c))

## [3.3.6](https://github.com/nexaknight/BetterTrayIcons/compare/v3.3.5...v3.3.6) (2026-10-28)

### Bug Fixes

* **icons:** Keep custom SVG icons and app pixmaps sharp under fractional scaling ([d79b280](https://github.com/nexaknight/BetterTrayIcons/commit/d79b2808810ba2368dae33b77fa59dcadc2af936)), closes [#87](https://github.com/nexaknight/BetterTrayIcons/issues/87)

## [3.3.5](https://github.com/nexaknight/BetterTrayIcons/compare/v3.3.4...v3.3.5) (2026-10-19)

### Bug Fixes

* **sni:** Let a focused app toggle its window when its tray icon is clicked ([71b8635](https://github.com/nexaknight/BetterTrayIcons/commit/71b8635603982660fab4c2208504c4ce50c3d039)), closes [#84](https://github.com/nexaknight/BetterTrayIcons/issues/84)

## [3.3.4](https://github.com/nexaknight/BetterTrayIcons/compare/v3.3.3...v3.3.4) (2026-10-15)

### Translations

* Update Italian translation ([#82](https://github.com/nexaknight/BetterTrayIcons/issues/82)) ([07889d6](https://github.com/nexaknight/BetterTrayIcons/commit/07889d61b40408cc89426905b5eff2064fa24306))

## [3.3.3](https://github.com/nexaknight/BetterTrayIcons/compare/v3.3.2...v3.3.3) (2026-10-15)

### Bug Fixes

* Make tray menus discoverable by Blur My Shell ([#78](https://github.com/nexaknight/BetterTrayIcons/issues/78)) ([49a113b](https://github.com/nexaknight/BetterTrayIcons/commit/49a113b5dd11f76497565a5a1822a4c6bf09256b))

## [3.3.2](https://github.com/nexaknight/BetterTrayIcons/compare/v3.3.1...v3.3.2) (2026-10-15)

### Bug Fixes

* **prefs:** Show the close button when window buttons sit on the left ([#79](https://github.com/nexaknight/BetterTrayIcons/issues/79)) ([7d9a850](https://github.com/nexaknight/BetterTrayIcons/commit/7d9a8509803c6827c7bb44ce0be77c917476e29e)), closes [#77](https://github.com/nexaknight/BetterTrayIcons/issues/77)

## [3.3.1](https://github.com/nexaknight/BetterTrayIcons/compare/v3.3.0...v3.3.1) (2026-09-29)

### Translations

* Small Russian translation update ([184ea81](https://github.com/nexaknight/BetterTrayIcons/commit/184ea818a10dd7958c0619586eabe436e0ea81dc))

## [3.3.0](https://github.com/nexaknight/BetterTrayIcons/compare/v3.2.4...v3.3.0) (2026-09-27)

### Features

* **api:** Place applets from other extensions in the tray ([0a1d2bd](https://github.com/nexaknight/BetterTrayIcons/commit/0a1d2bdf8b6bc21cfc4556c35f9da6b01136fb34))
* Pass scrolling over a tray icon to the app, make grey menu icons readable, close a flyout on a second click and stop the toggle flashing after enable ([fe7febe](https://github.com/nexaknight/BetterTrayIcons/commit/fe7febe88d4f024fb23db6c8ac1e357b45dc0f2a)), closes [#71](https://github.com/nexaknight/BetterTrayIcons/issues/71)
* Support GNOME Shell 51 ([0a93036](https://github.com/nexaknight/BetterTrayIcons/commit/0a930362e50b7085cd23f99aa80f4a5fb3a582f0))

## [3.2.4](https://github.com/nexaknight/BetterTrayIcons/compare/v3.2.3...v3.2.4) (2026-09-04)

### Bug Fixes

* **menu:** Pop a submenu out beside its item when it has no room ([e9ff943](https://github.com/nexaknight/BetterTrayIcons/commit/e9ff943b76dc1fd3fbe8668b3b6073ea62ecc40c))

## [3.2.3](https://github.com/nexaknight/BetterTrayIcons/compare/v3.2.2...v3.2.3) (2026-09-03)

### Translations

* Update Russian translation ([#66](https://github.com/nexaknight/BetterTrayIcons/issues/66)) ([2c92869](https://github.com/nexaknight/BetterTrayIcons/commit/2c92869b93af646fe3fa45178690597f64ca9906))

## [3.2.2](https://github.com/nexaknight/BetterTrayIcons/compare/v3.2.1...v3.2.2) (2026-09-02)

### Bug Fixes

* **menu:** Open tray menu submenus at any depth ([381dba2](https://github.com/nexaknight/BetterTrayIcons/commit/381dba24eb23acd5bed736a9784ed68e1d6182e7))

## [3.2.1](https://github.com/nexaknight/BetterTrayIcons/compare/v3.2.0...v3.2.1) (2026-09-02)

### Bug Fixes

* Read the D-Bus interface files without blocking the shell and drop the old settings migrations ([c4b0667](https://github.com/nexaknight/BetterTrayIcons/commit/c4b06679d205b65550533c242f2c4bdf8d228cc1))

## [3.2.0](https://github.com/nexaknight/BetterTrayIcons/compare/v3.1.3...v3.2.0) (2026-09-02)

### Features

* **api:** Register the tray as an applet that panel extensions can host and move ([7c52b37](https://github.com/nexaknight/BetterTrayIcons/commit/7c52b37475a69f2618110f97fb369c946475804c))
* **appearance:** Separate light and dark color sets per surface ([5a20448](https://github.com/nexaknight/BetterTrayIcons/commit/5a20448d502c3b60d4c650a13f16bb16cb04256a)), closes [#56](https://github.com/nexaknight/BetterTrayIcons/issues/56)
* **prefs:** Pick the tray placement on visual cards and preview styles on a fixed stage with padding and margin guides ([b1f0257](https://github.com/nexaknight/BetterTrayIcons/commit/b1f02577753e1711add7b6365a97fc60e7594348))
* **proxy:** Add desktop actions, a status line and Quit to background app icons ([a7c817f](https://github.com/nexaknight/BetterTrayIcons/commit/a7c817f9f7828152b03fb48878ec6d9d7c4a9645)), closes [#55](https://github.com/nexaknight/BetterTrayIcons/issues/55)
* **toggle:** Rotate or swap the toggle icon while the popup is open ([8a532df](https://github.com/nexaknight/BetterTrayIcons/commit/8a532df4249b06c28aadd71cdfdfa6e0ca07de4f)), closes [#54](https://github.com/nexaknight/BetterTrayIcons/issues/54)

### Bug Fixes

* **menu:** Close the gap between a menu and a bar at the bottom of the screen ([0b0495f](https://github.com/nexaknight/BetterTrayIcons/commit/0b0495f264e58c2e815b9cc397b8796cc74bbe0f))
* **menu:** Show menu icons from Qt apps, fill submenus that load on open and keep the submenu look while it collapses ([696d415](https://github.com/nexaknight/BetterTrayIcons/commit/696d415dca38cc1003a2295f41e6c0d3c27de6cf))
* **sni:** Raise the app's window when its tray icon is clicked, even on another workspace ([2be7ae6](https://github.com/nexaknight/BetterTrayIcons/commit/2be7ae6d2590a6e34a98207879ae37c2b2325763))
* **style:** Keep stock icons styled and readable inside the popup ([5570c59](https://github.com/nexaknight/BetterTrayIcons/commit/5570c594c4ec4f8cf38d69aa15f75cebe673409a))
* **toggle:** Keep the open menu in front when hovering the toggle, so the popup no longer swaps to the action menu ([a1076e6](https://github.com/nexaknight/BetterTrayIcons/commit/a1076e6cb8301cece97732c393dee070dee100fe))

### Translations

* **de:** Translate the toggle icon, color set and proxy strings ([2742168](https://github.com/nexaknight/BetterTrayIcons/commit/2742168e7838fddfcd854e23262e55acd284a7c5))

## [3.1.3](https://github.com/nexaknight/BetterTrayIcons/compare/v3.1.2...v3.1.3) (2026-09-01)

### Bug Fixes

* **style:** Drop inline styles from tray icons in stock mode ([#61](https://github.com/nexaknight/BetterTrayIcons/issues/61)) ([38a909b](https://github.com/nexaknight/BetterTrayIcons/commit/38a909b1928dacabf9fab014deaecd60da2a9363))

## [3.1.2](https://github.com/nexaknight/BetterTrayIcons/compare/v3.1.1...v3.1.2) (2026-08-27)

### Translations

* Add Simplified Chinese translation ([#59](https://github.com/nexaknight/BetterTrayIcons/issues/59)) ([3ff3e33](https://github.com/nexaknight/BetterTrayIcons/commit/3ff3e33afa7d0a55f235a01467a5e99201117d45)), closes [#58](https://github.com/nexaknight/BetterTrayIcons/issues/58)

## [3.1.1](https://github.com/nexaknight/BetterTrayIcons/compare/v3.1.0...v3.1.1) (2026-08-19)

### Translations

* Update Russian translation ([#52](https://github.com/nexaknight/BetterTrayIcons/issues/52)) ([333236d](https://github.com/nexaknight/BetterTrayIcons/commit/333236d863f30c9a1ff9abbcba18bafe695f4098))

## [3.1.0](https://github.com/nexaknight/BetterTrayIcons/compare/v3.0.6...v3.1.0) (2026-08-18)

### Features

* **dnd:** Rework drag and drop so the other icons slide aside live while you reorder ([580a499](https://github.com/nexaknight/BetterTrayIcons/commit/580a499a48cf145df5b08bbeb43a9916c05b9bec))
* **popup:** Keep the overflow menu open through context menus ([22f60e6](https://github.com/nexaknight/BetterTrayIcons/commit/22f60e63c693b3347087bdf87352ebfaa7ea6163)), closes [#49](https://github.com/nexaknight/BetterTrayIcons/issues/49)
* **style:** Add border color and width for icons, toggle and popup ([b814f20](https://github.com/nexaknight/BetterTrayIcons/commit/b814f201b4972d5d6bfec6fa0234609f77ad597a))

## [3.0.6](https://github.com/nexaknight/BetterTrayIcons/compare/v3.0.5...v3.0.6) (2026-08-02)

### Translations

* Update Russian translation ([#46](https://github.com/nexaknight/BetterTrayIcons/issues/46)) ([a93cb95](https://github.com/nexaknight/BetterTrayIcons/commit/a93cb95f280f1d594128a70a5e866913e838f017))

## [3.0.5](https://github.com/nexaknight/BetterTrayIcons/compare/v3.0.4...v3.0.5) (2026-07-30)

### Bug Fixes

* **prefs:** Show contributors missing from GitHub's cached list ([361153b](https://github.com/nexaknight/BetterTrayIcons/commit/361153b75bf9576c2b9798e122fcfee4f5f8af29))

## [3.0.4](https://github.com/nexaknight/BetterTrayIcons/compare/v3.0.3...v3.0.4) (2026-07-30)

### Translations

* Add Italian translation ([#41](https://github.com/nexaknight/BetterTrayIcons/issues/41)) ([1b32db6](https://github.com/nexaknight/BetterTrayIcons/commit/1b32db64b3cbd587d446f234e111c9b686140443))

## [3.0.3](https://github.com/nexaknight/BetterTrayIcons/compare/v3.0.2...v3.0.3) (2026-07-29)

### Bug Fixes

* **tray:** Keep multi-color status icons in their own colors and show the unread badge for apps that live only in the tray ([4046722](https://github.com/nexaknight/BetterTrayIcons/commit/404672286801f3377f8c28c63026c779ee608a46)), closes [#33](https://github.com/nexaknight/BetterTrayIcons/issues/33) [#35](https://github.com/nexaknight/BetterTrayIcons/issues/35)

## [3.0.2](https://github.com/nexaknight/BetterTrayIcons/compare/v3.0.1...v3.0.2) (2026-07-24)

### Bug Fixes

* Clean up after a failed enable instead of only logging it ([f3239e3](https://github.com/nexaknight/BetterTrayIcons/commit/f3239e3b4bddb687fe5b5a8d6ba222dea0f148e7))

## [3.0.1](https://github.com/nexaknight/BetterTrayIcons/compare/v3.0.0...v3.0.1) (2026-07-23)

### Bug Fixes

* **tray:** Keep the context menu alive when the panel auto-hides ([62ab18a](https://github.com/nexaknight/BetterTrayIcons/commit/62ab18af2665e79d149743b2a1a04d75a1fba2b3)), closes [#33](https://github.com/nexaknight/BetterTrayIcons/issues/33) [#34](https://github.com/nexaknight/BetterTrayIcons/issues/34)

## [3.0.0](https://github.com/nexaknight/BetterTrayIcons/compare/v2.4.0...v3.0.0) (2026-07-23)

### ⚠ BREAKING CHANGES

* **tray:** The tray detection core was reworked, so apps can be re-identified under new keys and settings synced from an older version may not apply cleanly. To be safe after updating, reset all settings and clear the backups under General so no stale or broken data is carried over.

### Features

* **actions:** Touch gestures and scroll to cycle icons ([20511cb](https://github.com/nexaknight/BetterTrayIcons/commit/20511cbeb06498e54ec7a5f652140ef46e89dfcb)), closes [#30](https://github.com/nexaknight/BetterTrayIcons/issues/30)
* Bundle the extension's own icon theme ([2aba319](https://github.com/nexaknight/BetterTrayIcons/commit/2aba319dfe1ff58a73db73bf6a8ea01f7d782396))
* **prefs:** Redesign the settings with a sidebar and live previews, and merge synced settings across devices ([470a996](https://github.com/nexaknight/BetterTrayIcons/commit/470a9965f79f14777b11f5660f14a8ea7fe73764))
* **shell:** Hide background apps and show proxy icons for windowless apps ([fff0954](https://github.com/nexaknight/BetterTrayIcons/commit/fff09545ad6d0b307435ec9c0336046f297a0469))
* **tray:** Give each tray item its own settings, separate snap, flatpak and AppImage builds, and add status badges ([1e52b35](https://github.com/nexaknight/BetterTrayIcons/commit/1e52b359ac9a25ee93f17c3baed9bd65879bc7d3))

### Bug Fixes

* **prefs:** Ship the SVG assets the about page renders ([11f89d1](https://github.com/nexaknight/BetterTrayIcons/commit/11f89d1273909d17192357f57fab181a619b5f4d))
* **prefs:** Stop scoped handlers from leaking their widget ([bb3d17f](https://github.com/nexaknight/BetterTrayIcons/commit/bb3d17f022ca256e081b5834ad5f698c5b7b76f5))
* **schema:** Reject out-of-range values instead of storing them ([ed36840](https://github.com/nexaknight/BetterTrayIcons/commit/ed368406ac797aba2699cb0ab3c3af1a742b4ce6))
* **sync:** Keep the settings import off the shell main loop ([1a980b5](https://github.com/nexaknight/BetterTrayIcons/commit/1a980b58297cc783c0d6fa3d2a20b9243d3ccfd3))

## [2.4.0](https://github.com/nexaknight/BetterTrayIcons/compare/v2.3.0...v2.4.0) (2026-07-12)

### Features

* **tray:** Let selected colors follow the system accent ([558a8e8](https://github.com/nexaknight/BetterTrayIcons/commit/558a8e8414c16a96d53df1beb949f502b9eca7e6)), closes [#20](https://github.com/nexaknight/BetterTrayIcons/issues/20)

## [2.3.0](https://github.com/nexaknight/BetterTrayIcons/compare/v2.2.3...v2.3.0) (2026-07-10)

### Features

* **tray:** Let a setting choose which menu opens on toggle hover ([6602996](https://github.com/nexaknight/BetterTrayIcons/commit/6602996d66730c5048c3d163263fe64364273746)), closes [#22](https://github.com/nexaknight/BetterTrayIcons/issues/22)

## [2.2.3](https://github.com/nexaknight/BetterTrayIcons/compare/v2.2.2...v2.2.3) (2026-07-08)

### Bug Fixes

* **tray:** Stop blank ghost icons from appearing when an app's bus connection drops while its icon registers ([b553039](https://github.com/nexaknight/BetterTrayIcons/commit/b553039376d82aaeb900b3d789abf864bb4bef86)), closes [#14](https://github.com/nexaknight/BetterTrayIcons/issues/14)
* **tray:** Identify Wine tray icons by launcher and prefix ([8ba83ae](https://github.com/nexaknight/BetterTrayIcons/commit/8ba83ae3d82a542ac7be917365190abeecbf5301))

## [2.2.2](https://github.com/nexaknight/BetterTrayIcons/compare/v2.2.1...v2.2.2) (2026-07-06)

### Bug Fixes

* **prefs:** Correct button alignment styling ([d18d01f](https://github.com/nexaknight/BetterTrayIcons/commit/d18d01f8e4641135f745c2755d2fcc5fd0146acf))

## [2.2.1](https://github.com/nexaknight/BetterTrayIcons/compare/v2.2.0...v2.2.1) (2026-07-05)

### Bug Fixes

* **about:** Lowercase the contributor opt-out entry ([3f7d41a](https://github.com/nexaknight/BetterTrayIcons/commit/3f7d41acde0e75be42f3af38c9b43189211b63cc))
* **tray:** Expand context menu submenus on click ([79b2d63](https://github.com/nexaknight/BetterTrayIcons/commit/79b2d6374a58b4356a9f5102408241e544fb7d6d)), closes [#11](https://github.com/nexaknight/BetterTrayIcons/issues/11)

## [2.2.0](https://github.com/nexaknight/BetterTrayIcons/compare/v2.1.0...v2.2.0) (2026-07-05)

### Features

* **i18n:** Add Russian translation ([2ad6f33](https://github.com/nexaknight/BetterTrayIcons/commit/2ad6f33b092e12c23f1ae9565b439f1ef6dcd430))

## [2.1.0](https://github.com/nexaknight/BetterTrayIcons/compare/v2.0.3...v2.1.0) (2026-07-05)

### Features

* **tray:** Add hover tooltips to XEmbed icons ([7f67c93](https://github.com/nexaknight/BetterTrayIcons/commit/7f67c9327a97ac24f4909335b50df85c6dadda91))

### Bug Fixes

* **build:** Ship the compiled gsettings schema in the release asset ([5263b55](https://github.com/nexaknight/BetterTrayIcons/commit/5263b55db867f618be4f9217e80771d099341e39)), closes [#12](https://github.com/nexaknight/BetterTrayIcons/issues/12)

## [2.0.3](https://github.com/nexaknight/BetterTrayIcons/compare/v2.0.2...v2.0.3) (2026-07-04)

### Bug Fixes

* **tray:** Apply the custom popup background to Wine and XEmbed icons on GNOME 49 and 50 ([c0fd41c](https://github.com/nexaknight/BetterTrayIcons/commit/c0fd41c881fdd028b9caf7ac07a2d20fe5fd36e5))

## [2.0.2](https://github.com/nexaknight/BetterTrayIcons/compare/v2.0.1...v2.0.2) (2026-07-04)

### Bug Fixes

* **tray:** Keep auto-hide panels visible while a context menu is open ([0b43f1d](https://github.com/nexaknight/BetterTrayIcons/commit/0b43f1dba7fd2b04000f513a5184bc5be2527419))

## [2.0.1](https://github.com/nexaknight/BetterTrayIcons/compare/v2.0.0...v2.0.1) (2026-07-04)

### Bug Fixes

* **about:** Correct the show-more card icon name ([3e4bcfb](https://github.com/nexaknight/BetterTrayIcons/commit/3e4bcfb8781de5aff1e970af03cc78bc17980adf))

### Performance Improvements

* Build the context menu's D-Bus proxy once instead of on every icon's first menu open ([9afa291](https://github.com/nexaknight/BetterTrayIcons/commit/9afa2914e8e45f4be170c29e1578a5a68c11b221))
* **prefs:** Batch factory reset and import into one transaction ([60bfb59](https://github.com/nexaknight/BetterTrayIcons/commit/60bfb5922631c49c19b15cf2092813853d84b090))
* **prefs:** Cache the system icon list across picker opens ([15686f0](https://github.com/nexaknight/BetterTrayIcons/commit/15686f0def91c4a60fcc4acf7274c59661b6d859))
* **prefs:** Coalesce applications page rebuilds ([6c8fb3d](https://github.com/nexaknight/BetterTrayIcons/commit/6c8fb3d6bfc6a223a9e54de222f1b412376249a9))
* **prefs:** Defer about page artwork until the page is shown ([16fca87](https://github.com/nexaknight/BetterTrayIcons/commit/16fca8793b3f7a40e8dcc8d87b22b8e7d4e71267))
* **prefs:** Stop the sync dialog freezing while you type a path on a network mount ([1177d86](https://github.com/nexaknight/BetterTrayIcons/commit/1177d8653125d4832329330b5376d27ecd79837f))
* **sync:** Make backup rotation and writes fully async ([1a288d8](https://github.com/nexaknight/BetterTrayIcons/commit/1a288d87c154f8fa58884a55671cf30fb91194bc))
* **tray:** Skip icon refetches for unrelated settings changes ([3286e25](https://github.com/nexaknight/BetterTrayIcons/commit/3286e253c4265e0386d0976b26272dc3545cf46c))
* **tray:** Cut D-Bus traffic and disk work per icon update ([af8ae48](https://github.com/nexaknight/BetterTrayIcons/commit/af8ae488569caae6000d4042ca719b91ef425d8b))
* **tray:** Save a reorder as one settings write ([991ffce](https://github.com/nexaknight/BetterTrayIcons/commit/991ffcef1279dfe86369bab6b667d8630bb0accf))

## [2.0.0](https://github.com/nexaknight/BetterTrayIcons/compare/v1.999.999...v2.0.0) (2026-05-14)

### ⚠ BREAKING CHANGES

* Version bump to align with EGO submission

### Features

* Align versioning with EGO submission ([bc7ab77](https://github.com/nexaknight/BetterTrayIcons/commit/bc7ab775e16be963507d6bc1f00dd749f40bae33))
* Initial release of Better Tray Icons ([1ac8ebe](https://github.com/nexaknight/BetterTrayIcons/commit/1ac8ebebc645b3080c53ae67bd54cf3eb3f8e062))

### Bug Fixes

* Read /proc and Steam manifests without blocking the shell ([a33f316](https://github.com/nexaknight/BetterTrayIcons/commit/a33f31650b1f20623cb9c6ff522569fca5b028f4))
* Keep overflow popup open when tray icon updates ([8a62426](https://github.com/nexaknight/BetterTrayIcons/commit/8a6242603c8d56f32dbfa1a4642091178e87acdc))
* Prevent signal leak and use async file IO ([4a9fcf6](https://github.com/nexaknight/BetterTrayIcons/commit/4a9fcf6a58349846655c58712ffca4c2bf921689))

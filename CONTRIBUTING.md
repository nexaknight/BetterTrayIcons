# Contributing to Better Tray Icons

Thanks for taking the time to contribute. Bug reports, translations, documentation fixes and code patches are all welcome here.

This guide covers what's in scope, how the process works and where to find detailed docs for each kind of contribution.

## Table of contents

- [Contributing to Better Tray Icons](#contributing-to-better-tray-icons)
  - [Table of contents](#table-of-contents)
  - [Code of conduct](#code-of-conduct)
  - [Types of contributions](#types-of-contributions)
    - [Welcome](#welcome)
    - [Not welcome](#not-welcome)
  - [Ground rules](#ground-rules)
  - [Your first contribution](#your-first-contribution)
  - [How to contribute](#how-to-contribute)
    - [Reporting a bug](#reporting-a-bug)
    - [Suggesting a feature](#suggesting-a-feature)
    - [Translating](#translating)
    - [Contributing code](#contributing-code)
  - [Code review process](#code-review-process)
  - [Commit and style conventions](#commit-and-style-conventions)
  - [Recognition](#recognition)
  - [Questions](#questions)
  - [License](#license)

## Code of conduct

This project follows the [GNOME Code of Conduct](https://wiki.gnome.org/Foundation/CodeOfConduct). By taking part in this repository through issues, pull requests, translations, commit messages or any other channel, you agree to it.

Reports of misconduct can be sent privately to the maintainer.

## Types of contributions

### Welcome

- Bug reports with reproduction steps and debug logs.
- Pull requests that fix bugs, improve performance, or implement features that were discussed in an issue first.
- Translations, new or improved.
- Documentation updates for the README, the wiki and inline JSDoc.
- Feedback on edge cases that are hard to catch during normal development.

### Not welcome

- Large refactors that weren't discussed first. Open an issue to align on the direction.
- PRs that bundle several unrelated changes. One topic per PR.
- Cosmetic-only changes like reformatting whole files or renaming variables without a reason.
- Re-implementations of features that already exist as a setting.
- New runtime dependencies on third-party libraries.

## Ground rules

- Be respectful.
- Be patient. Reviews can take a few days.
- For any significant change, open an issue first. It saves rewrites.
- Keep PRs small and focused.
- Make sure CI passes before opening the PR. CI runs ESLint plus the schema and translation checks.
- Shell-side code must follow the [GNOME Shell extensions review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html). The same rules apply when a release is submitted to extensions.gnome.org, so what breaks here also blocks publication.
- Wrap new user-facing strings with the `_()` gettext helper.
- No runtime dependencies on external packages.
- No AI-generated code. Using AI for learning or single-line completions is fine, but every line you submit must be code you can justify on review. The GNOME guidelines reject submissions with signs of bulk AI output like excessive boilerplate, imaginary API usage, prompt-like comments or inconsistent style, and so does this project. Have a look at the [GNOME announcement](https://blogs.gnome.org/jrahmatzadeh/2025/12/06/ai-and-gnome-shell-extensions/) for context.

## Your first contribution

If you're new to the project:

1. Set up the dev environment using the [Installation wiki page](../../wiki/Installation).
2. Browse the issue tracker. Issues labelled `documentation` or `translation` are usually a low-risk start.
3. Comment on the issue to say you're working on it so two people don't duplicate effort.
4. Fork the repo, create a feature branch from `main`, make the change.
5. Run `npm test` and confirm it passes.
6. Open a PR and link the issue.

Your first merged PR is also when your name and avatar show up in the contributor strip on the **About** tab of the extension preferences. More on that under [Recognition](#recognition).

## How to contribute

### Reporting a bug

Bug reports go in the issue tracker. The full workflow, including how to collect debug logs, is in the [Bug/Issue Reporting Guidelines](../../wiki/Bug-Issue-Reporting-Guidelines).

What a useful report needs: exact reproduction steps and your GNOME Shell and distribution versions.

### Suggesting a feature

Feature requests use a separate template. Have a look at the [Feature Request Guidelines](../../wiki/Feature-Request-Guidelines).

Describe the use case first, the proposed solution second. That way an alternative approach can be considered if it solves the same problem.

### Translating

Translations live in `po/`. Full workflow, tools and acceptance rules over at the [Translation Guidelines](../../wiki/Translation-Guidelines).

### Contributing code

Match the existing project structure when adding files. Dev setup and how to point GNOME Shell at your working tree are on the [Installation wiki page](../../wiki/Installation).

```
extension.js              # entry point loaded by gnome-shell
prefs.js                  # entry point loaded by the Adwaita preferences window
metadata.json             # extension manifest read by gnome-shell
schemas/                  # GSettings schema, compiled with glib-compile-schemas
interfaces/               # SNI / StatusNotifierWatcher / com.canonical.dbusmenu introspection XML
po/                       # translation source files, one .po per language
locale/                   # compiled .mo files generated by npm run compile-locales
assets/                   # SVG icons and logo the prefs load at runtime, shipped in the zip
media/                    # listing icon and README screenshots, not shipped in the zip
src/
├── shared/               # code reachable from both shell and prefs (logging, settings IO, app config, icon resolver)
├── shell/                # code running inside gnome-shell
│   ├── panel/            # the panel indicator with its toggle button and overflow popup
│   ├── sni/              # StatusNotifierItem source: watcher, tray icon, dbusmenu client
│   ├── xembed/           # XEmbed source for Wine and Proton apps
│   ├── backgroundAppsProxy/  # proxy icons for windowless background apps
│   ├── features/         # click controller, drag-and-drop, tooltip, background apps
│   └── utils/            # shell-side helpers (icons, dbus, actor, app ids)
└── prefs/                # code running inside the preferences window
    ├── pages/            # top-level prefs pages (general, appearance, actions, applications, about)
    ├── subpages/         # drill-down pages (overflow menu, toggle button, tray icons)
    ├── dialogs/          # dialogs (app editor, sync, icon picker, config)
    └── components/       # reusable prefs components (rows, cards, sidebar, previews)
```

Branching workflow:

1. Fork the repo on GitHub.
2. Create a feature branch from `main`. Keep it short and descriptive, like `fix-overflow-popup-position` or `add-sync-auto-import`.
3. Rebase on `main` before opening the PR so the diff stays clean.

Before opening the PR, run the test suite:

```sh
npm test
```

This validates the GSettings schema, checks the translation files and runs ESLint. PRs with failing CI won't be merged until the failures are fixed.

If your change touches strings, compile the locales locally to check that everything still builds:

```sh
npm run compile-locales
```

## Code review process

1. Once the PR is open, the maintainer reviews it within a few days.
2. Expect feedback. Reviews can ask for changes to keep things consistent.
3. Push follow-up commits to the same branch. Don't squash and force-push before review is done, that loses the discussion history.
4. Once review is done and CI is green, the PR gets merged, usually as a squash merge so `main` stays linear.
5. Your name and avatar then show up in the contributor list on the GitHub repo page and on the **About** tab of the extension.

PRs that go inactive for two weeks after review feedback without a response may be closed. They can be reopened later.

## Commit and style conventions

Conventional Commit prefixes for the subject line:

```
<type>: <short summary in the imperative>
```

Common types:

- `feat` for new features
- `fix` for bug fixes
- `i18n` for translations, new languages as well as updates
- `refactor` for changes that don't affect behavior
- `docs` for documentation only
- `style` for formatting and whitespace
- `test` for tests
- `chore` for tooling, dependencies and build scripts

Examples:

```
feat: add per-app icon override
fix: restore tooltip position when the panel is on the left
i18n: add Italian translation
docs: document the sync dialog
```

The type decides the version bump, so please use `i18n:` for translation PRs, not `feat:`. Translations ship as a patch release and get their own section in the changelog.

Keep the subject under 72 characters. The body, when present, explains the motivation, not the diff.

Code style is enforced by ESLint. Run `npm run lint` before submitting. It's also part of `npm test` and CI, so any rule violation blocks the merge.

Shell-side code also has to follow the [GNOME review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html). Common pitfalls:

- Clean teardown in `disable()`. Remove every timer (`GLib.source_remove`), disconnect every signal handler, drop GSettings bindings, restore any monkey-patched global.
- No bundled third-party libraries. The shell loads extension code into its own process.
- No synchronous I/O on the main loop. Use the `*_async` variants of `Gio.File`, `Gio.DBus` and similar APIs.
- No leaking actors, popup menus or custom CSS into the live shell after disable.

A few rules the linter and the GNOME guidelines don't explicitly cover:

- Use existing helpers in `src/shared/` and `src/prefs/components/` before introducing new abstractions.
- No runtime dependencies on external libraries. Only the dev dependencies for linting and JSDoc are allowed.
- Keep new user-facing strings translatable.

## Recognition

Contributors are listed on the **About** tab of the extension preferences. The strip shows up to five entries with GitHub avatar, username and merged commit count. If more than five people have contributed, a sixth card labelled **Show more** opens the full contributors graph on GitHub. The data comes from the [GitHub Contributors API](https://docs.github.com/en/rest/repos/repos#list-repository-contributors) at runtime.

That API only returns people with at least one commit merged into the default branch, so:

- **Opening an issue doesn't put your name in the contributor list.** Issues are tracked separately.
- **A merged PR does.** Translation PRs, documentation fixes, code patches, anything that lands in `main`. Even a one-line typo fix counts.
- **Co-authored commits count too.** Add a `Co-authored-by:` line at the bottom of the commit message and GitHub will list each named co-author.

If you'd rather not appear in the in-app list, head over to the [Contributor Opt-Out](../../wiki/Contributor‐Opt‐Out) page on the wiki.

## Questions

If anything here is unclear, open an issue with the `question` label. A written clarification beats a guess.

## License

Better Tray Icons is licensed under the [GPL v3 or later](https://github.com/nexaknight/BetterTrayIcons/blob/main/LICENSE). By submitting any contribution, you agree that your work will be released under the same license. Make sure you have the right to contribute the material under these terms.
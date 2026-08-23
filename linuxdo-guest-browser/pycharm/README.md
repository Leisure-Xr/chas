# LINUX DO Guest Browser for PyCharm

A small PyCharm tool-window plugin for reading [linux.do](https://linux.do/) without
an account.

The tool window follows the VS Code extension's compact reader layout. It includes
back and forward navigation, latest/top/category shortcuts, public topic search,
refresh, temporary topic sharing, and a compact/original page density toggle. The
last navigation requested while the guest session is being initialized is preserved.
The toolbar adapts to the tool-window width; low-frequency actions move into the
`...` menu on narrow windows.

An optional break reminder is available from the toolbar and is disabled by default.
When enabled, it waits a random 31-60 minutes before showing a compact in-page break
overlay. The overlay includes 2048, Snake, Road Dodge, Pixel Jump, and Minesweeper;
each game supports a countdown, pause/restart, keyboard and on-screen controls,
automatic pause on focus loss, increasing difficulty, and a local best score. The
game board is fitted from the tool window's live width and height, uses high-DPI
canvas rendering, and keeps the current round when the tool window is resized. There
is no audio, particle effect, vibration, or screen shake. Road Dodge uses one
continuous road with press-and-hold steering instead of discrete lanes. Reminders can
be snoozed for ten minutes or closed to continue reading.

The Share toolbar button creates an expiring code for the current public topic. The
Open Share Code button accepts a code from the clipboard or an input dialog. Codes
expire after 10 minutes, 1 hour, 24 hours, or 7 days and contain no cookies, user
agent, search state, scroll position, or reading history. They are checksummed, not
encrypted, and are not an access-control mechanism.

## Privacy behavior

- The browser starts by deleting cookies for `linux.do`.
- Login, signup, session, OAuth, and off-site main-frame navigation are blocked.
- Closing the project disposes the browser and deletes `linux.do` cookies again.
- The plugin has no credential fields or analytics. It only persists the break-reminder
  preference and one integer best score per game through PyCharm's properties service.

The embedded browser uses PyCharm's shared JCEF cookie manager. This plugin therefore
also clears any existing `linux.do` session in that PyCharm JCEF profile. It does not
touch cookies in Safari, Chrome, Firefox, or another external browser.

## Build with the installed PyCharm SDK

On macOS with PyCharm installed in `/Applications`:

```bash
./scripts/build-local.sh
./scripts/verify-package.sh
```

For another location:

```bash
PYCHARM_HOME="/path/to/PyCharm.app" ./scripts/build-local.sh
```

The installable ZIP is written to:

```text
build/distributions/linuxdo-guest-browser-pycharm-0.7.0.zip
```

Install it through **Settings > Plugins > gear menu > Install Plugin from Disk**,
then open **View > Tool Windows > LINUX DO**.

## Gradle development

`build.gradle.kts` is also included for IDE import and normal IntelliJ Platform
plugin development. Its first use can require network access to download the Gradle
plugin. The local script above is the reproducible offline packaging path used for
this project.

Gameplay references and their licenses are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No referenced source code or assets
are bundled.

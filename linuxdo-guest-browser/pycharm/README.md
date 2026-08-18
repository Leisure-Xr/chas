# LINUX DO Guest Browser for PyCharm

A small PyCharm tool-window plugin for reading [linux.do](https://linux.do/) without
an account.

The tool window follows the VS Code extension's compact reader layout. It includes
back and forward navigation, latest/top/category shortcuts, public topic search,
refresh, and a compact/original page density toggle.

## Privacy behavior

- The browser starts by deleting cookies for `linux.do`.
- Login, signup, session, OAuth, and off-site main-frame navigation are blocked.
- Closing the project disposes the browser and deletes `linux.do` cookies again.
- The plugin has no settings, credential fields, analytics, or persistent storage.

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
build/distributions/linuxdo-guest-browser-pycharm-0.3.0.zip
```

Install it through **Settings > Plugins > gear menu > Install Plugin from Disk**,
then open **View > Tool Windows > LINUX DO**.

## Gradle development

`build.gradle.kts` is also included for IDE import and normal IntelliJ Platform
plugin development. Its first use can require network access to download the Gradle
plugin. The local script above is the reproducible offline packaging path used for
this project.

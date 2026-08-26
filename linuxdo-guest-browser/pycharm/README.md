# LINUX DO Guest Browser for PyCharm

A small PyCharm tool-window plugin for reading [linux.do](https://linux.do/) without
an account.

## Download the published build

- [PyCharm 0.10.0 ZIP](https://github.com/Leisure-Xr/chas/raw/pycharm-v0.10.0/linuxdo-guest-browser/dist/linuxdo-guest-browser-pycharm-0.10.0.zip)
- Source for this build: [tag `pycharm-v0.10.0`](https://github.com/Leisure-Xr/chas/tree/pycharm-v0.10.0)
- SHA-256: `180e8c2a1dfb36b3618d8721c3e486cf95ba3ad671507e568342adab5ffeee42`

The tool window defaults to a responsive demo layout that presents public lists and
topics like IDE documentation and code samples, with a file tab, line-number gutter,
monospaced metadata, and light/dark theme support. The original site layout remains
available from the `</>` toggle. It includes back and forward navigation,
latest/top/category shortcuts, public topic search, refresh, temporary topic sharing,
and a visible history popup. The last navigation requested while the guest session is
being initialized is preserved. The toolbar adapts to the tool-window width: below
about 520 px, navigation and search use separate rows; below about 360 px, the top
row always keeps Back, Refresh, and `...`, while history, games, sharing, import,
help, and session reset remain available from that menu.

The responsive history popup keeps up to 60 recent public pages across IDE restarts.
Each row shows its page title, public `linux.do` URL, and visit time. The popup can
filter by title or URL, reopen a page, copy its URL, or clear the complete local
history. Topic floor URLs are collapsed into one canonical topic entry; Cloudflare
challenge URLs are discarded, and common site suffixes are removed from titles. A
title that arrives after JCEF finishes loading updates the existing entry without
changing its visit time. Existing saved history is cleaned on the next plugin start.

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

The Share toolbar button encrypts the current public topic with a password chosen by
the user. The compact form includes four expiry presets, password confirmation, and
a 20-character strong-password generator. The receiving plugin asks only for the
encrypted share content and the same password. Passwords are never stored. Shares
contain no cookies, user agent, search state, scroll position, or reading history.

## 临时分享码教程

1. 在工具窗口中打开一个公开主题，点击“分享”。
2. 选择有效期，填写并确认至少 12 个字符的密码；也可以生成 20 位强密码。
3. 插件复制加密分享内容。把它发给对方，并通过另一渠道告知密码。
4. 对方点击“打开分享码”，粘贴分享内容并输入相同密码。
5. 窄窗口可在 `...` 菜单中找到“临时分享码使用说明”。

主题、标题、生成时间和过期时间均使用 AES-256-GCM 加密。密码先做 NFKC 规范化，再经随机 16 字节盐和 600,000 次 PBKDF2-HMAC-SHA256 派生 256 位密钥；每次分享还会生成独立的 12 字节 nonce。密码不写入分享内容或插件存储。只有分享内容而没有密码，即使知道算法和源码也无法直接还原主题。

请使用不易猜测的密码，并与加密分享内容分渠道发送。同时取得分享内容和密码的人仍可解密，弱密码也可能被离线猜测。内部格式标识无需手动处理，旧版未加密分享内容会被拒绝。到期后插件拒绝导入，但不能撤回已经打开或另行保存的公开 URL。

## Privacy behavior

- The browser starts by deleting cookies for `linux.do`.
- Login, signup, session, OAuth, and off-site main-frame navigation are blocked.
- Closing the project disposes the browser and deletes `linux.do` cookies again.
- The plugin has no credential fields or analytics. It persists the demo-mode and
  break-reminder preferences, one integer best score per game, and up to 60 public
  history entries through PyCharm's properties service. History never contains
  cookies or login state and can be cleared from its toolbar menu.

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
build/distributions/linuxdo-guest-browser-pycharm-0.10.0.zip
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

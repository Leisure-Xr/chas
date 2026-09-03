# Chas 插件仓库

这个仓库用于存放个人开发的 IDE 插件、编辑器扩展及相关工具。每个插件使用独立目录维护源码、构建说明和可安装文件。

## 插件列表

| 插件 | 平台 | 简介 | 项目地址 |
| --- | --- | --- | --- |
| LINUX DO 游客阅读器 | VS Code、PyCharm | 无需登录，以游客身份在 IDE 中浏览 LINUX DO | [linuxdo-guest-browser](linuxdo-guest-browser/) |

## LINUX DO 游客阅读器

支持游客浏览公开主题、Cloudflare 手动请求档案验证、主题续载、浏览历史、限时加密分享、可选休息提醒和五个内置小游戏，不保存论坛登录凭据。VS Code 使用平滑令牌桶控制公开接口节奏；PyCharm 提供正文图片之外全单色的隐私阅读布局。

- [插件源码与使用说明](linuxdo-guest-browser/)
- [GitHub Release 0.2.0 下载页](https://github.com/Leisure-Xr/chas/releases/tag/0.2.0)
- [VS Code 安装包说明](linuxdo-guest-browser/README.md#vs-code)
- [PyCharm 安装包说明](linuxdo-guest-browser/README.md#pycharm)

当前主分支还提供了尚未单独发布的验证构建包：

- [VS Code 0.16.0 VSIX](linuxdo-guest-browser/dist/linuxdo-guest-browser-vscode-0.16.0.vsix)：默认使用 VS Code 内置 Chromium 请求引擎。
- [PyCharm 0.11.0 ZIP](linuxdo-guest-browser/dist/linuxdo-guest-browser-pycharm-0.11.0.zip)：精修单色隐私阅读布局，帖子正文图片保持原色。

两个验证包的 SHA-256 和安装说明见 [插件使用说明](linuxdo-guest-browser/README.md)。

## 仓库结构

```text
chas/
└── linuxdo-guest-browser/
    ├── vscode/
    ├── pycharm/
    └── dist/
```

后续插件会继续以独立目录加入插件列表。

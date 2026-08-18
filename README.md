# Chas Plugins

这个仓库用于存放个人开发的 IDE 插件、编辑器扩展及相关工具。每个插件使用独立目录维护源码、构建说明和可安装文件。

## 插件列表

| 插件 | 平台 | 简介 | 项目地址 |
| --- | --- | --- | --- |
| LINUX DO Guest Browser | VS Code、PyCharm | 无需登录，以游客身份在 IDE 中浏览 LINUX DO | [linuxdo-guest-browser](linuxdo-guest-browser/) |

## LINUX DO Guest Browser

支持游客浏览公开主题、Cloudflare 验证、主题续载和浏览历史，不保存论坛登录凭据。

- [插件源码与使用说明](linuxdo-guest-browser/)
- [下载 VS Code 0.6.0](linuxdo-guest-browser/dist/linuxdo-guest-browser-vscode-0.6.0.vsix)
- [下载 PyCharm 0.3.0](linuxdo-guest-browser/dist/linuxdo-guest-browser-pycharm-0.3.0.zip)

## 仓库结构

```text
chas/
└── linuxdo-guest-browser/
    ├── vscode/
    ├── pycharm/
    └── dist/
```

后续插件会继续以独立目录加入插件列表。

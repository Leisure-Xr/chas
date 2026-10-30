# Chas 插件仓库

在 IDE 中以游客身份阅读公开论坛内容，无需论坛账号。

| 平台 | 当前版本 | 支持站点 | 安装与使用 |
| --- | --- | --- | --- |
| VS Code | 0.19.0 | LINUX DO | [VS Code 说明](linuxdo-guest-browser/vscode/README.md) |
| PyCharm | 16.3 | LINUX DO、NodeSeek、V2EX、IDC Flare | [PyCharm 说明](linuxdo-guest-browser/pycharm/README.md) |

[下载安装包与校验值](linuxdo-guest-browser/README.md#下载)。`dist/` 只保留当前版本；历史源码、文档和安装包可在 Git 历史中查看。

两个插件都支持公开主题阅读、本地历史与收藏、密码加密分享、可选休息提醒和五款小游戏。PyCharm 提供跟随 IDE 主题的隐私阅读布局；VS Code 提供公开接口限速、图片代理和已读页面缓存。

## 开发入口

- [项目说明与构建命令](linuxdo-guest-browser/README.md)
- [兼容性测试与验证记录](linuxdo-guest-browser/qa/README.md)
- [VS Code 更新记录](linuxdo-guest-browser/vscode/CHANGELOG.md)

```text
linuxdo-guest-browser/
├── vscode/     # VS Code 扩展
├── pycharm/    # PyCharm 插件
├── shared/     # 两个平台共用的游戏源码
├── qa/         # 测试用例、夹具与历史验证记录
└── dist/       # 当前可安装包
```

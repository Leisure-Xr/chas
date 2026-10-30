# 论坛游客阅读器

在 VS Code 和 PyCharm 中以游客身份浏览公开论坛内容，无需论坛账号。VS Code 支持 [LINUX DO](https://linux.do/)；PyCharm 还支持 [NodeSeek](https://www.nodeseek.com/)、[V2EX](https://www.v2ex.com/) 和 [IDC Flare](https://idcflare.com/)。

## 下载

`dist/` 只保留当前版本安装包。旧版源码、文档和安装包可在 Git 历史中查看；[GitHub Release 0.2.0](https://github.com/Leisure-Xr/chas/releases/tag/0.2.0) 是历史版本。

| 平台 | 版本 | 安装包 | SHA-256 |
| --- | --- | --- | --- |
| VS Code | 0.19.0 | [下载 VSIX](dist/linuxdo-guest-browser-vscode-0.19.0.vsix) | `3d83c65888a67f171997c570ab2f1c95e9cf28246853ab2947a967a68114bd8e` |
| PyCharm | 16.3 | [下载 ZIP](dist/linuxdo-guest-browser-pycharm-16.3.zip) | `6e5c31b7e4ada0c7fa261034f6eaa74cb009cf270254465c7e749d71a9a640af` |

校验下载文件：Windows 使用 `certutil -hashfile <文件> SHA256`，macOS/Linux 使用 `shasum -a 256 <文件>`。

### VS Code

在扩展面板中选择 **Install from VSIX...**，安装 VSIX 文件。扩展最低支持 VS Code 1.85；默认优先使用内置浏览器的请求引擎需要 VS Code 1.114 或更新版本，旧版使用手动参数引擎。

支持列表与帖子续载、搜索、历史与收藏、限速请求和已读内容缓存。头像默认关闭，正文图片由扩展按需代理。内置浏览器空闲后释放，下次使用可能需要重新完成站点验证。

完整功能、设置与验证教程见 [VS Code 使用说明](vscode/README.md)，版本变化见 [更新记录](vscode/CHANGELOG.md)。

### PyCharm

在 **Settings > Plugins > 齿轮菜单 > Install Plugin from Disk...** 中选择 ZIP 并重启，安装时无需解压。打开 **View > Tool Windows > 论坛游客阅读器**，从“⋯ > 切换论坛”选择站点。

16.3 修复 LINUX DO 等站点反复停在 Cloudflare 验证页：插件不再给页面导航挂请求处理器（挂上后每次导航都被要求验证，刚拿到的验证结果也不被承认），也不再往验证页里执行任何脚本；首次启动的导航不再丢失并误报加载超时，刷新与重试改为重新加载去掉验证参数的地址。加密分享扩展到 NodeSeek、V2EX 和 IDC Flare。识别到验证页即显示验证状态及轮次；等待期间保留真实网页，并提供重新验证、停止验证和在浏览器打开操作。

声明支持 PyCharm 2022.3–2026.3（构建号 `223–263.*`），需要带 JCEF 的 JetBrains Runtime。声明范围不代表所有版本均完成 GUI 验收，实际范围见 [PyCharm 验证记录](qa/docs/pycharm-validation.md)。功能、数据行为及故障处理见 [PyCharm 使用说明](pycharm/README.md)。

## 共同功能

- 最近 60 条公开页面历史及本地收藏目录，支持搜索与重新打开。
- 公开主题可用密码加密分享，期限为 10 分钟至 7 天。LINUX DO 主题的分享两平台互通；PyCharm 另可分享 NodeSeek、V2EX 和 IDC Flare 主题，需用 PyCharm 16.3 或更新版本打开。密码与分享内容应分开发送；到期后拒绝导入，但无法撤回已经打开的公开 URL。
- 默认关闭的休息提醒，开启后随机等待 31–60 分钟；可延后 10 分钟或进入 2048、贪吃蛇、单道路赛车、像素跳跃、扫雷。

## 构建和测试

以下命令从 `linuxdo-guest-browser/` 执行：

```bash
# VS Code
npm --prefix vscode run check
npm --prefix vscode run package

# PyCharm：macOS，默认使用 /Applications/PyCharm.app 的 SDK
bash pycharm/scripts/build-local.sh
bash pycharm/scripts/verify-package.sh

# 两平台的 QA 与制品检查
npm --prefix qa ci
npm --prefix qa run check
```

VS Code 打包会按需下载官方 `vsce` 工具。PyCharm 可通过 `PYCHARM_HOME` 指定已安装的 SDK；本地构建会执行 Java 回归测试和源码资源一致性校验。

[QA 说明](qa/README.md) 包含隔离 IDE、布局检查、矩阵测试及发布门禁。`shared/` 是游戏源码来源，修改后需同步两平台副本并通过共享资源检查。

## 隐私与数据

不要求或保存论坛账号、密码，不包含遥测代码。历史与收藏保存公开 URL、标题和时间，不保存帖子正文或登录凭据。加密分享不包含 Cookie 或请求档案，分享密码不落盘。

VS Code 的手动请求档案通过 SecretStorage 保存白名单游客参数；已读公开 JSON 可按设置缓存至本地，正文图片仅缓存在内存。PyCharm 在游客会话开始、重置及结束时清理受支持论坛的 JCEF Cookie，同一 JCEF 库里的其他站点及外部浏览器不受影响。具体存储范围见各平台使用说明。

本项目与上述论坛官方无隶属关系。使用时请遵守站点服务条款和访问频率限制。

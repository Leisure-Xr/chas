# LINUX DO Guest Browser

在 VS Code 和 PyCharm 中以游客身份浏览 [LINUX DO](https://linux.do/)。无需论坛账号，不保存登录凭据。

## 下载

- [VS Code 0.13.0](dist/linuxdo-guest-browser-vscode-0.13.0.vsix)
- [PyCharm 0.9.0](dist/linuxdo-guest-browser-pycharm-0.9.0.zip)

### VS Code

打开扩展面板，选择右上角菜单中的 `Install from VSIX...`，然后选择 VSIX 文件。

VS Code 版使用公开 Discourse JSON 接口，支持列表续页、主题续载、页面状态恢复和 Cloudflare 游客验证。请求经过单并发队列、最小间隔和短期内存缓存，403/429 后会停止联网一段时间，避免连续刷新加重站点限制。最近 60 条成功打开的公开页面会记录标题、URL 和访问时间，可搜索、重新打开、复制 URL 或全部清除；同一主题的不同楼层会合并，Cloudflare 挑战地址不会写入历史。验证设置页只支持手动填写 Cookie 与 User-Agent，不会启动、控制或读取 Chrome、Edge、Brave 等外部浏览器。参数会从你复制的 Request Headers 中解析，并通过 `/latest.json` 测试后才会保存；完整的 Windows DevTools 获取步骤和示意图见 [VS Code 说明](vscode/README.md)。

### PyCharm

打开 `Settings > Plugins > gear icon > Install Plugin from Disk...`，选择 ZIP 文件并重启 PyCharm。不要解压 ZIP。

PyCharm 版使用内嵌 JCEF 浏览器，默认采用接近 IDE 文档与代码示例的演示布局，可随时切回原网页。工具栏提供最新、热门、分类、搜索、分享、刷新和浏览历史；自适应历史弹窗显示最近 60 条公开页面的标题、URL 与访问时间，支持搜索、打开、复制 URL 和全部清除。旧历史会自动合并同一主题的楼层记录、移除 Cloudflare 挑战项并清理站点标题后缀。启动清理 Cookie 期间点击导航也会保留最后一次请求，不再固定跳回最新页。

### 休息提醒与小游戏

两个版本都提供默认关闭的休息提醒开关。开启后会随机等待 31–60 分钟，再显示可跳过或延后 10 分钟的休息提示。五款小游戏使用同一套玩法核心，支持自适应棋盘和高 DPI Canvas、倒计时、暂停、重新开始、键盘/屏幕控制、失焦自动暂停和本地最高分；调整 IDE 或工具窗口大小不会重置当前游戏，不含音效、粒子或震动。

### 限时分享

1. 在任一插件中打开一个公开主题，点击“分享”，选择 10 分钟、1 小时、24 小时或 7 天。
2. 插件把 `LDGS1` 分享码复制到剪贴板；把完整分享码发给对方。
3. 对方在 VS Code 或 PyCharm 插件中选择“打开临时分享码”，粘贴后即可打开同一公开主题。

分享码仅包含版本、主题编号、slug、标题、生成时间和过期时间，不包含 Cookie、UA、列表状态或阅读历史。格式为 `LDGS1.<Base64URL 载荷>.<SHA-256 校验和>`：Base64URL 只是编码，不是加密；插件不会“解密”。末尾 16 个十六进制字符是 SHA-256 的前 8 字节，用于发现损坏或修改，不使用盐或秘密密钥。固定盐或把密钥写进公开插件也无法提供保密性，因为任何人都能从插件中取出它。到期后插件拒绝导入，但不能撤回已经打开或另行保存的公开 URL。

## 源码

- [`vscode/`](vscode/)：VS Code 扩展
- [`pycharm/`](pycharm/)：PyCharm 插件

## 构建

VS Code：

```bash
cd vscode
npm run check
npm run package
```

`npm run package` 会按需通过 `npx` 下载官方 VS Code 打包工具，不会在仓库中保存依赖目录。

PyCharm（macOS，使用已安装的 PyCharm SDK）：

```bash
cd pycharm
./scripts/build-local.sh
./scripts/verify-package.sh
```

可以通过 `PYCHARM_HOME` 指定其他 PyCharm 安装位置。

## 隐私

- 不要求或保存论坛账号、密码和登录令牌。
- VS Code 仅保存游客验证白名单 Cookie，使用 SecretStorage 加密存储。
- PyCharm 会清理其 JCEF 配置中的 `linux.do` Cookie，不影响系统浏览器。
- 两个插件最多保存最近 60 条公开页面的标题、URL 和访问时间；历史界面可复制 URL 或一键清除。
- 游戏只保存休息提醒开关和五款游戏的最高分整数，不记录游戏过程或使用时长。
- 不包含分析、遥测或广告代码。

本项目与 LINUX DO 官方无隶属关系。使用时请遵守站点服务条款和访问频率限制。

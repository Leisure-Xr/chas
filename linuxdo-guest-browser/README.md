# LINUX DO Guest Browser

在 VS Code 和 PyCharm 中以游客身份浏览 [LINUX DO](https://linux.do/)。无需论坛账号，不保存登录凭据。

## 下载

当前稳定包统一发布在 GitHub Release [`0.1.0`](https://github.com/Leisure-Xr/chas/releases/tag/0.1.0)，进入发布页后下载对应附件：

| IDE | 插件版本 | Release 下载页 | 安装包 | SHA-256 |
| --- | --- | --- | --- | --- |
| VS Code | `0.14.0` | [打开 Release](https://github.com/Leisure-Xr/chas/releases/tag/0.1.0) | `linuxdo-guest-browser-vscode-0.14.0.vsix` | `f0412659150731df192639f0a4627f51188e82ffd300d143854e2826ffd96c71` |
| PyCharm | `0.10.0` | [打开 Release](https://github.com/Leisure-Xr/chas/releases/tag/0.1.0) | `linuxdo-guest-browser-pycharm-0.10.0.zip` | `180e8c2a1dfb36b3618d8721c3e486cf95ba3ad671507e568342adab5ffeee42` |

两个安装包都附在同一个 Release 中。下载后可用
`certutil -hashfile <文件> SHA256`（Windows）或 `shasum -a 256 <文件>`（macOS/Linux）核对完整性。

### VS Code

打开扩展面板，选择右上角菜单中的 `Install from VSIX...`，然后选择 VSIX 文件。

VS Code 版使用公开 Discourse JSON 接口，支持列表续页、主题续载、页面状态恢复和 Cloudflare 游客验证。请求经过单并发队列、两次短突发的自适应节奏和短期内存缓存；快速切页时尚未发送的旧请求会取消，403/429 后会停止联网并逐级降速，避免连续刷新加重站点限制。最近 60 条成功打开的公开页面会记录标题、URL 和访问时间，可搜索、重新打开、复制 URL 或全部清除；同一主题的不同楼层会合并，Cloudflare 挑战地址不会写入历史。验证设置页只支持手动填写 Cookie 与 User-Agent，不会启动、控制或读取 Chrome、Edge、Brave 等外部浏览器。参数会从你复制的 Request Headers 中解析，并通过 `/latest.json` 测试后才会保存；完整的 Windows DevTools 获取步骤和示意图见 [VS Code 说明](vscode/README.md)。

### PyCharm

打开 `Settings > Plugins > gear icon > Install Plugin from Disk...`，选择 ZIP 文件并重启 PyCharm。不要解压 ZIP。

PyCharm 版使用内嵌 JCEF 浏览器，默认采用接近 IDE 文档与代码示例的演示布局，可随时切回原网页。工具栏提供最新、热门、分类、搜索、分享、刷新和浏览历史；自适应历史弹窗显示最近 60 条公开页面的标题、URL 与访问时间，支持搜索、打开、复制 URL 和全部清除。旧历史会自动合并同一主题的楼层记录、移除 Cloudflare 挑战项并清理站点标题后缀。启动清理 Cookie 期间点击导航也会保留最后一次请求，不再固定跳回最新页。

### 休息提醒与小游戏

两个版本都提供默认关闭的休息提醒开关。开启后会随机等待 31–60 分钟，再显示可跳过或延后 10 分钟的休息提示。五款小游戏使用同一套玩法核心，支持自适应棋盘和高 DPI Canvas、倒计时、暂停、重新开始、键盘/屏幕控制、失焦自动暂停和本地最高分；调整 IDE 或工具窗口大小不会重置当前游戏，不含音效、粒子或震动。

### 限时分享

1. 在任一插件中打开一个公开主题，点击“分享”，选择 10 分钟、1 小时、24 小时或 7 天。
2. 填写并确认至少 12 个字符的分享密码，也可以让插件生成 20 位强密码。
3. 插件自动复制加密分享内容。把它发给对方，并通过另一渠道告诉对方分享密码。
4. 对方选择“打开临时分享码”，粘贴分享内容并输入相同密码即可。

主题编号、slug、标题、生成时间和过期时间全部经过 AES-256-GCM 加密，不包含 Cookie、UA、列表状态或阅读历史。密码经每次随机生成的 16 字节盐和 600,000 次 PBKDF2-HMAC-SHA256 派生 AES 密钥，密码本身不会进入分享内容或插件存储。中间人只有分享内容、即使知道算法和全部源码，也无法直接还原主题；盐是公开的防预计算参数，不是密码。

请使用不易猜测的密码，并与加密分享内容分渠道发送。如果中间人同时取得分享内容和密码，或密码过于简单，纯客户端插件无法继续保密。内部格式标识由插件自动生成，无需手动填写或理解。旧版未加密分享内容会被拒绝。到期后插件拒绝导入，但不能撤回已经打开或另行保存的公开 URL。

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

# LINUX DO 游客阅读器

在 VS Code 和 PyCharm 中以游客身份浏览 [LINUX DO](https://linux.do/)。无需论坛账号，不保存登录凭据。

## 下载

当前稳定包统一发布在 GitHub Release [`0.2.0`](https://github.com/Leisure-Xr/chas/releases/tag/0.2.0)，进入发布页后下载对应附件：

| IDE | 插件版本 | Release 下载页 | 安装包 | SHA-256 |
| --- | --- | --- | --- | --- |
| VS Code | `0.15.0` | [打开 Release](https://github.com/Leisure-Xr/chas/releases/tag/0.2.0) | `linuxdo-guest-browser-vscode-0.15.0.vsix` | `15671e2771b724b9a794b043311e8642328c42cc8cc22eb20228f3d7f9583f02` |
| PyCharm | `0.11.0` | [打开 Release](https://github.com/Leisure-Xr/chas/releases/tag/0.2.0) | `linuxdo-guest-browser-pycharm-0.11.0.zip` | `4af206f29e430eb34710b7b763359c8f95111ce514c6d9d4795cdfabe65e015d` |

两个安装包都附在同一个 Release 中。下载后可用
`certutil -hashfile <文件> SHA256`（Windows）或 `shasum -a 256 <文件>`（macOS/Linux）核对完整性。

### VS Code

打开扩展面板，选择右上角菜单中的 `Install from VSIX...`，然后选择 VSIX 文件。

VS Code 版使用公开 Discourse JSON 接口，支持列表续页、主题续载、页面状态恢复和 Cloudflare 游客验证。请求可选智能、流畅、均衡和稳妥四档，始终单并发；平滑令牌桶取代 60 秒本地硬窗口，正常导航优先于续载，尚未发送的旧导航会取消。只有明确的 429、`Retry-After` 或限流标记才进入服务器冷却；`0.15.1` 起，challenge 与无标记 403 不再被单次判定为档案失效，而是使用最多 30 秒的独立短退避并保留现有页面。最近 60 条公开页面历史可搜索、重新打开、复制 URL 或全部清除。验证页支持粘贴同一次 `/latest.json` 的完整 Request Headers 或 Chrome、Edge、Brave 的 Copy as cURL，也可同时手动填写 Cookie 与 User-Agent；插件不会启动、控制或读取外部浏览器。完整的 Windows DevTools 步骤、接口差异表和示意图见 [VS Code 说明](vscode/README.md)。

### PyCharm

打开 `Settings > Plugins > gear icon > Install Plugin from Disk...`，选择 ZIP 文件并重启 PyCharm。不要解压 ZIP。

PyCharm 版使用内嵌 JCEF 浏览器，默认采用自适应的单色隐私阅读布局，可从“…”菜单切回原始网页。隐私布局删除伪代码、行号和示例标签，隐藏正文外的图片、SVG、视频、头像、徽章、表情、用户卡与身份装饰，并将标题、标签、链接、状态和纯用户名统一为 IDE 黑白灰；帖子正文里的截图、附件、Onebox 和技术图片保持原色。固定顶栏只保留返回、前进、刷新和“…”；最新、热门、分类及搜索位于导航行，历史、提醒、游戏、分享、导入、教程、布局切换和重置会话只放在“…”菜单。自适应历史弹窗显示最近 60 条公开页面的标题、URL 与访问时间，支持搜索、打开、复制 URL 和全部清除。

### 休息提醒与小游戏

两个版本都提供默认关闭的休息提醒开关。开启后会随机等待 31–60 分钟，再显示可跳过或延后 10 分钟的休息提示。五款小游戏使用同一套玩法核心，支持自适应棋盘和高 DPI Canvas、倒计时、暂停、重新开始、键盘/屏幕控制、失焦自动暂停和本地最高分；调整 IDE 或工具窗口大小不会重置当前游戏，不含音效、粒子或震动。

### 限时分享

1. 在任一插件中打开一个公开主题，点击“分享”，选择 10 分钟、1 小时、24 小时或 7 天。
2. 填写并确认至少 12 个字符的分享密码，也可以让插件生成 20 位强密码。
3. 插件自动复制加密分享内容；生成强密码后可直接复制密码，也可在生成完成后重新复制分享内容或密码。把两者通过不同渠道发送。
4. 对方选择“打开加密分享”，粘贴分享内容并输入相同密码即可。

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
- VS Code 使用 SecretStorage 保存原子游客请求档案，只包含白名单 Cookie、User-Agent、允许的客户端提示、来源与验证状态。
- PyCharm 会清理其 JCEF 配置中的 `linux.do` Cookie，不影响系统浏览器。
- 两个插件最多保存最近 60 条公开页面的标题、URL 和访问时间；历史界面可复制 URL 或一键清除。
- 游戏只保存休息提醒开关和五款游戏的最高分整数，不记录游戏过程或使用时长。
- 不包含分析、遥测或广告代码。

本项目与 LINUX DO 官方无隶属关系。使用时请遵守站点服务条款和访问频率限制。

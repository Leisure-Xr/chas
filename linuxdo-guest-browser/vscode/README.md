# LINUX DO 游客阅读器

在 VS Code 中浏览 `linux.do` 的公开内容，无需登录。

## 功能

- 查看最新主题、热门主题和站点分类
- 搜索公开主题
- 可选的随机休息提醒（31–60 分钟），默认关闭
- 内置 2048、贪吃蛇、车道闪避、像素跳跃和扫雷
- 五款游戏统一支持开始倒计时、暂停、重新开始、屏幕控制、失焦自动暂停和本地最高分
- 为当前公开主题生成 10 分钟至 7 天有效的跨插件分享码
- 在 VS Code 内阅读帖子
- 使用返回按钮或 `Alt+左箭头` 回到上一个列表、分类或搜索结果
- 返回时保留此前已加载的主题、帖子和滚动位置
- 首页、热门和分类列表滚动到底自动续页
- 长主题滚动到底自动续载，每批最多加载 20 条帖子
- 默认使用紧凑信息流，可从工具栏切换显示密度
- 在系统浏览器中打开原文或外部链接
- 不读取日常浏览器数据，仅加密保存游客验证白名单 Cookie；不保存账号、密码或登录令牌

## 遇到 Cloudflare 403

1. 在命令面板执行 `LINUX DO: 设置 Cloudflare 验证`，打开独立设置页。
2. 选择 Cookie 来源浏览器，填写完整 Cookie 与该浏览器的 User-Agent。
3. 点击“保存并验证”。扩展会在所选浏览器的独立临时会话中注入参数并读取 `/latest.json`。
4. 校验成功后参数才会写入 SecretStorage，浏览器窗口随后最小化；校验失败不会覆盖此前可用参数。

设置页不会回显已保存 Cookie，输入框留空表示保留原值，并提供“清除 Cookie”“清除 User-Agent”和“全部清除”。任一清除操作都会停止当前游客浏览器。手动参数不便获取时，可点击“自动验证（备用）”并在独立浏览器窗口中完成 Cloudflare 验证。

临时窗口使用全新的浏览器配置，不继承日常浏览器的登录状态。验证通过后，该浏览器会在阅读器使用期间保持最小化运行，最新、热门、分类、搜索、主题和续页请求都会在同一个已验证浏览器会话中执行。关闭阅读器、退出 VS Code 或执行 `LINUX DO: 清除 Cloudflare 验证` 时，扩展会结束浏览器进程并删除临时配置目录。

自动模式只保存 Cloudflare 字段、`_bypass_cache` 和临时窗口生成的匿名 `_forum_session`；不会保存 `_t`、`auth_token`、`remember_user_token` 等登录凭据。验证结果保存在 VS Code 的 SecretStorage 中。如果浏览器被手动关闭或 Cloudflare 再次要求验证，阅读器会显示“更新验证”，点击后即可重新连接。

浏览器选择支持自动、Google Chrome、Microsoft Edge、Brave 和 Chromium。

### Windows 手动填写方法

1. 使用 Chrome、Edge 或 Brave 打开 `https://linux.do/latest` 并完成 Cloudflare 验证。
2. 按 `F12`（部分电脑需要 `Fn+F12`），打开“应用/Application”面板。
3. 展开“存储/Storage”→“Cookie”→`https://linux.do`，找到 `cf_clearance`，双击并复制它的“值/Value”；也可以从“网络/Network”的请求标头中复制整段 `cookie`。
4. 打开“网络/Network”面板并刷新页面，选择第一个 `linux.do` 文档请求。
5. 在“标头/Headers”→“请求标头/Request Headers”中复制 `user-agent` 的完整值。
6. 回到 VS Code 的验证设置页，选择同一个来源浏览器，粘贴 Cookie 和 User-Agent 后点击“保存并验证”。

也可以在浏览器“控制台/Console”输入 `navigator.userAgent` 获取 User-Agent。Cookie 和 User-Agent 必须来自同一个浏览器，并与设置页选择的浏览器一致；若校验提示不一致，请改正浏览器选择或改用自动验证。

即使粘贴整段 Cookie，手动模式也只保留 `cf_clearance`、`__cf_bm`、`__cfuvid`、`_cfuvid`、`_bypass_cache`，以及未检测到登录标记时的匿名 `_forum_session`。Stripe 字段始终丢弃；如果检测到 `_t`、`remember_user_token` 或 `auth_token`，论坛会话也会被丢弃。

## 使用

安装扩展后，点击活动栏中的 LINUX DO 图标，选择“最新主题”“热门主题”或“浏览分类”。也可以打开命令面板，执行 `LINUX DO: 打开游客阅读器`。

阅读器工具栏中的时钟按钮用于开启或关闭休息提醒，方格按钮可以随时打开小游戏。也可以在 VS Code 设置中搜索 `LINUX DO 休息提醒` 修改开关。提醒开启后会随机等待 31–60 分钟；选择“10 分钟后提醒”只会执行一次短暂延后。

打开主题后，工具栏分享按钮或命令 `LINUX DO: 分享当前主题` 可生成限时分享码并复制到剪贴板。使用 `LINUX DO: 打开临时分享码` 可从剪贴板读取或手动粘贴分享码。分享码不是加密链接，只用于校验内容完整性和插件内过期时间。

小游戏参考成熟开源项目的玩法与交互并采用独立实现，不下载外部代码、音效或素材；详情见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。插件只保存每款游戏的最高分整数，不保存进行中的游戏。

此扩展通过站点公开的 Discourse JSON 接口读取游客可见内容。站点临时不可用、限制公开接口或要求人机验证时，扩展会显示相应错误。

## 本地开发

1. 用 VS Code 打开本目录。
2. 按 `F5` 启动 Extension Development Host。
3. 执行 `npm run check` 做语法检查。
4. 执行 `npm run package`，通过 `npx` 按需使用官方打包工具生成 VSIX。

本项目与 LINUX DO 官方无隶属关系。请遵守站点服务条款和访问频率限制。

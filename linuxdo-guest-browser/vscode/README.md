# LINUX DO 游客阅读器

在 VS Code 中浏览 `linux.do` 的公开内容，无需登录。

## 功能

- 查看最新主题、热门主题和站点分类
- 搜索公开主题
- 在 VS Code 内阅读帖子
- 使用返回按钮或 `Alt+左箭头` 回到上一个列表、分类或搜索结果
- 返回时保留此前已加载的主题、帖子和滚动位置
- 首页、热门和分类列表滚动到底自动续页
- 长主题滚动到底自动续载，每批最多加载 20 条帖子
- 默认使用紧凑信息流，可从工具栏切换显示密度
- 在系统浏览器中打开原文或外部链接
- 不读取、不发送、不保存 Cookie、账号、令牌和密码

## 遇到 Cloudflare 403

1. 在命令面板执行 `LINUX DO: 设置 Cloudflare 验证`。
2. 选择“自动验证”。
3. 扩展会打开一个独立的临时 Chrome 窗口；在窗口中完成人机验证即可。
4. 扩展检测到验证结果后会自动回填、关闭临时窗口并重新加载内容。

临时窗口使用全新的浏览器配置，不继承日常浏览器的登录状态。自动模式只读取 Cloudflare 字段、`_bypass_cache` 和临时窗口刚刚生成的匿名 `_forum_session`；不会读取 `_t` 等登录凭据。验证结果保存在 VS Code 的 SecretStorage 中，临时浏览数据会被删除。需要清除验证时执行 `LINUX DO: 清除 Cloudflare 验证`。

自动验证目前支持 Google Chrome、Chromium、Microsoft Edge 和 Brave。无法启动兼容浏览器时仍可选择“手动粘贴”。

### Windows 手动填写方法

1. 使用 Chrome、Edge 或 Brave 打开 `https://linux.do/latest` 并完成 Cloudflare 验证。
2. 按 `F12`（部分电脑需要 `Fn+F12`），打开“应用/Application”面板。
3. 展开“存储/Storage”→“Cookie”→`https://linux.do`，找到 `cf_clearance`，双击并复制它的“值/Value”；也可以从“网络/Network”的请求标头中复制整段 `cookie`。
4. 打开“网络/Network”面板并刷新页面，选择第一个 `linux.do` 文档请求。
5. 在“标头/Headers”→“请求标头/Request Headers”中复制 `user-agent` 的完整值。
6. 回到 VS Code，执行 `LINUX DO: 设置 Cloudflare 验证`，选择“手动粘贴”，依次填入 Cookie 或 `cf_clearance` 值，以及 User-Agent。

也可以在浏览器“控制台/Console”输入 `navigator.userAgent` 获取 User-Agent。即使粘贴整段 Cookie，手动模式也只保留 `cf_clearance`、`__cf_bm`、`__cfuvid`、`_cfuvid`、`_bypass_cache`，以及未检测到登录标记时的匿名 `_forum_session`。Stripe 字段始终丢弃；如果检测到 `_t`、`remember_user_token` 或 `auth_token`，论坛会话也会被丢弃。

## 使用

安装扩展后，点击活动栏中的 LINUX DO 图标，选择“最新主题”“热门主题”或“浏览分类”。也可以打开命令面板，执行 `LINUX DO: 打开游客阅读器`。

此扩展通过站点公开的 Discourse JSON 接口读取游客可见内容。站点临时不可用、限制公开接口或要求人机验证时，扩展会显示相应错误。

## 本地开发

1. 用 VS Code 打开本目录。
2. 按 `F5` 启动 Extension Development Host。
3. 执行 `npm run check` 做语法检查。
4. 执行 `npm run package`，通过 `npx` 按需使用官方打包工具生成 VSIX。

本项目与 LINUX DO 官方无隶属关系。请遵守站点服务条款和访问频率限制。

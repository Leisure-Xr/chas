import { defineCase } from '../case-definition.mjs';
import { checkPyCharmArtifact } from '../checks.mjs';

export const pycharmCases = [
  defineCase({
    id: 'PYC-013', title: '收藏夹顶部目录与原地更新', product: 'pycharm', priority: 'P0', type: 'guided',
    capabilities: ['visible-desktop'],
    preconditions: ['隔离配置安装当前候选包，导入 15.1 格式的示例收藏。'],
    steps: [
      { action: '在 320、480、760 宽度和亮暗主题、放大字体下查看两行长标题、50 字目录名和 30 个目录。', expected: '目录标签换行且可滚动；无横向溢出，标题与菜单不重叠。' },
      { action: '选中目录后搜索其他目录名、标题及 URL，再清空搜索。', expected: '搜索跨全部目录，按时间倒序，清空后恢复原目录。' },
      { action: '通过内嵌表单创建、重命名目录；测试空名称、重名及取消。', expected: '错误原地显示，新建后清空搜索并选中新目录，其他修改保留搜索和滚动。' },
      { action: '复制、打开主题；将同一主题收藏在两个目录，移除其中一条；确认删除当前目录。', expected: '剪贴板为真实规范 URL，主题在插件内打开；移除不影响另一目录；删除后回到全部收藏。' },
      { action: '通过 Tab、Enter、Esc 完成操作；在菜单、表单打开时分别按 Esc。', expected: '菜单与表单关闭时父弹窗保留，最后一次 Esc 关闭弹窗。' },
      { action: '检查空目录、空收藏、无搜索结果；重启隔离 IDE。', expected: '空状态正确，收藏和目录修改持久化，日志无插件异常。' }
    ], expected: '收藏夹符合已确认预览，原有数据兼容，原地更新且键盘可用。'
  }),
  defineCase({
    id: 'PYC-014', title: '切换论坛与跨站跟随', product: 'pycharm', priority: 'P0', type: 'guided',
    capabilities: ['live-network', 'jcef'],
    steps: [
      { action: '从“⋯ > 切换论坛”依次切到 NodeSeek、V2EX、IDC Flare 和 LINUX DO，再重启隔离 IDE。', expected: '进入对应首页；当前论坛打勾，导航行、搜索框和标题栏同步切换；重启后回到上次的论坛。' },
      { action: '在 LINUX DO 帖子中点击指向 NodeSeek 或 V2EX 主题的链接。', expected: '在插件内打开并自动切换到对应论坛。' },
      { action: '在四个论坛各收藏一个主题，再打开浏览历史和收藏夹。', expected: '历史与收藏混合显示；收藏行显示站点名，按站点名搜索可以过滤。' },
      { action: '在四个论坛的主题上分别选择“⋯ > 分享当前主题”，再用“打开加密分享”导入。', expected: '四个论坛均可生成分享；导入后打开同一论坛的同一主题；非主题页面的分享菜单置灰。' }
    ], expected: '四个论坛可在同一工具窗口切换，历史和收藏跨站点共用。'
  }),
  defineCase({
    id: 'PYC-015', title: '各论坛隐私布局', product: 'pycharm', priority: 'P1', type: 'guided',
    capabilities: ['live-network', 'jcef', 'visible-desktop'],
    steps: [
      { action: '在 320、480、760 宽度与亮暗主题下查看 NodeSeek、V2EX、IDC Flare 的列表和主题页。', expected: '站点顶栏、侧栏、页脚、广告、头像和徽章隐藏；正文图片保持原色；无横向溢出；LEXIAO_READER_STATE 进入 stable。' },
      { action: '在四站查看中英文长标题、正文小标题、引用、列表、代码块和宽表格，再缩窄窗口。', expected: '正文 14px、主标题 18px、元信息 12px；字体与间距一致；长链接换行，代码及表格在自身区域横向滚动；头像隐藏后不残留空列。' },
      { action: '切到原始网页布局再切回。', expected: '布局即时切换，导航状态不丢失。' }
    ], expected: '每个论坛都有与 LINUX DO 一致的单色隐私阅读布局。'
  }),
  defineCase({
    id: 'PYC-016', title: '人机验证、登录墙与受限内容', product: 'pycharm', priority: 'P0', type: 'guided',
    capabilities: ['live-network', 'jcef'],
    steps: [
      { action: '用全新隔离配置依次打开四个论坛首页，等待或点击真实验证框。', expected: '首次启动不报加载超时；验证页可见；NodeSeek 自动等待 45 秒，其余站点 20 秒，自动刷新不重置期限，提示栏显示验证轮次。验证页内日志只有 page script skipped，没有探针输出。成功后提示栏隐藏，正文恢复隐私布局；无法通过时记录阻塞，不记为成功。' },
      { action: '等待超过自动验证期限，再测试重新验证、停止验证、重试及切换论坛。', expected: '期限结束后显示手动验证提示，页面和脚本继续运行；重新验证与重试都发起新的页面请求（日志有 reload requested 与新的 main frame loaded）；停止后显示错误页；切换论坛后旧提示和计时不会干扰新页面。' },
      { action: '打开 V2EX 需要登录的节点（如 /go/chamber）。', expected: '显示“站点将游客请求重定向到登录页面”，不绕过登录墙。' },
      { action: '打开 NodeSeek 内版（/categories/inside）或设有阅读等级的帖子。', expected: '立即显示可重试错误页，不空等验证超时。' }
    ], expected: '真正的验证得到等待，登录墙和受限内容如实报告。'
  }),
  defineCase({
    id: 'PYC-017', title: '从 16.0 升级、回退与 Cookie 清理', product: 'pycharm', priority: 'P0', type: 'guided',
    capabilities: ['visible-desktop', 'jcef'],
    preconditions: ['从 Git 历史取得 16.0 安装包，在隔离配置中安装并产生 LINUX DO 的历史与收藏。'],
    steps: [
      { action: '原地升级到新版本。', expected: '插件 ID 不变，工具窗口位置保留，旧历史与收藏完整可用。' },
      { action: '浏览四个论坛后执行“清理 Cookie 并重置会话”，再关闭项目。', expected: '四个论坛的主机与域 Cookie（如 .linux.do 的 cf_clearance）被删除，其它 JCEF Cookie 保留；日志不含 Cookie 值。' },
      { action: '回退安装 16.0。', expected: '16.0 正常加载；非 LINUX DO 的历史与收藏被丢弃，收藏目录保留。' }
    ], expected: '升级与回退不损坏数据，Cookie 清理只覆盖受支持的论坛。'
  }),
  defineCase({
    id: 'PYC-018', title: 'Cloudflare 验证流程本地回归', product: 'pycharm', priority: 'P0', type: 'guided',
    capabilities: ['jcef', 'visible-desktop'],
    preconditions: ['本机已安装目标 PyCharm 与 openssl。日常 PyCharm 可以保持运行：回归使用进程内 JCEF，不连接它的 cef_server。'],
    steps: [
      { action: '在 linuxdo-guest-browser/ 运行 node qa/scripts/verify-challenge-flow.mjs --ide <目标 PyCharm> --zip <候选包>。', expected: '脚本在隔离 IDE 中把四个论坛的主机经 --proxy-server 引到本地夹具，17 项检查全部 PASS，结果写入 qa/artifacts/challenge-flow/<时间>/summary.json。' },
      { action: '查看 summary.json 与 plugin.log。', expected: '冷启动首个页面经验证后放行；没有验证特征的 403 约 1.5 秒后显示拒绝访问；持续验证时轮次递增，LINUX DO 20 秒后提示手动验证；四站主题页均放行且分享入口可用；验证页内没有探针输出，也没有加载超时；日常 IDE 的 cef_server PID 不变。' }
    ], expected: '验证页识别、验证页脚本隔离、拒绝访问判定和四站分享入口在确定性夹具上回归通过；真实 Cloudflare 的判定仍由 PYC-016 覆盖。'
  }),
  defineCase({
    id: 'PYC-001', title: 'PyCharm ZIP 清单与源码一致', product: 'pycharm', priority: 'P0', type: 'automated',
    capabilities: ['package'], expected: '插件版本、构建范围、关键资源和包结构一致。', run: checkPyCharmArtifact
  }),
  defineCase({
    id: 'PYC-002', title: '隔离配置安装并加载插件', product: 'pycharm', priority: 'P0', type: 'guided',
    capabilities: ['visible-desktop'],
    preconditions: ['使用 runner 创建的独立 config、system、plugins 和 log 目录。'],
    steps: [
      { action: '启动目标 PyCharm 并打开“论坛游客阅读器”工具窗口。', expected: '插件加载成功，侧边栏显示“论坛游客阅读器”，标题栏显示当前论坛；idea.log 无 PluginException 或链接错误。' },
      { action: '关闭测试项目。', expected: '没有修改日常 PyCharm 配置和插件目录。' }
    ], expected: '发布 ZIP 在目标构建真实安装并加载。'
  }),
  defineCase({
    id: 'PYC-003', title: 'JCEF 游客浏览与基本导航', product: 'pycharm', priority: 'P0', type: 'guided',
    capabilities: ['live-network', 'jcef'],
    steps: [
      { action: '打开工具窗口并等待最新列表加载。', expected: 'JCEF 可用且显示游客页面。' },
      { action: '进入公开主题并执行返回、前进和刷新。', expected: '导航状态和页面内容正确。' }
    ], expected: '核心 JCEF 游客阅读路径可用。'
  }),
  defineCase({
    id: 'PYC-012', title: '旧版 JCEF 会话初始化不会白屏', product: 'pycharm', priority: 'P0', type: 'guided',
    capabilities: ['live-network', 'jcef'],
    preconditions: ['使用全新隔离配置安装候选 ZIP，重点覆盖 PyCharm 2024.2.6。'],
    steps: [
      { action: '首次打开 LINUX DO 工具窗口。', expected: 'Cookie 清理任务在 JetBrains 后台执行器运行，随后启用导航并显示网页或明确错误页。' },
      { action: '依次刷新、重置会话并切换隐私/原始布局。', expected: '网页区域不永久停在 about:blank，操作完成后仍可导航。' },
      { action: '打开小游戏后返回网页。', expected: '小游戏可用且不会掩盖或重置网页加载状态。' },
      { action: '在断网或受控超时状态重试。', expected: '网页区域显示脱敏失败原因和重试入口，不出现无状态白屏。' }
    ], expected: '旧版 JCEF 的初始化、失败和恢复路径均不会静默白屏。'
  }),
  defineCase({
    id: 'PYC-004', title: '登录与站外主框架导航被阻止', product: 'pycharm', priority: 'P0', type: 'guided',
    capabilities: ['live-network', 'jcef'],
    steps: [
      { action: '在四个论坛分别尝试登录、注册、OAuth 和带凭据 URL（如 /login、/signIn.html、/signin）。', expected: '主框架导航被拒绝，不显示账号输入流程。' },
      { action: '点击站外链接，包括 NodeSeek 顶栏的 DeepFlood。', expected: '不在插件主框架内导航。' },
      { action: '重置会话并关闭项目。', expected: '四个论坛的 JCEF Cookie（含 .linux.do 等域 Cookie）被清理。' }
    ], expected: '游客会话边界和 Cookie 清理有效。'
  }),
  defineCase({
    id: 'PYC-005', title: '分类、热门、搜索和长页面', product: 'pycharm', priority: 'P1', type: 'guided',
    capabilities: ['live-network', 'jcef'],
    steps: [
      { action: '在每个论坛依次打开导航行的各个入口和搜索。', expected: '入口高亮、实际 URL 和页面类型一致；NodeSeek 与 V2EX 的搜索框停用并说明原因。' },
      { action: '滚动长列表和长主题。', expected: 'JCEF 页面保持响应，工具栏不遮挡内容。' }
    ], expected: '完整站点导航在隐私布局中可用。'
  }),
  defineCase({
    id: 'PYC-006', title: '历史记录持久化与清理', product: 'pycharm', priority: 'P1', type: 'guided',
    capabilities: ['visible-desktop'],
    steps: [
      { action: '从列表点击多个由 Discourse SPA 切换的公开主题并从历史搜索、复制和重新打开。', expected: '地址变化后立即产生记录，包含清理后的标题、公开 URL 和时间。' },
      { action: '重启 IDE 后清空历史。', expected: '历史先恢复，清空后完全移除。' }
    ], expected: '最多 60 条历史正确持久化且不含秘密。'
  }),
  defineCase({
    id: 'PYC-007', title: '隐私布局与原始布局切换', product: 'pycharm', priority: 'P1', type: 'guided',
    capabilities: ['live-network', 'jcef'],
    steps: [
      { action: '在四个论坛检查列表、主题正文、用户信息和正文图片。', expected: '身份装饰与正文外媒体隐藏，技术图片保持原色。' },
      { action: '切到原始布局再切回。', expected: '布局即时切换且导航状态不丢失。' }
    ], expected: '隐私布局符合文档并可逆切换。'
  }),
  defineCase({
    id: 'PYC-008', title: '异步分享不阻塞 EDT', product: 'pycharm', priority: 'P1', type: 'guided',
    capabilities: ['visible-desktop'],
    steps: [
      { action: '生成和打开采用 600000 轮 PBKDF2 的分享内容。', expected: '计算期间窗口仍可重绘和移动，没有 EDT 卡死告警。' },
      { action: '测试错误密码和过期内容。', expected: '安全失败且界面恢复可操作。' }
    ], expected: '加密分享在后台执行并保持界面响应。'
  }),
  defineCase({
    id: 'PYC-009', title: '游戏、提醒和工具窗口缩放', product: 'pycharm', priority: 'P1', type: 'guided',
    capabilities: ['visible-desktop', 'jcef'],
    steps: [
      { action: '打开提醒和五款游戏并连续调整工具窗口宽高。', expected: 'Canvas 清晰、自适应且对局不重置。' },
      { action: '隐藏再显示工具窗口。', expected: '行为符合文档，不误报为浏览器已释放。' }
    ], expected: 'JCEF 内游戏和提醒在不同尺寸稳定运行。'
  }),
  defineCase({
    id: 'PYC-010', title: '内容移除和项目关闭释放浏览器', product: 'pycharm', priority: 'P0', type: 'guided',
    capabilities: ['jcef'],
    steps: [
      { action: '动态卸载插件或移除工具窗口内容。', expected: 'Content disposer 被调用，浏览器释放且无后续回调异常。' },
      { action: '重新启用后关闭项目。', expected: '计时器、弹窗和 JCEF 浏览器均释放。' }
    ], expected: '生命周期结束时不遗留插件资源。'
  }),
  defineCase({
    id: 'PYC-011', title: '最新稳定版完整视觉回归', product: 'pycharm', priority: 'P1', type: 'guided',
    capabilities: ['latest', 'visible-desktop', 'jcef'],
    steps: [
      { action: '在窄、中、宽工具窗口检查顶栏、导航、历史、分享和游戏。', expected: '无重叠、截断或重复按钮，焦点和滚动稳定。' },
      { action: '分别在 IDE 亮色和暗色主题下检查隐私列表、主题、加载背景、休息提醒和五款游戏。', expected: 'JCEF 背景、面板、文字、边框和强调色与 Swing 工具窗口一致且均可读。' },
      { action: '游戏进行中切换 IDE 主题。', expected: '页面和游戏立即换色，不刷新页面、不改变滚动位置，也不重置游戏、分数或倒计时。' },
      { action: '切换到原始网页布局并再次切换 IDE 主题。', expected: '原始网页继续使用站点样式，插件工具栏仍跟随 IDE。' }
    ], expected: '最新稳定 PyCharm 无明显视觉回归，插件自有界面完整跟随 IDE 主题。'
  })
];

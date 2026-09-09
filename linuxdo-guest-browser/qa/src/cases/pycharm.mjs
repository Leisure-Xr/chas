import { defineCase } from '../case-definition.mjs';
import { checkPyCharmArtifact } from '../checks.mjs';

export const pycharmCases = [
  defineCase({
    id: 'PYC-001', title: 'PyCharm ZIP 清单与源码一致', product: 'pycharm', priority: 'P0', type: 'automated',
    capabilities: ['package'], expected: '插件版本、构建范围、关键资源和包结构一致。', run: checkPyCharmArtifact
  }),
  defineCase({
    id: 'PYC-002', title: '隔离配置安装并加载插件', product: 'pycharm', priority: 'P0', type: 'guided',
    capabilities: ['visible-desktop'],
    preconditions: ['使用 runner 创建的独立 config、system、plugins 和 log 目录。'],
    steps: [
      { action: '启动目标 PyCharm 并打开 LINUX DO 工具窗口。', expected: '插件加载成功，idea.log 无 PluginException 或链接错误。' },
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
    id: 'PYC-004', title: '登录与站外主框架导航被阻止', product: 'pycharm', priority: 'P0', type: 'guided',
    capabilities: ['live-network', 'jcef'],
    steps: [
      { action: '尝试打开登录、注册、OAuth 和带凭据 URL。', expected: '主框架导航被拒绝，不显示账号输入流程。' },
      { action: '点击站外链接。', expected: '不在插件主框架内导航。' },
      { action: '重置会话并关闭项目。', expected: 'linux.do JCEF Cookie 被清理。' }
    ], expected: '游客会话边界和 Cookie 清理有效。'
  }),
  defineCase({
    id: 'PYC-005', title: '分类、热门、搜索和长页面', product: 'pycharm', priority: 'P1', type: 'guided',
    capabilities: ['live-network', 'jcef'],
    steps: [
      { action: '依次打开最新、热门、分类和搜索。', expected: '入口高亮、实际 URL 和页面类型一致。' },
      { action: '滚动长列表和长主题。', expected: 'JCEF 页面保持响应，工具栏不遮挡内容。' }
    ], expected: '完整站点导航在隐私布局中可用。'
  }),
  defineCase({
    id: 'PYC-006', title: '历史记录持久化与清理', product: 'pycharm', priority: 'P1', type: 'guided',
    capabilities: ['visible-desktop'],
    steps: [
      { action: '访问多个公开页面并从历史搜索、复制和重新打开。', expected: '记录包含清理后的标题、公开 URL 和时间。' },
      { action: '重启 IDE 后清空历史。', expected: '历史先恢复，清空后完全移除。' }
    ], expected: '最多 60 条历史正确持久化且不含秘密。'
  }),
  defineCase({
    id: 'PYC-007', title: '隐私布局与原始布局切换', product: 'pycharm', priority: 'P1', type: 'guided',
    capabilities: ['live-network', 'jcef'],
    steps: [
      { action: '检查列表、主题正文、用户信息和正文图片。', expected: '身份装饰与正文外媒体隐藏，技术图片保持原色。' },
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
      { action: '切换 IDE 亮色和暗色主题。', expected: '隐私布局和 Swing 控件均可读。' }
    ], expected: '最新稳定 PyCharm 无明显视觉回归。'
  })
];

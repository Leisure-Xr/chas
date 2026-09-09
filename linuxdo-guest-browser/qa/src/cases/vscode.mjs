import { defineCase } from '../case-definition.mjs';
import { checkVsCodeArtifact, runVsCodeUnitTests } from '../checks.mjs';

export const vscodeCases = [
  defineCase({
    id: 'VSC-001', title: 'VSIX 清单与源码一致', product: 'vscode', priority: 'P0', type: 'automated',
    capabilities: ['package'], expected: '插件版本、VS Code engines 和关键文件与源码一致。', run: checkVsCodeArtifact
  }),
  defineCase({
    id: 'VSC-002', title: 'VS Code 逻辑回归测试通过', product: 'vscode', priority: 'P0', type: 'automated',
    capabilities: ['source'], expected: '全部 Node 单元测试通过。', run: runVsCodeUnitTests
  }),
  defineCase({
    id: 'VSC-003', title: '隔离配置安装并激活 VSIX', product: 'vscode', priority: 'P0', type: 'guided',
    capabilities: ['visible-desktop'],
    preconditions: ['使用 runner 创建的独立 user-data-dir 和 extensions-dir。'],
    steps: [
      { action: '启动目标 VS Code 并打开 LINUX DO 活动栏入口。', expected: '插件成功激活，扩展宿主日志无异常。' },
      { action: '关闭窗口后检查隔离目录。', expected: '没有修改日常 VS Code 配置或扩展目录。' }
    ], expected: '发布 VSIX 在目标版本真实安装并激活。'
  }),
  defineCase({
    id: 'VSC-004', title: '旧版使用手动请求引擎', product: 'vscode', priority: 'P0', type: 'guided',
    capabilities: ['vscode-manual-boundary', 'live-network'],
    steps: [
      { action: '选择原生浏览器引擎。', expected: '明确提示需要 VS Code 1.114.0 或更高版本。' },
      { action: '切换手动参数并验证一次游客请求。', expected: '只测试 /latest.json，随后可以浏览公开内容。' }
    ], expected: '1.114 之前的版本有清晰降级路径。'
  }),
  defineCase({
    id: 'VSC-005', title: '原生浏览器会话与重连', product: 'vscode', priority: 'P0', type: 'guided',
    capabilities: ['vscode-native', 'live-network'],
    steps: [
      { action: '以自动引擎打开原生游客验证并完成必要 challenge。', expected: '使用 VS Code Integrated Browser，不启动外部浏览器。' },
      { action: '加载最新列表后触发空闲释放并再次请求。', expected: '会话释放后重新连接，必要时重新验证。' },
      { action: '关闭阅读器。', expected: '只关闭插件创建的浏览器标签和调试会话。' }
    ], expected: '1.114 及以上版本的原生会话完整可用。'
  }),
  defineCase({
    id: 'VSC-006', title: '游客列表、主题和基本导航', product: 'vscode', priority: 'P0', type: 'guided',
    capabilities: ['live-network'],
    steps: [
      { action: '打开最新列表并进入任意公开主题。', expected: '显示主题内容和公开帖子。' },
      { action: '执行返回、前进和刷新。', expected: '页面与按钮状态正确，已加载内容不丢失。' }
    ], expected: '核心游客阅读路径可用。'
  }),
  defineCase({
    id: 'VSC-007', title: '分类、热门、搜索与续载', product: 'vscode', priority: 'P1', type: 'guided',
    capabilities: ['live-network'],
    steps: [
      { action: '依次打开热门、分类和搜索结果。', expected: '入口、标题和结果类型匹配。' },
      { action: '滚动列表和长主题到底部。', expected: '只按用户向下意图续载，不发生连续失控请求。' }
    ], expected: '次级导航和分页行为正确。'
  }),
  defineCase({
    id: 'VSC-008', title: '历史记录与重启持久化', product: 'vscode', priority: 'P1', type: 'guided',
    capabilities: ['visible-desktop'],
    steps: [
      { action: '访问多个列表和主题，搜索并重新打开历史。', expected: '标题、公开 URL 和访问时间正确，楼层 URL 去重。' },
      { action: '重启 IDE 后清空历史。', expected: '历史先恢复，清空后记录和公开内容快照一并删除。' }
    ], expected: '历史记录可用且不包含秘密。'
  }),
  defineCase({
    id: 'VSC-009', title: 'Cloudflare、限流、断网和缓存恢复', product: 'vscode', priority: 'P1', type: 'guided',
    capabilities: ['live-network'],
    preconditions: ['使用稳妥请求节奏串行执行。'],
    steps: [
      { action: '分别触发或使用受控替身复现 challenge、403、429 和断网。', expected: 'challenge/403 使用短退避，429 遵守 Retry-After，断网不伪装成限流。' },
      { action: '在已有缓存和无缓存状态重试。', expected: '可用陈旧缓存时保留页面，无缓存时显示可恢复错误。' }
    ], expected: '保护、限流和缓存状态分类准确。'
  }),
  defineCase({
    id: 'VSC-010', title: '正文图片代理和资源限制', product: 'vscode', priority: 'P1', type: 'guided',
    capabilities: ['live-network'],
    steps: [
      { action: '保持头像关闭，打开含正文图片的主题并滚动。', expected: '图片进入视口后才请求，最多两个并发。' },
      { action: '测试超限、非图片、403 和 429 响应。', expected: '单图失败隔离；429 共享冷却；不合规响应不缓存。' },
      { action: '关闭正文图片。', expected: '正文图片不再加载。' }
    ], expected: '图片不会绕过请求节奏和内存预算。'
  }),
  defineCase({
    id: 'VSC-011', title: '请求档案拒绝登录凭据与混用参数', product: 'vscode', priority: 'P0', type: 'guided',
    capabilities: ['vscode-manual'],
    steps: [
      { action: '导入包含登录 Cookie、Authorization 或 API 凭据的请求。', expected: '整组拒绝且不写入 SecretStorage。' },
      { action: '导入版本或平台不一致的 Cookie、UA 和客户端提示。', expected: '明确报告参数混用。' },
      { action: '清除 Cookie、UA 或全部参数。', expected: '原子档案整体停用并删除。' }
    ], expected: '手动档案只接受同源游客白名单参数。'
  }),
  defineCase({
    id: 'VSC-012', title: '最新稳定版完整视觉回归', product: 'vscode', priority: 'P1', type: 'guided',
    capabilities: ['latest', 'visible-desktop'],
    steps: [
      { action: '在窄、中、宽三种面板尺寸检查列表、主题、历史、验证和游戏界面。', expected: '文字不重叠、不截断，控件状态稳定，滚动位置正确。' },
      { action: '切换亮色和暗色主题。', expected: '颜色、焦点和可读性符合 VS Code 主题。' }
    ], expected: '最新稳定版全部用户界面无明显视觉回归。'
  })
];

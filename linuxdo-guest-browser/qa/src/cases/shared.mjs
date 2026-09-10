import { defineCase } from '../case-definition.mjs';
import { checkIdeStarted, checkSharedCopies } from '../checks.mjs';

export const sharedCases = [
  defineCase({
    id: 'SHR-001',
    title: '共享游戏资源与两端打包副本一致',
    product: 'shared',
    priority: 'P0',
    type: 'automated',
    capabilities: ['source'],
    expected: '共享玩法和界面资源逐字节一致。',
    run: checkSharedCopies
  }),
  defineCase({
    id: 'SHR-002',
    title: '真实联网测试保持游客身份',
    product: 'shared',
    priority: 'P0',
    type: 'guided',
    capabilities: ['live-network'],
    preconditions: ['IDE 使用全新隔离配置，未登录 linux.do。'],
    steps: [
      { action: '打开最新列表和一个公开主题。', expected: '内容可读，过程中不要求论坛账号。' },
      { action: '检查插件设置、历史和运行记录。', expected: '不存在账号、密码、登录令牌或完整游客请求参数。' }
    ],
    expected: '两个插件只处理游客可见内容且不保存账号凭据。'
  }),
  defineCase({
    id: 'SHR-003',
    title: 'VS Code 与 PyCharm 加密分享双向兼容',
    product: 'shared',
    priority: 'P1',
    type: 'guided',
    capabilities: ['live-network', 'cross-product'],
    preconditions: ['两个 IDE 均已安装本次候选包。', '已打开一个公开主题。'],
    steps: [
      { action: '在 VS Code 生成分享，在 PyCharm 使用相同密码打开。', expected: '打开相同公开主题。' },
      { action: '在 PyCharm 生成分享，在 VS Code 使用相同密码打开。', expected: '打开相同公开主题。' },
      { action: '分别测试错误密码和已过期内容。', expected: '两端均拒绝且不泄漏主题元数据。' }
    ],
    expected: '分享内容双向兼容，错误与过期处理一致。'
  }),
  defineCase({
    id: 'SHR-004',
    title: '五款游戏核心交互一致',
    product: 'shared',
    priority: 'P1',
    type: 'guided',
    capabilities: ['visible-desktop'],
    steps: [
      { action: '依次打开 2048、贪吃蛇、赛车、像素跳跃和扫雷。', expected: '每款游戏均可开始、暂停、继续和重开。' },
      { action: '切换焦点并调整窗口大小。', expected: '失焦自动暂停，布局自适应且当前对局不重置。' },
      { action: '产生新最高分后重启 IDE。', expected: '只保留各游戏的整数最高分。' }
    ],
    expected: '两端玩法、暂停策略和持久化行为一致。'
  }),
  defineCase({
    id: 'SHR-005',
    title: '休息提醒默认关闭并可延后',
    product: 'shared',
    priority: 'P1',
    type: 'guided',
    capabilities: ['visible-desktop', 'latest'],
    steps: [
      { action: '使用全新配置启动插件。', expected: '休息提醒默认关闭。' },
      { action: '开启提醒并保持 IDE 运行到首次 31–60 分钟提醒。', expected: '可以跳过或延后 10 分钟，阅读状态不丢失。' }
    ],
    expected: '提醒是可选功能，不干扰阅读状态。'
  }),
  defineCase({
    id: 'SHR-006',
    title: '动态站点内容不影响断言稳定性',
    product: 'shared',
    priority: 'P1',
    type: 'guided',
    capabilities: ['live-network'],
    preconditions: ['站点当前可访问或可完成人机验证。'],
    steps: [
      { action: '加载任意游客列表和公开主题。', expected: '按页面类型、URL 和导航状态判断，不依赖固定标题或主题编号。' }
    ],
    expected: '用例不会因站点正常内容变化产生误报。'
  }),
  defineCase({
    id: 'SHR-007',
    title: '真实 IDE 进程启动并写入隔离日志',
    product: 'shared',
    priority: 'P0',
    type: 'automated',
    capabilities: ['launched'],
    expected: '目标 IDE 保持运行并在隔离目录写入启动日志。',
    run: checkIdeStarted
  }),
  defineCase({
    id: 'SHR-008',
    title: '收藏目录管理与主题持久化',
    product: 'shared',
    priority: 'P1',
    type: 'guided',
    capabilities: ['visible-desktop'],
    steps: [
      { action: '创建两个收藏目录并重命名其中一个。', expected: '目录名称唯一，重命名后内容保留。' },
      { action: '把同一公开主题收藏到两个目录，再从其中一个目录移除。', expected: '目录内不重复，另一个目录中的收藏不受影响。' },
      { action: '重启 IDE，搜索并打开收藏主题。', expected: '目录与主题恢复，打开后浏览历史也产生对应记录。' },
      { action: '删除包含主题的目录并确认。', expected: '只删除该目录及其中收藏，不影响浏览历史和其他目录。' }
    ],
    expected: '收藏夹按目录可靠持久化且只保存公开主题元数据。'
  })
];

(() => {
  'use strict';

  const vscode = acquireVsCodeApi();
  const content = document.getElementById('content');
  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('search-input');
  const backButton = document.getElementById('back');
  const historyButton = document.getElementById('history');
  const breakReminderButton = document.getElementById('break-reminder');
  const shareTopicButton = document.getElementById('share-topic');
  const openGameButton = document.getElementById('open-game');
  const densityButton = document.getElementById('density');
  const refreshButton = document.getElementById('refresh');
  let savedState = vscode.getState() || {};
  let topicState;
  let loadMoreObserver;
  let topicListState;
  let topicListObserver;
  let currentEntryId;
  let currentPageCacheable = false;
  let breakReminderEnabled = false;
  let breakTimer;
  let gameTimer;
  let gameFrame;
  let gameCountdownCancel;
  let gamePauseButton;
  let gamePauseLayer;
  let activeGame;
  let gameKeyHandler;
  let gameKeyUpHandler;
  let gameInputReset;
  let gameResizeCleanup;
  let gameCleanup = [];
  let historyEntries = [];
  let historyFeedbackTimer;
  const pageCache = new Map();
  const historyOverlay = createHistoryOverlay();
  const gameOverlay = createGameOverlay();
  const gameRuntime = LinuxDoGameCore.createRuntime({
    bestScores: savedState.gameBestScores || {},
    onBestScore: () => {
      savedState = { ...savedState, gameBestScores: gameRuntime.bestScores() };
      vscode.setState(savedState);
    },
    onPause: (paused) => {
      if (paused) gameInputReset?.();
      if (gamePauseButton) {
        gamePauseButton.textContent = paused ? '▶' : 'Ⅱ';
        gamePauseButton.title = paused ? '继续' : '暂停';
        gamePauseButton.setAttribute('aria-label', paused ? '继续' : '暂停');
      }
      if (gamePauseLayer) gamePauseLayer.hidden = !paused;
    }
  });
  savedState = { ...savedState, gameBestScores: gameRuntime.bestScores() };
  vscode.setState(savedState);

  document.body.classList.toggle('compact', savedState.compact !== false);

  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => navigate({ type: 'navigate', view: button.dataset.view }));
  });

  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    navigate({ type: 'search', query: searchInput.value.trim() });
  });

  refreshButton.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  backButton.addEventListener('click', () => navigate({ type: 'back' }));
  historyButton.addEventListener('click', showHistory);
  breakReminderButton.addEventListener('click', () => {
    setBreakReminderEnabled(!breakReminderEnabled);
    vscode.postMessage({ type: 'setBreakReminder', enabled: breakReminderEnabled });
  });
  openGameButton.addEventListener('click', () => showGameMenu(false));
  shareTopicButton.addEventListener('click', () => vscode.postMessage({ type: 'shareCurrent' }));
  densityButton.addEventListener('click', () => {
    const compact = !document.body.classList.contains('compact');
    document.body.classList.toggle('compact', compact);
    densityButton.classList.toggle('active', compact);
    savedState = { ...savedState, compact };
    vscode.setState(savedState);
  });
  densityButton.classList.toggle('active', document.body.classList.contains('compact'));

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !historyOverlay.hidden) {
      event.preventDefault();
      closeHistory();
      return;
    }
    if (!gameOverlay.hidden && gameKeyHandler?.(event)) {
      event.preventDefault();
      return;
    }
    if (event.altKey && event.key === 'ArrowLeft' && !backButton.disabled) {
      event.preventDefault();
      navigate({ type: 'back' });
    }
  });
  window.addEventListener('keyup', (event) => {
    if (!gameOverlay.hidden && gameKeyUpHandler?.(event)) event.preventDefault();
  });
  window.addEventListener('blur', () => {
    if (!gameOverlay.hidden && activeGame && !gameRuntime.state().finished) {
      gameInputReset?.();
      gameRuntime.setPaused(true);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !gameOverlay.hidden && activeGame) {
      gameInputReset?.();
      gameRuntime.setPaused(true);
    }
  });

  content.addEventListener('click', (event) => {
    const loadMoreTopicsButton = event.target.closest('[data-load-more-topics]');
    if (loadMoreTopicsButton) {
      event.preventDefault();
      requestMoreTopics();
      return;
    }

    const loadMoreButton = event.target.closest('[data-load-more]');
    if (loadMoreButton) {
      event.preventDefault();
      requestMorePosts();
      return;
    }

    const topicButton = event.target.closest('[data-topic-id]');
    if (topicButton) {
      event.preventDefault();
      navigate({
        type: 'topic',
        id: Number(topicButton.dataset.topicId),
        slug: topicButton.dataset.topicSlug || 'topic'
      });
      return;
    }

    const categoryButton = event.target.closest('[data-category-id]');
    if (categoryButton) {
      event.preventDefault();
      navigate({
        type: 'category',
        id: Number(categoryButton.dataset.categoryId),
        name: categoryButton.dataset.categoryName || '分类'
      });
      return;
    }

    const externalLink = event.target.closest('a[href]');
    if (externalLink) {
      event.preventDefault();
      const href = externalLink.href;
      const topic = parseLinuxDoTopic(href);
      if (topic) {
        navigate({ type: 'topic', ...topic });
      } else {
        vscode.postMessage({ type: 'external', url: href });
      }
    }
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'historyData':
        historyEntries = Array.isArray(message.entries) ? message.entries : [];
        renderHistoryEntries();
        break;
      case 'historyCopied':
        showHistoryFeedback('URL 已复制');
        break;
      case 'loading':
        renderLoading();
        break;
      case 'error':
        renderError(message.message);
        break;
      case 'cloudflareRequired':
        renderCloudflare(message);
        break;
      case 'navigationState':
        backButton.disabled = !message.canGoBack;
        currentEntryId = Number(message.entryId);
        break;
      case 'breakReminderState':
        setBreakReminderEnabled(Boolean(message.enabled));
        break;
      case 'restorePage':
        backButton.disabled = !message.canGoBack;
        currentEntryId = Number(message.entryId);
        vscode.postMessage({
          type: 'restoreResult',
          entryId: currentEntryId,
          restored: restoreCachedPage(currentEntryId)
        });
        break;
      case 'topicList':
        renderTopicList(message.data, message);
        break;
      case 'categories':
        renderCategories(message.data);
        break;
      case 'topic':
        renderTopic(message.data);
        break;
      case 'morePosts':
        appendMorePosts(message);
        break;
      case 'morePostsError':
        showMorePostsError(message);
        break;
      case 'moreTopics':
        appendMoreTopics(message);
        break;
      case 'moreTopicsError':
        showMoreTopicsError(message);
        break;
    }
  });

  function createHistoryOverlay() {
    const overlay = node('div', 'reader-overlay history-overlay');
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '浏览历史');

    const panel = node('section', 'history-panel');
    const heading = node('header', 'history-heading', [
      node('div', '', [node('h1', '', '浏览历史'), node('p', '', '最近访问的公开页面保存在本机')]),
      iconAction('×', '关闭历史记录', closeHistory)
    ]);
    const search = document.createElement('input');
    search.id = 'history-search';
    search.className = 'history-search';
    search.type = 'search';
    search.maxLength = 100;
    search.placeholder = '搜索标题或 URL';
    search.setAttribute('aria-label', '搜索历史记录');
    search.addEventListener('input', renderHistoryEntries);

    const list = node('div', 'history-list');
    list.id = 'history-list';
    const count = node('span', 'history-count', '0 条记录');
    count.id = 'history-count';
    const feedback = node('span', 'history-feedback');
    feedback.id = 'history-feedback';
    const clearButton = node('button', 'secondary-button history-clear', '清除全部');
    clearButton.id = 'history-clear';
    clearButton.type = 'button';
    clearButton.addEventListener('click', () => vscode.postMessage({ type: 'historyClear' }));
    const footer = node('footer', 'history-footer', [count, feedback, clearButton]);

    panel.append(heading, search, list, footer);
    overlay.append(panel);
    overlay.addEventListener('pointerdown', (event) => {
      if (event.target === overlay) closeHistory();
    });
    document.body.append(overlay);
    return overlay;
  }

  function showHistory() {
    historyOverlay.hidden = false;
    vscode.postMessage({ type: 'historyRequest' });
    requestAnimationFrame(() => historyOverlay.querySelector('#history-search')?.focus());
  }

  function closeHistory() {
    historyOverlay.hidden = true;
    historyButton.focus();
  }

  function renderHistoryEntries() {
    const list = historyOverlay.querySelector('#history-list');
    if (!list) return;
    const query = String(historyOverlay.querySelector('#history-search')?.value || '').trim().toLocaleLowerCase('zh-CN');
    const filtered = historyEntries.filter((entry) => !query || `${entry.title} ${entry.url}`.toLocaleLowerCase('zh-CN').includes(query));
    list.replaceChildren();

    if (!filtered.length) {
      list.append(node('div', 'history-empty', historyEntries.length ? '没有匹配的历史记录' : '暂无浏览历史'));
    } else {
      filtered.forEach((entry) => {
        const titleButton = node('button', 'history-entry-main');
        titleButton.type = 'button';
        titleButton.title = `打开 ${entry.title}`;
        titleButton.append(
          node('strong', 'history-entry-title', entry.title || '公开页面'),
          node('span', 'history-entry-url', entry.url),
          node('time', 'history-entry-time', formatHistoryTime(entry.visitedAt))
        );
        titleButton.addEventListener('click', () => {
          historyOverlay.hidden = true;
          navigate({ type: 'historyOpen', url: entry.url });
        });
        const copyButton = iconAction('⧉', '复制 URL', () => vscode.postMessage({ type: 'historyCopy', url: entry.url }));
        copyButton.classList.add('history-copy');
        list.append(node('article', 'history-entry', [titleButton, copyButton]));
      });
    }

    const count = historyOverlay.querySelector('#history-count');
    if (count) count.textContent = query ? `${filtered.length} / ${historyEntries.length} 条` : `${historyEntries.length} 条记录`;
    const clearButton = historyOverlay.querySelector('#history-clear');
    if (clearButton) clearButton.disabled = historyEntries.length === 0;
  }

  function showHistoryFeedback(message) {
    const feedback = historyOverlay.querySelector('#history-feedback');
    if (!feedback) return;
    feedback.textContent = message;
    clearTimeout(historyFeedbackTimer);
    historyFeedbackTimer = setTimeout(() => { feedback.textContent = ''; }, 1800);
  }

  function formatHistoryTime(value) {
    const date = new Date(Number(value));
    if (Number.isNaN(date.valueOf())) return '';
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date);
  }

  function setBreakReminderEnabled(enabled) {
    breakReminderEnabled = enabled;
    breakReminderButton.classList.toggle('active', enabled);
    breakReminderButton.setAttribute('aria-pressed', String(enabled));
    breakReminderButton.title = enabled ? '关闭休息提醒' : '开启休息提醒';
    clearTimeout(breakTimer);
    breakTimer = undefined;
    if (enabled) scheduleBreak();
  }

  function scheduleBreak(delay) {
    clearTimeout(breakTimer);
    if (!breakReminderEnabled) return;
    const randomDelay = (31 + Math.floor(Math.random() * 30)) * 60 * 1000;
    breakTimer = setTimeout(() => showGameMenu(true), delay || randomDelay);
  }

  function createGameOverlay() {
    const overlay = node('div', 'break-overlay');
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '休息小游戏');
    overlay.append(node('section', 'break-panel'));
    document.body.append(overlay);
    return overlay;
  }

  function showGameMenu(fromReminder) {
    stopGame();
    clearTimeout(breakTimer);
    const panel = gameOverlay.querySelector('.break-panel');
    panel.classList.remove('is-game', 'game-compact');
    delete panel.dataset.game;
    const games = ['2048', 'snake', 'racer', 'jumper', 'mines'];
    const recommended = games[Math.floor(Math.random() * games.length)];
    const heading = node('div', 'break-heading', [
      node('div', '', [
        node('h1', '', fromReminder ? '休息一下' : '小游戏'),
        node('p', '', fromReminder ? '离开帖子几分钟，活动一下眼睛和手指。' : '选一个轻量小游戏，随时可以回到阅读。')
      ]),
      iconAction('×', '继续阅读', closeGameOverlay)
    ]);
    const choices = node('div', 'game-choices');
    choices.append(
      gameChoice('2048', '合并数字', '方向键移动方块', recommended === '2048'),
      gameChoice('snake', '贪吃蛇', '吃到方块并避开自己', recommended === 'snake'),
      gameChoice('racer', '公路闪避', '在单一道路内自由转向', recommended === 'racer'),
      gameChoice('jumper', '像素跳跃', '奔跑并跳过障碍', recommended === 'jumper'),
      gameChoice('mines', '扫雷', '找出安全方格', recommended === 'mines')
    );
    const actions = node('div', 'break-actions');
    if (fromReminder) {
      actions.append(actionButton('10 分钟后提醒', () => {
        gameOverlay.hidden = true;
        scheduleBreak(10 * 60 * 1000);
      }));
    }
    actions.append(actionButton('继续阅读', closeGameOverlay));
    panel.replaceChildren(heading, choices, actions);
    gameOverlay.hidden = false;
    panel.querySelector('.game-choice')?.focus();
  }

  function gameChoice(kind, title, description, recommended) {
    const button = node('button', 'game-choice');
    button.type = 'button';
    button.append(
      node('span', 'game-choice-icon', { '2048': '20', snake: 'S', racer: 'R', jumper: 'J', mines: 'M' }[kind]),
      node('span', 'game-choice-copy', [
        node('strong', '', title),
        node('small', '', description)
      ])
    );
    if (recommended) button.append(node('span', 'recommend-badge', '推荐'));
    button.addEventListener('click', () => startGame(kind));
    return button;
  }

  function startGame(kind) {
    stopGame();
    activeGame = LinuxDoGameCore.canonicalGame(kind);
    gameRuntime.start(activeGame);
    const launch = () => {
      if (activeGame === 'snake') startSnake();
      else if (activeGame === 'racer') startRacer();
      else if (activeGame === 'jumper') startJumper();
      else if (activeGame === 'mines') startMines();
      else start2048();
    };
    const panel = gameOverlay.querySelector('.break-panel');
    panel.classList.add('is-game');
    const countdownValue = node('strong', 'countdown-value', '3');
    panel.replaceChildren(node('div', 'countdown-panel', [node('span', '', '准备'), countdownValue]));
    gameOverlay.hidden = false;
    gameCountdownCancel = LinuxDoGameCore.countdown((value) => { countdownValue.textContent = String(value); }, launch);
  }

  function gameShell(title, instructions) {
    const panel = gameOverlay.querySelector('.break-panel');
    panel.classList.add('is-game');
    panel.dataset.game = activeGame;
    const score = node('strong', 'game-score', '0');
    score.id = 'mini-game-score';
    const body = node('div', 'game-body');
    body.id = 'mini-game-body';
    const best = node('span', 'game-best', `最高 ${gameRuntime.state().best}`);
    gamePauseButton = iconAction('Ⅱ', '暂停或继续', () => gameRuntime.togglePause());
    gamePauseLayer = node('div', 'game-state-layer pause-layer', [
      node('strong', '', '已暂停'),
      actionButton('继续', () => gameRuntime.setPaused(false))
    ]);
    gamePauseLayer.hidden = true;
    const resultLayer = node('div', 'game-state-layer result-layer');
    resultLayer.hidden = true;
    body.append(gamePauseLayer, resultLayer);
    const heading = node('div', 'game-toolbar', [
      iconAction('←', '选择其他游戏', () => showGameMenu(false)),
      node('div', 'game-title', [node('strong', '', title), node('small', '', instructions)]),
      node('span', 'score-wrap', [node('small', '', '得分'), score, best]),
      gamePauseButton,
      iconAction('↻', '重新开始', () => startGame(activeGame)),
      iconAction('×', '结束休息', closeGameOverlay)
    ]);
    panel.replaceChildren(heading, body);
    gameOverlay.hidden = false;
    return { panel, body, score, best, resultLayer };
  }

  function iconAction(label, title, handler) {
    const button = node('button', 'mini-icon-button', label);
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', handler);
    return button;
  }

  function closeGameOverlay() {
    stopGame();
    gameOverlay.hidden = true;
    if (breakReminderEnabled) scheduleBreak();
    openGameButton.focus();
  }

  function stopGame() {
    clearTimeout(gameTimer);
    clearInterval(gameTimer);
    cancelAnimationFrame(gameFrame);
    gameTimer = undefined;
    gameFrame = undefined;
    gameCountdownCancel?.();
    gameCountdownCancel = undefined;
    gamePauseButton = undefined;
    gamePauseLayer = undefined;
    gameInputReset?.();
    gameInputReset = undefined;
    gameResizeCleanup?.();
    gameResizeCleanup = undefined;
    gameCleanup.forEach((cleanup) => cleanup());
    gameCleanup = [];
    activeGame = undefined;
    gameKeyHandler = undefined;
    gameKeyUpHandler = undefined;
  }

  function setGameScore(ui, value) {
    const state = gameRuntime.setScore(value);
    ui.score.textContent = String(state.score);
    if (ui.best) ui.best.textContent = `最高 ${state.best}`;
  }

  function finishGame(ui, message, detail) {
    gameRuntime.finish();
    gameInputReset?.();
    if (gamePauseLayer) gamePauseLayer.hidden = true;
    ui.resultLayer.hidden = false;
    ui.resultLayer.replaceChildren(
      node('strong', '', message),
      detail ? node('span', '', detail) : document.createTextNode(''),
      node('div', 'result-actions', [
        actionButton('再来一局', () => startGame(activeGame)),
        actionButton('选择游戏', () => showGameMenu(false))
      ])
    );
  }

  function start2048() {
    const ui = gameShell('2048', '方向键或下方按钮移动');
    const game = LinuxDoGameCore.create2048();
    const grid = node('div', 'game-board game-2048');
    const backgrounds = node('div', 'tile-backgrounds');
    const tileLayer = node('div', 'tile-layer');
    backgrounds.replaceChildren(...Array.from({ length: 16 }, () => node('span', 'tile-background')));
    grid.append(backgrounds, tileLayer);
    const status = node('p', 'game-status', '每局可撤销一次');
    const undoButton = actionButton('撤销一次', undo);
    undoButton.disabled = true;
    const tileNodes = new Map();
    let animating = false;
    let queuedDirection;
    ui.body.append(grid, directionPad(move), node('div', 'game-inline-actions', undoButton), status);
    observeGameSize(ui, grid, 'square', () => renderStatic(game.state()));

    function move(direction) {
      if (gameRuntime.state().paused || gameRuntime.state().finished) return;
      if (animating) {
        queuedDirection = direction;
        return;
      }
      const result = game.move(direction);
      if (result.moved) {
        animateMove(result);
      } else if (result.finished) {
        finishGame(ui, '没有可移动方块', `得分 ${result.score}`);
      }
    }

    function undo() {
      if (gameRuntime.state().paused || animating) return;
      const state = game.undo();
      renderStatic(state, true);
    }

    function makeTile(tile, spawned) {
      const item = node('span', `tile tile-${Math.min(tile.value, 2048)}${spawned ? ' spawned' : ''}`, String(tile.value));
      item.dataset.id = String(tile.id);
      tileNodes.set(tile.id, item);
      tileLayer.append(item);
      position2048Tile(item, tile.index, grid);
      return item;
    }

    function renderStatic(state, undoing = false) {
      const live = new Set(state.tiles.map((tile) => tile.id));
      tileNodes.forEach((item, id) => {
        if (!live.has(id)) {
          item.remove();
          tileNodes.delete(id);
        }
      });
      state.tiles.forEach((tile) => {
        const item = tileNodes.get(tile.id) || makeTile(tile, false);
        item.className = `tile tile-${Math.min(tile.value, 2048)}${undoing ? ' undoing' : ''}`;
        item.textContent = String(tile.value);
        item.style.transition = 'none';
        position2048Tile(item, tile.index, grid);
        requestAnimationFrame(() => { item.style.transition = ''; });
      });
      undoButton.disabled = !state.canUndo;
      status.textContent = state.undoUsed ? '本局撤销已使用' : '每局可撤销一次';
      setGameScore(ui, state.score);
    }

    function animateMove(state) {
      animating = true;
      state.events.filter((event) => event.type === 'move').forEach((event) => {
        const item = tileNodes.get(event.id);
        if (item) {
          item.classList.add('moving');
          requestAnimationFrame(() => position2048Tile(item, event.to, grid));
        }
      });
      gameTimer = setTimeout(() => {
        renderStatic(state);
        state.events.forEach((event) => {
          if (event.merged && !event.removed) tileNodes.get(event.id)?.classList.add('merged');
          if (event.type === 'spawn') tileNodes.get(event.id)?.classList.add('spawned');
        });
        animating = false;
        if (state.finished) finishGame(ui, '本局结束', `得分 ${state.score}`);
        const next = queuedDirection;
        queuedDirection = undefined;
        if (next && !state.finished) move(next);
      }, prefersReducedMotion() ? 20 : 145);
    }

    renderStatic(game.state());
    gameKeyHandler = (event) => handleDirectionKey(event, move);
  }

  function position2048Tile(item, index, grid) {
    const padding = 6;
    const gap = 6;
    const cell = Math.max(0, (grid.clientWidth - padding * 2 - gap * 3) / 4);
    const column = index % 4;
    const row = Math.floor(index / 4);
    item.style.width = `${cell}px`;
    item.style.height = `${cell}px`;
    item.style.transform = `translate(${padding + column * (cell + gap)}px, ${padding + row * (cell + gap)}px)`;
  }

  function startSnake() {
    const ui = gameShell('贪吃蛇', '方向键改变方向');
    const game = LinuxDoGameCore.createSnake({ size: 16 });
    const canvas = node('canvas', 'game-canvas square-canvas');
    const status = node('p', 'game-status', '长度 3 · 速度 1');
    let lastStepAt = performance.now();
    let snakeState = game.state();
    ui.body.append(canvas, directionPad((direction) => game.queueDirection(direction)), status);
    observeGameSize(ui, canvas, 'square', () => draw(performance.now(), false));

    function tick() {
      if (!gameRuntime.state().paused) {
        snakeState = game.step();
        lastStepAt = performance.now();
        setGameScore(ui, snakeState.score);
        status.textContent = `长度 ${snakeState.snake.length} · 速度 ${1 + Math.floor(snakeState.score / 40)}`;
        if (snakeState.finished) {
          finishGame(ui, '撞到了', `得分 ${snakeState.score}`);
          return;
        }
      }
      gameTimer = setTimeout(tick, snakeState.interval);
    }

    function draw(time = performance.now(), scheduleNext = true) {
      const ctx = prepareCanvas(canvas);
      if (!ctx) return;
      const width = canvas.clientWidth;
      const cell = width / snakeState.size;
      ctx.clearRect(0, 0, width, width);
      ctx.fillStyle = canvasColor('--vscode-sideBar-background', '#252526');
      ctx.fillRect(0, 0, width, width);
      ctx.strokeStyle = canvasColor('--line', 'rgba(127,127,127,.22)');
      ctx.lineWidth = 1;
      for (let line = 1; line < snakeState.size; line += 1) {
        const point = Math.round(line * cell) + 0.5;
        ctx.beginPath();
        ctx.moveTo(point, 0); ctx.lineTo(point, width);
        ctx.moveTo(0, point); ctx.lineTo(width, point);
        ctx.stroke();
      }
      const pulse = prefersReducedMotion() ? 1 : 0.9 + Math.sin(time / 170) * 0.08;
      ctx.fillStyle = canvasColor('--vscode-testing-iconPassed', '#4da665');
      ctx.beginPath();
      ctx.arc((snakeState.food.x + 0.5) * cell, (snakeState.food.y + 0.5) * cell, cell * 0.28 * pulse, 0, Math.PI * 2);
      ctx.fill();
      const progress = gameRuntime.state().paused ? 1 : Math.min(1, (time - lastStepAt) / snakeState.interval);
      snakeState.snake.slice().reverse().forEach((part, reverseIndex) => {
        const index = snakeState.snake.length - reverseIndex - 1;
        const previous = snakeState.previous[index] || part;
        const x = previous.x + (part.x - previous.x) * progress;
        const y = previous.y + (part.y - previous.y) * progress;
        ctx.fillStyle = index === 0 ? canvasColor('--vscode-button-background', '#2f7cc0') : canvasColor('--vscode-textLink-foreground', '#3794d0');
        roundedRect(ctx, x * cell + cell * 0.1, y * cell + cell * 0.1, cell * 0.8, cell * 0.8, cell * 0.22);
        ctx.fill();
      });
      const head = snakeState.snake[0];
      const eyeBaseX = (head.x + 0.5 + snakeState.direction.x * 0.18) * cell;
      const eyeBaseY = (head.y + 0.5 + snakeState.direction.y * 0.18) * cell;
      ctx.fillStyle = canvasColor('--vscode-button-foreground', '#ffffff');
      ctx.beginPath(); ctx.arc(eyeBaseX, eyeBaseY, Math.max(1.2, cell * 0.065), 0, Math.PI * 2); ctx.fill();
      if (scheduleNext && !snakeState.finished) gameFrame = requestAnimationFrame((next) => draw(next, true));
    }

    draw(performance.now(), true);
    gameTimer = setTimeout(tick, snakeState.interval);
    gameKeyHandler = (event) => handleDirectionKey(event, (direction) => game.queueDirection(direction));
  }

  function startRacer() {
    const ui = gameShell('公路闪避', '左右键连续转向');
    const game = LinuxDoGameCore.createRacer();
    const input = LinuxDoGameCore.createInputState();
    const stepper = LinuxDoGameCore.createFixedStepper(1 / 120, 10);
    const canvas = node('canvas', 'game-canvas racer-canvas');
    const status = node('p', 'game-status', '单条道路内自由转向');
    const controls = holdControls(input, 'left', 'right');
    let racerState = game.state();
    let previousTime;
    ui.body.append(canvas, controls, status);
    observeGameSize(ui, canvas, 'racer', draw);
    gameInputReset = () => { input.reset(); game.setSteer(0); };

    function frame(time) {
      if (previousTime === undefined) previousTime = time;
      const delta = (time - previousTime) / 1000;
      previousTime = time;
      if (!gameRuntime.state().paused && !racerState.finished) {
        game.setSteer(input.axis('left', 'right'));
        stepper.advance(delta, (step) => { racerState = game.step(step); });
        const near = racerState.events.some((event) => event.type === 'near-miss');
        status.textContent = near ? '擦肩 +5' : `速度 ${Math.round(racerState.difficulty.speed * 100)}`;
        setGameScore(ui, racerState.score);
        if (racerState.finished) finishGame(ui, '发生碰撞', `得分 ${racerState.score}`);
      } else stepper.reset();
      draw();
      if (!racerState.finished) gameFrame = requestAnimationFrame(frame);
    }

    function draw() {
      const ctx = prepareCanvas(canvas);
      if (!ctx) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const roadLeft = width * 0.055;
      const roadWidth = width * 0.89;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = canvasColor('--vscode-sideBar-background', '#25282c');
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = canvasColor('--vscode-editor-background', '#1f2327');
      ctx.fillRect(roadLeft, 0, roadWidth, height);
      ctx.fillStyle = canvasColor('--line', '#62676d');
      ctx.fillRect(roadLeft, 0, Math.max(3, width * 0.012), height);
      ctx.fillRect(roadLeft + roadWidth - Math.max(3, width * 0.012), 0, Math.max(3, width * 0.012), height);
      const markerOffset = (racerState.roadOffset * height * 0.28) % (height * 0.18);
      ctx.fillStyle = canvasColor('--vscode-descriptionForeground', '#8a8f96');
      for (let y = -height * 0.2 + markerOffset; y < height; y += height * 0.18) {
        ctx.fillRect(roadLeft + width * 0.018, y, width * 0.012, height * 0.075);
        ctx.fillRect(roadLeft + roadWidth - width * 0.03, y, width * 0.012, height * 0.075);
      }
      racerState.obstacles.forEach((obstacle) => drawCar(ctx, obstacle, width, height, canvasColor('--vscode-errorForeground', '#d56565'), false));
      drawCar(ctx, racerState.player, width, height, canvasColor('--vscode-button-background', '#2f7cc0'), true);
    }

    draw();
    gameFrame = requestAnimationFrame(frame);
    gameKeyHandler = (event) => continuousDirectionKey(event, input, true);
    gameKeyUpHandler = (event) => continuousDirectionKey(event, input, false);
  }

  function startJumper() {
    const ui = gameShell('像素跳跃', '空格或上方向键跳跃');
    const game = LinuxDoGameCore.createJumper();
    const stepper = LinuxDoGameCore.createFixedStepper(1 / 120, 10);
    const canvas = node('canvas', 'game-canvas jumper-canvas');
    const jumpButton = holdButton('跳跃', () => game.pressJump(), () => game.releaseJump(), 'primary-button jump-button');
    const status = node('p', 'game-status', '短按低跳，长按高跳');
    let jumperState = game.state();
    let previousTime;
    ui.body.append(canvas, node('div', 'jump-controls', jumpButton), status);
    observeGameSize(ui, canvas, 'jumper', draw);
    gameInputReset = () => game.releaseJump();

    function frame(time) {
      if (previousTime === undefined) previousTime = time;
      const delta = (time - previousTime) / 1000;
      previousTime = time;
      if (!gameRuntime.state().paused && !jumperState.finished) {
        stepper.advance(delta, (step) => { jumperState = game.step(step); });
        setGameScore(ui, jumperState.score);
        status.textContent = `速度 ${Math.round(jumperState.difficulty.speed * 100)} · ${Math.floor(jumperState.elapsed)} 秒`;
        if (jumperState.finished) finishGame(ui, '碰到障碍', `得分 ${jumperState.score}`);
      } else {
        stepper.reset();
      }
      draw();
      if (!jumperState.finished) gameFrame = requestAnimationFrame(frame);
    }

    function draw() {
      const ctx = prepareCanvas(canvas);
      if (!ctx) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = canvasColor('--vscode-sideBar-background', '#24272b');
      ctx.fillRect(0, 0, width, height);
      const farOffset = (jumperState.elapsed * jumperState.difficulty.speed * width * 0.16) % (width * 0.34);
      ctx.fillStyle = canvasColor('--vscode-editor-background', '#1e2024');
      for (let x = -width * 0.34 - farOffset; x < width; x += width * 0.34) {
        ctx.beginPath();
        ctx.moveTo(x, height * 0.62); ctx.lineTo(x + width * 0.17, height * 0.38); ctx.lineTo(x + width * 0.34, height * 0.62); ctx.closePath(); ctx.fill();
      }
      const ground = jumperState.ground * height;
      ctx.fillStyle = canvasColor('--vscode-editor-background', '#1e1e1e');
      ctx.fillRect(0, ground, width, height - ground);
      ctx.fillStyle = canvasColor('--line', '#555b62');
      ctx.fillRect(0, ground, width, Math.max(2, height * 0.012));
      const stripe = (jumperState.elapsed * jumperState.difficulty.speed * width) % (width * 0.12);
      for (let x = -stripe; x < width; x += width * 0.12) ctx.fillRect(x, ground + height * 0.07, width * 0.06, Math.max(2, height * 0.012));
      jumperState.obstacles.forEach((obstacle) => {
        ctx.fillStyle = canvasColor('--vscode-errorForeground', '#d56565');
        roundedRect(ctx, obstacle.x * width, obstacle.y * height, obstacle.width * width, obstacle.height * height, Math.max(2, width * 0.006));
        ctx.fill();
      });
      drawRunner(ctx, jumperState, width, height);
    }

    draw();
    gameFrame = requestAnimationFrame(frame);
    gameKeyHandler = (event) => {
      if (event.key === ' ' || event.key === 'ArrowUp') {
        if (!event.repeat) game.pressJump();
        return true;
      }
      if (event.key === 'Escape') {
        closeGameOverlay();
        return true;
      }
      return false;
    };
    gameKeyUpHandler = (event) => {
      if (event.key === ' ' || event.key === 'ArrowUp') {
        game.releaseJump();
        return true;
      }
      return false;
    };
  }

  function startMines() {
    const game = LinuxDoGameCore.createMines({ size: 9, mineCount: 10 });
    let mineState = game.state();
    let flagMode = false;
    let elapsedSeconds = 0;
    let timerStarted = false;
    let ignoreClick = false;
    const ui = gameShell('扫雷', '点击翻开，右键或标记模式插旗');
    const grid = node('div', 'game-board mines-grid');
    const buttons = [];
    const flagButton = actionButton('标记', () => {
      flagMode = !flagMode;
      flagButton.classList.toggle('active', flagMode);
      flagButton.setAttribute('aria-pressed', String(flagMode));
    });
    const revealButton = actionButton('展开', () => reveal(mineState.cursor));
    revealButton.classList.add('primary-button');
    const status = node('p', 'game-status');
    for (let index = 0; index < 81; index += 1) {
      const button = node('button', 'mine-cell');
      button.type = 'button';
      button.addEventListener('click', () => {
        if (ignoreClick) { ignoreClick = false; return; }
        if (flagMode) toggleFlag(index); else reveal(index);
      });
      button.addEventListener('contextmenu', (event) => { event.preventDefault(); toggleFlag(index); });
      button.addEventListener('dblclick', (event) => { event.preventDefault(); chord(index); });
      let holdTimer;
      button.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse') return;
        holdTimer = setTimeout(() => { ignoreClick = true; toggleFlag(index); }, 480);
      });
      const clearHold = () => clearTimeout(holdTimer);
      button.addEventListener('pointerup', clearHold);
      button.addEventListener('pointercancel', clearHold);
      button.addEventListener('pointerleave', clearHold);
      buttons.push(button);
      grid.append(button);
    }
    ui.body.append(grid, node('div', 'mine-controls segmented-controls', [revealButton, flagButton]), directionPad(moveCursor), status);
    observeGameSize(ui, grid, 'square', render);

    function startTimer() {
      if (timerStarted) return;
      timerStarted = true;
      gameTimer = setInterval(() => {
        if (!mineState.finished && !gameRuntime.state().paused) {
          elapsedSeconds += 1;
          renderStatus();
        }
      }, 1000);
    }

    function reveal(index) {
      if (gameRuntime.state().paused || mineState.finished) return;
      const wasInitialized = mineState.initialized;
      mineState = game.reveal(index);
      if (!wasInitialized && mineState.initialized) startTimer();
      render(mineState.events);
      completeMines();
    }

    function toggleFlag(index) {
      if (gameRuntime.state().paused || mineState.finished) return;
      mineState = game.toggleFlag(index);
      render();
    }

    function chord(index) {
      if (gameRuntime.state().paused || mineState.finished) return;
      mineState = game.chord(index);
      render(mineState.events);
      completeMines();
    }

    function moveCursor(direction) {
      const movement = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction];
      if (!movement) return;
      mineState = game.moveCursor(movement[0], movement[1]);
      render();
      buttons[mineState.cursor]?.focus({ preventScroll: true });
    }

    function render(events = []) {
      const revealed = new Map();
      events.filter((event) => event.type === 'reveal').forEach((event) => {
        event.indexes.forEach((index, order) => revealed.set(index, order));
      });
      mineState.cells.forEach((cell, index) => {
        const button = buttons[index];
        button.className = `mine-cell${cell.open ? ' open' : ''}${cell.mine && cell.open ? ' mine' : ''}${cell.wrong ? ' wrong' : ''}${index === mineState.triggered ? ' triggered' : ''}${index === mineState.cursor ? ' cursor' : ''}`;
        button.textContent = cell.open ? (cell.mine ? '×' : cell.nearby || '') : cell.flagged ? '⚑' : '';
        button.dataset.nearby = String(cell.nearby);
        button.setAttribute('aria-label', cell.open ? (cell.mine ? '地雷' : cell.nearby ? `周围 ${cell.nearby} 个地雷` : '空白') : cell.flagged ? '已标记' : '未展开');
        if (revealed.has(index) && !prefersReducedMotion()) {
          button.classList.remove('revealing');
          button.style.animationDelay = `${Math.min(180, revealed.get(index) * 12)}ms`;
          requestAnimationFrame(() => button.classList.add('revealing'));
        }
      });
      setGameScore(ui, mineState.opened);
      renderStatus();
    }

    function renderStatus() {
      if (!mineState.finished) status.textContent = `剩余旗帜 ${mineState.remainingFlags} · ${elapsedSeconds} 秒`;
    }

    function completeMines() {
      if (!mineState.finished) return;
      clearInterval(gameTimer);
      finishGame(ui, mineState.won ? '全部安全区域已展开' : '踩到地雷', `${elapsedSeconds} 秒 · 已展开 ${mineState.opened}`);
    }

    render();
    gameKeyHandler = (event) => {
      const direction = directionForKey(event.key);
      if (direction) { moveCursor(direction); return true; }
      if (event.key === 'Enter' || event.key === ' ') { reveal(mineState.cursor); return true; }
      if (event.key.toLowerCase() === 'f') { toggleFlag(mineState.cursor); return true; }
      if (event.key === 'Escape') { closeGameOverlay(); return true; }
      return false;
    };
  }

  function directionPad(handler, horizontalOnly = false) {
    const pad = node('div', `direction-pad${horizontalOnly ? ' horizontal' : ''}`);
    const directions = horizontalOnly ? [['left', '←'], ['right', '→']] : [['up', '↑'], ['left', '←'], ['down', '↓'], ['right', '→']];
    for (const [direction, label] of directions) {
      const button = iconAction(label, direction, () => handler(direction));
      button.dataset.direction = direction;
      pad.append(button);
    }
    return pad;
  }

  function handleDirectionKey(event, handler) {
    const direction = directionForKey(event.key);
    if (!direction) return event.key === 'Escape' ? (closeGameOverlay(), true) : false;
    handler(direction);
    return true;
  }

  function directionForKey(key) {
    return { ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right' }[key];
  }

  function continuousDirectionKey(event, input, pressed) {
    const direction = directionForKey(event.key);
    if (direction === 'left' || direction === 'right') {
      if (pressed) input.press(direction); else input.release(direction);
      return true;
    }
    if (pressed && event.key === 'Escape') { closeGameOverlay(); return true; }
    return false;
  }

  function holdControls(input, leftAction, rightAction) {
    const controls = node('div', 'hold-controls');
    controls.append(
      holdButton('←', () => input.press(leftAction), () => input.release(leftAction), 'hold-control'),
      holdButton('→', () => input.press(rightAction), () => input.release(rightAction), 'hold-control')
    );
    return controls;
  }

  function holdButton(label, onPress, onRelease, className) {
    const button = node('button', className || '', label);
    button.type = 'button';
    const press = (event) => {
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      onPress();
    };
    const release = (event) => {
      event?.preventDefault();
      onRelease();
    };
    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    return button;
  }

  function observeGameSize(ui, stage, kind, onResize) {
    gameResizeCleanup?.();
    let frame;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const toolbar = ui.panel.querySelector('.game-toolbar');
        const siblings = [...ui.body.children].filter((item) => item !== stage && !item.classList.contains('game-state-layer'));
        const reserved = siblings.reduce((height, item) => height + item.getBoundingClientRect().height, 0) + Math.max(0, siblings.length) * 8;
        const availableWidth = Math.max(180, ui.body.clientWidth);
        const availableHeight = Math.max(170, ui.panel.clientHeight - (toolbar?.offsetHeight || 0) - reserved - 42);
        let width;
        let height;
        if (kind === 'square') {
          width = height = Math.min(440, availableWidth, availableHeight);
        } else {
          const ratio = kind === 'racer' ? (availableWidth < 520 ? 0.8 : 1.6) : (availableWidth < 520 ? 4 / 3 : 16 / 9);
          width = Math.min(kind === 'racer' ? 640 : 720, availableWidth);
          height = width / ratio;
          if (height > availableHeight) {
            height = availableHeight;
            width = Math.min(availableWidth, height * ratio);
          }
        }
        stage.style.width = `${Math.max(kind === 'square' ? 160 : 180, Math.floor(width))}px`;
        stage.style.height = `${Math.max(160, Math.floor(height))}px`;
        ui.panel.classList.toggle('game-compact', ui.panel.clientWidth < 430 || ui.panel.clientHeight < 570);
        onResize?.();
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(ui.panel);
    observer.observe(ui.body);
    update();
    gameResizeCleanup = () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }

  function prepareCanvas(canvas) {
    const width = Math.max(1, Math.round(canvas.clientWidth));
    const height = Math.max(1, Math.round(canvas.clientHeight));
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return context;
  }

  function canvasColor(variable, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || fallback;
  }

  function roundedRect(context, x, y, width, height, radius) {
    const value = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + value, y);
    context.arcTo(x + width, y, x + width, y + height, value);
    context.arcTo(x + width, y + height, x, y + height, value);
    context.arcTo(x, y + height, x, y, value);
    context.arcTo(x, y, x + width, y, value);
    context.closePath();
  }

  function drawCar(context, car, width, height, color, player) {
    const carWidth = car.width * width;
    const carHeight = car.height * height;
    const x = car.x * width - carWidth / 2;
    const y = car.y * height;
    context.fillStyle = color;
    roundedRect(context, x, y, carWidth, carHeight, Math.max(3, carWidth * 0.18));
    context.fill();
    context.fillStyle = player ? canvasColor('--vscode-button-foreground', '#ffffff') : canvasColor('--vscode-editor-background', '#252525');
    roundedRect(context, x + carWidth * 0.18, y + carHeight * 0.18, carWidth * 0.64, carHeight * 0.28, 2);
    context.fill();
    context.fillStyle = canvasColor('--vscode-editor-background', '#202020');
    context.fillRect(x - carWidth * 0.05, y + carHeight * 0.22, carWidth * 0.1, carHeight * 0.22);
    context.fillRect(x + carWidth * 0.95, y + carHeight * 0.22, carWidth * 0.1, carHeight * 0.22);
    context.fillRect(x - carWidth * 0.05, y + carHeight * 0.66, carWidth * 0.1, carHeight * 0.22);
    context.fillRect(x + carWidth * 0.95, y + carHeight * 0.66, carWidth * 0.1, carHeight * 0.22);
  }

  function drawRunner(context, state, width, height) {
    const player = state.player;
    const x = player.x * width;
    const y = player.y * height;
    const playerWidth = player.width * width;
    const playerHeight = player.height * height;
    const runPhase = Math.floor(state.elapsed * 12) % 2;
    context.fillStyle = canvasColor('--vscode-button-background', '#2f7cc0');
    roundedRect(context, x, y, playerWidth, playerHeight * 0.72, Math.max(2, playerWidth * 0.15));
    context.fill();
    context.fillRect(x + (runPhase ? playerWidth * 0.12 : playerWidth * 0.52), y + playerHeight * 0.66, playerWidth * 0.30, playerHeight * 0.34);
    context.fillStyle = canvasColor('--vscode-button-foreground', '#ffffff');
    context.fillRect(x + playerWidth * 0.66, y + playerHeight * 0.18, Math.max(2, playerWidth * 0.1), Math.max(2, playerWidth * 0.1));
  }

  function prefersReducedMotion() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  function renderLoading() {
    setContent(node('div', 'loading', [node('span', 'spinner'), node('span', '', '正在加载公开内容…')]));
  }

  function renderCloudflare(message) {
    const wrapper = node('section', 'state-page');
    wrapper.append(
      node('div', 'state-icon shield-icon', '✓'),
      node('h1', '', '需要 Cloudflare 验证'),
      node('p', '', String(message.message || '请先在浏览器中完成人机验证。')),
      actionButton(message.hasClearance ? '更新验证参数' : '填写验证参数', () => vscode.postMessage({ type: 'cloudflareSetup' }))
    );
    const note = node('p', 'privacy-note', '只保留游客验证白名单，不读取或保存论坛登录状态。');
    wrapper.append(note);
    setContent(wrapper);
  }

  function renderError(message) {
    const wrapper = node('section', 'state-page');
    wrapper.append(
      node('div', 'state-icon', '!'),
      node('h1', '', '暂时无法加载'),
      node('p', '', String(message || '未知错误')),
      actionButton('重试', () => vscode.postMessage({ type: 'refresh' }))
    );
    setContent(wrapper);
  }

  function renderTopicList(data, meta) {
    const title = meta.kind === 'top'
      ? '本周热门'
      : meta.kind === 'search'
        ? `搜索：${meta.query || ''}`
        : meta.kind === 'category'
          ? meta.categoryName || '分类主题'
          : '最新主题';

    const section = node('section', 'page');
    const heading = node('div', 'page-heading');
    heading.append(node('div', '', [node('h1', '', title), node('p', 'page-subtitle', '游客可见的公开内容')]));
    section.append(heading);

    const topics = data?.topics || [];
    if (!topics.length) {
      section.append(node('div', 'empty', '没有找到公开主题。'));
    } else {
      const list = node('div', 'topic-list');
      topics.forEach((topic) => list.append(createTopicRow(topic)));
      section.append(list);
    }
    const loadMore = node('div', 'load-more list-load-more');
    loadMore.id = 'topic-list-load-more';
    section.append(loadMore);
    setContent(section);
    topicListState = {
      hasMore: Boolean(data?.morePath),
      loading: false,
      loadedTopicCount: topics.length,
      error: ''
    };
    currentPageCacheable = true;
    updateTopicListFooter();
  }

  function createTopicRow(topic) {
    const article = node('article', 'topic-row');
    const button = node('button', 'topic-main');
    button.type = 'button';
    button.dataset.topicId = String(topic.id);
    button.dataset.topicSlug = topic.slug || 'topic';

    const text = node('div', 'topic-text');
    text.append(node('h2', '', topic.title || '未命名主题'));
    if (topic.excerpt) text.append(node('p', 'excerpt', topic.excerpt));
    const meta = node('div', 'topic-meta');
    if (topic.poster?.name) meta.append(node('span', '', topic.poster.name));
    meta.append(node('span', '', relativeTime(topic.bumpedAt)));
    text.append(meta);

    if (topic.poster?.avatar) {
      const avatar = document.createElement('img');
      avatar.className = 'avatar';
      avatar.src = topic.poster.avatar;
      avatar.alt = '';
      avatar.loading = 'lazy';
      button.append(avatar);
    } else {
      button.append(node('span', 'avatar avatar-fallback', (topic.poster?.name || '?').slice(0, 1).toUpperCase()));
    }
    button.append(text);

    const stats = node('div', 'topic-stats');
    stats.append(stat(formatNumber(topic.replyCount), '回复'), stat(formatNumber(topic.views), '浏览'));
    article.append(button, stats);
    return article;
  }

  function renderCategories(categories) {
    const section = node('section', 'page');
    const heading = node('div', 'page-heading');
    heading.append(node('div', '', [node('h1', '', '浏览分类'), node('p', 'page-subtitle', '选择一个公开分类')]));
    section.append(heading);

    const grid = node('div', 'category-grid');
    (categories || []).forEach((category) => {
      const button = node('button', 'category-item');
      button.type = 'button';
      button.dataset.categoryId = String(category.id);
      button.dataset.categoryName = category.name;
      const marker = node('span', 'category-marker');
      marker.style.backgroundColor = safeColor(category.color);
      const body = node('span', 'category-body');
      body.append(node('strong', '', category.name));
      if (category.description) body.append(node('span', 'category-description', category.description));
      body.append(node('small', '', `${formatNumber(category.topicCount)} 个主题`));
      button.append(marker, body);
      grid.append(button);
    });
    section.append(grid);
    setContent(section);
    currentPageCacheable = true;
  }

  function renderTopic(topic) {
    const section = node('article', 'topic-page');
    const header = node('header', 'topic-header');
    const titleBox = node('div', 'topic-title-box');
    titleBox.append(node('h1', '', topic.title || '未命名主题'));
    titleBox.append(node('div', 'topic-summary', [
      node('span', '', `${formatNumber(topic.views)} 浏览`),
      node('span', '', `${formatNumber(topic.replyCount)} 回复`),
      node('span', '', `${formatNumber(topic.likeCount)} 赞`)
    ]));
    const original = document.createElement('a');
    original.className = 'secondary-button';
    original.href = topic.externalUrl;
    original.textContent = '浏览器打开';
    header.append(titleBox, original);
    section.append(header);

    const posts = node('div', 'post-list');
    (topic.posts || []).forEach((post) => posts.append(createPost(post)));
    if (!topic.posts?.length) posts.append(node('div', 'empty', '这个主题暂时没有可显示的帖子。'));
    const loadMore = node('div', 'load-more');
    loadMore.id = 'load-more';
    section.append(posts, loadMore);
    setContent(section);
    topicState = {
      id: Number(topic.id),
      remainingPostIds: [...(topic.remainingPostIds || [])],
      totalPostCount: Number(topic.totalPostCount || topic.posts?.length || 0),
      loadedPostCount: topic.posts?.length || 0,
      loading: false,
      error: ''
    };
    currentPageCacheable = true;
    updateLoadMoreFooter();
  }

  function createPost(post) {
    const article = node('section', 'post');
    article.dataset.postId = String(post.id || '');
    const header = node('header', 'post-header');
    if (post.avatar) {
      const avatar = document.createElement('img');
      avatar.className = 'avatar post-avatar';
      avatar.src = post.avatar;
      avatar.alt = '';
      avatar.loading = 'lazy';
      header.append(avatar);
    }
    const identity = node('div', 'post-identity');
    identity.append(node('strong', '', post.displayName || post.username), node('span', '', `@${post.username || 'unknown'}`));
    const info = node('div', 'post-info');
    info.append(node('span', '', `#${post.number || ''}`), node('time', '', formatDate(post.createdAt)));
    header.append(identity, info);

    const body = node('div', 'post-body');
    body.append(sanitizeCooked(post.cooked || ''));
    article.append(header, body);
    return article;
  }

  function requestMorePosts() {
    if (!topicState || topicState.loading || !topicState.remainingPostIds.length) return;
    const postIds = topicState.remainingPostIds.slice(0, 20);
    topicState.loading = true;
    topicState.error = '';
    updateLoadMoreFooter();
    vscode.postMessage({ type: 'loadMorePosts', topicId: topicState.id, postIds });
  }

  function appendMorePosts(message) {
    if (!topicState || Number(message.topicId) !== topicState.id) return;
    const requested = new Set((message.requestedPostIds || []).map(Number));
    topicState.remainingPostIds = topicState.remainingPostIds.filter((postId) => !requested.has(Number(postId)));
    topicState.loading = false;
    topicState.error = '';

    const postList = content.querySelector('.post-list');
    postList.querySelector('.empty')?.remove();
    const existing = new Set([...postList.querySelectorAll('[data-post-id]')].map((element) => Number(element.dataset.postId)));
    const posts = [...(message.posts || [])].sort((left, right) => Number(left.number) - Number(right.number));
    for (const post of posts) {
      if (!existing.has(Number(post.id))) {
        postList.append(createPost(post));
        existing.add(Number(post.id));
        topicState.loadedPostCount += 1;
      }
    }
    updateLoadMoreFooter();
  }

  function showMorePostsError(message) {
    if (!topicState || Number(message.topicId) !== topicState.id) return;
    topicState.loading = false;
    topicState.error = String(message.message || '加载失败，请重试。');
    updateLoadMoreFooter();
  }

  function updateLoadMoreFooter() {
    const footer = document.getElementById('load-more');
    if (!footer || !topicState) return;
    disconnectLoadMoreObserver();
    footer.replaceChildren();

    if (topicState.error) {
      footer.append(node('span', 'load-more-error', topicState.error));
    }
    if (topicState.remainingPostIds.length) {
      const button = node('button', 'load-more-button');
      button.type = 'button';
      button.dataset.loadMore = 'true';
      button.disabled = topicState.loading;
      button.textContent = topicState.loading
        ? '正在加载…'
        : `加载更多 · 剩余 ${topicState.remainingPostIds.length}`;
      footer.append(button);
      if (!topicState.loading) {
        loadMoreObserver = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) requestMorePosts();
        }, { rootMargin: '120px 0px' });
        loadMoreObserver.observe(footer);
      }
    } else {
      footer.append(node('span', 'load-complete', `已显示全部 ${topicState.totalPostCount || topicState.loadedPostCount} 条帖子`));
    }
  }

  function disconnectLoadMoreObserver() {
    loadMoreObserver?.disconnect();
    loadMoreObserver = undefined;
  }

  function requestMoreTopics() {
    if (!topicListState || topicListState.loading || !topicListState.hasMore) return;
    topicListState.loading = true;
    topicListState.error = '';
    updateTopicListFooter();
    vscode.postMessage({ type: 'loadMoreTopics' });
  }

  function appendMoreTopics(message) {
    if (!topicListState) return;
    const list = content.querySelector('.topic-list');
    if (!list) return;
    const existing = new Set([...list.querySelectorAll('[data-topic-id]')].map((element) => Number(element.dataset.topicId)));
    for (const topic of message.topics || []) {
      if (!existing.has(Number(topic.id))) {
        list.append(createTopicRow(topic));
        existing.add(Number(topic.id));
        topicListState.loadedTopicCount += 1;
      }
    }
    topicListState.loading = false;
    topicListState.hasMore = Boolean(message.hasMore);
    topicListState.error = '';
    updateTopicListFooter();
  }

  function showMoreTopicsError(message) {
    if (!topicListState) return;
    topicListState.loading = false;
    topicListState.error = String(message.message || '加载失败，请重试。');
    updateTopicListFooter();
  }

  function updateTopicListFooter() {
    const footer = document.getElementById('topic-list-load-more');
    if (!footer || !topicListState) return;
    disconnectTopicListObserver();
    footer.replaceChildren();
    if (topicListState.error) footer.append(node('span', 'load-more-error', topicListState.error));

    if (topicListState.hasMore) {
      const button = node('button', 'load-more-button');
      button.type = 'button';
      button.dataset.loadMoreTopics = 'true';
      button.disabled = topicListState.loading;
      button.textContent = topicListState.loading ? '正在加载更多主题…' : '加载更多主题';
      footer.append(button);
      if (!topicListState.loading) {
        topicListObserver = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) requestMoreTopics();
        }, { rootMargin: '160px 0px' });
        topicListObserver.observe(footer);
      }
    } else {
      footer.append(node('span', 'load-complete', `已显示 ${topicListState.loadedTopicCount} 个主题`));
    }
  }

  function disconnectTopicListObserver() {
    topicListObserver?.disconnect();
    topicListObserver = undefined;
  }

  function navigate(message) {
    saveCurrentPage();
    vscode.postMessage(message);
  }

  function saveCurrentPage() {
    if (!currentPageCacheable || !Number.isInteger(currentEntryId)) return;
    pageCache.delete(currentEntryId);
    pageCache.set(currentEntryId, {
      nodes: [...content.childNodes],
      scrollY: window.scrollY,
      topicState: cloneTopicState(topicState),
      topicListState: cloneTopicListState(topicListState)
    });
    while (pageCache.size > 20) {
      pageCache.delete(pageCache.keys().next().value);
    }
  }

  function restoreCachedPage(entryId) {
    const snapshot = pageCache.get(entryId);
    if (!snapshot) return false;
    disconnectLoadMoreObserver();
    disconnectTopicListObserver();
    content.replaceChildren(...snapshot.nodes);
    topicState = cloneTopicState(snapshot.topicState);
    topicListState = cloneTopicListState(snapshot.topicListState);
    currentPageCacheable = true;
    if (topicState) updateLoadMoreFooter();
    if (topicListState) updateTopicListFooter();
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: snapshot.scrollY, behavior: 'instant' })));
    return true;
  }

  function cloneTopicState(value) {
    if (!value) return undefined;
    return { ...value, remainingPostIds: [...value.remainingPostIds], loading: false };
  }

  function cloneTopicListState(value) {
    if (!value) return undefined;
    return { ...value, loading: false };
  }

  function sanitizeCooked(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const allowedTags = new Set([
      'P', 'BR', 'A', 'IMG', 'PRE', 'CODE', 'BLOCKQUOTE', 'UL', 'OL', 'LI',
      'STRONG', 'EM', 'B', 'I', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR',
      'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'DIV', 'SPAN', 'DETAILS',
      'SUMMARY', 'DEL', 'INS', 'KBD', 'MARK', 'SUP', 'SUB', 'FIGURE', 'FIGCAPTION'
    ]);
    const allowedAttributes = new Set(['href', 'src', 'alt', 'title', 'width', 'height', 'class', 'loading']);

    [...template.content.querySelectorAll('*')].forEach((element) => {
      if (!allowedTags.has(element.tagName)) {
        element.replaceWith(...element.childNodes);
        return;
      }
      [...element.attributes].forEach((attribute) => {
        if (!allowedAttributes.has(attribute.name.toLowerCase())) {
          element.removeAttribute(attribute.name);
        }
      });
      if (element.hasAttribute('href') && !safeHttpUrl(element.getAttribute('href'))) {
        element.removeAttribute('href');
      }
      if (element.hasAttribute('src') && !safeImageUrl(element.getAttribute('src'))) {
        element.removeAttribute('src');
      }
      if (element.tagName === 'IMG') {
        element.loading = 'lazy';
      }
    });
    return template.content;
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(value, 'https://linux.do');
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  }

  function safeImageUrl(value) {
    if (/^data:image\/(png|gif|jpe?g|webp);base64,/i.test(value || '')) return true;
    return safeHttpUrl(value);
  }

  function parseLinuxDoTopic(value) {
    try {
      const url = new URL(value);
      if (url.hostname !== 'linux.do') return null;
      const match = url.pathname.match(/^\/t\/(?:([^/]+)\/)?(\d+)/);
      return match ? { slug: match[1] || 'topic', id: Number(match[2]) } : null;
    } catch {
      return null;
    }
  }

  function actionButton(label, handler) {
    const button = node('button', 'primary-button', label);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
  }

  function stat(value, label) {
    return node('span', 'stat', [node('strong', '', value), node('small', '', label)]);
  }

  function node(tag, className = '', children) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (Array.isArray(children)) element.append(...children);
    else if (children instanceof Node) element.append(children);
    else if (children !== undefined) element.textContent = String(children);
    return element;
  }

  function setContent(element) {
    disconnectLoadMoreObserver();
    disconnectTopicListObserver();
    topicState = undefined;
    topicListState = undefined;
    currentPageCacheable = false;
    content.replaceChildren(element);
    content.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('zh-CN', { notation: Number(value) >= 10_000 ? 'compact' : 'standard' }).format(Number(value) || 0);
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function relativeTime(value) {
    if (!value) return '';
    const date = new Date(value);
    const seconds = Math.round((date.valueOf() - Date.now()) / 1000);
    if (!Number.isFinite(seconds)) return '';
    const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
    const ranges = [[86400 * 365, 'year'], [86400 * 30, 'month'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
    for (const [amount, unit] of ranges) {
      if (Math.abs(seconds) >= amount) return formatter.format(Math.round(seconds / amount), unit);
    }
    return formatter.format(seconds, 'second');
  }

  function safeColor(value) {
    return /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#888888';
  }

  vscode.postMessage({ type: 'ready' });
})();

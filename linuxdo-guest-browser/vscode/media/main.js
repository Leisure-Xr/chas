(() => {
  'use strict';

  const vscode = acquireVsCodeApi();
  const content = document.getElementById('content');
  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('search-input');
  const backButton = document.getElementById('back');
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
  let activeGame;
  let gameKeyHandler;
  const pageCache = new Map();
  const gameOverlay = createGameOverlay();
  const gameRuntime = LinuxDoGameCore.createRuntime({
    bestScores: savedState.gameBestScores || {},
    onBestScore: () => {
      savedState = { ...savedState, gameBestScores: gameRuntime.bestScores() };
      vscode.setState(savedState);
    },
    onPause: (paused) => {
      if (gamePauseButton) gamePauseButton.textContent = paused ? '继续' : '暂停';
    }
  });

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
    if (!gameOverlay.hidden && gameKeyHandler?.(event)) {
      event.preventDefault();
      return;
    }
    if (event.altKey && event.key === 'ArrowLeft' && !backButton.disabled) {
      event.preventDefault();
      navigate({ type: 'back' });
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !gameOverlay.hidden && activeGame) gameRuntime.setPaused(true);
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
    activeGame = kind;
    gameRuntime.start(kind);
    const launch = () => {
      if (kind === 'snake') startSnake();
      else if (kind === 'racer') startRacer();
      else if (kind === 'jumper') startJumper();
      else if (kind === 'mines') startMines();
      else start2048();
    };
    const panel = gameOverlay.querySelector('.break-panel');
    const countdownValue = node('strong', 'countdown-value', '3');
    panel.replaceChildren(node('div', 'countdown-panel', [node('span', '', '准备'), countdownValue]));
    gameOverlay.hidden = false;
    gameCountdownCancel = LinuxDoGameCore.countdown((value) => { countdownValue.textContent = String(value); }, launch);
  }

  function gameShell(title, instructions) {
    const panel = gameOverlay.querySelector('.break-panel');
    const score = node('strong', 'game-score', '0');
    score.id = 'mini-game-score';
    const body = node('div', 'game-body');
    body.id = 'mini-game-body';
    const best = node('span', 'game-best', `最高 ${gameRuntime.state().best}`);
    gamePauseButton = iconAction('Ⅱ', '暂停或继续', () => gameRuntime.togglePause());
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
    return { body, score, best };
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
    clearInterval(gameTimer);
    cancelAnimationFrame(gameFrame);
    gameTimer = undefined;
    gameFrame = undefined;
    gameCountdownCancel?.();
    gameCountdownCancel = undefined;
    gamePauseButton = undefined;
    activeGame = undefined;
    gameKeyHandler = undefined;
  }

  function setGameScore(ui, value) {
    const state = gameRuntime.setScore(value);
    ui.score.textContent = String(state.score);
    if (ui.best) ui.best.textContent = `最高 ${state.best}`;
  }

  function finishGame(status, message) {
    gameRuntime.finish();
    status.replaceChildren(node('strong', '', message), actionButton('再来一局', () => startGame(activeGame)));
  }

  function start2048() {
    let board = Array(16).fill(0);
    let scoreValue = 0;
    let undoState;
    const ui = gameShell('2048', '方向键或下方按钮移动');
    const grid = node('div', 'game-grid game-2048');
    const status = node('p', 'game-status', '合并相同数字，尽量得到 2048。');
    const undoButton = actionButton('撤销一次', undo);
    undoButton.disabled = true;
    ui.body.append(grid, directionPad((direction) => move(direction)), node('div', 'game-inline-actions', undoButton), status);

    function addTile() {
      const empty = board.map((value, index) => value ? -1 : index).filter((index) => index >= 0);
      if (!empty.length) return;
      board[empty[Math.floor(Math.random() * empty.length)]] = Math.random() < 0.9 ? 2 : 4;
    }

    function move(direction) {
      if (gameRuntime.state().paused) return;
      const result = LinuxDoGameCore.move2048(board, direction);
      if (result.moved) {
        undoState = { board: board.slice(), score: scoreValue };
        undoButton.disabled = false;
        board = result.board;
        scoreValue += result.gained;
        addTile();
        render();
      }
      if (!canMove2048(board)) finishGame(status, '本局结束');
    }

    function undo() {
      if (!undoState || gameRuntime.state().paused) return;
      board = undoState.board;
      scoreValue = undoState.score;
      undoState = undefined;
      undoButton.disabled = true;
      render();
    }

    function render() {
      grid.replaceChildren(...board.map((value) => {
        const tile = node('span', `tile tile-${Math.min(value, 2048)}`, value || '');
        return tile;
      }));
      setGameScore(ui, scoreValue);
    }

    addTile();
    addTile();
    render();
    gameKeyHandler = (event) => handleDirectionKey(event, move);
  }

  function lineIndexes(direction, line) {
    const forward = direction === 'left' || direction === 'up';
    const indexes = [];
    for (let step = 0; step < 4; step += 1) {
      const position = forward ? step : 3 - step;
      indexes.push(direction === 'left' || direction === 'right' ? line * 4 + position : position * 4 + line);
    }
    return indexes;
  }

  function canMove2048(board) {
    if (board.some((value) => !value)) return true;
    return board.some((value, index) =>
      (index % 4 < 3 && value === board[index + 1]) || (index < 12 && value === board[index + 4]));
  }

  function startSnake() {
    const size = 16;
    let snake = [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }];
    let direction = { x: 1, y: 0 };
    let nextDirection = direction;
    let food = randomFreeCell(size, snake);
    let scoreValue = 0;
    let ended = false;
    const ui = gameShell('贪吃蛇', '方向键改变方向');
    const grid = node('div', 'snake-grid');
    const status = node('p', 'game-status', '吃到亮色方块，避免碰墙和自己。');
    ui.body.append(grid, directionPad(setDirection), status);

    function setDirection(value) {
      const candidate = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }[value];
      if (candidate && (candidate.x !== -direction.x || candidate.y !== -direction.y)) nextDirection = candidate;
    }

    function tick() {
      if (ended || gameRuntime.state().paused) return;
      direction = nextDirection;
      const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };
      const willEat = head.x === food.x && head.y === food.y;
      const collisionBody = willEat ? snake : snake.slice(0, -1);
      if (head.x < 0 || head.y < 0 || head.x >= size || head.y >= size || collisionBody.some((part) => part.x === head.x && part.y === head.y)) {
        ended = true;
        clearInterval(gameTimer);
        finishGame(status, '本局结束');
        return;
      }
      snake.unshift(head);
      if (willEat) {
        scoreValue += 10;
        food = randomFreeCell(size, snake);
      } else {
        snake.pop();
      }
      render();
    }

    function render() {
      const occupied = new Set(snake.map((part) => `${part.x}:${part.y}`));
      const cells = [];
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const key = `${x}:${y}`;
          cells.push(node('span', key === `${food.x}:${food.y}` ? 'snake-cell food' : occupied.has(key) ? 'snake-cell snake' : 'snake-cell'));
        }
      }
      grid.replaceChildren(...cells);
      setGameScore(ui, scoreValue);
    }

    render();
    function scheduleTick() {
      clearTimeout(gameTimer);
      gameTimer = setTimeout(() => {
        tick();
        if (!ended) scheduleTick();
      }, Math.max(72, 145 - scoreValue * 1.2));
    }
    scheduleTick();
    gameKeyHandler = (event) => handleDirectionKey(event, setDirection);
  }

  function randomFreeCell(size, occupied) {
    const used = new Set(occupied.map((part) => `${part.x}:${part.y}`));
    const free = [];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) if (!used.has(`${x}:${y}`)) free.push({ x, y });
    }
    return free[Math.floor(Math.random() * free.length)] || { x: 0, y: 0 };
  }

  function startRacer() {
    let playerX = 50;
    let obstacles = [];
    let scoreValue = 0;
    let ended = false;
    let ticks = 0;
    const ui = gameShell('公路闪避', '左右键连续转向');
    const road = node('div', 'racer-track');
    const player = node('span', 'racer-car', '▲');
    road.append(player);
    const status = node('p', 'game-status', '在一条道路内左右移动，避开迎面障碍。');
    ui.body.append(road, directionPad(moveLane, true), status);

    function moveLane(direction) {
      if (ended || gameRuntime.state().paused) return;
      if (direction === 'left') playerX = Math.max(10, playerX - 8);
      if (direction === 'right') playerX = Math.min(90, playerX + 8);
      render();
    }

    function tick() {
      if (ended || gameRuntime.state().paused) return;
      ticks += 1;
      const speed = 2.2 + Math.min(2.6, scoreValue / 220);
      obstacles.forEach((item) => { item.y += speed; });
      if (ticks % Math.max(18, 34 - Math.floor(scoreValue / 45)) === 0) {
        const item = { x: 12 + Math.random() * 76, y: -12, node: node('span', 'racer-obstacle', '■') };
        obstacles.push(item);
        road.append(item.node);
      }
      if (obstacles.some((item) => item.y > 76 && item.y < 94 && Math.abs(item.x - playerX) < 15)) {
        ended = true;
        clearInterval(gameTimer);
        finishGame(status, '发生碰撞');
      }
      obstacles = obstacles.filter((item) => {
        if (item.y > 108) {
          item.node.remove();
          scoreValue += 10;
          return false;
        }
        return true;
      });
      render();
    }

    function render() {
      player.style.left = `${playerX}%`;
      obstacles.forEach((item) => {
        item.node.style.left = `${item.x}%`;
        item.node.style.top = `${item.y}%`;
      });
      setGameScore(ui, scoreValue);
    }

    render();
    gameTimer = setInterval(tick, 55);
    gameKeyHandler = (event) => handleDirectionKey(event, moveLane);
  }

  function startJumper() {
    const ui = gameShell('像素跳跃', '空格或上方向键跳跃');
    const canvas = document.createElement('canvas');
    canvas.className = 'jumper-canvas';
    canvas.width = 520;
    canvas.height = 260;
    const jumpButton = actionButton('跳跃', jump);
    const status = node('p', 'game-status', '越过障碍，奔跑速度会逐渐提升。');
    ui.body.append(canvas, node('div', 'jump-controls', jumpButton), status);
    const context = canvas.getContext('2d');
    const style = getComputedStyle(document.body);
    const colors = {
      background: style.getPropertyValue('--vscode-editor-background').trim() || '#1e1e1e',
      line: style.getPropertyValue('--line').trim() || '#666666',
      player: style.getPropertyValue('--accent').trim() || '#3977c3',
      obstacle: style.getPropertyValue('--vscode-errorForeground').trim() || '#d35f5f',
      text: style.getPropertyValue('--muted').trim() || '#999999'
    };
    const ground = 220;
    const player = { x: 58, y: ground - 28, width: 23, height: 28, velocity: 0 };
    let obstacles = [];
    let spawnIn = 1.2;
    let elapsed = 0;
    let previousTime;
    let ended = false;

    function jump() {
      if (!ended && !gameRuntime.state().paused && player.y >= ground - player.height - 1) player.velocity = -430;
    }

    function frame(time) {
      if (previousTime === undefined) previousTime = time;
      const delta = Math.min((time - previousTime) / 1000, 0.04);
      previousTime = time;
      if (gameRuntime.state().paused) {
        draw();
        gameFrame = requestAnimationFrame(frame);
        return;
      }
      elapsed += delta;
      player.velocity += 1050 * delta;
      player.y = Math.min(ground - player.height, player.y + player.velocity * delta);
      if (player.y >= ground - player.height) player.velocity = 0;
      spawnIn -= delta;
      const speed = 190 + Math.min(150, elapsed * 4);
      if (spawnIn <= 0) {
        const height = 24 + Math.floor(Math.random() * 28);
        obstacles.push({ x: canvas.width + 10, y: ground - height, width: 20 + Math.floor(Math.random() * 14), height });
        spawnIn = 1.15 + Math.random() * 1.15;
      }
      obstacles = obstacles.map((obstacle) => ({ ...obstacle, x: obstacle.x - speed * delta })).filter((obstacle) => obstacle.x + obstacle.width > 0);
      if (obstacles.some((obstacle) => rectanglesOverlap(player, obstacle))) {
        ended = true;
        finishGame(status, '碰到障碍');
      }
      setGameScore(ui, Math.floor(elapsed * 10));
      draw();
      if (!ended) gameFrame = requestAnimationFrame(frame);
    }

    function draw() {
      context.fillStyle = colors.background;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = colors.line;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(0, ground + 1);
      context.lineTo(canvas.width, ground + 1);
      context.stroke();
      context.fillStyle = colors.player;
      context.fillRect(player.x, player.y, player.width, player.height);
      context.fillStyle = colors.background;
      context.fillRect(player.x + 14, player.y + 6, 4, 4);
      context.fillStyle = colors.obstacle;
      obstacles.forEach((obstacle) => context.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height));
      context.fillStyle = colors.text;
      context.font = '12px sans-serif';
      context.fillText('SPACE / ↑', 12, 20);
    }

    draw();
    gameFrame = requestAnimationFrame(frame);
    gameKeyHandler = (event) => {
      if (event.key === ' ' || event.key === 'ArrowUp') {
        jump();
        return true;
      }
      if (event.key === 'Escape') {
        closeGameOverlay();
        return true;
      }
      return false;
    };
  }

  function rectanglesOverlap(left, right) {
    return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
  }

  function startMines() {
    const size = 9;
    const mineCount = 10;
    let cells = Array.from({ length: size * size }, () => ({ mine: false, open: false, flagged: false, nearby: 0 }));
    let initialized = false;
    let ended = false;
    let flagMode = false;
    let elapsedSeconds = 0;
    const ui = gameShell('扫雷', '点击翻开，右键或标记模式插旗');
    const grid = node('div', 'mines-grid');
    const flagButton = actionButton('标记模式：关', () => {
      flagMode = !flagMode;
      flagButton.textContent = `标记模式：${flagMode ? '开' : '关'}`;
      flagButton.classList.toggle('active', flagMode);
    });
    const status = node('p', 'game-status', `找出安全方格，共 ${mineCount} 个雷。`);
    ui.body.append(grid, node('div', 'mine-controls', flagButton), status);

    function initialize(safeIndex) {
      LinuxDoGameCore.mineIndexes(size, mineCount, safeIndex).forEach((index) => { cells[index].mine = true; });
      cells.forEach((cell, index) => {
        cell.nearby = neighbors(index, size).filter((neighbor) => cells[neighbor].mine).length;
      });
      initialized = true;
      gameTimer = setInterval(() => {
        if (!ended && !gameRuntime.state().paused) {
          elapsedSeconds += 1;
          updateMineStatus();
        }
      }, 1000);
    }

    function interact(index, mark) {
      if (ended || gameRuntime.state().paused || cells[index].open) return;
      if (mark || flagMode) {
        cells[index].flagged = !cells[index].flagged;
        render();
        return;
      }
      if (!initialized) initialize(index);
      if (cells[index].flagged) return;
      if (cells[index].mine) {
        ended = true;
        clearInterval(gameTimer);
        cells.forEach((cell) => { if (cell.mine) cell.open = true; });
        finishGame(status, '踩到雷了');
      } else {
        revealSafe(index);
        const opened = cells.filter((cell) => cell.open).length;
        setGameScore(ui, opened);
        if (opened === size * size - mineCount) {
          ended = true;
          clearInterval(gameTimer);
          finishGame(status, '完成，所有安全方格都找到了');
        }
      }
      render();
    }

    function updateMineStatus() {
      if (ended) return;
      const flags = cells.filter((cell) => cell.flagged).length;
      status.textContent = `剩余旗帜 ${Math.max(0, mineCount - flags)} · ${elapsedSeconds} 秒`;
    }

    function revealSafe(start) {
      const queue = [start];
      const seen = new Set();
      while (queue.length) {
        const index = queue.shift();
        if (seen.has(index) || cells[index].flagged || cells[index].mine) continue;
        seen.add(index);
        cells[index].open = true;
        if (cells[index].nearby === 0) queue.push(...neighbors(index, size));
      }
    }

    function render() {
      grid.replaceChildren(...cells.map((cell, index) => {
        const button = node('button', `mine-cell${cell.open ? ' open' : ''}${cell.mine && cell.open ? ' mine' : ''}`);
        button.type = 'button';
        button.textContent = cell.open ? (cell.mine ? '×' : cell.nearby || '') : cell.flagged ? '!' : '';
        button.dataset.nearby = String(cell.nearby);
        button.addEventListener('click', () => interact(index, false));
        button.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          interact(index, true);
        });
        button.addEventListener('dblclick', () => chord(index));
        return button;
      }));
      updateMineStatus();
    }

    function chord(index) {
      const cell = cells[index];
      if (!cell.open || !cell.nearby || ended) return;
      const nearby = neighbors(index, size);
      if (nearby.filter((neighbor) => cells[neighbor].flagged).length !== cell.nearby) return;
      nearby.forEach((neighbor) => { if (!cells[neighbor].flagged) interact(neighbor, false); });
    }

    render();
    gameKeyHandler = (event) => event.key === 'Escape' ? (closeGameOverlay(), true) : false;
  }

  function neighbors(index, size) {
    const x = index % size;
    const y = Math.floor(index / size);
    const result = [];
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if ((offsetX || offsetY) && nextX >= 0 && nextY >= 0 && nextX < size && nextY < size) result.push(nextY * size + nextX);
      }
    }
    return result;
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
    const direction = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[event.key];
    if (!direction) return event.key === 'Escape' ? (closeGameOverlay(), true) : false;
    handler(direction);
    return true;
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
        }, { rootMargin: '600px 0px' });
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
        }, { rootMargin: '800px 0px' });
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

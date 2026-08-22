(function () {
  'use strict';

  if (window.__lexiaoBreakCleanup) {
    window.__lexiaoBreakCleanup();
  }
  var previous = document.getElementById('lexiao-break-overlay');
  if (previous) {
    previous.remove();
  }

  var pauseButton = null;
  var recommended = __LEXIAO_RECOMMENDED_GAME__;
  var reminderMode = __LEXIAO_REMINDER_MODE__;
  var gameRuntime = window.LinuxDoGameCore.createRuntime({
    bestScores: __LEXIAO_BEST_SCORES__,
    onBestScore: function (game, value) {
      internalAction('score', 'game=' + encodeURIComponent(game) + '&value=' + encodeURIComponent(value));
    },
    onPause: function (paused) {
      if (pauseButton) pauseButton.textContent = paused ? '继续' : '暂停';
    }
  });
  var gameNames = {
    '2048': '2048',
    snake: '贪吃蛇',
    dodge: '公路闪避',
    runner: '像素跳跃',
    mines: '扫雷'
  };
  var intervals = [];
  var animationFrame = 0;
  var keyHandler = null;
  var countdownCancel = null;

  var host = document.createElement('div');
  host.id = 'lexiao-break-overlay';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;';
  var shadow = host.attachShadow({mode: 'open'});
  var style = document.createElement('style');
  style.textContent = [
    ':host{all:initial;color-scheme:light dark}',
    '*{box-sizing:border-box}',
    '.backdrop{position:absolute;inset:0;display:grid;place-items:center;padding:18px;background:rgba(18,21,25,.58);font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--primary,#e7e9ec)}',
    '.panel{width:min(440px,96vw);max-height:92vh;overflow:auto;border:1px solid rgba(142,149,158,.45);border-radius:8px;background:var(--secondary,#202327);box-shadow:0 14px 42px rgba(0,0,0,.28);padding:16px}',
    '.intro{text-align:center;padding:6px 4px 2px}.eyebrow{margin:0 0 5px;color:var(--primary-medium,#9ca3ad);font-size:11px}.intro h2{margin:0;font-size:19px;letter-spacing:0}.intro p{margin:7px auto 0;max-width:340px;color:var(--primary-medium,#aeb4bd)}',
    '.actions{display:flex;flex-wrap:wrap;justify-content:center;gap:7px;margin-top:15px}',
    'button{min-height:30px;border:1px solid rgba(142,149,158,.5);border-radius:5px;background:transparent;color:inherit;padding:5px 10px;font:inherit;cursor:pointer}',
    'button:hover,button:focus-visible{background:rgba(142,149,158,.16);outline:none}button.primary{border-color:var(--tertiary,#4ea1ff);background:var(--tertiary,#3b82c4);color:#fff}button.quiet{border-color:transparent;color:var(--primary-medium,#aeb4bd)}',
    '.game-head{display:flex;align-items:center;gap:8px;margin-bottom:12px}.game-head h2{margin:0;font-size:16px;flex:1}.score{font-variant-numeric:tabular-nums;color:var(--primary-medium,#aeb4bd);white-space:nowrap}',
    '.countdown{min-height:280px;display:grid;place-content:center;justify-items:center;color:var(--primary-medium,#aeb4bd)}.countdown strong{font-size:48px;color:var(--primary,#e7e9ec)}.game-end{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap}',
    '.game-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:14px}.game-card{text-align:left;min-height:62px;padding:9px}.game-card strong,.game-card span{display:block}.game-card span{margin-top:3px;font-size:11px;color:var(--primary-medium,#aeb4bd)}.recommended{color:var(--tertiary,#57a6e6)!important}',
    '.game-status{min-height:20px;margin:8px 0 0;text-align:center;color:var(--primary-medium,#aeb4bd);font-size:12px}',
    '.dpad{display:grid;grid-template-columns:repeat(3,38px);grid-template-rows:repeat(2,32px);justify-content:center;gap:4px;margin:11px auto 0}.dpad button{padding:2px;min-height:32px}.dpad .up{grid-column:2}.dpad .left{grid-column:1;grid-row:2}.dpad .down{grid-column:2;grid-row:2}.dpad .right{grid-column:3;grid-row:2}',
    '.board-2048{width:min(300px,78vw);aspect-ratio:1;margin:auto;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:6px;border-radius:6px;background:rgba(142,149,158,.24)}.tile{display:grid;place-items:center;aspect-ratio:1;border-radius:4px;background:rgba(142,149,158,.12);font-size:18px;font-weight:700}.tile[data-rank="1"]{background:#d9d2c2;color:#242424}.tile[data-rank="2"]{background:#d7c49d;color:#242424}.tile[data-rank="3"]{background:#e6a566;color:#202020}.tile[data-rank="4"]{background:#df8355;color:#fff}.tile[data-rank="5"]{background:#cf6552;color:#fff}.tile[data-rank="6"],.tile[data-rank="7"],.tile[data-rank="8"],.tile[data-rank="9"],.tile[data-rank="10"],.tile[data-rank="11"]{background:#b5964b;color:#fff;font-size:15px}',
    '.cell-board{width:min(312px,82vw);aspect-ratio:1;margin:auto;display:grid;gap:2px;padding:4px;border-radius:6px;background:rgba(142,149,158,.22)}.cell{min-width:0;min-height:0;border:0;border-radius:2px;padding:0;background:rgba(142,149,158,.1)}',
    '.snake{background:var(--tertiary,#4e9bd3)}.snake-head{background:#7ac66b}.food{background:#df6c63;border-radius:50%}',
    '.road{position:relative;width:min(300px,78vw);height:min(420px,58vh);min-height:300px;margin:auto;overflow:hidden;border:1px solid rgba(142,149,158,.38);border-radius:6px;background:#292d32;box-shadow:inset 9px 0 rgba(142,149,158,.18),inset -9px 0 rgba(142,149,158,.18)}.car,.obstacle{position:absolute;width:34px;height:38px;border-radius:5px;transform:translateX(-50%)}.car{bottom:6%;background:#58a6d8;transition:left .09s ease-out}.obstacle{background:#cf665d;transition:top .055s linear}.road-note{text-align:center;font-size:11px;color:var(--primary-medium,#aeb4bd);margin:6px 0}',
    '.runner{display:block;width:100%;height:auto;border:1px solid rgba(142,149,158,.35);border-radius:6px;background:#171a1e;image-rendering:pixelated}',
    '.mine-board{width:min(324px,84vw);aspect-ratio:1;margin:auto;display:grid;grid-template-columns:repeat(9,1fr);gap:2px;padding:4px;border-radius:6px;background:rgba(142,149,158,.22)}.mine-cell{min-width:0;min-height:0;padding:0;border:0;border-radius:2px;background:rgba(142,149,158,.18);font-weight:700;font-size:12px}.mine-cell.open{background:rgba(142,149,158,.05)}.mine-cell.cursor{outline:2px solid var(--tertiary,#58a6d8);outline-offset:-2px}.mine-cell.mine{color:#df6c63}.mine-tools{display:flex;justify-content:center;gap:5px;margin-top:9px}.mine-tools button{min-width:42px}',
    '@media(max-width:390px){.panel{padding:12px}.game-list{grid-template-columns:1fr}.game-head{flex-wrap:wrap}.game-head h2{flex-basis:100%}}'
  ].join('');
  shadow.appendChild(style);
  var backdrop = element('div', 'backdrop');
  var panel = element('section', 'panel');
  backdrop.appendChild(panel);
  shadow.appendChild(backdrop);
  document.documentElement.appendChild(host);

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function makeButton(label, className, handler) {
    var node = element('button', className || '', label);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  }

  function internalAction(action, params) {
    window.location.href = 'https://linux.do/__lexiao_break/' + action + '?t=' + Date.now() + (params ? '&' + params : '');
  }

  function cleanupGame() {
    intervals.forEach(function (id) { clearInterval(id); });
    intervals = [];
    if (countdownCancel) {
      countdownCancel();
      countdownCancel = null;
    }
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
    if (keyHandler) {
      window.removeEventListener('keydown', keyHandler, true);
      keyHandler = null;
    }
    pauseButton = null;
  }

  function bindKeys(handler) {
    if (keyHandler) {
      window.removeEventListener('keydown', keyHandler, true);
    }
    keyHandler = function (event) {
      if (handler(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', keyHandler, true);
  }

  function gameHeader(name, scoreText, restart) {
    cleanupGame();
    panel.replaceChildren();
    var head = element('div', 'game-head');
    head.appendChild(element('h2', '', name));
    var state = gameRuntime.state();
    var score = element('span', 'score', (scoreText || '') + ' · 最高 ' + state.best);
    head.appendChild(score);
    pauseButton = makeButton('暂停', '', function () {
      gameRuntime.togglePause();
    });
    head.appendChild(pauseButton);
    if (restart) {
      head.appendChild(makeButton('重新开始', '', restart));
    }
    head.appendChild(makeButton('选择游戏', '', showGameMenu));
    head.appendChild(makeButton('结束休息', 'quiet', function () { internalAction('continue'); }));
    panel.appendChild(head);
    return score;
  }

  function updateScore(node, value, prefix) {
    var state = gameRuntime.setScore(value);
    node.textContent = (prefix || '得分 ') + state.score + ' · 最高 ' + state.best;
  }

  function finishGame(status, message, restart) {
    gameRuntime.finish();
    status.className = 'game-status game-end';
    status.replaceChildren(element('strong', '', message), makeButton('再来一局', 'primary', restart));
  }

  function directionPad(onDirection) {
    var pad = element('div', 'dpad');
    [
      ['上', 'up', 'up'],
      ['左', 'left', 'left'],
      ['下', 'down', 'down'],
      ['右', 'right', 'right']
    ].forEach(function (item) {
      pad.appendChild(makeButton(item[0], item[1], function () { onDirection(item[2]); }));
    });
    return pad;
  }

  function showReminder() {
    cleanupGame();
    panel.replaceChildren();
    var intro = element('div', 'intro');
    intro.appendChild(element('p', 'eyebrow', (reminderMode ? '休息提醒' : '小游戏') + ' · 本次推荐 ' + gameNames[recommended]));
    intro.appendChild(element('h2', '', reminderMode ? '离开帖子两分钟' : '休息一下'));
    intro.appendChild(element('p', '', reminderMode ? '活动一下肩颈，或者玩一局轻量小游戏。' : '选择一个轻量小游戏，随时回到阅读。'));
    var actions = element('div', 'actions');
    actions.appendChild(makeButton('开始推荐 · ' + gameNames[recommended], 'primary', function () {
      startGame(recommended);
    }));
    actions.appendChild(makeButton('开始 2048', '', function () { startGame('2048'); }));
    actions.appendChild(makeButton('选择游戏', '', showGameMenu));
    if (reminderMode) {
      actions.appendChild(makeButton('10 分钟后提醒', 'quiet', function () { internalAction('snooze'); }));
    }
    actions.appendChild(makeButton('关闭并继续阅读', 'quiet', function () { internalAction('continue'); }));
    intro.appendChild(actions);
    panel.appendChild(intro);
  }

  function showGameMenu() {
    cleanupGame();
    panel.replaceChildren();
    var intro = element('div', 'intro');
    intro.appendChild(element('p', 'eyebrow', '小游戏'));
    intro.appendChild(element('h2', '', '选择一种休息方式'));
    intro.appendChild(element('p', '', '所有游戏都支持键盘和屏幕按钮。'));
    panel.appendChild(intro);
    var list = element('div', 'game-list');
    [
      ['2048', '方向键合并数字'],
      ['snake', '方向键控制移动'],
      ['dodge', '单一道路内自由转向'],
      ['runner', '空格或上键跳跃'],
      ['mines', '方向键移动，回车揭开']
    ].forEach(function (item) {
      var card = makeButton('', 'game-card', function () { startGame(item[0]); });
      card.appendChild(element('strong', '', gameNames[item[0]]));
      card.appendChild(element('span', item[0] === recommended ? 'recommended' : '',
        item[0] === recommended ? '本次推荐 · ' + item[1] : item[1]));
      list.appendChild(card);
    });
    panel.appendChild(list);
    var actions = element('div', 'actions');
    actions.appendChild(makeButton(reminderMode ? '返回提醒' : '返回', '', showReminder));
    actions.appendChild(makeButton('结束休息', 'quiet', function () { internalAction('continue'); }));
    panel.appendChild(actions);
  }

  function startGame(game) {
    cleanupGame();
    gameRuntime.start(game);
    panel.replaceChildren();
    var countdown = element('div', 'countdown');
    countdown.appendChild(element('span', '', '准备'));
    var value = element('strong', '', '3');
    countdown.appendChild(value);
    panel.appendChild(countdown);
    countdownCancel = window.LinuxDoGameCore.countdown(function (next) {
      value.textContent = String(next);
    }, function () { launchGame(game); });
  }

  function launchGame(game) {
    if (game === 'snake') {
      showSnake();
    } else if (game === 'dodge') {
      showDodge();
    } else if (game === 'runner') {
      showRunner();
    } else if (game === 'mines') {
      showMines();
    } else {
      show2048();
    }
  }

  function show2048() {
    var board;
    var scoreNode;
    var status;
    var cells = [];
    var values = [];
    var points = 0;
    var ended = false;
    var undoState = null;

    function restart() {
      gameRuntime.start('2048');
      values = new Array(16).fill(0);
      points = 0;
      ended = false;
      undoState = null;
      undoButton.disabled = true;
      status.className = 'game-status';
      status.textContent = '方向键或屏幕按钮移动';
      addTile();
      addTile();
      render();
    }

    scoreNode = gameHeader('2048', '得分 0', restart);
    board = element('div', 'board-2048');
    for (var i = 0; i < 16; i += 1) {
      var cell = element('div', 'tile');
      cells.push(cell);
      board.appendChild(cell);
    }
    panel.appendChild(board);
    status = element('div', 'game-status', '方向键或屏幕按钮移动');
    panel.appendChild(status);
    panel.appendChild(directionPad(move));
    var undoButton = makeButton('撤销一次', '', undo);
    undoButton.disabled = true;
    panel.appendChild(undoButton);

    function addTile() {
      var empty = [];
      values.forEach(function (value, index) {
        if (!value) {
          empty.push(index);
        }
      });
      if (empty.length) {
        values[empty[Math.floor(Math.random() * empty.length)]] = Math.random() < 0.9 ? 2 : 4;
      }
    }

    function mergeLine(line) {
      var packed = line.filter(Boolean);
      for (var index = 0; index < packed.length - 1; index += 1) {
        if (packed[index] === packed[index + 1]) {
          packed[index] *= 2;
          points += packed[index];
          packed.splice(index + 1, 1);
        }
      }
      while (packed.length < 4) {
        packed.push(0);
      }
      return packed;
    }

    function move(direction) {
      if (ended || gameRuntime.state().paused) {
        return;
      }
      var result = window.LinuxDoGameCore.move2048(values, direction);
      if (result.moved) {
        undoState = {values: values.slice(), points: points};
        undoButton.disabled = false;
        values = result.board;
        points += result.gained;
        addTile();
        render();
      }
      if (!canMove()) {
        ended = true;
        finishGame(status, '本局结束', restart);
      }
    }

    function undo() {
      if (!undoState || gameRuntime.state().paused) return;
      values = undoState.values;
      points = undoState.points;
      undoState = null;
      undoButton.disabled = true;
      render();
    }

    function canMove() {
      if (values.some(function (value) { return value === 0; })) {
        return true;
      }
      for (var y = 0; y < 4; y += 1) {
        for (var x = 0; x < 4; x += 1) {
          var index = y * 4 + x;
          if ((x < 3 && values[index] === values[index + 1])
              || (y < 3 && values[index] === values[index + 4])) {
            return true;
          }
        }
      }
      return false;
    }

    function render() {
      values.forEach(function (value, index) {
        cells[index].textContent = value || '';
        cells[index].dataset.rank = value ? String(Math.min(11, Math.log2(value))) : '0';
      });
      updateScore(scoreNode, points);
    }

    bindKeys(function (event) {
      var directions = {ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right'};
      if (directions[event.key]) {
        move(directions[event.key]);
        return true;
      }
      return false;
    });
    restart();
  }

  function showSnake() {
    var size = 12;
    var board;
    var cells = [];
    var snake;
    var food;
    var direction;
    var pending;
    var score;
    var scoreNode;
    var status;
    var running;
    var snakeTimer;

    function restart() {
      gameRuntime.start('snake');
      if (snakeTimer) clearTimeout(snakeTimer);
      snake = [{x: 6, y: 6}, {x: 5, y: 6}, {x: 4, y: 6}];
      direction = {x: 1, y: 0};
      pending = direction;
      score = 0;
      running = true;
      placeFood();
      render();
      status.className = 'game-status';
      status.textContent = '方向键或屏幕按钮控制';
      scheduleTick();
    }

    scoreNode = gameHeader('贪吃蛇', '得分 0', restart);
    board = element('div', 'cell-board');
    board.style.gridTemplateColumns = 'repeat(' + size + ',1fr)';
    for (var i = 0; i < size * size; i += 1) {
      var cell = element('div', 'cell');
      cells.push(cell);
      board.appendChild(cell);
    }
    panel.appendChild(board);
    status = element('div', 'game-status');
    panel.appendChild(status);
    panel.appendChild(directionPad(changeDirection));

    function placeFood() {
      do {
        food = {x: Math.floor(Math.random() * size), y: Math.floor(Math.random() * size)};
      } while (snake.some(function (part) { return part.x === food.x && part.y === food.y; }));
    }

    function changeDirection(name) {
      var next = {
        up: {x: 0, y: -1},
        down: {x: 0, y: 1},
        left: {x: -1, y: 0},
        right: {x: 1, y: 0}
      }[name];
      if (next && !(next.x === -direction.x && next.y === -direction.y)) {
        pending = next;
      }
    }

    function tick() {
      if (!running || gameRuntime.state().paused) {
        return;
      }
      direction = pending;
      var head = {x: snake[0].x + direction.x, y: snake[0].y + direction.y};
      var willEat = head.x === food.x && head.y === food.y;
      var collisionBody = willEat ? snake : snake.slice(0, -1);
      if (head.x < 0 || head.x >= size || head.y < 0 || head.y >= size
          || collisionBody.some(function (part) { return part.x === head.x && part.y === head.y; })) {
        running = false;
        finishGame(status, '碰到了边界', restart);
        return;
      }
      snake.unshift(head);
      if (willEat) {
        score += 10;
        placeFood();
      } else {
        snake.pop();
      }
      render();
    }

    function render() {
      cells.forEach(function (cell) { cell.className = 'cell'; });
      snake.forEach(function (part, index) {
        cells[part.y * size + part.x].className = index === 0 ? 'cell snake snake-head' : 'cell snake';
      });
      cells[food.y * size + food.x].className = 'cell food';
      updateScore(scoreNode, score);
    }

    bindKeys(function (event) {
      var directions = {ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right'};
      if (directions[event.key]) {
        changeDirection(directions[event.key]);
        return true;
      }
      return false;
    });
    function scheduleTick() {
      snakeTimer = setTimeout(function () {
        tick();
        if (running) scheduleTick();
      }, Math.max(70, 150 - score * 1.2));
      intervals.push(snakeTimer);
    }
    restart();
  }

  function showDodge() {
    var road;
    var player;
    var playerPosition;
    var obstacles;
    var ticks;
    var score;
    var scoreNode;
    var status;
    var running;

    function restart() {
      gameRuntime.start('dodge');
      if (obstacles) obstacles.forEach(function (obstacle) { obstacle.node.remove(); });
      playerPosition = 50;
      obstacles = [];
      ticks = 0;
      score = 0;
      running = true;
      status.className = 'game-status';
      status.textContent = '在一条道路内左右移动，避开迎面障碍';
      render();
    }

    scoreNode = gameHeader('公路闪避', '得分 0', restart);
    road = element('div', 'road');
    player = element('div', 'car');
    road.appendChild(player);
    panel.appendChild(road);
    status = element('div', 'game-status');
    panel.appendChild(status);
    var roadControls = element('div', 'actions');
    roadControls.appendChild(makeButton('向左', '', function () { steer(-1); }));
    roadControls.appendChild(makeButton('向右', '', function () { steer(1); }));
    panel.appendChild(roadControls);

    function steer(amount) {
      if (running && !gameRuntime.state().paused) {
        playerPosition = Math.max(10, Math.min(90, playerPosition + amount * 8));
        render();
      }
    }

    function tick() {
      if (!running || gameRuntime.state().paused) {
        return;
      }
      ticks += 1;
      if (ticks % Math.max(18, 34 - Math.floor(score / 45)) === 0) {
        obstacles.push({x: 12 + Math.random() * 76, y: -12, node: element('div', 'obstacle')});
        road.appendChild(obstacles[obstacles.length - 1].node);
      }
      obstacles.forEach(function (obstacle) { obstacle.y += 2.2 + Math.min(2.6, score / 220); });
      if (obstacles.some(function (obstacle) {
        return obstacle.y > 76 && obstacle.y < 94 && Math.abs(obstacle.x - playerPosition) < 15;
      })) {
        running = false;
        finishGame(status, '发生碰撞', restart);
      }
      obstacles = obstacles.filter(function (obstacle) {
        if (obstacle.y > 105) {
          obstacle.node.remove();
          score += 10;
          return false;
        }
        return true;
      });
      render();
    }

    function render() {
      player.style.left = playerPosition + '%';
      obstacles.forEach(function (obstacle) {
        obstacle.node.style.left = obstacle.x + '%';
        obstacle.node.style.top = obstacle.y + '%';
      });
      updateScore(scoreNode, score);
    }

    bindKeys(function (event) {
      if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
        steer(-1);
        return true;
      }
      if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
        steer(1);
        return true;
      }
      return false;
    });
    intervals.push(setInterval(tick, 55));
    restart();
  }

  function showRunner() {
    var canvas;
    var context;
    var scoreNode;
    var status;
    var player;
    var obstacles;
    var score;
    var running;
    var lastTime;
    var spawnDistance;
    var ground = 214;

    function restart() {
      gameRuntime.start('runner');
      player = {x: 62, y: ground - 28, width: 22, height: 28, velocity: 0};
      obstacles = [];
      score = 0;
      running = true;
      lastTime = performance.now();
      spawnDistance = 300;
      status.className = 'game-status';
      status.textContent = '空格、上方向键或屏幕按钮跳跃';
      if (!animationFrame) {
        animationFrame = requestAnimationFrame(frame);
      }
    }

    scoreNode = gameHeader('像素跳跃', '得分 0', restart);
    canvas = element('canvas', 'runner');
    canvas.width = 600;
    canvas.height = 260;
    context = canvas.getContext('2d');
    panel.appendChild(canvas);
    status = element('div', 'game-status');
    panel.appendChild(status);
    var controls = element('div', 'actions');
    controls.appendChild(makeButton('跳跃', 'primary', jump));
    panel.appendChild(controls);

    function jump() {
      if (running && !gameRuntime.state().paused && player.y >= ground - player.height - 1) {
        player.velocity = -540;
      }
    }

    function frame(now) {
      animationFrame = requestAnimationFrame(frame);
      var delta = Math.min(0.035, (now - lastTime) / 1000);
      lastTime = now;
      if (running && !gameRuntime.state().paused) {
        player.velocity += 1450 * delta;
        player.y = Math.min(ground - player.height, player.y + player.velocity * delta);
        spawnDistance -= (230 + Math.min(130, score * 0.7)) * delta;
        if (spawnDistance <= 0) {
          var height = 24 + Math.floor(Math.random() * 28);
          obstacles.push({x: 610, y: ground - height, width: 18 + Math.floor(Math.random() * 16), height: height});
          spawnDistance = 180 + Math.random() * 210;
        }
        obstacles.forEach(function (obstacle) {
          obstacle.x -= (230 + Math.min(130, score * 0.7)) * delta;
        });
        obstacles = obstacles.filter(function (obstacle) {
          if (obstacle.x + obstacle.width < 0) {
            score += 5;
            return false;
          }
          return true;
        });
        if (obstacles.some(function (obstacle) {
          return player.x < obstacle.x + obstacle.width
              && player.x + player.width > obstacle.x
              && player.y < obstacle.y + obstacle.height
              && player.y + player.height > obstacle.y;
        })) {
          running = false;
          finishGame(status, '撞到障碍', restart);
        }
      }
      draw();
    }

    function draw() {
      context.fillStyle = '#171a1e';
      context.fillRect(0, 0, 600, 260);
      context.fillStyle = '#343a40';
      context.fillRect(0, ground, 600, 46);
      context.fillStyle = '#4f5963';
      for (var x = 0; x < 600; x += 32) {
        context.fillRect(x, ground + 10, 18, 4);
      }
      context.fillStyle = '#58a6d8';
      context.fillRect(player.x, player.y, player.width, player.height);
      context.fillStyle = '#a8d0e8';
      context.fillRect(player.x + 14, player.y + 5, 4, 4);
      context.fillStyle = '#d26b60';
      obstacles.forEach(function (obstacle) {
        context.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
      });
      updateScore(scoreNode, score);
    }

    bindKeys(function (event) {
      if (event.key === 'ArrowUp' || event.key === ' ' || event.key.toLowerCase() === 'w') {
        jump();
        return true;
      }
      return false;
    });
    restart();
  }

  function showMines() {
    var width = 9;
    var mineCount = 10;
    var cells;
    var buttons = [];
    var cursor;
    var started;
    var ended;
    var elapsedSeconds;
    var mineTimer;
    var scoreNode;
    var status;

    function restart() {
      gameRuntime.start('mines');
      if (mineTimer) clearInterval(mineTimer);
      cells = new Array(width * width).fill(null).map(function () {
        return {mine: false, open: false, flag: false, nearby: 0};
      });
      cursor = 40;
      started = false;
      ended = false;
      elapsedSeconds = 0;
      status.className = 'game-status';
      status.textContent = '方向键移动，回车揭开，F 标记';
      updateScore(scoreNode, 0, '已开 ');
      render();
    }

    scoreNode = gameHeader('扫雷', '已开 0', restart);
    var board = element('div', 'mine-board');
    for (var i = 0; i < width * width; i += 1) {
      (function (index) {
        var button = makeButton('', 'mine-cell', function () {
          cursor = index;
          reveal(index);
        });
        button.addEventListener('contextmenu', function (event) {
          event.preventDefault();
          cursor = index;
          toggleFlag(index);
        });
        button.addEventListener('dblclick', function () {
          cursor = index;
          chord(index);
        });
        buttons.push(button);
        board.appendChild(button);
      })(i);
    }
    panel.appendChild(board);
    status = element('div', 'game-status');
    panel.appendChild(status);
    var mineTools = element('div', 'mine-tools');
    mineTools.appendChild(makeButton('上', '', function () { moveCursor(0, -1); }));
    mineTools.appendChild(makeButton('左', '', function () { moveCursor(-1, 0); }));
    mineTools.appendChild(makeButton('揭开', 'primary', function () { reveal(cursor); }));
    mineTools.appendChild(makeButton('标记', '', function () { toggleFlag(cursor); }));
    mineTools.appendChild(makeButton('右', '', function () { moveCursor(1, 0); }));
    mineTools.appendChild(makeButton('下', '', function () { moveCursor(0, 1); }));
    panel.appendChild(mineTools);

    function placeMines(safeIndex) {
      window.LinuxDoGameCore.mineIndexes(width, mineCount, safeIndex).forEach(function (index) {
        cells[index].mine = true;
      });
      cells.forEach(function (cell, index) {
        cell.nearby = window.LinuxDoGameCore.neighbors(index, width)
          .filter(function (neighbor) { return cells[neighbor].mine; }).length;
      });
      started = true;
      mineTimer = setInterval(function () {
        if (!ended && !gameRuntime.state().paused) {
          elapsedSeconds += 1;
          renderStatus();
        }
      }, 1000);
      intervals.push(mineTimer);
    }

    function reveal(index) {
      if (ended || gameRuntime.state().paused || cells[index].flag || cells[index].open) {
        return;
      }
      if (!started) {
        placeMines(index);
      }
      if (cells[index].mine) {
        ended = true;
        clearInterval(mineTimer);
        cells.forEach(function (cell) {
          if (cell.mine) {
            cell.open = true;
          }
        });
        finishGame(status, '踩到地雷', restart);
      } else {
        revealSafe(index);
      }
      var opened = cells.filter(function (cell) { return cell.open; }).length;
      updateScore(scoreNode, opened, '已开 ');
      if (!ended && opened === width * width - mineCount) {
        ended = true;
        clearInterval(mineTimer);
        finishGame(status, '已清理全部安全区域', restart);
      }
      render();
    }

    function revealSafe(start) {
      var queue = [start];
      var seen = {};
      while (queue.length) {
        var index = queue.shift();
        if (seen[index] || cells[index].flag || cells[index].mine) continue;
        seen[index] = true;
        cells[index].open = true;
        if (cells[index].nearby === 0) {
          queue = queue.concat(window.LinuxDoGameCore.neighbors(index, width));
        }
      }
    }

    function chord(index) {
      if (ended || gameRuntime.state().paused || !cells[index].open || !cells[index].nearby) return;
      var nearby = window.LinuxDoGameCore.neighbors(index, width);
      var flags = nearby.filter(function (neighbor) { return cells[neighbor].flag; }).length;
      if (flags !== cells[index].nearby) return;
      nearby.forEach(function (neighbor) {
        if (!cells[neighbor].flag) reveal(neighbor);
      });
    }

    function toggleFlag(index) {
      if (!ended && !gameRuntime.state().paused && !cells[index].open) {
        cells[index].flag = !cells[index].flag;
        render();
      }
    }

    function moveCursor(dx, dy) {
      var x = cursor % width;
      var y = Math.floor(cursor / width);
      x = Math.max(0, Math.min(width - 1, x + dx));
      y = Math.max(0, Math.min(width - 1, y + dy));
      cursor = y * width + x;
      render();
    }

    function renderStatus() {
      if (ended) return;
      var flags = cells.filter(function (cell) { return cell.flag; }).length;
      status.textContent = '剩余旗帜 ' + Math.max(0, mineCount - flags) + ' · ' + elapsedSeconds + ' 秒';
    }

    function render() {
      cells.forEach(function (cell, index) {
        var button = buttons[index];
        button.className = 'mine-cell' + (cell.open ? ' open' : '') + (index === cursor ? ' cursor' : '')
          + (cell.open && cell.mine ? ' mine' : '');
        if (cell.flag) {
          button.textContent = 'F';
        } else if (cell.open && cell.mine) {
          button.textContent = '*';
        } else if (cell.open && cell.nearby) {
          button.textContent = String(cell.nearby);
        } else {
          button.textContent = '';
        }
      });
      renderStatus();
    }

    bindKeys(function (event) {
      if (event.key === 'ArrowUp') {
        moveCursor(0, -1);
      } else if (event.key === 'ArrowDown') {
        moveCursor(0, 1);
      } else if (event.key === 'ArrowLeft') {
        moveCursor(-1, 0);
      } else if (event.key === 'ArrowRight') {
        moveCursor(1, 0);
      } else if (event.key === 'Enter' || event.key === ' ') {
        reveal(cursor);
      } else if (event.key.toLowerCase() === 'f') {
        toggleFlag(cursor);
      } else {
        return false;
      }
      return true;
    });
    restart();
  }

  window.__lexiaoBreakCleanup = function () {
    cleanupGame();
    document.removeEventListener('visibilitychange', visibilityHandler);
    window.__lexiaoBreakCleanup = null;
  };
  var visibilityHandler = function () {
    var state = gameRuntime.state();
    if (document.hidden && state.kind && !state.finished) gameRuntime.setPaused(true);
  };
  document.addEventListener('visibilitychange', visibilityHandler);
  showReminder();
})();

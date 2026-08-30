(function (global) {
  'use strict';

  function open(options) {
  options = options || {};
  if (global.__linuxDoGameUIController) global.__linuxDoGameUIController.destroy();

  var core = options.core || global.LinuxDoGameCore;
  if (!core) throw new Error('LinuxDoGameCore is required.');
  var recommended = core.canonicalGame(options.recommended || '2048');
  var reminderMode = Boolean(options.reminderMode);
  var pauseButton;
  var pauseLayer;
  var activeGame = '';
  var timers = [];
  var frameId = 0;
  var countdownCancel;
  var keyDownHandler;
  var keyUpHandler;
  var inputReset;
  var resizeCleanup;
  var cleanupCallbacks = [];
  var gameNames = {
    '2048': '2048',
    snake: '贪吃蛇',
    racer: '公路闪避',
    jumper: '像素跳跃',
    mines: '扫雷'
  };
  var gameRuntime = core.createRuntime({
    bestScores: options.bestScores || {},
    onBestScore: function (game, value) {
      if (typeof options.onBestScore === 'function') options.onBestScore(game, value, gameRuntime.bestScores());
    },
    onPause: function (paused) {
      if (paused && inputReset) inputReset();
      if (pauseButton) {
        pauseButton.textContent = paused ? '▶' : 'Ⅱ';
        pauseButton.title = paused ? '继续' : '暂停';
      }
      if (pauseLayer) pauseLayer.hidden = !paused;
    }
  });

  var host = document.createElement('div');
  host.id = 'linuxdo-game-overlay';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;';
  var shadow = host.attachShadow({ mode: 'open' });
  var style = document.createElement('style');
  style.textContent = [
    ':host{all:initial;--game-bg:#202327;--game-panel:#272b30;--game-text:#e7e9ec;--game-muted:#aeb4bd;--game-accent:#3b82c4;--game-line:rgba(142,149,158,.45);color-scheme:dark}',
    '*{box-sizing:border-box;letter-spacing:0}',
    '.backdrop{position:absolute;inset:0;display:grid;place-items:center;padding:8px;overflow:hidden;background:rgba(18,21,25,.72);font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--game-text)}',
    '.panel{width:min(680px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;border:1px solid var(--game-line);border-radius:7px;background:var(--game-bg);box-shadow:0 14px 42px rgba(0,0,0,.3);padding:16px}',
    '.panel.is-game{display:flex;height:min(720px,calc(100vh - 16px));min-height:0;flex-direction:column;overflow:hidden}',
    '.intro{text-align:center;padding:4px}.eyebrow{margin:0 0 4px;color:var(--game-muted);font-size:11px}.intro h2{margin:0;font-size:18px}.intro p{margin:6px auto 0;max-width:380px;color:var(--game-muted)}',
    '.actions,.result-actions,.hold-controls,.mine-controls{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:7px}.actions{margin-top:14px}',
    'button{min-height:34px;border:1px solid rgba(142,149,158,.5);border-radius:4px;background:transparent;color:inherit;padding:5px 10px;font:inherit;cursor:pointer;touch-action:manipulation}',
    'button:hover,button:focus-visible{background:rgba(142,149,158,.16);outline:none}button.primary{border-color:#4ea1ff;background:var(--game-accent);color:#fff}button.quiet{border-color:transparent;color:var(--game-muted)}button:disabled{opacity:.45;cursor:default}',
    '.game-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:13px}.game-card{text-align:left;min-height:62px;padding:9px}.game-card strong,.game-card span{display:block}.game-card span{margin-top:3px;font-size:11px;color:var(--game-muted)}.recommended{color:#57a6e6!important}',
    '.game-head{display:flex;flex:0 0 auto;align-items:center;gap:7px;margin-bottom:10px;padding-bottom:9px;border-bottom:1px solid rgba(142,149,158,.28)}.game-title{display:grid;min-width:0;margin-right:auto}.game-title strong{font-size:15px}.game-title small{color:var(--game-muted);white-space:nowrap}.score{display:grid;min-width:50px;justify-items:end;font-variant-numeric:tabular-nums;white-space:nowrap}.score small{font-size:10px;color:var(--game-muted)}.icon{width:32px;height:32px;flex:0 0 32px;padding:0;border-color:transparent;font-size:16px}',
    '.game-body{position:relative;display:flex;min-height:0;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:7px}.game-state{position:absolute;z-index:5;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;padding:18px;background:rgba(32,35,39,.96);text-align:center}.game-state[hidden]{display:none}.game-state strong{font-size:19px}.game-state span,.status{color:var(--game-muted)}',
    '.countdown{min-height:min(300px,calc(100vh - 50px));display:grid;place-content:center;justify-items:center;color:var(--game-muted)}.countdown strong{font-size:48px;color:var(--game-text)}',
    '.game-board,.game-canvas{display:block;flex:0 0 auto;max-width:100%;overflow:hidden;border:1px solid rgba(142,149,158,.38);border-radius:5px;background:var(--game-panel)}.square-canvas{aspect-ratio:1}',
    '.board-2048{position:relative}.tile-backgrounds{position:absolute;inset:6px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.tile-background{border:1px solid rgba(142,149,158,.28);border-radius:4px;background:rgba(142,149,158,.09)}.tile-layer{position:absolute;inset:0}.tile{position:absolute;top:0;left:0;display:grid;place-items:center;border-radius:4px;background:rgba(142,149,158,.16);font-size:20px;font-weight:700;transition:transform 130ms cubic-bezier(.2,.75,.25,1);will-change:transform}.tile[data-rank="1"]{background:#d9d2c2;color:#242424}.tile[data-rank="2"]{background:#d7c49d;color:#242424}.tile[data-rank="3"]{background:#e6a566;color:#202020}.tile[data-rank="4"]{background:#df8355;color:#fff}.tile[data-rank="5"]{background:#cf6552;color:#fff}.tile[data-rank="6"],.tile[data-rank="7"],.tile[data-rank="8"],.tile[data-rank="9"],.tile[data-rank="10"],.tile[data-rank="11"]{background:#b5964b;color:#fff;font-size:16px}.tile.spawned{animation:tile-in 130ms ease-out}.tile.merged{animation:tile-merge 160ms ease-out}.tile.undoing{animation:tile-undo 150ms ease-out}',
    '@keyframes tile-in{from{scale:.88;opacity:.45}to{scale:1;opacity:1}}@keyframes tile-merge{0%{scale:1}45%{scale:1.12}100%{scale:1}}@keyframes tile-undo{from{opacity:.45}to{opacity:1}}',
    '.dpad{display:grid;grid-template-columns:repeat(3,38px);grid-template-areas:". up ." "left down right";gap:4px}.dpad.horizontal{display:flex}.dpad [data-direction="up"]{grid-area:up}.dpad [data-direction="left"]{grid-area:left}.dpad [data-direction="down"]{grid-area:down}.dpad [data-direction="right"]{grid-area:right}.dpad button{width:38px;height:36px;padding:0}.hold-controls{gap:8px}.hold-control{width:78px;height:38px;font-size:18px;touch-action:none}.hold-control:active,.jump-button:active{background:rgba(142,149,158,.22)}',
    '.runner-canvas{image-rendering:pixelated}.status{min-height:19px;margin:0;text-align:center;font-size:12px;font-variant-numeric:tabular-nums}',
    '.mine-board{display:grid;grid-template-columns:repeat(9,1fr);gap:2px;padding:4px}.mine-cell{min-width:0;min-height:0;padding:0;border:0;border-radius:2px;background:rgba(142,149,158,.17);font-weight:700;font-size:12px;transition:background-color 90ms ease-out,color 90ms ease-out}.mine-cell.open{background:rgba(142,149,158,.05)}.mine-cell.cursor{outline:2px solid #58a6d8;outline-offset:-2px}.mine-cell.mine,.mine-cell.wrong{color:#df6c63}.mine-cell.wrong{text-decoration:line-through}.mine-cell.triggered{background:rgba(223,108,99,.22)}.mine-cell.revealing{animation:mine-in 150ms ease-out both}@keyframes mine-in{from{opacity:.35;scale:.92}to{opacity:1;scale:1}}.mine-controls{gap:0}.mine-controls button{min-width:70px;border-radius:0}.mine-controls button:first-child{border-radius:4px 0 0 4px}.mine-controls button:last-child{border-radius:0 4px 4px 0}',
    '@media(max-width:430px),(max-height:570px){.panel{padding:10px}.game-head{gap:4px;margin-bottom:7px;padding-bottom:6px}.game-title small{display:none}.game-body{gap:4px}.status{font-size:11px}.score{min-width:42px}}',
    '@media(max-width:350px){.backdrop{padding:3px}.panel,.panel.is-game{width:calc(100vw - 6px);height:calc(100vh - 6px);max-height:calc(100vh - 6px)}.game-list{grid-template-columns:1fr}}',
    '@media(max-height:420px),(max-width:280px){.panel.is-game{overflow:auto}.panel.is-game .game-body{min-height:360px;flex:none}}',
    '@media(pointer:coarse){button.icon,.dpad button,.hold-control,.jump-button{min-width:44px;min-height:44px}}',
    '@media(prefers-reduced-motion:reduce){.tile,.mine-cell{transition-duration:.01ms}.tile.spawned,.tile.merged,.tile.undoing,.mine-cell.revealing{animation:none}}'
  ].join('');
  shadow.appendChild(style);
  var backdrop = element('div', 'backdrop');
  var panel = element('section', 'panel');
  backdrop.appendChild(panel);
  shadow.appendChild(backdrop);
  (options.container || document.documentElement).appendChild(host);

  function element(tag, className, text) {
    var item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }

  function makeButton(label, className, handler) {
    var item = element('button', className || '', label);
    item.type = 'button';
    item.addEventListener('click', handler);
    return item;
  }

  function iconButton(label, title, handler) {
    var item = makeButton(label, 'icon', handler);
    item.title = title;
    item.setAttribute('aria-label', title);
    return item;
  }

  function internalAction(action) {
    if (action === 'continue') {
      destroy();
      if (typeof options.onContinue === 'function') options.onContinue();
    } else if (action === 'snooze') {
      destroy();
      if (typeof options.onSnooze === 'function') options.onSnooze();
    }
  }

  function schedule(callback, delay) {
    var id = setTimeout(callback, delay);
    timers.push(id);
    return id;
  }

  function cleanupGame() {
    timers.forEach(function (id) { clearTimeout(id); clearInterval(id); });
    timers = [];
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    if (countdownCancel) countdownCancel();
    countdownCancel = null;
    if (keyDownHandler) window.removeEventListener('keydown', keyDownHandler, true);
    if (keyUpHandler) window.removeEventListener('keyup', keyUpHandler, true);
    keyDownHandler = null;
    keyUpHandler = null;
    if (inputReset) inputReset();
    inputReset = null;
    if (resizeCleanup) resizeCleanup();
    resizeCleanup = null;
    cleanupCallbacks.forEach(function (callback) { callback(); });
    cleanupCallbacks = [];
    pauseButton = null;
    pauseLayer = null;
  }

  function bindKeys(down, up) {
    if (keyDownHandler) window.removeEventListener('keydown', keyDownHandler, true);
    if (keyUpHandler) window.removeEventListener('keyup', keyUpHandler, true);
    keyDownHandler = function (event) {
      if (event.key === 'Escape') {
        internalAction('continue');
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (down && down(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    keyUpHandler = function (event) {
      if (up && up(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', keyDownHandler, true);
    window.addEventListener('keyup', keyUpHandler, true);
  }

  function showReminder() {
    cleanupGame();
    activeGame = '';
    panel.className = 'panel';
    panel.replaceChildren();
    var intro = element('div', 'intro');
    intro.appendChild(element('p', 'eyebrow', (reminderMode ? '休息提醒' : '小游戏') + ' · 本次推荐 ' + gameNames[recommended]));
    intro.appendChild(element('h2', '', reminderMode ? '离开帖子两分钟' : '休息一下'));
    intro.appendChild(element('p', '', reminderMode ? '活动一下肩颈，或者玩一局轻量小游戏。' : '选择一个轻量小游戏，随时回到阅读。'));
    var actions = element('div', 'actions');
    actions.appendChild(makeButton('开始推荐 · ' + gameNames[recommended], 'primary', function () { startGame(recommended); }));
    actions.appendChild(makeButton('选择游戏', '', showGameMenu));
    if (reminderMode) actions.appendChild(makeButton('10 分钟后提醒', 'quiet', function () { internalAction('snooze'); }));
    actions.appendChild(makeButton('关闭并继续阅读', 'quiet', function () { internalAction('continue'); }));
    intro.appendChild(actions);
    panel.appendChild(intro);
  }

  function showGameMenu() {
    cleanupGame();
    activeGame = '';
    panel.className = 'panel';
    panel.replaceChildren();
    var intro = element('div', 'intro');
    intro.appendChild(element('p', 'eyebrow', '小游戏'));
    intro.appendChild(element('h2', '', '选择一种休息方式'));
    panel.appendChild(intro);
    var list = element('div', 'game-list');
    [
      ['2048', '合并数字'],
      ['snake', '灵活转向'],
      ['racer', '单条道路自由转向'],
      ['jumper', '控制跳跃高度'],
      ['mines', '找出安全方格']
    ].forEach(function (description) {
      var card = makeButton('', 'game-card', function () { startGame(description[0]); });
      card.appendChild(element('strong', '', gameNames[description[0]]));
      card.appendChild(element('span', description[0] === recommended ? 'recommended' : '', (description[0] === recommended ? '本次推荐 · ' : '') + description[1]));
      list.appendChild(card);
    });
    panel.appendChild(list);
    var actions = element('div', 'actions');
    actions.appendChild(makeButton('返回', '', showReminder));
    actions.appendChild(makeButton('结束休息', 'quiet', function () { internalAction('continue'); }));
    panel.appendChild(actions);
  }

  function startGame(kind) {
    cleanupGame();
    activeGame = core.canonicalGame(kind);
    gameRuntime.start(activeGame);
    panel.className = 'panel is-game';
    panel.replaceChildren();
    var countdown = element('div', 'countdown');
    countdown.appendChild(element('span', '', '准备'));
    var value = element('strong', '', '3');
    countdown.appendChild(value);
    panel.appendChild(countdown);
    countdownCancel = core.countdown(function (next) { value.textContent = String(next); }, function () {
      if (activeGame === 'snake') showSnake();
      else if (activeGame === 'racer') showRacer();
      else if (activeGame === 'jumper') showJumper();
      else if (activeGame === 'mines') showMines();
      else show2048();
    });
  }

  function gameShell(title, instructions) {
    cleanupGame();
    panel.className = 'panel is-game';
    panel.replaceChildren();
    var head = element('div', 'game-head');
    head.appendChild(iconButton('←', '选择其他游戏', showGameMenu));
    var titleNode = element('div', 'game-title');
    titleNode.appendChild(element('strong', '', title));
    titleNode.appendChild(element('small', '', instructions));
    head.appendChild(titleNode);
    var scoreWrap = element('span', 'score');
    var scoreNode = element('strong', '', '0');
    var bestNode = element('small', '', '最高 ' + gameRuntime.state().best);
    scoreWrap.append(scoreNode, bestNode);
    head.appendChild(scoreWrap);
    pauseButton = iconButton('Ⅱ', '暂停', function () { gameRuntime.togglePause(); });
    head.appendChild(pauseButton);
    head.appendChild(iconButton('↻', '重新开始', function () { startGame(activeGame); }));
    head.appendChild(iconButton('×', '结束休息', function () { internalAction('continue'); }));
    var body = element('div', 'game-body');
    pauseLayer = element('div', 'game-state');
    pauseLayer.hidden = true;
    pauseLayer.appendChild(element('strong', '', '已暂停'));
    pauseLayer.appendChild(makeButton('继续', 'primary', function () { gameRuntime.setPaused(false); }));
    var resultLayer = element('div', 'game-state');
    resultLayer.hidden = true;
    body.append(pauseLayer, resultLayer);
    panel.append(head, body);
    return { panel: panel, body: body, score: scoreNode, best: bestNode, result: resultLayer };
  }

  function setScore(ui, value) {
    var state = gameRuntime.setScore(value);
    ui.score.textContent = String(state.score);
    ui.best.textContent = '最高 ' + state.best;
  }

  function finishGame(ui, message, detail) {
    gameRuntime.finish();
    if (inputReset) inputReset();
    if (pauseLayer) pauseLayer.hidden = true;
    ui.result.hidden = false;
    ui.result.replaceChildren(element('strong', '', message), element('span', '', detail || ''));
    var actions = element('div', 'result-actions');
    actions.appendChild(makeButton('再来一局', 'primary', function () { startGame(activeGame); }));
    actions.appendChild(makeButton('选择游戏', '', showGameMenu));
    ui.result.appendChild(actions);
  }

  function show2048() {
    var ui = gameShell('2048', '方向键移动');
    var game = core.create2048();
    var board = element('div', 'game-board board-2048');
    var backgrounds = element('div', 'tile-backgrounds');
    for (var index = 0; index < 16; index += 1) backgrounds.appendChild(element('span', 'tile-background'));
    var layer = element('div', 'tile-layer');
    board.append(backgrounds, layer);
    var status = element('p', 'status', '每局可撤销一次');
    var undoButton = makeButton('撤销一次', '', undo);
    undoButton.disabled = true;
    var nodes = new Map();
    var animating = false;
    var queuedDirection = '';
    ui.body.append(board, directionPad(move), undoButton, status);
    observeGameSize(ui, board, 'square', function () { renderStatic(game.state()); });

    function createTile(tile, spawned) {
      var item = element('span', 'tile' + (spawned ? ' spawned' : ''), String(tile.value));
      item.dataset.id = String(tile.id);
      item.dataset.rank = String(Math.min(11, Math.log2(tile.value)));
      nodes.set(tile.id, item);
      layer.appendChild(item);
      positionTile(item, tile.index, board);
      return item;
    }

    function renderStatic(state, undoing) {
      var live = new Set(state.tiles.map(function (tile) { return tile.id; }));
      nodes.forEach(function (item, id) {
        if (!live.has(id)) { item.remove(); nodes.delete(id); }
      });
      state.tiles.forEach(function (tile) {
        var item = nodes.get(tile.id) || createTile(tile, false);
        item.className = 'tile' + (undoing ? ' undoing' : '');
        item.dataset.rank = String(Math.min(11, Math.log2(tile.value)));
        item.textContent = String(tile.value);
        item.style.transition = 'none';
        positionTile(item, tile.index, board);
        requestAnimationFrame(function () { item.style.transition = ''; });
      });
      undoButton.disabled = !state.canUndo;
      status.textContent = state.undoUsed ? '本局撤销已使用' : '每局可撤销一次';
      setScore(ui, state.score);
    }

    function move(direction) {
      if (gameRuntime.state().paused || gameRuntime.state().finished) return;
      if (animating) { queuedDirection = direction; return; }
      var state = game.move(direction);
      if (!state.moved) {
        if (state.finished) finishGame(ui, '没有可移动方块', '得分 ' + state.score);
        return;
      }
      animating = true;
      state.events.filter(function (event) { return event.type === 'move'; }).forEach(function (event) {
        var item = nodes.get(event.id);
        if (item) requestAnimationFrame(function () { positionTile(item, event.to, board); });
      });
      schedule(function () {
        renderStatic(state, false);
        state.events.forEach(function (event) {
          if (event.merged && !event.removed && nodes.get(event.id)) nodes.get(event.id).classList.add('merged');
          if (event.type === 'spawn' && nodes.get(event.id)) nodes.get(event.id).classList.add('spawned');
        });
        animating = false;
        if (state.finished) finishGame(ui, '本局结束', '得分 ' + state.score);
        var next = queuedDirection;
        queuedDirection = '';
        if (next && !state.finished) move(next);
      }, reducedMotion() ? 20 : 145);
    }

    function undo() {
      if (gameRuntime.state().paused || animating) return;
      renderStatic(game.undo(), true);
    }

    renderStatic(game.state());
    bindKeys(function (event) { return handleDirection(event, move); });
  }

  function positionTile(item, index, board) {
    var padding = 6;
    var gap = 6;
    var cell = Math.max(0, (board.clientWidth - padding * 2 - gap * 3) / 4);
    var column = index % 4;
    var row = Math.floor(index / 4);
    item.style.width = cell + 'px';
    item.style.height = cell + 'px';
    item.style.transform = 'translate(' + (padding + column * (cell + gap)) + 'px,' + (padding + row * (cell + gap)) + 'px)';
  }

  function showSnake() {
    var ui = gameShell('贪吃蛇', '方向键转向');
    var game = core.createSnake({ size: 16 });
    var canvas = element('canvas', 'game-canvas square-canvas');
    var status = element('p', 'status', '长度 3 · 速度 1');
    var state = game.state();
    var lastStep = performance.now();
    ui.body.append(canvas, directionPad(function (direction) { game.queueDirection(direction); }), status);
    observeGameSize(ui, canvas, 'square', function () { draw(performance.now(), false); });

    function tick() {
      if (!gameRuntime.state().paused) {
        state = game.step();
        lastStep = performance.now();
        setScore(ui, state.score);
        status.textContent = '长度 ' + state.snake.length + ' · 速度 ' + (1 + Math.floor(state.score / 40));
        if (state.finished) {
          finishGame(ui, '撞到了', '得分 ' + state.score);
          return;
        }
      }
      schedule(tick, state.interval);
    }

    function draw(now, scheduleNext) {
      now = now || performance.now();
      if (scheduleNext === undefined) scheduleNext = true;
      var context = prepareCanvas(canvas);
      if (!context) return;
      var width = canvas.clientWidth;
      var cell = width / state.size;
      context.clearRect(0, 0, width, width);
      context.fillStyle = '#25292e';
      context.fillRect(0, 0, width, width);
      context.strokeStyle = 'rgba(142,149,158,.18)';
      context.lineWidth = 1;
      for (var line = 1; line < state.size; line += 1) {
        var point = Math.round(line * cell) + 0.5;
        context.beginPath(); context.moveTo(point, 0); context.lineTo(point, width); context.moveTo(0, point); context.lineTo(width, point); context.stroke();
      }
      var pulse = reducedMotion() ? 1 : 0.9 + Math.sin(now / 170) * 0.08;
      context.fillStyle = '#6ab56a';
      context.beginPath(); context.arc((state.food.x + 0.5) * cell, (state.food.y + 0.5) * cell, cell * 0.28 * pulse, 0, Math.PI * 2); context.fill();
      var progress = gameRuntime.state().paused ? 1 : Math.min(1, (now - lastStep) / state.interval);
      state.snake.slice().reverse().forEach(function (part, reverseIndex) {
        var index = state.snake.length - reverseIndex - 1;
        var old = state.previous[index] || part;
        var x = old.x + (part.x - old.x) * progress;
        var y = old.y + (part.y - old.y) * progress;
        context.fillStyle = index === 0 ? '#5aa7dc' : '#438fc4';
        roundedRect(context, x * cell + cell * 0.1, y * cell + cell * 0.1, cell * 0.8, cell * 0.8, cell * 0.22);
        context.fill();
      });
      var head = state.snake[0];
      context.fillStyle = '#fff';
      context.beginPath();
      context.arc((head.x + 0.5 + state.direction.x * 0.18) * cell, (head.y + 0.5 + state.direction.y * 0.18) * cell, Math.max(1.2, cell * 0.065), 0, Math.PI * 2);
      context.fill();
      if (scheduleNext && !state.finished) frameId = requestAnimationFrame(function (next) { draw(next, true); });
    }

    draw(performance.now(), true);
    schedule(tick, state.interval);
    bindKeys(function (event) { return handleDirection(event, function (direction) { game.queueDirection(direction); }); });
  }

  function showRacer() {
    var ui = gameShell('公路闪避', '按住左右键转向');
    var game = core.createRacer();
    var input = core.createInputState();
    var stepper = core.createFixedStepper(1 / 120, 10);
    var canvas = element('canvas', 'game-canvas racer-canvas');
    var status = element('p', 'status', '单条道路内自由转向');
    var state = game.state();
    var previousTime;
    ui.body.append(canvas, holdControls(input), status);
    observeGameSize(ui, canvas, 'racer', draw);
    inputReset = function () { input.reset(); game.setSteer(0); };

    function frame(time) {
      if (previousTime === undefined) previousTime = time;
      var delta = (time - previousTime) / 1000;
      previousTime = time;
      if (!gameRuntime.state().paused && !state.finished) {
        game.setSteer(input.axis('left', 'right'));
        stepper.advance(delta, function (step) { state = game.step(step); });
        status.textContent = state.events.some(function (event) { return event.type === 'near-miss'; }) ? '擦肩 +5' : '速度 ' + Math.round(state.difficulty.speed * 100);
        setScore(ui, state.score);
        if (state.finished) finishGame(ui, '发生碰撞', '得分 ' + state.score);
      } else stepper.reset();
      draw();
      if (!state.finished) frameId = requestAnimationFrame(frame);
    }

    function draw() {
      var context = prepareCanvas(canvas);
      if (!context) return;
      var width = canvas.clientWidth;
      var height = canvas.clientHeight;
      var roadLeft = width * 0.055;
      var roadWidth = width * 0.89;
      context.clearRect(0, 0, width, height);
      context.fillStyle = '#30343a'; context.fillRect(0, 0, width, height);
      context.fillStyle = '#202429'; context.fillRect(roadLeft, 0, roadWidth, height);
      context.fillStyle = '#646b72';
      context.fillRect(roadLeft, 0, Math.max(3, width * 0.012), height);
      context.fillRect(roadLeft + roadWidth - Math.max(3, width * 0.012), 0, Math.max(3, width * 0.012), height);
      var markerOffset = (state.roadOffset * height * 0.28) % (height * 0.18);
      context.fillStyle = '#8a9198';
      for (var y = -height * 0.2 + markerOffset; y < height; y += height * 0.18) {
        context.fillRect(roadLeft + width * 0.018, y, width * 0.012, height * 0.075);
        context.fillRect(roadLeft + roadWidth - width * 0.03, y, width * 0.012, height * 0.075);
      }
      state.obstacles.forEach(function (obstacle) { drawCar(context, obstacle, width, height, '#d36b62', false); });
      drawCar(context, state.player, width, height, '#58a6d8', true);
    }

    draw();
    frameId = requestAnimationFrame(frame);
    bindKeys(function (event) { return continuousDirection(event, input, true); }, function (event) { return continuousDirection(event, input, false); });
  }

  function showJumper() {
    var ui = gameShell('像素跳跃', '短按低跳，长按高跳');
    var game = core.createJumper();
    var stepper = core.createFixedStepper(1 / 120, 10);
    var canvas = element('canvas', 'game-canvas runner-canvas');
    var status = element('p', 'status', '短按低跳，长按高跳');
    var jumpButton = holdButton('跳跃', function () { game.pressJump(); }, function () { game.releaseJump(); }, 'primary jump-button');
    var state = game.state();
    var previousTime;
    ui.body.append(canvas, jumpButton, status);
    observeGameSize(ui, canvas, 'jumper', draw);
    inputReset = function () { game.releaseJump(); };

    function frame(time) {
      if (previousTime === undefined) previousTime = time;
      var delta = (time - previousTime) / 1000;
      previousTime = time;
      if (!gameRuntime.state().paused && !state.finished) {
        stepper.advance(delta, function (step) { state = game.step(step); });
        status.textContent = '速度 ' + Math.round(state.difficulty.speed * 100) + ' · ' + Math.floor(state.elapsed) + ' 秒';
        setScore(ui, state.score);
        if (state.finished) finishGame(ui, '碰到障碍', '得分 ' + state.score);
      } else stepper.reset();
      draw();
      if (!state.finished) frameId = requestAnimationFrame(frame);
    }

    function draw() {
      var context = prepareCanvas(canvas);
      if (!context) return;
      var width = canvas.clientWidth;
      var height = canvas.clientHeight;
      context.clearRect(0, 0, width, height);
      context.fillStyle = '#25292e'; context.fillRect(0, 0, width, height);
      var farOffset = (state.elapsed * state.difficulty.speed * width * 0.16) % (width * 0.34);
      context.fillStyle = '#1d2024';
      for (var x = -width * 0.34 - farOffset; x < width; x += width * 0.34) {
        context.beginPath(); context.moveTo(x, height * 0.62); context.lineTo(x + width * 0.17, height * 0.38); context.lineTo(x + width * 0.34, height * 0.62); context.closePath(); context.fill();
      }
      var ground = state.ground * height;
      context.fillStyle = '#191c20'; context.fillRect(0, ground, width, height - ground);
      context.fillStyle = '#555d64'; context.fillRect(0, ground, width, Math.max(2, height * 0.012));
      var stripe = (state.elapsed * state.difficulty.speed * width) % (width * 0.12);
      for (var line = -stripe; line < width; line += width * 0.12) context.fillRect(line, ground + height * 0.07, width * 0.06, Math.max(2, height * 0.012));
      state.obstacles.forEach(function (obstacle) {
        context.fillStyle = '#d36b62'; roundedRect(context, obstacle.x * width, obstacle.y * height, obstacle.width * width, obstacle.height * height, Math.max(2, width * 0.006)); context.fill();
      });
      drawRunner(context, state, width, height);
    }

    draw();
    frameId = requestAnimationFrame(frame);
    bindKeys(function (event) {
      if (event.key === ' ' || event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') {
        if (!event.repeat) game.pressJump();
        return true;
      }
      return event.key === 'Escape' ? (internalAction('continue'), true) : false;
    }, function (event) {
      if (event.key === ' ' || event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') { game.releaseJump(); return true; }
      return false;
    });
  }

  function showMines() {
    var ui = gameShell('扫雷', '展开安全方格');
    var game = core.createMines({ size: 9, mineCount: 10 });
    var state = game.state();
    var elapsed = 0;
    var started = false;
    var flagMode = false;
    var ignoreClick = false;
    var board = element('div', 'game-board mine-board');
    var buttons = [];
    var status = element('p', 'status');
    for (var index = 0; index < 81; index += 1) {
      (function (cellIndex) {
        var cellButton = makeButton('', 'mine-cell', function () {
          if (ignoreClick) { ignoreClick = false; return; }
          if (flagMode) toggleFlag(cellIndex); else reveal(cellIndex);
        });
        cellButton.addEventListener('contextmenu', function (event) { event.preventDefault(); toggleFlag(cellIndex); });
        cellButton.addEventListener('dblclick', function (event) { event.preventDefault(); chord(cellIndex); });
        var holdTimer;
        cellButton.addEventListener('pointerdown', function (event) {
          if (event.pointerType === 'mouse') return;
          holdTimer = setTimeout(function () { ignoreClick = true; toggleFlag(cellIndex); }, 480);
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (name) {
          cellButton.addEventListener(name, function () { clearTimeout(holdTimer); });
        });
        buttons.push(cellButton);
        board.appendChild(cellButton);
      })(index);
    }
    var revealButton = makeButton('展开', 'primary', function () { reveal(state.cursor); });
    var flagButton = makeButton('标记', '', function () {
      flagMode = !flagMode;
      flagButton.classList.toggle('primary', flagMode);
      flagButton.setAttribute('aria-pressed', String(flagMode));
    });
    var tools = element('div', 'mine-controls');
    tools.append(revealButton, flagButton);
    ui.body.append(board, tools, directionPad(moveCursor), status);
    observeGameSize(ui, board, 'square', render);

    function startTimer() {
      if (started) return;
      started = true;
      var timer = setInterval(function () {
        if (!state.finished && !gameRuntime.state().paused) { elapsed += 1; renderStatus(); }
      }, 1000);
      timers.push(timer);
    }

    function reveal(index) {
      if (gameRuntime.state().paused || state.finished) return;
      var wasInitialized = state.initialized;
      state = game.reveal(index);
      if (!wasInitialized && state.initialized) startTimer();
      render(state.events);
      complete();
    }

    function toggleFlag(index) {
      if (gameRuntime.state().paused || state.finished) return;
      state = game.toggleFlag(index);
      render();
    }

    function chord(index) {
      if (gameRuntime.state().paused || state.finished) return;
      state = game.chord(index);
      render(state.events);
      complete();
    }

    function moveCursor(direction) {
      var movement = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction];
      if (!movement) return;
      state = game.moveCursor(movement[0], movement[1]);
      render();
      if (buttons[state.cursor]) buttons[state.cursor].focus({ preventScroll: true });
    }

    function render(events) {
      events = events || [];
      var revealed = new Map();
      events.filter(function (event) { return event.type === 'reveal'; }).forEach(function (event) {
        event.indexes.forEach(function (cellIndex, order) { revealed.set(cellIndex, order); });
      });
      state.cells.forEach(function (cell, cellIndex) {
        var item = buttons[cellIndex];
        item.className = 'mine-cell' + (cell.open ? ' open' : '') + (cell.open && cell.mine ? ' mine' : '')
          + (cell.wrong ? ' wrong' : '') + (cellIndex === state.triggered ? ' triggered' : '') + (cellIndex === state.cursor ? ' cursor' : '');
        item.textContent = cell.open ? (cell.mine ? '×' : cell.nearby || '') : cell.flagged ? '⚑' : '';
        if (revealed.has(cellIndex) && !reducedMotion()) {
          item.classList.remove('revealing');
          item.style.animationDelay = Math.min(180, revealed.get(cellIndex) * 12) + 'ms';
          requestAnimationFrame(function () { item.classList.add('revealing'); });
        }
      });
      setScore(ui, state.opened);
      renderStatus();
    }

    function renderStatus() {
      if (!state.finished) status.textContent = '剩余旗帜 ' + state.remainingFlags + ' · ' + elapsed + ' 秒';
    }

    function complete() {
      if (!state.finished) return;
      finishGame(ui, state.won ? '全部安全区域已展开' : '踩到地雷', elapsed + ' 秒 · 已展开 ' + state.opened);
    }

    render();
    bindKeys(function (event) {
      var direction = directionForKey(event.key);
      if (direction) { moveCursor(direction); return true; }
      if (event.key === 'Enter' || event.key === ' ') { reveal(state.cursor); return true; }
      if (event.key.toLowerCase() === 'f') { toggleFlag(state.cursor); return true; }
      return false;
    });
  }

  function directionPad(handler) {
    var pad = element('div', 'dpad');
    [['up', '↑'], ['left', '←'], ['down', '↓'], ['right', '→']].forEach(function (item) {
      var button = makeButton(item[1], '', function () { handler(item[0]); });
      button.dataset.direction = item[0];
      pad.appendChild(button);
    });
    return pad;
  }

  function directionForKey(key) {
    return { ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right' }[key];
  }

  function handleDirection(event, handler) {
    var direction = directionForKey(event.key);
    if (direction) { handler(direction); return true; }
    return false;
  }

  function continuousDirection(event, input, pressed) {
    var direction = directionForKey(event.key);
    if (direction === 'left' || direction === 'right') {
      if (pressed) input.press(direction); else input.release(direction);
      return true;
    }
    return false;
  }

  function holdControls(input) {
    var controls = element('div', 'hold-controls');
    controls.append(
      holdButton('←', function () { input.press('left'); }, function () { input.release('left'); }, 'hold-control'),
      holdButton('→', function () { input.press('right'); }, function () { input.release('right'); }, 'hold-control')
    );
    return controls;
  }

  function holdButton(label, onPress, onRelease, className) {
    var button = element('button', className || '', label);
    button.type = 'button';
    button.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      if (button.setPointerCapture) button.setPointerCapture(event.pointerId);
      onPress();
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (name) {
      button.addEventListener(name, function (event) { event.preventDefault(); onRelease(); });
    });
    return button;
  }

  function observeGameSize(ui, stage, kind, onResize) {
    if (resizeCleanup) resizeCleanup();
    var frame;
    function update() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(function () {
        var toolbar = ui.panel.querySelector('.game-head');
        var siblings = Array.prototype.slice.call(ui.body.children).filter(function (item) {
          return item !== stage && !item.classList.contains('game-state');
        });
        var reserved = siblings.reduce(function (height, item) { return height + item.getBoundingClientRect().height; }, 0) + siblings.length * 7;
        var availableWidth = Math.max(180, ui.body.clientWidth);
        var availableHeight = Math.max(170, ui.panel.clientHeight - (toolbar ? toolbar.offsetHeight : 0) - reserved - 34);
        var width;
        var height;
        if (kind === 'square') {
          width = height = Math.min(440, availableWidth, availableHeight);
        } else {
          var ratio = kind === 'racer' ? (availableWidth < 520 ? 0.8 : 1.6) : (availableWidth < 520 ? 4 / 3 : 16 / 9);
          width = Math.min(kind === 'racer' ? 640 : 720, availableWidth);
          height = width / ratio;
          if (height > availableHeight) { height = availableHeight; width = Math.min(availableWidth, height * ratio); }
        }
        stage.style.width = Math.max(kind === 'square' ? 160 : 180, Math.floor(width)) + 'px';
        stage.style.height = Math.max(160, Math.floor(height)) + 'px';
        onResize();
      });
    }
    var observer = new ResizeObserver(update);
    observer.observe(ui.panel);
    observer.observe(ui.body);
    update();
    resizeCleanup = function () { observer.disconnect(); cancelAnimationFrame(frame); };
  }

  function prepareCanvas(canvas) {
    var width = Math.max(1, Math.round(canvas.clientWidth));
    var height = Math.max(1, Math.round(canvas.clientHeight));
    var ratio = Math.max(1, window.devicePixelRatio || 1);
    var pixelWidth = Math.round(width * ratio);
    var pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
    var context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return context;
  }

  function roundedRect(context, x, y, width, height, radius) {
    var value = Math.min(radius, width / 2, height / 2);
    context.beginPath(); context.moveTo(x + value, y);
    context.arcTo(x + width, y, x + width, y + height, value);
    context.arcTo(x + width, y + height, x, y + height, value);
    context.arcTo(x, y + height, x, y, value);
    context.arcTo(x, y, x + width, y, value); context.closePath();
  }

  function drawCar(context, car, width, height, color, player) {
    var carWidth = car.width * width;
    var carHeight = car.height * height;
    var x = car.x * width - carWidth / 2;
    var y = car.y * height;
    context.fillStyle = color; roundedRect(context, x, y, carWidth, carHeight, Math.max(3, carWidth * 0.18)); context.fill();
    context.fillStyle = player ? '#e8f3fa' : '#25292e'; roundedRect(context, x + carWidth * 0.18, y + carHeight * 0.18, carWidth * 0.64, carHeight * 0.28, 2); context.fill();
    context.fillStyle = '#171a1e';
    context.fillRect(x - carWidth * 0.05, y + carHeight * 0.22, carWidth * 0.1, carHeight * 0.22);
    context.fillRect(x + carWidth * 0.95, y + carHeight * 0.22, carWidth * 0.1, carHeight * 0.22);
    context.fillRect(x - carWidth * 0.05, y + carHeight * 0.66, carWidth * 0.1, carHeight * 0.22);
    context.fillRect(x + carWidth * 0.95, y + carHeight * 0.66, carWidth * 0.1, carHeight * 0.22);
  }

  function drawRunner(context, state, width, height) {
    var player = state.player;
    var x = player.x * width;
    var y = player.y * height;
    var playerWidth = player.width * width;
    var playerHeight = player.height * height;
    var phase = Math.floor(state.elapsed * 12) % 2;
    context.fillStyle = '#58a6d8'; roundedRect(context, x, y, playerWidth, playerHeight * 0.72, Math.max(2, playerWidth * 0.15)); context.fill();
    context.fillRect(x + (phase ? playerWidth * 0.12 : playerWidth * 0.52), y + playerHeight * 0.66, playerWidth * 0.30, playerHeight * 0.34);
    context.fillStyle = '#e8f3fa'; context.fillRect(x + playerWidth * 0.66, y + playerHeight * 0.18, Math.max(2, playerWidth * 0.1), Math.max(2, playerWidth * 0.1));
  }

  function reducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function pauseForFocusLoss() {
    var state = gameRuntime.state();
    if (state.kind && !state.finished) {
      if (inputReset) inputReset();
      gameRuntime.setPaused(true);
    }
  }

  var destroyed = false;
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cleanupGame();
    document.removeEventListener('visibilitychange', visibilityHandler);
    window.removeEventListener('blur', pauseForFocusLoss);
    host.remove();
    if (global.__linuxDoGameUIController === controller) global.__linuxDoGameUIController = null;
  }
  var visibilityHandler = function () { if (document.hidden) pauseForFocusLoss(); };
  document.addEventListener('visibilitychange', visibilityHandler);
  window.addEventListener('blur', pauseForFocusLoss);
  var controller = { destroy: destroy, showMenu: showGameMenu, showReminder: showReminder, startGame: startGame };
  global.__linuxDoGameUIController = controller;
  if (reminderMode) showReminder(); else showGameMenu();
  return controller;
  }

  global.LinuxDoGameUI = Object.freeze({ open: open });
})(window);

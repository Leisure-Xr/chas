(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LinuxDoGameCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DIRECTIONS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  };

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number(value) || 0));
  }

  function canonicalGame(kind) {
    if (kind === 'dodge') return 'racer';
    if (kind === 'runner') return 'jumper';
    return String(kind || '');
  }

  function normalizeBestScores(source) {
    source = source || {};
    var result = {};
    ['2048', 'snake', 'racer', 'jumper', 'mines'].forEach(function (kind) {
      var legacy = kind === 'racer' ? 'dodge' : kind === 'jumper' ? 'runner' : kind;
      result[kind] = Math.max(
        Math.max(0, Math.floor(Number(source[kind]) || 0)),
        Math.max(0, Math.floor(Number(source[legacy]) || 0))
      );
    });
    return result;
  }

  function createRuntime(options) {
    options = options || {};
    var bestScores = normalizeBestScores(options.bestScores);
    var active = '';
    var score = 0;
    var paused = false;
    var finished = false;
    return {
      start: function (kind) {
        active = canonicalGame(kind);
        score = 0;
        paused = false;
        finished = false;
        return this.state();
      },
      setScore: function (value) {
        score = Math.max(0, Math.floor(Number(value) || 0));
        if (active && score > (bestScores[active] || 0)) {
          bestScores[active] = score;
          if (options.onBestScore) options.onBestScore(active, score);
        }
        return this.state();
      },
      togglePause: function () {
        if (!finished) paused = !paused;
        if (options.onPause) options.onPause(paused);
        return paused;
      },
      setPaused: function (value) {
        if (!finished) paused = Boolean(value);
        if (options.onPause) options.onPause(paused);
        return paused;
      },
      finish: function () {
        finished = true;
        paused = false;
        return this.state();
      },
      state: function () {
        return { kind: active, score: score, best: bestScores[active] || 0, paused: paused, finished: finished };
      },
      bestScores: function () { return Object.assign({}, bestScores); }
    };
  }

  function createSeededRandom(seed) {
    var value = (Number(seed) || 0x6d2b79f5) >>> 0;
    return function () {
      value ^= value << 13;
      value ^= value >>> 17;
      value ^= value << 5;
      return (value >>> 0) / 4294967296;
    };
  }

  function createInputState() {
    var pressed = Object.create(null);
    return {
      press: function (action) { pressed[action] = true; },
      release: function (action) { pressed[action] = false; },
      active: function (action) { return Boolean(pressed[action]); },
      axis: function (negative, positive) {
        return (pressed[positive] ? 1 : 0) - (pressed[negative] ? 1 : 0);
      },
      reset: function () { pressed = Object.create(null); }
    };
  }

  function createFixedStepper(stepSeconds, maxSteps) {
    var step = clamp(stepSeconds || (1 / 120), 1 / 240, 1 / 20);
    var limit = Math.max(1, Math.floor(maxSteps || 10));
    var accumulator = 0;
    return {
      advance: function (deltaSeconds, update) {
        accumulator += clamp(deltaSeconds, 0, step * limit);
        var count = 0;
        while (accumulator + 1e-10 >= step && count < limit) {
          update(step);
          accumulator -= step;
          count += 1;
        }
        if (Math.abs(accumulator) < 1e-10) accumulator = 0;
        return accumulator / step;
      },
      reset: function () { accumulator = 0; }
    };
  }

  function lineIndexes(direction, line) {
    var forward = direction === 'left' || direction === 'up';
    var indexes = [];
    for (var step = 0; step < 4; step += 1) {
      var position = forward ? step : 3 - step;
      indexes.push(direction === 'left' || direction === 'right' ? line * 4 + position : position * 4 + line);
    }
    return indexes;
  }

  function move2048(board, direction) {
    var source = board.slice(0, 16).map(function (value) { return Number(value) || 0; });
    while (source.length < 16) source.push(0);
    var next = new Array(16).fill(0);
    var gained = 0;
    for (var line = 0; line < 4; line += 1) {
      var indexes = lineIndexes(direction, line);
      var values = indexes.map(function (index) { return source[index]; }).filter(Boolean);
      var merged = [];
      for (var i = 0; i < values.length; i += 1) {
        if (values[i] === values[i + 1]) {
          merged.push(values[i] * 2);
          gained += values[i] * 2;
          i += 1;
        } else merged.push(values[i]);
      }
      indexes.forEach(function (index, offset) { next[index] = merged[offset] || 0; });
    }
    return { board: next, gained: gained, moved: next.join(',') !== source.join(',') };
  }

  function canMove2048(board) {
    if (board.some(function (value) { return !value; })) return true;
    return board.some(function (value, index) {
      return (index % 4 < 3 && value === board[index + 1]) || (index < 12 && value === board[index + 4]);
    });
  }

  function create2048(options) {
    options = options || {};
    var random = options.random || Math.random;
    var tiles;
    var score;
    var nextId;
    var undoState;
    var undoUsed;
    var finished;

    function copyTiles(items) {
      return items.map(function (tile) { return { id: tile.id, value: tile.value, index: tile.index }; });
    }

    function publicState(events) {
      return {
        tiles: copyTiles(tiles),
        board: boardValues(),
        score: score,
        canUndo: Boolean(undoState) && !undoUsed,
        undoUsed: undoUsed,
        finished: finished,
        events: events || []
      };
    }

    function boardValues() {
      var board = new Array(16).fill(0);
      tiles.forEach(function (tile) { board[tile.index] = tile.value; });
      return board;
    }

    function spawnTile() {
      var occupied = new Set(tiles.map(function (tile) { return tile.index; }));
      var empty = [];
      for (var index = 0; index < 16; index += 1) if (!occupied.has(index)) empty.push(index);
      if (!empty.length) return null;
      var tile = {
        id: nextId++,
        value: random() < 0.9 ? 2 : 4,
        index: empty[Math.floor(random() * empty.length)]
      };
      tiles.push(tile);
      return { type: 'spawn', id: tile.id, to: tile.index, value: tile.value };
    }

    function reset() {
      tiles = [];
      score = 0;
      nextId = 1;
      undoState = null;
      undoUsed = false;
      finished = false;
      var events = [spawnTile(), spawnTile()].filter(Boolean);
      return publicState(events);
    }

    function move(direction) {
      if (finished || !DIRECTIONS[direction]) return publicState();
      var source = copyTiles(tiles);
      var byIndex = Object.create(null);
      source.forEach(function (tile) { byIndex[tile.index] = tile; });
      var nextTiles = [];
      var events = [];
      var gained = 0;

      for (var line = 0; line < 4; line += 1) {
        var indexes = lineIndexes(direction, line);
        var input = indexes.map(function (index) { return byIndex[index]; }).filter(Boolean);
        var outputOffset = 0;
        for (var offset = 0; offset < input.length; offset += 1) {
          var first = input[offset];
          var second = input[offset + 1];
          var target = indexes[outputOffset++];
          if (second && first.value === second.value) {
            var value = first.value * 2;
            nextTiles.push({ id: first.id, value: value, index: target });
            events.push({ type: 'move', id: first.id, from: first.index, to: target, value: first.value, merged: true });
            events.push({ type: 'move', id: second.id, from: second.index, to: target, value: second.value, removed: true });
            gained += value;
            offset += 1;
          } else {
            nextTiles.push({ id: first.id, value: first.value, index: target });
            events.push({ type: 'move', id: first.id, from: first.index, to: target, value: first.value });
          }
        }
      }

      var moved = events.some(function (event) { return event.from !== event.to || event.merged || event.removed; });
      if (!moved) return publicState();
      if (!undoUsed) undoState = { tiles: source, score: score };
      tiles = nextTiles;
      score += gained;
      var spawned = spawnTile();
      if (spawned) events.push(spawned);
      finished = !canMove2048(boardValues());
      var result = publicState(events);
      result.moved = true;
      result.gained = gained;
      return result;
    }

    function undo() {
      if (!undoState || undoUsed || finished) return publicState();
      tiles = copyTiles(undoState.tiles);
      score = undoState.score;
      undoState = null;
      undoUsed = true;
      finished = false;
      return publicState([{ type: 'undo' }]);
    }

    reset();
    return { reset: reset, move: move, undo: undo, state: publicState };
  }

  function createSnake(options) {
    options = options || {};
    var size = Math.max(8, Math.floor(options.size || 16));
    var random = options.random || Math.random;
    var snake;
    var previous;
    var direction;
    var queue;
    var food;
    var score;
    var finished;

    function freeCell() {
      var occupied = new Set(snake.map(function (part) { return part.x + ':' + part.y; }));
      var free = [];
      for (var y = 0; y < size; y += 1) {
        for (var x = 0; x < size; x += 1) if (!occupied.has(x + ':' + y)) free.push({ x: x, y: y });
      }
      return free[Math.floor(random() * free.length)] || { x: 0, y: 0 };
    }

    function state(event) {
      return {
        size: size,
        snake: snake.map(copyPoint),
        previous: previous.map(copyPoint),
        direction: copyPoint(direction),
        food: copyPoint(food),
        score: score,
        interval: Math.max(70, 170 - Math.floor(score / 40) * 12),
        finished: finished,
        event: event || ''
      };
    }

    function reset() {
      var center = Math.floor(size / 2);
      snake = [{ x: center, y: center }, { x: center - 1, y: center }, { x: center - 2, y: center }];
      previous = snake.map(copyPoint);
      direction = copyPoint(DIRECTIONS.right);
      queue = [];
      score = 0;
      finished = false;
      food = freeCell();
      return state();
    }

    function queueDirection(name) {
      var candidate = DIRECTIONS[name];
      if (!candidate || finished || queue.length >= 2) return false;
      var base = queue.length ? queue[queue.length - 1] : direction;
      if ((candidate.x === -base.x && candidate.y === -base.y)
          || (candidate.x === base.x && candidate.y === base.y)) return false;
      queue.push(copyPoint(candidate));
      return true;
    }

    function step() {
      if (finished) return state();
      previous = snake.map(copyPoint);
      if (queue.length) direction = queue.shift();
      var head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };
      var ate = head.x === food.x && head.y === food.y;
      var collisionBody = ate ? snake : snake.slice(0, -1);
      if (head.x < 0 || head.y < 0 || head.x >= size || head.y >= size
          || collisionBody.some(function (part) { return part.x === head.x && part.y === head.y; })) {
        finished = true;
        return state('collision');
      }
      snake.unshift(head);
      if (ate) {
        score += 10;
        food = freeCell();
      } else snake.pop();
      return state(ate ? 'eat' : 'move');
    }

    reset();
    return { reset: reset, queueDirection: queueDirection, step: step, state: state };
  }

  function copyPoint(point) {
    return { x: point.x, y: point.y };
  }

  function rectanglesOverlap(left, right) {
    return left.x < right.x + right.width && left.x + left.width > right.x
      && left.y < right.y + right.height && left.y + left.height > right.y;
  }

  function createRacer(options) {
    options = options || {};
    var random = options.random || Math.random;
    var player;
    var obstacles;
    var input;
    var elapsed;
    var spawnIn;
    var roadOffset;
    var score;
    var nextId;
    var finished;

    function difficulty() {
      return {
        speed: 0.36 + Math.min(0.30, elapsed * 0.0025),
        spawn: Math.max(0.48, 0.92 - elapsed * 0.0032)
      };
    }

    function state(events) {
      return {
        player: Object.assign({}, player),
        obstacles: obstacles.map(function (item) { return Object.assign({}, item); }),
        elapsed: elapsed,
        roadOffset: roadOffset,
        score: score,
        finished: finished,
        difficulty: difficulty(),
        events: events || []
      };
    }

    function reset() {
      player = { x: 0.5, y: 0.80, width: 0.085, height: 0.13, velocity: 0 };
      obstacles = [];
      input = 0;
      elapsed = 0;
      spawnIn = 0.72;
      roadOffset = 0;
      score = 0;
      nextId = 1;
      finished = false;
      return state();
    }

    function addObstacle(data) {
      data = data || {};
      var width = clamp(data.width || (0.072 + random() * 0.035), 0.055, 0.13);
      var obstacle = {
        id: nextId++,
        x: clamp(data.x === undefined ? 0.12 + random() * 0.76 : data.x, 0.08 + width / 2, 0.92 - width / 2),
        y: data.y === undefined ? -0.16 : data.y,
        width: width,
        height: clamp(data.height || (0.11 + random() * 0.035), 0.09, 0.17),
        checked: false
      };
      obstacles.push(obstacle);
      return obstacle;
    }

    function setSteer(value) { input = clamp(value, -1, 1); }

    function step(delta) {
      if (finished) return state();
      delta = clamp(delta, 0, 0.05);
      var events = [];
      elapsed += delta;
      var details = difficulty();
      if (input) player.velocity += input * 1.85 * delta;
      else player.velocity *= Math.exp(-5.4 * delta);
      player.velocity = clamp(player.velocity, -0.72, 0.72);
      player.x += player.velocity * delta;
      var minimum = 0.08 + player.width / 2;
      var maximum = 0.92 - player.width / 2;
      if (player.x < minimum || player.x > maximum) {
        player.x = clamp(player.x, minimum, maximum);
        player.velocity *= 0.28;
      }
      roadOffset = (roadOffset + details.speed * delta) % 1;
      spawnIn -= delta;
      if (spawnIn <= 0) {
        addObstacle();
        spawnIn = details.spawn * (0.84 + random() * 0.38);
      }
      obstacles.forEach(function (obstacle) { obstacle.y += details.speed * delta; });

      var playerBox = {
        x: player.x - player.width * 0.38,
        y: player.y + player.height * 0.12,
        width: player.width * 0.76,
        height: player.height * 0.78
      };
      obstacles.forEach(function (obstacle) {
        var obstacleBox = {
          x: obstacle.x - obstacle.width * 0.4,
          y: obstacle.y + obstacle.height * 0.08,
          width: obstacle.width * 0.8,
          height: obstacle.height * 0.84
        };
        if (!finished && rectanglesOverlap(playerBox, obstacleBox)) {
          finished = true;
          events.push({ type: 'collision', id: obstacle.id });
        }
        if (!obstacle.checked && obstacle.y > player.y + player.height) {
          obstacle.checked = true;
          var edgeGap = Math.abs(obstacle.x - player.x) - (obstacle.width + player.width) / 2;
          if (edgeGap >= -0.002 && edgeGap < 0.035) {
            score += 5;
            events.push({ type: 'near-miss', id: obstacle.id });
          }
        }
      });
      obstacles = obstacles.filter(function (obstacle) {
        if (obstacle.y > 1.12) {
          score += 10;
          events.push({ type: 'passed', id: obstacle.id });
          return false;
        }
        return true;
      });
      return state(events);
    }

    reset();
    return { reset: reset, step: step, state: state, setSteer: setSteer, addObstacle: addObstacle };
  }

  function createJumper(options) {
    options = options || {};
    var random = options.random || Math.random;
    var player;
    var obstacles;
    var elapsed;
    var spawnDistance;
    var coyote;
    var jumpBuffer;
    var jumpHeld;
    var passed;
    var score;
    var nextId;
    var finished;
    var ground = 0.82;

    function difficulty() {
      return { speed: 0.34 + Math.min(0.24, elapsed * 0.0022) };
    }

    function state(events) {
      return {
        player: Object.assign({}, player),
        obstacles: obstacles.map(function (item) { return Object.assign({}, item); }),
        elapsed: elapsed,
        ground: ground,
        score: score,
        finished: finished,
        difficulty: difficulty(),
        events: events || []
      };
    }

    function reset() {
      player = { x: 0.12, y: ground - 0.105, width: 0.055, height: 0.105, velocity: 0, grounded: true };
      obstacles = [];
      elapsed = 0;
      spawnDistance = 0.72;
      coyote = 0.09;
      jumpBuffer = 0;
      jumpHeld = false;
      passed = 0;
      score = 0;
      nextId = 1;
      finished = false;
      return state();
    }

    function pressJump() {
      if (!finished) {
        jumpBuffer = 0.12;
        jumpHeld = true;
      }
    }

    function releaseJump() {
      jumpHeld = false;
      if (player.velocity < -0.55) player.velocity *= 0.52;
    }

    function addObstacle(data) {
      data = data || {};
      var height = clamp(data.height || (0.075 + random() * 0.065), 0.06, 0.16);
      var obstacle = {
        id: nextId++,
        x: data.x === undefined ? 1.06 : data.x,
        y: ground - height,
        width: clamp(data.width || (0.035 + random() * 0.035), 0.03, 0.085),
        height: height,
        passed: false
      };
      obstacles.push(obstacle);
      return obstacle;
    }

    function step(delta) {
      if (finished) return state();
      delta = clamp(delta, 0, 0.05);
      var events = [];
      elapsed += delta;
      coyote = player.grounded ? 0.09 : Math.max(0, coyote - delta);
      jumpBuffer = Math.max(0, jumpBuffer - delta);
      if (jumpBuffer > 0 && coyote > 0) {
        player.velocity = -1.34;
        player.grounded = false;
        coyote = 0;
        jumpBuffer = 0;
        events.push({ type: 'jump' });
      }
      player.velocity += (jumpHeld && player.velocity < 0 ? 3.35 : 4.25) * delta;
      player.y += player.velocity * delta;
      var floor = ground - player.height;
      if (player.y >= floor) {
        if (!player.grounded && player.velocity > 0.25) events.push({ type: 'land' });
        player.y = floor;
        player.velocity = 0;
        player.grounded = true;
      } else player.grounded = false;

      var details = difficulty();
      spawnDistance -= details.speed * delta;
      if (spawnDistance <= 0) {
        addObstacle();
        if (elapsed > 28 && random() > 0.76) addObstacle({ x: 1.27, width: 0.035, height: 0.07 + random() * 0.04 });
        spawnDistance = 0.55 + random() * 0.32;
      }
      obstacles.forEach(function (obstacle) { obstacle.x -= details.speed * delta; });
      obstacles.forEach(function (obstacle) {
        if (!obstacle.passed && obstacle.x + obstacle.width < player.x) {
          obstacle.passed = true;
          passed += 1;
          events.push({ type: 'passed', id: obstacle.id });
        }
      });
      obstacles = obstacles.filter(function (obstacle) { return obstacle.x + obstacle.width > -0.05; });

      var playerBox = {
        x: player.x + player.width * 0.13,
        y: player.y + player.height * 0.10,
        width: player.width * 0.72,
        height: player.height * 0.84
      };
      if (obstacles.some(function (obstacle) {
        return rectanglesOverlap(playerBox, {
          x: obstacle.x + obstacle.width * 0.08,
          y: obstacle.y + obstacle.height * 0.06,
          width: obstacle.width * 0.84,
          height: obstacle.height * 0.94
        });
      })) {
        finished = true;
        events.push({ type: 'collision' });
      }
      score = Math.floor(elapsed * 10) + passed * 5;
      return state(events);
    }

    reset();
    return {
      reset: reset,
      step: step,
      state: state,
      pressJump: pressJump,
      releaseJump: releaseJump,
      addObstacle: addObstacle
    };
  }

  function neighbors(index, size) {
    var result = [];
    var x = index % size;
    var y = Math.floor(index / size);
    for (var offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (var offsetX = -1; offsetX <= 1; offsetX += 1) {
        var nextX = x + offsetX;
        var nextY = y + offsetY;
        if ((offsetX || offsetY) && nextX >= 0 && nextY >= 0 && nextX < size && nextY < size) result.push(nextY * size + nextX);
      }
    }
    return result;
  }

  function mineIndexes(size, mineCount, safeIndex, random) {
    random = random || Math.random;
    var excluded = new Set([safeIndex].concat(neighbors(safeIndex, size)));
    var available = [];
    for (var index = 0; index < size * size; index += 1) if (!excluded.has(index)) available.push(index);
    var mines = [];
    while (mines.length < mineCount && available.length) {
      var pick = Math.floor(random() * available.length);
      mines.push(available.splice(pick, 1)[0]);
    }
    return mines;
  }

  function createMines(options) {
    options = options || {};
    var size = Math.max(5, Math.floor(options.size || 9));
    var mineCount = clamp(Math.floor(options.mineCount || 10), 1, size * size - 9);
    var random = options.random || Math.random;
    var cells;
    var initialized;
    var finished;
    var won;
    var triggered;
    var cursor;

    function state(events) {
      var opened = cells.filter(function (cell) { return cell.open && !cell.mine; }).length;
      var flags = cells.filter(function (cell) { return cell.flagged; }).length;
      return {
        size: size,
        mineCount: mineCount,
        cells: cells.map(function (cell) { return Object.assign({}, cell); }),
        initialized: initialized,
        finished: finished,
        won: won,
        triggered: triggered,
        cursor: cursor,
        opened: opened,
        remainingFlags: Math.max(0, mineCount - flags),
        events: events || []
      };
    }

    function reset() {
      cells = new Array(size * size).fill(null).map(function () {
        return { mine: false, open: false, flagged: false, nearby: 0, wrong: false };
      });
      initialized = false;
      finished = false;
      won = false;
      triggered = -1;
      cursor = Math.floor(size * size / 2);
      return state();
    }

    function initialize(safeIndex) {
      mineIndexes(size, mineCount, safeIndex, random).forEach(function (index) { cells[index].mine = true; });
      cells.forEach(function (cell, index) {
        cell.nearby = neighbors(index, size).filter(function (neighbor) { return cells[neighbor].mine; }).length;
      });
      initialized = true;
    }

    function flood(start, opened) {
      var queue = [start];
      var seen = Object.create(null);
      while (queue.length) {
        var index = queue.shift();
        var cell = cells[index];
        if (seen[index] || !cell || cell.flagged || cell.mine) continue;
        seen[index] = true;
        if (!cell.open) {
          cell.open = true;
          opened.push(index);
        }
        if (cell.nearby === 0) queue = queue.concat(neighbors(index, size));
      }
    }

    function completeIfNeeded(events) {
      var opened = cells.filter(function (cell) { return cell.open; }).length;
      if (!finished && opened === size * size - mineCount) {
        finished = true;
        won = true;
        events.push({ type: 'win' });
      }
    }

    function reveal(index) {
      index = clamp(Math.floor(index), 0, cells.length - 1);
      cursor = index;
      if (finished || cells[index].flagged || cells[index].open) return state();
      if (!initialized) initialize(index);
      var events = [];
      if (cells[index].mine) {
        finished = true;
        triggered = index;
        cells.forEach(function (cell) {
          if (cell.mine) cell.open = true;
          if (cell.flagged && !cell.mine) cell.wrong = true;
        });
        events.push({ type: 'mine', index: index });
      } else {
        var opened = [];
        flood(index, opened);
        events.push({ type: 'reveal', indexes: opened });
        completeIfNeeded(events);
      }
      return state(events);
    }

    function toggleFlag(index) {
      index = clamp(Math.floor(index), 0, cells.length - 1);
      cursor = index;
      if (!finished && !cells[index].open) cells[index].flagged = !cells[index].flagged;
      return state([{ type: 'flag', index: index }]);
    }

    function chord(index) {
      index = clamp(Math.floor(index), 0, cells.length - 1);
      cursor = index;
      var cell = cells[index];
      if (finished || !cell.open || !cell.nearby) return state();
      var nearby = neighbors(index, size);
      var flags = nearby.filter(function (neighbor) { return cells[neighbor].flagged; }).length;
      if (flags !== cell.nearby) return state();
      var combined = [];
      nearby.forEach(function (neighbor) {
        if (!cells[neighbor].flagged && !cells[neighbor].open && !finished) {
          var next = reveal(neighbor);
          combined = combined.concat(next.events);
        }
      });
      return state(combined);
    }

    function moveCursor(dx, dy) {
      var x = cursor % size;
      var y = Math.floor(cursor / size);
      x = clamp(x + dx, 0, size - 1);
      y = clamp(y + dy, 0, size - 1);
      cursor = y * size + x;
      return state();
    }

    reset();
    return {
      reset: reset,
      reveal: reveal,
      toggleFlag: toggleFlag,
      chord: chord,
      moveCursor: moveCursor,
      state: state
    };
  }

  function countdown(onTick, onDone, interval) {
    var value = 3;
    var delay = Number(interval) || 1000;
    onTick(value);
    var timer = setInterval(function () {
      value -= 1;
      if (value > 0) onTick(value);
      else {
        clearInterval(timer);
        onTick('开始');
        setTimeout(onDone, Math.min(250, delay));
      }
    }, delay);
    return function () { clearInterval(timer); };
  }

  return {
    canonicalGame: canonicalGame,
    normalizeBestScores: normalizeBestScores,
    createRuntime: createRuntime,
    createSeededRandom: createSeededRandom,
    createInputState: createInputState,
    createFixedStepper: createFixedStepper,
    move2048: move2048,
    canMove2048: canMove2048,
    create2048: create2048,
    createSnake: createSnake,
    createRacer: createRacer,
    createJumper: createJumper,
    rectanglesOverlap: rectanglesOverlap,
    mineIndexes: mineIndexes,
    neighbors: neighbors,
    createMines: createMines,
    countdown: countdown
  };
});

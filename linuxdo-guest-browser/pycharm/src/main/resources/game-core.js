(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LinuxDoGameCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createRuntime(options) {
    options = options || {};
    var bestScores = Object.assign({}, options.bestScores || {});
    var active = '';
    var score = 0;
    var paused = false;
    var finished = false;
    return {
      start: function (kind) {
        active = String(kind || '');
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

  function lineIndexes(direction, line) {
    var forward = direction === 'left' || direction === 'up';
    var indexes = [];
    for (var step = 0; step < 4; step += 1) {
      var position = forward ? step : 3 - step;
      indexes.push(direction === 'left' || direction === 'right' ? line * 4 + position : position * 4 + line);
    }
    return indexes;
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

  function countdown(onTick, onDone, interval) {
    var value = 3;
    var delay = Number(interval) || 450;
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

  return { createRuntime: createRuntime, move2048: move2048, mineIndexes: mineIndexes, neighbors: neighbors, countdown: countdown };
});

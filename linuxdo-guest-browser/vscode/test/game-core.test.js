'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../../shared/game-core');

test('2048 core merges each tile once and reports score', () => {
  const result = core.move2048([2, 2, 2, 2, ...Array(12).fill(0)], 'left');
  assert.deepEqual(result.board.slice(0, 4), [4, 4, 0, 0]);
  assert.equal(result.gained, 8);
  assert.equal(result.moved, true);
});

test('mine placement protects first cell and all neighbors', () => {
  const mines = core.mineIndexes(9, 10, 40, () => 0);
  const protectedCells = new Set([40, ...core.neighbors(40, 9)]);
  assert.equal(mines.length, 10);
  assert.equal(mines.some((index) => protectedCells.has(index)), false);
});

test('runtime stores only integer best scores', () => {
  const saved = [];
  const runtime = core.createRuntime({ bestScores: { snake: 5 }, onBestScore: (kind, score) => saved.push([kind, score]) });
  runtime.start('snake');
  assert.equal(runtime.setScore(12.8).best, 12);
  runtime.setScore(8);
  assert.deepEqual(saved, [['snake', 12]]);
});

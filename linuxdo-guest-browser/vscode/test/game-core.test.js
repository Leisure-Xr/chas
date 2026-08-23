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

test('legacy game ids migrate to canonical best-score keys', () => {
  assert.deepEqual(core.normalizeBestScores({ dodge: 17, racer: 12, runner: 9 }), {
    '2048': 0,
    snake: 0,
    racer: 17,
    jumper: 9,
    mines: 0
  });
});

test('2048 keeps tile ids through a merge and permits one undo per round', () => {
  const game = core.create2048({ random: () => 0 });
  const initial = game.state();
  assert.deepEqual(initial.board.slice(0, 2), [2, 2]);

  const moved = game.move('left');
  assert.equal(moved.score, 4);
  assert.equal(moved.events.filter((event) => event.type === 'move').length, 2);
  assert.equal(moved.tiles.some((tile) => tile.id === initial.tiles[0].id && tile.value === 4), true);

  const undone = game.undo();
  assert.deepEqual(undone.board.slice(0, 2), [2, 2]);
  assert.equal(undone.undoUsed, true);
  game.move('right');
  assert.equal(game.undo().undoUsed, true);
});

test('snake buffers two valid turns without allowing a reversal', () => {
  const game = core.createSnake({ random: core.createSeededRandom(4) });
  assert.equal(game.queueDirection('up'), true);
  assert.equal(game.queueDirection('down'), false);
  assert.equal(game.queueDirection('left'), true);
  assert.deepEqual(game.step().direction, { x: 0, y: -1 });
  assert.deepEqual(game.step().direction, { x: -1, y: 0 });
});

test('racer uses continuous collision boxes and awards a near miss', () => {
  const collisionGame = core.createRacer({ random: core.createSeededRandom(7) });
  collisionGame.addObstacle({ x: 0.5, y: 0.81, width: 0.08, height: 0.12 });
  assert.equal(collisionGame.step(0.01).finished, true);

  const nearGame = core.createRacer({ random: core.createSeededRandom(7) });
  nearGame.addObstacle({ x: 0.5825, y: 0.94, width: 0.08, height: 0.1 });
  const state = nearGame.step(0.01);
  assert.equal(state.finished, false);
  assert.equal(state.events.some((event) => event.type === 'near-miss'), true);
  assert.equal(state.score, 5);
});

test('jumper supports buffered variable-height input and deterministic collision', () => {
  const jumping = core.createJumper({ random: core.createSeededRandom(9) });
  jumping.pressJump();
  const airborne = jumping.step(0.01);
  assert.equal(airborne.player.velocity < 0, true);
  jumping.releaseJump();
  assert.equal(jumping.step(0.01).player.velocity > airborne.player.velocity, true);

  const collision = core.createJumper({ random: core.createSeededRandom(9) });
  collision.addObstacle({ x: 0.13, width: 0.05, height: 0.1 });
  assert.equal(collision.step(0.01).finished, true);
});

test('mine game opens a protected first-click region and tracks keyboard cursor', () => {
  const game = core.createMines({ random: core.createSeededRandom(12), size: 9, mineCount: 10 });
  const revealed = game.reveal(40);
  const protectedCells = [40, ...core.neighbors(40, 9)];
  assert.equal(protectedCells.some((index) => revealed.cells[index].mine), false);
  assert.equal(revealed.opened > 0, true);
  assert.equal(game.moveCursor(1, 0).cursor, 41);
  const closed = revealed.cells.findIndex((cell) => !cell.open);
  assert.equal(game.toggleFlag(closed).remainingFlags, 9);
});

test('fixed stepper caps long frames and preserves a fractional remainder', () => {
  const stepper = core.createFixedStepper(0.01, 4);
  let updates = 0;
  const alpha = stepper.advance(1, () => { updates += 1; });
  assert.equal(updates, 4);
  assert.equal(alpha >= 0 && alpha < 1, true);
});

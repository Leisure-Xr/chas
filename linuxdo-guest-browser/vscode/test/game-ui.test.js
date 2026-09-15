'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

global.window = global;
require('../../shared/game-ui.js');

test('shared game UI keeps its existing dark defaults', () => {
  const theme = global.LinuxDoGameUI.normalizeTheme();
  assert.equal(theme.background, '#202327');
  assert.equal(theme.panel, '#272b30');
  assert.equal(theme.canvas, '#25292e');
  assert.equal(theme.canvasOutside, '#30343a');
  assert.equal(theme.lineSoft, 'rgba(142,149,158,.28)');
  assert.equal(theme.recommended, '#57a6e6');
  assert.equal(theme.scheme, 'dark');
});

test('shared game UI accepts an IDE theme and derives neutral canvas colors', () => {
  const theme = global.LinuxDoGameUI.normalizeTheme({
    background: '#f2f2f2',
    panel: '#ffffff',
    text: '#202020',
    muted: '#6b6b6b',
    line: '#c8c8c8',
    accent: '#2468a2',
    scheme: 'light'
  });
  assert.equal(theme.background, '#f2f2f2');
  assert.equal(theme.canvas, '#ffffff');
  assert.equal(theme.canvasAlt, '#f2f2f2');
  assert.equal(theme.canvasLine, '#c8c8c8');
  assert.equal(theme.scheme, 'light');
});

test('shared game UI rejects unsupported color schemes', () => {
  assert.equal(global.LinuxDoGameUI.normalizeTheme({ scheme: 'sepia' }).scheme, 'dark');
});

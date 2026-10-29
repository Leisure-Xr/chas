// Optional browser regression for the production reader CSS and JS.
// Start the fixture server from linuxdo-guest-browser, then run this script.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = fileURLToPath(new URL('../artifacts/reader-layout/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
const results = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  for (const site of ['linuxdo', 'idcflare', 'nodeseek', 'v2ex']) {
    for (const scheme of ['light', 'dark']) {
      for (const width of [320, 480, 760]) {
        for (const view of ['list', 'topic']) {
          const label = `${site}-${scheme}-${width}-${view}`;
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${process.env.FIXTURE_URL || 'http://127.0.0.1:8765/qa/fixtures/pycharm-reader.html'}?site=${site}&scheme=${scheme}&view=${view}`);
          await page.waitForSelector('html[data-fixture-ready="true"]');
          await page.waitForFunction(() => document.body.classList.contains('lexiao-demo-mode'));
          const state = await page.evaluate(() => {
            const sample = selector => {
              const element = document.querySelector(selector); if (!element) return null;
              const s = getComputedStyle(element), r = element.getBoundingClientRect();
              return { font: s.fontFamily, size: s.fontSize, line: s.lineHeight, weight: s.fontWeight, display: s.display,
                overflowX: s.overflowX, listStyle: s.listStyleType, filter: s.filter, width: r.width, height: r.height, left: r.left, right: r.right,
                scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
            };
            return { pageWidth: document.documentElement.scrollWidth, viewport: innerWidth,
              title: sample('[data-test="title"]'), listTitle: sample('[data-test="list-title"]'), meta: sample('[data-test="meta"]'),
              paragraph: sample('[data-test="paragraph"]'), inline: sample('[data-test="paragraph"] span'), heading: sample('[data-test="heading"]'),
              code: sample('[data-test="code"]'), image: sample('[data-test="image"]'), table: sample('[data-test="table"]'),
              avatar: sample('.avatar'), strong: sample('.markdown_body strong'), list: sample('.markdown_body ul') };
          });
          results.push({ label, ...state });
          assert.ok(state.pageWidth <= width + 1, `${label}: page overflow ${state.pageWidth}`);
          assert.equal(state.meta.size, '12px', `${label}: metadata size`);
          assert.equal(state.avatar.width, 0, `${label}: avatars stay hidden`);
          if (view === 'topic') {
            assert.equal(state.title.size, '18px', `${label}: title size`);
            assert.equal(state.paragraph.size, '14px', `${label}: prose size`);
            assert.equal(state.inline.size, '14px', `${label}: inline font override`);
            assert.equal(state.inline.font, state.paragraph.font, `${label}: prose family`);
            assert.equal(state.paragraph.line, '23.8px', `${label}: prose leading`);
            assert.equal(state.heading.size, '17px', `${label}: section heading`);
            assert.equal(state.list.listStyle, 'disc', `${label}: prose list depth excludes site wrappers`);
            assert.equal(state.code.size, '12px', `${label}: code size`);
            assert.notEqual(state.code.font, state.paragraph.font, `${label}: code stays monospaced`);
            assert.equal(state.code.overflowX, 'auto', `${label}: code scrolling`);
            assert.ok(state.code.scrollWidth > state.code.clientWidth, `${label}: long code scrolls within its block`);
            assert.equal(state.table.overflowX, 'auto', `${label}: table scrolling`);
            assert.ok(state.image.width > 0 && state.image.right <= width, `${label}: visible responsive image`);
            assert.equal(state.image.filter, 'none', `${label}: original image colors`);
            assert.equal(state.strong.weight, '400', `${label}: emphasis uses regular weight`);
            assert.equal(state.title.weight, '400', `${label}: title uses regular weight`);
            assert.equal(state.heading.weight, '400', `${label}: heading uses regular weight`);
          } else {
            assert.equal(state.listTitle.weight, '400', `${label}: list title uses regular weight`);
            assert.equal(state.listTitle.size, '14px', `${label}: list title size`);
            assert.ok(state.listTitle.right <= width + 1, `${label}: list title clipping`);
          }
          if (width === 480) await page.screenshot({ path: resolve(output, label + '.png'), fullPage: true });
          // Disabling must restore the host layout without leaving the reader class.
          await page.evaluate(() => window.__lexiaoReaderModeCleanup());
          assert.equal(await page.locator('body').evaluate(body => body.classList.contains('lexiao-demo-mode')), false);
        }
      }
    }
    console.log(`${site}: list/topic, 320/480/760, light/dark passed`);
  }
  assert.deepEqual(errors, []);
  console.log(`${results.length} layout scenarios passed; screenshots: ${output}`);
} finally {
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await browser.close();
}

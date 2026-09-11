import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './server.mjs';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'couple-browser-test-'));
await mkdir('qa', { recursive: true });
const app = await startServer({ port: 0, host: '127.0.0.1', dataDir });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const errors = [];
try {
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const first = await desktopContext.newPage();
  const second = await mobileContext.newPage();
  for (const page of [first, second]) page.on('pageerror', (error) => errors.push(error.message));
  const origin = `http://127.0.0.1:${app.port}`;
  await first.goto(`${origin}/#${app.token}`);
  await second.goto(`${origin}/?as=b#${app.token}`);
  for (const page of [first, second]) await page.waitForFunction(() => document.querySelector('#syncStatus').textContent === '已同步');
  assert.equal(await first.locator('.task').count(), 100);
  assert.equal(await second.locator('#currentActor').textContent(), 'TA');
  await first.screenshot({ path: 'qa/desktop.png' });
  await second.screenshot({ path: 'qa/mobile.png', fullPage: false });

  await first.locator('input[data-id="1"]').click();
  await second.waitForFunction(() => document.querySelector('input[data-id="1"]').checked);
  assert.equal(await second.locator('#completedCount').textContent(), '1');
  assert.match(await second.locator('[data-item="1"] .task-title').evaluate((el) => getComputedStyle(el).textDecorationLine), /line-through/);
  await second.locator('input[data-id="1"]').click();
  await first.waitForFunction(() => !document.querySelector('input[data-id="1"]').checked);
  console.log('PASS: independent browser sessions synchronize checks and unchecks');

  await first.locator('[data-focus="title-2"]').click();
  await second.locator('[data-focus="title-2"]').click();
  await first.locator('#detailNoteA').fill('A 的旅行计划：去海边');
  await second.locator('#detailNoteB').fill('B 的旅行计划：看日落');
  await first.locator('#detailForm').evaluate((form) => form.requestSubmit());
  await first.waitForFunction(() => !document.querySelector('#detailDialog').open);
  await second.waitForFunction(() => document.querySelector('#detailNoteA').value === 'A 的旅行计划：去海边');
  assert.equal(await second.locator('#detailNoteB').inputValue(), 'B 的旅行计划：看日落');
  await second.locator('#detailForm').evaluate((form) => form.requestSubmit());
  await second.waitForFunction(() => !document.querySelector('#detailDialog').open);
  await first.locator('[data-focus="title-2"]').click();
  assert.equal(await first.locator('#detailNoteB').inputValue(), 'B 的旅行计划：看日落');
  await first.locator('[data-close="detailDialog"]').click();
  console.log('PASS: independently edited notes merge without losing unsaved text');

  await first.locator('[data-focus="title-3"]').click();
  await second.locator('[data-focus="title-3"]').click();
  await first.locator('#detailPlace').fill('地点一');
  await second.locator('#detailPlace').fill('地点二');
  await first.locator('#detailForm').evaluate((form) => form.requestSubmit());
  await second.waitForFunction(() => !document.querySelector('#conflictBanner').hidden);
  assert.equal(await second.locator('#detailPlace').inputValue(), '地点二');
  await second.locator('#detailForm').evaluate((form) => form.requestSubmit());
  await second.waitForFunction(() => document.querySelector('#conflictBanner').textContent.includes('刚被更新'));
  assert.equal(await second.locator('#detailPlace').inputValue(), '地点二');
  second.once('dialog', (dialog) => dialog.accept());
  await second.locator('#reloadDetail').click();
  assert.equal(await second.locator('#detailPlace').inputValue(), '地点一');
  await second.locator('[data-close="detailDialog"]').click();
  console.log('PASS: simultaneous changes to the same field surface a conflict');

  await first.locator('#searchInput').fill('看日落');
  assert.equal(await first.locator('.task').count(), 2);
  await first.locator('#searchInput').fill('不存在的事项');
  assert.equal(await first.locator('.task').count(), 0);
  await first.locator('#searchInput').fill('');
  await first.locator('#categorySelect').selectOption('未来计划');
  assert.equal(await first.locator('.task').count(), 7);
  await first.locator('#categorySelect').selectOption('all');
  await first.locator('[data-filter="done"]').click();
  assert.equal(await first.locator('.task').count(), 0);
  await first.locator('[data-filter="all"]').click();
  console.log('PASS: search, categories, and completion filters');

  await first.locator('#profileButton').click();
  await first.locator('#memberA').fill('小林');
  await first.locator('#memberB').fill('小夏');
  await first.locator('#profileForm button[type=submit]').click();
  await second.waitForFunction(() => document.querySelector('#nameA').textContent === '小林');
  assert.equal(await second.locator('#currentActor').textContent(), '小夏');
  await first.locator('#shareButton').click();
  assert.match(await first.locator('#shareLink').inputValue(), new RegExp(`\\?as=b#${app.token}$`));
  assert.ok(!(await first.locator('#shareLink').inputValue()).includes('127.0.0.1'));
  await first.locator('[data-close="shareDialog"]').click();
  const downloadEvent = first.waitForEvent('download');
  await first.locator('#exportButton').click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /\.json$/);
  await download.saveAs('qa/test-export.json');
  console.log('PASS: names, identity, LAN invitation, and export');

  await first.locator('[data-focus="title-4"]').click();
  await first.locator('#detailNoteA').fill('断线期间保留的草稿');
  await desktopContext.setOffline(true);
  await first.waitForFunction(() => document.querySelector('#syncStatus').textContent === '连接中断');
  assert.equal(await first.locator('#saveDetail').isDisabled(), true);
  assert.equal(await first.locator('#detailNoteA').inputValue(), '断线期间保留的草稿');
  await desktopContext.setOffline(false);
  await first.waitForFunction(() => document.querySelector('#syncStatus').textContent === '已同步');
  assert.equal(await first.locator('#detailNoteA').inputValue(), '断线期间保留的草稿');
  await first.locator('#detailForm').evaluate((form) => form.requestSubmit());
  await first.waitForFunction(() => !document.querySelector('#detailDialog').open);
  console.log('PASS: disconnect disables writes and reconnection preserves the open draft');

  await second.locator('[data-focus="title-1"]').click();
  await second.locator('#detailDone').check();
  await second.locator('#detailPlace').fill('我们常去的小店');
  await second.locator('#detailNoteB').fill('<img src=x onerror=alert(1)>');
  await second.locator('#detailForm').evaluate((form) => form.requestSubmit());
  await second.waitForFunction(() => !document.querySelector('#detailDialog').open);
  await first.waitForFunction(() => document.querySelector('input[data-id="1"]').checked);
  await second.reload();
  await second.waitForFunction(() => document.querySelector('#syncStatus').textContent === '已同步');
  assert.equal(await second.locator('input[data-id="1"]').isChecked(), true);
  assert.equal(await second.locator('#currentActor').textContent(), '小夏');
  await second.locator('[data-focus="title-1"]').click();
  assert.equal(await second.locator('#detailNoteB').inputValue(), '<img src=x onerror=alert(1)>');
  await second.locator('#detailNoteB').fill('一起吃了蛋糕，也许下了新的愿望。');
  await second.screenshot({ path: 'qa/mobile-detail.png' });
  await second.locator('#detailForm').evaluate((form) => form.requestSubmit());
  await second.waitForFunction(() => !document.querySelector('#detailDialog').open);
  console.log('PASS: refresh retains saved records and identity');

  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 1024 }, { width: 1920, height: 1080 }]) {
    await first.setViewportSize(viewport);
    const metrics = await first.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth, imageLoaded: document.querySelector('.source-button img').naturalWidth > 0, svgCount: document.querySelectorAll('svg.lucide').length }));
    assert.ok(metrics.scroll <= metrics.width, `Horizontal overflow at ${viewport.width}: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.imageLoaded, 'Reference image must load');
    assert.ok(metrics.svgCount > 100, 'Lucide icons must render');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: non-overlapping desktop/mobile widths, image and icons, no page errors');
  console.log('Browser checks complete. Test data stayed separate from the real checklist.');
} finally {
  await browser.close();
  await app.close();
}

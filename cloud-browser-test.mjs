import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { initialItems } from './items.mjs';

const root = process.cwd();
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/couple-checklist/')) { res.writeHead(404).end(); return; }
  let relative = url.pathname.slice('/couple-checklist/'.length) || 'index.html';
  if (relative === 'config.js') {
    res.writeHead(200, { 'Content-Type': types['.js'] });
    res.end("window.SUPABASE_CONFIG={url:'https://mock-project.supabase.co',anonKey:'sb_publishable_mock_key_long_enough_for_test'};");
    return;
  }
  if (!['index.html', 'app.js', 'items.mjs', 'style.css', 'reference.jpg', 'vendor/lucide.min.js'].includes(relative)) { res.writeHead(404).end(); return; }
  const file = path.join(root, relative);
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(await readFile(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

let revision = 1;
const state = { version: 1, revision, members: { a: '我', b: 'TA' }, items: structuredClone(initialItems) };
function conflict(base, expected, changes) { return Object.keys(changes).some((key) => base[key] !== expected[key]); }
async function rpc(route) {
  const body = JSON.parse(route.request().postData() || '{}');
  const name = new URL(route.request().url()).pathname.split('/').pop();
  if (name === 'ensure_couple_room' || name === 'get_couple_room') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(name === 'ensure_couple_room' ? { room_id: 'mock' } : state) });
  if (name === 'update_couple_item') {
    const item = state.items.find((entry) => entry.id === body.p_item_id);
    if (conflict(item, body.p_expected, body.p_changes)) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'conflict' }) });
    Object.assign(item, body.p_changes, { updatedAt: new Date().toISOString(), updatedBy: body.p_actor });
  } else if (name === 'update_couple_members') {
    if (conflict(state.members, body.p_expected, body.p_changes)) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'conflict' }) });
    Object.assign(state.members, body.p_changes);
  } else return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  state.revision = ++revision;
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) });
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const contexts = [await browser.newContext(), await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })];
try {
  for (const context of contexts) await context.route('https://mock-project.supabase.co/**', rpc);
  const [first, second] = await Promise.all(contexts.map((context) => context.newPage()));
  const base = `http://127.0.0.1:${server.address().port}/couple-checklist/`;
  await Promise.all([first.goto(`${base}#cloud-room-key-with-more-than-20-chars`), second.goto(`${base}?as=b#cloud-room-key-with-more-than-20-chars`)]);
  await Promise.all([first, second].map((page) => page.waitForFunction(() => document.querySelector('#syncStatus').textContent === '已同步')));
  assert.equal(await first.locator('.task').count(), 100);
  await first.locator('input[data-id="1"]').click();
  await second.waitForFunction(() => document.querySelector('input[data-id="1"]').checked, null, { timeout: 6000 });
  assert.equal(await second.locator('#completedCount').textContent(), '1');
  await first.locator('#shareButton').click();
  const link = await first.locator('#shareLink').inputValue();
  assert.equal(link, `${base}?as=b#cloud-room-key-with-more-than-20-chars`);
  assert.equal(await first.locator('#shareScope').textContent(), '公网 · 可异地使用');
  assert.equal(await first.locator('#shareCondition').textContent(), '无需保持电脑开机');
  assert.ok(await first.locator('.source-button img').evaluate((img) => img.complete && img.naturalWidth > 0));
  console.log('PASS: GitHub Pages subpath assets, cloud sync, and invitation URL');
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './server.mjs';

test('shared checklist authentication, concurrent edits, events, and persistence', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'couple-checklist-test-'));
  let app = await startServer({ port: 0, host: '127.0.0.1', dataDir });
  t.after(async () => { await app.close(); });
  const request = (route, options = {}) => fetch(`http://127.0.0.1:${app.port}${route}`, {
    ...options, headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json', ...options.headers },
  });
  const patch = (id, changes, expected, actor = 'a') => request(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify({ changes, expected, actor }) });
  let saved;

  await t.test('100 exact items and all categories, all initially incomplete', async () => {
    const res = await request('/api/state');
    assert.equal(res.status, 200);
    saved = await res.json();
    assert.equal(saved.items.length, 100);
    assert.equal(saved.items[4].title, '一起吊娃娃');
    assert.equal(saved.items[99].title, '一起白头偕老');
    assert.equal(new Set(saved.items.map((item) => item.id)).size, 100);
    assert.equal(saved.items.filter((item) => item.done).length, 0);
    assert.equal(new Set(saved.items.map((item) => item.category)).size, 6);
  });
  await t.test('private API and disk files are not publicly readable', async () => {
    for (const route of ['/api/state', '/api/events', '/api/meta']) {
      assert.equal((await request(route, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    }
    for (const route of ['/data/checklist.json', '/data/access-key.txt', '/server.mjs', '/server.log']) {
      assert.equal((await request(route)).status, 404);
    }
    assert.equal((await request('/api/items/1', {
      method: 'PATCH', headers: { Origin: 'https://other.example' }, body: '{}',
    })).status, 403);
  });
  await t.test('completion and uncompletion preserve records', async () => {
    let res = await patch(1, { done: true }, { done: false });
    assert.equal(res.status, 200);
    let state = await res.json();
    assert.equal(state.items[0].done, true);
    assert.match(state.items[0].date, /^\d{4}-\d{2}-\d{2}$/);
    const date = state.items[0].date;
    res = await patch(1, { done: false }, { done: true });
    assert.equal(res.status, 200);
    state = await res.json();
    assert.equal(state.items[0].done, false);
    assert.equal(state.items[0].date, date);
  });
  await t.test('simultaneous edits to separate fields merge', async () => {
    const responses = await Promise.all([
      patch(2, { noteA: 'A 的旅行记录' }, { noteA: '' }, 'a'),
      patch(2, { noteB: 'B 的旅行记录' }, { noteB: '' }, 'b'),
    ]);
    assert.deepEqual(responses.map((res) => res.status), [200, 200]);
    const state = await (await request('/api/state')).json();
    assert.equal(state.items[1].noteA, 'A 的旅行记录');
    assert.equal(state.items[1].noteB, 'B 的旅行记录');
  });
  await t.test('same-field conflicts cannot silently overwrite', async () => {
    const responses = await Promise.all([
      patch(3, { place: '地点 A' }, { place: '' }, 'a'),
      patch(3, { place: '地点 B' }, { place: '' }, 'b'),
    ]);
    assert.deepEqual(responses.map((res) => res.status).sort(), [200, 409]);
  });
  await t.test('invalid dates, unbounded text, missing expectations and fields are rejected', async () => {
    const revision = (await (await request('/api/state')).json()).revision;
    for (const [changes, expected] of [
      [{ date: '2026-02-30' }, { date: '' }],
      [{ date: 'not a date' }, { date: '' }],
      [{ done: 'true' }, { done: false }],
      [{ noteA: 'a'.repeat(2001) }, { noteA: '' }],
      [{ title: 'not editable' }, { title: '一起吃海底捞' }],
    ]) assert.equal((await patch(4, changes, expected)).status, 400);
    assert.equal((await patch(4, { done: true }, {})).status, 409);
    assert.equal((await patch(101, { done: true }, { done: false })).status, 404);
    assert.equal((await (await request('/api/state')).json()).revision, revision);
  });
  await t.test('names persist and SSE sends changes', async () => {
    const controller = new AbortController();
    const res = await request('/api/events', { signal: controller.signal });
    const reader = res.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /^data: /);
    const update = await request('/api/members', {
      method: 'PATCH', body: JSON.stringify({ actor: 'a', changes: { a: '小林', b: '小夏' }, expected: { a: '我', b: 'TA' } }),
    });
    assert.equal(update.status, 200);
    const text = new TextDecoder().decode((await reader.read()).value);
    assert.match(text, /小林/);
    controller.abort();
    await reader.cancel().catch(() => {});
  });
  await t.test('server restart retains edits and the invitation key', async () => {
    const before = await (await request('/api/state')).json();
    const token = app.token;
    assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, 'checklist.json'), 'utf8')), before);
    await app.close();
    app = await startServer({ port: 0, host: '127.0.0.1', dataDir });
    assert.equal(app.token, token);
    assert.deepEqual(await (await request('/api/state')).json(), before);
  });
});

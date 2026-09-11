import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialItems, categories } from './items.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/config.js', ['config.js', 'text/javascript; charset=utf-8']],
  ['/items.mjs', ['items.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/vendor/lucide.min.js', ['vendor/lucide.min.js', 'text/javascript; charset=utf-8']],
  ['/reference.jpg', ['reference.jpg', 'image/jpeg']],
]);
const fail = (status, message) => Object.assign(new Error(message), { status });
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());

export async function startServer({ port = 8765, host = '0.0.0.0', dataDir = path.join(root, 'data') } = {}) {
  await mkdir(dataDir, { recursive: true });
  const statePath = path.join(dataDir, 'checklist.json');
  const keyPath = path.join(dataDir, 'access-key.txt');
  let token;
  try { token = (await readFile(keyPath, 'utf8')).trim(); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    token = randomBytes(24).toString('base64url');
    await writeFile(keyPath, token, { mode: 0o600, flag: 'wx' });
  }
  let state;
  try { state = JSON.parse(await readFile(statePath, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = { version: 1, revision: 0, members: { a: '我', b: 'TA' }, items: structuredClone(initialItems) };
    await writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600, flag: 'wx' });
  }
  if (state.version !== 1 || state.items?.length !== 100 || !Number.isInteger(state.revision)) {
    throw new Error('Invalid saved checklist. Existing data has not been overwritten.');
  }
  const subscribers = new Set();
  const event = (res) => res.write(`data: ${JSON.stringify(state)}\n\n`);
  let transaction = Promise.resolve();
  function update(work) {
    const next = transaction.then(async () => {
      const draft = structuredClone(state);
      work(draft);
      draft.revision += 1;
      // Commit to disk before publishing a revision to either participant.
      await writeFile(`${statePath}.tmp`, JSON.stringify(draft, null, 2), { mode: 0o600 });
      await rename(`${statePath}.tmp`, statePath);
      state = draft;
      for (const res of subscribers) event(res);
      return state;
    });
    transaction = next.catch(() => {});
    return next;
  }
  function authorized(req) {
    const incoming = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
    const secret = Buffer.from(token);
    return incoming.length === secret.length && timingSafeEqual(incoming, secret);
  }
  const json = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  };
  async function body(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 32768) throw fail(413, '内容过长');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString()); }
    catch { throw fail(400, '数据格式不正确'); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (!authorized(req)) return json(res, 401, { error: '请使用完整的邀请链接打开清单' });
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) {
          throw fail(403, '不允许来自其他网站的请求');
        }
        if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, state);
        if (req.method === 'GET' && url.pathname === '/api/meta') {
          const addresses = Object.values(networkInterfaces()).flat()
            .filter((n) => n.family === 'IPv4' && !n.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address))
            .map((n) => n.address).sort((a, b) => Number(b.startsWith('192.168.')) - Number(a.startsWith('192.168.')));
          return json(res, 200, { categories, addresses, port: server.address().port });
        }
        if (req.method === 'GET' && url.pathname === '/api/events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive' });
          event(res);
          subscribers.add(res);
          const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
          res.on('close', () => { subscribers.delete(res); clearInterval(heartbeat); });
          return;
        }
        const itemMatch = url.pathname.match(/^\/api\/items\/(\d+)$/);
        if (req.method === 'PATCH' && (itemMatch || url.pathname === '/api/members')) {
          const input = await body(req);
          if (!isObject(input) || !['a', 'b'].includes(input.actor) || !isObject(input.changes) || !isObject(input.expected)) {
            throw fail(400, '修改内容不完整');
          }
          const members = !itemMatch;
          const allowed = members ? { a: 20, b: 20 } : { done: 'boolean', date: 10, place: 120, noteA: 2000, noteB: 2000 };
          const keys = Object.keys(input.changes);
          if (!keys.length || keys.some((key) => !Object.hasOwn(allowed, key))) throw fail(400, '不支持的修改');
          for (const key of keys) {
            const value = input.changes[key];
            if (allowed[key] === 'boolean') {
              if (typeof value !== 'boolean') throw fail(400, '完成状态不正确');
            } else if (typeof value !== 'string' || value.length > allowed[key] || (members && !value.trim())) {
              throw fail(400, '内容为空或超出长度限制');
            }
            if (key === 'date' && value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) {
              throw fail(400, '日期不正确');
            }
          }
          const result = await update((draft) => {
            const target = members ? draft.members : draft.items.find((item) => item.id === Number(itemMatch[1]));
            if (!target) throw fail(404, '没有这条清单项目');
            // Only changed fields are compared, so independent edits can merge safely.
            for (const key of keys) {
              if (!Object.hasOwn(input.expected, key) || target[key] !== input.expected[key]) throw fail(409, '这部分内容刚被更新，请核对最新记录后重试');
            }
            Object.assign(target, input.changes);
            if (!members) {
              if (input.changes.done === true && !target.date && !Object.hasOwn(input.changes, 'date')) target.date = today();
              target.updatedAt = new Date().toISOString();
              target.updatedBy = input.actor;
            }
          });
          return json(res, 200, result);
        }
        return json(res, 404, { error: '接口不存在' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: '请求方式不支持' });
      const asset = assets.get(url.pathname);
      if (!asset) return json(res, 404, { error: '页面不存在' });
      const content = await readFile(path.join(root, asset[0]));
      res.writeHead(200, { 'Content-Type': asset[1] });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : '保存失败，请重试；已有记录未清空' });
      else res.end();
      if (!error.status) console.error(error);
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return {
    server, token, port: server.address().port,
    close: async () => {
      for (const res of subscribers) res.end();
      await transaction;
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await startServer({ port: Number(process.env.PORT || 8765) });
  console.log(`Local: http://localhost:${app.port}/#${app.token}`);
  for (const n of Object.values(networkInterfaces()).flat()) {
    if (n.family === 'IPv4' && !n.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address)) {
      console.log(`LAN: http://${n.address}:${app.port}/#${app.token}`);
    }
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}

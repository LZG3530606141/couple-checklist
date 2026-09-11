import { initialItems, categories as initialCategories } from './items.mjs';

(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const escape = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = location.hash.slice(1);
  const cloud = window.SUPABASE_CONFIG && /^https:\/\/.+\.supabase\.co\/?$/.test(window.SUPABASE_CONFIG.url || '') && (window.SUPABASE_CONFIG.anonKey || '').length > 20;
  const cloudBase = cloud ? window.SUPABASE_CONFIG.url.replace(/\/$/, '') : '';
  const cloudHeaders = cloud ? { apikey: window.SUPABASE_CONFIG.anonKey, Authorization: `Bearer ${window.SUPABASE_CONFIG.anonKey}`, 'Content-Type': 'application/json' } : {};
  const identityKey = `couple-identity-${token.slice(0, 12)}`;
  let actor = 'a';
  try { actor = localStorage.getItem(identityKey) || 'a'; } catch {}
  const invitedAs = new URLSearchParams(location.search).get('as');
  if (['a', 'b'].includes(invitedAs)) {
    actor = invitedAs;
    try { localStorage.setItem(identityKey, actor); } catch {}
    history.replaceState(null, '', `${location.pathname}${location.hash}`);
  }
  if (!['a', 'b'].includes(actor)) actor = 'a';
  const ui = { state: null, meta: null, filter: 'all', category: 'all', search: '', connected: false, pending: new Set() };
  let detailBase = null;
  let profileBase = null;
  let savingDetail = false;
  let toastTimer;
  const fields = { done: '#detailDone', date: '#detailDate', place: '#detailPlace', noteA: '#detailNoteA', noteB: '#detailNoteB' };
  const icons = () => window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' } });
  const localDate = () => new Intl.DateTimeFormat('sv-SE').format(new Date());
  const shortDate = (value) => value ? value.slice(0, 10).replaceAll('-', '.') : '';
  function toast(message) {
    clearTimeout(toastTimer);
    $('#toast').textContent = message;
    $('#toast').hidden = false;
    // Dialogs occupy the browser top layer; their messages need to be in it too.
    ($('dialog[open]') || document.body).append($('#toast'));
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000);
  }
  function connected(value) {
    ui.connected = value;
    $('#syncStatus').textContent = value ? '已同步' : '连接中断';
    $('#syncStatus').className = `sync-status ${value ? 'online' : 'offline'}`;
    const banner = $('#errorBanner');
    banner.hidden = value;
    if (!value) banner.textContent = '连接已中断，正在重连。未保存的记录仍保留在编辑框中。';
    $$('.task input').forEach((input) => { input.disabled = !value || ui.pending.has(Number(input.dataset.id)); });
    $('#saveDetail').disabled = !value || savingDetail;
  }
  async function rawRequest(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(url, { ...options, headers: { ...(cloud ? cloudHeaders : { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }), ...(options.headers || {}) }, signal: controller.signal });
      const data = await res.json();
      if (!res.ok) throw Object.assign(new Error(data.error || data.message || '请求失败'), { status: data.message === 'conflict' ? 409 : res.status });
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('连接超时，记录未确认保存，请稍后重试');
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function rpc(name, args) {
    return rawRequest(`${cloudBase}/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
  }
  async function api(url, options = {}) {
    if (!cloud) return rawRequest(url, options);
    if (options.method === 'PATCH') {
      const input = JSON.parse(options.body);
      const match = url.match(/^\/api\/items\/(\d+)$/);
      if (match) return rpc('update_couple_item', { p_room_key: token, p_item_id: Number(match[1]), p_actor: input.actor, p_changes: input.changes, p_expected: input.expected });
      if (url === '/api/members') return rpc('update_couple_members', { p_room_key: token, p_actor: input.actor, p_changes: input.changes, p_expected: input.expected });
    }
    if (url === '/api/meta') return { categories: initialCategories, addresses: [], port: 0, cloud: true };
    if (url === '/api/state') return rpc('get_couple_room', { p_room_key: token });
    throw Object.assign(new Error('不支持的云端请求'), { status: 400 });
  }
  function applyState(state) {
    if (!ui.state || state.revision >= ui.state.revision) {
      ui.state = state;
      render();
      refreshOpenDetail();
    }
  }
  async function mutate(url, changes, base) {
    const expected = Object.fromEntries(Object.keys(changes).map((key) => [key, base[key]]));
    try {
      const state = await api(url, { method: 'PATCH', body: JSON.stringify({ actor, changes, expected }) });
      applyState(state);
    } catch (error) {
      if (error.status === 409) {
        try { applyState(await api('/api/state')); } catch {}
      }
      throw error;
    }
  }
  function render() {
    const { items, members } = ui.state;
    const done = items.filter((item) => item.done);
    $('#nameA').textContent = members.a;
    $('#nameB').textContent = members.b;
    $('#avatarA').textContent = [...members.a][0];
    $('#avatarB').textContent = [...members.b][0];
    $('#currentActor').textContent = members[actor];
    $('#completedCount').textContent = done.length;
    $('#totalProgress').value = done.length;
    $('#remainingCount').textContent = done.length === 100 ? '100 件事，都有我们' : `还有 ${100 - done.length} 件小事`;
    $('#percent').textContent = `${done.length}%`;
    $('#doneCount').textContent = done.length;
    $('#todoCount').textContent = 100 - done.length;
    $('#noteALabel').textContent = `${members.a}的记录`;
    $('#noteBLabel').textContent = `${members.b}的记录`;
    const categories = [...new Set(items.map((item) => item.category))];
    $('#categoryStats').innerHTML = categories.map((category) => {
      const all = items.filter((item) => item.category === category);
      const count = all.filter((item) => item.done).length;
      return `<button class="category-stat ${category === ui.category ? 'active' : ''}" data-category="${escape(category)}"><span>${escape(category)}<small>${count} / ${all.length}</small></span><progress value="${count}" max="${all.length}" aria-label="${escape(category)}完成进度"></progress></button>`;
    }).join('');
    const recent = done.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);
    $('#recentMemories').innerHTML = recent.length ? recent.map((item) => `<button class="recent-item" data-detail="${item.id}"><span>${escape(item.title)}</span><small>${shortDate(item.date) || '日期未填写'}${item.place ? ` · ${escape(item.place)}` : ''}</small></button>`).join('') : '<p class="muted">暂时还没有打卡</p>';
    const changed = items.filter((item) => item.updatedAt).toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    $('#updatedFooter').textContent = changed.length ? `最近记录 ${new Date(changed[0].updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` : '尚无完成记录';
    renderList();
  }
  function renderList() {
    if (!ui.state) return;
    const query = ui.search.trim().toLowerCase();
    const items = ui.state.items.filter((item) =>
      (ui.filter === 'all' || (ui.filter === 'done' ? item.done : !item.done)) &&
      (ui.category === 'all' || item.category === ui.category) &&
      (!query || [item.id, item.title, item.place, item.noteA, item.noteB].join(' ').toLowerCase().includes(query))
    );
    const focused = document.activeElement?.dataset.focus;
    $('#resultCount').textContent = `${items.length} 件小事`;
    $('#checklist').innerHTML = items.length ? items.map((item) => {
      const hasNote = item.noteA || item.noteB || item.place;
      const meta = item.done ? (shortDate(item.date) || '已完成') : item.category;
      return `<article class="task ${item.done ? 'done' : ''} ${hasNote ? 'has-note' : ''}" data-item="${item.id}">
        <label class="check-label"><input type="checkbox" data-id="${item.id}" data-focus="check-${item.id}" aria-label="完成：${escape(item.title)}" ${item.done ? 'checked' : ''} ${!ui.connected || ui.pending.has(item.id) ? 'disabled' : ''}></label>
        <div class="task-body"><button class="task-title" data-detail="${item.id}" data-focus="title-${item.id}">${escape(item.title)}</button><div class="task-meta"><span class="task-number">${String(item.id).padStart(3, '0')}</span><span>·</span><span>${escape(meta)}</span></div></div>
        <button class="icon-button details-button" data-detail="${item.id}" data-focus="detail-${item.id}" title="${hasNote ? '查看或编辑记录' : '填写记录'}" aria-label="填写记录：${escape(item.title)}"><i data-lucide="${hasNote ? 'message-square-text' : 'pencil'}"></i></button>
      </article>`;
    }).join('') : '<div class="empty-state">没有符合条件的小事</div>';
    icons();
    if (focused) $(`[data-focus="${focused}"]`)?.focus({ preventScroll: true });
  }
  function openDetail(id) {
    if (!ui.state) return;
    detailBase = structuredClone(ui.state.items.find((item) => item.id === id));
    $('#detailTitle').textContent = detailBase.title;
    $('#detailMeta').textContent = `NO. ${String(id).padStart(3, '0')} / ${detailBase.category}`;
    fillDetail();
    $('#detailDialog').showModal();
    $('#detailPlace').focus({ preventScroll: true });
  }
  function fillDetail() {
    for (const [key, selector] of Object.entries(fields)) {
      if (key === 'done') $(selector).checked = detailBase[key];
      else $(selector).value = detailBase[key];
    }
    $('#conflictBanner').hidden = true;
    $('#detailUpdated').textContent = detailBase.updatedAt ? `${ui.state.members[detailBase.updatedBy]} · ${shortDate(detailBase.updatedAt)}` : '还没有记录';
  }
  function fieldValue(key) { return key === 'done' ? $(fields[key]).checked : $(fields[key]).value; }
  function detailDirty() { return detailBase && Object.keys(fields).some((key) => fieldValue(key) !== detailBase[key]); }
  function refreshOpenDetail() {
    if (!detailBase || !$('#detailDialog').open || savingDetail) return;
    const latest = ui.state.items.find((item) => item.id === detailBase.id);
    let conflict = false;
    for (const [key, selector] of Object.entries(fields)) {
      if (latest[key] === detailBase[key]) continue;
      if (fieldValue(key) === detailBase[key]) {
        if (key === 'done') $(selector).checked = latest[key];
        else $(selector).value = latest[key];
        detailBase[key] = latest[key];
      } else conflict = true;
    }
    if (conflict) {
      $('#conflictBanner').hidden = false;
      $('#conflictBanner').innerHTML = '另一半刚更新了你正在编辑的内容。你的草稿仍在。<button type="button" id="reloadDetail">读取最新记录</button>';
    }
  }
  function closeDialog(id) {
    if (id === 'detailDialog' && detailDirty() && !confirm('这条记录尚未保存，要放弃修改吗？')) return;
    if (id === 'detailDialog' && savingDetail) return;
    document.body.append($('#toast'));
    $(`#${id}`).close();
    if (id === 'detailDialog') detailBase = null;
  }
  document.addEventListener('click', (event) => {
    const detail = event.target.closest('[data-detail]');
    if (detail) openDetail(Number(detail.dataset.detail));
    const close = event.target.closest('[data-close]');
    if (close) closeDialog(close.dataset.close);
    const category = event.target.closest('[data-category]');
    if (category) {
      ui.category = category.dataset.category;
      $('#categorySelect').value = ui.category;
      render();
    }
    if (event.target.id === 'reloadDetail' && confirm('读取最新记录会替换当前草稿，继续吗？')) {
      detailBase = structuredClone(ui.state.items.find((item) => item.id === detailBase.id));
      fillDetail();
    }
  });
  $$('dialog').forEach((dialog) => dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(dialog.id); }));
  $$('.segments button').forEach((button) => button.addEventListener('click', () => {
    ui.filter = button.dataset.filter;
    $$('.segments button').forEach((other) => { other.classList.toggle('active', other === button); other.setAttribute('aria-pressed', String(other === button)); });
    renderList();
  }));
  $('#searchInput').addEventListener('input', (event) => { ui.search = event.target.value; renderList(); });
  $('#categorySelect').addEventListener('change', (event) => { ui.category = event.target.value; render(); });
  $('#checklist').addEventListener('change', async (event) => {
    const input = event.target.closest('input[data-id]');
    if (!input) return;
    const item = ui.state.items.find((value) => value.id === Number(input.dataset.id));
    const desired = input.checked;
    input.checked = item.done;
    if (!ui.connected || ui.pending.has(item.id)) return;
    ui.pending.add(item.id);
    input.disabled = true;
    try {
      const changes = { done: desired };
      if (desired && !item.date) changes.date = localDate();
      await mutate(`/api/items/${item.id}`, changes, item);
      toast(desired ? `已完成：${item.title}` : '已恢复为未完成');
    } catch (error) { toast(error.message || '保存失败，请检查连接后重试'); }
    finally { ui.pending.delete(item.id); renderList(); }
  });
  $('#detailDone').addEventListener('change', () => {
    if ($('#detailDone').checked && !$('#detailDate').value) $('#detailDate').value = localDate();
  });
  $('#detailForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (savingDetail || !ui.connected) return;
    const changes = Object.fromEntries(Object.keys(fields).filter((key) => fieldValue(key) !== detailBase[key]).map((key) => [key, fieldValue(key)]));
    if (!Object.keys(changes).length) { closeDialog('detailDialog'); return; }
    savingDetail = true;
    $('#saveDetail').disabled = true;
    try {
      await mutate(`/api/items/${detailBase.id}`, changes, detailBase);
      detailBase = null;
      $('#detailDialog').close();
      toast('记录已保存');
    } catch (error) {
      $('#conflictBanner').hidden = false;
      $('#conflictBanner').textContent = error.message;
      if (error.status === 409) $('#conflictBanner').innerHTML += '<button type="button" id="reloadDetail">读取最新记录</button>';
    } finally { savingDetail = false; $('#saveDetail').disabled = !ui.connected; }
  });
  $('#profileButton').addEventListener('click', () => {
    if (!ui.state) return;
    profileBase = structuredClone(ui.state.members);
    $('#memberA').value = profileBase.a;
    $('#memberB').value = profileBase.b;
    $('#actorNameA').textContent = profileBase.a;
    $('#actorNameB').textContent = profileBase.b;
    $(`input[name="actor"][value="${actor}"]`).checked = true;
    $('#profileDialog').showModal();
  });
  ['A', 'B'].forEach((letter) => $(`#member${letter}`).addEventListener('input', () => { $(`#actorName${letter}`).textContent = $(`#member${letter}`).value || (letter === 'A' ? '第一位' : '第二位'); }));
  $('#profileForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = $('#profileForm button[type=submit]');
    if (submit.disabled) return;
    const names = { a: $('#memberA').value.trim(), b: $('#memberB').value.trim() };
    if (!names.a || !names.b) return toast('请填写两个人的名字');
    const changes = Object.fromEntries(Object.entries(names).filter(([key, value]) => value !== profileBase[key]));
    submit.disabled = true;
    try {
      if (Object.keys(changes).length) await mutate('/api/members', changes, profileBase);
      actor = $('input[name="actor"]:checked').value;
      try { localStorage.setItem(identityKey, actor); } catch {}
      render();
      closeDialog('profileDialog');
      toast('已保存');
    } catch (error) { toast(error.message); }
    finally { submit.disabled = false; }
  });
  function updateShareLink() {
    const base = ($('#addressSelect').value || new URL('.', location.href).href).replace(/\/$/, '');
    $('#shareLink').value = `${base}/?as=${actor === 'a' ? 'b' : 'a'}#${token}`;
    if (!cloud) {
      const tailscale = /^http:\/\/100\./.test(base);
      const temporaryTunnel = /\.trycloudflare\.com$/i.test(new URL(base).hostname);
      $('#shareScope').textContent = tailscale ? 'Tailscale 私网 · 可异地使用' : temporaryTunnel ? 'Cloudflare 临时公网 · 可异地使用' : '同一 Wi-Fi / 局域网';
      $('#shareStorage').textContent = '当前电脑';
      $('#shareCondition').textContent = tailscale ? '双方开启 Tailscale，电脑保持开机' : temporaryTunnel ? '无需对方安装软件，电脑保持开机' : '电脑开机且服务运行中';
    }
  }
  $('#shareButton').addEventListener('click', () => {
    if (!ui.state || !ui.meta) return toast('清单尚未连接');
    if (cloud) {
      $('#shareScope').textContent = '公网 · 可异地使用';
      $('#shareStorage').textContent = 'Supabase 云端';
      $('#shareCondition').textContent = '无需保持电脑开机';
    }
    const isLocal = !cloud && ['localhost', '127.0.0.1'].includes(location.hostname);
    const origins = isLocal ? ui.meta.addresses.map((ip) => `http://${ip}:${ui.meta.port}`) : [new URL('.', location.href).href.replace(/\/$/, '')];
    if (!origins.length) return toast('未找到局域网地址，请先连接 Wi-Fi');
    $('#addressSelect').innerHTML = origins.map((origin) => `<option value="${escape(origin)}">${escape(origin)}</option>`).join('');
    $('#addressLabel').hidden = origins.length < 2;
    updateShareLink();
    $('#shareDialog').showModal();
  });
  $('#addressSelect').addEventListener('change', updateShareLink);
  async function copyLink() {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText($('#shareLink').value);
      else {
        $('#shareLink').focus();
        $('#shareLink').select();
        if (!document.execCommand('copy')) throw new Error('copy unavailable');
      }
      toast('邀请链接已复制');
    } catch { $('#shareLink').focus(); $('#shareLink').select(); toast('链接已选中，请长按复制'); }
  }
  $('#copyLink').addEventListener('click', copyLink);
  $('#nativeShare').addEventListener('click', async () => {
    if (!navigator.share) return copyLink();
    try { await navigator.share({ title: '我们两个人的100件事', url: $('#shareLink').value }); }
    catch (error) { if (error.name !== 'AbortError') await copyLink(); }
  });
  $('#randomButton').addEventListener('click', () => {
    if (!ui.state) return;
    const todos = ui.state.items.filter((item) => !item.done && (ui.category === 'all' || item.category === ui.category));
    if (!todos.length) return toast('这一组小事已经全部完成');
    openDetail(todos[Math.floor(Math.random() * todos.length)].id);
  });
  $('#sourceButton').addEventListener('click', () => $('#sourceDialog').showModal());
  $$('[data-export]').forEach((button) => button.addEventListener('click', () => {
    if (!ui.state) return;
    const blob = new Blob([JSON.stringify({ ...ui.state, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `情侣打卡记录-${localDate()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('记录已导出');
  }));
  $('#home').href = `${location.pathname}${location.hash}`;
  let streamController;
  window.addEventListener('offline', () => { connected(false); streamController?.abort(); });
  window.addEventListener('online', () => streamController?.abort());
  window.addEventListener('beforeunload', (event) => {
    if (detailDirty()) { event.preventDefault(); event.returnValue = ''; }
  });
  async function subscribe() {
    if (cloud) {
      let delay = 1800;
      while (true) {
        try {
          applyState(await api('/api/state'));
          connected(true);
          delay = 1800;
        } catch { connected(false); delay = Math.min(delay * 2, 12000); }
        await new Promise((resolve) => setTimeout(resolve, document.hidden ? Math.max(delay, 8000) : delay));
      }
    }
    let delay = 1000;
    while (true) {
      try {
        streamController = new AbortController();
        const response = await fetch('/api/events', { headers: { Authorization: `Bearer ${token}` }, signal: streamController.signal });
        if (!response.ok) throw Object.assign(new Error('连接失败'), { status: response.status });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) throw new Error('连接已断开');
          buffer += decoder.decode(value, { stream: true });
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const chunk = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (chunk.startsWith('data: ')) {
              connected(true);
              applyState(JSON.parse(chunk.slice(6)));
              delay = 1000;
            }
          }
        }
      } catch (error) {
        connected(false);
        if (error.status === 401) { $('#errorBanner').textContent = '邀请链接已失效，请向另一半索取当前链接。'; return; }
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 8000);
      }
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && token && ui.state) api('/api/state').then(applyState).catch(() => {});
  });
  icons();
  async function init() {
    if (!token) {
      $('#checklist').innerHTML = '<div class="empty-state">请使用完整的邀请链接打开清单</div>';
      $('#syncStatus').textContent = '未加入';
      return;
    }
    try {
      ui.meta = await api('/api/meta');
      $('#categorySelect').innerHTML = '<option value="all">全部分类</option>' + ui.meta.categories.map((category) => `<option value="${escape(category)}">${escape(category)}</option>`).join('');
      if (cloud) await rpc('ensure_couple_room', { p_room_key: token, p_items: initialItems.map(({ id, title, category }) => ({ id, title, category })) });
      applyState(await api('/api/state'));
      subscribe();
    } catch (error) {
      connected(false);
      $('#checklist').innerHTML = '<div class="empty-state">清单暂时无法加载</div>';
      $('#errorBanner').textContent = error.message || '请确认电脑上的共享服务正在运行';
      if (error.status !== 401) setTimeout(init, 5000);
    }
  }
  init();
})();

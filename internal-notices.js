(function () {
  'use strict';
  const state = { client: null, userId: null, canManage: false, notices: [], reads: new Map(), filter: 'all', search: '', editing: null, timer: null, loading: null, epoch: 0 };
  const all = selector => [...document.querySelectorAll(selector)];
  const text = (tag, value, className) => {
    const node = document.createElement(tag); node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  const date = value => value ? new Date(value).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }) : '草稿';
  const unread = notice => Number(state.reads.get(notice.id) || 0) < Number(notice.revision);
  const published = () => state.notices.filter(notice => notice.is_published);
  function status(message = '', success = false) { all('[data-in-status]').forEach(node => { node.textContent = message; node.classList.toggle('in-success', success); }); }
  function checked(result) { if (result.error) throw new Error(result.error.message); return result.data; }
  function safeUrl(value) {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; }
    catch { return null; }
  }
  // User content is always text. Only validated HTTP(S) URLs become DOM links.
  function renderBody(node, value) {
    node.replaceChildren();
    const input = String(value || '');
    const pattern = /\[([^\]\n]+)\]\((https?:\/\/[^\s<>]+)\)|(https?:\/\/[^\s<>]+)/g;
    let cursor = 0;
    for (const match of input.matchAll(pattern)) {
      node.appendChild(document.createTextNode(input.slice(cursor, match.index)));
      let url = match[2] || match[3], suffix = '';
      if (match[3]) {
        const trim = url.match(/[。，、；！？」』）,.!?;]+$/);
        if (trim) { suffix = trim[0]; url = url.slice(0, -suffix.length); }
      }
      const href = safeUrl(url);
      if (href) {
        const link = text('a', match[1] || url); link.href = href;
        link.target = '_blank'; link.rel = 'noopener noreferrer'; node.appendChild(link);
        if (suffix) node.appendChild(document.createTextNode(suffix));
      } else node.appendChild(document.createTextNode(match[0]));
      cursor = match.index + match[0].length;
    }
    node.appendChild(document.createTextNode(input.slice(cursor)));
  }
  function action(label, handler, classes = '') {
    const button = text('button', label, 'in-action ' + classes); button.type = 'button';
    button.addEventListener('click', handler); return button;
  }
  function meta(notice) {
    const row = text('div', '', 'in-meta');
    row.appendChild(text('span', notice.category, 'in-category'));
    if(notice.published_at||notice.created_at)row.appendChild(text('time', date(notice.published_at||notice.created_at)));
    if (notice.is_pinned) row.appendChild(text('span', '置頂'));
    if (!notice.is_published) row.appendChild(text('span', '草稿'));
    return row;
  }
  function noticeRow(notice) {
    const button = text('button', '', 'in-row' + (unread(notice) ? ' in-row-unread' : ''));
    button.type = 'button'; button.setAttribute('aria-label', (unread(notice) ? '未讀：' : '') + notice.title);
    if (unread(notice)) button.appendChild(text('span', '', 'in-dot'));
    const main = text('div', '', 'in-row-main');
    main.append(meta(notice), text('div', notice.title, 'in-row-title'), text('div', notice.body, 'in-excerpt'));
    button.append(main, text('span', '›', 'in-arrow'));
    button.addEventListener('click', () => openNotice(notice.id)); return button;
  }
  function listInto(node, rows, emptyMessage) {
    node.replaceChildren();
    rows.forEach(notice => node.appendChild(noticeRow(notice)));
    if (!rows.length) node.appendChild(text('div', emptyMessage, 'in-empty'));
  }
  function render() {
    const rows = published(), count = rows.filter(unread).length;
    const dialog=document.getElementById('internal-notice-dialog');
    if(dialog?.open&&!rows.some(row=>row.id===dialog.dataset.noticeId))dialog.close();
    all('[data-internal-unread]').forEach(node => {
      node.textContent = count > 99 ? '99+' : String(count); node.hidden = count === 0;
      node.setAttribute('aria-label', count + ' 則未讀公告');
    });
    all('[data-in-count]').forEach(node => { node.textContent = count ? count + ' 則未讀公告' : '所有公告皆已閱讀'; });
    all('[data-in-list]').forEach(node => listInto(node, rows.filter(notice =>
      (state.filter !== 'unread' || unread(notice)) && (notice.title + '\n' + notice.body).toLocaleLowerCase().includes(state.search)
    ), state.search ? '找不到符合的公告' : state.filter === 'unread' ? '目前沒有未讀公告' : '目前沒有公告'));
    all('[data-in-preview-list]').forEach(node => listInto(node, rows.slice(0, 3), '目前沒有公告'));
    all('[data-in-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.inFilter === state.filter)));
    renderManagement();
  }
  async function pages(factory) {
    const rows = [];
    for (let offset = 0; ; offset += 200) {
      const batch = checked(await factory().range(offset, offset + 199)) || [];
      rows.push(...batch); if (batch.length < 200) return rows;
    }
  }
  async function refresh() {
    if (!state.client || !state.userId) return;
    if (state.loading) return state.loading;
    const userId = state.userId, client = state.client, epoch = state.epoch;
    state.loading = (async () => {
      try {
        const [notices, reads] = await Promise.all([
          pages(() => client.from('internal_notices').select('*').order('is_pinned', { ascending: false }).order('published_at', { ascending: false, nullsFirst: false }).order('id')),
          pages(() => client.from('internal_notice_reads').select('notice_id,notice_revision').eq('user_id', userId).order('notice_id')),
        ]);
        if (state.epoch !== epoch) return;
        state.notices = notices; state.reads = new Map(reads.map(row => [row.notice_id, row.notice_revision]));
        status(); render();
      } catch (error) { console.warn('Internal notices load failed:',error);status('公告暫時無法載入，請稍後重試。'); }
    })().finally(() => { if (state.epoch === epoch) state.loading = null; });
    return state.loading;
  }
  async function openNotice(id) {
    const notice = published().find(row => row.id === id); if (!notice) return;
    const epoch = state.epoch, userId = state.userId;
    const dialog = document.getElementById('internal-notice-dialog');
    dialog.dataset.noticeId=notice.id;
    dialog.querySelector('[data-in-article-meta]').replaceChildren(meta(notice));
    dialog.querySelector('h2').textContent = notice.title;
    renderBody(dialog.querySelector('[data-in-article-body]'), notice.body);
    dialog.querySelector('[data-in-read-status]').textContent = unread(notice) ? '正在記錄已讀…' : '已閱讀';
    if (!dialog.open) dialog.showModal();
    if (!unread(notice)) return;
    try {
      checked(await state.client.from('internal_notice_reads').upsert({
        notice_id: notice.id, user_id: userId, notice_revision: notice.revision, read_at: new Date().toISOString(),
      }, { onConflict: 'notice_id,user_id' }));
      if(state.epoch!==epoch)return;
      state.reads.set(notice.id, notice.revision); render();
      if (dialog.dataset.noticeId === notice.id) dialog.querySelector('[data-in-read-status]').textContent = '已閱讀';
    } catch (error) { if(state.epoch===epoch&&dialog.dataset.noticeId===notice.id)dialog.querySelector('[data-in-read-status]').textContent = '已讀紀錄儲存失敗，請關閉後重試'; }
  }
  function mountFeeds() {
    all('[data-internal-feed]').forEach(host => {
      host.className = 'in-root';
      host.innerHTML = '<div class="in-head"><div><h2>公告提醒</h2><div class="in-sub" data-in-count></div></div><div class="in-tools"><div class="in-filter"><button type="button" data-in-filter="all">全部</button><button type="button" data-in-filter="unread">未讀</button></div><input class="in-input in-search" type="search" placeholder="搜尋公告" aria-label="搜尋公告"><button class="in-action in-icon" type="button" title="重新整理" aria-label="重新整理">↻</button></div></div><div class="in-status" data-in-status role="status"></div><div data-in-list></div>';
      host.querySelectorAll('[data-in-filter]').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.inFilter; render(); }));
      host.querySelector('input').addEventListener('input', event => { state.search = event.target.value.trim().toLocaleLowerCase(); render(); });
      host.querySelector('.in-icon').addEventListener('click', refresh);
    });
    all('[data-internal-preview]').forEach(host => {
      host.className = 'in-root in-preview';
      host.innerHTML = '<div class="in-head"><div><h2>公告提醒</h2><div class="in-sub" data-in-count></div></div></div><div class="in-status" data-in-status role="status"></div><div data-in-preview-list></div>';
      host.querySelector('.in-head').appendChild(action('查看全部', () => state.openFeed()));
    });
    if (!document.getElementById('internal-notice-dialog')) {
      const dialog = document.createElement('dialog'); dialog.id = 'internal-notice-dialog'; dialog.className = 'in-dialog in-root';
      dialog.innerHTML = '<div class="in-dialog-top"><span class="in-sub" data-in-read-status role="status"></span><button type="button" class="in-action in-icon" aria-label="關閉公告" title="關閉">×</button></div><article class="in-article"><div data-in-article-meta></div><h2></h2><div class="in-body" data-in-article-body></div></article>';
      dialog.querySelector('button').addEventListener('click', () => dialog.close());
      dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
      document.body.appendChild(dialog);
    }
  }
  function editor() { return document.querySelector('[data-in-editor]'); }
  function resetEditor() {
    const form = editor(); if (!form) return;
    form.reset(); state.editing = null; form.querySelector('h3').textContent = '新增內部公告'; previewEditor();
  }
  function previewEditor() { const form = editor(); renderBody(form.querySelector('[data-in-draft-preview]'), form.elements.body.value); }
  function insertText(value) {
    const area = editor().elements.body;
    area.setRangeText(value, area.selectionStart, area.selectionEnd, 'end'); area.focus(); previewEditor();
  }
  function mountManagement() {
    all('[data-internal-manage]').forEach(host => {
      host.className = 'in-root'; host.hidden = !state.canManage; if (!state.canManage) return;
      host.innerHTML = '<div class="in-head"><div><h2>內部公告管理</h2><div class="in-sub">真珠門市佈告欄</div></div></div><div class="in-status" data-in-status role="status"></div><div class="in-manage-layout"><form data-in-editor class="in-editor"><h3>新增內部公告</h3><div class="in-field-wrap"><label class="in-field" for="in-title">公告標題</label><input id="in-title" name="title" class="in-input" required maxlength="160"></div><div class="in-field-wrap"><label class="in-field" for="in-category">公告分類</label><select id="in-category" name="category" class="in-input"><option>營運通知</option><option>活動消息</option><option>教育訓練</option><option>系統更新</option></select></div><label class="in-field" for="in-body">公告內容</label><div class="in-toolbar"><button type="button" class="in-action in-icon" data-in-emoji title="表情符號" aria-label="插入表情符號" aria-expanded="false">😀</button><button type="button" class="in-action in-icon" data-in-link title="插入超連結" aria-label="插入超連結" aria-expanded="false">🔗</button></div><div class="in-palette" data-in-palette hidden></div><div class="in-link-fields" data-in-link-fields hidden><label class="in-field">連結文字<input name="linkLabel" class="in-input"></label><label class="in-field">連結網址<input name="linkUrl" type="url" class="in-input" placeholder="https://"></label><button type="button" class="in-action" data-in-insert-link>插入連結</button></div><textarea id="in-body" name="body" class="in-input" required maxlength="20000" rows="10"></textarea><div class="in-checks"><label><input name="pinned" type="checkbox">置頂公告</label><label><input name="published" type="checkbox">立即發布</label></div><div class="in-tools"><button type="submit" class="in-action in-primary">儲存公告</button><button type="button" class="in-action" data-in-reset>新增另一則</button></div><div class="in-preview-body"><label class="in-field">內容預覽</label><div class="in-body" data-in-draft-preview></div></div></form><div class="in-manage-list" data-in-manage-list></div></div>';
      const form = host.querySelector('form');
      form.addEventListener('submit', saveNotice); form.elements.body.addEventListener('input', previewEditor);
      host.querySelector('[data-in-reset]').addEventListener('click', resetEditor);
      ['emoji', 'link'].forEach(kind => host.querySelector('[data-in-' + kind + ']').addEventListener('click', event => {
        const panel = host.querySelector(kind === 'emoji' ? '[data-in-palette]' : '[data-in-link-fields]');
        panel.hidden = !panel.hidden; event.currentTarget.setAttribute('aria-expanded', String(!panel.hidden));
      }));
      ['📣', '🔔', '📌', '✨', '🎉', '🧧', '🍽️', '❤️', '✅', '⚠️', '📅', '🙏'].forEach(emoji => {
        const button = action(emoji, () => insertText(emoji), 'in-icon'); button.title = '插入 ' + emoji;
        host.querySelector('[data-in-palette]').appendChild(button);
      });
      host.querySelector('[data-in-insert-link]').addEventListener('click', () => {
        const href = safeUrl(form.elements.linkUrl.value.trim());
        if (!href) { status('請輸入 http:// 或 https:// 開頭的有效網址'); return; }
        const label = form.elements.linkLabel.value.trim();
        if (/[\]\n]/.test(label)) { status('連結文字不可包含換行或 ]'); return; }
        insertText(label ? '[' + label + '](' + href + ')' : href); host.querySelector('[data-in-link-fields]').hidden = true;
        host.querySelector('[data-in-link]').setAttribute('aria-expanded', 'false'); status();
      });
    });
  }
  function editNotice(notice) {
    const form = editor(); if (!form) return;
    state.editing = { id: notice.id, revision: notice.revision };
    form.querySelector('h3').textContent = '編輯內部公告';
    form.elements.title.value = notice.title; form.elements.body.value = notice.body;
    form.elements.category.value = notice.category; form.elements.pinned.checked = notice.is_pinned;
    form.elements.published.checked = notice.is_published; previewEditor(); form.elements.title.focus();
  }
  async function saveNotice(event) {
    event.preventDefault(); if (!state.canManage) return;
    const form = editor(), button = form.querySelector('[type=submit]'); if (button.disabled) return;
    const payload = { title: form.elements.title.value.trim(), body: form.elements.body.value.trim(), category: form.elements.category.value, is_pinned: form.elements.pinned.checked, is_published: form.elements.published.checked };
    if (!payload.title || !payload.body) { status('請填寫公告標題與內容'); return; }
    button.disabled = true;
    try {
      const edit = state.editing;
      const result = edit ? await state.client.from('internal_notices').update(payload).eq('id', edit.id).eq('revision', edit.revision).select('id')
        : await state.client.from('internal_notices').insert(payload).select('id');
      const saved = checked(result); if (!saved?.length) throw new Error('公告已由其他人更新，請重新載入後再編輯');
      resetEditor(); await refresh(); status(payload.is_published ? '公告已發布' : '草稿已儲存',true);
    } catch (error) { status('儲存失敗：' + error.message); }
    finally { button.disabled = false; }
  }
  async function changeNotice(notice, remove = false) {
    if (!state.canManage) return;
    if (remove && !window.confirm('確定刪除「' + notice.title + '」？')) return;
    try {
      const q = remove ? state.client.from('internal_notices').delete() : state.client.from('internal_notices').update({ is_published: !notice.is_published });
      const rows = checked(await q.eq('id', notice.id).eq('revision', notice.revision).select('id'));
      if (!rows?.length) throw new Error('公告已變更，請重新整理');
      if (remove && state.editing?.id === notice.id) resetEditor();
      await refresh();
    } catch (error) { status('更新失敗：' + error.message); }
  }
  function renderManagement() {
    all('[data-in-manage-list]').forEach(host => {
      host.replaceChildren();
      if (!state.notices.length) host.appendChild(text('div', '尚未建立內部公告', 'in-empty'));
      state.notices.forEach(notice => {
        const row = text('div', '', 'in-manage-row'); row.append(meta(notice), text('h3', notice.title));
        const tools = text('div', '', 'in-tools');
        tools.append(action('編輯', () => editNotice(notice)), action(notice.is_published ? '撤下' : '發布', () => changeNotice(notice)), action('刪除', () => changeNotice(notice, true), 'in-danger'));
        row.appendChild(tools); host.appendChild(row);
      });
    });
  }
  function init(options) {
    clearInterval(state.timer);
    state.epoch++;
    Object.assign(state, options, { notices: [], reads: new Map(), editing: null, filter: 'all', search: '', loading:null });
    document.getElementById('internal-notice-dialog')?.close();
    mountFeeds(); mountManagement(); render(); refresh();
    state.timer = setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.InternalNotices = { init, refresh };
})();

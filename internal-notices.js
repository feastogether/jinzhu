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
      host.querySelector('.in-head').classList.add('in-feed-head');
      const feedback=action('偶要反饋',()=>window.StoreFeedback.open(),'in-primary in-feedback-action');
      host.querySelector('.in-head').insertBefore(feedback,host.querySelector('.in-tools'));
      host.querySelectorAll('[data-in-filter]').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.inFilter; render(); }));
      host.querySelector('input').addEventListener('input', event => { state.search = event.target.value.trim().toLocaleLowerCase(); render(); });
      host.querySelector('.in-icon').addEventListener('click', refresh);
    });
    all('[data-internal-preview]').forEach(host => {
      host.className = 'in-root in-preview';
      host.innerHTML = '<div class="in-head"><div><h2>公告提醒</h2><div class="in-sub" data-in-count></div></div></div><div class="in-status" data-in-status role="status"></div><div data-in-preview-list></div>';
      host.querySelector('.in-head').appendChild(action('查看全部', () => state.openFeed()));
      host.querySelector('.in-head').appendChild(action('偶要反饋',()=>window.StoreFeedback.open(),'in-primary in-feedback-action'));
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
    window.StoreFeedback?.init(options);
    state.timer = setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.InternalNotices = { init, refresh };
})();

(function () {
  'use strict';
  const s={client:null,userId:null,storeId:null,canManage:false,rows:[],selected:null,epoch:0,threadVersion:0,timer:null,loading:null};
  const labels={open:'待處理',in_progress:'處理中',resolved:'已完成'};
  const el=(tag,value='',cls='')=>{const node=document.createElement(tag);node.textContent=value;if(cls)node.className=cls;return node;};
  const check=result=>{if(result.error)throw new Error(result.error.message);return result.data;};
  const time=value=>new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  function button(label,handler,cls=''){const node=el('button',label,'in-action '+cls);node.type='button';node.onclick=handler;return node;}
  function httpUrl(value){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:null;}catch{return null;}}
  function bodyInto(node,value){
    node.replaceChildren();let cursor=0;const input=String(value||'');
    for(const match of input.matchAll(/https?:\/\/[^\s<>]+/g)){
      node.appendChild(document.createTextNode(input.slice(cursor,match.index)));
      const href=httpUrl(match[0]);
      if(href){const a=el('a',match[0]);a.href=href;a.target='_blank';a.rel='noopener noreferrer';node.appendChild(a);}
      else node.appendChild(document.createTextNode(match[0]));
      cursor=match.index+match[0].length;
    }
    node.appendChild(document.createTextNode(input.slice(cursor)));
  }
  function root(){return s.canManage?document.querySelector('[data-feedback-inbox]'):document.getElementById('store-feedback-dialog');}
  function message(value='',success=false){const node=root()?.querySelector('[data-fb-status]');if(node){node.textContent=value;node.classList.toggle('in-success',success);}}
  async function pages(factory){const rows=[];for(let i=0;;i+=200){const part=check(await factory().range(i,i+199))||[];rows.push(...part);if(part.length<200)return rows;}}
  function badge(row){return el('span',labels[row.status]||row.status,'fb-state fb-state-'+row.status);}
  async function refresh(){
    if(!s.client||!s.userId)return;
    if(s.loading)return s.loading;
    const epoch=s.epoch,client=s.client,storeId=s.storeId,canManage=s.canManage;
    s.loading=(async()=>{
      try{
        if(!canManage&&!storeId)return;
        const rows=await pages(()=>{
          let q=client.from('store_feedback').select('*,stores(name)').order('last_message_at',{ascending:false}).order('id');
          return canManage?q:q.eq('store_id',storeId);
        });
        if(epoch!==s.epoch)return;
        const old=s.rows.find(row=>row.id===s.selected),latest=rows.find(row=>row.id===s.selected);
        s.rows=rows;renderLists();
        if(old&&latest&&old.last_message_at!==latest.last_message_at&&!root()?.querySelector('[data-fb-detail] textarea')?.value.trim())loadThread(latest.id);
      }catch(error){console.warn('Store feedback load:',error);message('回饋暫時無法載入，請稍後重新整理。');}
    })().finally(()=>{if(s.epoch===epoch)s.loading=null;});
    return s.loading;
  }
  function listRow(row){
    const node=el('button','','fb-case'+(s.selected===row.id?' fb-case-selected':''));node.type='button';
    const top=el('div','','in-meta');top.append(el('span',row.category,'in-category'),badge(row));
    node.append(top,el('div',row.title,'fb-case-title'));
    const sub=el('div','','fb-case-meta');sub.append(el('span',row.stores?.name||'門市'),el('time',time(row.last_message_at)));
    node.appendChild(sub);node.onclick=()=>loadThread(row.id);return node;
  }
  function renderLists(){
    const host=root();if(!host)return;
    const count=s.rows.filter(row=>row.status!=='resolved').length;
    document.querySelectorAll('[data-feedback-pending]').forEach(node=>{node.textContent=count>99?'99+':String(count);node.hidden=count===0;node.setAttribute('aria-label',count+' 則待處理回饋');});
    const summary=host.querySelector('[data-fb-count]');if(summary)summary.textContent=s.canManage?count+' 則待處理 · '+s.rows.length+' 則回饋':s.rows.length+' 則門市回饋';
    const list=host.querySelector('[data-fb-list]');if(!list)return;
    const status=host.querySelector('[data-fb-filter-status]')?.value||'all';
    const category=host.querySelector('[data-fb-filter-category]')?.value||'all';
    const keyword=(host.querySelector('[data-fb-search]')?.value||'').trim().toLocaleLowerCase();
    const rows=s.rows.filter(row=>(status==='all'||row.status===status)&&(category==='all'||row.category===category)&&[row.title,row.body,row.stores?.name].join(' ').toLocaleLowerCase().includes(keyword));
    list.replaceChildren();rows.forEach(row=>list.appendChild(listRow(row)));
    if(!rows.length)list.appendChild(el('div',s.rows.length?'沒有符合的回饋':'目前還沒有回饋','in-empty'));
    if(s.selected&&!s.rows.some(row=>row.id===s.selected)){s.selected=null;host.querySelector('[data-fb-detail]').replaceChildren(el('div','選擇一則回饋查看內容','in-empty'));}
  }
  const filterMarkup='<div class="fb-filters"><input class="in-input" type="search" data-fb-search placeholder="搜尋主旨、門市" aria-label="搜尋回饋"><select class="in-input" data-fb-filter-status aria-label="處理狀態"><option value="all">全部狀態</option><option value="open">待處理</option><option value="in_progress">處理中</option><option value="resolved">已完成</option></select><select class="in-input" data-fb-filter-category aria-label="回饋分類"><option value="all">全部分類</option><option>系統問題</option><option>菜單問題</option><option>許願池</option><option>其他意見</option></select></div>';
  const inboxMarkup='<div class="fb-workspace"><div class="fb-case-list" data-fb-list></div><div class="fb-detail" data-fb-detail><div class="in-empty">選擇一則回饋查看內容</div></div></div>';
  function wireFilters(host){
    host.querySelectorAll('[data-fb-filter-status],[data-fb-filter-category]').forEach(node=>node.onchange=renderLists);
    host.querySelector('[data-fb-search]').oninput=renderLists;
  }
  function mountAdmin(){
    const host=root();if(!host)return;host.classList.add('in-root','fb-root');
    host.innerHTML='<div class="in-head"><div><h2>門市回饋</h2><div class="in-sub" data-fb-count></div></div></div><div class="in-status" data-fb-status role="status"></div>'+filterMarkup+inboxMarkup;
    host.querySelector('.in-head').appendChild(button('↻',refresh,'in-icon'));
    host.querySelector('.in-icon').title='重新整理';host.querySelector('.in-icon').setAttribute('aria-label','重新整理回饋');
    wireFilters(host);
  }
  function mountStore(){
    document.getElementById('store-feedback-dialog')?.remove();
    const dialog=document.createElement('dialog');dialog.id='store-feedback-dialog';dialog.className='in-dialog in-root fb-dialog fb-root';
    dialog.innerHTML='<div class="in-dialog-top"><div><h2 class="fb-heading">偶要反饋</h2><div class="in-sub">把問題說清楚，把好點子留下來。</div></div><button class="in-action in-icon" type="button" aria-label="關閉反饋" title="關閉">×</button></div><div class="fb-dialog-content"><div class="fb-tabs in-filter"><button type="button" data-fb-tab="compose" aria-pressed="true">新增反饋</button><button type="button" data-fb-tab="history" aria-pressed="false">門市紀錄與回覆</button></div><div class="in-status" data-fb-status role="status"></div><form data-fb-compose class="fb-compose"><div class="fb-compose-top"><label class="in-field" for="fb-category">回饋分類<select class="in-input" id="fb-category" name="category"><option>系統問題</option><option>菜單問題</option><option>許願池</option><option>其他意見</option></select></label><label class="in-field" for="fb-title">主旨<input class="in-input" id="fb-title" name="title" required maxlength="120" placeholder="這次想告訴我們什麼？"></label></div><label class="in-field" for="fb-body">內容<textarea id="fb-body" name="body" class="in-input" required maxlength="5000" rows="6" placeholder="遇到的情況、操作步驟，或你期待的改善…"></textarea></label><label class="in-field" for="fb-url">相關頁面網址（選填）<input type="url" name="pageUrl" id="fb-url" class="in-input" maxlength="1000" placeholder="https://"></label><div class="fb-compose-footer"><span class="fb-note">回饋與回覆會保留在本門市紀錄中</span><button type="submit" class="in-action in-primary">送出反饋</button></div></form><section data-fb-history hidden>'+filterMarkup+inboxMarkup+'</section></div>';
    document.body.appendChild(dialog);dialog.querySelector('.in-dialog-top button').onclick=()=>dialog.close();
    dialog.querySelectorAll('[data-fb-tab]').forEach(node=>node.onclick=()=>storeTab(node.dataset.fbTab));
    dialog.querySelector('form').onsubmit=submitFeedback;wireFilters(dialog);
  }
  function storeTab(tab){
    const host=root();if(!host||s.canManage)return;
    host.querySelector('[data-fb-compose]').hidden=tab!=='compose';host.querySelector('[data-fb-history]').hidden=tab!=='history';
    host.querySelectorAll('[data-fb-tab]').forEach(node=>node.setAttribute('aria-pressed',String(node.dataset.fbTab===tab)));
    if(tab==='history')refresh();
  }
  function open(){
    if(!s.client)return;
    if(s.canManage){s.openFeedback?.();refresh();return;}
    const dialog=root();if(!dialog.open)dialog.showModal();
    if(!s.storeId)message('尚未確認門市，請重新登入後再試。');else message();
    refresh();
  }
  async function submitFeedback(event){
    event.preventDefault();const form=event.currentTarget,submit=form.querySelector('[type=submit]');if(submit.disabled)return;
    if(!s.storeId){message('尚未確認門市，請重新登入後再試。');return;}
    const title=form.elements.title.value.trim(),body=form.elements.body.value.trim(),rawUrl=form.elements.pageUrl.value.trim();
    if(!title||!body){message('請填寫主旨與內容');return;}
    if(rawUrl&&!httpUrl(rawUrl)){message('相關網址必須以 http:// 或 https:// 開頭');return;}
    const epoch=s.epoch;submit.disabled=true;
    try{
      const id=check(await s.client.rpc('submit_store_feedback',{p_store_id:s.storeId,p_category:form.elements.category.value,p_title:title,p_body:body,p_page_url:rawUrl?httpUrl(rawUrl):null}));
      if(epoch!==s.epoch)return;
      form.reset();storeTab('history');await refresh();await loadThread(id);message('反饋已送出，謝謝你的建議。',true);
    }catch(error){message('送出失敗：'+error.message);}finally{submit.disabled=false;}
  }
  async function loadThread(id){
    const row=s.rows.find(item=>item.id===id);if(!row)return;
    s.selected=id;const version=++s.threadVersion,epoch=s.epoch,host=root(),panel=host.querySelector('[data-fb-detail]');
    renderLists();panel.replaceChildren(el('div','正在讀取回覆…','in-empty'));host.classList.add('fb-show-detail');
    try{
      const messages=await pages(()=>s.client.from('store_feedback_messages').select('*').eq('feedback_id',id).order('created_at').order('id'));
      if(epoch!==s.epoch||version!==s.threadVersion)return;
      panel.replaceChildren();
      const top=el('div','','fb-detail-top');
      top.append(button('← 返回紀錄',()=>{host.classList.remove('fb-show-detail');s.selected=null;++s.threadVersion;renderLists();},'fb-back'),badge(row));
      const reload=button('↻',()=>loadThread(id),'in-icon');reload.title='重新整理回覆';reload.setAttribute('aria-label','重新整理回覆');top.appendChild(reload);
      panel.append(top,el('div',row.category,'fb-detail-category'),el('h3',row.title,'fb-detail-title'));
      panel.appendChild(el('div',(row.stores?.name||'門市')+' · '+row.submitted_by+' · '+time(row.created_at),'fb-case-meta'));
      const original=el('div','','in-body fb-original');bodyInto(original,row.body);panel.appendChild(original);
      if(row.page_url&&httpUrl(row.page_url)){const link=el('a','開啟相關頁面','fb-page-link');link.href=httpUrl(row.page_url);link.target='_blank';link.rel='noopener noreferrer';panel.appendChild(link);}
      const thread=el('div','','fb-messages');
      messages.forEach(item=>{
        const bubble=el('article','','fb-message'+(item.is_admin?' fb-message-admin':''));
        bubble.appendChild(el('div',(item.is_admin?'總管理回覆':'門市追加')+' · '+time(item.created_at),'fb-message-author'));
        const content=el('div','','in-body');bodyInto(content,item.body);bubble.appendChild(content);thread.appendChild(bubble);
      });
      if(!messages.length)thread.appendChild(el('div','已收到回饋，等待總管理員回覆。','fb-waiting'));
      panel.appendChild(thread);
      const reply=document.createElement('form');reply.className='fb-reply';
      const label=el('label',s.canManage?'回覆門市':'追加說明','in-field');
      const area=document.createElement('textarea');area.name='reply';area.className='in-input';area.rows=3;area.required=true;area.maxLength=5000;area.placeholder=s.canManage?'回覆處理進度或解決方式…':'補充操作細節或回覆管理員…';label.appendChild(area);reply.appendChild(label);
      const footer=el('div','','fb-reply-footer');
      if(s.canManage){const statusLabel=el('label','處理狀態','in-field');const select=document.createElement('select');select.name='status';select.className='in-input';Object.entries(labels).forEach(([key,value])=>select.appendChild(new Option(value,key)));select.value=row.status==='open'?'in_progress':row.status;statusLabel.appendChild(select);footer.appendChild(statusLabel);}
      const send=el('button',s.canManage?'送出回覆':'送出追加','in-action in-primary');send.type='submit';footer.appendChild(send);reply.appendChild(footer);
      reply.onsubmit=async event=>{
        event.preventDefault();if(send.disabled)return;const value=area.value.trim();if(!value)return;
        send.disabled=true;
        try{
          check(await s.client.rpc('reply_store_feedback',{p_feedback_id:id,p_body:value,p_status:s.canManage?reply.elements.status.value:null}));
          if(epoch!==s.epoch)return;
          await refresh();if(s.selected===id)await loadThread(id);message('回覆已送出',true);
        }catch(error){message('回覆失敗：'+error.message);send.disabled=false;}
      };
      panel.appendChild(reply);
    }catch(error){if(epoch===s.epoch&&version===s.threadVersion){panel.replaceChildren(el('div','回覆暫時無法讀取','in-empty'));panel.appendChild(button('重新載入',()=>loadThread(id)));}}
  }
  function init(options){
    clearInterval(s.timer);s.epoch++;s.threadVersion++;
    Object.assign(s,options,{rows:[],selected:null,loading:null});
    document.getElementById('store-feedback-dialog')?.close();
    const adminHost=document.querySelector('[data-feedback-inbox]');if(adminHost){adminHost.hidden=!s.canManage;if(!s.canManage)adminHost.replaceChildren();}
    if(s.canManage)mountAdmin();else mountStore();
    refresh();s.timer=setInterval(()=>{if(!document.hidden)refresh();},60000);
  }
  window.StoreFeedback={init,open,refresh};
})();

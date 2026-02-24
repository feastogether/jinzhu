// ============================================================
//  admin-main.js  — 核心功能：訂單、活動、分類、口味、設定
// ============================================================

const SUPABASE_URL = 'https://pydlnqriztpzgxbjuohm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ISKUWOXUR9A-1y81xCOUXg_8-zNle3v';
const _s = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 全域共用狀態
let allMenuItems  = [];
let allCategories = [];
let allCampaigns  = [];
let curEditOrder  = null;
let editCart      = [];

// ──────────────────────────────────────────────
//  Tab 切換
// ──────────────────────────────────────────────
async function switchTab(t) {
    document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'));
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('sidebar-btn-active'));
    document.getElementById(`sec-${t}`).classList.remove('hidden');
    document.getElementById(`btn-${t}`).classList.add('sidebar-btn-active');

    if (t === 'orders')     { await loadCampaignOptions(); loadOrders(); }
    if (t === 'campaigns')  loadCampaigns();
    if (t === 'categories') loadCats();
    if (t === 'menu')       { await loadCats(); loadMenu(); }
    if (t === 'flavors')    loadFlvs();
    if (t === 'settings')   loadSettings();
}

// ──────────────────────────────────────────────
//  1. 訂單監控
// ──────────────────────────────────────────────
function setQuickDate(val) {
    document.getElementById('custom-date-box').classList.toggle('hidden', val !== 'custom');
}

async function loadCampaignOptions() {
    const { data } = await _s.from('campaign_settings').select('*');
    allCampaigns = data || [];
    document.getElementById('filter-campaign').innerHTML =
        '<option value="all">全部活動</option>' +
        allCampaigns.map(c => `<option value="${c.code_name}">${c.code_name}</option>`).join('');
}

async function loadOrders() {
    const search   = document.getElementById('filter-search').value;
    const status   = document.getElementById('filter-status').value;
    const preset   = document.getElementById('filter-date-preset').value;
    const campaign = document.getElementById('filter-campaign').value;

    let query = _s.from('orders').select('*').order('created_at', { ascending: false });
    if (search)            query = query.or(`customer_name.ilike.%${search}%,phone.ilike.%${search}%`);
    if (status !== 'all')  query = query.eq('status', status);
    if (campaign !== 'all') query = query.eq('campaign_code', campaign);
    if (preset === 'today') {
        const d = new Date().toISOString().split('T')[0];
        query = query.gte('created_at', `${d}T00:00:00`).lte('created_at', `${d}T23:59:59`);
    } else if (preset === 'week') {
        const lastWeek = new Date(new Date().setDate(new Date().getDate() - 7)).toISOString();
        query = query.gte('created_at', lastWeek);
    } else if (preset === 'custom') {
        const d = document.getElementById('filter-date').value;
        if (d) query = query.gte('created_at', `${d}T00:00:00`).lte('created_at', `${d}T23:59:59`);
    }

    const { data } = await query;
    window.ordersRef = data || [];

    document.getElementById('order-list').innerHTML = (data || []).map(o => {
        let bTime = '';
        if (o.booking_date) {
            const d   = new Date(o.booking_date);
            const Y   = d.getFullYear();
            const M   = String(d.getMonth() + 1).padStart(2, '0');
            const D   = String(d.getDate()).padStart(2, '0');
            const H   = String(d.getHours()).padStart(2, '0');
            const min = String(d.getMinutes()).padStart(2, '0');
            bTime = `${Y}-${M}-${D}T${H}:${min}`;
        }
        return `
        <div class="bg-white p-6 rounded-3xl shadow-sm border transition ${o.status === 'synced' ? 'order-card-completed' : 'border-emerald-200'}">
            <div class="flex justify-between font-bold text-xl mb-2">
                <span>${o.customer_name}</span><span class="text-p-gold">$${o.total_price}</span>
            </div>
            <div class="text-[10px] text-stone-400 mb-4 tracking-widest">
                下單於: ${new Date(o.created_at).toLocaleString()} | ${o.phone}
            </div>
            <div class="grid grid-cols-2 gap-2 mb-4 bg-stone-50 p-3 rounded-xl">
                <div class="col-span-2">
                    <label class="text-[9px] font-bold text-stone-400">訂位日期與時間 Booking Time</label>
                    <input type="datetime-local" value="${bTime}"
                        onchange="updateOrderData('${o.id}', 'booking_date', this.value)" class="input-mini">
                </div>
                <div>
                    <label class="text-[9px] font-bold text-stone-400">桌號 Table</label>
                    <input type="text" value="${o.table_no || ''}"
                        onchange="updateOrderData('${o.id}', 'table_no', this.value)" class="input-mini" placeholder="無">
                </div>
                <div>
                    <label class="text-[9px] font-bold text-stone-400">活動 Campaign</label>
                    <select onchange="updateOrderData('${o.id}', 'campaign_code', this.value)" class="input-mini">
                        <option value="">無</option>
                        ${allCampaigns.map(c => `<option value="${c.code_name}" ${o.campaign_code === c.code_name ? 'selected' : ''}>${c.code_name}</option>`).join('')}
                    </select>
                </div>
                <div class="col-span-2 flex gap-1 mt-1">
                    <input type="number" value="${o.adult_count || 0}"
                        onchange="updateOrderData('${o.id}','adult_count',this.value)" class="input-mini text-center" title="大人">
                    <input type="number" value="${o.kid_count || 0}"
                        onchange="updateOrderData('${o.id}','kid_count',this.value)" class="input-mini text-center" title="小孩">
                    <input type="number" value="${o.toddler_count || 0}"
                        onchange="updateOrderData('${o.id}','toddler_count',this.value)" class="input-mini text-center" title="幼兒">
                </div>
            </div>
            <div class="space-y-1 mb-6 text-sm text-stone-500 border-l-2 border-stone-200 pl-4">
                ${o.order_content.map(i => `• ${i.name}`).join('<br>')}
            </div>
            <div class="flex gap-2">
                <button onclick="openEditOrder('${o.id}')"
                    class="flex-1 bg-stone-100 py-3 rounded-xl font-bold text-xs shadow-sm">修改細項</button>
                <button onclick="toggleSync('${o.id}', '${o.status}')"
                    class="flex-[1.5] ${o.status === 'synced' ? 'bg-slate-400' : 'bg-emerald-600'} text-white py-3 rounded-xl text-xs font-bold shadow-md transition">
                    ${o.status === 'synced' ? '✓ 已完成' : '未完成 (點選點收)'}
                </button>
            </div>
            <button onclick="delOrder('${o.id}')"
                class="w-full mt-3 py-2 text-red-300 text-[10px] font-bold border border-red-50 rounded-lg hover:bg-red-50">
                永久刪除
            </button>
        </div>`;
    }).join('');
}

async function updateOrderData(id, field, val) {
    const obj = {};
    if (field === 'booking_date' && val) {
        obj[field] = new Date(val).toISOString();
    } else {
        obj[field] = val || null;
    }
    await _s.from('orders').update(obj).eq('id', id);
}

async function toggleSync(id, cur) {
    await _s.from('orders').update({ status: cur === 'synced' ? 'pending' : 'synced' }).eq('id', id);
    loadOrders();
}

async function delOrder(id) {
    if (confirm('確定刪除？')) {
        await _s.from('orders').delete().eq('id', id);
        loadOrders();
    }
}

function resetFilters() {
    document.getElementById('filter-search').value = '';
    document.getElementById('filter-date-preset').value = 'all';
    document.getElementById('filter-status').value = 'all';
    document.getElementById('filter-campaign').value = 'all';
    loadOrders();
}

function exportXls() {
    const exp = window.ordersRef.map(o => ({
        '姓名': o.customer_name, '電話': o.phone, '總額': o.total_price,
        '桌號': o.table_no, '活動': o.campaign_code, '訂位時間': o.booking_date
    }));
    const ws = XLSX.utils.json_to_sheet(exp);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '報表');
    XLSX.writeFile(wb, '真珠訂單報表.xlsx');
}

// ──────────────────────────────────────────────
//  2. 修改訂單細項
// ──────────────────────────────────────────────
let curEditItem    = null;
let curEditPopSels = { flavors: {}, groups: {} };
let reEditIndex    = -1;

async function openEditOrder(id) {
    curEditOrder = window.ordersRef.find(o => o.id === id);
    editCart = JSON.parse(JSON.stringify(curEditOrder.order_content));
    document.getElementById('order-edit-modal').classList.remove('hidden');

    const { data: items } = await _s.from('menu_items').select(
        '*, categories(name), item_flavor_relation(flavor_groups(*, flavor_options(*))), set_menu_groups(*, set_menu_contents(menu_items(*, item_flavor_relation(flavor_groups(*, flavor_options(*))))))'
    ).eq('is_hidden', false);
    allMenuItems = items || [];

    const { data: cats } = await _s.from('categories').select('*').order('sort_order');
    allCategories = cats || [];

    document.getElementById('edit-cat-nav').innerHTML = (cats || []).map(c =>
        `<button onclick="renderEditMenu('${c.id}')"
            class="px-5 py-2 bg-white border border-stone-200 rounded-full text-xs font-bold mr-2 hover:border-p-green transition">
            ${c.name}
        </button>`
    ).join('');

    if (cats.length) renderEditMenu(cats[0].id);
    refreshEditCart();
}

function refreshEditCart() {
    document.getElementById('edit-cart-list').innerHTML = editCart.map((i, idx) =>
        `<div class="flex flex-col bg-stone-50 p-3 rounded-xl border mb-2 relative">
            <div onclick="openEditPop(null, ${idx})" class="cursor-pointer pr-8">
                <span class="font-bold text-xs text-p-green underline decoration-p-gold">${i.name}</span>
                <div class="text-[9px] text-stone-400 mt-1">$${i.price} (點選修改)</div>
            </div>
            <button onclick="editCart.splice(${idx},1);refreshEditCart();"
                class="absolute top-2 right-2 text-red-300 font-bold px-2">✕</button>
        </div>`
    ).join('');
    document.getElementById('edit-total-price').innerText =
        `$${editCart.reduce((sum, item) => sum + Number(item.price), 0)}`;
}

function openEditPop(itemId, index = -1) {
    reEditIndex = index;
    let prevNames = [], prevFlvs = [];

    if (index > -1) {
        const raw      = editCart[index].name;
        const baseName = raw.split(' [')[0].split(' (')[0];
        curEditItem    = allMenuItems.find(i => i.name === baseName);
        const gM = raw.match(/\((.*?)\)/); if (gM) prevNames = gM[1].split('、').map(n => n.split(' [')[0]);
        const fM = raw.match(/\[(.*?)\]/); if (fM) prevFlvs  = fM[1].split('/');
    } else {
        curEditItem = allMenuItems.find(i => i.id === itemId);
    }
    if (!curEditItem) return;

    curEditPopSels = { flavors: {}, groups: {} };
    const container = document.getElementById('edit-pop-content');
    container.innerHTML = '';

    // 口味選項
    if (curEditItem.item_flavor_relation?.length > 0) {
        container.innerHTML += curEditItem.item_flavor_relation.map(r => `
            <div>
                <p class="text-[10px] text-stone-400 mb-2 uppercase font-bold">${r.flavor_groups.name}</p>
                <div class="flex flex-wrap gap-2">
                    ${r.flavor_groups.flavor_options.map(o => {
                        const isM = prevFlvs.includes(o.option_name);
                        if (isM) curEditPopSels.flavors[r.flavor_groups.id] = o.option_name;
                        return `<div onclick="setEditPopFlv(this,'${r.flavor_groups.id}','${o.option_name}')"
                            class="px-4 py-1.5 border rounded-full text-xs cursor-pointer transition ${isM ? 'flavor-selected' : 'bg-stone-50'}">
                            ${o.option_name}
                        </div>`;
                    }).join('')}
                </div>
            </div>`).join('');
    }

    // 套餐分組
    if (curEditItem.is_set_menu && curEditItem.set_menu_groups) {
        container.innerHTML += curEditItem.set_menu_groups.map(g => {
            curEditPopSels.groups[g.id] = [];
            return `<div>
                <p class="text-[10px] text-p-green font-bold mb-2 uppercase">${g.group_name}</p>
                <div class="grid grid-cols-2 gap-2">
                    ${g.set_menu_contents.map(c => {
                        const isM = prevNames.includes(c.menu_items.name);
                        if (isM) curEditPopSels.groups[g.id].push({ name: c.menu_items.name });
                        return `<div onclick="setEditPopGroup(this,'${g.id}','${c.menu_items.name}',${g.selection_limit})"
                            class="p-3 border rounded-xl text-[11px] cursor-pointer text-center font-bold ${isM ? 'opt-selected' : 'bg-stone-50'}">
                            ${c.menu_items.name}
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }).join('');
    }

    document.getElementById('edit-pop-title').innerText = curEditItem.name;
    document.getElementById('edit-flavor-popup').classList.remove('hidden');
}

function setEditPopFlv(el, gid, name) {
    Array.from(el.parentElement.children).forEach(c => {
        c.classList.remove('flavor-selected');
        c.classList.add('bg-stone-50');
    });
    el.classList.add('flavor-selected');
    el.classList.remove('bg-stone-50');
    curEditPopSels.flavors[gid] = name;
}

function setEditPopGroup(el, gid, name, limit) {
    const sibs = Array.from(el.parentElement.children);
    if (limit === 1) {
        sibs.forEach(s => s.classList.remove('opt-selected'));
        el.classList.add('opt-selected');
        curEditPopSels.groups[gid] = [{ name }];
    } else {
        let s = curEditPopSels.groups[gid];
        if (s.some(x => x.name === name)) {
            s = s.filter(x => x.name !== name);
            el.classList.remove('opt-selected');
        } else if (s.length < limit) {
            s.push({ name });
            el.classList.add('opt-selected');
        }
        curEditPopSels.groups[gid] = s;
    }
}

function confirmEditPop() {
    const fn = Object.values(curEditPopSels.flavors).join('/');
    const gn = Object.values(curEditPopSels.groups).flat().map(x => x.name).join('、');
    const finalName = `${curEditItem.name}${fn ? ` [${fn}]` : ''}${gn ? ` (${gn})` : ''}`;

    if (reEditIndex > -1) {
        editCart[reEditIndex] = { name: finalName, price: Number(curEditItem.price) };
    } else {
        editCart.push({ name: finalName, price: Number(curEditItem.price) });
    }
    closeEditPop();
    refreshEditCart();
}

async function saveOrderChange() {
    const total = editCart.reduce((sum, item) => sum + Number(item.price), 0);
    await _s.from('orders').update({ order_content: editCart, total_price: total }).eq('id', curEditOrder.id);
    alert('更新成功');
    closeEditModal();
    loadOrders();
}

function renderEditMenu(cid) {
    document.getElementById('edit-menu-grid').innerHTML = allMenuItems
        .filter(i => i.category_id === cid)
        .map(i => `
        <div onclick="openEditPop('${i.id}')"
            class="bg-white p-3 rounded-xl border border-stone-100 cursor-pointer shadow-sm">
            <div class="font-bold text-xs line-clamp-2">${i.name}</div>
            <div class="text-p-gold font-bold text-xs mt-2">$${i.price}</div>
        </div>`).join('');
}

// ──────────────────────────────────────────────
//  3. 活動代號管理
// ──────────────────────────────────────────────
async function loadCampaigns() {
    const { data } = await _s.from('campaign_settings').select('*').order('created_at', { ascending: false });
    document.getElementById('campaign-list').innerHTML = (data || []).map(c =>
        `<div class="flex justify-between items-center p-3 bg-stone-50 rounded-xl border font-bold text-sm shadow-sm">
            <span class="text-p-green">${c.code_name}</span>
            <button onclick="delCampaign(${c.id})" class="text-red-400 px-2 font-bold">✕</button>
        </div>`
    ).join('');
}

async function addCampaign() {
    const n = document.getElementById('new-campaign').value.trim();
    if (n) await _s.from('campaign_settings').insert([{ code_name: n }]);
    document.getElementById('new-campaign').value = '';
    loadCampaigns();
}

async function delCampaign(id) {
    await _s.from('campaign_settings').delete().eq('id', id);
    loadCampaigns();
}

// ──────────────────────────────────────────────
//  4. 分類管理
// ──────────────────────────────────────────────
async function loadCats() {
    const { data } = await _s.from('categories').select('*').order('sort_order');
    allCategories = data || [];

    document.getElementById('cat-list-table').innerHTML = data.map(c =>
        `<tr class="border-b hover:bg-stone-50 transition text-sm text-left">
            <td class="p-4"><input type="number" value="${c.sort_order || 0}"
                onchange="updateCatSort('${c.id}',this.value)"
                class="w-12 border rounded text-xs p-1 text-center"></td>
            <td class="p-4 font-bold text-p-green">${c.name}</td>
            <td class="p-4"><input type="checkbox" ${c.is_visible ? 'checked' : ''}
                onchange="updateCatVis('${c.id}',this.checked)"></td>
            <td class="p-4"><button onclick="delCat('${c.id}')" class="text-red-400 font-bold">刪除</button></td>
        </tr>`
    ).join('');

    document.getElementById('m-cat').innerHTML =
        (data || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    document.getElementById('menu-cat-filter').innerHTML =
        '<option value="all">所有分類</option>' +
        (data || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

async function updateCatVis(id, b) {
    await _s.from('categories').update({ is_visible: b }).eq('id', id);
    loadCats();
}

async function updateCatSort(id, v) {
    await _s.from('categories').update({ sort_order: parseInt(v) }).eq('id', id);
    loadCats();
}

async function addCat() {
    const n = document.getElementById('new-cat').value.trim();
    if (n) await _s.from('categories').insert([{ name: n, sort_order: 99, is_visible: true }]);
    loadCats();
}

async function delCat(id) {
    await _s.from('categories').delete().eq('id', id);
    loadCats();
}

// ──────────────────────────────────────────────
//  5. 口味定義
// ──────────────────────────────────────────────
async function loadFlvs() {
    const { data } = await _s.from('flavor_groups').select('*, flavor_options(*)');
    document.getElementById('flv-grid').innerHTML = (data || []).map(g =>
        `<div class="bg-white p-5 rounded-2xl border flex justify-between shadow-sm">
            <b>🌶️ ${g.name}</b>
            <button onclick="delFlv('${g.id}')" class="text-red-400 font-bold px-2 text-xl font-serif">✕</button>
        </div>`
    ).join('');
}

async function addFlvGroup() {
    const n = prompt('組名');
    const o = prompt('選項 (逗號隔開)');
    if (n && o) {
        const { data: g } = await _s.from('flavor_groups').insert([{ name: n }]).select();
        if (g) await _s.from('flavor_options').insert(
            o.split(',').map(nm => ({ group_id: g[0].id, option_name: nm.trim() }))
        );
        loadFlvs();
    }
}

async function delFlv(id) {
    await _s.from('flavor_groups').delete().eq('id', id);
    loadFlvs();
}

// ──────────────────────────────────────────────
//  6. 系統設定 (Logo)
// ──────────────────────────────────────────────
async function loadSettings() {
    const { data } = await _s.from('store_settings').select('*').eq('id', 1).single();
    if (data?.logo_url) {
        document.getElementById('current-logo-preview').classList.remove('hidden');
        document.getElementById('admin-logo-img').src = `${data.logo_url}?t=${Date.now()}`;
    }
}

async function uploadLogo() {
    const f = document.getElementById('logo-file').files[0];
    if (!f) return alert('請選檔案');
    const ext  = f.name.split('.').pop().toLowerCase();
    const path = `logo_${Date.now()}.${ext}`;
    const type = ext === 'svg' ? 'image/svg+xml' : f.type;
    const { error } = await _s.storage.from('assets').upload(path, f, { contentType: type, cacheControl: '3600', upsert: true });
    if (!error) {
        const { data } = _s.storage.from('assets').getPublicUrl(path);
        await _s.from('store_settings').update({ logo_url: data.publicUrl }).eq('id', 1);
        alert('成功');
        loadSettings();
    }
}

// ──────────────────────────────────────────────
//  彈窗關閉
// ──────────────────────────────────────────────
function closeEditModal() { document.getElementById('order-edit-modal').classList.add('hidden'); }
function closeEditPop()   { document.getElementById('edit-flavor-popup').classList.add('hidden'); }

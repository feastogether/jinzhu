// ============================================================
//  admin-menu.js  — 菜單管理：餐點 CRUD、套餐分組
// ============================================================

let curItem               = null;   // 目前編輯的套餐 parent item id
let curPicks              = [];     // 套餐分組暫存品項
let pickerSelectedItems   = [];     // picker 勾選中的品項
let currentEditingGroupId = null;   // 套餐編輯模式：正在編輯的 group id

// ──────────────────────────────────────────────
//  1. 菜單列表
// ──────────────────────────────────────────────
async function loadMenu() {
    const search = document.getElementById('menu-search').value.toLowerCase();
    const catF   = document.getElementById('menu-cat-filter').value;
    const { data } = await _s.from('menu_items').select('*, categories(name)').order('created_at', { ascending: false });

    document.getElementById('menu-grid').innerHTML = (data || [])
        .filter(i => i.name.toLowerCase().includes(search) && (catF === 'all' || i.category_id === catF))
        .map(i => `
        <div class="bg-white rounded-3xl border p-4 shadow-sm flex flex-col h-full">
            <div class="h-32 bg-stone-50 rounded-2xl mb-3 flex items-center justify-center overflow-hidden">
                <img src="${i.image_url || ''}" class="max-h-full img-contain">
            </div>
            <div class="flex justify-between font-bold text-sm">
                <span>${i.name}</span><span class="text-p-gold">$${i.price}</span>
            </div>
            <div class="flex gap-2 mt-auto pt-4">
                <button onclick="editItem('${i.id}')"
                    class="flex-1 py-1.5 rounded-lg bg-stone-100 text-xs font-bold hover:bg-stone-200 shadow-sm">編輯</button>
                ${i.is_set_menu
                    ? `<button onclick="openSetModal('${i.id}')"
                        class="flex-1 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold shadow-sm">⚙️ 套餐</button>`
                    : ''}
                <button onclick="delItem('${i.id}')" class="px-2 text-red-200">✕</button>
            </div>
        </div>`).join('');
}

// ──────────────────────────────────────────────
//  2. 餐點新增 / 編輯 Modal
// ──────────────────────────────────────────────
async function openMenuModal(isEdit) {
    document.getElementById('menu-modal').classList.remove('hidden');
    if (!isEdit) {
        document.getElementById('m-id').value     = '';
        document.getElementById('m-name').value   = '';
        document.getElementById('m-price').value  = '';
        document.getElementById('m-desc').value   = '';
        document.getElementById('m-is-set').checked = false;
    }
    const { data: flvs } = await _s.from('flavor_groups').select('*');
    document.getElementById('flv-checks').innerHTML = (flvs || []).map(f =>
        `<label class="flex items-center gap-1 text-[11px]">
            <input type="checkbox" class="flv-chk accent-p-green" value="${f.id}"> ${f.name}
        </label>`
    ).join('');
}

async function editItem(id) {
    const { data: i } = await _s.from('menu_items')
        .select('*, item_flavor_relation(*)')
        .eq('id', id).single();

    document.getElementById('m-id').value           = i.id;
    document.getElementById('m-name').value         = i.name;
    document.getElementById('m-price').value        = i.price;
    document.getElementById('m-desc').value         = i.description || '';
    document.getElementById('m-is-set').checked     = i.is_set_menu;

    await openMenuModal(true);

    // 稍等 DOM 更新後回填口味勾選
    setTimeout(() => {
        i.item_flavor_relation.forEach(r => {
            const c = document.querySelector(`.flv-chk[value="${r.flavor_group_id}"]`);
            if (c) c.checked = true;
        });
    }, 300);
}

async function saveItem() {
    const id   = document.getElementById('m-id').value;
    const file = document.getElementById('m-img').files[0];
    let url    = '';

    if (file) {
        const path = `items/${Date.now()}.png`;
        await _s.storage.from('assets').upload(path, file);
        const { data } = _s.storage.from('assets').getPublicUrl(path);
        url = data.publicUrl;
    }

    const payload = {
        name:         document.getElementById('m-name').value,
        price:        document.getElementById('m-price').value,
        description:  document.getElementById('m-desc').value,
        category_id:  document.getElementById('m-cat').value,
        is_set_menu:  document.getElementById('m-is-set').checked,
    };
    if (url) payload.image_url = url;

    const { data: saved } = id
        ? await _s.from('menu_items').update(payload).eq('id', id).select()
        : await _s.from('menu_items').insert([payload]).select();

    if (saved) {
        // 重建口味關聯
        await _s.from('item_flavor_relation').delete().eq('item_id', saved[0].id);
        const rels = Array.from(document.querySelectorAll('.flv-chk:checked'))
            .map(c => ({ item_id: saved[0].id, flavor_group_id: c.value }));
        if (rels.length) await _s.from('item_flavor_relation').insert(rels);
        closeMenuModal();
        loadMenu();
    }
}

async function delItem(id) {
    if (confirm('確定刪除此餐點？')) {
        await _s.from('menu_items').delete().eq('id', id);
        loadMenu();
    }
}

function closeMenuModal() {
    document.getElementById('menu-modal').classList.add('hidden');
}

// ──────────────────────────────────────────────
//  3. 套餐分組 Modal
// ──────────────────────────────────────────────
async function openSetModal(id) {
    curItem = id;
    resetSetForm();
    document.getElementById('set-modal').classList.remove('hidden');

    const { data } = await _s.from('menu_items')
        .select('*, categories(name)')
        .eq('is_set_menu', false)
        .order('name');
    window.allPickerItems = data || [];
    renderPickerList(data);
    loadSavedSets();
}

function closeSetModal() {
    document.getElementById('set-modal').classList.add('hidden');
}

// ──────────────────────────────────────────────
//  4. 品項 Picker
// ──────────────────────────────────────────────
function renderPickerList(items) {
    const container = document.getElementById('item-picker-list');
    const grouped   = items.reduce((acc, i) => {
        const cat = i.categories?.name || '未分類';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(i);
        return acc;
    }, {});

    container.innerHTML = Object.keys(grouped).map(cat =>
        `<div class="col-span-2 mt-2 font-black text-[9px] text-stone-300 border-b uppercase">${cat}</div>` +
        grouped[cat].map(i =>
            `<div id="picker-${i.id}" onclick="togglePickerSelect('${i.id}', '${i.name}')"
                class="picker-item flex justify-between p-3 border rounded-xl bg-white cursor-pointer shadow-sm text-xs font-bold">
                <span>${i.name}</span>
                <div class="check-mark hidden font-bold text-p-gold">✔</div>
            </div>`
        ).join('')
    ).join('');
}

function filterPickerItems() {
    const kw = document.getElementById('set-item-search').value.toLowerCase();
    renderPickerList(window.allPickerItems.filter(i => i.name.toLowerCase().includes(kw)));
    pickerSelectedItems.forEach(s => {
        const el = document.getElementById(`picker-${s.id}`);
        if (el) el.classList.add('active');
    });
}

function togglePickerSelect(id, name) {
    const el  = document.getElementById(`picker-${id}`);
    const idx = pickerSelectedItems.findIndex(x => x.id === id);
    if (idx > -1) {
        pickerSelectedItems.splice(idx, 1);
        el?.classList.remove('active');
    } else {
        pickerSelectedItems.push({ id, name });
        el?.classList.add('active');
    }
    updatePickerStats();
}

function updatePickerStats() {
    document.getElementById('picker-count').innerText = `已選 ${pickerSelectedItems.length} 項`;
}

function addSelectedToPicks() {
    pickerSelectedItems.forEach(s => {
        if (!curPicks.some(p => p.id === s.id)) curPicks.push(s);
    });
    pickerSelectedItems = [];
    renderTempPicks();
    document.querySelectorAll('.picker-item').forEach(el => el.classList.remove('active'));
    updatePickerStats();
}

function renderTempPicks() {
    document.getElementById('temp-pick-display').innerHTML = curPicks.map((p, idx) =>
        `<div class="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full text-[10px] font-bold flex items-center gap-2">
            ${p.name}
            <span onclick="curPicks.splice(${idx},1);renderTempPicks();"
                class="cursor-pointer opacity-40 font-bold">✕</span>
        </div>`
    ).join('');
}

// ──────────────────────────────────────────────
//  5. 套餐分組 CRUD
// ──────────────────────────────────────────────
async function editSetGroup(groupId) {
    currentEditingGroupId = groupId;
    const { data: g } = await _s.from('set_menu_groups')
        .select('*, set_menu_contents(menu_items(*))')
        .eq('id', groupId).single();

    if (g) {
        document.getElementById('g-name').value  = g.group_name;
        document.getElementById('g-limit').value = g.selection_limit;
        document.getElementById('set-modal-title').innerText  = '編輯分組';
        document.getElementById('btn-save-group').innerText   = '儲存更新';
        document.getElementById('btn-cancel-edit').classList.remove('hidden');
        curPicks = g.set_menu_contents.map(c => ({ id: c.menu_items.id, name: c.menu_items.name }));
        renderTempPicks();
    }
}

function resetSetForm() {
    currentEditingGroupId = null;
    document.getElementById('g-name').value              = '';
    document.getElementById('g-limit').value             = 1;
    document.getElementById('temp-pick-display').innerHTML = '';
    document.getElementById('set-modal-title').innerText  = '套餐分組設定';
    document.getElementById('btn-save-group').innerText   = '確認儲存並建立分組';
    document.getElementById('btn-cancel-edit').classList.add('hidden');
    curPicks            = [];
    pickerSelectedItems = [];
    updatePickerStats();
}

async function saveFullSet() {
    const n = document.getElementById('g-name').value;
    const l = document.getElementById('g-limit').value;
    if (!n || !curPicks.length) return alert('輸入內容');

    let gid = currentEditingGroupId;
    if (gid) {
        await _s.from('set_menu_groups').update({ group_name: n, selection_limit: l }).eq('id', gid);
        await _s.from('set_menu_contents').delete().eq('group_id', gid);
    } else {
        const { data: g } = await _s.from('set_menu_groups')
            .insert([{ parent_set_id: curItem, group_name: n, selection_limit: l }]).select();
        if (g) gid = g[0].id;
    }

    if (gid) {
        await _s.from('set_menu_contents').insert(curPicks.map(p => ({ group_id: gid, item_id: p.id })));
        resetSetForm();
        loadSavedSets();
    }
}

async function loadSavedSets() {
    const { data } = await _s.from('set_menu_groups')
        .select('*, set_menu_contents(menu_items(*))')
        .eq('parent_set_id', curItem);

    document.getElementById('saved-groups-view').innerHTML = (data || []).map(g =>
        `<div class="p-3 bg-stone-50 border rounded-xl flex justify-between items-center shadow-inner">
            <div class="flex-1 text-left text-xs">
                <b class="text-p-green">${g.group_name} (限 ${g.selection_limit})</b>
                <p class="text-[10px] text-gray-400 line-clamp-1">
                    ${g.set_menu_contents.map(c => c.menu_items?.name).join('、')}
                </p>
            </div>
            <div class="flex gap-2">
                <button onclick="editSetGroup('${g.id}')"
                    class="text-p-gold border rounded px-1 font-bold shadow-sm hover:bg-white text-xs">編輯</button>
                <button onclick="delSetGroup('${g.id}')"
                    class="text-red-400 border rounded px-1 font-bold shadow-sm hover:bg-white text-xs">刪除</button>
            </div>
        </div>`
    ).join('');
}

async function delSetGroup(id) {
    if (confirm('刪除？')) {
        await _s.from('set_menu_groups').delete().eq('id', id);
        loadSavedSets();
    }
}

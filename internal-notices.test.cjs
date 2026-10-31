const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {chromium}=require('C:/Users/nioon/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

function mockDatabase(){
  window.testNotices=[
    {id:'1',title:'📌 春節營運提醒',body:'👋 請確認春節班表。\n[查看排班表](https://example.com/schedule)\n<img src=x onerror="window.attacked=true">',category:'營運通知',is_pinned:true,is_published:true,revision:1,published_at:'2026-10-31T10:00:00Z'},
    {id:'2',title:'✨ 新版系統上線',body:'參閱 https://example.com/help。\n感謝每一位夥伴 🙏',category:'系統更新',is_pinned:false,is_published:true,revision:1,published_at:'2026-10-30T10:00:00Z'},
    {id:'3',title:'尚未公開的草稿',body:'只有管理員可讀',category:'教育訓練',is_pinned:false,is_published:false,revision:1,published_at:null}
  ];
  window.testReads=[];window.user='staff-a';window.manager=false;
  window.mockClient={from(table){
    const filters=[];let operation='select',payload,start=0,end=199;
    const q={select(){return q;},order(){return q;},range(a,b){start=a;end=b;return q;},eq(k,v){filters.push([k,v]);return q;},
      insert(v){operation='insert';payload=v;return q;},update(v){operation='update';payload=v;return q;},
      upsert(v){operation='upsert';payload=v;return q;},delete(){operation='delete';return q;},
      async then(resolve,reject){
        try{
          let data=table==='internal_notices'?window.testNotices:window.testReads;
          if(table==='internal_notices'&&!window.manager)data=data.filter(n=>n.is_published);
          if(table==='internal_notice_reads')data=data.filter(n=>n.user_id===window.user);
          const matches=data.filter(n=>filters.every(([k,v])=>n[k]===v));
          if(table==='internal_notices'&&operation!=='select'&&!window.manager)return resolve({data:null,error:{message:'permission denied'}});
          let result;
          if(operation==='insert'){
            const row={...payload,id:String(window.testNotices.length+10),revision:1,published_at:payload.is_published?new Date().toISOString():null};window.testNotices.push(row);result=[row];
          }else if(operation==='update'){
            matches.forEach(row=>{const changed=['title','body','category','is_published'].some(k=>k in payload&&payload[k]!==row[k]);Object.assign(row,payload);if(changed)row.revision++;});result=matches;
          }else if(operation==='delete'){
            window.testNotices=window.testNotices.filter(n=>!matches.includes(n));result=matches;
          }else if(operation==='upsert'){
            if(payload.user_id!==window.user)return resolve({data:null,error:{message:'permission denied'}});
            const existing=window.testReads.find(n=>n.user_id===payload.user_id&&n.notice_id===payload.notice_id);
            if(existing)Object.assign(existing,payload);else window.testReads.push(payload);result=[payload];
          }else result=matches.slice(start,end+1);
          return resolve({data:JSON.parse(JSON.stringify(result)),error:null});
        }catch(error){return reject(error);}
      }
    };return q;
  }};
}

test('internal notices: personal unread state, safe links, emoji, admin CRUD and mobile layouts',async()=>{
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try{
    for(const width of [390,1280]){
      const page=await browser.newPage({viewport:{width,height:900}});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.setContent('<html lang="zh-TW"><head><meta charset="UTF-8"></head><body style="margin:0;padding:24px;background:#f8faf8;font-family:Arial,sans-serif"><span data-internal-unread hidden></span><div data-internal-feed></div><div data-internal-preview hidden></div><div data-internal-manage hidden></div></body></html>');
      await page.addStyleTag({path:path.join(__dirname,'../internal-notices.css')});
      await page.addScriptTag({path:path.join(__dirname,'../internal-notices.js')});
      await page.evaluate(mockDatabase);
      const init=(manager,user)=>page.evaluate(async({manager,user})=>{
        window.manager=manager;window.user=user;
        InternalNotices.init({client:window.mockClient,userId:user,canManage:manager,openFeed(){}});
        await InternalNotices.refresh();
      },{manager,user});
      await init(false,'staff-a');
      assert.equal(await page.locator('[data-internal-unread]').textContent(),'2');
      assert.equal(await page.locator('[data-in-list] .in-row').count(),2);
      assert.equal(await page.getByText('尚未公開的草稿',{exact:true}).count(),0);
      await page.locator('[data-in-list] .in-row').first().click();
      await page.locator('[data-in-read-status]').filter({hasText:'已閱讀'}).waitFor();
      assert.equal(await page.locator('[data-internal-unread]').textContent(),'1');
      const dialog=page.locator('#internal-notice-dialog');
      assert.equal(await dialog.locator('a').getAttribute('href'),'https://example.com/schedule');
      assert.equal(await dialog.locator('a').getAttribute('rel'),'noopener noreferrer');
      assert.equal(await dialog.locator('img,script').count(),0);
      assert.match(await dialog.locator('[data-in-article-body]').textContent(),/<img/);
      await dialog.screenshot({path:path.join(__dirname,`internal-notice-article-${width}.png`)});
      await dialog.getByRole('button',{name:'關閉公告'}).click();
      await page.locator('[data-in-filter="unread"]').click();
      assert.equal(await page.locator('[data-in-list] .in-row').count(),1);
      await page.evaluate(()=>{window.testNotices[0].revision++;});
      await page.evaluate(()=>InternalNotices.refresh());
      assert.equal(await page.locator('[data-internal-unread]').textContent(),'2','revised notice is unread again');
      await init(false,'staff-b');
      assert.equal(await page.locator('[data-internal-unread]').textContent(),'2','another account has separate read state');
      await page.locator('[data-internal-feed]').screenshot({path:path.join(__dirname,`internal-notice-feed-${width}.png`)});
      await init(true,'admin');
      const form=page.locator('[data-in-editor]');
      await form.locator('[name=title]').fill('🎉 新公告測試');
      await form.locator('[name=body]').fill('請各店確認。');
      await form.locator('[data-in-emoji]').click();
      await form.locator('[data-in-palette] button').first().click();
      assert.match(await form.locator('[name=body]').inputValue(),/📣/);
      await form.locator('[data-in-link]').click();
      await form.locator('[name=linkLabel]').fill('查看文件');
      await form.locator('[name=linkUrl]').fill('javascript:alert(1)');
      await form.locator('[data-in-insert-link]').click();
      assert.equal(await form.locator('[data-in-draft-preview] a').count(),0);
      await form.locator('[name=linkUrl]').fill('https://example.com/document');
      await form.locator('[data-in-insert-link]').click();
      assert.equal(await form.locator('[data-in-draft-preview] a').textContent(),'查看文件');
      await form.locator('[name=published]').check();
      await form.getByRole('button',{name:'儲存公告',exact:true}).click();
      await page.waitForFunction(()=>window.testNotices.some(n=>n.title==='🎉 新公告測試'));
      await page.waitForFunction(()=>document.querySelector('[data-in-editor] [name=title]').value==='');
      const saved=page.locator('.in-manage-row').filter({has:page.getByText('🎉 新公告測試',{exact:true})});
      await saved.getByRole('button',{name:'編輯',exact:true}).click();
      await form.locator('[name=body]').fill('更新內容 ✅');
      await form.getByRole('button',{name:'儲存公告',exact:true}).click();
      await page.waitForFunction(()=>window.testNotices.find(n=>n.title==='🎉 新公告測試').revision===2);
      await page.locator('[data-internal-manage]').screenshot({path:path.join(__dirname,`internal-notice-manage-${width}.png`)});
      await saved.getByRole('button',{name:'撤下',exact:true}).click();
      await page.waitForFunction(()=>!window.testNotices.find(n=>n.title==='🎉 新公告測試').is_published);
      page.on('dialog',dialog=>dialog.accept());
      await saved.getByRole('button',{name:'刪除',exact:true}).click();
      await page.waitForFunction(()=>!window.testNotices.some(n=>n.title==='🎉 新公告測試'));
      assert.deepEqual(errors,[]);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no horizontal overflow');
      await page.close();
      console.log(`${width}px: unread per account, revised notices, safe URLs, emoji, publish/edit/unpublish/delete OK`);
    }
  }finally{await browser.close();}
});

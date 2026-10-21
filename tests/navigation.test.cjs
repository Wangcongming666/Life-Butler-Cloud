const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {MemoryRepository} = require('./helpers/memory-cloud.cjs');
const {createService} = require('../cloudfunctions/lifeButler/service');
const {createClient} = require('./helpers/client.cjs');
const mini = path.resolve(__dirname, '../miniprogram');
const tick = () => new Promise(resolve => setImmediate(resolve));

for (const root of [mini]) {
  test(root + ': route synchronization never replays click effects', () => {
    let definition;
    vm.runInNewContext(fs.readFileSync(path.join(root, 'custom-tab-bar/index.js'), 'utf8'), {
      Component: value => definition = value, wx: {},
      require: () => ({getDefault: () => ({getState: () => ({selected:-1,loading:false})})}),
      getCurrentPages: () => [{route:'pages/tools/index'}],
      setTimeout: () => 1, clearTimeout() {}
    });
    const bar = Object.assign({data:structuredClone(definition.data), setData(patch) {Object.assign(this.data, patch);}}, definition.methods);
    assert.equal(bar.data.selected, -1, 'no incorrect default highlight before route is known');
    bar.syncRoute();
    assert.equal(bar.data.selected, 2);
    assert.equal(bar.data.tapped, -1, 'showing another page must not replay click animations');
    bar.select(1);
    bar.syncRoute();
    assert.equal(bar.data.selected, 2);
    assert.equal(bar.data.tapped, -1);
    const css = fs.readFileSync(path.join(root, 'custom-tab-bar/index.wxss'), 'utf8');
    assert.doesNotMatch(css.match(/\.selection-rail\s*\{([^}]+)\}/)[1], /transition:\s*transform/, 'highlight must not slide across unrelated tabs');
  });
}

test('cached page content and selected tab appear before a slow cloud response', async () => {
  const c = createClient(createService(new MemoryRepository()));
  await c.sync.start();
  await c.store.addExpense({amount:'12',category:'餐饮',note:'cached'});
  const p = c.page('account');
  let selected = -1, release;
  p.getTabBar = () => ({setData(){}, select(index){selected=index;}});
  const original = c.wx.cloud.callFunction;
  c.wx.cloud.callFunction = options => new Promise(resolve => {release = () => resolve(original(options));});
  p.onLoad({});
  const showing = p.onShow();
  await tick();
  try {
    assert.equal(selected, 1);
    assert.equal(p.data.cloudReady, true);
    assert.equal(p.data.expenses.length, 1, 'render cached records while network remains pending');
  } finally {
    c.wx.cloud.callFunction = original;
    release();
    await showing;
    p.onUnload();
  }
});

test('a hidden show continuation cannot initialize again after rapid hide/show', async () => {
  let definition, resolvePull, shown = 0;
  const state = {ready:false,status:'loading',lastSyncedAt:0};
  const pull = new Promise(resolve => resolvePull = resolve);
  const listeners = new Set();
  const service = {restoreEdit(){},endEdit(){},getState:()=>state,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},pull:()=>pull};
  const module = {exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(mini,'utils/page-sync.js'),'utf8'), {
    module, console, Date, Page:p=>definition=p, wx:{showModal(){}},
    require:id=>id==='./sync'?{getDefault:()=>service}:id==='./navigation'?{syncTab(){}}:{apply(){}}
  });
  module.exports.definePage({data:{},onShow(){shown++;}});
  const p = Object.assign({}, definition);
  p.data={...definition.data};p.setData=patch=>Object.assign(p.data,patch);
  p.onLoad({});
  const first=p.onShow();p.onHide();const second=p.onShow();
  state.ready=true;state.status='synced';state.lastSyncedAt=1;
  for(const fn of listeners)fn(state);
  resolvePull();await Promise.all([first,second]);
  assert.equal(shown,1,'only the latest visible lifecycle may run');
  p.onUnload();
});

test('tab changes with unchanged cloud metadata do not download all records again', async () => {
  const c=createClient(createService(new MemoryRepository()));await c.sync.start();
  const original=c.wx.cloud.callFunction, actions=[];
  c.wx.cloud.callFunction=options=>{actions.push(options.data.action);return original(options);};
  const p=c.page('tools');p.onLoad({});await p.onShow();p.onUnload();
  assert.equal(actions.includes('describe'),true);
  assert.equal(actions.includes('pull'),false);
});

test('real tab components accept a second tap during switching and wait for the newest page render', async () => {
  const c=createClient(createService(new MemoryRepository()));await c.sync.start();
  const navigator=c.load('utils/tab-navigation.js').getDefault(), requests=[];
  c.wx.switchTab=options=>requests.push(options);
  let route='pages/todo/index',definition;
  vm.runInNewContext(fs.readFileSync(path.join(mini,'custom-tab-bar/index.js'),'utf8'),{
    Component:p=>definition=p,wx:c.wx,require:()=>({getDefault:()=>navigator}),
    getCurrentPages:()=>[{route}],setTimeout:()=>1,clearTimeout(){}
  });
  function mountBar(){
    const bar=Object.assign({data:structuredClone(definition.data),setData(patch){Object.assign(this.data,patch);}},definition.methods);
    definition.lifetimes.attached.call(bar);return bar;
  }
  function pageWithDelayedRender(name){
    const page=c.page(name);let rendered;
    page.setData=(patch,callback)=>{Object.assign(page.data,patch);if(callback)rendered=callback;};
    page.onLoad({});const showing=page.onShow();
    return {page,showing,finish:()=>rendered()};
  }
  const todo=c.page('todo');todo.onLoad({});await todo.onShow();
  const firstBar=mountBar();firstBar.onTap({currentTarget:{dataset:{index:1}}});
  assert.equal(firstBar.data.navigationLoading,true);
  todo.onHide();route='pages/account/index';const account=pageWithDelayedRender('account');await tick();
  const secondBar=mountBar();
  secondBar.onTap({currentTarget:{dataset:{index:2}}});
  assert.equal(secondBar.data.selected,2);assert.equal(firstBar.data.selected,2);
  assert.equal(secondBar.data.navigationLabel,'工具');
  requests[0].success();requests[0].complete();
  assert.equal(requests.length,2);assert.equal(requests[1].url,'/pages/tools/index');
  account.page.onHide();route='pages/tools/index';const tools=pageWithDelayedRender('tools');await tick();
  const thirdBar=mountBar();requests[1].success();requests[1].complete();
  account.finish();await account.showing;
  assert.equal(thirdBar.data.navigationLoading,true,'late account render cannot dismiss tools loading');
  tools.finish();await tools.showing;
  assert.equal(thirdBar.data.navigationLoading,false);assert.equal(thirdBar.data.selected,2);
  tools.page.onUnload();account.page.onUnload();todo.onUnload();
  for(const bar of [firstBar,secondBar,thirdBar])definition.lifetimes.detached.call(bar);
});

test('cold-start network failure releases navigation loading so the retry screen remains usable',async()=>{
  const c=createClient(createService(new MemoryRepository()));c.offline();
  const nav=c.load('utils/tab-navigation.js').getDefault();
  const page=c.page('account');page.onLoad({});await page.onShow();
  assert.equal(page.data.cloudReady,false);assert.equal(page.data.cloudStatus,'error');
  assert.equal(nav.getState().selected,1);assert.equal(nav.getState().loading,false);
  c.offline(false);await page.syncNow();await tick();
  assert.equal(page.data.cloudReady,true);assert.equal(nav.getState().loading,false);
  page.onUnload();
});

const test=require('node:test'),assert=require('node:assert/strict');const {MemoryRepository}=require('./helpers/memory-cloud.cjs'),{createService}=require('../cloudfunctions/lifeButler/service'),{createClient}=require('./helpers/client.cjs');
test('every original business page loads after cloud initialization',async()=>{
 const service=createService(new MemoryRepository()),c=createClient(service);for(const name of ['todo','account','tools','profile','schedule','notes','life','focus','search','backup','loans','food','review','timeline','settings','checkin']){
  const page=c.page(name);page.onLoad({});await page.onShow();await new Promise(r=>setImmediate(r));assert.equal(page.data.cloudReady,true,name);page.onHide();page.onUnload();
 }assert.equal(c.notices.filter(n=>n.title==='操作未完成').length,0);
});
test('old local migration is previewed without changing cloud, then merges explicitly',async()=>{
 const service=createService(new MemoryRepository()),c=createClient(service);await c.sync.start();await c.store.saveTodo({title:'云端',dueAt:0});const legacy=require('../miniprogram/utils/data-schema').emptyData();legacy.todos.push({id:'old',title:'旧设备',done:false,dueAt:0,createdAt:0,images:[]});c.cache.set('life_butler_data_v1',legacy);
 const migration=c.load('utils/migration.js'),text=migration.inspectLegacy();assert.ok(c.cache.has('life_cloud_legacy_backup:'+c.load('utils/cloud.js').ENV));const preview=migration.prepare(text);assert.equal(c.store.read().todos.length,1);await migration.apply(preview);assert.equal(c.store.read().todos.length,2);
});
test('simultaneous timer settlement from two devices creates one history record',async()=>{
 const service=createService(new MemoryRepository()),a=createClient(service),b=createClient(service);await a.sync.start();await a.store.startTimer('focus',1,0);await b.sync.start();const outcomes=await Promise.allSettled([a.store.settleTimer(60000),b.store.settleTimer(60000)]);assert.ok(outcomes.every(r=>r.status==='fulfilled'));await a.sync.pull();assert.equal(a.store.read().life.sessions.length,1);
});
test('restart confirms an uncertain saved request without duplicating the record',async()=>{
 const repo=new MemoryRepository(),service=createService(repo),a=createClient(service);await a.sync.start();const original=a.wx.cloud.callFunction;
 a.wx.cloud.callFunction=async options=>{const result=await original(options);if(['commit','operation'].includes(options.data.action))throw Error('响应丢失');return result;};
 await assert.rejects(a.store.addExpense({amount:'1',category:'餐饮',note:'唯一'}),e=>e.code==='PENDING_CONFIRMATION');
 const b=createClient(service);for(const [key,value]of a.cache)b.cache.set(key,structuredClone(value));await b.sync.start();assert.equal(b.store.read().expenses.length,1);assert.equal((await repo.load('user')).meta.revision,1);
});

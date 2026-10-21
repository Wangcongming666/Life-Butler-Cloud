const test=require('node:test'),assert=require('node:assert/strict');
const {MemoryRepository}=require('./helpers/memory-cloud.cjs');
const {createService}=require('../cloudfunctions/lifeButler/service');
const {createClient}=require('./helpers/client.cjs');
test('todo completion updates immediately, survives refresh and rolls back on cloud failure',async()=>{
 const c=createClient(createService(new MemoryRepository()));await c.sync.start();await c.store.saveTodo({title:'浇花',dueAt:0});
 const p=c.page('todo');p.onLoad({});await p.onShow();await p.onStatus({currentTarget:{dataset:{filter:'3'}}});await p.clearRange();const id=c.store.read().todos[0].id;
 const original=c.wx.cloud.callFunction;let release,commits=0;const gate=new Promise(r=>release=r);
 c.wx.cloud.callFunction=async o=>{if(o.data.action==='commit'){commits++;await gate;}return original(o);};
 const save=p.toggle({currentTarget:{dataset:{id}}});await new Promise(r=>setImmediate(r));
 assert.equal(p.data.togglingId,id);assert.equal(p.data.todos[0].done,true);assert.equal(c.store.read().todos[0].done,false);
 await p.refresh();assert.equal(p.data.todos[0].done,true);
 await p.toggle({currentTarget:{dataset:{id}}});release();await save;
 assert.equal(commits,1);assert.equal(p.data.togglingId,'');assert.equal(p.data.todos.length,0);await p.onStatus({currentTarget:{dataset:{filter:'2'}}});assert.equal(p.data.todos[0].done,true);
 c.offline();await p.toggle({currentTarget:{dataset:{id}}});assert.equal(p.data.togglingId,'');assert.equal(p.data.todos[0].done,true);
 p.onHide();p.onUnload();
});
test('confirmed todo changes use two requests and preserve versions across successive changes',async()=>{
 const requests=[],service=createService(new MemoryRepository());const c=createClient((owner,event)=>{requests.push(event.action);return service(owner,event);});
 await c.sync.start();await c.store.saveTodo({title:'浇花',dueAt:0});const id=c.store.read().todos[0].id;requests.length=0;
 await c.store.toggleTodo(id,true);assert.deepEqual(requests,['describe','commit']);assert.equal(c.store.read().todos[0].done,true);
 requests.length=0;await c.store.toggleTodo(id,false);assert.deepEqual(requests,['describe','commit']);assert.equal(c.store.read().todos[0].done,false);
});
test('todo fast confirmation reconciles unrelated updates from the other device',async()=>{
 const service=createService(new MemoryRepository()),a=createClient(service),b=createClient(service);await a.sync.start();await a.store.saveTodo({title:'手机',dueAt:0});const id=a.store.read().todos[0].id;await b.sync.start();await b.store.addExpense({amount:'1',category:'餐饮',note:'PC新记录'});
 await a.store.toggleTodo(id,true);assert.equal(a.store.read().todos[0].done,true);assert.equal(a.store.read().expenses.length,1);
});
test('an uncertain old completion never suppresses a later completion after undo',async()=>{
 const c=createClient(createService(new MemoryRepository()));await c.sync.start();await c.store.saveTodo({title:'浇花',dueAt:0});const id=c.store.read().todos[0].id,original=c.wx.cloud.callFunction;
 c.wx.cloud.callFunction=async o=>{const result=await original(o);if(['commit','operation'].includes(o.data.action))throw Error('响应丢失');return result;};
 await assert.rejects(c.store.toggleTodo(id,true),e=>e.code==='PENDING_CONFIRMATION');c.wx.cloud.callFunction=original;await c.sync.pull();
 await c.store.toggleTodo(id,false);assert.equal(c.store.read().todos[0].done,false);
 await c.store.toggleTodo(id,true);assert.equal(c.store.read().todos[0].done,true);
});

const test=require('node:test'),assert=require('node:assert/strict');const {MemoryRepository}=require('./helpers/memory-cloud.cjs'),{createService}=require('../cloudfunctions/lifeButler/service'),{createClient}=require('./helpers/client.cjs');
test('cancelled close confirmation retains old form version even after another page resets',async()=>{
 const repo=new MemoryRepository(),service=createService(repo),a=createClient(service),b=createClient(service);await a.sync.start();await a.store.saveLifeRecord({type:'shopping',title:'旧',images:[]});const id=a.store.read().life.records[0].id;
 const p=a.page('life');p.onLoad({type:'shopping'});await p.onShow();p.edit({currentTarget:{dataset:{id}}});p.closeForm();const modal=a.notices.at(-1);await modal.success({confirm:false});assert.equal(p.data.formVisible,true);
 const todo=a.page('todo');todo.onLoad({});await todo.onShow();todo.openAdd();
 await b.sync.start();await b.store.saveLifeRecord({...b.store.read().life.records[0],title:'远端最新'});await a.sync.pull();
 await assert.rejects(a.store.saveLifeRecord({...p.data.draft,title:'旧草稿覆盖'}),e=>e.code==='CONFLICT');assert.equal(a.store.read().life.records[0].title,'远端最新');
});
for(const manual of [false,true])test('pending saved form retries once without duplicate, manual sync='+manual,async()=>{
 const repo=new MemoryRepository(),a=createClient(createService(repo));await a.sync.start();const original=a.wx.cloud.callFunction;
 a.wx.cloud.callFunction=async o=>{const result=await original(o);if(['commit','operation'].includes(o.data.action))throw Error('丢响应');return result;};const input={amount:'2',category:'餐饮',note:'同一表单'};
 await assert.rejects(a.store.addExpense(input),e=>e.code==='PENDING_CONFIRMATION');a.wx.cloud.callFunction=original;if(manual)await a.sync.pull();await a.store.addExpense(input);assert.equal(a.store.read().expenses.length,1);
});
test('original commit completing after idempotency query returns its success to retry',async()=>{
 const repo=new MemoryRepository(),service=createService(repo),event={action:'commit',operationId:'race',generation:'g0',changes:[{kind:'todos',id:'t',expectedVersion:0,value:{id:'t',title:'唯一',done:false,dueAt:0,createdAt:0,images:[]}}]};
 const original=repo.operation.bind(repo);let race=true;repo.operation=async(owner,id)=>{const result=await original(owner,id);if(race&&id==='race'){race=false;await service(owner,event);}return result;};
 const result=await service('user',event);assert.equal(result.ok,true);assert.equal((await repo.load('user')).meta.revision,1);
});

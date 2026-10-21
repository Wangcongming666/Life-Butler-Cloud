const test=require('node:test'),assert=require('node:assert/strict');
const {MemoryRepository}=require('./helpers/memory-cloud.cjs');
const {createService}=require('../cloudfunctions/lifeButler/service');
const {createSync}=require('../miniprogram/utils/sync');
function harness(){const repo=new MemoryRepository(),service=createService(repo);return {repo,client(owner='a',extra={}){return createSync({call:async(action,payload)=>service(owner,{action,...payload}),...extra});}};}
const add=(d,id,title)=>d.todos.push({id,title,done:false,dueAt:0,createdAt:0,images:[]});
test('two devices sync records; failed writes never change confirmed state',async()=>{
 const h=harness(),a=h.client(),b=h.client();assert.throws(()=>a.read(),/加载/);await a.start();await b.start();
 const draft=a.read();add(draft,'t','手机');await a.commit(draft);await b.pull({force:true});assert.equal(b.read().todos[0].title,'手机');
 const old=b.read(),current=a.read();current.todos[0].title='最新';await a.commit(current);old.todos[0].title='过期';await assert.rejects(b.commit(old),e=>e.code==='CONFLICT');assert.equal(b.read().todos[0].title,'手机');
});
test('edit context remains stale after background refresh and preserves cache failure success',async()=>{
 const h=harness(),a=h.client(),b=h.client('a',{saveCache(){throw Error('空间不足');}});await a.start();let d=a.read();add(d,'t','初始');await a.commit(d);await b.start();
 b.beginEdit('todos','t');d=a.read();d.todos[0].title='另一端';await a.commit(d);await b.pull({force:true});
 const stale=b.read();stale.todos[0].title='旧表单';await assert.rejects(b.commit(stale),e=>e.code==='CONFLICT');
 b.endEdit();const fresh=b.read();add(fresh,'new','可保存');await b.commit(fresh);assert.equal(b.getState().status,'synced');assert.equal((await h.repo.load('a')).records.filter(r=>r.kind==='todos').length,2);
});
test('lost response is confirmed by operation ID without duplicate writes',async()=>{
 const h=harness();let lose=true;const service=createService(h.repo);const a=createSync({call:async(action,p)=>{const result=await service('a',{action,...p});if(action==='commit'&&lose){lose=false;throw Error('timeout');}return result;}});
 await a.start();const draft=a.read();add(draft,'t','唯一');await a.commit(draft);assert.equal(a.read().todos.length,1);assert.equal((await h.repo.load('a')).meta.revision,1);
});
test('large change uses staged replace and timer cancellation is a value update',async()=>{
 const h=harness(),a=h.client();await a.start();let d=a.read();for(let i=0;i<70;i++)add(d,'t'+i,'记录');await a.commit(d);assert.equal(a.read().todos.length,70);
 d=a.read();d.life.timer={id:'timer',mode:'focus',seconds:60,remaining:60,status:'running',endAt:60000};await a.commit(d);
 d=a.read();d.life.timer=null;await a.commit(d);assert.equal(a.read().life.timer,null);
});
test('failed pending persistence never replays an unsent edit later',async()=>{
 const h=harness(),a=h.client('a',{savePending(owner,value){if(value)throw Error('空间不足');}});await a.start();const draft=a.read();add(draft,'unsent','未发送');await assert.rejects(a.commit(draft));await a.pull({force:true});assert.equal((await h.repo.load('a')).records.length,0);
});
test('identity change cannot replay previous user pending edits',async()=>{
 const repo=new MemoryRepository(),service=createService(repo);let owner='a',blocked=false;const a=createSync({call:async(action,p)=>{if(blocked&&action!=='describe')throw Error('offline');return service(owner,{action,...p});}});await a.start();const draft=a.read();add(draft,'private','A的内容');blocked=true;await assert.rejects(a.commit(draft));owner='b';blocked=false;await a.pull({force:true});assert.equal((await repo.load('b')).records.length,0);assert.equal(a.owner(),'b');
});

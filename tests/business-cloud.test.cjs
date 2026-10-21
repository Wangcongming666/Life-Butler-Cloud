const test=require('node:test'),assert=require('node:assert/strict');const {MemoryRepository}=require('./helpers/memory-cloud.cjs'),{createService}=require('../cloudfunctions/lifeButler/service'),{createClient}=require('./helpers/client.cjs');
test('original business writes persist through cloud and refresh second device',async()=>{
 const repo=new MemoryRepository(),service=createService(repo),a=createClient(service),b=createClient(service),s=a.store;await a.sync.start();await b.sync.start();
 await s.saveTodo({title:'待办',dueAt:0});let id=s.read().todos[0].id;await s.toggleTodo(id);assert.equal(s.read().todos[0].done,true);await s.removeTodo(id);
 await s.addExpense({amount:'12.30',category:'餐饮',note:'账目'});id=s.read().expenses[0].id;await s.updateExpense(id,{amount:'9.99',category:'餐饮',note:'修改'});assert.equal(s.read().expenses[0].amountCents,999);
 await s.saveCourse({title:'数学',day:1,start:1,end:2,weeks:[1]});id=s.read().schedule.courses[0].id;await s.removeCourse(id);
 await s.saveLifeRecord({type:'shopping',title:'购物',images:[]});id=s.read().life.records[0].id;await s.toggleLifeRecord(id);assert.equal(s.read().life.records[0].done,true);
 await s.saveBudget({month:'2026-10',total:'100',categories:[]});assert.equal(s.read().life.budgets[0].totalCents,10000);
 await s.startTimer('focus',1,0);assert.equal(await s.settleTimer(60000),'focus');assert.equal(s.read().life.sessions.length,1);assert.equal(await s.settleTimer(60001),null);
 await s.savePreferences({theme:'blue'});await b.sync.pull();assert.equal(b.store.read().preferences.theme,'blue');assert.equal(b.store.read().expenses[0].amountCents,999);
});
test('photos and full backup survive another device; offline save keeps cloud state',async()=>{
 const service=createService(new MemoryRepository()),files=new Map(),a=createClient(service,'user',files),b=createClient(service,'user',files);await a.sync.start();await b.sync.start();
 await a.store.saveNoteWithImages({title:'照片',comment:'内容',price:'',images:['/tmp/a.jpg']});const id=a.store.read().notes[0].id;await b.sync.pull();assert.match(b.store.read().notes[0].images[0],/^cloud:\/\//);
 const backup=await b.store.createBackup();assert.equal(JSON.parse(backup).images.length,1);await b.store.restoreBackup(backup);assert.equal(b.store.read().notes.length,1);
 a.offline();await assert.rejects(a.store.addExpense({amount:'1',category:'餐饮',note:''}));assert.equal(a.store.read().expenses.length,0);
});

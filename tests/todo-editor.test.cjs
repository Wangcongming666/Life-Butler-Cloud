const test=require('node:test'),assert=require('node:assert/strict');
const {MemoryRepository}=require('./helpers/memory-cloud.cjs');
const {createService}=require('../cloudfunctions/lifeButler/service');
const {createClient}=require('./helpers/client.cjs');
const schema=require('../miniprogram/utils/data-schema');
async function setup(){const c=createClient(createService(new MemoryRepository()));await c.sync.start();const p=c.page('todo');p.onLoad({});await p.onShow();return {c,p};}
test('future start survives cloud sync and editing, with not-started status',async()=>{
 const {c,p}=await setup();p.openAdd();assert.equal(p.data.formVisible,true);assert.ok(p.data.startDate);assert.ok(p.data.startTime);
 const start=Date.now()+86400000,end=start+3600000;
 p.setData({title:'提前安排',startDate:c.store.dateText(start),startTime:c.store.timeText(start),date:c.store.dateText(end),time:c.store.timeText(end)});
 await p.save();assert.equal(p.data.formVisible,false);assert.equal(c.store.read().todos.length,1);
 const todo=c.store.read().todos[0];assert.ok(todo.startAt>Date.now());assert.ok(todo.dueAt>=todo.startAt);
 await c.sync.pull({force:true});await p.refresh();assert.equal(p.data.todos[0].notStarted,true);
 p.openEdit({currentTarget:{dataset:{id:todo.id}}});assert.equal(p.data.startDate,c.store.dateText(todo.startAt));assert.equal(p.data.startTime,c.store.timeText(todo.startAt));
 p.closeForm();assert.equal(p.data.formVisible,false);p.onUnload();
});
test('invalid start/end retains editor, draft and avoids cloud writes',async()=>{
 const {c,p}=await setup();p.openAdd();p.setData({title:'错误时间',startDate:'2027-01-02',startTime:'12:00',date:'2027-01-01',time:'12:00'});
 await p.save();assert.equal(p.data.formVisible,true);assert.equal(p.data.title,'错误时间');assert.ok(p.data.formError);assert.equal(c.store.read().todos.length,0);
 p.setData({startDate:'2027-02-30',date:'2027-03-01'});await p.save();assert.ok(p.data.formError);assert.equal(c.store.read().todos.length,0);p.onUnload();
});
test('storage and shared validation reject reversed starts, while legacy todos remain valid',async()=>{
 const {c,p}=await setup();await assert.rejects(c.store.saveTodo({title:'无效',startAt:20,dueAt:10}));
 await c.store.saveTodo({title:'旧记录',dueAt:0});await p.onStatus({currentTarget:{dataset:{filter:'3'}}});p.openEdit({currentTarget:{dataset:{id:p.data.todos[0].id}}});assert.ok(p.data.startDate);await p.save();assert.equal(p.data.formVisible,false);
 const data=schema.emptyData();data.todos=[{id:'a',title:'范围',startAt:20,dueAt:10,done:false,createdAt:0}];assert.throws(()=>schema.validate(data));data.todos[0].startAt=0;assert.doesNotThrow(()=>schema.validate(data));p.onUnload();
});
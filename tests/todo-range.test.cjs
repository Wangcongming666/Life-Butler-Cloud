const test=require('node:test'),assert=require('node:assert/strict');
const {MemoryRepository}=require('./helpers/memory-cloud.cjs');
const {createService}=require('../cloudfunctions/lifeButler/service');
const {createClient}=require('./helpers/client.cjs');
async function setup(){
 const c=createClient(createService(new MemoryRepository()));await c.sync.start();const data=c.store.read();
 const p=c.page('todo');p.onLoad({});await p.onShow();return {c,p,data};
}
test('range checkbox defaults off, enables filtering and restores every deadline when unchecked',async()=>{
 const {c,p,data}=await setup();const now=Date.now(),d=new Date(now),end=new Date(d.getFullYear(),d.getMonth(),d.getDate()+1).getTime();
 data.todos=[{id:'old',title:'以前',dueAt:now-86400000,createdAt:1,done:false},{id:'today',title:'今天',dueAt:end-1,createdAt:2,done:false},{id:'future',title:'以后',dueAt:end+1,createdAt:3,done:false}];c.store.read=()=>data;
 p.setData({filter:0});await p.refresh();assert.equal(p.data.rangeActive,false);assert.equal(p.data.todos.length,3);
 await p.toggleRangeFilter();assert.equal(p.data.rangeActive,true);assert.deepEqual(Array.from(p.data.todos,e=>e.id),['today']);
 const start=p.data.rangeStart;await p.toggleRangeFilter();assert.equal(p.data.rangeActive,false);assert.equal(p.data.todos.length,3);assert.equal(p.data.rangeStart,start);
 await p.toggleRangeFilter();assert.equal(p.data.rangeStart,start);assert.equal(p.data.todos.length,1);p.onUnload();
});
test('pending excludes overdue; opening the range only prefills its draft',async()=>{
 const {c,p,data}=await setup(),now=new Date(),midnight=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1).getTime();
 assert.equal(p.data.rangeActive,false);assert.equal(p.data.filter,1);
 data.todos=[{id:'old',title:'逾期',dueAt:Date.now()-86400000,createdAt:1,done:false},{id:'inside',title:'今天',dueAt:midnight-1,createdAt:2,done:false},{id:'later',title:'明天',dueAt:midnight+1,createdAt:3,done:false}];c.store.read=()=>data;
 await p.refresh();assert.equal(p.data.todos.length,2);assert.equal(p.data.overdueCount,1);p.openRange();assert.equal(p.data.rangeActive,false);assert.equal(p.data.todos.length,2);
 const draftStart=new Date(...[...p.data.rangeStartDate.split('-').map((n,i)=>Number(n)-(i===1?1:0)),...p.data.rangeStartTime.split(':').map(Number)]).getTime();assert.ok(Math.abs(draftStart-Date.now())<61000);assert.equal(p.data.rangeEndDate,c.store.dateText(midnight));assert.equal(p.data.rangeEndTime,'00:00');
 p.closeRange();assert.equal(p.data.todos.length,2);assert.equal(p.data.rangeActive,false);p.openRange();await p.applyRange();assert.equal(p.data.todos.length,1);assert.equal(p.data.todos[0].id,'inside');await p.clearRange();assert.equal(p.data.todos.length,2);p.onUnload();
});
test('custom cross-day range filters deadlines and combines with query, status and both sort directions',async()=>{
 const {c,p,data}=await setup();data.todos=[
  {id:'a',title:'学习 A',dueAt:new Date(2026,11,31,23).getTime(),createdAt:1,done:false},
  {id:'b',title:'学习 B',dueAt:new Date(2027,0,1,1).getTime(),createdAt:2,done:true},
  {id:'c',title:'其他',dueAt:new Date(2027,0,1,0).getTime(),createdAt:3,done:false},
  {id:'d',title:'学习 D',dueAt:new Date(2027,0,1,2).getTime(),createdAt:4,done:false}];c.store.read=()=>data;
 p.setData({filter:0,rangeStartDate:'2026-12-31',rangeStartTime:'23:00',rangeEndDate:'2027-01-01',rangeEndTime:'01:00'});await p.applyRange();
 assert.deepEqual(Array.from(p.data.todos,e=>e.id),['a','c','b']);await p.onSort({detail:{value:'1'}});assert.deepEqual(Array.from(p.data.todos,e=>e.id),['b','c','a']);
 await p.onQuery({detail:{value:'学习'}});assert.deepEqual(Array.from(p.data.todos,e=>e.id),['b','a']);await p.onFilter({detail:{value:'1'}});assert.deepEqual(Array.from(p.data.todos,e=>e.id),['a']);p.onUnload();
});
test('invalid or reversed ranges retain the applied range and display an inline error',async()=>{
 const {p}=await setup(),start=p.data.rangeStart,end=p.data.rangeEnd;
 p.setData({rangeStartDate:'2026-02-30'});await p.applyRange();assert.ok(p.data.rangeError);assert.equal(p.data.rangeStart,start);assert.equal(p.data.rangeEnd,end);
 p.setData({rangeStartDate:'2026-10-20',rangeStartTime:'12:00',rangeEndDate:'2026-10-19',rangeEndTime:'12:00'});await p.applyRange();assert.ok(p.data.rangeError);assert.equal(p.data.rangeStart,start);
 await p.resetRange();assert.equal(p.data.rangeError,'');assert.equal(p.data.rangeActive,false);await p.applyRange();assert.equal(p.data.rangeActive,true);p.onUnload();
});
test('pending and completed have separate views and a confirmed check / undo moves the record between them',async()=>{
 const {c,p}=await setup();await c.store.saveTodo({title:'旧待办',dueAt:Date.now()+86400000});await p.refresh();const id=p.data.todos[0].id;
 assert.equal(p.data.pending,1);assert.equal(p.data.completed,0);await p.toggle({currentTarget:{dataset:{id}}});assert.equal(p.data.todos.length,0);assert.equal(p.data.completed,1);
 await p.onStatus({currentTarget:{dataset:{filter:'2'}}});assert.equal(p.data.todos.length,1);assert.equal(p.data.todos[0].done,true);assert.equal(p.data.rangeActive,false);
 await p.toggle({currentTarget:{dataset:{id}}});assert.equal(p.data.todos.length,0);assert.equal(p.data.pending,1);await p.onStatus({currentTarget:{dataset:{filter:'1'}}});assert.equal(p.data.todos[0].id,id);p.onUnload();
});
test('range panel is closed initially; cancel discards draft, confirmation applies and closes, sort toggles independently',async()=>{
 const {p}=await setup(),start=p.data.rangeStart;
 assert.equal(p.data.rangeVisible,false);p.openRange();assert.equal(p.data.rangeVisible,true);
 p.onRangeChange({currentTarget:{dataset:{field:'rangeStartDate'}},detail:{value:'2020-01-01'}});p.closeRange();assert.equal(p.data.rangeStart,start);
 p.openRange();assert.notEqual(p.data.rangeStartDate,'2020-01-01');p.setData({rangeEndDate:'1970-01-01'});await p.applyRange();assert.equal(p.data.rangeVisible,true);assert.ok(p.data.rangeError);
 p.setData({rangeStartDate:'2026-12-31',rangeStartTime:'23:00',rangeEndDate:'2027-01-01',rangeEndTime:'01:00'});await p.applyRange();assert.equal(p.data.rangeVisible,false);assert.equal(p.data.rangeStart,new Date(2026,11,31,23).getTime());
 await p.toggleSort();assert.equal(p.data.sort,1);await p.toggleSort();assert.equal(p.data.sort,0);assert.equal(p.data.rangeStart,new Date(2026,11,31,23).getTime());
 p.openRange();await p.clearRange();assert.equal(p.data.rangeVisible,false);assert.equal(p.data.rangeActive,false);p.onUnload();
});

test('overdue has an exclusive tab, counts and respects search and time range',async()=>{
 const {c,p,data}=await setup(),now=Date.now();
 data.todos=[{id:'old',title:'学习 逾期',dueAt:now-86400000,createdAt:1,done:false},{id:'future',title:'学习 以后',dueAt:now+86400000,createdAt:2,done:false},{id:'done',title:'已完成',dueAt:now-86400000,createdAt:3,done:true}];c.store.read=()=>data;
 await p.refresh();assert.deepEqual(Array.from(p.data.todos,e=>e.id),['future']);assert.equal(p.data.overdueCount,1);assert.equal(p.data.pending,2);assert.equal(p.data.completed,1);
 await p.onStatus({currentTarget:{dataset:{filter:'3'}}});assert.equal(p.data.filter,3);assert.deepEqual(Array.from(p.data.todos,e=>e.id),['old']);
 await p.onQuery({detail:{value:'以后'}});assert.equal(p.data.todos.length,0);
 await p.onQuery({detail:{value:'学习'}});assert.equal(p.data.todos.length,1);
 p.setData({rangeActive:true,rangeStart:now,rangeEnd:now+172800000});await p.refresh();assert.equal(p.data.todos.length,0);
 await p.clearRange();assert.equal(p.data.todos.length,1);
 data.todos[0].dueAt=now+172800000;await p.refresh();assert.equal(p.data.todos.length,0);assert.equal(p.data.overdueCount,0);
 await p.onStatus({currentTarget:{dataset:{filter:'1'}}});assert.equal(p.data.todos.length,2);p.onUnload();
});
test('completing an overdue item and undoing returns it to the overdue tab',async()=>{
 const {c,p}=await setup();await c.store.saveTodo({title:'逾期事项',dueAt:Date.now()-86400000});
 await p.onStatus({currentTarget:{dataset:{filter:'3'}}});const id=p.data.todos[0].id;
 assert.equal(p.data.overdueCount,1);await p.toggle({currentTarget:{dataset:{id}}});assert.equal(p.data.todos.length,0);assert.equal(p.data.overdueCount,0);assert.equal(p.data.completed,1);
 await p.onStatus({currentTarget:{dataset:{filter:'2'}}});assert.equal(p.data.todos[0].id,id);
 await p.toggle({currentTarget:{dataset:{id}}});assert.equal(p.data.todos.length,0);assert.equal(p.data.overdueCount,1);
 await p.onStatus({currentTarget:{dataset:{filter:'1'}}});assert.equal(p.data.todos.length,0);
 await p.onStatus({currentTarget:{dataset:{filter:'3'}}});assert.equal(p.data.todos[0].id,id);p.onUnload();
});
test('overdue completion keeps its completion timestamp after cloud sync and is labelled late',async()=>{
 const {c,p}=await setup();await c.store.saveTodo({title:'逾期后完成',dueAt:Date.now()-86400000});
 await p.onStatus({currentTarget:{dataset:{filter:'3'}}});const id=p.data.todos[0].id;
 await p.toggle({currentTarget:{dataset:{id}}});assert.equal(p.data.todos.length,0);assert.equal(p.data.overdueCount,0);
 await c.sync.pull({force:true});await p.onStatus({currentTarget:{dataset:{filter:'2'}}});
 const item=p.data.todos[0];assert.equal(item.id,id);assert.equal(item.done,true);assert.equal(item.completedLate,true);assert.ok(item.doneAt>item.dueAt);assert.ok(item.completedText);assert.equal(item.overdue,false);
 assert.equal(c.store.read().todos[0].doneAt,item.doneAt);
 await p.toggle({currentTarget:{dataset:{id}}});await p.onStatus({currentTarget:{dataset:{filter:'3'}}});assert.equal(p.data.todos[0].completedLate,false);assert.equal(p.data.todos[0].completedText,'');assert.equal(c.store.read().todos[0].doneAt,undefined);p.onUnload();
});
test('on-time and legacy completions are not mislabelled as late based on current time',async()=>{
 const {c,p,data}=await setup();const now=Date.now();
 data.todos=[{id:'ontime',title:'按时',done:true,dueAt:now-1000,doneAt:now-2000,createdAt:0},{id:'legacy',title:'历史记录',done:true,dueAt:now-1000,createdAt:1},{id:'boundary',title:'准时',done:true,dueAt:now-1000,doneAt:now-1000,createdAt:2}];c.store.read=()=>data;
 await p.onStatus({currentTarget:{dataset:{filter:'2'}}});assert.equal(p.data.todos.length,3);
 for(const item of p.data.todos)assert.equal(item.completedLate,false);
 assert.equal(p.data.todos.find(item=>item.id==='legacy').completedText,'');p.onUnload();
});
test('search input returns no replacement value and supports typing, deletion and clearing',async()=>{
 const {c,p,data}=await setup(),now=Date.now();
 data.todos=[{id:'a',title:'整理书桌',dueAt:now+86400000,createdAt:1,done:false},{id:'b',title:'浇花',dueAt:now+86400000,createdAt:2,done:false}];c.store.read=()=>data;
 for(const [value,ids] of [['整',['a']],['整理',['a']],['整理书桌',['a']],['整',['a']],['', ['a','b']],['浇花',['b']]]){
  const result=p.onQuery({detail:{value}});assert.equal(result,undefined,'input handlers must not return refresh promises');
  await Promise.resolve();assert.equal(p.data.query,value);assert.deepEqual(Array.from(p.data.todos,item=>item.id),ids);
 }
 p.onUnload();
});
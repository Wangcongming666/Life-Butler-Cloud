const test=require('node:test'),assert=require('node:assert/strict');
const {MemoryRepository}=require('./helpers/memory-cloud.cjs'),{createService}=require('../cloudfunctions/lifeButler/service'),{createClient}=require('./helpers/client.cjs');
async function setup(options={}){const c=createClient(createService(new MemoryRepository()));await c.sync.start();const p=c.page('review');p.onLoad(options);await p.onShow();return {c,p};}
test('review defaults to the current week on each new page load',async()=>{
 const {c,p}=await setup();const journal=c.load('utils/journal.js'),today=journal.dayText();assert.equal(p.data.mode,'week');assert.equal(p.data.anchor,today);assert.deepEqual({...p.data.result.range},{...journal.period('week',today)});p.onUnload();
});
test('explicit monthly entry is preserved; switching to week opens the current week',async()=>{
 const {c,p}=await setup({month:'2024-02'});assert.equal(p.data.mode,'month');assert.equal(p.data.anchor,'2024-02-01');
 p.onMode({currentTarget:{dataset:{mode:'week'}}});assert.equal(p.data.mode,'week');assert.equal(p.data.anchor,c.load('utils/journal.js').dayText());
 p.onDate({detail:{value:'2024-02-15'}});assert.equal(p.data.anchor,'2024-02-15');p.onMode({currentTarget:{dataset:{mode:'week'}}});assert.equal(p.data.anchor,'2024-02-15');p.onUnload();
});
test('summary retains selected period and separates on-time and late completions',async()=>{
 const {c,p}=await setup({month:'2026-10'});const data=c.store.read();
 data.todos=[{id:'late',title:'逾期完成',done:true,dueAt:new Date(2026,9,18).getTime(),doneAt:new Date(2026,9,19).getTime(),createdAt:0},{id:'ontime',title:'按时完成',done:true,dueAt:new Date(2026,9,20).getTime(),doneAt:new Date(2026,9,19).getTime(),createdAt:0},{id:'old',title:'历史',done:true,dueAt:0,createdAt:0}];c.store.read=()=>data;
 p.onMode({currentTarget:{dataset:{mode:'summary'}}});await p.refresh();assert.equal(p.data.view,'summary');assert.equal(p.data.mode,'month');assert.equal(p.data.anchor,'2026-10-01');assert.equal(p.data.result.lateCompletedTodos,1);assert.equal(p.data.result.onTimeCompletedTodos,1);assert.equal(p.data.result.unknownCompleted,1);
 p.onSummaryMode({currentTarget:{dataset:{mode:'week'}}});assert.equal(p.data.view,'summary');assert.equal(p.data.mode,'week');assert.equal(p.data.anchor,c.load('utils/journal.js').dayText());p.onUnload();
});
test('monthly picker normalizes month-only values and summary copy includes late completion totals',async()=>{
 const {c,p}=await setup({month:'2026-10'});p.onDate({detail:{value:'2026-09'}});assert.equal(p.data.anchor,'2026-09-01');assert.equal(p.data.anchorLabel,'2026-09');
 p.onMode({currentTarget:{dataset:{mode:'summary'}}});let text;c.wx.setClipboardData=o=>text=o.data;p.copy();assert.match(text,/生活总结/);assert.match(text,/逾期完成/);p.onUnload();
});
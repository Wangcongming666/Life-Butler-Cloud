const test=require('node:test'),assert=require('node:assert/strict');
const {MemoryRepository}=require('./helpers/memory-cloud.cjs');
const {createService}=require('../cloudfunctions/lifeButler/service');
const {createClient}=require('./helpers/client.cjs');
async function setup(){
 const c=createClient(createService(new MemoryRepository()));await c.sync.start();
 const data=c.store.read();data.expenses=Array.from({length:45},(_,i)=>({id:'bill'+i,category:i%2?'交通':'餐饮',note:'',amountCents:i+1,createdAt:new Date(2024,1,29,12,i).getTime()}));
 data.expenses.push({id:'march',category:'其他',note:'',amountCents:200,createdAt:new Date(2024,2,1).getTime()});
 c.store.read=()=>data;
 const p=c.page('account');p.onLoad({});await p.onShow();return {c,p,data};
}
test('all months progressively render every bill while statistics cover the entire scope',async()=>{
 const {p}=await setup();assert.equal(p.data.showAll,true);assert.equal(p.data.expenses.length,20);assert.equal(p.data.monthCount,46);assert.equal(p.data.monthTotal,'12.35');
 await p.loadMore();assert.equal(p.data.expenses.length,40);await p.refresh();assert.equal(p.data.expenses.length,40);
 await p.loadMore();assert.equal(p.data.expenses.length,46);assert.equal(p.data.hasMore,false);await p.loadMore();assert.equal(new Set(p.data.expenses.map(e=>e.id)).size,46);
 assert.equal(p.data.expenses.filter(e=>e.showDay).length,2);p.onUnload();
});
test('month selection, empty months and data changes recalculate full monthly summaries',async()=>{
 const {p,data}=await setup();await p.onMonth({detail:{value:'2024-02'}});
 assert.equal(p.data.showAll,false);assert.equal(p.data.monthCount,45);assert.equal(p.data.expenses.length,20);assert.equal(p.data.monthTotal,'10.35');
 assert.equal(p.data.categoryStats.reduce((sum,e)=>sum+e.cents,0),1035);
 data.expenses[0].createdAt=new Date(2024,2,1).getTime();data.expenses.splice(1,1);await p.refresh();assert.equal(p.data.monthCount,43);assert.equal(p.data.monthTotal,'10.32');
 await p.onMonth({detail:{value:'2023-12'}});assert.equal(p.data.monthCount,0);assert.equal(p.data.monthTotal,'0.00');assert.equal(p.data.expenses.length,0);
 await p.onScope({detail:{value:true}});assert.equal(p.data.monthCount,45);assert.equal(p.data.expenses.length,20);p.onUnload();
});
test('monthly bill totals agree with existing review and include leap-day / year boundaries',async()=>{
 const {c,p,data}=await setup();const journal=c.load('utils/journal.js');
 for(const month of ['2024-02','2024-03','2023-12']){
  await p.onMonth({detail:{value:month}});const r=journal.review(data,'month',month+'-01');
  assert.equal(p.data.monthTotal,c.store.money(r.expenseCents));assert.equal(p.data.monthCount,r.expenseCount);
  assert.equal(r.days.reduce((sum,d)=>sum+d.amountCents,0),r.expenseCents);
  assert.equal(c.load('utils/life.js').budget(data,month).spent,r.expenseCents);
 }
 data.expenses=[{id:'dec',category:'其他',note:'',amountCents:10,createdAt:new Date(2024,11,31,23,59,59,999).getTime()},{id:'jan',category:'其他',note:'',amountCents:20,createdAt:new Date(2025,0,1).getTime()}];
 await p.onMonth({detail:{value:'2024-12'}});assert.equal(p.data.monthTotal,'0.10');await p.onMonth({detail:{value:'2025-01'}});assert.equal(p.data.monthTotal,'0.20');p.onUnload();
});
test('monthly review opens at the month chosen in the ledger',async()=>{
 const {c,p}=await setup();let url;c.wx.navigateTo=o=>url=o.url;await p.onMonth({detail:{value:'2024-02'}});p.openMonthlyReview();assert.equal(url,'/pages/review/index?month=2024-02');
 const review=c.page('review');review.onLoad({month:'2024-02'});await review.onShow();assert.equal(review.data.anchor,'2024-02-01');assert.equal(review.data.result.expenseText,'10.35');review.onUnload();p.onUnload();
 p.openBudget();assert.equal(url,'/pages/life/index?type=budget&month=2024-02');
 const budget=c.page('life');budget.onLoad({type:'budget',month:'2024-02'});await budget.onShow();assert.equal(budget.data.month,'2024-02');budget.onUnload();
});
test('confirmed cloud edits and deletions on the other device refresh the selected monthly bill',async()=>{
 const service=createService(new MemoryRepository()),a=createClient(service),b=createClient(service);
 await a.sync.start();await b.sync.start();const p=a.page('account');p.onLoad({});await p.onShow();await p.onMonth({detail:{value:'2024-02'}});
 await b.store.addExpense({amount:'0.10',category:'餐饮',note:'云端新增',createdAt:new Date(2024,1,29,23,59).getTime()});await a.sync.pull({force:true});await p.refresh();assert.equal(p.data.monthTotal,'0.10');assert.equal(p.data.monthCount,1);
 const id=b.store.read().expenses[0].id;await b.store.updateExpense(id,{amount:'0.20',category:'交通',note:'移到三月',createdAt:new Date(2024,2,1).getTime()});await a.sync.pull({force:true});await p.refresh();assert.equal(p.data.monthCount,0);
 await p.onMonth({detail:{value:'2024-03'}});assert.equal(p.data.monthTotal,'0.20');await b.store.removeExpense(id);await a.sync.pull({force:true});await p.refresh();assert.equal(p.data.monthTotal,'0.00');assert.equal(p.data.categoryStats.length,0);p.onUnload();
});

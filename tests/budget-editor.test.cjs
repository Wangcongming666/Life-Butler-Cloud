const test=require('node:test'),assert=require('node:assert/strict');
const {MemoryRepository}=require('./helpers/memory-cloud.cjs'),{createService}=require('../cloudfunctions/lifeButler/service'),{createClient}=require('./helpers/client.cjs');
async function setup(){const c=createClient(createService(new MemoryRepository()));await c.sync.start();const p=c.page('life');p.onLoad({type:'budget',month:'2026-10'});await p.onShow();return {c,p};}
test('budget editor opens with saved values and cancel discards draft',async()=>{
 const {c,p}=await setup();await c.store.saveBudget({month:'2026-10',total:'1000',categories:[{name:'餐饮',amount:'800'}]});await p.refresh();assert.equal(p.data.budgetFormVisible,false);
 p.openBudgetForm();assert.equal(p.data.budgetFormVisible,true);assert.equal(p.data.budgetTotal,'1000.00');p.onBudget({currentTarget:{dataset:{key:'budgetTotal'}},detail:{value:'2000'}});
 await p.refresh();assert.equal(p.data.budgetTotal,'2000');p.closeBudgetForm();assert.equal(p.data.budgetFormVisible,false);assert.equal(p.data.budgetTotal,'1000.00');assert.equal(p._budgetDirty,false);p.onUnload();
});
test('save closes budget editor; validation failure retains values and editor',async()=>{
 const {c,p}=await setup();p.openBudgetForm();p.onBudget({currentTarget:{dataset:{key:'budgetTotal'}},detail:{value:'1000'}});p.onBudget({currentTarget:{dataset:{key:'budgetLines'}},detail:{value:'错误格式'}});await p.saveBudget();assert.equal(p.data.budgetFormVisible,true);assert.equal(p.data.budgetBusy,false);assert.equal(p.data.budgetTotal,'1000');
 p.onBudget({currentTarget:{dataset:{key:'budgetLines'}},detail:{value:'餐饮 800'}});await p.saveBudget();assert.equal(p.data.budgetFormVisible,false);assert.equal(c.store.read().life.budgets[0].totalCents,100000);p.onUnload();
});
test('deletion cancellation retains editor; confirmed deletion closes editor and clears overview',async()=>{
 const {c,p}=await setup();await c.store.saveBudget({month:'2026-10',total:'1000',categories:[]});await p.refresh();p.openBudgetForm();await p.removeBudget();assert.equal(p.data.budgetBusy,true);p.closeBudgetForm();assert.equal(p.data.budgetFormVisible,true);
 await c.notices.at(-1).success({confirm:false});assert.equal(p.data.budgetBusy,false);assert.equal(p.data.budgetFormVisible,true);
 await p.removeBudget();await c.notices.at(-1).success({confirm:true});assert.equal(p.data.budgetFormVisible,false);assert.equal(p.data.budgetBusy,false);assert.equal(c.store.read().life.budgets.length,0);assert.equal(p.data.budgetView.totalText,'未设置');p.onUnload();
});
test('overallocated categories keep the budget dialog and draft open',async()=>{
 const {c,p}=await setup();p.openBudgetForm();p.onBudget({currentTarget:{dataset:{key:'budgetTotal'}},detail:{value:'1400'}});p.onBudget({currentTarget:{dataset:{key:'budgetLines'}},detail:{value:'餐饮 600\n学习 200\ncc 29999'}});await p.saveBudget();assert.equal(p.data.budgetFormVisible,true);assert.equal(p.data.budgetBusy,false);assert.equal(p.data.budgetTotal,'1400');assert.match(p.data.budgetLines,/29999/);assert.equal(c.store.read().life.budgets.length,0);assert.match(c.notices.at(-1).content,/分类预算合计/);p.closeBudgetForm();p.onUnload();
});
const test=require('node:test'),assert=require('node:assert/strict');
const {MemoryRepository}=require('./helpers/memory-cloud.cjs'),{createService}=require('../cloudfunctions/lifeButler/service'),{createClient}=require('./helpers/client.cjs');
async function setup(){const c=createClient(createService(new MemoryRepository()));await c.sync.start();const p=c.page('account');p.onLoad({});await p.onShow();return {c,p};}
test('ledger starts with editor closed; add, cancel and save use the modal',async()=>{
 const {c,p}=await setup();assert.equal(p.data.formVisible,false);p.openAdd();assert.equal(p.data.formVisible,true);assert.equal(p.data.editingId,'');assert.ok(p.data.date);
 p.setData({amount:'12.50',note:'午餐'});p.closeForm();assert.equal(p.data.formVisible,false);assert.equal(c.store.read().expenses.length,0);
 p.openAdd();assert.equal(p.data.amount,'');p.setData({amount:'12.50',note:'午餐'});await p.save();assert.equal(p.data.formVisible,false);assert.equal(c.store.read().expenses[0].amountCents,1250);assert.equal(p.data.monthCount,1);p.onUnload();
});
test('editing opens the modal and preserves original accounting seconds',async()=>{
 const {c,p}=await setup();const createdAt=new Date(2026,9,19,12,30,15,123).getTime();await c.store.addExpense({amount:'10',category:'交通',note:'公交',createdAt});const id=c.store.read().expenses[0].id;
 await p.openEdit({currentTarget:{dataset:{id}}});assert.equal(p.data.formVisible,true);assert.equal(p.data.note,'公交');p.setData({amount:'20'});await p.save();assert.equal(p.data.formVisible,false);assert.equal(c.store.read().expenses[0].createdAt,createdAt);assert.equal(c.store.read().expenses[0].amountCents,2000);p.onUnload();
});
test('saving prevents duplicate clicks and closing; cloud failure retains the draft',async()=>{
 const {c,p}=await setup();p.openAdd();p.setData({amount:'5',note:'草稿'});const original=c.store.addExpense;let release,calls=0;
 c.store.addExpense=async()=>{calls++;await new Promise(resolve=>release=resolve);throw Error('断网');};
 const pending=p.save();assert.equal(p.data.saving,true);p.closeForm();assert.equal(p.data.formVisible,true);await p.save();assert.equal(calls,1);release();await pending;
 assert.equal(p.data.saving,false);assert.equal(p.data.formVisible,true);assert.equal(p.data.amount,'5');assert.equal(p.data.note,'草稿');c.store.addExpense=original;p.onUnload();
});
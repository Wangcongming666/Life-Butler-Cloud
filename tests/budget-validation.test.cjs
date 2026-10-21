const test=require('node:test'),assert=require('node:assert/strict');
const life=require('../miniprogram/utils/life');
const {MemoryRepository}=require('./helpers/memory-cloud.cjs'),{createService}=require('../cloudfunctions/lifeButler/service'),{createClient}=require('./helpers/client.cjs');
test('allocation uses integer cents and accepts exact totals, zero and unallocated amounts',()=>{
 for(const [totalCents,values] of [[30,[10,20]],[0,[0]],[10000,[6000,2000]]])assert.doesNotThrow(()=>life.validateBudget({month:'2026-10',totalCents,categories:values.map((cents,i)=>({name:'分类'+i,cents}))}));
 assert.throws(()=>life.validateBudget({month:'2026-10',totalCents:30,categories:[{name:'餐饮',cents:31}]}),/分类预算合计/);
 for(const cents of [-1,1.5,NaN,1000000000])assert.throws(()=>life.validateBudget({month:'2026-10',totalCents:100,categories:[{name:'餐饮',cents}]}));
});
test('rejected budget save preserves existing budget and expense records',async()=>{
 const c=createClient(createService(new MemoryRepository()));await c.sync.start();await c.store.saveBudget({month:'2026-10',total:'1400',categories:[{name:'餐饮',amount:'600'},{name:'学习',amount:'200'}]});const before=JSON.stringify(c.store.read());
 await assert.rejects(c.store.saveBudget({month:'2026-10',total:'1400',categories:[{name:'餐饮',amount:'600'},{name:'学习',amount:'200'},{name:'cc',amount:'29999'}]}),/分类预算合计/);assert.equal(JSON.stringify(c.store.read()),before);
 await c.store.saveBudget({month:'2026-11',total:'0.30',categories:[{name:'a',amount:'0.10'},{name:'b',amount:'0.20'}]});assert.equal(c.store.read().life.budgets.at(-1).totalCents,30);
});
test('cloud rejects overallocated budget writes even when client validation is bypassed',async()=>{
 const repo=new MemoryRepository(),service=createService(repo);const result=await service('user',{action:'commit',operationId:'invalidbudget',generation:'g0',changes:[{kind:'budgets',id:'2026-10',expectedVersion:0,value:{month:'2026-10',totalCents:100,categories:[{name:'餐饮',cents:101}]}}]});assert.equal(result.ok,false);assert.equal(result.code,'INVALID_DATA');assert.match(result.message,/分类预算合计/);assert.equal((await repo.load('user')).records.length,0);
});
test('legacy overallocated budget remains readable and can be corrected without blocking other writes',async()=>{
 const repo=new MemoryRepository();repo.users.set('user',{meta:{generation:'g0',revision:1},records:[{kind:'budgets',id:'2026-10',version:1,deleted:false,value:{month:'2026-10',totalCents:100,categories:[{name:'餐饮',cents:101}]}}]});
 const c=createClient(createService(repo));await c.sync.start();assert.equal(c.store.read().life.budgets[0].categories[0].cents,101);await c.store.addExpense({amount:'1',category:'餐饮',note:''});await c.store.saveBudget({month:'2026-10',total:'2',categories:[{name:'餐饮',amount:'1.01'}]});assert.equal(c.store.read().life.budgets[0].totalCents,200);
});
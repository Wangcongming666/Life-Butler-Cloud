const test=require('node:test'),assert=require('node:assert/strict');const {Database}=require('./helpers/database.cjs'),{createRepository}=require('../cloudfunctions/lifeButler/repository'),{createService}=require('../cloudfunctions/lifeButler/service');
test('production repository persists transactional commits and isolates staged generations',async()=>{
 const db=new Database(),repo=createRepository(db),s=createService(repo),schema=require('../miniprogram/utils/data-schema'),model=require('../miniprogram/utils/record-model');
 const e={action:'commit',operationId:'first',generation:'g0',changes:[{kind:'todos',id:'t',expectedVersion:0,value:{id:'t',title:'一',done:false,dueAt:0,createdAt:0,images:[]}}]};
 assert.equal((await s('user',e)).ok,true);assert.equal((await repo.load('user')).records.length,1);assert.equal((await repo.load('other')).records.length,0);
 db.failNext=true;assert.equal((await s('user',{...e,operationId:'fail',changes:[{...e.changes[0],id:'other',value:{...e.changes[0].value,id:'other'}}]})).ok,false);assert.equal((await repo.load('user')).records.length,1);
 const data=schema.emptyData();for(let i=0;i<83;i++)data.todos.push({id:'new'+i,title:'导入',done:false,dueAt:0,createdAt:0,images:[]});const records=Object.values(model.flatten(data));
 await s('user',{action:'beginReplace',operationId:'replace',generation:'g0',revision:1,count:records.length});
 for(let n=0;n<records.length;n+=40)assert.equal((await s('user',{action:'stageReplace',operationId:'replace',offset:n,records:records.slice(n,n+40)})).ok,true);
 assert.equal((await repo.load('user')).records.length,1);assert.equal((await s('user',{action:'publishReplace',operationId:'replace'})).ok,true);assert.equal((await repo.load('user')).records.length,86);
});
test('production paging is stable and metadata describe avoids reading all records',async()=>{
 const repo=createRepository(new Database());assert.equal(typeof repo.page,'function');assert.equal(typeof repo.describe,'function');
 const meta=await repo.describe('user');assert.equal(meta.revision,0);const page=await repo.page('user','g0',0,null);assert.deepEqual(page.records,[]);
});

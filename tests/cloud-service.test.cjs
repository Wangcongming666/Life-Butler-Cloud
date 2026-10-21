const test=require('node:test'),assert=require('node:assert/strict');
const {MemoryRepository}=require('./helpers/memory-cloud.cjs');
const {createService}=require('../cloudfunctions/lifeButler/service');
const todo=(id,title='记录')=>({id,title,done:false,dueAt:0,createdAt:0,images:[]});
const change=(id,title,v=0)=>({kind:'todos',id,expectedVersion:v,value:todo(id,title)});
test('identity, independent changes, conflicts and tombstones',async()=>{
 const repo=new MemoryRepository(),s=createService(repo);assert.equal((await s(null,{action:'describe'})).code,'UNAUTHENTICATED');
 assert.equal((await s('a',{action:'commit',operationId:'one',generation:'g0',changes:[change('1','手机')]})).ok,true);
 assert.equal((await s('a',{action:'commit',operationId:'two',generation:'g0',changes:[change('2','PC')]})).ok,true);
 assert.equal((await s('a',{action:'commit',operationId:'stale',generation:'g0',changes:[change('1','旧表单',0)]})).code,'CONFLICT');
 assert.equal((await s('b',{action:'pull',generation:'g0',revision:0})).records.length,0);
 assert.equal((await s('a',{action:'commit',operationId:'del',generation:'g0',changes:[{kind:'todos',id:'1',expectedVersion:1,value:null}]})).ok,true);
 assert.equal((await s('a',{action:'commit',operationId:'revive',generation:'g0',changes:[change('1','复活')]})).code,'CONFLICT');
});
test('idempotency, payload validation and consistent pages',async()=>{
 const repo=new MemoryRepository(),s=createService(repo),event={action:'commit',operationId:'same',generation:'g0',changes:[change('1','a')]};
 const a=await s('a',event);assert.deepEqual(await s('a',event),a);assert.equal((await repo.load('a')).meta.revision,1);
 assert.equal((await s('a',{...event,changes:[change('1','other')]})).code,'INVALID_DATA');
 assert.equal((await s('a',{action:'pull',generation:'g0',revision:0})).code,'SNAPSHOT_CHANGED');
 assert.equal((await s('a',{action:'operation',operationId:'same'})).operation.result.ok,true);
 assert.equal((await s('a',{action:'commit',operationId:'bad',generation:'g0',changes:[{...change('3',''),value:todo('3','')}]})).code,'INVALID_DATA');
 assert.equal((await repo.load('a')).records.length,1);
});
test('staged replacement is invisible until publication and detects concurrent writes',async()=>{
 const repo=new MemoryRepository(),s=createService(repo),model=require('../miniprogram/utils/record-model'),schema=require('../miniprogram/utils/data-schema');
 const data=schema.emptyData();data.todos=[todo('restored')];const rows=Object.values(model.flatten(data));
 assert.equal((await s('a',{action:'beginReplace',operationId:'restore',generation:'g0',revision:0,count:rows.length})).ok,true);
 assert.equal((await s('a',{action:'stageReplace',operationId:'restore',offset:0,records:rows})).ok,true);
 assert.equal((await repo.load('a')).records.length,0);
 await s('a',{action:'commit',operationId:'interleave',generation:'g0',changes:[change('new','不可丢失')]});
 assert.equal((await s('a',{action:'publishReplace',operationId:'restore'})).code,'CONFLICT');
 const begin={action:'beginReplace',operationId:'second',generation:'g0',revision:1,count:rows.length};await s('a',begin);
 await s('a',{action:'stageReplace',operationId:'second',offset:0,records:rows});
 const result=await s('a',{action:'publishReplace',operationId:'second'});assert.equal(result.ok,true);assert.deepEqual(await s('a',{action:'publishReplace',operationId:'second'}),result);
 assert.equal((await repo.load('a')).records[0].kind!==undefined,true);
});

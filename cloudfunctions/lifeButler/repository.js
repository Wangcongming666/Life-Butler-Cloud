const {digest}=require('./service');
const model=require('./shared/record-model');
const conflict=()=>Object.assign(Error('数据同时更新，请重试'),{code:'CONFLICT'});
const docId=(...parts)=>digest(parts);
const strip=row=>{const r={...row};delete r._id;delete r.owner;delete r.generation;delete r.ordinal;return r;};
function createRepository(db){
 const ref=(name,id)=>db.collection(name).doc(id);
 const userId=owner=>docId(owner);
 async function get(name,id,tx){const result=await (tx?tx.collection(name).doc(id):ref(name,id)).get();return result.data||null;}
 async function all(owner,generation){
  const out=[];let last='';for(;;){
   const where={owner,generation};if(last)where._id=db.command.gt(last);
   const result=await db.collection('life_records').where(where).orderBy('_id','asc').limit(100).get();
   out.push(...result.data);if(result.data.length<100)break;last=result.data[result.data.length-1]._id;
  }return out;
 }
 async function metadata(owner){return await get('life_users',userId(owner))||{generation:'g0',revision:0};}
 async function describe(owner){const meta=await metadata(owner);return {generation:meta.generation,revision:meta.revision};}
 async function page(owner,generation,revision,cursor){
  const before=await metadata(owner);if(before.generation!==generation||before.revision!==revision)throw Object.assign(Error('数据已更新，请重新同步'),{code:'SNAPSHOT_CHANGED'});
  if(cursor!==null&&cursor!==undefined&&cursor!==0&&(typeof cursor!=='string'||!/^[a-f0-9]{64}$/.test(cursor)))throw Object.assign(Error('分页游标无效'),{code:'INVALID_DATA'});
  const condition={owner,generation};if(cursor)condition._id=db.command.gt(cursor);
  const result=await db.collection('life_records').where(condition).orderBy('_id','asc').limit(50).get();
  const records=[];let bytes=0;for(const row of result.data){const clean=strip(row),size=Buffer.byteLength(JSON.stringify(clean));if(records.length&&bytes+size>256*1024)break;records.push(clean);bytes+=size;}
  const after=await metadata(owner);if(after.revision!==revision||after.generation!==generation)throw Object.assign(Error('数据已更新，请重新同步'),{code:'SNAPSHOT_CHANGED'});
  const more=records.length<result.data.length||result.data.length===50;
  return {ok:true,generation,revision,records,nextCursor:more?result.data[records.length-1]._id:null};
 }
 async function load(owner){
  for(let attempt=0;attempt<3;attempt++){
   const a=await metadata(owner),rows=await all(owner,a.generation),b=await metadata(owner);
   if(a.revision===b.revision&&a.generation===b.generation)return {meta:{generation:a.generation,revision:a.revision},records:rows.map(strip)};
  }throw Object.assign(Error('云端数据持续变化，请重新同步'),{code:'SNAPSHOT_CHANGED'});
 }
 async function operation(owner,id){if(typeof id!=='string')return null;const row=await get('life_operations',docId(owner,id));return row?strip(row):null;}
 async function apply(owner,revision,update){
  const current=await load(owner),old=new Map(current.records.map(r=>[model.key(r.kind,r.id),r]));
  const changed=update.replacementId?[]:update.records.filter(r=>!model.equal(old.get(model.key(r.kind,r.id)),r));
  return db.runTransaction(async tx=>{
   const previous=await get('life_users',userId(owner),tx);if((previous?previous.revision:0)!==revision)throw conflict();
   if(update.operation){const done=await get('life_operations',docId(owner,update.operation.id),tx);if(done)throw conflict();}
   if(update.replacementId){const manifest=await get('life_imports',docId(owner,update.replacementId),tx);if(!manifest||!manifest.sealed)throw conflict();}
   for(const row of changed)await tx.collection('life_records').doc(docId(owner,update.meta.generation,row.kind,row.id)).set({data:{...row,owner,generation:update.meta.generation}});
   await tx.collection('life_users').doc(userId(owner)).set({data:{...update.meta,owner}});
   if(update.operation)await tx.collection('life_operations').doc(docId(owner,update.operation.id)).set({data:{...update.operation,owner,createdAt:Date.now()}});
   return update.meta;
  });
 }
 async function getImport(owner,id){
  const stage=await get('life_imports',docId(owner,id));if(!stage)return null;
  const generation='g_'+digest([owner,id]).slice(0,30),rows=await all(owner,generation);
  return {...strip(stage),generation:stage.generation,records:rows.sort((a,b)=>a.ordinal-b.ordinal).map(r=>({kind:r.kind,id:r.id,value:r.value}))};
 }
 async function saveImport(owner,id,value,expected){
  const generation='g_'+digest([owner,id]).slice(0,30);
  await db.runTransaction(async tx=>{
   const old=await get('life_imports',docId(owner,id),tx);if(expected===null?!!old:!old||old.stageVersion!==expected)throw conflict();
   const oldCount=old?old.received:0;
   for(let n=oldCount;n<value.records.length;n++){
    const row=value.records[n];await tx.collection('life_records').doc(docId(owner,generation,row.kind,row.id)).set({data:{...row,owner,generation,version:1,deleted:false,ordinal:n}});
   }
   const manifest={...value,owner,received:value.records.length};delete manifest.records;
   await tx.collection('life_imports').doc(docId(owner,id)).set({data:manifest});
  });
 }
 return {load,describe,page,operation,apply,getImport,saveImport};
}
module.exports={createRepository};

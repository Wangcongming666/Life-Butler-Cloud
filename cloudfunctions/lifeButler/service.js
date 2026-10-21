const crypto=require('node:crypto');
const schema=require('./shared/data-schema'),model=require('./shared/record-model'),life=require('./shared/life');
const {ENV}=require('./environment');
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(v);
const imageAllowed=owner=>p=>typeof p==='string'&&p.startsWith('cloud://'+ENV+'.')&&p.includes('/life-butler/'+owner+'/')&&!p.includes('..');
function checkRows(rows,owner){
 const keys=new Set();for(const r of rows){
  if(!r||!(model.paths[r.kind]||['preferences','term','timer'].includes(r.kind))||!identifier(r.id))fail('INVALID_DATA','记录类型或编号无效');
  if(!model.paths[r.kind]&&r.id!=='singleton')fail('INVALID_DATA','单例编号错误');
  if(keys.has(model.key(r.kind,r.id)))fail('INVALID_DATA','记录编号重复');keys.add(model.key(r.kind,r.id));
  if(Buffer.byteLength(JSON.stringify(r))>128*1024)fail('LIMIT_EXCEEDED','单条记录超过128KiB，请减少内容');
  if(r.value!==null&&model.paths[r.kind]&&(r.kind==='budgets'?r.value.month:r.value.id)!==r.id)fail('INVALID_DATA','记录编号与内容不符');
 }
 const live=rows.filter(r=>!r.deleted);
 try{schema.validate(model.hydrate(live),imageAllowed(owner));}catch(e){if(!e.code)e.code='INVALID_DATA';throw e;}
}
function checkBudgetAllocations(rows) {
 try { for (const row of rows) if (row.kind === 'budgets' && row.value !== null && !row.deleted) life.validateBudget(row.value); }
 catch (error) { error.code = 'INVALID_DATA'; throw error; }
}
function createService(repo){return async(owner,event)=>{
 try{
  if(!owner||!identifier(owner))fail('UNAUTHENTICATED','请从已关联的微信小程序调用');
  if(!event||typeof event.action!=='string')fail('INVALID_DATA','请求格式错误');
  if(Buffer.byteLength(JSON.stringify(event))>300*1024)fail('LIMIT_EXCEEDED','请求过大，请减少本次修改内容');
  const action=event.action;
  if(action==='operation')return {ok:true,operation:await repo.operation(owner,event.operationId)};
  if(action==='describe'){const meta=repo.describe?await repo.describe(owner):(await repo.load(owner)).meta;return {ok:true,openid:owner,...meta};}
  if(action==='pull'){
   if(repo.page)return await repo.page(owner,event.generation,event.revision,event.cursor);
   const state=await repo.load(owner);if(event.generation!==state.meta.generation||event.revision!==state.meta.revision)fail('SNAPSHOT_CHANGED','数据已更新，正在重新拉取');
   const sorted=state.records.slice().sort((a,b)=>model.key(a.kind,a.id).localeCompare(model.key(b.kind,b.id),'en'));
   const offset=event.cursor===undefined?0:Number(event.cursor);if(!Number.isSafeInteger(offset)||offset<0||offset>sorted.length)fail('INVALID_DATA','分页游标无效');
   const records=[];let size=0;for(let i=offset;i<sorted.length&&records.length<50;i++){
    const next=Buffer.byteLength(JSON.stringify(sorted[i]));if(size+next>256*1024&&records.length)break;records.push(sorted[i]);size+=next;
   }
   const next=offset+records.length;return {ok:true,...state.meta,records,nextCursor:next<sorted.length?next:null};
  }
  if(!identifier(event.operationId))fail('INVALID_DATA','缺少有效操作编号');
  if(action==='beginReplace'){
   if(!Number.isInteger(event.count)||event.count<3||event.count>20000)fail('LIMIT_EXCEEDED','导入需包含完整设置，且最多20000条记录');
   const old=await repo.getImport(owner,event.operationId);const request={generation:event.generation,revision:event.revision,count:event.count};
   if(old){if(old.requestHash!==digest(request))fail('INVALID_DATA','操作编号不能重复用于不同导入');return {ok:true};}
   const state=await repo.load(owner);if(state.meta.generation!==event.generation||state.meta.revision!==event.revision)fail('CONFLICT','其他设备已更新，请重新预览导入');
   await repo.saveImport(owner,event.operationId,{...request,requestHash:digest(request),records:[],stageVersion:0,sealed:false},null);return {ok:true};
  }
  if(action==='stageReplace'){
   const stage=await repo.getImport(owner,event.operationId);if(!stage)fail('INVALID_DATA','请先开始导入');
   if(!Array.isArray(event.records)||!event.records.length||event.records.length>40||!Number.isInteger(event.offset)||event.offset<0)fail('INVALID_DATA','导入分片无效');
   if(event.offset<stage.records.length){if(!model.equal(stage.records.slice(event.offset,event.offset+event.records.length),event.records))fail('INVALID_DATA','重复分片内容不一致');return {ok:true};}
   if(stage.sealed||event.offset!==stage.records.length||stage.records.length+event.records.length>stage.count)fail('INVALID_DATA','导入顺序或数量不正确');
   // 部分批次尚不完整，只检查类型和大小；发布前进行完整业务校验。
   for(const r of event.records){if(!r||!identifier(r.id)||!(model.paths[r.kind]||['term','timer','preferences'].includes(r.kind))||Buffer.byteLength(JSON.stringify(r))>128*1024)fail('INVALID_DATA','导入记录格式错误');}
   const previous=stage.stageVersion;stage.records.push(...event.records);stage.stageVersion++;await repo.saveImport(owner,event.operationId,stage,previous);return {ok:true};
  }
  if(action==='publishReplace'){
   const done=await repo.operation(owner,event.operationId);if(done){if(done.type!=='replace')fail('INVALID_DATA','操作编号已被占用');return done.result;}
   let stage=await repo.getImport(owner,event.operationId);if(!stage||stage.records.length!==stage.count)fail('INVALID_DATA','导入尚未完整上传');
   if(!stage.sealed){const previous=stage.stageVersion;stage.sealed=true;stage.stageVersion++;await repo.saveImport(owner,event.operationId,stage,previous);}
   checkRows(stage.records,owner);checkBudgetAllocations(stage.records);
   const generation='g_'+digest([owner,event.operationId]).slice(0,30),state=await repo.load(owner);
   if(state.meta.generation!==stage.generation||state.meta.revision!==stage.revision)fail('CONFLICT','其他设备已有新修改，请重新预览导入');
   const meta={generation,revision:state.meta.revision+1},result={ok:true,...meta};
   await repo.apply(owner,state.meta.revision,{meta,records:stage.records.map(r=>({...r,version:1,deleted:false})),operation:{id:event.operationId,type:'replace',result},replacementId:event.operationId});return result;
  }
  if(action!=='commit')fail('INVALID_DATA','未知操作');
  if(!Array.isArray(event.changes)||!event.changes.length||event.changes.length>40)fail('LIMIT_EXCEEDED','单次修改最多40条');
  const hash=digest({generation:event.generation,changes:event.changes}),done=await repo.operation(owner,event.operationId);
  if(done){if(done.hash!==hash)fail('INVALID_DATA','操作编号不能用于不同请求');return done.result;}
  // 元数据级并发冲突可重新读取并保留不同记录的独立修改。
  for(let attempt=0;attempt<3;attempt++){
   const state=await repo.load(owner);if(state.meta.generation!==event.generation)fail('CONFLICT','数据已被导入或清空，请刷新后重试');
   const rows=new Map(state.records.map(r=>[model.key(r.kind,r.id),r])),seen=new Set();
   for(const c of event.changes){
    if(!c||!identifier(c.id)||!Number.isInteger(c.expectedVersion)||c.expectedVersion<0)fail('INVALID_DATA','修改格式错误');
    const key=model.key(c.kind,c.id);if(seen.has(key))fail('INVALID_DATA','不能重复修改同一条记录');seen.add(key);
    const previous=rows.get(key);if((previous?previous.version:0)!==c.expectedVersion)fail('CONFLICT','这条记录已被另一端修改，请刷新后重新编辑');
    if(c.value===null&&['term','preferences','timer'].includes(c.kind))fail('INVALID_DATA','不能删除系统设置');
    const next={kind:c.kind,id:c.id,value:c.value,deleted:c.value===null,version:c.expectedVersion+1};
    if(c.kind==='todos'){
     const invalidated=previous&&(previous.deleted||c.value===null||previous.value.dueAt!==c.value.dueAt||previous.value.done!==c.value.done);
     next.reminderEpoch=(previous&&previous.reminderEpoch||0)+(invalidated?1:0);
    }
    rows.set(key,next);
   }
   const records=Array.from(rows.values());checkRows(records,owner);checkBudgetAllocations(event.changes);
   const meta={...state.meta,revision:state.meta.revision+1},result={ok:true,...meta};
   try{await repo.apply(owner,state.meta.revision,{meta,records,operation:{id:event.operationId,type:'commit',hash,result}});return result;}
   catch(e){if(e.code!=='CONFLICT'||attempt===2)throw e;const retry=await repo.operation(owner,event.operationId);if(retry){if(retry.hash!==hash)fail('INVALID_DATA','操作编号冲突');return retry.result;}}
  }
 }catch(e){
  // 原请求可能恰好在预查后提交；任何失败出口都先确认本操作是否已经成功。
  if(identifier(owner)&&event&&identifier(event.operationId)&&['commit','publishReplace'].includes(event.action)){
   try{const done=await repo.operation(owner,event.operationId);if(done){
    const matches=event.action==='publishReplace'?done.type==='replace':done.type==='commit'&&done.hash===digest({generation:event.generation,changes:event.changes});
    if(matches)return done.result;
   }}catch(lookupError){/* 无法确认时保留原错误；客户端仍可按操作ID查询。 */}
  }
  return {ok:false,code:e.code||'NETWORK',message:e.message||'云端操作失败，请同步确认提交结果'};
 }
};}
module.exports={createService,imageAllowed,digest};

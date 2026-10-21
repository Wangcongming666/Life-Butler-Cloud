const model=require('./record-model'),schema=require('./data-schema'),cloud=require('./cloud');
function error(code,message){return Object.assign(Error(message),{code});}
function createSync(options){
 const call=options.call,listeners=new Set(),checkouts=new WeakMap();
 let snapshot=null,versions={},meta=null,openid='',queue=Promise.resolve(),pending=null,edit={},pulling=null,loadedPendingOwner='',lastChanges=[];
 let state={status:'loading',ready:false,lastSyncedAt:0,error:'',cacheWarning:''};
 const emit=()=>listeners.forEach(fn=>{try{fn({...state});}catch(e){console.error(e);}});
 const status=(patch)=>{state={...state,...patch};emit();};
 const run=work=>{const next=queue.then(work);queue=next.catch(()=>{});return next;};
 async function request(action,payload){const r=await call(action,payload||{});if(!r||!r.ok)throw error(r&&r.code||'NETWORK',r&&r.message||'云端返回异常');return r;}
 const opId=()=>Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,12);
 function cache(){try{if(options.saveCache)options.saveCache(openid,{data:snapshot,versions,meta});}catch(e){state.cacheWarning='云端已保存，本机缓存写入失败';}}
 function remember(value){
  if(options.savePending){if(value)options.savePending(openid,value);else try{options.savePending(openid,null);}catch(e){state.cacheWarning='云端已确认，本机待确认缓存清理失败';}}
  pending=value;
 }
 async function resolvePending(){
  if(!pending)return;
  let known;
  try{known=await request('operation',{operationId:pending.payload.operationId});}
  catch(e){throw error('PENDING_CONFIRMATION','上次提交结果尚未确认，请联网后点击立即同步');}
  let result=known.operation&&known.operation.result;
  if(!known.operation){
   try{result=await request(pending.action,pending.payload);}
   catch(e){if(e.code==='NETWORK'||!e.code)throw error('PENDING_CONFIRMATION','提交结果尚未确认，请联网后同步，勿重复保存');remember(null);throw e;}
  }
  remember(null);
  return result;
 }
 async function load(force){
  status({status:'syncing',error:''});
  for(let attempt=0;attempt<3;attempt++){
   try{
    const description=await request('describe');
    if(openid&&openid!==description.openid){snapshot=null;versions={};meta=null;edit={};pending=null;loadedPendingOwner='';state.ready=false;}
    openid=description.openid;
    if(!pending&&options.loadPending&&loadedPendingOwner!==openid){loadedPendingOwner=openid;pending=options.loadPending(openid)||null;}
    if(pending){await resolvePending();continue;}
    if(!snapshot&&options.loadCache){try{const saved=options.loadCache(openid);if(saved&&saved.data){schema.validate(saved.data);snapshot=model.clone(saved.data);versions=saved.versions;meta=saved.meta;state.ready=true;emit();}}catch(e){/* 不信任损坏缓存，不覆盖云数据。 */}}
    if(!force&&snapshot&&meta&&meta.generation===description.generation&&meta.revision===description.revision){status({ready:true,status:'synced',lastSyncedAt:Date.now(),error:''});return read();}
    let cursor=0,rows=[];
    do{const page=await request('pull',{generation:description.generation,revision:description.revision,cursor});rows=rows.concat(page.records);cursor=page.nextCursor;}while(cursor!==null);
    const next=model.hydrate(rows);schema.validate(next);
    snapshot=next;versions={};rows.forEach(r=>{versions[model.key(r.kind,r.id)]=r.version;});meta={generation:description.generation,revision:description.revision};
    cache();status({ready:true,status:'synced',lastSyncedAt:Date.now(),error:''});return read();
   }catch(e){if(e.code==='SNAPSHOT_CHANGED'&&attempt<2)continue;throw e;}
  }
  throw error('NETWORK','云数据持续变化，请稍后同步');
 }
 function read(){if(!snapshot||!state.ready)throw error('NOT_READY','云数据正在加载，请稍后重试');const copy=model.clone(snapshot);checkouts.set(copy,{before:model.flatten(snapshot),versions:{...versions},...meta});return copy;}
 function pull(options){if(pulling)return pulling;pulling=run(()=>load(options&&options.force)).catch(e=>{status({status:'error',error:e.message});throw e;}).finally(()=>{pulling=null;});return pulling;}
 async function submit(action,payload){
  remember({action,payload});
  try{const result=await request(action,payload);remember(null);return result;}
  catch(e){if(e.code==='NETWORK'||!e.code){return await resolvePending();}else{remember(null);throw e;}}
 }
 async function replace(data,base){
  const records=Object.values(model.flatten(data)),operationId=opId();
  await request('beginReplace',{operationId,generation:base.generation,revision:base.revision,count:records.length});
  let offset=0;while(offset<records.length){
   const batch=[];let length=0;while(offset+batch.length<records.length&&batch.length<40){const row=records[offset+batch.length],bytes=JSON.stringify(row).length*3;if(length+bytes>240*1024&&batch.length)break;batch.push(row);length+=bytes;}
   await request('stageReplace',{operationId,offset,records:batch});offset+=batch.length;
  }
  await submit('publishReplace',{operationId});
 }
 function commit(data,context){
  const base=checkouts.get(data)||context;
  return run(async()=>{
   if(!base||!snapshot||!state.ready)throw error('NOT_READY','请先同步云数据后再保存');
   const identity=await request('describe');
   if(identity.openid!==openid){snapshot=null;versions={};meta=null;pending=null;edit={};loadedPendingOwner='';state.ready=false;throw error('UNAUTHENTICATED','微信账号已变化，请先重新同步再保存');}
   if(pending)await resolvePending();schema.validate(data);status({status:'syncing',error:''});
   const changes=model.diff(base.before||model.flatten(snapshot),model.flatten(data),base.versions||versions);
   lastChanges=model.clone(changes);
   changes.forEach(c=>{const token=!(context&&context.replace)&&edit[model.key(c.kind,c.id)];if(token){if(token.generation!==base.generation)throw error('CONFLICT','数据已更新，请重新打开编辑');c.expectedVersion=token.expectedVersion;}});
   let acknowledgement;
   if(changes.length){
    if((context&&context.replace)||changes.length>40||JSON.stringify(changes).length*3>240*1024){
     // 大批量替换需严格基于完整快照，不能将并发更新覆盖掉。
     if(!(context&&context.replace)&&Object.keys(edit).length&&changes.some(c=>edit[model.key(c.kind,c.id)]&&edit[model.key(c.kind,c.id)].expectedVersion!==(base.versions||versions)[model.key(c.kind,c.id)]))throw error('CONFLICT','编辑内容已过期，请重新打开');
     await replace(data,base);
    }else acknowledgement=await submit('commit',{operationId:opId(),generation:base.generation,changes});
   }
   changes.forEach(c=>delete edit[model.key(c.kind,c.id)]);
   // 连续版本的单次确认已足够更新快照；版本有跳跃时仍完整拉取，保留其他端的修改。
   if(context&&context.fast&&acknowledgement&&acknowledgement.generation===meta.generation&&acknowledgement.revision===meta.revision+1){
    const records=model.flatten(snapshot),nextVersions={...versions};
    changes.forEach(c=>{const key=model.key(c.kind,c.id);if(c.value===null)delete records[key];else records[key]={kind:c.kind,id:c.id,value:model.clone(c.value)};nextVersions[key]=c.expectedVersion+1;});
    const next=model.hydrate(records);schema.validate(next);snapshot=next;versions=nextVersions;meta={generation:acknowledgement.generation,revision:acknowledgement.revision};
    cache();status({ready:true,status:'synced',lastSyncedAt:Date.now(),error:''});return model.clone(data);
   }
   // 提交已确认后再拉取；拉取失败只提示刷新失败，不把成功提交报告为失败。
   try{await load();}catch(e){state.ready=!!snapshot;status({status:'error',error:'云端已保存，刷新失败，请立即同步'});}
   return model.clone(data);
  }).catch(e=>{status({status:'error',error:e.message});throw e;});
 }
 function beginEdit(kind,id){if(!meta)throw error('NOT_READY','请等待云数据加载');const token={openid,generation:meta.generation,kind,id,expectedVersion:versions[model.key(kind,id)]||0};edit[model.key(kind,id)]=token;return token;}
 function endEdit(tokens){if(!tokens){edit={};return;}Object.keys(tokens).forEach(k=>{if(model.equal(edit[k],tokens[k]))delete edit[k];});}
 function restoreEdit(tokens){Object.keys(tokens||{}).forEach(k=>{if(tokens[k].openid===openid)edit[k]=tokens[k];});}
 return {start:pull,pull,read,commit,beginEdit,endEdit,restoreEdit,hasPending:()=>!!pending,pendingChanges:()=>model.clone(lastChanges),getState:()=>({...state,openid}),subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},stop(){listeners.clear();},owner:()=>openid,metadata:()=>({...meta})};
}
let singleton;
function getDefault(){
 if(!singleton){const key=(owner,suffix)=>'life_cloud:'+cloud.ENV+':'+cloud.APPID+':'+owner+':'+suffix;
  singleton=createSync({call:cloud.call,saveCache:(o,v)=>wx.setStorageSync(key(o,'cache'),v),loadCache:o=>wx.getStorageSync(key(o,'cache')),savePending:(o,v)=>{if(v)wx.setStorageSync(key(o,'pending'),v);else wx.removeStorageSync(key(o,'pending'));},loadPending:o=>wx.getStorageSync(key(o,'pending'))});
 }return singleton;
}
module.exports={createSync,getDefault};

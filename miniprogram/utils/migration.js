const sync=require('./sync'),backup=require('./backup'),media=require('./media'),schema=require('./data-schema'),model=require('./record-model'),cloud=require('./cloud');
function validate(data){return schema.validate(data,media.isOwned);}
function inspectLegacy(){const raw=wx.getStorageSync('life_butler_data_v1');if(!raw)return null;const key='life_cloud_legacy_backup:'+cloud.ENV;if(!wx.getStorageSync(key))wx.setStorageSync(key,model.clone(raw));return JSON.stringify({app:'生活管家',data:raw});}
function prepare(text){const plan=backup.inspect(text,validate),target=sync.getDefault().read(),remote=model.clone(target);return choose({text,plan,target,remote,choices:{},missing:plan.missing,counts:plan.counts},null,null);}
function choose(preview,key,value){if(key==='*')preview.conflicts.forEach(c=>preview.choices[c.key]=value);else if(key)preview.choices[key]=value;const result=model.mergeLegacy(preview.plan.data,preview.remote,preview.choices);preview.data=result.data;preview.conflicts=result.conflicts;return preview;}
async function apply(preview){
 if(preview.conflicts.length)throw Error('请先选择如何处理同编号记录或设置冲突');
 const fresh=backup.inspect(preview.text,validate),materialized=await backup.materialize(fresh);await media.uploadData(materialized.data);
 const merged=model.mergeLegacy(materialized.data,preview.remote,preview.choices);if(merged.conflicts.length)throw Error('导入内容发生变化，请重新预览');
 validate(merged.data);Object.assign(preview.target,merged.data);await sync.getDefault().commit(preview.target,{replace:true});await media.remove(materialized.created);
}
module.exports={inspectLegacy,prepare,choose,apply};
